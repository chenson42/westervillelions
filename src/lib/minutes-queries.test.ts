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
 *
 * api-developer (2026-09-09, docs/work-log/2026-09-09-minutes-browse-and-
 * search-context.md, Phase 4) extended the harness with `selectCalls` (a
 * counter incremented on every `db.select()` invocation, independent of
 * `queue`/`wheres`) so `searchMinutes()`'s "exactly 3 round trips, no N+1"
 * claim can be asserted structurally rather than inferred from row counts —
 * and rewrote `describe("searchMinutes", ...)` entirely for the new
 * three-query merge shape (each test now pushes THREE queue entries — body,
 * motion, action-item rows, in that order — instead of one), and added
 * `describe("getMinutesFiscalYearCounts", ...)` and the
 * `listMinutesForMembers` year-filter block.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { format } from "date-fns";

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: { queue: [] as unknown[][], wheres: [] as unknown[], selectCalls: 0 },
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
  return {
    db: {
      select: () => {
        mockDbState.selectCalls += 1;
        return chain();
      },
      selectDistinct: () => {
        mockDbState.selectCalls += 1;
        return chain();
      },
    },
  };
});

import {
  getNextMeetingPointer,
  getMostRecentApprovedMinutes,
  searchMinutes,
  listMinutesForMembers,
  listMinutesForAdmin,
  getMemberNameSnapshot,
  getMinutesFiscalYearCounts,
} from "./minutes-queries";

