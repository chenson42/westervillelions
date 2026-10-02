/**
 * Pure lock classifier for ledger transactions (DECISION-109/111,
 * docs/work-log/2026-10-01-move-or-cancel-transaction.md).
 *
 * Client-safe: no DB, no Next imports. It is the single source for the move
 * route's state block, the register's up-front lock labels and the reconcile
 * toggle's disabled state. The server is always the authority; the UI uses
 * this only to explain.
 */

import type { LedgerTransaction } from "@/lib/db/schema";
import { getFiscalYear, currentFiscalYear } from "@/lib/fiscal-year";

export type TransactionLockKind =
  | "paid_reimbursement"
  | "approved"
  | "rejected"
  | "pending"
  | "dues_synced"
  | "transfer_leg"
  | "reconciled_session"
  | "reconciled_legacy";

export type LockableRow = Pick<
  LedgerTransaction,
  | "approvedAt"
  | "status"
  | "duesPaymentId"
  | "transferGroupId"
  | "reconciled"
  | "reconciledSessionId"
  | "txnDate"
> & {
  /**
   * Server-derived (ledger-reimbursement-link.ts): a PAID reimbursement links
   * to this row. Never client input. Optional so existing callers and fixtures
   * are unchanged; only the register supplies it (B-108 / DECISION-114).
   */
  paidReimbursement?: boolean;
};

/**
 * Every lock kind that applies, in precedence order (paid_reimbursement and
 * approved first; a paid reimbursement is always also approved, so both are
 * listed and the first is the classification).
 */
export function transactionLockKinds(row: LockableRow): TransactionLockKind[] {
  const kinds: TransactionLockKind[] = [];
  if (row.approvedAt && row.paidReimbursement) kinds.push("paid_reimbursement");
  if (row.approvedAt) kinds.push("approved");
  if (row.status === "rejected") kinds.push("rejected");
  if (row.status === "pending") kinds.push("pending");
  if (row.duesPaymentId) kinds.push("dues_synced");
  if (row.transferGroupId) kinds.push("transfer_leg");
  if (row.reconciledSessionId) kinds.push("reconciled_session");
  else if (row.reconciled) kinds.push("reconciled_legacy");
  return kinds;
}

/** The first (highest-precedence) lock kind, or null for an unlocked row. */
export function classifyTransactionLock(row: LockableRow): TransactionLockKind | null {
  return transactionLockKinds(row)[0] ?? null;
}

/** Reconciled by either mark: the legacy per-row toggle or a closed session. */
export function isTransactionReconciled(
  row: Pick<LockableRow, "reconciled" | "reconciledSessionId">,
): boolean {
  return row.reconciled === true || row.reconciledSessionId != null;
}

/**
 * What PATCH / DELETE refuse today (approved, rejected, closed-session).
 * Mirrors the inline guards in those handlers, which stay inline (migrating
 * them onto this classifier is B-94b); a test pins this against the guard
 * table so the two cannot drift silently. Legacy-reconciled, pending,
 * transfer legs and dues-synced rows are NOT edit-locked.
 */
export function editLockKind(
  row: Pick<LockableRow, "approvedAt" | "status" | "reconciledSessionId">,
): "approved" | "rejected" | "reconciled_session" | null {
  if (row.approvedAt) return "approved";
  if (row.status === "rejected") return "rejected";
  if (row.reconciledSessionId) return "reconciled_session";
  return null;
}

/**
 * The lock kind to DISPLAY for an edit-locked row: `editLockKind` (which mirrors
 * the PATCH guards and is deliberately unchanged) with "approved" shown as
 * "paid_reimbursement" when a paid reimbursement links to the row.
 */
export function editLockDisplayKind(
  row: Pick<LockableRow, "approvedAt" | "status" | "reconciledSessionId" | "paidReimbursement">,
): "paid_reimbursement" | "approved" | "rejected" | "reconciled_session" | null {
  const kind = editLockKind(row);
  if (kind === "approved" && row.paidReimbursement) return "paid_reimbursement";
  return kind;
}

/** Why a row cannot be moved to another fund (reconciliation is a tier, not a block). */
export function moveBlockKind(
  row: Pick<LockableRow, "approvedAt" | "status" | "duesPaymentId" | "transferGroupId">,
): "approved" | "rejected" | "pending" | "dues_synced" | "transfer_leg" | null {
  if (row.approvedAt) return "approved";
  if (row.status === "rejected") return "rejected";
  if (row.status === "pending") return "pending";
  if (row.duesPaymentId) return "dues_synced";
  if (row.transferGroupId) return "transfer_leg";
  return null;
}

