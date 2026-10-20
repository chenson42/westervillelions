/**
 * The ONE definition of "a board decision" on a ledger expense row
 * (DECISION-116 item 1; docs/work-log/2026-10-10-approvals-mobile-and-history.md,
 * Phase 3 addendum A3).
 *
 * A board-approved row is a posted expense carrying an `approved_at` stamp and a
 * board minute that is NOT reimbursement-derived (a treasurer paying a member's
 * reimbursement also stamps the row, but that is not a board decision). A
 * board-decided row is that, or a rejected expense.
 *
 * Keyed on `approved_at`, never on the approver id: the approver column is
 * ON DELETE SET NULL, so a deleted approver account must not erase a genuine
 * decision. An under-threshold Sweep carries a creation-time minute and no
 * `approved_at`, so it is correctly excluded.
 *
 * Both exports are built from the single private postedBoardHalf(), so the
 * stamp test lives in one place. No runtime `db` import (the executor type in
 * lockDecisionGroup() is `import type`): importable from anywhere server-side.
 */

import { and, asc, eq, isNotNull, or, sql, type SQL } from "drizzle-orm";
import type { db } from "@/lib/db";
import { ledgerTransactions, type LedgerTransaction } from "@/lib/db/schema";
import { paidReimbursementExists } from "@/lib/ledger-reimbursement-link";

function postedBoardHalf(t: typeof ledgerTransactions): SQL {
  return sql`(${and(
    eq(t.status, "posted"),
    isNotNull(t.approvedAt),
    isNotNull(t.boardMinute),
    sql`NOT ${paidReimbursementExists(t.id)}`,
  )})`;
}

/** Expense rows a board member approved (posted half only). */
export function boardApprovalPredicate(t: typeof ledgerTransactions = ledgerTransactions): SQL {
  return sql`(${and(eq(t.flow, "expense"), postedBoardHalf(t))})`;
}

/** Expense rows a board member approved OR rejected. */
export function boardDecisionPredicate(t: typeof ledgerTransactions = ledgerTransactions): SQL {
  return sql`(${and(eq(t.flow, "expense"), or(eq(t.status, "rejected"), postedBoardHalf(t)))})`;
}

export type GroupLockMode = "update" | "share";

/** `db` or a transaction handle; a type-only import keeps this file db-free at runtime (T10). */
type LockExecutor = Pick<typeof db, "select">;

/**
 * Locks a decision target and everything that is decided with it in ONE
 * statement, `ORDER BY id` so two concurrent group operations cannot deadlock:
 *   - a Transfer/Sweep pair: the target and its partner (same transfer group);
 *   - an itemized sweep batch (B-172 Increment 2a): the leg and every copy that
 *     points at it through `sweep_leg_txn_id`;
 *   - anything else: just the target (the group subselect is NULL and
 *     `transfer_group_id = NULL` matches nothing).
 * Called with a COPY id it returns only that copy; classifyDecisionGroup()
 * then reports `target_is_copy`.
 *
 * This is the one lock helper (formerly lockDecisionPair, extracted from
 * decideTransaction() when cosignTransaction() became the second caller; void
 * of a sweep batch is the third). "update" (approve / reject / void) conflicts
 * with every other lock; "share" (co-sign) conflicts with writers but not with
 * other co-signers.
 */
export async function lockDecisionGroup(
  tx: LockExecutor,
  id: string,
  mode: GroupLockMode,
): Promise<LedgerTransaction[]> {
  const query = tx
    .select()
    .from(ledgerTransactions)
    .where(
      or(
        eq(ledgerTransactions.id, id),
        eq(
          ledgerTransactions.transferGroupId,
          sql`(select transfer_group_id from ledger_transactions where id = ${id})`,
        ),
        eq(ledgerTransactions.sweepLegTxnId, id),
      ),
    )
    .orderBy(asc(ledgerTransactions.id));
  return mode === "update" ? query.for("update") : query.for("share");
}