beforeEach(() => {
  mockDbState.queue = [];
  mockDbState.wheres = [];
  mockDbState.selectCalls = 0;
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
// searchMinutes — three-query merge (2026-09-09 year-pills/search-context
// feature, Phase 3 "Query design"). Every test below pushes THREE queue
// entries — Query A (title/body) rows, Query B (motion) rows, Query C
// (action-item) rows, in that order — matching the function's fixed query
// order (see the file header for why this is 3 round trips, never N).
// ---------------------------------------------------------------------------

describe("searchMinutes", () => {
  it("returns an empty array for a blank query without touching the database at all", async () => {
    const results = await searchMinutes("   ");
    expect(results).toEqual([]);
    expect(mockDbState.wheres).toHaveLength(0);
    expect(mockDbState.selectCalls).toBe(0);
  });

  it("issues exactly 3 db.select calls for a non-blank query, regardless of how many rows come back", async () => {
    mockDbState.queue.push([], [], []);
    await searchMinutes("quorum");
    expect(mockDbState.selectCalls).toBe(3);
    expect(mockDbState.wheres).toHaveLength(3);
  });

  it("every one of the three compiled WHEREs excludes soft-deleted rows (pending_delete_at IS NULL) and none reference minutes_attendance (DECISION-079: no attendance join — presentCount is a number, not a searchable name)", async () => {
    mockDbState.queue.push([], [], []);
    await searchMinutes("quorum");
    for (const w of mockDbState.wheres) {
      const { sql } = sqlOf(w);
      expect(sql).toContain('"minutes"."pending_delete_at" is null');
      expect(sql).not.toContain("minutes_attendance");
    }
  });

  it("Query B's compiled WHERE targets minutesMotions.text/moverName/seconderName; Query C's targets minutesActionItems.text/ownerName", async () => {
    mockDbState.queue.push([], [], []);
    await searchMinutes("Jane Doe");
    const { sql: motionSql } = sqlOf(mockDbState.wheres[1]);
    expect(motionSql).toContain('"minutes_motions"."text"');
    expect(motionSql).toContain('"minutes_motions"."mover_name"');
    expect(motionSql).toContain('"minutes_motions"."seconder_name"');
    const { sql: actionSql } = sqlOf(mockDbState.wheres[2]);
    expect(actionSql).toContain('"minutes_action_items"."text"');
    expect(actionSql).toContain('"minutes_action_items"."owner_name"');
  });

  it("escapes ILIKE wildcards in the search term identically across all three queries (own escapeIlikeTerm() copy, DECISION-077 §3)", async () => {
    mockDbState.queue.push([], [], []);
    await searchMinutes("50%_off");
    expect(mockDbState.wheres).toHaveLength(3);
    for (const w of mockDbState.wheres) {
      const { params } = sqlOf(w);
      // Every OR-branch in every query shares the same escaped+wrapped term.
      expect(params).toContain("%50\\%\\_off%");
    }
  });

  it("scopes to a specific kind identically across all three queries", async () => {
    mockDbState.queue.push([], [], []);
    await searchMinutes("quorum", "board");
    expect(mockDbState.wheres).toHaveLength(3);
    for (const w of mockDbState.wheres) {
      const { sql, params } = sqlOf(w);
      expect(sql).toContain('"minutes"."kind"');
      expect(params).toContain("board");
    }
  });

  it("a record matching only in bodyMarkdown -> matchField: 'body', non-null snippet", async () => {
    mockDbState.queue.push(
      [
        {
          id: "min-1",
          kind: "general",
          meetingDate: "2026-06-01",
          status: "approved",
          title: "June Meeting",
          bodyMarkdown: "We discussed the pancake breakfast fundraiser at length.",
        },
      ],
      [],
      [],
    );

    const results = await searchMinutes("pancake breakfast");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "min-1", matchField: "body" });
    expect(results[0].snippet).not.toBeNull();
    expect(results[0].snippet?.excerpt).toContain("pancake breakfast");
  });

  it("a record matching only in a motion's text -> matchField: 'motion'", async () => {
    mockDbState.queue.push(
      [],
      [
        {
          id: "min-2",
          kind: "general",
          meetingDate: "2026-05-01",
          status: "approved",
          title: "May Meeting",
          text: "Motion to approve the pancake breakfast budget.",
          moverName: "Jane Doe",
          seconderName: "John Smith",
        },
      ],
      [],
    );

    const results = await searchMinutes("pancake breakfast");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "min-2", matchField: "motion" });
    expect(results[0].snippet).not.toBeNull();
  });

  it("a record matching only in an action item's text -> matchField: 'action_item'", async () => {
    mockDbState.queue.push(
      [],
      [],
      [
        {
          id: "min-6",
          kind: "general",
          meetingDate: "2026-05-15",
          status: "approved",
          title: "Mid-May Meeting",
          text: "Order supplies for the pancake breakfast.",
          ownerName: "Pat Lee",
        },
      ],
    );

    const results = await searchMinutes("pancake breakfast");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "min-6", matchField: "action_item" });
    expect(results[0].snippet).not.toBeNull();
  });

  it("a record matching in both bodyMarkdown AND a motion -> matchField: 'body' (documented merge priority: title > body > motion > action item)", async () => {
    mockDbState.queue.push(
      [
        {
          id: "min-3",
          kind: "general",
          meetingDate: "2026-04-01",
          status: "approved",
          title: "April Meeting",
          bodyMarkdown: "Discussion of the pancake breakfast.",
        },
      ],
      [
        {
          id: "min-3",
          kind: "general",
          meetingDate: "2026-04-01",
          status: "approved",
          title: "April Meeting",
          text: "Motion regarding the pancake breakfast.",
          moverName: "Jane Doe",
          seconderName: null,
        },
      ],
      [],
    );

    const results = await searchMinutes("pancake breakfast");

    expect(results).toHaveLength(1);
    expect(results[0].matchField).toBe("body");
  });

  it("a record matching only in title -> matchField: 'title', snippet: null (title is already the visible card headline)", async () => {
    mockDbState.queue.push(
      [
        {
          id: "min-4",
          kind: "general",
          meetingDate: "2026-03-01",
          status: "approved",
          title: "Pancake Breakfast Planning",
          bodyMarkdown: "Nothing relevant in the body.",
        },
      ],
      [],
      [],
    );

    const results = await searchMinutes("Pancake Breakfast");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "min-4", matchField: "title", snippet: null });
  });

  it("issues exactly 3 db.select calls and dedupes to one row per id — no N+1 regardless of how many motions/action items match the same record (motion beats action_item per merge priority)", async () => {
    mockDbState.queue.push(
      [],
      [
        {
          id: "min-5",
          kind: "general",
          meetingDate: "2026-02-01",
          status: "approved",
          title: "Feb Meeting",
          text: "Motion one about the pancake breakfast.",
          moverName: "A",
          seconderName: null,
        },
        {
          id: "min-5",
          kind: "general",
          meetingDate: "2026-02-01",
          status: "approved",
          title: "Feb Meeting",
          text: "Motion two about the pancake breakfast.",
          moverName: "B",
          seconderName: null,
        },
      ],
      [
        {
          id: "min-5",
          kind: "general",
          meetingDate: "2026-02-01",
          status: "approved",
          title: "Feb Meeting",
          text: "Action item about the pancake breakfast.",
          ownerName: "C",
        },
      ],
    );

    const results = await searchMinutes("pancake breakfast");

    expect(mockDbState.selectCalls).toBe(3);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "min-5", matchField: "motion" });
  });

  it("sorts merged results by meetingDate descending", async () => {
    mockDbState.queue.push(
      [
        {
          id: "min-old",
          kind: "general",
          meetingDate: "2026-01-01",
          status: "approved",
          title: "Old",
          bodyMarkdown: "quorum was met",
        },
        {
          id: "min-new",
          kind: "general",
          meetingDate: "2026-06-01",
          status: "approved",
          title: "New",
          bodyMarkdown: "quorum was met",
        },
      ],
      [],
      [],
    );

    const results = await searchMinutes("quorum");

    expect(results.map((r) => r.id)).toEqual(["min-new", "min-old"]);
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
// listMinutesForMembers — year filter (2026-09-09 year-pills feature, Phase
// 3 "Data Model": fyBounds() + gte/lt string comparison against the `date`
// column — no new Date() parse, no TZ exposure on this path.
// ---------------------------------------------------------------------------

describe("listMinutesForMembers — year filter", () => {
  it("year provided -> compiles to fyBounds(year)'s gte/lt range against meeting_date, not a new Date()-derived comparison", async () => {
    mockDbState.queue.push([]);
    await listMinutesForMembers({ year: 2025 });

    expect(mockDbState.wheres).toHaveLength(1);
    const { sql, params } = sqlOf(mockDbState.wheres[0]);
    expect(sql).toContain('"minutes"."meeting_date" >=');
    expect(sql).toContain('"minutes"."meeting_date" <');
    // fyBounds(2025) === { start: "2025-07-01", end: "2026-07-01" }
    expect(params).toContain("2025-07-01");
    expect(params).toContain("2026-07-01");
  });

  it("year omitted -> no date-range condition present (existing behavior unchanged)", async () => {
    mockDbState.queue.push([]);
    await listMinutesForMembers();

    expect(mockDbState.wheres).toHaveLength(1);
    const { sql } = sqlOf(mockDbState.wheres[0]);
    expect(sql).not.toContain("meeting_date");
  });
});

// ---------------------------------------------------------------------------
// getMinutesFiscalYearCounts — the highest-risk item in this feature (Phase
// 3 "Edge Cases"). minutes.meetingDate is a plain `date` column, so Drizzle
// returns 'YYYY-MM-DD' strings; getFiscalYear() needs a JS Date, and a BARE
// `new Date(meetingDate)` parses as UTC midnight, misfiling a record right
// at the Jun 30/Jul 1 Lions-year boundary once read back via
// getMonth()/getFullYear() in the server's local timezone. The
// implementation MUST append "T00:00:00" to force local-time parsing.
// ---------------------------------------------------------------------------

describe("getMinutesFiscalYearCounts — fiscal-year boundary", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("a meetingDate of '2026-06-30' buckets into FY2025, not FY2026", async () => {
    mockDbState.queue.push([{ meetingDate: "2026-06-30" }]);
    const result = await getMinutesFiscalYearCounts();
    expect(result).toEqual([{ fiscalYear: 2025, count: 1 }]);
  });

  it("a meetingDate of '2026-07-01' buckets into FY2026", async () => {
    mockDbState.queue.push([{ meetingDate: "2026-07-01" }]);
    const result = await getMinutesFiscalYearCounts();
    expect(result).toEqual([{ fiscalYear: 2026, count: 1 }]);
  });

  it("a meetingDate of '2026-01-01' (New Year's Day) buckets into FY2025 — Jan is still H1 of the fiscal year that started the previous July", async () => {
    mockDbState.queue.push([{ meetingDate: "2026-01-01" }]);
    const result = await getMinutesFiscalYearCounts();
    expect(result).toEqual([{ fiscalYear: 2025, count: 1 }]);
  });

  it("regression guard: NOT reachable via a bare new Date(meetingDate) — proven by forcing a server local timezone (UTC-11, no DST) far enough behind UTC that a bare parse of '2026-07-01' would read back as June 30 local, misfiling it into FY2025", async () => {
    // If the implementation is ever reverted from
    // `new Date(row.meetingDate + "T00:00:00")` to a bare
    // `new Date(row.meetingDate)`, this assertion fails: the bare form
    // parses "2026-07-01" as UTC midnight, which under UTC-11 reads back as
    // "2026-06-30T13:00" local — June, not July — flipping getFiscalYear()'s
    // Jan-Jun/Jul-Dec split from FY2026 to FY2025. The "T00:00:00" suffix
    // forces local-time parsing instead, so the result is correct
    // regardless of the server's timezone.
    process.env.TZ = "Pacific/Midway";
    mockDbState.queue.push([{ meetingDate: "2026-07-01" }]);
    const result = await getMinutesFiscalYearCounts();
    expect(result).toEqual([{ fiscalYear: 2026, count: 1 }]);
  });

  it("aggregates multiple rows into per-fiscal-year counts, sorted descending by fiscal year", async () => {
    mockDbState.queue.push([
      { meetingDate: "2025-08-01" }, // FY2025
      { meetingDate: "2026-02-01" }, // FY2025
      { meetingDate: "2026-08-01" }, // FY2026
    ]);
    const result = await getMinutesFiscalYearCounts();
    expect(result).toEqual([
      { fiscalYear: 2026, count: 1 },
      { fiscalYear: 2025, count: 2 },
    ]);
  });

  it("kind scoping: when given, the kind condition is compiled into the WHERE (same eq(minutes.kind, ...) shape used elsewhere in this file)", async () => {
    mockDbState.queue.push([]);
    await getMinutesFiscalYearCounts("board");
    expect(mockDbState.wheres).toHaveLength(1);
    const { sql, params } = sqlOf(mockDbState.wheres[0]);
    expect(sql).toContain('"minutes"."kind"');
    expect(params).toContain("board");
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
