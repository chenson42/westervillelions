/**
 * Live "recent giving" query behind the public impact band on /donate and
 * the homepage's one-line summary — Site Review Fixes Batch 5, 2026-09-04
 * (docs/work-log/2026-09-04-site-review-fixes.md).
 *
 * Deliberately a small, dedicated query rather than a call into
 * getPhilanthropy() (src/lib/ledger-queries.ts) — that function computes a
 * much larger member-portal dashboard payload (cause breakdowns, recent
 * named gifts, all fiscal years on file). This mirrors only its giving
 * WHERE clause, scoped to the two most recently completed fiscal years,
 * for a page that's ISR-cached and pays this query's cost rarely.
 */

import { db } from "@/lib/db";
import { ledgerTransactions, ledgerFunds, ledgerCategories } from "@/lib/db/schema";
import { and, eq, isNull, inArray, or, gte, lt } from "drizzle-orm";
import { getRecentCompletedFiscalYears } from "@/lib/impact-stats";

export type RecentGivingStats = {
  /** [older, newer] — the two fiscal years these totals cover. */
  fiscalYears: [number, number];
  totalCents: number;
  /** Count of qualifying posted transactions — the "grants" count. */
  grantCount: number;
};

/**
 * Sums posted, non-transfer expense transactions in giving-eligible funds
 * (activity/charitable/scholarship) whose category counts toward giving
 * (countsAsGiving true or unset), for the two most recently COMPLETED
 * fiscal years as of `now`. Mirrors getPhilanthropy()'s giving WHERE clause
 * (src/lib/ledger-queries.ts) — keep the two in sync if that clause changes.
 */
export async function getRecentGivingStats(now: Date = new Date()): Promise<RecentGivingStats> {
  const [olderFy, newerFy] = getRecentCompletedFiscalYears(now);
  // FY filter convention (ledger-queries.ts): txnDate >= fyStart AND
  // txnDate < nextFyStart (exclusive upper bound) — covers olderFy's Jul 1
  // through newerFy's following Jun 30 in one range.
  const rangeStart = `${olderFy}-07-01`;
  const rangeEnd = `${newerFy + 1}-07-01`;

  const rows = await db
    .select({ amountCents: ledgerTransactions.amountCents })
    .from(ledgerTransactions)
    .innerJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
    .leftJoin(ledgerCategories, eq(ledgerTransactions.categoryId, ledgerCategories.id))
    .where(
      and(
        eq(ledgerTransactions.status, "posted"),
        isNull(ledgerTransactions.transferGroupId),
        eq(ledgerTransactions.flow, "expense"),
        inArray(ledgerFunds.kind, ["activity", "charitable", "scholarship"]),
        or(isNull(ledgerCategories.countsAsGiving), eq(ledgerCategories.countsAsGiving, true)),
        gte(ledgerTransactions.txnDate, rangeStart),
        lt(ledgerTransactions.txnDate, rangeEnd),
      ),
    );

  const totalCents = rows.reduce((sum, r) => sum + r.amountCents, 0);
  return { fiscalYears: [olderFy, newerFy], totalCents, grantCount: rows.length };
}
