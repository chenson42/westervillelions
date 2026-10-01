/**
 * Pure, client-safe vocabulary for ledger corrections: moving a row to another
 * fund (within an entity, or Foundation Charitable to Club Activity across
 * entities) and the hardened delete (DECISION-109/110/111/112/113,
 * docs/work-log/2026-10-01-move-or-cancel-transaction.md and
 * docs/work-log/2026-10-01-cross-entity-transaction-move.md).
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
import { fiscalYearLabel } from "@/lib/fiscal-year";
import type { FundMoveDenialCode } from "@/lib/ledger-fund-move-policy";
import type { CrossEntityStateBlock, MoveTierReason } from "@/lib/ledger-transaction-lock";

export type { CrossEntityStateBlock, MoveTierReason };

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
  /**
   * The destination entity's bank account the money actually landed in.
   * REQUIRED for a cross-entity move; MUST be null for a same-entity move
   * (a same-entity move never changes the bank account, which is what keeps
   * the reconciled carve-out sound). Absent on the wire is normalized to null.
   */
  destBankAccountId: string | null;
}

const MOVE_BODY_REQUIRED_KEYS = ["destFundId", "categoryId", "reason", "expectedFundId"] as const;
const MOVE_BODY_KEYS = [...MOVE_BODY_REQUIRED_KEYS, "destBankAccountId"] as const;

/**
 * Validate a move POST body: the four required keys plus the optional
 * `destBankAccountId` (any other or missing required key is rejected),
 * uuid-shaped ids, `categoryId` a uuid or null (never ""), and a normalized
 * reason. Runs before any database read.
 *
 * `destBankAccountId` is checked for TYPE only (string, null or absent): whether
 * a malformed id is `dest_bank_account_invalid` (cross-entity) or
 * `dest_bank_account_not_allowed` (same-entity) depends on the destination,
 * which needs the database, so the query layer decides.
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
  for (const key of MOVE_BODY_REQUIRED_KEYS) {
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
  const rawBank = record.destBankAccountId;
  if (rawBank !== undefined && rawBank !== null && typeof rawBank !== "string") {
    return { ok: false, error: "destBankAccountId must be a string or null." };
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
      destBankAccountId: rawBank === undefined ? null : rawBank,
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
  | "club_to_foundation_not_supported"
  | "expense_not_supported"
  | "away_from_public"
  | "not_permitted"
  | CrossEntityStateBlock
  | "dest_bank_account_required"
  | "dest_bank_account_invalid"
  | "dest_bank_account_not_allowed";

/**
 * A destination can be denied by the policy, a cross-entity row-state block,
 * the permission tier, or the stored-account assertion.
 * `dest_no_active_bank_account` is GET-only (no valid input exists for it).
 */
export type MoveDestinationDenialCode =
  | FundMoveDenialCode
  | "manage_required"
  | CrossEntityStateBlock
  | "bank_account_entity_mismatch"
  | "dest_no_active_bank_account";

export type MoveWarningCode =
  | "ratchet"
  | "reconciled"
  | "prior_fiscal_year"
  | "sent_statement"
  | "dest_sent_statement"
  | "aged_public_fund"
  | "sweep_not_automatic"
  | "receipt_sent"
  | "unsent_receipt_removed"
  | "duplicate_candidate"
  | "reconciliation_pending"
  | "reports_change";

/** All-time posted balance of a fund, before and after the move. */
export interface FundBal {
  name: string;
  beforeCents: number;
  afterCents: number;
}

/** `name` is the display name (`shortName ?? name`: "Foundation", "Club"). */
export interface MoveEntityRef {
  id: string;
  slug: string;
  name: string;
}

/** A destination-entity bank account with its book balance before/after the gift lands. */
export interface MoveBankOption {
  id: string;
  name: string;
  beforeCents: number;
  afterCents: number;
}

export interface MoveDuplicateCandidate {
  id: string;
  txnDate: string;
  party: string | null;
  amountCents: number;
  fundName: string;
  bankAccountName: string | null;
  matched: boolean;
  reconciled: boolean;
}

