/**
 * Unit tests for GET /api/public/leadership.
 *
 * Added by the Stale Board Positions fix (docs/work-log/2026-09-18-stale-
 * board-positions.md, Phase 3 step 3): this route's internals moved from
 * an inline db.select()...innerJoin()...where() query to the shared
 * getBoardMemberships() helper in src/lib/board-positions.ts. The response
 * shape ({ firstName, lastName, position }[]) and the POSITION_ORDER sort
 * (known ranks first, then alphabetical by position name, tie-broken by
 * last name) must be byte-identical before/after — this file guards that.
 *
 * Hermetic: mocks @/lib/board-positions directly (not the raw DB), same
 * convention as other route tests in this codebase that mock their query
 * layer rather than the DB connection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/board-positions", () => ({
  getBoardMemberships: vi.fn(),
}));

import { GET } from "./route";
import { getBoardMemberships } from "@/lib/board-positions";

const mockGetBoardMemberships = vi.mocked(getBoardMemberships);

beforeEach(() => {
  mockGetBoardMemberships.mockReset();
});

describe("GET /api/public/leadership", () => {
  it("returns [] when there are no board memberships (no group, or an empty group)", async () => {
    mockGetBoardMemberships.mockResolvedValue([]);
    const res = await GET();
    expect(await res.json()).toEqual([]);
  });

  it("returns only firstName/lastName/position, dropping memberId/email", async () => {
    mockGetBoardMemberships.mockResolvedValue([
      { memberId: "m-1", firstName: "Chris", lastName: "Henson", email: "chris@example.com", position: "President" },
    ]);
    const res = await GET();
    expect(await res.json()).toEqual([{ firstName: "Chris", lastName: "Henson", position: "President" }]);
  });

  it("sorts known positions by rank first (President, then VPs, then Secretary/Treasurer)", async () => {
    mockGetBoardMemberships.mockResolvedValue([
      { memberId: "m-1", firstName: "Pat", lastName: "Lee", email: "pat@example.com", position: "Treasurer" },
      { memberId: "m-2", firstName: "Chris", lastName: "Henson", email: "chris@example.com", position: "President" },
      { memberId: "m-3", firstName: "Sam", lastName: "Reed", email: "sam@example.com", position: "Secretary" },
    ]);
    const res = await GET();
    const positions = (await res.json()).map((m: { position: string }) => m.position);
    expect(positions).toEqual(["President", "Secretary", "Treasurer"]);
  });

  it("sorts unranked positions alphabetically by position name after all ranked ones", async () => {
    mockGetBoardMemberships.mockResolvedValue([
      { memberId: "m-1", firstName: "A", lastName: "Zed", email: "a@example.com", position: "Zone Chair" },
      { memberId: "m-2", firstName: "B", lastName: "Young", email: "b@example.com", position: "President" },
      { memberId: "m-3", firstName: "C", lastName: "Xavier", email: "c@example.com", position: "Director" },
    ]);
    const res = await GET();
    const positions = (await res.json()).map((m: { position: string }) => m.position);
    expect(positions).toEqual(["President", "Director", "Zone Chair"]);
  });

  it("breaks ties (same rank/position name) by last name ascending", async () => {
    mockGetBoardMemberships.mockResolvedValue([
      { memberId: "m-1", firstName: "Z", lastName: "Zed", email: "z@example.com", position: "Director" },
      { memberId: "m-2", firstName: "A", lastName: "Abbot", email: "a@example.com", position: "Director" },
    ]);
    const res = await GET();
    const lastNames = (await res.json()).map((m: { lastName: string }) => m.lastName);
    expect(lastNames).toEqual(["Abbot", "Zed"]);
  });

  it("matches position rank case-insensitively and trims whitespace", async () => {
    mockGetBoardMemberships.mockResolvedValue([
      { memberId: "m-1", firstName: "A", lastName: "A", email: "a@example.com", position: "  president  " },
      { memberId: "m-2", firstName: "B", lastName: "B", email: "b@example.com", position: "TREASURER" },
    ]);
    const res = await GET();
    const positions = (await res.json()).map((m: { position: string }) => m.position);
    expect(positions).toEqual(["  president  ", "TREASURER"]);
  });

  it("returns a 500 error response if the lookup throws", async () => {
    mockGetBoardMemberships.mockRejectedValue(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to fetch leadership" });
  });
});
