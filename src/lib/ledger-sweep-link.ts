/**
 * The ONE home of the itemized-sweep link predicates (B-172 Increment 2a,
 * DECISION-126), in the shape of ledger-reimbursement-link.ts: fragments only,
 * no business rules.
 *
 * An itemized sweep has no batch table. Its LEG is a Club expense row and its
 * id is the batch id; each Foundation income COPY carries two write-once
 * pointers, `swept_from_txn_id` (its source gift) and `sweep_leg_txn_id` (its
 * leg). Every question of the form "is this row a copy / a leg / a claimed
 * source / a source whose receipt already went out" is answered here and
 * nowhere else; a source scan (ledger-sweep-link.test.ts) fails any other
 * spelling of the pointer-null tests in non-test `src`.
 *
 * Server-only (imports the schema). Imports neither ./ledger-audit nor
 * ./ledger-correction (member-surface firewall, same as the reimbursement link).
 */

import { and, eq, inArray, isNotNull, isNull, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { db } from "@/lib/db";
import { ledgerAcknowledgments, ledgerTransactions } from "@/lib/db/schema";
import { sweepBatchState, type SweepRowBadge } from "@/lib/ledger-sweep";
import type { SweepRole } from "@/lib/ledger-transaction-lock";

/** `db` or a transaction handle. */
export type SweepLinkExec = Pick<typeof db, "select">;

/**
 * The text of the "live copy" half of `ux_ledger_txn_swept_from_live`: a copy
 * that has not been rejected. It must stay character-for-character the same as
 * the migration (0116) and `schema.ts`; ledger-sweep-link.test.ts compares all
 * three. A rejected copy keeps its pointers as history and frees its source.
 */
export const LIVE_COPY_PREDICATE = "status <> 'rejected'";

/** True for a Foundation copy: it points at its source gift. */
export function sweepCopyPredicate(t: typeof ledgerTransactions = ledgerTransactions): SQL {
  return sql`(${isNotNull(t.sweptFromTxnId)})`;
}

/** True for every row that is NOT a sweep copy (no pointer to a leg). */
export function notSweepCopy(t: typeof ledgerTransactions = ledgerTransactions): SQL {
  return sql`(${isNull(t.sweepLegTxnId)})`;
}

/**
 * SQL fragment: a LIVE (non-rejected) copy currently claims the row `txnId`
 * (the row's `id` column, or an expression). True for a swept source gift.
 */
export function sweptSourceExists(txnId: AnyColumn | SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM ${ledgerTransactions} AS sw_c WHERE sw_c.swept_from_txn_id = ${txnId} AND sw_c.${sql.raw(LIVE_COPY_PREDICATE)})`;
}

/** SQL fragment: some copy (live or rejected) points at `txnId` as its leg. */
export function sweepLegExists(txnId: AnyColumn | SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM ${ledgerTransactions} AS sw_l WHERE sw_l.sweep_leg_txn_id = ${txnId})`;
}

/**
 * SQL fragment, asked of a COPY row `txnId`: an acknowledgment that was already
 * SENT sits on that copy's SOURCE gift (a gift acknowledged before it was moved
 * or swept keeps its receipt on the source row id, DECISION-112), so the
 * Foundation copy must not be queued for, or issued, a second receipt.
 */
