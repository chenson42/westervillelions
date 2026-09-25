/**
 * Unit tests for the roster loading/failure affordance added to
 * OccurrenceSignupList as part of the second follow-up in the Phase 6
 * (second pass) review of
 * docs/work-log/2026-09-25-recurring-occurrence-visibility.md:
 *
 *   "the client-fetched roster has no loading state... a failed
 *   viewer-context fetch fails silently to the empty baseline with no
 *   retry and no user-visible indication... a member must never be shown
 *   an empty roster because a fetch failed."
 *
 * EventPersonalization (the real caller) drives `rosterStatus` from a
 * useEffect-based fetch, but React ignores effects during server-side
 * rendering, so this file exercises OccurrenceSignupList directly with each
 * `rosterStatus` value — the same prop-driven contract EventPersonalization
 * uses to remount/update it — via renderToStaticMarkup, the same technique
 * already used by src/components/members/member-directory.test.tsx for a
 * client component whose initial render needs no DOM APIs. This is a
 * hermetic, no-jsdom test consistent with the rest of this repo's component
 * tests.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OccurrenceSignupList } from "./occurrence-signup-list";
import type { OccurrenceRow } from "@/types/events";

function baseRow(overrides: Partial<OccurrenceRow> = {}): OccurrenceRow {
  return {
    date: "2026-09-19T16:30:00.000Z",
    dateKey: "2026-09-19",
    rsvpKey: "2026-09-19 12:30:00",
    displayDate: "Sat, Sep 19 at 12:30 PM",
    signedUpCount: 0,
    isSignedUp: false,
    isFull: false,
    isPast: false,
    signees: [],
    isCancelled: false,
    cancellationReason: null,
    googleUrl: null,
    outlookUrl: null,
    ...overrides,
  };
}

function render(rosterStatus: "loading" | "ready" | "error") {
  return renderToStaticMarkup(
    <OccurrenceSignupList
      eventId="event-1"
      occurrences={[baseRow()]}
      maxAttendees={null}
      isLoggedIn
      currentUserName="Viewer Name"
      rosterStatus={rosterStatus}
      onRetryRoster={() => {}}
    />
  );
}

describe("OccurrenceSignupList — roster loading/failure affordance", () => {
  it("renders a distinguishable loading indicator while the roster fetch is in flight", () => {
    const html = render("loading");

    expect(html).toContain("Loading who&#x27;s signed up");
    expect(html).not.toContain("Couldn&#x27;t load who&#x27;s signed up");
    expect(html).not.toContain(">Retry<");
  });

  it("renders a distinguishable, retryable failure state rather than silently showing an empty roster", () => {
    const html = render("error");

    expect(html).toContain("Couldn&#x27;t load who&#x27;s signed up");
    expect(html).toContain(">Retry<");
    expect(html).not.toContain("Loading who&#x27;s signed up");
  });

  it("shows neither the loading nor the error affordance once the roster has loaded", () => {
    const html = render("ready");

    expect(html).not.toContain("Loading who&#x27;s signed up");
    expect(html).not.toContain("Couldn&#x27;t load who&#x27;s signed up");
    expect(html).not.toContain(">Retry<");
  });

  it("defaults to the ready (no-banner) state when rosterStatus is omitted, for callers that don't track it", () => {
    const html = renderToStaticMarkup(
      <OccurrenceSignupList
        eventId="event-1"
        occurrences={[baseRow()]}
        maxAttendees={null}
        isLoggedIn
        currentUserName="Viewer Name"
      />
    );

    expect(html).not.toContain("Loading who&#x27;s signed up");
    expect(html).not.toContain("Couldn&#x27;t load who&#x27;s signed up");
  });
});
