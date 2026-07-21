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
import { deriveCauseFyPills } from "./fiscal-year";

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
      { txnDate: "2026-08-01", amountCents: 10_000, beneficiaryCause: "Scholarships", id: "t1", party: "Acme Foundation" },
      { txnDate: "2026-09-15", amountCents: 5_000, beneficiaryCause: "scholarships", id: "t2", party: null }, // same key, different casing
      { txnDate: "2026-10-01", amountCents: 20_000, beneficiaryCause: "Food Pantry", id: "t3", party: "Westerville Food Pantry" },
      { txnDate: "2026-11-01", amountCents: 2_500, beneficiaryCause: null, id: "t4", party: null },
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
      { txnDate: "2024-08-01", amountCents: 3_000, beneficiaryCause: "Youth Programs", id: "p1", party: "Youth Center" },
      { txnDate: "2024-09-01", amountCents: 1_000, beneficiaryCause: "Youth Programs", id: "p2", party: null },
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
      { txnDate: "2026-01-01", amountCents: 3_333, beneficiaryCause: "A", id: "q1", party: null },
      { txnDate: "2026-02-01", amountCents: 3_333, beneficiaryCause: "B", id: "q2", party: null },
      { txnDate: "2026-03-01", amountCents: 3_334, beneficiaryCause: "C", id: "q3", party: null },
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
      { txnDate: "2023-08-01", amountCents: 50_000, beneficiaryCause: "Vision", id: "v1", party: "Vision Clinic" },
      { txnDate: "2024-08-01", amountCents: 30_000, beneficiaryCause: "Vision", id: "v2", party: null },
      { txnDate: "2025-08-01", amountCents: 15_000, beneficiaryCause: null, id: "v3", party: null },
      { txnDate: "2026-08-01", amountCents: 5_000, beneficiaryCause: "Hunger Relief", id: "v4", party: "Food Bank" },
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

  // ---------------------------------------------------------------------------
  // Impact Cause Drill-Down (2026-07-21) — CauseBucket.rows
  // ---------------------------------------------------------------------------

  // Named test 1: rows include id/party, sorted desc by txnDate within a bucket.
  it("includes id and party on each row, sorted desc by txnDate within a bucket", () => {
    const rows: GivingFoldRow[] = [
      { txnDate: "2026-01-10", amountCents: 1_000, beneficiaryCause: "Youth Programs", id: "a1", party: "Alpha" },
      { txnDate: "2026-03-05", amountCents: 2_000, beneficiaryCause: "Youth Programs", id: "a2", party: "Bravo" },
      { txnDate: "2026-02-20", amountCents: 3_000, beneficiaryCause: "Youth Programs", id: "a3", party: "Charlie" },
    ];
    const result = bucketGivingByCause(rows);

    expect(result).toHaveLength(1);
    expect(result[0].rows).toEqual([
      { id: "a2", txnDate: "2026-03-05", party: "Bravo", amountCents: 2_000 },
      { id: "a3", txnDate: "2026-02-20", party: "Charlie", amountCents: 3_000 },
      { id: "a1", txnDate: "2026-01-10", party: "Alpha", amountCents: 1_000 },
    ]);
  });

  // Named test 2: null-party rows are kept in rows — DECISION-024 regression guard.
  // Query 2 / recentGifts excludes null-party rows; this fold (fed only by
  // Query 1) must never apply that filter, or bucket.rows would stop
  // reconciling to bucket.totalCents.
  it("keeps null-party rows in rows — does not apply Query 2's isNotNull filter", () => {
    const rows: GivingFoldRow[] = [
      { txnDate: "2026-04-01", amountCents: 1_500, beneficiaryCause: "Food Pantry", id: "b1", party: null },
      { txnDate: "2026-04-15", amountCents: 2_500, beneficiaryCause: "Food Pantry", id: "b2", party: "Donor Co" },
    ];
    const result = bucketGivingByCause(rows);

    expect(result).toHaveLength(1);
    expect(result[0].rows).toHaveLength(2);
    expect(result[0].rows.some((r) => r.id === "b1" && r.party === null)).toBe(true);
  });

  // Named test 3: each bucket's rows sum to bucket.totalCents — the direct
  // unit-level encoding of Flow A's success outcome (reconciliation invariant).
  it("each bucket's rows sum to bucket.totalCents", () => {
    const rows: GivingFoldRow[] = [
      { txnDate: "2026-01-01", amountCents: 1_000, beneficiaryCause: "Scholarships", id: "c1", party: "X" },
      { txnDate: "2026-02-01", amountCents: 4_000, beneficiaryCause: "Scholarships", id: "c2", party: null },
      { txnDate: "2026-03-01", amountCents: 2_000, beneficiaryCause: "Food Pantry", id: "c3", party: "Y" },
      { txnDate: "2026-04-01", amountCents: 500, beneficiaryCause: null, id: "c4", party: null },
    ];
    const result = bucketGivingByCause(rows);

    for (const bucket of result) {
      const sum = bucket.rows.reduce((s, r) => s + r.amountCents, 0);
      expect(sum).toBe(bucket.totalCents);
    }
  });

  // Named test 4: the '' key (Other community support) bucket also gets a
  // populated rows array — no `if (causeKey)` guard anywhere skips it.
  it("'' key (Other community support) bucket also gets a populated rows array", () => {
    const rows: GivingFoldRow[] = [
      { txnDate: "2026-01-01", amountCents: 1_000, beneficiaryCause: "Scholarships", id: "d1", party: "X" },
      { txnDate: "2026-02-01", amountCents: 750, beneficiaryCause: null, id: "d2", party: null },
      { txnDate: "2026-03-01", amountCents: 250, beneficiaryCause: "  ", id: "d3", party: "Z" },
    ];
    const result = bucketGivingByCause(rows);

    const otherBucket = result.find((b) => b.causeKey === "");
    expect(otherBucket).toBeDefined();
    expect(otherBucket!.rows).toHaveLength(2);
    expect(otherBucket!.rows.map((r) => r.id).sort()).toEqual(["d2", "d3"]);
  });
});

