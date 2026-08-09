/**
 * Unit tests for src/lib/minutes-queries.ts.
 *
 * Covers Phase 3 design's "Unit Tests for Phase 4" item 2
 * (docs/work-log/2026-08-08-meeting-minutes.md):
 *   - getNextMeetingPointer('general') returns the earliest future
 *     occurrence among title-matching candidates and ignores non-matching
 *     titles and past occurrences (both a recurring-series candidate and a
 *     plain one-off row).
 *   - getMostRecentApprovedMinutes('board') returns the latest by
 *     meetingDate among status='approved' only — excludes drafts and
 *     soft-deleted rows.
 *   - searchMinutes() matches on attendee memberNameSnapshot, motion text,
 *     and action-item ownerName, and excludes soft-deleted records from
 *     results.
 *   - listMinutesForMembers() never returns a row with pendingDeleteAt set;
 *     listMinutesForAdmin({ includeDeleted: true }) does.
 *
 * Hermetic: mocks @/lib/db so `pnpm test` passes without DATABASE_URL/DB_URL
 * set (same convention as src/lib/financial-report-queries.test.ts). A
 * shared FIFO queue answers every db.select()/selectDistinct() chain in call
 * order; every `.where(...)` condition is ALSO captured so tests can prove
 * exclusion/matching claims structurally (compiled via PgDialect, not just
 * reasoned about from the returned rows) — same technique
 * src/app/api/admin/ledger/budget-approvals/route.test.ts already uses for
 * its own "non-pending rows survive" DELETE-scoping proof.
 *
 * A `updateMinutesDraft — attendance merge contract` block briefly lived
 * here for DECISION-078 (a Phase 4 loop-back fixing an attendance-snapshot
 * data-loss defect against a per-member `minutesAttendance` table).
 * DECISION-079 superseded that design entirely — attendance is a single
 * `presentCount` integer on `minutes` itself, not a child table — so that
 * defect, its fix, and this file's coverage of it are all moot and have
 * been removed rather than adapted.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { format } from "date-fns";

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: { queue: [] as unknown[][], wheres: [] as unknown[] },
}));

vi.mock("@/lib/db", () => {
  function chain(): unknown {
    const obj: Record<string, unknown> = {
      from: () => obj,
      where: (cond: unknown) => {
        mockDbState.wheres.push(cond);
        return obj;
      },
      orderBy: () => obj,
      groupBy: () => obj,
      limit: () => obj,
      innerJoin: () => obj,
      leftJoin: () => obj,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(mockDbState.queue.shift() ?? []).then(resolve, reject),
    };
    return obj;
  }
  return { db: { select: () => chain(), selectDistinct: () => chain() } };
});

import {
  getNextMeetingPointer,
  getMostRecentApprovedMinutes,
  searchMinutes,
  listMinutesForMembers,
  listMinutesForAdmin,
  getMemberNameSnapshot,
} from "./minutes-queries";

beforeEach(() => {
  mockDbState.queue = [];
  mockDbState.wheres = [];
});

function sqlOf(cond: unknown): { sql: string; params: unknown[] } {
  const dialect = new PgDialect();
  const { sql, params } = dialect.sqlToQuery(cond as never);
  return { sql: sql.toLowerCase(), params };
}

/** Wall-clock "yyyy-MM-dd HH:mm:ss" offset from *now* by `offsetDays`, at a
 *  fixed local time — matches the Drizzle mode:"string" shape events.startDate
 *  actually returns (see src/lib/events.ts's own RecurringEvent contract). */
function wallClock(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(19, 0, 0, 0);
  return format(d, "yyyy-MM-dd HH:mm:ss");
}

// ---------------------------------------------------------------------------
// getNextMeetingPointer
// ---------------------------------------------------------------------------

