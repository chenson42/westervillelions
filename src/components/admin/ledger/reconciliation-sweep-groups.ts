/**
 * Group the match picker's candidates by the sweep batch they belong to
 * (B-172 Increment 2b, B12). Pure and client-safe. Everything shown is computed
 * from the candidates the picker was given: a batch's copies carry their GIFT
 * dates, so the header says "gifts dated A to B", never one date, and there is
 * deliberately no "of M" (it would need another column; the picker's running-sum
 * gate already refuses a partial group).
 */

import type { CandidateTransactionRow } from "@/lib/reconciliation-queries";
import { formatSweepDate, formatSweepMoney } from "./sweep-builder-logic";

export interface SweepCandidateGroup {
  legId: string;
  /** The ids of the group's candidates, in gift-date order. */
  ids: string[];
  count: number;
  totalCents: number;
  header: string;
}

type GroupableRow = Pick<CandidateTransactionRow, "id" | "txnDate" | "amountCents" | "sweepLegTxnId">;

export function groupSweepCandidates(rows: readonly GroupableRow[]): SweepCandidateGroup[] {
  const byLeg = new Map<string, GroupableRow[]>();
  for (const r of rows) {
    const leg = r.sweepLegTxnId;
    if (!leg) continue;
    byLeg.set(leg, [...(byLeg.get(leg) ?? []), r]);
  }
  return [...byLeg.entries()]
    .map(([legId, members]) => {
      const sorted = [...members].sort((a, b) => a.txnDate.localeCompare(b.txnDate) || a.id.localeCompare(b.id));
      const total = sorted.reduce((sum, r) => sum + r.amountCents, 0);
      const first = sorted[0].txnDate;
      const last = sorted[sorted.length - 1].txnDate;
      const span =
        first === last ? `gift dated ${formatSweepDate(first)}` : `gifts dated ${formatSweepDate(first)} to ${formatSweepDate(last)}`;
      return {
        legId,
        ids: sorted.map((r) => r.id),
        count: sorted.length,
        totalCents: total,
        header: `Sweep of ${sorted.length} ${sorted.length === 1 ? "gift" : "gifts"}, ${formatSweepMoney(total)}, ${span}`,
      };
    })
    .sort((a, b) => a.header.localeCompare(b.header));
}