// ---------------------------------------------------------------------------
// deriveCauseFyPills — /members/impact FY filter pills rework (2026-07-20)
// ---------------------------------------------------------------------------
//
// Treasurer spec: "leave 23-24 off since we don't have that data. Just show
// All, then the next three fiscal years, and maybe a More pill to get to
// older data if it exists." Covers the earliest-year clamp and the
// More-eligibility boundary (exactly 3 data years → no More; 4+ → More).

describe("deriveCauseFyPills", () => {
  // Real-world scenario as of 2026-07-20: books start FY2024, current FY2026
  // has no giving posted yet. Fixed = current + 2 prior, all >= earliest data
  // year (2024) — no clamp needed, no More pill.
  it("today's real data (FY2024 earliest, FY2026 current, no gap) — 3 fixed, no More", () => {
    const result = deriveCauseFyPills([2025, 2024], 2026);
    expect(result.fixed).toEqual([2026, 2025, 2024]);
    expect(result.more).toEqual([]);
  });

  // Earliest-year clamp: giving data starts in the CURRENT fiscal year, so
  // the two prior-FY fixed candidates (2025, 2024) must be dropped — never a
  // year earlier than the earliest data year, even though the current FY is
  // always exempt from the clamp itself.
  it("clamps fixed pills to the earliest data year — drops prior-FY candidates before that year", () => {
    const result = deriveCauseFyPills([2026], 2026);
    expect(result.fixed).toEqual([2026]);
    expect(result.more).toEqual([]);
  });

  // Boundary: exactly 3 data years (current FY included, all three fixed
  // slots have data) → no More pill.
  it("exactly 3 data years → no More pill", () => {
    const result = deriveCauseFyPills([2026, 2025, 2024], 2026);
    expect(result.fixed).toEqual([2026, 2025, 2024]);
    expect(result.more).toEqual([]);
  });

  // Boundary: 4 data years → the 4th (oldest) year spills into More.
  it("4 data years → the oldest spills into More, newest-first fixed set unchanged", () => {
    const result = deriveCauseFyPills([2026, 2025, 2024, 2023], 2026);
    expect(result.fixed).toEqual([2026, 2025, 2024]);
    expect(result.more).toEqual([2023]);
  });

  // More than 4 data years — More pill reveals every older data year,
  // newest-first, not just one.
  it("5 data years → More contains both older years, sorted newest-first", () => {
    const result = deriveCauseFyPills([2026, 2025, 2024, 2023, 2022], 2026);
    expect(result.fixed).toEqual([2026, 2025, 2024]);
    expect(result.more).toEqual([2023, 2022]);
  });

  // Current FY always renders even with zero giving data recorded for it —
  // it's the default selection with its own empty-state message.
  it("current FY has no data yet but still renders as a fixed pill", () => {
    const result = deriveCauseFyPills([2025, 2024], 2026);
    expect(result.fixed).toContain(2026);
  });

  // No data at all (defensive — the impact page's caller only reaches this
  // component when allTimeCents > 0, but the function itself must not throw).
  it("no data years at all — falls back to just the current FY, no More", () => {
    const result = deriveCauseFyPills([], 2026);
    expect(result.fixed).toEqual([2026]);
    expect(result.more).toEqual([]);
  });
});