describe("getNextMeetingPointer", () => {
  it("queries events by the exact MINUTES_KIND_EVENT_TITLES['general'] patterns — a non-matching title can never be asked for in the first place", async () => {
    mockDbState.queue.push([], []); // no candidates, no overrides — irrelevant to this assertion

    await getNextMeetingPointer("general");

    expect(mockDbState.wheres.length).toBeGreaterThanOrEqual(1);
    const { sql, params } = sqlOf(mockDbState.wheres[0]);
    expect(sql).toContain("ilike");
    expect(params).toEqual(["Lions Club Meeting", "General Meeting"]);
  });

  it("returns null for an unmapped kind without querying the database at all", async () => {
    const result = await getNextMeetingPointer("committee");
    expect(result).toBeNull();
    expect(mockDbState.wheres).toHaveLength(0);
  });

  it("returns the EARLIEST future occurrence among title-matching candidates — a nearer plain one-off row beats a farther-out recurring series, and a past one-off row is ignored entirely", async () => {
    const monthlyRecurring = {
      id: "evt-recurring",
      title: "Lions Club Meeting",
      location: "Clubhouse",
      isAllDay: false,
      // Started a few days ago; the monthly branch walks forward to the same
      // day-of-month NEXT month once this month's date has already passed —
      // deterministically ~a month out, regardless of what day "today" is.
      startDate: wallClock(-3),
      isRecurring: true,
      recurrenceType: "monthly",
      recurrenceDays: null,
      recurrenceEndDate: null,
    };
    const nearOneOff = {
      id: "evt-oneoff-near",
      title: "General Meeting",
      location: "Community Hall",
      isAllDay: false,
      startDate: wallClock(1),
      isRecurring: false,
      recurrenceType: null,
      recurrenceDays: null,
      recurrenceEndDate: null,
    };
    const pastOneOff = {
      id: "evt-oneoff-past",
      title: "General Meeting",
      location: "Old Hall",
      isAllDay: false,
      startDate: wallClock(-30),
      isRecurring: false,
      recurrenceType: null,
      recurrenceDays: null,
      recurrenceEndDate: null,
    };

    mockDbState.queue.push([monthlyRecurring, nearOneOff, pastOneOff], []); // candidates, then overrides (none)

    const result = await getNextMeetingPointer("general");

    expect(result).not.toBeNull();
    expect(result?.eventId).toBe("evt-oneoff-near");
  });

  it("returns null when every candidate's next occurrence is null (e.g. a lapsed series) rather than throwing", async () => {
    const lapsed = {
      id: "evt-lapsed",
      title: "Board Meeting",
      location: "Clubhouse",
      isAllDay: false,
      startDate: wallClock(-60),
      isRecurring: false, // one-off, already happened — getNextOccurrence returns null
      recurrenceType: null,
      recurrenceDays: null,
      recurrenceEndDate: null,
    };
    mockDbState.queue.push([lapsed], []);

    const result = await getNextMeetingPointer("board");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getMostRecentApprovedMinutes
// ---------------------------------------------------------------------------

describe("getMostRecentApprovedMinutes", () => {
  it("scopes to kind + status='approved' + pending_delete_at IS NULL — drafts and soft-deleted rows are structurally excluded, not just expected to be absent", async () => {
    mockDbState.queue.push([
      { id: "min-1", kind: "board", meetingDate: "2026-06-01", title: null, approvedAt: new Date("2026-06-08") },
    ]);

    const result = await getMostRecentApprovedMinutes("board");

    expect(result?.id).toBe("min-1");
    expect(mockDbState.wheres).toHaveLength(1);
    const { sql, params } = sqlOf(mockDbState.wheres[0]);
    expect(sql).toContain('"minutes"."status"');
    expect(sql).toContain("is null");
    expect(params).toContain("board");
    expect(params).toContain("approved");
  });

  it("returns null when no approved row exists for the kind", async () => {
    mockDbState.queue.push([]);
    const result = await getMostRecentApprovedMinutes("general");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// searchMinutes
// ---------------------------------------------------------------------------

describe("searchMinutes", () => {
  it("matches motion text and action-item ownerName, and excludes soft-deleted rows — all structurally present in the compiled WHERE (DECISION-079: no attendance join — presentCount is a number, not a searchable name)", async () => {
    mockDbState.queue.push([
      { id: "min-1", kind: "general", meetingDate: "2026-06-01", status: "approved", title: null },
    ]);

    const results = await searchMinutes("Jane Doe");

    expect(results).toEqual([
      { id: "min-1", kind: "general", meetingDate: "2026-06-01", status: "approved", title: null },
    ]);

    expect(mockDbState.wheres).toHaveLength(1);
    const { sql } = sqlOf(mockDbState.wheres[0]);
    expect(sql).toContain('"minutes_motions"."text"');
    expect(sql).toContain('"minutes_action_items"."owner_name"');
    expect(sql).toContain('"minutes"."pending_delete_at" is null');
    expect(sql).not.toContain("minutes_attendance");
  });

  it("escapes ILIKE wildcards in the search term (own escapeIlikeTerm() copy, DECISION-077 §3)", async () => {
    mockDbState.queue.push([]);
    await searchMinutes("50%_off");
    const { params } = sqlOf(mockDbState.wheres[0]);
    // Every OR-branch shares the same escaped+wrapped term.
    expect(params).toContain("%50\\%\\_off%");
  });

  it("returns an empty array for a blank query without touching the database", async () => {
    const results = await searchMinutes("   ");
    expect(results).toEqual([]);
    expect(mockDbState.wheres).toHaveLength(0);
  });

  it("scopes to a specific kind when provided", async () => {
    mockDbState.queue.push([]);
    await searchMinutes("quorum", "board");
    const { sql, params } = sqlOf(mockDbState.wheres[0]);
    expect(sql).toContain('"minutes"."kind"');
    expect(params).toContain("board");
  });
});

// ---------------------------------------------------------------------------
// listMinutesForMembers / listMinutesForAdmin — soft-delete scoping
// ---------------------------------------------------------------------------

describe("listMinutesForMembers / listMinutesForAdmin — soft-delete scoping", () => {
  it("listMinutesForMembers() always applies pending_delete_at IS NULL", async () => {
    mockDbState.queue.push([]);
    await listMinutesForMembers();

    expect(mockDbState.wheres).toHaveLength(1);
    const { sql } = sqlOf(mockDbState.wheres[0]);
    expect(sql).toContain('"minutes"."pending_delete_at" is null');
  });

  it("listMinutesForAdmin() defaults to excluding soft-deleted rows too — same IS NULL condition present", async () => {
    mockDbState.queue.push([]);
    await listMinutesForAdmin();

    expect(mockDbState.wheres).toHaveLength(1);
    const { sql } = sqlOf(mockDbState.wheres[0]);
    expect(sql).toContain('"minutes"."pending_delete_at" is null');
  });

  it("listMinutesForAdmin({ includeDeleted: true }) omits the pending_delete_at filter entirely — a soft-deleted row IS returned", async () => {
    const deletedRow = {
      id: "min-deleted",
      kind: "general",
      title: null,
      meetingDate: "2026-01-01",
      status: "approved",
      eventId: null,
      presentCount: 0,
      pendingDeleteAt: new Date("2026-02-01"),
    };
    mockDbState.queue.push([deletedRow]);

    const rows = await listMinutesForAdmin({ includeDeleted: true });

    expect(rows).toEqual([deletedRow]);
    // No kind/status filter and includeDeleted=true -> conditions array is
    // empty -> .where(undefined), i.e. no filter compiled at all.
    expect(mockDbState.wheres).toHaveLength(1);
    expect(mockDbState.wheres[0]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getMemberNameSnapshot — notetaker-of-record resolution (further Phase 4
// increment, 2026-08-09)
// ---------------------------------------------------------------------------

describe("getMemberNameSnapshot", () => {
  it("returns '{firstName} {lastName}' for an existing member", async () => {
    mockDbState.queue.push([{ firstName: "Jane", lastName: "Doe" }]);

    const result = await getMemberNameSnapshot("mem-1");

    expect(result).toBe("Jane Doe");
    expect(mockDbState.wheres).toHaveLength(1);
    const { sql, params } = sqlOf(mockDbState.wheres[0]);
    expect(sql).toContain('"members"."id"');
    expect(params).toContain("mem-1");
  });

  it("returns null when no member with that id exists — the caller (the route) turns this into a 400, never a silently-null snapshot on a written row", async () => {
    mockDbState.queue.push([]);

    const result = await getMemberNameSnapshot("does-not-exist");

    expect(result).toBeNull();
  });
});
