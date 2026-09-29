/**
 * Unit tests for getSiblingCandidatesByTitle().
 *
 * docs/work-log/2026-09-29-bulk-edit-same-title-events.md (Phase 3, "Unit
 * tests api-developer must deliver", item 3).
 *
 * Hermetic: mocks @/lib/db with the select-queue chain convention from
 * src/app/api/events/[id]/viewer-context/route.test.ts. Never touches a
 * real database. Asserts the WHERE clause is built from `title = :title AND
 * id <> :excludeId` by inspecting the drizzle-orm SQL condition objects
 * passed to `.where()`, not by re-running against a real DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: { rows: [] as unknown[], lastWhere: undefined as unknown },
}));

vi.mock("@/lib/db", () => {
  function chain(): unknown {
    const obj = {
      from: () => obj,
      where: (cond: unknown) => {
        mockDbState.lastWhere = cond;
        return Promise.resolve(mockDbState.rows);
      },
    };
    return obj;
  }
  return {
    db: {
      select: vi.fn(() => chain()),
    },
  };
});

import { getSiblingCandidatesByTitle } from "./event-siblings-queries";
import { db } from "@/lib/db";
import { and, eq, ne } from "drizzle-orm";
import { events } from "@/lib/db/schema";

beforeEach(() => {
  vi.clearAllMocks();
  mockDbState.rows = [];
  mockDbState.lastWhere = undefined;
});

describe("getSiblingCandidatesByTitle", () => {
  it("filters by exact title match and excludes the given id", async () => {
    mockDbState.rows = [
      { id: "sibling-1", title: "Board Meeting", startDate: "2026-10-22 19:00:00", isAllDay: false },
      { id: "sibling-2", title: "Board Meeting", startDate: "2026-11-12 19:00:00", isAllDay: false },
    ];

    const result = await getSiblingCandidatesByTitle(db, "Board Meeting", "event-self");

    expect(result).toEqual(mockDbState.rows);
    // The WHERE clause is exactly `title = :title AND id <> :excludeId` —
    // compare against the same drizzle-orm operators the implementation
    // uses, built from the real (unmocked) `events` schema table so the
    // column references are identical objects.
    expect(mockDbState.lastWhere).toEqual(
      and(eq(events.title, "Board Meeting"), ne(events.id, "event-self"))
    );
  });

  it("returns an empty array when no rows match", async () => {
    mockDbState.rows = [];
    const result = await getSiblingCandidatesByTitle(db, "Unique Title", "event-self");
    expect(result).toEqual([]);
  });

  it("is callable with a transaction-shaped object exposing the same select() chain", async () => {
    mockDbState.rows = [{ id: "sibling-3", title: "Activities Meeting", startDate: "2026-12-01 19:00:00", isAllDay: false }];
    const tx = { select: db.select } as unknown as typeof db;

    const result = await getSiblingCandidatesByTitle(tx, "Activities Meeting", "event-self");

    expect(result).toEqual(mockDbState.rows);
  });
});
