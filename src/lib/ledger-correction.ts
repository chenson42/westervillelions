/**
 * Pure, client-safe vocabulary for ledger corrections: moving a row to another
 * fund and the hardened delete (DECISION-109/110/111,
 * docs/work-log/2026-10-01-move-or-cancel-transaction.md).
 *
 * NO database import, ever: the dialogs import the reason limits, response
 * types and warning copy from here, and a DB import would break the browser
 * bundle. The DB-importing half is ./ledger-audit.ts.
 *
 * Member-surface firewall: reason text is free text that may name a person.
 * Nothing under src/app/members/**, src/app/api/members/** or
 * src/lib/financial-report-*.ts may import this module or ledger-audit
 * (enforced by a test in ledger-audit.test.ts).
 */

import { isUuid } from "@/lib/utils";
import type { FundMoveDenialCode } from "@/lib/ledger-fund-move-policy";

// ---------------------------------------------------------------------------
// Reason
// ---------------------------------------------------------------------------

export const CORRECTION_REASON_MIN = 10;
export const CORRECTION_REASON_MAX = 500;

export const REASON_LIMITS = {
  min: CORRECTION_REASON_MIN,
  max: CORRECTION_REASON_MAX,
} as const;

/**
 * Trim and bound a free-text reason. Length is counted by code point after the
 * trim, so emoji and right-to-left text count as the user sees them; interior
 * whitespace is preserved.
 */
export function normalizeCorrectionReason(
  value: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "A reason is required." };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, error: "A reason is required." };
  }
  const length = Array.from(trimmed).length;
  if (length < CORRECTION_REASON_MIN) {
    return {
      ok: false,
      error: `Reason must be at least ${CORRECTION_REASON_MIN} characters.`,
    };
  }
  if (length > CORRECTION_REASON_MAX) {
    return {
      ok: false,
      error: `Reason must be at most ${CORRECTION_REASON_MAX} characters.`,
    };
  }
  return { ok: true, value: trimmed };
}

// ---------------------------------------------------------------------------
// Audit actions
// ---------------------------------------------------------------------------

export const TRANSACTION_FUND_MOVED_AUDIT_ACTION = "transaction_fund_moved" as const;
export const TRANSACTION_DELETED_AUDIT_ACTION = "transaction_deleted" as const;

export type CorrectionAuditAction =
  | typeof TRANSACTION_FUND_MOVED_AUDIT_ACTION
  | typeof TRANSACTION_DELETED_AUDIT_ACTION;

export const CORRECTION_AUDIT_ACTIONS: readonly CorrectionAuditAction[] = [
  TRANSACTION_FUND_MOVED_AUDIT_ACTION,
  TRANSACTION_DELETED_AUDIT_ACTION,
];

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export interface MoveInput {
  destFundId: string;
  categoryId: string | null;
  reason: string;
  expectedFundId: string;
}

const MOVE_BODY_KEYS = ["destFundId", "categoryId", "reason", "expectedFundId"] as const;

/**
 * Validate a move POST body: EXACTLY the four keys (any other or missing key is
 * rejected), uuid-shaped ids, `categoryId` a uuid or null (never ""), and a
 * normalized reason. Runs before any database read.
 */
export function parseMoveBody(
  body: unknown,
): { ok: true; value: MoveInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  const extra = keys.filter((k) => !(MOVE_BODY_KEYS as readonly string[]).includes(k));
  if (extra.length > 0) {
    return { ok: false, error: `Unexpected field: ${extra[0]}.` };
  }
  for (const key of MOVE_BODY_KEYS) {
    if (!(key in record)) {
      return { ok: false, error: `${key} is required.` };
    }
  }
  const { destFundId, categoryId, expectedFundId } = record;
  if (typeof destFundId !== "string" || !isUuid(destFundId)) {
    return { ok: false, error: "Select a valid destination fund." };
  }
  if (typeof expectedFundId !== "string" || !isUuid(expectedFundId)) {
    return { ok: false, error: "expectedFundId must be a valid fund id." };
  }
  if (categoryId !== null && (typeof categoryId !== "string" || !isUuid(categoryId))) {
    return { ok: false, error: "Select a valid category, or no category." };
  }
  const reason = normalizeCorrectionReason(record.reason);
  if (!reason.ok) return { ok: false, error: reason.error };
  return {
    ok: true,
    value: {
      destFundId,
      categoryId: categoryId as string | null,
      reason: reason.value,
      expectedFundId,
    },
  };
}