export function sweptSourceHasSentReceipt(txnId: AnyColumn | SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM ${ledgerTransactions} AS sw_s JOIN ${ledgerAcknowledgments} AS sw_a ON sw_a.donation_txn_id = sw_s.swept_from_txn_id WHERE sw_s.id = ${txnId} AND sw_a.sent_at IS NOT NULL)`;
}

/**
 * SQL scalar subselect: the id of the row decided together with an expense row,
 * its "partner", given the OUTER row's qualified id and transfer-group
 * expressions (callers qualify them by hand; see the resolver's comment in
 * ledger-approval-queries.ts). A Transfer/Sweep pair's partner is its income
 * leg; an itemized sweep batch's partner is one of its copies (all copies sit
 * in the same Foundation fund and entity). NULL when the row has neither.
 * Scalar subselects, never a join: a join fans out one row per copy and would
 * break a LIMIT.
 */
export function decisionPartnerRowId(outerId: SQL, outerGroup: SQL): SQL {
  return sql`COALESCE((SELECT d.id FROM ${ledgerTransactions} AS d WHERE d.transfer_group_id = ${outerGroup} AND d.flow = 'income' LIMIT 1), (SELECT c.id FROM ${ledgerTransactions} AS c WHERE c.sweep_leg_txn_id = ${outerId} ORDER BY c.id LIMIT 1))`;
}

/** SQL scalar subselect: how many copies point at the row `outerId` as their leg. */
export function sweepCopyCount(outerId: SQL): SQL {
  return sql`(SELECT count(*)::int FROM ${ledgerTransactions} AS b WHERE b.sweep_leg_txn_id = ${outerId})`;
}

/**
 * The date the receipt for a copy's source went out, or null when none did.
 * The acknowledge route names it in its 409.
 */
export async function getSweptSourceReceiptSentAt(
  exec: SweepLinkExec,
  copyTxnId: string,
): Promise<Date | null> {
  const rows = await exec
    .select({ sentAt: ledgerAcknowledgments.sentAt })
    .from(ledgerTransactions)
    .innerJoin(
      ledgerAcknowledgments,
      eq(ledgerAcknowledgments.donationTxnId, ledgerTransactions.sweptFromTxnId),
    )
    .where(and(eq(ledgerTransactions.id, copyTxnId), isNotNull(ledgerAcknowledgments.sentAt)))
    .limit(1);
  return rows[0]?.sentAt ?? null;
}

/**
 * The sweep role of each given row id: a leg (some copy points at it), a
 * source with a live copy, a source with any copy. ONE query over the pointer
 * columns, folded in memory. An id with no sweep relation maps to all-false.
 */
export async function listSweepRoles(
  exec: SweepLinkExec,
  ids: readonly string[],
): Promise<Map<string, SweepRole>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, SweepRole>();
  for (const id of unique) out.set(id, { isLeg: false, hasLiveCopy: false, hasAnyCopy: false });
  if (unique.length === 0) return out;

  const rows = await exec
    .select({
      legId: ledgerTransactions.sweepLegTxnId,
      sourceId: ledgerTransactions.sweptFromTxnId,
      status: ledgerTransactions.status,
    })
    .from(ledgerTransactions)
    .where(
      or(
        inArray(ledgerTransactions.sweepLegTxnId, unique),
        inArray(ledgerTransactions.sweptFromTxnId, unique),
      ),
    );
  for (const r of rows) {
    if (r.legId) {
      const role = out.get(r.legId);
      if (role) role.isLeg = true;
    }
    if (r.sourceId) {
      const role = out.get(r.sourceId);
      if (role) {
        role.hasAnyCopy = true;
        if (r.status !== "rejected") role.hasLiveCopy = true;
      }
    }
  }
  return out;
}

/** The sweep role of one row (see listSweepRoles). */
export async function loadSweepRole(
  exec: SweepLinkExec,
  row: { id: string },
): Promise<SweepRole> {
  const roles = await listSweepRoles(exec, [row.id]);
  return roles.get(row.id) ?? { isLeg: false, hasLiveCopy: false, hasAnyCopy: false };
}

/**
 * The register chip of each given row (B11): TWO selects for any number of ids.
 * A leg gets `batch` (count of its copies), a copy gets `copy`, a source with a
 * LIVE copy gets `source`; a source whose only copies were rejected is freed and
 * gets no badge, and a plain row gets none. The batch state comes from the leg row.
 */
export async function listSweepBadges(
  exec: SweepLinkExec,
  ids: readonly string[],
): Promise<Map<string, SweepRowBadge>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, SweepRowBadge>();
  if (unique.length === 0) return out;
  const wanted = new Set(unique);

  const rows = await exec
    .select({
      id: ledgerTransactions.id,
      legId: ledgerTransactions.sweepLegTxnId,
      sourceId: ledgerTransactions.sweptFromTxnId,
      status: ledgerTransactions.status,
    })
    .from(ledgerTransactions)
    .where(
      or(
        inArray(ledgerTransactions.sweepLegTxnId, unique),
        inArray(ledgerTransactions.sweptFromTxnId, unique),
        and(inArray(ledgerTransactions.id, unique), isNotNull(ledgerTransactions.sweepLegTxnId)),
      ),
    );

  const legCounts = new Map<string, number>();
  const copyLeg = new Map<string, string>();
  const sourceLeg = new Map<string, string>();
  for (const r of rows) {
    if (r.legId && wanted.has(r.legId)) legCounts.set(r.legId, (legCounts.get(r.legId) ?? 0) + 1);
    if (r.legId && wanted.has(r.id)) copyLeg.set(r.id, r.legId);
    if (r.sourceId && r.legId && wanted.has(r.sourceId) && r.status !== "rejected") {
      sourceLeg.set(r.sourceId, r.legId);
    }
  }

  const legIds = [...new Set([...legCounts.keys(), ...copyLeg.values(), ...sourceLeg.values()])];
  if (legIds.length === 0) return out;
  const legRows = await exec
    .select({
      id: ledgerTransactions.id,
      txnDate: ledgerTransactions.txnDate,
      status: ledgerTransactions.status,
      approvedAt: ledgerTransactions.approvedAt,
    })
    .from(ledgerTransactions)
    .where(inArray(ledgerTransactions.id, legIds));
  const legs = new Map(legRows.map((l) => [l.id, l]));

  for (const [legId, count] of legCounts) {
    const leg = legs.get(legId);
    if (leg) {
      out.set(legId, { kind: "batch", legId, sweepDate: leg.txnDate, state: sweepBatchState(leg), count });
    }
  }
  for (const [id, legId] of copyLeg) {
    const leg = legs.get(legId);
    if (leg) out.set(id, { kind: "copy", legId, sweepDate: leg.txnDate, state: sweepBatchState(leg) });
  }
  for (const [id, legId] of sourceLeg) {
    const leg = legs.get(legId);
    if (leg) out.set(id, { kind: "source", legId, sweepDate: leg.txnDate, state: sweepBatchState(leg) });
  }
  return out;
}
