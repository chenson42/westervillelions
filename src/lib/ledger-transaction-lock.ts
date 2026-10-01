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
>;

/** Every lock kind that applies, in precedence order (approved first). */
export function transactionLockKinds(row: LockableRow): TransactionLockKind[] {
  const kinds: TransactionLockKind[] = [];
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

export type MoveTierReason = "reconciled" | "prior_fiscal_year";

/**
 * Permission tier for a move. `manage` (LEDGER_MANAGE) when the row is
 * reconciled by either mark or dated before the current fiscal year;
 * otherwise `record` (LEDGER_RECORD). Computed from the row, never from the
 * client.
 */
export function requiredMoveTier(
  row: Pick<LockableRow, "reconciled" | "reconciledSessionId" | "txnDate">,
  now: Date,
): { tier: "record" | "manage"; reasons: MoveTierReason[] } {
  const reasons: MoveTierReason[] = [];
  if (isTransactionReconciled(row)) reasons.push("reconciled");
  if (getFiscalYear(new Date(row.txnDate + "T00:00:00")) < currentFiscalYear(now)) {
    reasons.push("prior_fiscal_year");
  }
  return { tier: reasons.length > 0 ? "manage" : "record", reasons };
}

/** The one string the reconcile route and the register share. */
export const CLOSED_SESSION_LOCK_MESSAGE =
  "This transaction was cleared by a closed reconciliation session. Reopen the session to change its reconciled status.";

/**
 * Label (short, for the register) and next step (what to do instead) per lock
 * kind. An exhaustive Record: a new kind is a compile error.
 */
export const LOCK_COPY: Record<TransactionLockKind, { label: string; nextStep: string }> = {
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