/** Validate a delete DELETE body `{ reason }`. */
export function parseDeleteBody(
  body: unknown,
): { ok: true; value: { reason: string } } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "A reason is required. Refresh the page and try again." };
  }
  const reason = normalizeCorrectionReason((body as Record<string, unknown>).reason);
  if (!reason.ok) return { ok: false, error: reason.error };
  return { ok: true, value: { reason: reason.value } };
}

// ---------------------------------------------------------------------------
// Error codes and API shapes
// ---------------------------------------------------------------------------

export type MoveErrorCode =
  | "invalid_body"
  | "not_found"
  | "approved"
  | "rejected"
  | "pending"
  | "transfer_leg"
  | "dues_synced"
  | "manage_required"
  | "stale"
  | "same_fund"
  | "fund_not_found"
  | "bank_account_entity_mismatch"
  | "category_not_found"
  | "category_invalid"
  | "cross_entity"
  | "expense_not_supported"
  | "away_from_public"
  | "not_permitted";

/** A destination can be denied by the policy or by the bank-account assertion. */
export type MoveDestinationDenialCode = FundMoveDenialCode | "bank_account_entity_mismatch";

export type MoveWarningCode =
  | "ratchet"
  | "reconciled"
  | "prior_fiscal_year"
  | "sent_statement"
  | "aged_public_fund"
  | "sweep_not_automatic";

export interface MovePreview {
  transaction: {
    id: string;
    txnDate: string;
    flow: "income" | "expense";
    amountCents: number;
    party: string | null;
    fiscalYear: number;
    reconciled: boolean;
    fundId: string;
    fundName: string;
    fundKind: string;
    categoryId: string | null;
    categoryName: string | null;
    bankAccountId: string | null;
    bankAccountName: string | null;
  };
  tier: { required: "record" | "manage"; reasons: Array<"reconciled" | "prior_fiscal_year"> };
  destinations: Array<{
    fundId: string;
    name: string;
    kind: string;
    allowed: boolean;
    denial?: { code: MoveDestinationDenialCode; reason: string };
    // present only when allowed:
    categories?: Array<{ id: string; name: string }>;
    defaultCategoryId?: string | null;
    impact?: {
      sourceFund: { name: string; beforeCents: number; afterCents: number };
      destFund: { name: string; beforeCents: number; afterCents: number };
      bankAccount: { name: string | null; changeCents: 0 };
    };
  }>;
  warnings: Array<{ code: MoveWarningCode; message: string }>;
  reasonLimits: { min: number; max: number };
}

export interface MoveResponse {
  id: string;
  fundId: string;
  fundSlug: string;
  fundName: string;
  categoryId: string | null;
  categoryName: string | null;
  /** True when the destination is the Activity Fund and the row is income. */
  sweepSuggested: boolean;
}

export interface DeleteResponse {
  deleted: 1 | 2;
  acknowledgmentRemoved: boolean;
}

/** Error body shape shared by the move routes. */
export interface CorrectionErrorBody {
  error: string;
  code?: string;
}

// ---------------------------------------------------------------------------
// Copy (one place so the dialog, tests, guide and release note agree)
// ---------------------------------------------------------------------------

export const RATCHET_WARNING =
  "This cannot be moved back. Money in the Activity Fund can only leave through a minuted sweep to the Foundation. If you move the wrong entry, the fix is to delete and re-enter it, or to reopen its reconciliation session first if it has been reconciled.";

export const RECONCILED_WARNING =
  "This entry was cleared on a bank statement. Moving it changes only the fund; the bank balance and the reconciliation are not affected.";

export const PRIOR_FISCAL_YEAR_WARNING =
  "This entry is dated in an earlier fiscal year. Moving it restates that year's fund totals.";

export const AGED_PUBLIC_FUND_WARNING =
  "This entry is older than the holding period, so the Activity Fund will show the aged-funds warning until it is swept.";

export const MANAGE_REQUIRED_MESSAGE =
  "Moving a reconciled or prior-year entry needs the Manage Ledger permission.";

export const STALE_MOVE_MESSAGE =
  "This entry changed while you were looking at it. Refresh and try again.";

export const MOVE_FAILED_MESSAGE = "Could not move this entry. Nothing was changed.";

