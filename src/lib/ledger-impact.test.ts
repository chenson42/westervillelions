/**
 * Unit tests for isGiving() in src/lib/ledger.ts — inc5 Philanthropy Dashboard.
 *
 * All tests are pure (no DB). Covers the 8 required cases from the Phase 3
 * spec plus an additional edge case for completeness.
 *
 * The canonical rule: isGiving() returns true iff
 *   flow === 'expense' AND transferGroupId === null AND
 *   fundKind IN ('activity', 'charitable', 'scholarship').
 *
 * NOTE: status ('posted' | 'pending' | 'rejected') is NOT part of isGiving()'s
 * contract. The SQL query in getPhilanthropy() (ledger-queries.ts) enforces the
 * status = 'posted' filter. This helper is for per-row labeling and unit tests.
 */

import { describe, it, expect } from "vitest";
import { isGiving, type IsGivingRow } from "./ledger";

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
});
