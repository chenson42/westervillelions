/**
 * Unit tests for src/lib/event-announcements.ts.
 *
 * Covers the Phase 3 design doc's "Unit Tests To Deliver" item for this
 * module (docs/work-log/2026-09-04-event-announcement-emails.md):
 *   - classifyAnnouncementRecipients(): splits toSend/skipped with reasons
 *     no_longer_active / no_email_on_file / not_selected; de-dupes a
 *     repeated memberId.
 *   - renderAnnouncementSubject(): distinct wording for occurrence vs series.
 *   - renderAnnouncementBody(): escapes a first name and a note containing
 *     <script>, &, " — regression for the "one escaper copy omitted"
 *     incident CLAUDE.md cites.
 *   - renderAnnouncementBody(): non-recurring never renders series language;
 *     recurring + series uses formatRecurrence(); recurring + occurrence
 *     uses formatWallClockDate() for the CHOSEN date, not the series start.
 *   - renderAnnouncementBody(): an omitted/blank note renders no note block.
 */

import { describe, it, expect } from "vitest";
import {
  classifyAnnouncementRecipients,
  renderAnnouncementSubject,
  renderAnnouncementBody,
  type AnnouncementEventInput,
} from "@/lib/event-announcements";

function baseEvent(overrides: Partial<AnnouncementEventInput> = {}): AnnouncementEventInput {
  return {
    title: "Pancake Breakfast",
    description: null,
    location: null,
    isAllDay: false,
    isRecurring: false,
    recurrenceType: null,
    recurrenceDays: null,
    recurrenceEndDate: null,
    startDate: "2026-10-01 09:00:00",
    ...overrides,
  };
}

describe("classifyAnnouncementRecipients", () => {
  it("splits requested ids into toSend / skipped with the correct reasons", () => {
    const fresh = [
      { memberId: "m-active-selected", email: "a@westervillelions.org" },
      { memberId: "m-active-not-selected", email: "b@westervillelions.org" },
      { memberId: "m-no-email", email: "" },
    ];

    const result = classifyAnnouncementRecipients(
      ["m-active-selected", "m-gone"],
      fresh,
    );

    expect(result.toSend).toEqual([{ memberId: "m-active-selected", email: "a@westervillelions.org" }]);
    expect(result.skipped).toContainEqual({ memberId: "m-no-email", reason: "no_email_on_file" });
    expect(result.skipped).toContainEqual({ memberId: "m-active-not-selected", reason: "not_selected" });
    expect(result.skipped).toContainEqual({ memberId: "m-gone", reason: "no_longer_active" });
    expect(result.skipped).toHaveLength(3);
  });

  it("de-dupes a repeated memberId in the requested list", () => {
    const fresh = [{ memberId: "m-1", email: "a@westervillelions.org" }];
    const result = classifyAnnouncementRecipients(["m-1", "m-1", "m-1"], fresh);
    expect(result.toSend).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it("a whitespace-only email is treated as no email on file", () => {
    const fresh = [{ memberId: "m-1", email: "   " }];
    const result = classifyAnnouncementRecipients(["m-1"], fresh);
    expect(result.toSend).toHaveLength(0);
    expect(result.skipped).toEqual([{ memberId: "m-1", reason: "no_email_on_file" }]);
  });
});

describe("renderAnnouncementSubject", () => {
  it("uses distinct wording for occurrence vs series", () => {
    const occurrenceSubject = renderAnnouncementSubject("Pancake Breakfast", "occurrence");
    const seriesSubject = renderAnnouncementSubject("Pancake Breakfast", "series");
    expect(occurrenceSubject).not.toBe(seriesSubject);
    expect(seriesSubject.toLowerCase()).toContain("recurring");
    expect(occurrenceSubject.toLowerCase()).not.toContain("recurring");
  });
});

describe("renderAnnouncementBody", () => {
  it("escapes a first name and a note containing <script>, &, and \" — no raw tag survives", () => {
    const html = renderAnnouncementBody({
      firstName: '<script>alert("hi")</script>',
      event: baseEvent(),
      scope: "occurrence",
      occurrenceDate: new Date(2026, 9, 1, 9, 0, 0),
      icsDownloadUrl: "https://westervillelions.org/api/events/e1/ics",
      note: 'Bring chairs & tables <img src=x onerror="alert(1)">',
    });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
  });

  it("non-recurring event never renders series language even if scope is mistakenly 'series'", () => {
    const html = renderAnnouncementBody({
      firstName: "Pat",
      event: baseEvent({ isRecurring: false }),
      scope: "series",
      icsDownloadUrl: "https://westervillelions.org/api/events/e1/ics",
    });
    expect(html.toLowerCase()).not.toContain("recurring");
  });

  it("recurring + scope 'series' uses formatRecurrence() output, not a specific date", () => {
    const html = renderAnnouncementBody({
      firstName: "Pat",
      event: baseEvent({
        isRecurring: true,
        recurrenceType: "weekly",
        recurrenceDays: [2], // Tuesday
        startDate: "2026-10-06 18:30:00",
      }),
      scope: "series",
      icsDownloadUrl: "https://westervillelions.org/api/events/e1/ics",
    });
    expect(html).toContain("Every Tuesday");
  });

  it("recurring + scope 'occurrence' uses formatWallClockDate() for the CHOSEN date, not the series start date", () => {
    const html = renderAnnouncementBody({
      firstName: "Pat",
      event: baseEvent({
        isRecurring: true,
        recurrenceType: "weekly",
        recurrenceDays: [2],
        startDate: "2026-10-06 18:30:00", // series start: Oct 6
      }),
      scope: "occurrence",
      occurrenceDate: new Date(2026, 10, 3, 18, 30, 0), // chosen occurrence: Nov 3
      icsDownloadUrl: "https://westervillelions.org/api/events/e1/ics",
    });
    expect(html).toContain("November 3, 2026");
    expect(html).not.toContain("October 6, 2026");
  });

  it("an omitted note renders no note block", () => {
    const html = renderAnnouncementBody({
      firstName: "Pat",
      event: baseEvent(),
      scope: "occurrence",
      occurrenceDate: new Date(2026, 9, 1, 9, 0, 0),
      icsDownloadUrl: "https://westervillelions.org/api/events/e1/ics",
    });
    expect(html).not.toContain("background:#f5f7fb");
  });

  it("a blank (whitespace-only) note also renders no note block", () => {
    const html = renderAnnouncementBody({
      firstName: "Pat",
      event: baseEvent(),
      scope: "occurrence",
      occurrenceDate: new Date(2026, 9, 1, 9, 0, 0),
      icsDownloadUrl: "https://westervillelions.org/api/events/e1/ics",
      note: "   ",
    });
    expect(html).not.toContain("background:#f5f7fb");
  });
});