export const RECEIPT_SENT_MESSAGE =
  "A receipt was already sent to the donor for this gift. Record a refund entry instead.";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-09" -> "September 2026". Falls back to the input on a malformed month. */
export function formatStatementMonth(ym: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!match) return ym;
  const name = MONTH_NAMES[Number(match[2]) - 1];
  return name ? `${name} ${match[1]}` : ym;
}

export function sentStatementWarning(ym: string): string {
  return `The Administrative statement for ${formatStatementMonth(ym)} was already sent to the board. After this move it will show as changed and you will be offered a corrected resend. Nothing is sent automatically.`;
}

export function sweepNotAutomaticWarning(bankAccountName: string | null): string {
  return `Moving does not sweep anything. The cash is still in ${bankAccountName ?? "its bank account"}; record the sweep separately once the money has actually been moved.`;
}

/** Compose the server-side warning list for a preview. Pure. */
export function buildMoveWarnings(input: {
  anyDestinationAllowed: boolean;
  tierReasons: Array<"reconciled" | "prior_fiscal_year">;
  sentStatementMonth: string | null;
  aged: boolean;
  bankAccountName: string | null;
}): MovePreview["warnings"] {
  const warnings: MovePreview["warnings"] = [];
  if (input.anyDestinationAllowed) {
    warnings.push({ code: "ratchet", message: RATCHET_WARNING });
  }
  if (input.tierReasons.includes("reconciled")) {
    warnings.push({ code: "reconciled", message: RECONCILED_WARNING });
  }
  if (input.tierReasons.includes("prior_fiscal_year")) {
    warnings.push({ code: "prior_fiscal_year", message: PRIOR_FISCAL_YEAR_WARNING });
  }
  if (input.sentStatementMonth) {
    warnings.push({
      code: "sent_statement",
      message: sentStatementWarning(input.sentStatementMonth),
    });
  }
  if (input.anyDestinationAllowed && input.aged) {
    warnings.push({ code: "aged_public_fund", message: AGED_PUBLIC_FUND_WARNING });
  }
  if (input.anyDestinationAllowed) {
    warnings.push({
      code: "sweep_not_automatic",
      message: sweepNotAutomaticWarning(input.bankAccountName),
    });
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Audit payloads (all v: 1, stored as JSON text)
// ---------------------------------------------------------------------------

export interface FundRefSnapshot {
  id: string;
  name: string;
  slug: string;
  kind: string;
}
export interface CategoryRefSnapshot {
  id: string;
  name: string;
}

export interface FundMoveAuditPayload {
  before: {
    v: 1;
    fund: FundRefSnapshot;
    category: CategoryRefSnapshot | null;
    budgetLineId: string | null;
  };
  after: {
    v: 1;
    fund: FundRefSnapshot;
    category: CategoryRefSnapshot | null;
    budgetLineId: null;
  };
  details: {
    v: 1;
    reason: string;
    entityId: string;
    txnDate: string;
    flow: "income" | "expense";
    amountCents: number;
    fiscalYear: number;
    tier: "record" | "manage";
    reconciled: boolean;
    reconciledSessionId: string | null;
    priorFiscalYear: boolean;
    /** "YYYY-MM" of an already-sent statement this move changes, or null. */
    sentStatementMonth: string | null;
  };
}

export interface TransactionSnapshot {
  id: string;
  entityId: string;
  fund: FundRefSnapshot;
  bankAccount: { id: string; name: string } | null;
  category: CategoryRefSnapshot | null;
  txnDate: string;
  flow: string;
  amountCents: number;
  party: string | null;
  memo: string | null;
  donorId: string | null;
  checkNumber: string | null;
  paymentMethod: string | null;
  status: string;
  reconciled: boolean;
  reconciledSessionId: string | null;
  duesPaymentId: string | null;
  transferGroupId: string | null;
  budgetLineId: string | null;
  acknowledgment: { existed: boolean; sent: boolean };
}

export interface TransactionDeletedAuditPayload {
  before: { v: 1; rows: TransactionSnapshot[] };
  after: null;
  details: {
    v: 1;
    reason: string;
    entityId: string;
    txnDate: string;
    flow: string;
    amountCents: number;
    fiscalYear: number;
    rowCount: 1 | 2;
    reconciled: boolean;
    reconciledSessionId: string | null;
    priorFiscalYear: boolean;
    sentStatementMonth: string | null;
    acknowledgmentRemoved: boolean;
  };
}

export type AuditPayloadFor<A extends CorrectionAuditAction> =
  A extends typeof TRANSACTION_FUND_MOVED_AUDIT_ACTION
    ? FundMoveAuditPayload
    : TransactionDeletedAuditPayload;

/** Serialize a typed payload into the three text columns. */
export function serializeAuditPayload(payload: {
  before: unknown;
  after: unknown;
  details: unknown;
}): { before: string | null; after: string | null; details: string } {
  return {
    before: payload.before == null ? null : JSON.stringify(payload.before),
    after: payload.after == null ? null : JSON.stringify(payload.after),
    details: JSON.stringify(payload.details),
  };
}

export type RawAudit = { raw: string };

function parseVersioned(text: string | null | undefined): Record<string, unknown> | RawAudit {
  if (text == null) return { raw: "" };
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).v === 1
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to raw
  }
  return { raw: text };
}

