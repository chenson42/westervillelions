/**
 * Unit tests for GET /api/events/[id]/viewer-context, covering the
 * `signeesByDate` field added by the Phase 6 rework of
 * docs/work-log/2026-09-25-recurring-occurrence-visibility.md.
 *
 * This route is the ONLY place real per-occurrence signee names may be
 * returned from — the page's server render (src/app/events/[id]/page.tsx)
 * always ships an empty `signees: []` / `singleEventSignees: []` baseline,
 * because that data crosses into a Client Component's serialized props and
 * would otherwise ship to every anonymous visitor of a public route
 * regardless of session. These tests prove:
 *   - an anonymous request gets `signeesByDate: {}` and never even queries
 *     the roster (auth() gates it before any name-bearing db.select() runs)
 *   - a signed-in-but-unlinked request (a session with `user.id` but no
 *     `user.memberId` — e.g. a first-time Google OAuth sign-in from an
 *     unrelated account, per the second Phase 6 pass on
 *     docs/work-log/2026-09-25-recurring-occurrence-visibility.md) ALSO gets
 *     `signeesByDate: {}` and never queries the roster — `signeesByDate` is
 *     the one field on this route that discloses OTHER members' data, so it
 *     is gated on an actual member link, not mere session presence
 *   - a signed-in, linked-member request gets the real roster, grouped by
 *     occurrence key (including the literal "null" key for a non-recurring
 *     event), for both a past-dated and an upcoming-dated occurrence
 *
 * Hermetic: mocks @/lib/auth, @/lib/db, and @/lib/club-files-queries. Same
 * select-queue chain technique as src/app/members/page.test.ts. Never
 * touches a real database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/club-files-queries", () => ({
  getAllAttachedFiles: vi.fn(() => Promise.resolve([{ id: "file-1", visibility: "members_only" }])),
  getPublicAttachedFiles: vi.fn(() => Promise.resolve([{ id: "file-1", visibility: "public" }])),
}));

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: { selectQueue: [] as unknown[][] },
}));

vi.mock("@/lib/db", () => {
  function chain(): unknown {
    const obj: Record<string, unknown> = {
      from: () => obj,
      leftJoin: () => obj,
      where: () => obj,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(mockDbState.selectQueue.shift() ?? []).then(resolve, reject),
    };
    return obj;
  }
  return {
    db: {
      select: vi.fn(() => chain()),
    },
  };
});

import { GET } from "./route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAllAttachedFiles, getPublicAttachedFiles } from "@/lib/club-files-queries";

const REAL_SIGNEE_NAME = "Test-Only Viewer Context Signee";

function makeParams(id = "event-1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDbState.selectQueue = [];
});

describe("GET /api/events/[id]/viewer-context — anonymous callers never see real names", () => {
  it("returns signeesByDate: {} and never touches db.select for an anonymous request", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const res = await GET(new Request("http://x/api/events/event-1/viewer-context"), makeParams());
    const body = await res.json();

    expect(body.isLoggedIn).toBe(false);
    expect(body.signeesByDate).toEqual({});
    expect(getPublicAttachedFiles).toHaveBeenCalledWith("event-1");
    expect(getAllAttachedFiles).not.toHaveBeenCalled();
    // Data minimization: an anonymous caller's request must never even
    // query the RSVP table for names — auth() gates it before any
    // name-bearing query runs, not after (never fetch-then-hide).
    expect(db.select).not.toHaveBeenCalled();
  });

  it("also refuses when auth() resolves a session with no user.id", async () => {
    vi.mocked(auth).mockResolvedValue({ user: {} } as never);

    const res = await GET(new Request("http://x/api/events/event-1/viewer-context"), makeParams());
    const body = await res.json();

    expect(body.isLoggedIn).toBe(false);
    expect(body.signeesByDate).toEqual({});
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns signeesByDate: {} and never issues the name-bearing roster query for a signed-in session with no linked member (e.g. a first-time OAuth sign-in from an unrelated Google account)", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-unlinked", name: "Viewer Name", memberId: null },
    } as never);

    // The caller's own-RSVP select is still allowed (it's the caller's own
    // data and can never return, since an unlinked user has no RSVPs), but
    // the roster ("every signup, across every member") must never run.
    mockDbState.selectQueue = [[]];

    const res = await GET(new Request("http://x/api/events/event-1/viewer-context"), makeParams());
    const body = await res.json();

    expect(body.isLoggedIn).toBe(true);
    expect(body.signeesByDate).toEqual({});
    // Only one db.select() call (the caller's own RSVPs) — the roster query
    // gated on memberId must never be issued.
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/events/[id]/viewer-context — a signed-in member receives the real roster", () => {
  it("returns real signee names grouped by occurrence key, for both a past and an upcoming date", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", name: "Viewer Name", memberId: "member-1" },
    } as never);

    // 1) rsvps select (Promise.all first element) — this viewer's own RSVPs
    // 2) allSignups select (Promise.all second element) — the real roster
    mockDbState.selectQueue = [
      [{ occurrenceDate: "2020-01-04 12:30:00", status: "attending", guestCount: 0, extraAnswer: null }],
      [
        { occurrenceDate: "2020-01-04 12:30:00", userName: REAL_SIGNEE_NAME, rsvpName: null },
        { occurrenceDate: "2099-01-03 12:30:00", userName: null, rsvpName: "Guest Signup Name" },
      ],
    ];

    const res = await GET(new Request("http://x/api/events/event-1/viewer-context"), makeParams());
    const body = await res.json();

    expect(body.isLoggedIn).toBe(true);
    expect(body.signeesByDate).toEqual({
      "2020-01-04 12:30:00": [REAL_SIGNEE_NAME],
      "2099-01-03 12:30:00": ["Guest Signup Name"],
    });
    expect(body.signedUpDates).toContain("2020-01-04 12:30:00");
    // A linked member sees the members-only-inclusive attached-files list.
    expect(getAllAttachedFiles).toHaveBeenCalledWith("event-1");
  });

  it("groups a non-recurring event's signee under the literal \"null\" key", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", name: "Viewer Name", memberId: "member-2" },
    } as never);

    mockDbState.selectQueue = [
      [{ occurrenceDate: null, status: "attending", guestCount: 0, extraAnswer: null }],
      [{ occurrenceDate: null, userName: REAL_SIGNEE_NAME, rsvpName: null }],
    ];

    const res = await GET(new Request("http://x/api/events/event-1/viewer-context"), makeParams());
    const body = await res.json();

    expect(body.signeesByDate).toEqual({ null: [REAL_SIGNEE_NAME] });
    expect(body.signedUpDates).toContain("null");
    // A linked member sees the members-only-inclusive attached-files list.
    expect(getAllAttachedFiles).toHaveBeenCalledWith("event-1");
  });
});
