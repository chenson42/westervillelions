/** B-172 Increment 2b, B12: grouping the match picker's candidates by sweep batch. */
import { describe, expect, it } from "vitest";
import { groupSweepCandidates } from "./reconciliation-sweep-groups";

const LEG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const row = (id: string, txnDate: string, amountCents: number, sweepLegTxnId: string | null) => ({
  id,
  txnDate,
  amountCents,
  sweepLegTxnId,
});

describe("groupSweepCandidates", () => {
  it("returns nothing when no candidate is a sweep copy (non-sweep candidates are unchanged)", () => {
    expect(groupSweepCandidates([row("1", "2026-09-01", 100, null), row("2", "2026-09-02", 200, null)])).toEqual([]);
    expect(groupSweepCandidates([])).toEqual([]);
  });

  it("groups by leg and computes the header from the candidates it was given, with the gift-date span and no 'of M'", () => {
    const [g] = groupSweepCandidates([
      row("c3", "2026-09-28", 6000, LEG_A),
      row("c1", "2026-09-02", 10000, LEG_A),
      row("c2", "2026-09-15", 15000, LEG_A),
      row("x", "2026-09-10", 999, null),
    ]);
    expect(g.legId).toBe(LEG_A);
    expect(g.count).toBe(3);
    expect(g.totalCents).toBe(31000);
    expect(g.ids).toEqual(["c1", "c2", "c3"]);
    expect(g.header).toBe("Sweep of 3 gifts, $310.00, gifts dated Sep 2, 2026 to Sep 28, 2026");
    expect(g.header).not.toMatch(/\bof \d+ (available|total)|N of M/);
  });

  it("a group's ids are exactly the listed members, so a partial group selects only those (the sum gate then refuses it)", () => {
    // Two of a batch's three copies were matched elsewhere: only one is a candidate.
    const [g] = groupSweepCandidates([row("c1", "2026-09-02", 10000, LEG_A)]);
    expect(g.ids).toEqual(["c1"]);
    expect(g.header).toBe("Sweep of 1 gift, $100.00, gift dated Sep 2, 2026");
  });

  it("keeps two batches apart", () => {
    const groups = groupSweepCandidates([
      row("b1", "2026-10-01", 500, LEG_B),
      row("a1", "2026-09-01", 100, LEG_A),
      row("a2", "2026-09-01", 100, LEG_A),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.legId === LEG_A)!.ids).toEqual(["a1", "a2"]);
    expect(groups.find((g) => g.legId === LEG_B)!.ids).toEqual(["b1"]);
  });
});
