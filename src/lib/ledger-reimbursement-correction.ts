/**
 * Pure, client-safe vocabulary for correcting a PAID REIMBURSEMENT's ledger row
 * (B-108 / DECISION-114, docs/work-log/2026-10-02-reimbursement-reconcilable.md):
 * the two operations, their exact-key body parsers, the eligibility classifier,
 * the permission tier, the diff, the display labels, the warnings, the refusal
 * codes with their statuses and copy, and every request/response type the
 * dialogs consume.
 *
 * NO database import, ever (the dialogs import this): the DB half is
 * ./ledger-reimbursement-correction-queries.ts.
 *
 * Member-surface firewall: the audit reason is free text that may name a
 * person. Nothing under src/app/members/**, src/app/api/members/** or
 * src/lib/financial-report-*.ts may import this module (enforced by a test in
 * ledger-audit.test.ts, which covers the audit reader this module feeds).
 */

import { isUuid } from "@/lib/utils";
import { getFiscalYear, currentFiscalYear } from "@/lib/fiscal-year";
import {
  REIMBURSEMENT_PAYMENT_METHODS,
  REIMBURSEMENT_PAYMENT_METHOD_LABELS,
  isReimbursementPaymentMethod,
  normalizeCheckNumber,
  parseIsoDate,
  type ReimbursementPaymentMethod,
} from "@/lib/ledger";
import {
  CLOSED_SESSION_LOCK_MESSAGE,
  requiredMoveTier,
  type LockableRow,
} from "@/lib/ledger-transaction-lock";
import {
  STALE_MOVE_MESSAGE,
  formatStatementMonth,
  normalizeCorrectionReason,
  sentStatementWarning,
  type CorrectableField,
  type ReimbursementCorrectionSide,
} from "@/lib/ledger-correction";

export type { CorrectableField, ReimbursementCorrectionSide };
export { REIMBURSEMENT_PAYMENT_METHODS, REIMBURSEMENT_PAYMENT_METHOD_LABELS };

// ---------------------------------------------------------------------------
// Operations and body parsers
// ---------------------------------------------------------------------------

export const CORRECTION_OPERATIONS = ["fill_bank_account", "correct"] as const;
export type CorrectionOperation = (typeof CORRECTION_OPERATIONS)[number];

/** The audit `reason` written for `fill_bank_account` (no typed reason is collected). */
export const FILL_BANK_ACCOUNT_REASON =
  "Bank account added to a paid reimbursement that was recorded without one.";

/** Every field `correct` may change, in canonical display order. */
export const CORRECTABLE_FIELDS: readonly CorrectableField[] = [
  "categoryId",
  "budgetLineId",
  "txnDate",
  "paymentMethod",
  "checkNumber",
  "memo",
  "bankAccountId",
];

/**
 * The two exact key sets. Anything else is 400 `invalid_body` by construction
 * (not by a denylist someone must remember to extend): the allowlist test
 * derives "every column not listed is rejected" from these.
 */
export const FILL_BODY_KEYS: readonly string[] = [
  "operation",
  "bankAccountId",
  "expectedUpdatedAt",
  "checkNumber",
];
export const CORRECT_BODY_KEYS: readonly string[] = [
  "operation",
  "reason",
  "expectedUpdatedAt",
  ...CORRECTABLE_FIELDS,
];

export const MEMO_MAX_LEN = 1000;

export interface FillBankAccountInput {
  operation: "fill_bank_account";
  bankAccountId: string;
  /** null = leave the check number as it is. */
  checkNumber: string | null;
  expectedUpdatedAt: string;
}

/** The requested new values; absent keys are not being changed. */
export interface CorrectChanges {
  categoryId?: string;
  budgetLineId?: string | null;
  txnDate?: string;
  paymentMethod?: ReimbursementPaymentMethod;
  checkNumber?: string | null;
  memo?: string;
  bankAccountId?: string;
}

export interface CorrectInput {
  operation: "correct";
  reason: string;
  expectedUpdatedAt: string;
  changes: CorrectChanges;
}

export type CorrectionBodyInput = FillBankAccountInput | CorrectInput;

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const bad = (error: string): { ok: false; error: string } => ({ ok: false, error });

