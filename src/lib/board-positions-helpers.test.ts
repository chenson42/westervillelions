/**
 * Unit tests for the new bulk board-position helpers in
 * src/lib/board-positions.ts — getBoardGroupId(), getBoardMemberships(),
 * getBoardPositionsByMemberId() — added by the Stale Board Positions fix
 * (docs/work-log/2026-09-18-stale-board-positions.md, Phase 3/4).
 *
 * Deliberately a SEPARATE file from src/lib/board-positions.test.ts: the
 * implementation brief for this fix required resolveTreasurer()'s existing
 * test file to keep passing completely unmodified (it does — see the
 * "Stale Board Positions fix" comment in board-positions.ts for why
 * resolveTreasurer() was refactored to reuse only getBoardGroupId(), not
 * getBoardMemberships()). This file adds coverage for the new helpers
 * without touching that one.
 *
 * Hermetic: mocks @/lib/db, same convention as board-positions.test.ts —
 * `pnpm test` passes without DATABASE_URL/DB_URL set.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    boardGroup: undefined as { id: string } | undefined,
    rows: [] as Array<{
      memberId: string;
      firstName: string;
      lastName: string;
      email: string;
      position: string | null;
    }>,
    wheres: [] as unknown[],
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      groups: {
        findFirst: () => Promise.resolve(mockDbState.boardGroup),
      },
    },
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: (cond: unknown) => {
            mockDbState.wheres.push(cond);
            return Promise.resolve(mockDbState.rows);
          },
        }),
      }),
    }),
  },
}));

import {
  getBoardGroupId,
  getBoardMemberships,
  getBoardPositionsByMemberId,
} from "./board-positions";

beforeEach(() => {
  mockDbState.boardGroup = { id: "board-1" };
  mockDbState.rows = [];
  mockDbState.wheres = [];
});

describe("getBoardGroupId", () => {
  it("returns the Board of Directors group id when the group exists", async () => {
    mockDbState.boardGroup = { id: "board-1" };
    expect(await getBoardGroupId()).toBe("board-1");
  });

  it("returns null when there is no Board of Directors group", async () => {
    mockDbState.boardGroup = undefined;
    expect(await getBoardGroupId()).toBeNull();
  });
});

describe("getBoardMemberships", () => {
  it("returns [] without querying group_memberships when there is no Board of Directors group", async () => {
    mockDbState.boardGroup = undefined;
    mockDbState.rows = [
      { memberId: "m-1", firstName: "Chris", lastName: "Henson", email: "chris@example.com", position: "President" },
    ];
    const result = await getBoardMemberships();
    expect(result).toEqual([]);
    expect(mockDbState.wheres).toHaveLength(0);
  });

  it("returns every joined membership row, including null/blank positions", async () => {
    mockDbState.rows = [
      { memberId: "m-1", firstName: "Chris", lastName: "Henson", email: "chris@example.com", position: "President" },
      { memberId: "m-2", firstName: "James", lastName: "Shively", email: "james@example.com", position: null },
      { memberId: "m-3", firstName: "Pat", lastName: "Lee", email: "pat@example.com", position: "   " },
    ];
    const result = await getBoardMemberships();
    expect(result).toEqual(mockDbState.rows);
  });

  it("scopes the query to the Board group only (single where, no position filter)", async () => {
    mockDbState.rows = [];
    await getBoardMemberships();
    // Only one query is issued (the membership join), scoped by group id —
    // no position-level filter belongs here; that's the whole point of this
    // helper vs. resolveTreasurer()'s own filtered query.
    expect(mockDbState.wheres).toHaveLength(1);
  });
});

describe("getBoardPositionsByMemberId", () => {
  it("builds a Map keyed by memberId from the joined rows", async () => {
    mockDbState.rows = [
      { memberId: "m-1", firstName: "Chris", lastName: "Henson", email: "chris@example.com", position: "President" },
      { memberId: "m-2", firstName: "James", lastName: "Shively", email: "james@example.com", position: "Treasurer" },
    ];
    const result = await getBoardPositionsByMemberId();
    expect(result).toBeInstanceOf(Map);
    expect(result.get("m-1")).toBe("President");
    expect(result.get("m-2")).toBe("Treasurer");
    expect(result.size).toBe(2);
  });

  it("trims whitespace around a position value", async () => {
    mockDbState.rows = [
      { memberId: "m-1", firstName: "Chris", lastName: "Henson", email: "chris@example.com", position: "  President  " },
    ];
    const result = await getBoardPositionsByMemberId();
    expect(result.get("m-1")).toBe("President");
  });

  it("omits a member whose position is null", async () => {
    mockDbState.rows = [
      { memberId: "m-1", firstName: "Chris", lastName: "Henson", email: "chris@example.com", position: null },
    ];
    const result = await getBoardPositionsByMemberId();
    expect(result.has("m-1")).toBe(false);
    expect(result.size).toBe(0);
  });

  it("omits a member whose position is blank or whitespace-only", async () => {
    mockDbState.rows = [
      { memberId: "m-1", firstName: "Chris", lastName: "Henson", email: "chris@example.com", position: "" },
      { memberId: "m-2", firstName: "James", lastName: "Shively", email: "james@example.com", position: "   " },
    ];
    const result = await getBoardPositionsByMemberId();
    expect(result.size).toBe(0);
  });

  it("members not on the board at all are simply absent from the map (not present as null)", async () => {
    mockDbState.rows = [
      { memberId: "m-1", firstName: "Chris", lastName: "Henson", email: "chris@example.com", position: "President" },
    ];
    const result = await getBoardPositionsByMemberId();
    expect(result.has("someone-not-on-the-board")).toBe(false);
  });

  it("returns an empty Map when there is no Board of Directors group", async () => {
    mockDbState.boardGroup = undefined;
    const result = await getBoardPositionsByMemberId();
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it("returns an empty Map when the group exists but has no memberships", async () => {
    mockDbState.rows = [];
    const result = await getBoardPositionsByMemberId();
    expect(result.size).toBe(0);
  });
});
