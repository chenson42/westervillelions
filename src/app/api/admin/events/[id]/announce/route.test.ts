/**
 * Unit tests for GET/POST /api/admin/events/[id]/announce.
 *
 * Covers the Phase 3 design doc's "Unit Tests To Deliver" items for this
 * route (docs/work-log/2026-09-04-event-announcement-emails.md):
 *   - GET: 401 no session; 403 for a session lacking EVENTS_ANNOUNCE
 *     specifically (Phase 2's flagged "wrong key" risk — asserted by
 *     checking the exact FEATURES key hasFeature() is called with, not just
 *     that SOME gate exists); 404 unknown event.
 *   - POST: rejects a cancelled occurrenceDate (400); rejects a
 *     non-existent occurrenceDate (400); rejects an empty resolved
 *     recipient set (400); rejects when the event has zero future
 *     occurrences (400); a partial sendBulkMemberEmail failure (1 of 3)
 *     still returns 200 with a success:false entry and a matching
 *     event_announcements row; every row from one POST shares one batchId;
 *     a member no longer active is classified no_longer_active and gets no
 *     row; a whitespace-only email is treated as no email on file.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/db (for
 * db.query.events.findFirst), @/lib/event-announcements-queries, and
 * @/lib/email. generateOccurrences/buildVEvent/buildIcsCalendar from
 * @/lib/events are NOT mocked — the occurrence-validation and ICS-building
 * assertions exercise the real helpers, same discipline as
 * src/app/api/events/[id]/ics/route already relies on.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { query: { events: { findFirst: vi.fn() } } },
}));
vi.mock("@/lib/event-announcements-queries", () => ({
  getAnnouncementRecipients: vi.fn(),
  getFutureOccurrenceOptions: vi.fn(),
  getCancelledOccurrenceDates: vi.fn(),
  getEventAnnouncementHistory: vi.fn(),
  insertEventAnnouncementRows: vi.fn(),
}));
vi.mock("@/lib/email", () => ({ sendBulkMemberEmail: vi.fn() }));

import { GET, POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { db } from "@/lib/db";
import {
  getAnnouncementRecipients,
  getFutureOccurrenceOptions,
  getCancelledOccurrenceDates,
  getEventAnnouncementHistory,
  insertEventAnnouncementRows,
} from "@/lib/event-announcements-queries";
import { sendBulkMemberEmail } from "@/lib/email";

function makeRequest(body: unknown = {}): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

// Tuesday, Jan 7 2020, weekly on Tuesdays, no end date. Validation uses
// parseWallClock(event.startDate) as the generation `from`, so occurrences
// are deterministic regardless of when the test suite actually runs.
const RECURRING_EVENT = {
  id: "event-1",
  title: "Weekly Meeting",
  description: null,
  location: "Clubhouse",
  isAllDay: false,
  isRecurring: true,
  recurrenceType: "weekly",
  recurrenceDays: [2],
  recurrenceEndDate: null,
  startDate: "2020-01-07 18:00:00",
  endDate: null,
  isPublic: false,
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(db.query.events.findFirst).mockReset();
  vi.mocked(getAnnouncementRecipients).mockReset();
  vi.mocked(getFutureOccurrenceOptions).mockReset().mockResolvedValue([
    { date: "2020-01-14", label: "Tuesday, January 14, 2020 at 6:00 PM" },
  ]);
  vi.mocked(getCancelledOccurrenceDates).mockReset().mockResolvedValue(new Set());
  vi.mocked(getEventAnnouncementHistory).mockReset().mockResolvedValue([]);
  vi.mocked(insertEventAnnouncementRows).mockReset().mockResolvedValue(undefined);
  vi.mocked(sendBulkMemberEmail).mockReset();
});

describe("GET /api/admin/events/[id]/announce", () => {
  it("401s with no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const response = await GET(makeRequest(), makeParams("event-1"));
    expect(response.status).toBe(401);
  });

  it("403s for a session lacking EVENTS_ANNOUNCE specifically", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);
    const response = await GET(makeRequest(), makeParams("event-1"));
    expect(response.status).toBe(403);
    expect(hasFeature).toHaveBeenCalledWith("user-1", FEATURES.EVENTS_ANNOUNCE);
  });

  it("404s for an unknown event", async () => {
    vi.mocked(db.query.events.findFirst).mockResolvedValue(undefined as never);
    const response = await GET(makeRequest(), makeParams("nope"));
    expect(response.status).toBe(404);
  });

  it("200s with the cohort split into withEmail/withoutEmail, no addresses sent to the client", async () => {
    vi.mocked(db.query.events.findFirst).mockResolvedValue(RECURRING_EVENT as never);
    vi.mocked(getAnnouncementRecipients).mockResolvedValue([
      { memberId: "m-1", firstName: "Pat", lastName: "Lee", email: "pat@westervillelions.org" },
      { memberId: "m-2", firstName: "Sam", lastName: "Ng", email: "" },
    ]);

    const response = await GET(makeRequest(), makeParams("event-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.recipients.withEmail).toEqual([{ memberId: "m-1", firstName: "Pat", lastName: "Lee" }]);
    expect(body.recipients.withoutEmail).toEqual([{ memberId: "m-2", firstName: "Sam", lastName: "Ng" }]);
    expect(JSON.stringify(body)).not.toContain("pat@westervillelions.org");
    expect(body.hasFutureOccurrence).toBe(true);
  });
});

describe("POST /api/admin/events/[id]/announce", () => {
  beforeEach(() => {
    vi.mocked(db.query.events.findFirst).mockResolvedValue(RECURRING_EVENT as never);
    vi.mocked(getAnnouncementRecipients).mockResolvedValue([
      { memberId: "m-1", firstName: "Pat", lastName: "Lee", email: "pat@westervillelions.org" },
    ]);
    vi.mocked(sendBulkMemberEmail).mockResolvedValue({
      results: [{ to: "pat@westervillelions.org", success: true, emailQueueId: "eq-1" }],
    });
  });

  it("rejects a cancelled occurrenceDate with 400", async () => {
    vi.mocked(getCancelledOccurrenceDates).mockResolvedValue(new Set(["2020-01-14"]));
    const response = await POST(
      makeRequest({ scope: "occurrence", occurrenceDate: "2020-01-14", memberIds: ["m-1"] }),
      makeParams("event-1"),
    );
    expect(response.status).toBe(400);
    expect(sendBulkMemberEmail).not.toHaveBeenCalled();
  });

  it("rejects a non-existent occurrenceDate with 400", async () => {
    const response = await POST(
      // 2020-01-15 is a Wednesday — not in this weekly-Tuesday series.
      makeRequest({ scope: "occurrence", occurrenceDate: "2020-01-15", memberIds: ["m-1"] }),
      makeParams("event-1"),
    );
    expect(response.status).toBe(400);
    expect(sendBulkMemberEmail).not.toHaveBeenCalled();
  });

  it("rejects an empty resolved recipient set with 400", async () => {
    vi.mocked(getAnnouncementRecipients).mockResolvedValue([
      { memberId: "m-1", firstName: "Pat", lastName: "Lee", email: "" },
    ]);
    const response = await POST(
      makeRequest({ scope: "occurrence", occurrenceDate: "2020-01-14", memberIds: ["m-1"] }),
      makeParams("event-1"),
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe("No recipients to send to.");
    expect(sendBulkMemberEmail).not.toHaveBeenCalled();
  });

  it("rejects when the event has zero future occurrences with 400", async () => {
    vi.mocked(getFutureOccurrenceOptions).mockResolvedValue([]);
    const response = await POST(
      makeRequest({ scope: "occurrence", occurrenceDate: "2020-01-14", memberIds: ["m-1"] }),
      makeParams("event-1"),
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe("This event has no upcoming occurrences to announce.");
    expect(sendBulkMemberEmail).not.toHaveBeenCalled();
  });

  it("a partial send failure (1 of 3) still returns 200, one row per attempt, all sharing one batchId", async () => {
    vi.mocked(getAnnouncementRecipients).mockResolvedValue([
      { memberId: "m-1", firstName: "Pat", lastName: "Lee", email: "pat@westervillelions.org" },
      { memberId: "m-2", firstName: "Sam", lastName: "Ng", email: "sam@westervillelions.org" },
      { memberId: "m-3", firstName: "Jo", lastName: "Kim", email: "jo@westervillelions.org" },
    ]);
    vi.mocked(sendBulkMemberEmail).mockResolvedValue({
      results: [
        { to: "pat@westervillelions.org", success: true, emailQueueId: "eq-1" },
        { to: "sam@westervillelions.org", success: false, error: "Resend API error", emailQueueId: "eq-2" },
        { to: "jo@westervillelions.org", success: true, emailQueueId: "eq-3" },
      ],
    });

    const response = await POST(
      makeRequest({
        scope: "occurrence",
        occurrenceDate: "2020-01-14",
        memberIds: ["m-1", "m-2", "m-3"],
      }),
      makeParams("event-1"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sent).toHaveLength(3);
    const failedEntry = body.sent.find((s: { memberId: string }) => s.memberId === "m-2");
    expect(failedEntry).toEqual({ memberId: "m-2", success: false, error: "Resend API error" });

    expect(insertEventAnnouncementRows).toHaveBeenCalledTimes(1);
    const insertedRows = vi.mocked(insertEventAnnouncementRows).mock.calls[0][0];
    expect(insertedRows).toHaveLength(3);
    const batchIds = new Set(insertedRows.map((r) => r.batchId));
    expect(batchIds.size).toBe(1);
    const failedRow = insertedRows.find((r) => r.memberId === "m-2");
    expect(failedRow?.success).toBe(false);
    expect(failedRow?.error).toBe("Resend API error");
  });

  it("a member no longer active at send time is classified no_longer_active and gets no row", async () => {
    vi.mocked(getAnnouncementRecipients).mockResolvedValue([
      { memberId: "m-1", firstName: "Pat", lastName: "Lee", email: "pat@westervillelions.org" },
      // m-gone is intentionally absent from the fresh active roster.
    ]);

    const response = await POST(
      makeRequest({ scope: "occurrence", occurrenceDate: "2020-01-14", memberIds: ["m-1", "m-gone"] }),
      makeParams("event-1"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.skipped).toContainEqual({ memberId: "m-gone", reason: "no_longer_active" });
    const insertedRows = vi.mocked(insertEventAnnouncementRows).mock.calls[0][0];
    expect(insertedRows.some((r) => r.memberId === "m-gone")).toBe(false);
  });

  it("a whitespace-only email is treated as no email on file", async () => {
    vi.mocked(getAnnouncementRecipients).mockResolvedValue([
      { memberId: "m-1", firstName: "Pat", lastName: "Lee", email: "   " },
    ]);
    const response = await POST(
      makeRequest({ scope: "occurrence", occurrenceDate: "2020-01-14", memberIds: ["m-1"] }),
      makeParams("event-1"),
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe("No recipients to send to.");
  });

  it("forces scope: 'occurrence' for a non-recurring event regardless of what was submitted", async () => {
    vi.mocked(db.query.events.findFirst).mockResolvedValue({
      ...RECURRING_EVENT,
      isRecurring: false,
      recurrenceType: null,
      recurrenceDays: null,
      startDate: "2020-01-07 18:00:00",
    } as never);

    const response = await POST(
      makeRequest({ scope: "series", memberIds: ["m-1"] }),
      makeParams("event-1"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.scope).toBe("occurrence");
    expect(body.occurrenceDate).toBe("2020-01-07");
    const insertedRows = vi.mocked(insertEventAnnouncementRows).mock.calls[0][0];
    expect(insertedRows.every((r) => r.scope === "occurrence")).toBe(true);
  });

  it("401s with no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const response = await POST(makeRequest(), makeParams("event-1"));
    expect(response.status).toBe(401);
  });

  it("403s for a session lacking EVENTS_ANNOUNCE specifically", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);
    const response = await POST(makeRequest(), makeParams("event-1"));
    expect(response.status).toBe(403);
    expect(hasFeature).toHaveBeenCalledWith("user-1", FEATURES.EVENTS_ANNOUNCE);
  });
});
