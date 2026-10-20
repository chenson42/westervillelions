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
import { sweepBatchNextStep, sweepBatchState } from "@/lib/ledger-sweep";

export type TransactionLockKind =
  | "paid_reimbursement"
  | "approved"
  | "rejected"
  | "pending"
  | "dues_synced"
  | "sweep_batch"
  | "swept_copy"
  | "swept_source"
  | "transfer_leg"
  | "reconciled_session"
  | "reconciled_legacy";

/**
 * The three kinds an itemized sweep (B-172 Increment 2a) adds: the batch's
 * expense leg, a Foundation copy, and a Club source gift that a live copy
 * claims. Derived from the pointer columns plus a server-loaded `SweepRole`;
 * never client input.
 */
export type SweepLockKind = "sweep_batch" | "swept_copy" | "swept_source";

/**
 * What the database says about a row's place in a sweep batch, loaded by
 * `loadSweepRole()` in ledger-sweep-link.ts. `hasLiveCopy`: a non-rejected copy
 * points at this row (a source that is currently claimed); `hasAnyCopy`
 * includes rejected copies (they keep the row undeletable: `sweep_history`).
 */
export interface SweepRole {
  isLeg: boolean;
  hasLiveCopy: boolean;
  hasAnyCopy: boolean;
}

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
  /** The copy's pointer to its leg (a column; present on a full row). */
  sweepLegTxnId?: string | null;
  /** Server-derived (ledger-sweep-link.ts loadSweepRole): leg / claimed source. */
  sweepRole?: SweepRole | null;
};

/**
 * Pure: the sweep lock kind of a row, or null. A copy is recognised by its
 * `sweepLegTxnId` column, the leg and the source by the server-loaded role.
 * Order: copy, leg, source (a row is only ever one of them).
 */
export function sweepLockKind(
  row: Pick<LockableRow, "sweepLegTxnId" | "sweepRole">,
): SweepLockKind | null {
  if (row.sweepLegTxnId) return "swept_copy";
  if (row.sweepRole?.isLeg) return "sweep_batch";
  if (row.sweepRole?.hasLiveCopy) return "swept_source";
  return null;
}

/** The only body keys PATCH accepts on a swept copy. */
export const SWEPT_COPY_EDITABLE_KEYS: readonly string[] = ["donorId", "memo"];

/**
 * Whether a PATCH body (its keys) may proceed on a row of this sweep lock kind.
 * No sweep lock: always. A copy: only donor and memo (everything that moves
 * money, dates or classification stays frozen). The leg and a claimed source:
 * nothing, donorId included. An empty key list passes for a copy so the
 * route's own "nothing to update" validation answers.
 */
export function sweepEditAllowance(
  kind: SweepLockKind | null,
  bodyKeys: readonly string[],
): boolean {
  if (kind === null) return true;
  if (kind !== "swept_copy") return false;
  return bodyKeys.every((k) => SWEPT_COPY_EDITABLE_KEYS.includes(k));
}

/**
 * The refusal a route answers (403, `code` = the lock kind) for an edit, delete
 * or split of a row with a sweep lock. Static strings with no fund name (the
 * fund-name scan bans them in ledger code); the UI branches on `code`.
 */
export function sweepRefusal(
  kind: SweepLockKind,
  action: "edit" | "delete" | "split",
  /** The leg's own row (B3): the `sweep_batch` message follows the batch's state. */
  batch?: { status: string; approvedAt: Date | string | null },
): { error: string; code: SweepLockKind } {
  const verb = action === "edit" ? "edited" : action === "delete" ? "deleted" : "split";
  switch (kind) {
    case "sweep_batch":
      return {
        code: kind,
        error: batch
          ? `The transfer entry of a sweep batch cannot be ${verb}. ${sweepBatchNextStep(sweepBatchState(batch))}`
          : `The transfer entry of a sweep batch cannot be ${verb}. Reject the batch while it is pending, or void it before it is approved.`,
      };
    case "swept_copy":
      return {
        code: kind,
        error:
          action === "edit"
            ? "Only the donor and the memo can be changed on a swept gift. To undo the sweep, void the whole batch."
            : `A swept gift cannot be ${verb}. To undo the sweep, void the whole batch.`,
      };
    case "swept_source":
      return {
        code: kind,
        error: `This gift was swept to the Foundation and cannot be ${verb}. Void the sweep batch first.`,
      };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

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
  const sweep = sweepLockKind(row);
  if (sweep) kinds.push(sweep);
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
  row: Pick<
    LockableRow,
    "approvedAt" | "status" | "duesPaymentId" | "transferGroupId" | "sweepLegTxnId"
  >,
): "approved" | "rejected" | "pending" | "dues_synced" | "swept_copy" | "transfer_leg" | null {
  if (row.approvedAt) return "approved";
  if (row.status === "rejected") return "rejected";
  if (row.status === "pending") return "pending";
  if (row.duesPaymentId) return "dues_synced";
  // A pure column test (A6): a copy never moves. There is deliberately NO
  // swept_source branch: checkFundMove() allows no move out of a Club
  // 'activity' fund, and a policy test pins that, so a future cell fails there.
  if (row.sweepLegTxnId) return "swept_copy";
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
  sweep_batch: {
    label: "Sweep batch",
    nextStep:
      "The batch can't be edited or deleted. Reject it while it is pending, or void it (manager) before it is approved.",
  },
  swept_copy: {
    label: "Swept gift",
    nextStep:
      "Only the donor and the memo can change on a swept gift. To undo the sweep, void the whole batch.",
  },
  swept_source: {
    label: "Swept",
    nextStep:
      "This gift was swept to the Foundation. Change the Foundation's copy instead (donor and memo only), or void the batch.",
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