/**
 * Structured "before this can move" data for a cross-entity destination whose
 * denial is a row-state block the treasurer can clear by hand. The dialog
 * renders it as a guided checklist; nothing is automated.
 */
export interface MoveUnlock {
  kind: "closed_session" | "matched_open_session" | "legacy_reconciled";
  session: {
    id: string;
    bankAccountName: string;
    periodStart: string;
    periodEnd: string;
    status: "open" | "closed";
  } | null;
  /** Newest first. These must be reopened before `session`. */
  laterClosedSessions: Array<{ id: string; periodStart: string; periodEnd: string }>;
  /** `matched_open_session` only: OTHER entries matched to the same bank line (a batch). */
  otherMatchesOnLine: number;
  /** "YYYY-MM": first month whose member statement can be hidden while the session is open. */
  statementMonth: string | null;
  /** A corrected resend will be offered. */
  statementAlreadySent: boolean;
}

export interface MoveDestination {
  fundId: string;
  name: string;
  kind: string;
  entity: MoveEntityRef;
  crossEntity: boolean;
  /** What this destination needs from the caller (a function of row AND destination). */
  tier: { required: "record" | "manage"; reasons: MoveTierReason[] };
  allowed: boolean;
  denial?: {
    code: MoveDestinationDenialCode;
    status: 403 | 409;
    reason: string;
    unlock?: MoveUnlock;
  };
  // present only when allowed:
  /** Active categories of the destination entity + fund kind + the row's flow. */
  categories?: Array<{ id: string; name: string }>;
  /** "Public donations" when present. */
  defaultCategoryId?: string | null;
  /** Cross-entity only: ACTIVE accounts of the destination entity, name-ordered. */
  bankAccounts?: MoveBankOption[];
  /** Set ONLY when exactly one active account exists (a wrong guess silently breaks the next reconciliation). */
  defaultBankAccountId?: string | null;
  impact?:
    | {
        crossEntity: false;
        sourceFund: FundBal;
        destFund: FundBal;
        bankAccount: { name: string | null; changeCents: 0 };
      }
    | {
        crossEntity: true;
        sourceFund: FundBal;
        destFund: FundBal;
        /** The account the row sits on today (its book balance falls by the amount). */
        sourceBankAccount: { name: string; beforeCents: number; afterCents: number } | null;
      };
  /** Cross-entity only, cap 5. Advisory: a bundled deposit cannot be detected. */
  duplicateCandidates?: MoveDuplicateCandidate[];
  /** Server-composed; render as given. */
  warnings?: Array<{ code: MoveWarningCode; message: string }>;
}

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
    entity: MoveEntityRef;
    donorId: string | null;
    receipt: "none" | "unsent" | "sent";
  };
  callerCanManage: boolean;
  /** Every OTHER ACTIVE fund of EVERY entity, each decided by the guard pipeline. */
  destinations: MoveDestination[];
  reasonLimits: { min: number; max: number };
}