function parseExpectedUpdatedAt(v: unknown): string | null {
  if (typeof v !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(v)) return null;
  return Number.isNaN(new Date(v).getTime()) ? null : v;
}

/**
 * Parse a POST body into exactly one of the two operation shapes. Pure and
 * run BEFORE any database read. The first problem found is reported.
 */
export function parseCorrectionBody(raw: unknown): ParseResult<CorrectionBodyInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return bad("Request body must be a JSON object.");
  }
  const body = raw as Record<string, unknown>;
  const operation = body.operation;
  if (operation !== "fill_bank_account" && operation !== "correct") {
    return bad("operation must be one of: fill_bank_account, correct.");
  }
  const allowed = operation === "fill_bank_account" ? FILL_BODY_KEYS : CORRECT_BODY_KEYS;
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) return bad(`Unexpected field: ${key}.`);
  }

  const expectedUpdatedAt = parseExpectedUpdatedAt(body.expectedUpdatedAt);
  if (!expectedUpdatedAt) return bad("expectedUpdatedAt is required and must be an ISO date string.");

  if (operation === "fill_bank_account") {
    if (typeof body.bankAccountId !== "string" || !isUuid(body.bankAccountId)) {
      return bad("Select a valid bank account.");
    }
    const check = normalizeCheckNumber(body.checkNumber);
    if ("error" in check) return bad(check.error);
    return {
      ok: true,
      value: {
        operation,
        bankAccountId: body.bankAccountId,
        checkNumber: check.value,
        expectedUpdatedAt,
      },
    };
  }

  const reason = normalizeCorrectionReason(body.reason);
  if (!reason.ok) return bad(reason.error);

  const changes: CorrectChanges = {};
  if ("categoryId" in body) {
    if (typeof body.categoryId !== "string" || !isUuid(body.categoryId)) {
      return bad("categoryId must be a category id.");
    }
    changes.categoryId = body.categoryId;
  }
  if ("budgetLineId" in body) {
    if (body.budgetLineId === null) {
      changes.budgetLineId = null;
    } else if (typeof body.budgetLineId === "string" && isUuid(body.budgetLineId)) {
      changes.budgetLineId = body.budgetLineId;
    } else {
      return bad("budgetLineId must be a budget line id or null.");
    }
  }
  if ("txnDate" in body) {
    const d = parseIsoDate(body.txnDate);
    if (!d) return bad("txnDate must be a valid date in YYYY-MM-DD format.");
    changes.txnDate = d;
  }
  if ("paymentMethod" in body) {
    if (!isReimbursementPaymentMethod(body.paymentMethod)) {
      return bad(`paymentMethod must be one of: ${REIMBURSEMENT_PAYMENT_METHODS.join(", ")}.`);
    }
    changes.paymentMethod = body.paymentMethod;
  }
  if ("checkNumber" in body) {
    const check = normalizeCheckNumber(body.checkNumber);
    if ("error" in check) return bad(check.error);
    changes.checkNumber = check.value;
  }
  if ("memo" in body) {
    if (typeof body.memo !== "string" || !body.memo.trim()) {
      return bad("The description cannot be blank.");
    }
    const memo = body.memo.trim();
    if (memo.length > MEMO_MAX_LEN) {
      return bad(`The description must be at most ${MEMO_MAX_LEN} characters.`);
    }
    changes.memo = memo;
  }
  if ("bankAccountId" in body) {
    if (typeof body.bankAccountId !== "string" || !isUuid(body.bankAccountId)) {
      return bad("Select a valid bank account.");
    }
    changes.bankAccountId = body.bankAccountId;
  }
  if (Object.keys(changes).length === 0) {
    return bad("Change at least one field.");
  }
  return {
    ok: true,
    value: { operation, reason: reason.value, expectedUpdatedAt, changes },
  };
}

/** GET proposal params: both optional; a malformed value is the caller's 400. */
export interface CorrectionProposal {
  txnDate?: string;
  paymentMethod?: ReimbursementPaymentMethod;
}

