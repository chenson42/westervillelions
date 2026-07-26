/**
 * Unit tests for src/lib/google-groups.ts — club@ list eligibility
 * (docs/work-log/2026-07-26-prospective-members.md).
 *
 * google-groups.ts imports `@/lib/db` and `googleapis` at module scope, so
 * @/lib/db is mocked to avoid a real DB connection attempt during import —
 * same pattern as src/lib/permissions-server.test.ts. isEligibleForClubList
 * itself is a pure function with no DB dependency.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    query: { groups: { findFirst: vi.fn() } },
  },
}));

import { isEligibleForClubList, CLUB_LIST_ELIGIBLE_STATUSES } from "./google-groups";

describe("isEligibleForClubList", () => {
  it("'active' → true", () => {
    expect(isEligibleForClubList("active")).toBe(true);
  });

  it("'prospective' → true", () => {
    expect(isEligibleForClubList("prospective")).toBe(true);
  });

  it("'ended' → false", () => {
    expect(isEligibleForClubList("ended")).toBe(false);
  });

  it("CLUB_LIST_ELIGIBLE_STATUSES is exactly ['active', 'prospective'] (explicit allow-list, not a negation)", () => {
    expect([...CLUB_LIST_ELIGIBLE_STATUSES].sort()).toEqual(["active", "prospective"]);
  });
});
