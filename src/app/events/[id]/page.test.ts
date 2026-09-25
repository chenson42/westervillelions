/**
 * Regression test for the privacy defect found in the Phase 6 (shipped-vs-
 * intent) review of docs/work-log/2026-09-25-recurring-occurrence-visibility.md:
 * /events/[id] is a PUBLIC route with no auth() check, yet it used to embed
 * real signee names (`r.userName ?? r.rsvpName`) into `OccurrenceRow.signees`
 * and `singleEventSignees`, both passed as props into <EventPersonalization>,
 * a Client Component. Every prop crossing a Server->Client boundary is
 * serialized into the page's RSC payload and ships to the browser regardless
 * of session — so an anonymous `curl` of the route returned real member
 * names in plaintext. This was true for *upcoming* occurrences before that
 * session's bug fix, and the fix (generating occurrences from the series
 * start instead of `now`) widened it to a series' entire historical roster.
 *
 * The fix: the page's server render now ALWAYS ships `signees: []` /
 * `singleEventSignees: []` — a signed-out baseline, exactly like the
 * existing `isSignedUp: false` baseline. Real names are only ever attached
 * client-side, via /api/events/[id]/viewer-context, which does its own
 * auth() check (see that route's own test file).
 *
 * This test proves the page's *server-computed* props never carry a real
 * name, for a recurring, requiresRsvp event with both past and upcoming
 * occurrences that have real signups. It fails without the fix (the old
 * code populated `signees`/`singleEventSignees` from real RSVP rows
 * unconditionally, with no auth() check anywhere in this file).
 *
 * Hermetic: calls the page's default export directly (same technique as
 * src/app/members/page.test.ts and .../ledger/search/page.test.ts), mocking
 * @/lib/db and @/lib/club-files-queries. generateOccurrences/parseWallClock/
 * nowEastern etc. from @/lib/events are NOT mocked, matching the discipline
 * already used by src/app/api/admin/events/[id]/announce/route.test.ts.
 * Never touches a real database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, isValidElement, type ReactNode } from "react";
import { format, subWeeks } from "date-fns";
import { generateOccurrences, parseWallClock, nowEastern } from "@/lib/events";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
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

vi.mock("@/lib/club-files-queries", () => ({
  getPublicAttachedFiles: vi.fn(() => Promise.resolve([])),
  getAllAttachedFiles: vi.fn(() => Promise.resolve([])),
}));

import EventDetailPage from "./page";
import { EventPersonalization } from "@/components/events/event-personalization";

// A real member's name, used only inside this test's mock DB rows — never
// written anywhere else in this repo. Assertions grep for this exact
// literal, not an incidental/ambient string, in the page's computed output.
const REAL_SIGNEE_NAME = "Test-Only Signee Name ZzYyXx";

// Computed relative to the real clock (not mocked — nowEastern() isn't
// mockable without also mocking @/lib/events, which this file deliberately
// doesn't do, per the announce-route test's discipline). generateOccurrences()
// caps at 200 occurrences (see src/lib/events.ts MAX_OCCURRENCES), so a
// weekly series starting ~100 weeks ago straddles "now" comfortably within
// that cap, giving both past and upcoming occurrences regardless of what day
// this suite actually runs.
const NOW = nowEastern();
const START_DATE = subWeeks(NOW, 100);
START_DATE.setHours(12, 30, 0, 0);

const RECURRING_EVENT = {
  id: "event-1",
  title: "Farmers Market",
  description: null,
  location: "Uptown",
  image: null,
  isAllDay: false,
  isRecurring: true,
  recurrenceType: "weekly",
  recurrenceDays: [START_DATE.getDay()],
  recurrenceEndDate: null,
  startDate: format(START_DATE, "yyyy-MM-dd HH:mm:ss"),
  endDate: format(START_DATE, "yyyy-MM-dd HH:mm:ss"),
  isPublic: true,
  requiresRsvp: true,
  maxAttendees: null,
  allowGuestCount: false,
  extraQuestion: null,
  extraQuestionType: null,
  extraQuestionOptions: [],
  extraQuestionRequired: false,
};

// The exact occurrence keys the page will generate for RECURRING_EVENT —
// used to build RSVP rows that land on real rows, not arbitrary dates the
// page would silently drop.
const GENERATED_OCCURRENCES = generateOccurrences(
  RECURRING_EVENT,
  parseWallClock(RECURRING_EVENT.startDate),
  520
);
const PAST_OCCURRENCE_KEY = format(
  GENERATED_OCCURRENCES.find((d) => d < NOW)!,
  "yyyy-MM-dd HH:mm:ss"
);
const UPCOMING_OCCURRENCE_KEY = format(
  GENERATED_OCCURRENCES.find((d) => d >= NOW)!,
  "yyyy-MM-dd HH:mm:ss"
);

function findElementsOfType(node: ReactNode, type: unknown, out: unknown[] = []): unknown[] {
  if (node == null || typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) findElementsOfType(child, type, out);
    return out;
  }
  if (isValidElement(node)) {
    if (node.type === type) out.push(node);
    const children = (node.props as { children?: ReactNode })?.children;
    if (children !== undefined) findElementsOfType(children, type, out);
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDbState.selectQueue = [];
});

describe("EventDetailPage (/events/[id]) — anonymous payload must never carry real signee names", () => {
  it("ships signees: [] on every occurrence row even when real RSVP rows exist, past and upcoming", async () => {
    // Matching real occurrence keys matters: the pre-fix code only populated
    // a row's `signees` when an RSVP's occurrenceDate matched that row's
    // generated key exactly (see the old signeesByDate.get(key) in
    // page.tsx), so a non-matching date would make this test pass for the
    // wrong reason even on unfixed code.
    //
    // 1) event lookup
    // 2) eventRsvps select (Promise.all first element) — real signups
    // 3) eventOccurrenceOverrides select (Promise.all second element)
    // 4) overridesForSeries select (series-level calendar button)
    mockDbState.selectQueue = [
      [RECURRING_EVENT],
      [
        // userName/rsvpName included even though the fixed query no longer
        // selects them — the mock doesn't enforce the select shape, so this
        // keeps the test a true regression guard: the pre-fix code read
        // these exact fields off each row to build `signees`.
        { occurrenceDate: PAST_OCCURRENCE_KEY, guestCount: 0, userName: REAL_SIGNEE_NAME, rsvpName: null },
        { occurrenceDate: UPCOMING_OCCURRENCE_KEY, guestCount: 0, userName: REAL_SIGNEE_NAME, rsvpName: null },
      ],
      [],
      [],
    ];

    const result = await EventDetailPage({ params: Promise.resolve({ id: "event-1" }) });

    const personalizationEls = findElementsOfType(result, EventPersonalization);
    expect(personalizationEls).toHaveLength(1);

    const props = (personalizationEls[0] as { props: Record<string, unknown> }).props;
    const occurrenceRows = props.occurrenceRows as Array<{ signees: string[]; isPast: boolean }>;

    // There must be at least one past and one upcoming row for this
    // assertion to actually exercise both halves of the widened leak.
    expect(occurrenceRows.some((r) => r.isPast)).toBe(true);
    expect(occurrenceRows.some((r) => !r.isPast)).toBe(true);

    for (const row of occurrenceRows) {
      expect(row.signees).toEqual([]);
    }
    expect(props.singleEventSignees).toEqual([]);

    // Belt-and-suspenders: the real name must not appear anywhere in the
    // props handed to the Client Component, under any key.
    expect(JSON.stringify(props)).not.toContain(REAL_SIGNEE_NAME);
  });

  it("ships singleEventSignees: [] for a non-recurring, requiresRsvp event with a real signup", async () => {
    const SINGLE_EVENT = {
      ...RECURRING_EVENT,
      isRecurring: false,
      recurrenceType: null,
      recurrenceDays: null,
    };

    mockDbState.selectQueue = [
      [SINGLE_EVENT],
      [{ occurrenceDate: null, guestCount: 0, userName: REAL_SIGNEE_NAME, rsvpName: null }],
      [],
    ];

    const result = await EventDetailPage({ params: Promise.resolve({ id: "event-1" }) });
    const personalizationEls = findElementsOfType(result, EventPersonalization);
    expect(personalizationEls).toHaveLength(1);

    const props = (personalizationEls[0] as { props: Record<string, unknown> }).props;
    expect(props.singleEventSignees).toEqual([]);
    expect(JSON.stringify(props)).not.toContain(REAL_SIGNEE_NAME);
  });
});

// Sanity check that findElementsOfType itself works, independent of the
// page under test — guards against the regression test above passing for
// the wrong reason (e.g. an empty tree matching trivially).
describe("findElementsOfType test helper", () => {
  it("finds a nested element by component reference", () => {
    function Leaf() {
      return null;
    }
    const tree = createElement("div", null, createElement("span", null, createElement(Leaf, { x: 1 })));
    const found = findElementsOfType(tree, Leaf);
    expect(found).toHaveLength(1);
  });
});