export type MoveTierReason = "reconciled" | "prior_fiscal_year" | "cross_entity";

/**
 * Permission tier for a move. `manage` (LEDGER_MANAGE) when the row is
 * reconciled by either mark, dated before the current fiscal year, or the
 * move crosses entities (DECISION-112: every cross-entity move changes two
 * entities' totals and two bank accounts' book balances); otherwise `record`
 * (LEDGER_RECORD). Computed from the row and the destination, never from the
 * client. `cross_entity` is listed first when present.
 */
export function requiredMoveTier(
  row: Pick<LockableRow, "reconciled" | "reconciledSessionId" | "txnDate">,
  now: Date,
  opts: { crossEntity?: boolean } = {},
): { tier: "record" | "manage"; reasons: MoveTierReason[] } {
  const reasons: MoveTierReason[] = [];
  if (opts.crossEntity) reasons.push("cross_entity");
  if (isTransactionReconciled(row)) reasons.push("reconciled");
  if (getFiscalYear(new Date(row.txnDate + "T00:00:00")) < currentFiscalYear(now)) {
    reasons.push("prior_fiscal_year");
  }
  return { tier: reasons.length > 0 ? "manage" : "record", reasons };
}

/**
 * Why a CROSS-ENTITY move is refused on row state (DECISION-112: no reconciled
 * carve-out, because a cross-entity move changes `bank_account_id`, the column
 * reconciliation is keyed on). The code names reuse the lock kind names so the
 * classifier, LOCK_COPY and the codes cannot diverge.
 */
export type CrossEntityStateBlock =
  | "prior_fiscal_year_cross_entity"
  | "reconciled_session"
  | "reconciled_legacy"
  | "matched_open_session";

/**
 * The PURE part of the cross-entity state block, in the X2 order: refuse the
 * impossible first (a prior-year row can never succeed, so listing "reconciled"
 * first would send the treasurer through a reopen and an unmatch only to hit a
 * dead end), then a closed session, then the legacy mark. `matched_open_session`
 * needs the database and is evaluated by the query layer after this.
 */
export function crossEntityBlockKind(
  row: Pick<LockableRow, "reconciled" | "reconciledSessionId" | "txnDate">,
  now: Date,
): Exclude<CrossEntityStateBlock, "matched_open_session"> | null {
  if (getFiscalYear(new Date(row.txnDate + "T00:00:00")) < currentFiscalYear(now)) {
    return "prior_fiscal_year_cross_entity";
  }
  if (row.reconciledSessionId) return "reconciled_session";
  if (row.reconciled) return "reconciled_legacy";
  return null;
}

/** The one string the reconcile route and the register share. */
export const CLOSED_SESSION_LOCK_MESSAGE =
  "This transaction was cleared by a closed reconciliation session. Reopen the session to change its reconciled status.";

/**
 * Label (short, for the register) and next step (what to do instead) per lock
 * kind. An exhaustive Record: a new kind is a compile error.
 */
export const LOCK_COPY: Record<TransactionLockKind, { label: string; nextStep: string }> = {
  paid_reimbursement: {
    label: "Paid reimbursement",
    nextStep:
      "Paid reimbursements can't be edited or deleted. Use Correct to change the category, date, method, check number, description or bank account.",
  },
  approved: {
    label: "Approved",
    nextStep: "Approved transactions cannot be edited. Record a refund entry to correct one.",
  },
  rejected: {
    label: "Rejected",
    nextStep: "Rejected transactions are kept as a record. Enter a new transaction instead.",
  },
  pending: {
    label: "Awaiting approval",
    nextStep: "Reject the pending request and enter it again, or wait for the board's decision.",
  },
  dues_synced: {
    label: "Posted from dues",
    nextStep: "Change the dues payment instead; its ledger entry follows it.",
  },
  transfer_leg: {
    label: "Part of a transfer",
    nextStep: "Delete the transfer and record it again.",
  },
  reconciled_session: {
    label: "Reconciled",
    nextStep: "Reopen the reconciliation session that cleared it to change this entry.",
  },
  reconciled_legacy: {
    label: "Marked reconciled",
    nextStep: "Un-mark it as reconciled first if it needs to change.",
  },
};