export function parseCorrectionProposal(
  params: URLSearchParams,
): ParseResult<CorrectionProposal> {
  const proposal: CorrectionProposal = {};
  const date = params.get("txnDate");
  if (date !== null) {
    const d = parseIsoDate(date);
    if (!d) return bad("txnDate must be a valid date in YYYY-MM-DD format.");
    proposal.txnDate = d;
  }
  const method = params.get("paymentMethod");
  if (method !== null) {
    if (!isReimbursementPaymentMethod(method)) {
      return bad(`paymentMethod must be one of: ${REIMBURSEMENT_PAYMENT_METHODS.join(", ")}.`);
    }
    proposal.paymentMethod = method;
  }
  return { ok: true, value: proposal };
}

// ---------------------------------------------------------------------------
// Eligibility (closed set)
// ---------------------------------------------------------------------------

export type CorrectableRowKind = "paid_reimbursement";

/**
 * The ONE closed eligibility rule. A row is correctable only when it is a
 * posted, approved, non-transfer, non-dues EXPENSE that a PAID reimbursement
 * links to (`linkedPaidCount` is derived server-side by
 * ledger-reimbursement-link.ts; the client never supplies it). Every other row,
 * including every other approved row and every ordinary unlocked row (which
 * belongs to PATCH), is null and a uniform 403 `not_correctable`. A second
 * eligible kind is a new arm here plus a new DECISION, never a body flag.
 */
