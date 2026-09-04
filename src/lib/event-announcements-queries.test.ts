/**
 * Unit tests for src/lib/event-announcements-queries.ts.
 *
 * Covers the Phase 3 design doc's "Unit Tests To Deliver" items for this
 * module (docs/work-log/2026-09-04-event-announcement-emails.md):
 *   - getFutureOccurrenceOptions(): excludes cancelled occurrences and past
 *     dates; empty array for a non-recurring past event; single date for a
 *     non-recurring future event.
 *   - getEventAnnouncementHistory(): groups rows by batchId into one summary
 *     row with correct recipientCount/successCount/failureCount; orders
 *     newest first.
 *
 * Hermetic: mocks @/lib/db (same FIFO-queue chain pattern as
 * src/lib/financial-report-queries.test.ts) so `pnpm test` passes without
 * DATABASE_URL/DB_URL set.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: { queue: [] as unknown[][] },
}));

vi.mock("@/lib/db", () => {
  function chain(): unknown {
    const obj: Record<string, unknown> = {
      from: () => obj,
      where: () => obj,
      orderBy: () => obj,
      leftJoin: () => obj,
      limit: () => obj,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(mockDbState.queue.shift() ?? []).then(resolve, reject),
    };
    return obj;
  }
  return { db: { select: () => chain() } };
});

import { getFutureOccurrenceOptions, getEventAnnouncementHistory } from "./event-announcements-queries";
import type { RecurringEvent } from "./events";

beforeEach(() => {
  mockDbState.queue = [];
});

// A fixed "now" well inside a stable window, since generateOccurrences()
// walks forward from `from` (nowEastern() internally) — tests queue no
// overrides unless noted, and assert purely on date math relative to
// whatever "now" actually is at test-run time via relative offsets.
function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("getFutureOccurrenceOptions", () => {
  it("returns an empty array for a non-recurring event whose startDate is in the past", async () => {
    mockDbState.queue = [[]]; // no cancelled overrides
    const past = daysFromNow(-10);
    const event: RecurringEvent & { isAllDay: boolean } = {
      startDate: `${ymd(past)} 09:00:00`,
      isRecurring: false,
      recurrenceType: null,
      recurrenceDays: null,
      recurrenceEndDate: null,
      isAllDay: false,
    };

    const options = await getFutureOccurrenceOptions("event-1", event);
    expect(options).toEqual([]);
  });

  it("returns a single date for a non-recurring event whose startDate is in the future", async () => {
    mockDbState.queue = [[]];
    const future = daysFromNow(10);
    const event: RecurringEvent & { isAllDay: boolean } = {
      startDate: `${ymd(future)} 09:00:00`,
      isRecurring: false,
      recurrenceType: null,
      recurrenceDays: null,
      recurrenceEndDate: null,
      isAllDay: false,
    };

    const options = await getFutureOccurrenceOptions("event-1", event);
    expect(options).toHaveLength(1);
    expect(options[0].date).toBe(ymd(future));
  });

  it("excludes a cancelled occurrence from an otherwise-future recurring series", async () => {
    const start = daysFromNow(1);
    const cancelled = daysFromNow(8); // one week after start, same weekday
    mockDbState.queue = [[{ occurrenceDate: ymd(cancelled) }]];

    const event: RecurringEvent & { isAllDay: boolean } = {
      startDate: `${ymd(start)} 18:00:00`,
      isRecurring: true,
      recurrenceType: "weekly",
      recurrenceDays: [start.getDay()],
      recurrenceEndDate: null,
      isAllDay: false,
    };

    const options = await getFutureOccurrenceOptions("event-1", event);
    expect(options.some((o) => o.date === ymd(cancelled))).toBe(false);
  });
});

describe("getEventAnnouncementHistory", () => {
  it("groups rows by batchId into one summary row with correct counts, newest first", async () => {
    // Rows arrive pre-ordered by sentAt DESC (matches the real query's
    // ORDER BY) — batch "b2" (newer) first, then batch "b1" (older).
    mockDbState.queue = [
      [
        {
          batchId: "b2",
          scope: "occurrence",
          occurrenceDate: "2026-10-15",
          success: true,
          note: null,
          sentAt: new Date("2026-09-10T12:00:00Z"),
          sentByName: "Jamie Smith",
          sentByEmail: "jamie@westervillelions.org",
        },
        {
          batchId: "b1",
          scope: "series",
          occurrenceDate: null,
          success: true,
          note: "Bring a friend!",
          sentAt: new Date("2026-09-01T12:00:00Z"),
          sentByName: "Jamie Smith",
          sentByEmail: "jamie@westervillelions.org",
        },
        {
          batchId: "b1",
          scope: "series",
          occurrenceDate: null,
          success: false,
          note: "Bring a friend!",
          sentAt: new Date("2026-09-01T12:00:00Z"),
          sentByName: "Jamie Smith",
          sentByEmail: "jamie@westervillelions.org",
        },
        {
          batchId: "b1",
          scope: "series",
          occurrenceDate: null,
          success: true,
          note: "Bring a friend!",
          sentAt: new Date("2026-09-01T12:00:00Z"),
          sentByName: "Jamie Smith",
          sentByEmail: "jamie@westervillelions.org",
        },
      ],
    ];

    const history = await getEventAnnouncementHistory("event-1");

    expect(history).toHaveLength(2);
    expect(history[0].batchId).toBe("b2"); // newest first
    expect(history[0].recipientCount).toBe(1);
    expect(history[0].successCount).toBe(1);
    expect(history[0].failureCount).toBe(0);

    expect(history[1].batchId).toBe("b1");
    expect(history[1].recipientCount).toBe(3);
    expect(history[1].successCount).toBe(2);
    expect(history[1].failureCount).toBe(1);
    expect(history[1].note).toBe("Bring a friend!");
  });

  it("returns an empty array when there is no history", async () => {
    mockDbState.queue = [[]];
    const history = await getEventAnnouncementHistory("event-1");
    expect(history).toEqual([]);
  });
});