export interface MoveResponse {
  id: string;
  fundId: string;
  fundSlug: string;
  fundName: string;
  categoryId: string | null;
  categoryName: string | null;
  /** True when the destination is an Activity Fund and the row is income. */
  sweepSuggested: boolean;
  /** Slug of the DESTINATION entity: build the sweep deep link from this, not from the register's entity. */
  entitySlug: string;
  crossEntity: boolean;
  /** What happened to the receipt record on a cross-entity move; "none" for same-entity. */
  acknowledgment: "none" | "kept" | "removed";
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

export function sentStatementWarning(ym: string, label = "Administrative"): string {
  return `The ${label} statement for ${formatStatementMonth(ym)} was already sent to the board. After this move it will show as changed and you will be offered a corrected resend. Nothing is sent automatically.`;
}

export function sweepNotAutomaticWarning(bankAccountName: string | null): string {
  return `Moving does not sweep anything. The cash is still in ${bankAccountName ?? "its bank account"}; record the sweep separately once the money has actually been moved.`;
}

// Cross-entity copy (DECISION-112). One place so the dialog, tests, guide and release note agree.

export const CROSS_ENTITY_MANAGE_REQUIRED_MESSAGE =
  "Moving an entry to the other entity needs the Manage Ledger permission (held by the Admin role).";

export const CROSS_ENTITY_RATCHET_RECEIPT_SENT =
  "This cannot be moved back. The Club's Activity Fund can only send money to the Foundation through a minuted sweep, and because a receipt has already gone to the donor, this entry can no longer be deleted; correcting it later means a refund entry.";

export const CROSS_ENTITY_RATCHET_NO_RECEIPT =
  "This cannot be moved back. The Club's Activity Fund can only send money to the Foundation through a minuted sweep. If you move the wrong entry, delete it and enter the gift on the correct register.";

export const RECEIPT_SENT_WARNING =
  "A receipt letter was already sent for this gift. It stays attached to the gift and still names the Foundation as the issuer. The ledger does not change what the donor was told; confirm with whoever advises the club on tax matters that the receipt is still the right document before you move a receipted gift.";

export const UNSENT_RECEIPT_REMOVED_WARNING =
  "A receipt record exists for this gift but was never sent. A Club entry cannot hold one, so it is removed with the move. Nothing was sent to the donor.";

export const RECONCILIATION_PENDING_WARNING =
  "This entry is not reconciled on the Club side until you match it to the deposit line in the Club's reconciliation session.";

export const CROSS_ENTITY_SWEEP_NOT_AUTOMATIC_WARNING =
  "Moving does not sweep anything. The cash is already in the Club's bank account; record the sweep once the money has actually been moved.";

export function duplicateCandidateWarning(count: number): string {
  return `The Club already has ${count} posted income ${count === 1 ? "entry" : "entries"} of this amount within 30 days. If this deposit was already recorded on the Club side, moving this gift would count it twice. A deposit bundled with other money cannot be detected here.`;
}

export function reportsChangeWarning(fiscalYear: number): string {
  return `Reported income moves with the gift: it leaves the Foundation's totals for ${fiscalYearLabel(fiscalYear)} and joins the Club's. When you later record the sweep, the Foundation's totals count that transfer-in as income too, as they do for every sweep.`;
}

/** User-facing text for a cross-entity row-state refusal. An exhaustive Record: a new code is a compile error. */
export const CROSS_ENTITY_STATE_COPY: Record<
  CrossEntityStateBlock,
  { message: string; nextStep: string }
> = {
  prior_fiscal_year_cross_entity: {
    message:
      "This entry is dated in an earlier fiscal year. Moving it to the other entity would restate both entities' totals for a closed year, which is not supported.",
    nextStep: "Record a correcting entry on each entity's books instead, or ask a developer.",
  },
  reconciled_session: {
    message:
      "This entry was cleared by a closed reconciliation session. A move changes its bank account, so the session has to be reopened first.",
    nextStep: "Reopen the session, unmatch this entry, then move it.",
  },
  reconciled_legacy: {
    message: "This entry is marked reconciled. A move changes its bank account.",
    nextStep: "Un-mark it as reconciled first.",
  },
  matched_open_session: {
    message: "This entry is matched to a bank line in a reconciliation session.",
    nextStep: "Unmatch it in the session first.",
  },
};

/** Compose the server-side warning list for ONE destination. Pure. */
export function buildMoveWarnings(input: {
  anyDestinationAllowed: boolean;
  tierReasons: Array<"reconciled" | "prior_fiscal_year">;
  sentStatementMonth: string | null;
  aged: boolean;
  bankAccountName: string | null;
  /** Present only for a cross-entity destination; selects the cross-entity set. */
  crossEntity?: {
    receipt: "none" | "unsent" | "sent";
    sourceLabel: string;
    destLabel: string;
    destSentStatementMonth: string | null;
    duplicateCount: number;
    fiscalYear: number;
  };
}): NonNullable<MoveDestination["warnings"]> {
  const warnings: NonNullable<MoveDestination["warnings"]> = [];

  if (input.crossEntity) {
    const x = input.crossEntity;
    // A cross-entity row is never reconciled or prior-year (both are refusals),
    // so those two warnings never appear here.
    warnings.push({
      code: "ratchet",
      message: x.receipt === "sent" ? CROSS_ENTITY_RATCHET_RECEIPT_SENT : CROSS_ENTITY_RATCHET_NO_RECEIPT,
    });
    if (x.receipt === "sent") {
      warnings.push({ code: "receipt_sent", message: RECEIPT_SENT_WARNING });
    }
    if (x.receipt === "unsent") {
      warnings.push({ code: "unsent_receipt_removed", message: UNSENT_RECEIPT_REMOVED_WARNING });
    }
    if (input.sentStatementMonth) {
      warnings.push({
        code: "sent_statement",
        message: sentStatementWarning(input.sentStatementMonth, x.sourceLabel),
      });
    }
    if (x.destSentStatementMonth) {
      warnings.push({
        code: "dest_sent_statement",
        message: sentStatementWarning(x.destSentStatementMonth, x.destLabel),
      });
    }
    if (x.duplicateCount > 0) {
      warnings.push({
        code: "duplicate_candidate",
        message: duplicateCandidateWarning(x.duplicateCount),
      });
    }
    if (input.aged) {
      warnings.push({ code: "aged_public_fund", message: AGED_PUBLIC_FUND_WARNING });
    }
    warnings.push({ code: "reports_change", message: reportsChangeWarning(x.fiscalYear) });
    warnings.push({ code: "reconciliation_pending", message: RECONCILIATION_PENDING_WARNING });
    warnings.push({
      code: "sweep_not_automatic",
      message: CROSS_ENTITY_SWEEP_NOT_AUTOMATIC_WARNING,
    });
    return warnings;
  }

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

/**
 * Memo prefill for the sweep form opened from a just-moved gift (DECISION-111
 * D2, DECISION-112 / Gap 10). The date is the audit row's own `createdAt`
 * rendered in America/New_York (never the page-load clock, which is the wrong
 * day after about 8 pm Eastern); with no audit row the entry was never moved,
 * so the memo says nothing about a move or a date.
 */
export function buildSweepMemo(input: {
  party: string | null;
  move: { createdAt: Date; sourceLabel: string } | null;
}): string {
  const trimmed = input.party?.trim();
  const phrase = trimmed ? `${trimmed} gift` : "a gift";
  if (!input.move) return `Sweep of ${phrase}`;
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(input.move.createdAt);
  return `Sweep of ${phrase} moved from ${input.move.sourceLabel} on ${date}`;
}

// ---------------------------------------------------------------------------
// Audit payloads (v: 1 for deletes and same-entity moves, v: 2 for cross-entity moves; stored as JSON text)
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

/** v1: a same-entity move (shipped; unchanged). */
export interface FundMoveAuditPayloadV1 {
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

/** `name` is the display name (`shortName ?? name`). */
export interface EntityRefSnapshot {
  id: string;
  name: string;
  slug: string;
}
export interface BankRefSnapshot {
  id: string;
  name: string;
}

/** v2: a CROSS-ENTITY move (DECISION-112). Self-describing: names come from the payload, no joins. */
export interface FundMoveAuditPayloadV2 {
  before: {
    v: 2;
    entity: EntityRefSnapshot;
    fund: FundRefSnapshot;
    bankAccount: BankRefSnapshot | null;
    category: CategoryRefSnapshot | null;
    budgetLineId: string | null;
  };
  after: {
    v: 2;
    entity: EntityRefSnapshot;
    fund: FundRefSnapshot;
    bankAccount: BankRefSnapshot;
    category: CategoryRefSnapshot | null;
    budgetLineId: null;
  };
  details: {
    v: 2;
    reason: string;
    /** The SOURCE entity: a reader that only knows v1 still lists the move under the source. */
    entityId: string;
    destEntityId: string;
    crossEntity: true;
    txnDate: string;
    flow: "income" | "expense";
    amountCents: number;
    fiscalYear: number;
    tier: "manage";
    /** False by precondition: a reconciled row cannot move across entities. */
    reconciled: boolean;
    reconciledSessionId: string | null;
    priorFiscalYear: boolean;
    sentStatementMonth: string | null;
    destSentStatementMonth: string | null;
    donorId: string | null;
    acknowledgment: {
      id: string | null;
      sent: boolean;
      sentAt: string | null;
      outcome: "none" | "kept" | "removed";
      doneeEntityId: string | null;
    };
  };
}

export type FundMoveAuditPayload = FundMoveAuditPayloadV1 | FundMoveAuditPayloadV2;

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

function parseVersioned(
  text: string | null | undefined,
  allowedVersions: readonly number[] = [1],
): Record<string, unknown> | RawAudit {
  if (text == null) return { raw: "" };
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      allowedVersions.includes((parsed as Record<string, unknown>).v as number)
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

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Versions the MOVED action may carry. A v2 DELETE is never written, so it parses as raw. */
const MOVED_VERSIONS = [1, 2] as const;
const DELETED_VERSIONS = [1] as const;

/**
 * Parse a `details` column for one of the correction actions. NEVER throws:
 * legacy plain-text details, malformed JSON, an unknown version, a payload
 * that fails its per-version shape guard, or null all degrade to `{ raw }`.
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
  const parsed = parseVersioned(
    text,
    action === TRANSACTION_FUND_MOVED_AUDIT_ACTION ? MOVED_VERSIONS : DELETED_VERSIONS,
  );
  if (isRawAudit(parsed)) return parsed;
  if (typeof parsed.reason !== "string" || typeof parsed.entityId !== "string") {
    return { raw: text ?? "" };
  }
  if (parsed.v === 2) {
    if (typeof parsed.destEntityId !== "string" || !isObject(parsed.acknowledgment)) {
      return { raw: text ?? "" };
    }
    return parsed as unknown as FundMoveAuditPayloadV2["details"];
  }
  return parsed as unknown as FundMoveAuditPayloadV1["details"];
}

/** Parse a `before` column. Never throws. */
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
  if (action === TRANSACTION_DELETED_AUDIT_ACTION) {
    const parsed = parseVersioned(text, DELETED_VERSIONS);
    if (isRawAudit(parsed)) return parsed;
    if (!Array.isArray(parsed.rows)) return { raw: text ?? "" };
    return parsed as unknown as TransactionDeletedAuditPayload["before"];
  }
  return parseMovedSide(text, false) as FundMoveAuditPayload["before"] | RawAudit;
}

/** Parse the `after` column of a moved row. Never throws. */
export function parseAuditAfter(
  text: string | null | undefined,
): FundMoveAuditPayload["after"] | RawAudit {
  return parseMovedSide(text, true) as FundMoveAuditPayload["after"] | RawAudit;
}

/** Shared `before`/`after` guard for the moved action, keyed on version. */
function parseMovedSide(
  text: string | null | undefined,
  isAfter: boolean,
): FundMoveAuditPayload["before"] | FundMoveAuditPayload["after"] | RawAudit {
  const parsed = parseVersioned(text, MOVED_VERSIONS);
  if (isRawAudit(parsed)) return parsed;
  if (!isObject(parsed.fund)) return { raw: text ?? "" };
  if (parsed.v === 2) {
    if (!isObject(parsed.entity)) return { raw: text ?? "" };
    if (isAfter && !isObject(parsed.bankAccount)) return { raw: text ?? "" };
    return parsed as unknown as FundMoveAuditPayloadV2["before"] | FundMoveAuditPayloadV2["after"];
  }
  return parsed as unknown as FundMoveAuditPayloadV1["before"] | FundMoveAuditPayloadV1["after"];
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
  /** True for a v2 (cross-entity) move; false for v1 moves, deletes and unparseable rows. */
  crossEntity: boolean;
  /** Entity display names from the self-describing v2 payload; null otherwise. */
  fromEntityName: string | null;
  toEntityName: string | null;
  /** Bank account names from the v2 payload; null otherwise. */
  fromBankAccount: string | null;
  toBankAccount: string | null;
  /** v2 only: a receipt was sent and kept with the moved row. */
  receiptSent: boolean;
}