export function correctableRowKind(
  row: {
    flow: string;
    status: string;
    approvedAt: Date | string | null;
    transferGroupId: string | null;
    duesPaymentId: string | null;
  },
  linkedPaidCount: number,
): CorrectableRowKind | null {
  if (
    row.flow === "expense" &&
    row.status === "posted" &&
    row.approvedAt != null &&
    row.transferGroupId == null &&
    row.duesPaymentId == null &&
    linkedPaidCount > 0
  ) {
    return "paid_reimbursement";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Refusal codes, statuses and copy
// ---------------------------------------------------------------------------

export type CorrectionErrorCode =
  | "invalid_body"
  | "no_change"
  | "category_invalid"
  | "bank_account_invalid"
  | "budget_line_invalid"
  | "forbidden"
  | "not_correctable"
  | "own_request"
  | "manage_required"
  | "reconciled_session"
  | "reconciled_legacy"
  | "matched_open_session"
  | "not_found"
  | "category_not_found"
  | "budget_line_not_found"
  | "stale"
  | "already_has_bank_account"
  | "check_number_present"
  | "would_hide_statement";

export type CorrectionErrorStatus = 400 | 403 | 404 | 409;

/** The status POST returns for each code. An exhaustive Record: a new code is a compile error. */
export const CORRECTION_ERROR_STATUS: Record<CorrectionErrorCode, CorrectionErrorStatus> = {
  invalid_body: 400,
  no_change: 400,
  category_invalid: 400,
  bank_account_invalid: 400,
  budget_line_invalid: 400,
  forbidden: 403,
  not_correctable: 403,
  own_request: 403,
  manage_required: 403,
  reconciled_session: 403,
  reconciled_legacy: 403,
  matched_open_session: 403,
  not_found: 404,
  category_not_found: 404,
  budget_line_not_found: 404,
  stale: 409,
  already_has_bank_account: 409,
  check_number_present: 409,
  would_hide_statement: 409,
};

export const MANAGE_REQUIRED_CORRECTION_MESSAGE =
  "Correcting a reconciled entry, an entry from an earlier fiscal year, or a date that moves into another fiscal year needs the Manage Ledger permission.";

/**
 * User-facing text per refusal code (the server's `error`, the dialog's blocked
 * state). `invalid_body`, `bank_account_invalid`, `category_invalid`,
 * `budget_line_invalid` and `would_hide_statement` carry specific text from the
 * validator; the entry here is the generic fallback.
 */
export const CORRECTION_ERROR_COPY: Record<CorrectionErrorCode, string> = {
  invalid_body: "That request was not valid.",
  no_change: "Nothing changed. Edit at least one field.",
  category_invalid: "That category cannot be used for this entry.",
  bank_account_invalid: "Select a valid, active bank account for this entry's entity.",
  budget_line_invalid:
    "That budget line does not match the entry's fund, fiscal year or category.",
  forbidden: "You do not have permission to do that.",
  not_correctable: "Only a paid reimbursement can be corrected here.",
  own_request:
    "You submitted this reimbursement, so another reviewer must repair or correct its entry.",
  manage_required: MANAGE_REQUIRED_CORRECTION_MESSAGE,
  reconciled_session: `${CLOSED_SESSION_LOCK_MESSAGE} Its date and bank account cannot change while it is reconciled.`,
  reconciled_legacy:
    "This entry is marked reconciled. Un-mark it first; its date and bank account cannot change while it is reconciled.",
  matched_open_session:
    "This entry is matched to a bank line in an open reconciliation session. Unmatch it first; its date and bank account cannot change while it is matched.",
  not_found: "Transaction not found.",
  category_not_found: "Category not found.",
  budget_line_not_found: "Budget line not found.",
  stale: STALE_MOVE_MESSAGE,
  already_has_bank_account: "This entry already has a bank account. Refresh the page.",
  check_number_present:
    "This entry already has a different check number. Use Correct to change it.",
  would_hide_statement:
    "That change would hide a monthly statement from members until this entry is reconciled.",
};

export const CORRECTION_FAILED_MESSAGE = "Could not save this correction. Nothing was changed.";

export interface CorrectionErrorBody {
  error: string;
  code: CorrectionErrorCode;
}

/** The message for a refused statement-hide (R1). */
export function wouldHideStatementMessage(args: {
  hiddenMonth: string;
  newDate: string | null;
  currentMonth: string;
  methodChange: boolean;
}): string {
  const hidden = formatStatementMonth(args.hiddenMonth);
  if (args.methodChange && (args.newDate === null || args.newDate.slice(0, 7) === args.currentMonth)) {
    return `Changing the payment method away from Check would hide the ${hidden} monthly statement from members, because the entry is not reconciled yet. Reconcile it first.`;
  }
  return `Moving this entry to ${args.newDate ?? "that date"} would hide the ${hidden} monthly statement from members, because the entry is not reconciled yet. Reconcile it first, or pick a date in ${formatStatementMonth(args.currentMonth)} or later.`;
}

// ---------------------------------------------------------------------------
// Tier
// ---------------------------------------------------------------------------

export type CorrectionTierReason = "reconciled" | "prior_fiscal_year" | "fiscal_year_change";

/**
 * Permission tier for `correct`: manage (LEDGER_MANAGE) when the row is
 * reconciled by either mark or dated before the current fiscal year (the SAME
 * rule as Move, via requiredMoveTier), or when the new date leaves the row's
 * fiscal year or lands in a prior one. `fill_bank_account` is exempt (record
 * tier by precondition). Pure; the caller passes the LOCKED row.
 */
export function requiredCorrectionTier(
  row: Pick<LockableRow, "reconciled" | "reconciledSessionId" | "txnDate">,
  change: { newTxnDate?: string | null },
  now: Date,
): { tier: "record" | "manage"; reasons: CorrectionTierReason[] } {
  const reasons: CorrectionTierReason[] = [];
  for (const r of requiredMoveTier(row, now).reasons) {
    if (r === "reconciled" || r === "prior_fiscal_year") reasons.push(r);
  }
  if (change.newTxnDate && change.newTxnDate !== row.txnDate) {
    const oldFy = getFiscalYear(new Date(row.txnDate + "T00:00:00"));
    const newFy = getFiscalYear(new Date(change.newTxnDate + "T00:00:00"));
    if (newFy < currentFiscalYear(now) && !reasons.includes("prior_fiscal_year")) {
      reasons.push("prior_fiscal_year");
    }
    if (newFy !== oldFy) reasons.push("fiscal_year_change");
  }
  return { tier: reasons.length > 0 ? "manage" : "record", reasons };
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/** The stored values the diff compares against (from the locked row). */
export interface StoredCorrectableValues {
  categoryId: string | null;
  budgetLineId: string | null;
  txnDate: string;
  paymentMethod: string | null;
  checkNumber: string | null;
  memo: string | null;
  bankAccountId: string | null;
}

/**
 * Drop every requested field equal to the stored value (a resent unchanged date
 * must never trip the reconciled refusal) and report the survivors in canonical
 * order. An empty `changed` list is `no_change`.
 */
export function diffCorrection(
  stored: StoredCorrectableValues,
  requested: CorrectChanges,
): { changes: CorrectChanges; changed: CorrectableField[] } {
  const changes: CorrectChanges = {};
  const changed: CorrectableField[] = [];
  for (const field of CORRECTABLE_FIELDS) {
    if (!(field in requested)) continue;
    const next = (requested as Record<string, unknown>)[field];
    if (next === stored[field]) continue;
    (changes as Record<string, unknown>)[field] = next;
    changed.push(field);
  }
  return { changes, changed };
}

// ---------------------------------------------------------------------------
// Display labels (Recent corrections)
// ---------------------------------------------------------------------------

function methodLabel(m: string | null | undefined): string {
  if (!m) return "none";
  return (REIMBURSEMENT_PAYMENT_METHOD_LABELS as Record<string, string>)[m] ?? m;
}

/**
 * Pre-composed display labels for a corrected audit row. The server composes
 * them and the UI renders them as given. Memo TEXT is never included: only
 * "Description edited". Self-describing from the payload, so a renamed
 * category or account still reads correctly.
 */
export function describeCorrectionChanges(
  before: ReimbursementCorrectionSide,
  after: ReimbursementCorrectionSide,
): string[] {
  const out: string[] = [];
  if ("category" in after) {
    out.push(`Category: ${before.category?.name ?? "none"} to ${after.category?.name ?? "none"}`);
  }
  if ("budgetLineId" in after) {
    out.push(after.budgetLineId === null ? "Budget line cleared" : "Budget line changed");
  }
  if ("txnDate" in after) {
    out.push(`Date: ${before.txnDate ?? "unknown"} to ${after.txnDate ?? "unknown"}`);
  }
  if ("paymentMethod" in after) {
    out.push(`Payment method: ${methodLabel(before.paymentMethod)} to ${methodLabel(after.paymentMethod)}`);
  }
  if ("checkNumber" in after) {
    if (after.checkNumber == null) out.push("Check number cleared");
    else if (before.checkNumber == null) out.push(`Check number added: ${after.checkNumber}`);
    else out.push(`Check number: ${before.checkNumber} to ${after.checkNumber}`);
  }
  if ("memo" in after) out.push("Description edited");
  if ("bankAccount" in after) {
    if (!before.bankAccount) out.push(`Bank account added: ${after.bankAccount?.name ?? "unknown"}`);
    else {
      out.push(
        `Bank account: ${before.bankAccount.name} to ${after.bankAccount?.name ?? "unknown"}`,
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

export type CorrectionWarningCode =
  | "reconciled"
  | "prior_fiscal_year"
  | "sent_statement"
  | "new_month_sent_statement"
  | "reports_change";

export interface CorrectionWarning {
  code: CorrectionWarningCode;
  message: string;
}

export const CORRECTION_RECONCILED_WARNING =
  "This entry was cleared on a bank statement. Correcting its category, description, payment method or check number does not change the bank balance or the reconciliation.";

export const CORRECTION_PRIOR_YEAR_WARNING =
  "This entry is dated in an earlier fiscal year. Correcting it restates that year's reports.";

export const CORRECTION_REPORTS_CHANGE_WARNING =
  "Changing the category or date restates reported totals for the affected fiscal year or years.";

/** Fields whose change can restate a monthly statement (memo, check number and bank account cannot). */
const STATEMENT_AFFECTING: readonly CorrectableField[] = [
  "categoryId",
  "txnDate",
  "budgetLineId",
  "paymentMethod",
];

export function isStatementAffecting(changed: readonly CorrectableField[]): boolean {
  return changed.some((f) => STATEMENT_AFFECTING.includes(f));
}

/**
 * Warnings for a proposed change (or the baseline when `changed` is empty).
 * `sentStatementMonth` / `newSentStatementMonth` are looked up by the caller;
 * this function only decides which to show.
 */
export function buildCorrectionWarnings(input: {
  tierReasons: readonly CorrectionTierReason[];
  changed: readonly CorrectableField[];
  sentStatementMonth: string | null;
  newSentStatementMonth: string | null;
  statementLabel: string;
}): CorrectionWarning[] {
  const warnings: CorrectionWarning[] = [];
  if (input.tierReasons.includes("reconciled")) {
    warnings.push({ code: "reconciled", message: CORRECTION_RECONCILED_WARNING });
  }
  if (input.tierReasons.includes("prior_fiscal_year")) {
    warnings.push({ code: "prior_fiscal_year", message: CORRECTION_PRIOR_YEAR_WARNING });
  }
  if (isStatementAffecting(input.changed)) {
    if (input.sentStatementMonth) {
      warnings.push({
        code: "sent_statement",
        message: sentStatementWarning(input.sentStatementMonth, input.statementLabel, "correction"),
      });
    }
    if (
      input.newSentStatementMonth &&
      input.newSentStatementMonth !== input.sentStatementMonth
    ) {
      warnings.push({
        code: "new_month_sent_statement",
        message: sentStatementWarning(
          input.newSentStatementMonth,
          input.statementLabel,
          "correction",
        ),
      });
    }
  }
  if (input.changed.includes("categoryId") || input.changed.includes("txnDate")) {
    warnings.push({ code: "reports_change", message: CORRECTION_REPORTS_CHANGE_WARNING });
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Request / response types (the dialogs consume these)
// ---------------------------------------------------------------------------

export type OperationDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: CorrectionErrorCode;
      status: 403 | 409;
      reason: string;
    };

export interface CorrectionBudgetLineOption {
  id: string;
  fundId: string;
  fiscalYear: number;
  categoryId: string;
  categoryName: string;
  cause: string;
  label: string;
  pendingDeleteAt: string | null;
}

export type LockedFieldsCode = "reconciled_session" | "reconciled_legacy" | "matched_open_session";

export interface CorrectionPreview {
  transaction: {
    id: string;
    txnDate: string;
    amountCents: number;
    party: string | null;
    memo: string | null;
    categoryId: string | null;
    categoryName: string | null;
    budgetLineId: string | null;
    paymentMethod: string | null;
    checkNumber: string | null;
    bankAccountId: string | null;
    bankAccountName: string | null;
    fundId: string;
    fundName: string;
    fundKind: string;
    entity: { id: string; slug: string; name: string };
    fiscalYear: number;
    /** Reconciled by either mark. */
    reconciled: boolean;
    /** A reconciliation match row exists. */
    matched: boolean;
    /** ISO; echo it back as `expectedUpdatedAt`. */
    updatedAt: string;
  };
  callerCanManage: boolean;
  operations: {
    fill_bank_account: OperationDecision;
    correct: OperationDecision & {
      tier: { required: "record" | "manage"; reasons: CorrectionTierReason[] };
      /** False while matched or reconciled: date and bank account are then locked. */
      dateAndBankEditable: boolean;
      lockedFields: { code: LockedFieldsCode; message: string } | null;
    };
  };
  options: {
    categories: { id: string; name: string }[];
    bankAccounts: { id: string; name: string; isDefault: boolean }[];
    defaultBankAccountId: string | null;
    budgetLines: CorrectionBudgetLineOption[];
    paymentMethods: readonly ReimbursementPaymentMethod[];
  };
  /** For the proposal when one was sent, else the baseline. */
  warnings: CorrectionWarning[];
  reasonLimits: { min: 10; max: 500 };
}

export interface CorrectResponse {
  id: string;
  operation: CorrectionOperation;
  changed: CorrectableField[];
  bankAccountName: string | null;
  budgetLineLinkCleared: boolean;
  warnings: CorrectionWarning[];
}

/** One advisory candidate for the create-from-bank-line dialog and the match picker. */
export interface CreateFromBankLineCandidate {
  transactionId: string;
  txnDate: string;
  party: string | null;
  amountCents: number;
  fundName: string;
  bankAccountId: string | null;
  bankAccountName: string | null;
  checkNumber: string | null;
  /** The candidate's check number equals the bank line's check number. */
  checkNumberMatchesLine: boolean;
  /** No bank account yet: it must be repaired (Add bank account) before it can match. */
  needsBankAccount: boolean;
  /** The caller submitted the linked reimbursement (computed server-side). */
  ownRequest: boolean;
}

/** 409 body of create-from-bank-line when a duplicate candidate exists and the flag is absent. */
export interface PossibleDuplicateBody {
  error: string;
  code: "possible_duplicate";
  candidates: CreateFromBankLineCandidate[];
}

export const POSSIBLE_DUPLICATE_MESSAGE =
  "A paid reimbursement of the same amount may already record this payment. Creating a new entry would count it twice.";
