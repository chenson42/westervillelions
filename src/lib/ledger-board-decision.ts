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
 * lockDecisionPair() is `import type`): importable from anywhere server-side.
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

export type PairLockMode = "update" | "share";

/** `db` or a transaction handle; a type-only import keeps this file db-free at runtime (T10). */
type LockExecutor = Pick<typeof db, "select">;

/**
 * Locks a decision target and its Transfer/Sweep partner in ONE statement,
 * `ORDER BY id` so two concurrent pair operations cannot deadlock. Extracted
 * verbatim from decideTransaction() when cosignTransaction() became the second
 * caller. For a non-pair row the subselect is NULL and `transfer_group_id =
 * NULL` matches nothing, so the set is just the target.
 *
 * "update" (approve / reject) conflicts with every other lock; "share"
 * (co-sign) conflicts with writers but not with other co-signers.
 */
export async function lockDecisionPair(
  tx: LockExecutor,
  id: string,
  mode: PairLockMode,
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
      ),
    )
    .orderBy(asc(ledgerTransactions.id));
  return mode === "update" ? query.for("update") : query.for("share");
}
