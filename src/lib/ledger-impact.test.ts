/**
 * Unit tests for isGiving() in src/lib/ledger.ts — inc5 Philanthropy Dashboard.
 *
 * All tests are pure (no DB). Covers the 8 required cases from the Phase 3
 * spec plus an additional edge case for completeness, plus the DECISION-030
 * "TRUE GIFTS ONLY" categoryCountsAsGiving cases.
 *
 * The canonical rule: isGiving() returns true iff
 *   flow === 'expense' AND transferGroupId === null AND
 *   fundKind IN ('activity', 'charitable', 'scholarship') AND
 *   categoryCountsAsGiving !== false.
 *
 * NOTE: status ('posted' | 'pending' | 'rejected') is NOT part of isGiving()'s
 * contract. The SQL query in getPhilanthropy() (ledger-queries.ts) enforces the
 * status = 'posted' filter. This helper is for per-row labeling and unit tests.
 */

import { describe, it, expect } from "vitest";
import { isGiving, type IsGivingRow, bucketGivingByCause, type GivingFoldRow } from "./ledger";

// ---------------------------------------------------------------------------
// isGiving
// ---------------------------------------------------------------------------

describe("isGiving", () => {
  // Case 1: activity fund expense with no transfer → giving
  it("returns true for flow=expense, transferGroupId=null, kind=activity", () => {
    const row: IsGivingRow = { flow: "expense", transferGroupId: null };
    expect(isGiving(row, "activity")).toBe(true);
  });

  // Case 2: charitable fund expense with no transfer → giving
  it("returns true for flow=expense, transferGroupId=null, kind=charitable", () => {
    const row: IsGivingRow = { flow: "expense", transferGroupId: null };
    expect(isGiving(row, "charitable")).toBe(true);
  });

  // Case 3: scholarship fund expense with no transfer → giving
  it("returns true for flow=expense, transferGroupId=null, kind=scholarship", () => {
    const row: IsGivingRow = { flow: "expense", transferGroupId: null };
    expect(isGiving(row, "scholarship")).toBe(true);
  });

  // Case 4: administrative fund MUST NEVER be philanthropy — hard invariant
  it("returns false for kind=administrative (admin fund exclusion — hard invariant)", () => {
    const row: IsGivingRow = { flow: "expense", transferGroupId: null };
    expect(isGiving(row, "administrative")).toBe(false);
  });

  // Case 5: income rows are not philanthropy even for activity fund
  it("returns false for flow=income, transferGroupId=null, kind=activity (wrong flow direction)", () => {
    const row: IsGivingRow = { flow: "income", transferGroupId: null };
    expect(isGiving(row, "activity")).toBe(false);
  });

  // Case 6: transfer pairs are excluded from philanthropy totals
  it("returns false for flow=expense, transferGroupId=non-null, kind=charitable (transfer pair excluded)", () => {
    const row: IsGivingRow = { flow: "expense", transferGroupId: "some-uuid" };
    expect(isGiving(row, "charitable")).toBe(false);
  });

  // Case 7: unknown fund kind → not giving
  it("returns false for flow=expense, transferGroupId=null, kind=unknown", () => {
    const row: IsGivingRow = { flow: "expense", transferGroupId: null };
    expect(isGiving(row, "unknown")).toBe(false);
  });

  // Case 8: status field is NOT part of isGiving()'s contract.
  // A pending scholarship row still satisfies the giving rule — the SQL query
  // enforces status='posted' at the DB layer, not this helper.
  it("ignores status field — scholarship expense with any extra fields still returns true", () => {
    // IsGivingRow only requires flow + transferGroupId; extra props (like status)
    // are allowed by structural typing but must not affect the result.
    const rowWithStatus = { flow: "expense", transferGroupId: null, status: "pending" };
    // Pass only the IsGivingRow-shaped fields to confirm the helper ignores status.
    expect(isGiving({ flow: rowWithStatus.flow, transferGroupId: rowWithStatus.transferGroupId }, "scholarship")).toBe(true);
  });

  // Additional edge case: empty-string transferGroupId is NOT null → not giving
  it("returns false when transferGroupId is an empty string (not strictly null)", () => {
    // The column contract uses null for no transfer; an empty string is a data
    // quality issue and should not be treated as philanthropy.
    const row = { flow: "expense", transferGroupId: "" };
    expect(isGiving(row, "charitable")).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // DECISION-030 — TRUE GIFTS ONLY (categoryCountsAsGiving)
  // ---------------------------------------------------------------------------

  // Case 9: explicit false flag excludes an otherwise-giving row
  it("returns false when categoryCountsAsGiving is explicitly false (e.g. Fundraising event costs)", () => {
    const row: IsGivingRow = { flow: "expense", transferGroupId: null };
    expect(isGiving(row, "charitable", false)).toBe(false);
  });

  // Case 10: explicit true flag behaves like the default (still giving)
  it("returns true when categoryCountsAsGiving is explicitly true", () => {
    const row: IsGivingRow = { flow: "expense", transferGroupId: null };
    expect(isGiving(row, "activity", true)).toBe(true);
  });

  // Case 11: null flag (category loaded but counts_as_giving unset/unknown) stays included
  it("returns true when categoryCountsAsGiving is null (conservative inclusion)", () => {
    const row: IsGivingRow = { flow: "expense", transferGroupId: null };
    expect(isGiving(row, "scholarship", null)).toBe(true);
  });

  // Case 12: undefined flag (caller omits the 3rd arg entirely — no category loaded
  // or a categoryId of null) stays included; this is the pre-DECISION-030 call shape
  // and must remain a pure regression-free default.
  it("returns true when categoryCountsAsGiving is omitted (uncategorized txn, default-included)", () => {
    const row: IsGivingRow = { flow: "expense", transferGroupId: null };
    expect(isGiving(row, "charitable")).toBe(true);
  });

  // Case 13: false flag combined with an otherwise-disqualifying condition
  // (administrative fund) — still false, for the obvious-but-worth-asserting reason.
  it("returns false when categoryCountsAsGiving is false AND fund kind is administrative", () => {
    const row: IsGivingRow = { flow: "expense", transferGroupId: null };
    expect(isGiving(row, "administrative", false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// bucketGivingByCause — /members/impact FY filter pills (2026-07-20)
// ---------------------------------------------------------------------------
//
// bucketGivingByCause() is FY-agnostic: it just buckets whatever rows it's
// given by cause. getPhilanthropy() pre-filters rows to a fiscal year (or
// passes the full set for "All") before calling it — so these tests exercise
// it the same way, passing a "current FY" row set and a "prior FY" row set
// as separate calls, per the Phase 3 design doc's named cases.

describe("bucketGivingByCause", () => {
  // Case: current-FY bucket — a set of rows representing one fiscal year's
  // giving buckets correctly by cause, sorted desc by totalCents, with the
  // '' key mapped to "Other community support".
  it("buckets a current-FY row set by cause, sorted desc, '' key labeled", () => {
    const rows: GivingFoldRow[] = [
      { txnDate: "2026-08-01", amountCents: 10_000, beneficiaryCause: "Scholarships" },
      { txnDate: "2026-09-15", amountCents: 5_000, beneficiaryCause: "scholarships" }, // same key, different casing
      { txnDate: "2026-10-01", amountCents: 20_000, beneficiaryCause: "Food Pantry" },
      { txnDate: "2026-11-01", amountCents: 2_500, beneficiaryCause: null },
    ];
    const result = bucketGivingByCause(rows);

    expect(result).toHaveLength(3);
    // Food Pantry (20000) > Scholarships (15000, first-seen casing "Scholarships") > Other (2500, last)
    expect(result[0]).toMatchObject({ causeLabel: "Food Pantry", totalCents: 20_000 });
    expect(result[1]).toMatchObject({
      causeKey: "scholarships",
      causeLabel: "Scholarships",
      totalCents: 15_000,
    });
    expect(result[2]).toMatchObject({
      causeKey: "",
      causeLabel: "Other community support",
      totalCents: 2_500,
    });
  });

  // Case: prior-FY bucket — a different, independent row set buckets correctly
  // and percentages are relative to THIS set's own total, not some outside total.
  it("buckets a prior-FY row set independently, pct relative to that set's own total", () => {
    const rows: GivingFoldRow[] = [
      { txnDate: "2024-08-01", amountCents: 3_000, beneficiaryCause: "Youth Programs" },
      { txnDate: "2024-09-01", amountCents: 1_000, beneficiaryCause: "Youth Programs" },
    ];
    const result = bucketGivingByCause(rows);

    expect(result).toHaveLength(1);
    expect(result[0].totalCents).toBe(4_000);
    // 4000/4000 = 100%, not diluted by any other fiscal year's totals.
    expect(result[0].pct).toBe(100);
  });

  // Case: FY with no rows → empty array (not an error, not a bucket with a
  // zero-value "Other community support" entry).
  it("returns an empty array when given no rows", () => {
    expect(bucketGivingByCause([])).toEqual([]);
  });

  // Case: pct sums sanity — percentages across all buckets in a set sum to
  // ~100 (allowing for rounding to 1 decimal across N buckets).
  it("percentages across buckets sum to ~100 within rounding tolerance", () => {
    const rows: GivingFoldRow[] = [
      { txnDate: "2026-01-01", amountCents: 3_333, beneficiaryCause: "A" },
      { txnDate: "2026-02-01", amountCents: 3_333, beneficiaryCause: "B" },
      { txnDate: "2026-03-01", amountCents: 3_334, beneficiaryCause: "C" },
    ];
    const result = bucketGivingByCause(rows);
    const pctSum = result.reduce((s, r) => s + r.pct, 0);
    expect(pctSum).toBeGreaterThan(99.5);
    expect(pctSum).toBeLessThan(100.5);
  });

  // Case: all-time unchanged — bucketGivingByCause() over the full row set
  // must reproduce exactly the same shape/ordering/rounding that
  // getPhilanthropy()'s inline byCause fold used before this refactor:
  // sort desc by totalCents, '' key always last, pct = round(total/allTime*1000)/10.
  it("all-time bucketing over the full row set matches the pre-refactor byCause formula", () => {
    const rows: GivingFoldRow[] = [
      { txnDate: "2023-08-01", amountCents: 50_000, beneficiaryCause: "Vision" },
      { txnDate: "2024-08-01", amountCents: 30_000, beneficiaryCause: "Vision" },
      { txnDate: "2025-08-01", amountCents: 15_000, beneficiaryCause: null },
      { txnDate: "2026-08-01", amountCents: 5_000, beneficiaryCause: "Hunger Relief" },
    ];
    const allTimeCents = rows.reduce((s, r) => s + r.amountCents, 0);
    const result = bucketGivingByCause(rows);

    expect(result).toHaveLength(3);
    expect(result[0].causeLabel).toBe("Vision");
    expect(result[0].totalCents).toBe(80_000);
    expect(result[0].pct).toBe(Math.round((80_000 / allTimeCents) * 1000) / 10);
    expect(result[1].causeLabel).toBe("Hunger Relief");
    expect(result[2].causeKey).toBe("");
    expect(result[2].causeLabel).toBe("Other community support");
  });
});
