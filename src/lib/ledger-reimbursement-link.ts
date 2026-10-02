/**
 * The ONE definition of "reimbursement-derived" (B-108 / DECISION-114,
 * docs/work-log/2026-10-02-reimbursement-reconcilable.md): a ledger row is
 * reimbursement-derived when a PAID `ledger_reimbursements` row links to it via
 * `ledger_transaction_id` (written in the same transaction as the insert by the
 * pay route). Derived, never marked: no column, and the client never supplies
 * the fact. B-85 is narrowed by this, not closed; B-129 would make the join
 * provably 1:1 (the FK has no unique index today, so callers handle several).
 *
 * Server-only (imports the schema). Imports neither ./ledger-audit nor
 * ./ledger-correction: the duplicate-candidate finder uses it and must not pull
 * the audit modules (member-surface firewall).
 */

import { and, eq, inArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { db } from "@/lib/db";
import { ledgerReimbursements } from "@/lib/db/schema";

/** `db` or a transaction handle. */
export type LinkExec = Pick<typeof db, "select">;

/**
 * SQL fragment: a PAID reimbursement links to the ledger row `txnId` (the row's
 * `id` column, or an expression). Used by the correct route's eligibility, the
 * duplicate-candidate finder and anything else that needs the fact.
 */
export function paidReimbursementExists(txnId: AnyColumn | SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM ${ledgerReimbursements} WHERE ${ledgerReimbursements.ledgerTransactionId} = ${txnId} AND ${ledgerReimbursements.status} = 'paid')`;
}

/**
 * Of the given ledger row ids, the ones a PAID reimbursement links to. One
 * query for the register page (over only the page's approved expense rows).
 */
export async function listPaidReimbursementTransactionIds(
  exec: LinkExec,
  txnIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(txnIds)];
  if (ids.length === 0) return new Set();
  const rows = await exec
    .select({ id: ledgerReimbursements.ledgerTransactionId })
    .from(ledgerReimbursements)
    .where(
      and(
        inArray(ledgerReimbursements.ledgerTransactionId, ids),
        eq(ledgerReimbursements.status, "paid"),
      ),
    );
  const out = new Set<string>();
  for (const r of rows) if (r.id) out.add(r.id);
  return out;
}

export interface LinkedPaidReimbursement {
  id: string;
  submittedByUserId: string | null;
  submittedByMemberId: string | null;
}

/**
 * Every PAID reimbursement linked to one ledger row (normally one; at most 5
 * are read). Read on the handle it is given: the correct route passes its
 * transaction handle, after the row lock, for the self-action check.
 */
export async function loadPaidReimbursementsForTransaction(
  exec: LinkExec,
  txnId: string,
): Promise<LinkedPaidReimbursement[]> {
  const rows = await exec
    .select({
      id: ledgerReimbursements.id,
      submittedByUserId: ledgerReimbursements.submittedByUserId,
      submittedByMemberId: ledgerReimbursements.submittedByMemberId,
    })
    .from(ledgerReimbursements)
    .where(
      and(eq(ledgerReimbursements.ledgerTransactionId, txnId), eq(ledgerReimbursements.status, "paid")),
    )
    .limit(5);
  return rows;
}