export function isRawAudit(value: unknown): value is RawAudit {
  return !!value && typeof value === "object" && "raw" in (value as object);
}

/**
 * Parse a `details` column for one of the correction actions. NEVER throws:
 * legacy plain-text details, malformed JSON, an unknown version or null all
 * degrade to `{ raw }`.
 */
export function parseAuditDetails(
  action: typeof TRANSACTION_FUND_MOVED_AUDIT_ACTION,
  text: string | null | undefined,
): FundMoveAuditPayload["details"] | RawAudit;
export function parseAuditDetails(
  action: typeof TRANSACTION_DELETED_AUDIT_ACTION,
  text: string | null | undefined,
): TransactionDeletedAuditPayload["details"] | RawAudit;
export function parseAuditDetails(
  action: CorrectionAuditAction,
  text: string | null | undefined,
): FundMoveAuditPayload["details"] | TransactionDeletedAuditPayload["details"] | RawAudit {
  void action;
  const parsed = parseVersioned(text);
  if (isRawAudit(parsed)) return parsed;
  if (typeof parsed.reason !== "string" || typeof parsed.entityId !== "string") {
    return { raw: text ?? "" };
  }
  return parsed as unknown as FundMoveAuditPayload["details"];
}

/** Parse a `before` / `after` column. Never throws. */
export function parseAuditBefore(
  action: typeof TRANSACTION_FUND_MOVED_AUDIT_ACTION,
  text: string | null | undefined,
): FundMoveAuditPayload["before"] | RawAudit;
export function parseAuditBefore(
  action: typeof TRANSACTION_DELETED_AUDIT_ACTION,
  text: string | null | undefined,
): TransactionDeletedAuditPayload["before"] | RawAudit;
export function parseAuditBefore(
  action: CorrectionAuditAction,
  text: string | null | undefined,
): FundMoveAuditPayload["before"] | TransactionDeletedAuditPayload["before"] | RawAudit {
  const parsed = parseVersioned(text);
  if (isRawAudit(parsed)) return parsed;
  if (action === TRANSACTION_DELETED_AUDIT_ACTION) {
    if (!Array.isArray(parsed.rows)) return { raw: text ?? "" };
    return parsed as unknown as TransactionDeletedAuditPayload["before"];
  }
  if (!parsed.fund || typeof parsed.fund !== "object") return { raw: text ?? "" };
  return parsed as unknown as FundMoveAuditPayload["before"];
}

export function parseAuditAfter(
  text: string | null | undefined,
): FundMoveAuditPayload["after"] | RawAudit {
  const parsed = parseVersioned(text);
  if (isRawAudit(parsed)) return parsed;
  if (!parsed.fund || typeof parsed.fund !== "object") return { raw: text ?? "" };
  return parsed as unknown as FundMoveAuditPayload["after"];
}

// ---------------------------------------------------------------------------
// Reader row (returned by getRecentLedgerCorrections in ledger-audit.ts)
// ---------------------------------------------------------------------------

export interface LedgerCorrectionRow {
  id: string;
  createdAt: Date;
  actorName: string | null;
  kind: "moved" | "deleted";
  amountCents: number | null;
  flow: string | null;
  txnDate: string | null;
  from: string | null;
  to: string | null;
  reason: string | null;
  /** Reconciled or dated in a prior fiscal year when corrected. */
  settledPeriod: boolean;
  rowCount: number;
  sentStatementMonth: string | null;
}
