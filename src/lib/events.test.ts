import { describe, it, expect } from "vitest";
import {
  getNextOccurrence,
  generateOccurrences,
  formatRecurrence,
  isValidOccurrence,
  parseWallClock,
  dateKey,
  easternOffsetFor,
  formatEventWhen,
  buildIcsCalendar,
  buildVEvent,
  buildGoogleCalendarUrl,
  buildOutlookCalendarUrl,
  icsEscape,
  icsFold,
  toIcsFilename,
  type RecurringEvent,
  type IcsEventInput,
} from "./events";

// ── Fixtures ──────────────────────────────────────────────────────────────────
// All startDate / recurrenceEndDate values are wall-clock strings "YYYY-MM-DD HH:MM:SS"
// — what Drizzle mode:"string" returns from the DB. See DECISION-005.
// The `now` arguments remain true Date objects (they represent real instants, not event times).

const baseRecurring: RecurringEvent = {
  startDate: "2026-05-16 12:30:00",
  isRecurring: true,
  recurrenceType: "weekly",
  recurrenceDays: [6], // Saturday
  recurrenceEndDate: "2026-09-26 00:00:00",
};

describe("getNextOccurrence", () => {
  it("returns null for a non-recurring event whose start date has passed", () => {
    const event: RecurringEvent = {
      ...baseRecurring,
      isRecurring: false,
      recurrenceType: null,
      recurrenceDays: null,
      recurrenceEndDate: null,
    };

    const result = getNextOccurrence(event, new Date("2026-06-01T00:00:00.000Z"));

    expect(result).toBeNull();
  });

  it("returns the start date for a non-recurring event whose start date is in the future", () => {
    const event: RecurringEvent = {
      ...baseRecurring,
      isRecurring: false,
      recurrenceType: null,
      recurrenceDays: null,
      recurrenceEndDate: null,
      startDate: "2027-01-01 12:00:00",
    };

    const result = getNextOccurrence(event, new Date("2026-06-01T00:00:00.000Z"));

    expect(result).not.toBeNull();
    // Use local components — the wall-clock model guarantees local date/time
    expect(dateKey(result!)).toBe("2027-01-01");
    expect(result!.getHours()).toBe(12);
    expect(result!.getMinutes()).toBe(0);
  });

  it("returns null when a recurring series's recurrenceEndDate has passed — regression for past-events misclassification", () => {
    // This is the regression test for v1.11.6: a weekly series that ended in
    // September should NOT show up as upcoming when "now" is October.
    const result = getNextOccurrence(baseRecurring, new Date("2026-10-01T00:00:00.000Z"));

    expect(result).toBeNull();
  });

  it("returns a future occurrence when the recurring series is still active", () => {
    // "Now" is mid-May 2026; the next Saturday occurrence should be May 23.
    const result = getNextOccurrence(baseRecurring, new Date("2026-05-18T00:00:00.000Z"));

    expect(result).not.toBeNull();
    // Saturday after May 18 is May 23.
    expect(result!.getDate()).toBe(23);
    expect(result!.getMonth()).toBe(4); // May (0-indexed), local
  });

  it("handles a monthly recurrence", () => {
    const monthly: RecurringEvent = {
      startDate: "2026-01-15 18:00:00",
      isRecurring: true,
      recurrenceType: "monthly",
      recurrenceDays: null,
      recurrenceEndDate: null,
    };

    const result = getNextOccurrence(monthly, new Date("2026-03-20T00:00:00.000Z"));

    expect(result!.getDate()).toBe(15);
    expect(result!.getMonth()).toBe(3); // April, local
  });

  // ── cancelledDates exclusion — regression guard for DECISION-002 ────────────
  // These tests guard the new cancelledDates: Set<string> parameter added in v1.13.0.
  // Failing any of these means getNextOccurrence silently shows a cancelled date
  // to public visitors on /events.

  it("skips a cancelled weekly occurrence and returns the following date — regression for cancelled-date skip in getNextOccurrence", () => {
    // Arrange: weekly Saturday series; May 23 is the immediate next Saturday but it is cancelled.
    const cancelledDates = new Set(["2026-05-23"]);

    const result = getNextOccurrence(
      baseRecurring,
      new Date("2026-05-18T00:00:00.000Z"),
      cancelledDates
    );

    // Assert: should skip May 23 and return May 30 instead
    expect(result).not.toBeNull();
    expect(dateKey(result!)).toBe("2026-05-30");
  });

  it("skips multiple consecutive cancelled weekly occurrences and returns the first uncancelled date — regression for cancelled-date skip in getNextOccurrence", () => {
    // Arrange: cancel two consecutive Saturdays; next uncancelled Saturday is June 6.
    const cancelledDates = new Set(["2026-05-23", "2026-05-30"]);

    const result = getNextOccurrence(
      baseRecurring,
      new Date("2026-05-18T00:00:00.000Z"),
      cancelledDates
    );

    expect(result).not.toBeNull();
    expect(dateKey(result!)).toBe("2026-06-06");
  });

  it("returns null when all remaining occurrences in the series are cancelled — regression for cancelled-date skip in getNextOccurrence", () => {
    // Arrange: only two Saturdays remain (May 23 and May 30) before recurrenceEndDate (May 31).
    const tightSeries: RecurringEvent = {
      ...baseRecurring,
      recurrenceEndDate: "2026-05-31 00:00:00",
    };
    const cancelledDates = new Set(["2026-05-23", "2026-05-30"]);

    const result = getNextOccurrence(
      tightSeries,
      new Date("2026-05-18T00:00:00.000Z"),
      cancelledDates
    );

    // Assert: no uncancelled occurrence remains — should be null
    expect(result).toBeNull();
  });

  it("skips a cancelled monthly occurrence and returns the next month — regression for cancelled-date skip in getNextOccurrence", () => {
    // Arrange: monthly series on the 15th; April 15 is cancelled.
    const monthly: RecurringEvent = {
      startDate: "2026-01-15 18:00:00",
      isRecurring: true,
      recurrenceType: "monthly",
      recurrenceDays: null,
      recurrenceEndDate: null,
    };
    const cancelledDates = new Set(["2026-04-15"]);

    const result = getNextOccurrence(
      monthly,
      new Date("2026-03-20T00:00:00.000Z"),
      cancelledDates
    );

    // Assert: April is cancelled; should land on May 15
    expect(result).not.toBeNull();
    expect(dateKey(result!)).toBe("2026-05-15");
  });

  it("does not skip an occurrence when cancelledDates is an empty set — regression for cancelled-date skip in getNextOccurrence", () => {
    // Arrange: default (empty set) — should behave identically to the no-argument call
    const resultWithEmpty = getNextOccurrence(
      baseRecurring,
      new Date("2026-05-18T00:00:00.000Z"),
      new Set()
    );
    const resultWithDefault = getNextOccurrence(
      baseRecurring,
      new Date("2026-05-18T00:00:00.000Z")
    );

    // Assert: both should return the same date
    expect(dateKey(resultWithEmpty!)).toBe(dateKey(resultWithDefault!));
    expect(resultWithEmpty!.getHours()).toBe(resultWithDefault!.getHours());
  });
});

describe("generateOccurrences", () => {
  it("returns the startDate as the sole element for a non-recurring event", () => {
    const event: RecurringEvent = {
      startDate: "2026-07-04 12:00:00",
      isRecurring: false,
      recurrenceType: null,
      recurrenceDays: null,
      recurrenceEndDate: null,
    };

    const result = generateOccurrences(event, new Date("2026-06-01T00:00:00.000Z"));

    expect(result).toHaveLength(1);
    expect(dateKey(result[0])).toBe("2026-07-04");
    expect(result[0].getHours()).toBe(12);
    expect(result[0].getMinutes()).toBe(0);
  });

  it("generates weekly occurrences within the series window", () => {
    const event: RecurringEvent = {
      startDate: "2026-05-16 12:30:00",
      isRecurring: true,
      recurrenceType: "weekly",
      recurrenceDays: [6], // Saturday
      recurrenceEndDate: "2026-05-31 23:59:00",
    };

    const result = generateOccurrences(event, new Date("2026-05-14T00:00:00.000Z"));

    // Assert: May 16, May 23, May 30 should be in window
    const keys = result.map((d) => dateKey(d));
    expect(keys).toContain("2026-05-16");
    expect(keys).toContain("2026-05-23");
    expect(keys).toContain("2026-05-30");
    expect(keys.length).toBeGreaterThanOrEqual(3);
  });

  it("does not return occurrences before the from parameter", () => {
    const event: RecurringEvent = {
      startDate: "2026-05-16 12:30:00",
      isRecurring: true,
      recurrenceType: "weekly",
      recurrenceDays: [6],
      recurrenceEndDate: null,
    };

    const from = new Date("2026-05-31T00:00:00.000Z");
    const result = generateOccurrences(event, from, 4);

    // Assert: results must be on or after the from date
    for (const d of result) {
      expect(d.getTime()).toBeGreaterThanOrEqual(from.getTime());
    }
  });

  it("generates biweekly occurrences alternating every other week", () => {
    const event: RecurringEvent = {
      startDate: "2026-05-16 12:30:00",
      isRecurring: true,
      recurrenceType: "biweekly",
      recurrenceDays: [6], // Saturday
      recurrenceEndDate: null,
    };

    const result = generateOccurrences(event, new Date("2026-05-14T00:00:00.000Z"), 8);

    const keys = result.map((d) => dateKey(d));
    expect(keys).toContain("2026-05-16");
    expect(keys).not.toContain("2026-05-23"); // week 1 offset — not a biweekly occurrence
    expect(keys).toContain("2026-05-30"); // week 2 offset — biweekly occurrence
  });

  it("generates monthly occurrences on the same day of the month", () => {
    const event: RecurringEvent = {
      startDate: "2026-01-15 18:00:00",
      isRecurring: true,
      recurrenceType: "monthly",
      recurrenceDays: null,
      recurrenceEndDate: null,
    };

    // generate 13 weeks from February 1 (should get Feb, Mar, Apr 15)
    const result = generateOccurrences(event, new Date("2026-02-01T00:00:00.000Z"), 13);

    const days = result.map((d) => d.getDate()); // local day
    expect(days.every((d) => d === 15)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(3); // at least Feb, Mar, Apr
  });

  it("respects recurrenceEndDate and generates no occurrences past it", () => {
    const event: RecurringEvent = {
      startDate: "2026-05-16 12:30:00",
      isRecurring: true,
      recurrenceType: "weekly",
      recurrenceDays: [6],
      recurrenceEndDate: "2026-05-25 00:00:00",
    };

    const result = generateOccurrences(event, new Date("2026-05-14T00:00:00.000Z"));

    const keys = result.map((d) => dateKey(d));
    // May 30 is after the end date
    expect(keys).not.toContain("2026-05-30");
  });
});

describe("getNextOccurrence — biweekly", () => {
  it("returns the first biweekly Saturday occurrence when the series is active", () => {
    const event: RecurringEvent = {
      startDate: "2026-05-16 12:30:00",
      isRecurring: true,
      recurrenceType: "biweekly",
      recurrenceDays: [6],
      recurrenceEndDate: null,
    };

    // now is May 18 (after the May 16 start but before the next biweekly)
    const result = getNextOccurrence(event, new Date("2026-05-18T00:00:00.000Z"));

    // next biweekly Saturday after May 16 is May 30
    expect(result).not.toBeNull();
    expect(dateKey(result!)).toBe("2026-05-30");
  });

  it("skips a cancelled biweekly occurrence and returns the following biweekly date", () => {
    const event: RecurringEvent = {
      startDate: "2026-05-16 12:30:00",
      isRecurring: true,
      recurrenceType: "biweekly",
      recurrenceDays: [6],
      recurrenceEndDate: null,
    };
    const cancelledDates = new Set(["2026-05-30"]);

    const result = getNextOccurrence(
      event,
      new Date("2026-05-18T00:00:00.000Z"),
      cancelledDates
    );

    // May 30 skipped; next biweekly Saturday is June 13
    expect(result).not.toBeNull();
    expect(dateKey(result!)).toBe("2026-06-13");
  });
});

describe("isValidOccurrence", () => {
  it("returns true when the candidate exactly matches an occurrence", () => {
    // Occurrences generated by parseWallClock from wall-clock strings
    const d = parseWallClock("2026-05-23 12:30:00");
    const occurrences = [
      parseWallClock("2026-05-16 12:30:00"),
      parseWallClock("2026-05-23 12:30:00"),
      parseWallClock("2026-05-30 12:30:00"),
    ];

    expect(isValidOccurrence(d, occurrences)).toBe(true);
  });

  it("returns false when the candidate does not match any occurrence", () => {
    const d = parseWallClock("2026-05-24 12:30:00"); // Sunday — not a recurrence day
    const occurrences = [
      parseWallClock("2026-05-23 12:30:00"),
      parseWallClock("2026-05-30 12:30:00"),
    ];

    expect(isValidOccurrence(d, occurrences)).toBe(false);
  });

  it("returns true for a candidate within 30 seconds of a listed occurrence (clock-drift tolerance)", () => {
    const occurrence = parseWallClock("2026-05-23 12:30:00");
    // Add 20 seconds manually
    const candidate = new Date(occurrence.getTime() + 20000);

    expect(isValidOccurrence(candidate, [occurrence])).toBe(true);
  });

  it("returns false for a candidate more than 30 seconds from any listed occurrence", () => {
    const occurrence = parseWallClock("2026-05-23 12:30:00");
    // 45 seconds after — rounds to the next minute
    const candidate = new Date(occurrence.getTime() + 45000);

    expect(isValidOccurrence(candidate, [occurrence])).toBe(false);
  });
});

describe("formatRecurrence", () => {
  it("returns null for a non-recurring event", () => {
    const result = formatRecurrence({
      ...baseRecurring,
      isRecurring: false,
      recurrenceType: null,
      recurrenceDays: null,
      recurrenceEndDate: null,
    });

    expect(result).toBeNull();
  });

  it("formats a weekly recurrence with a single day", () => {
    const result = formatRecurrence(baseRecurring);

    expect(result).toContain("Every Saturday");
    expect(result).toContain("May 16");
    // The end date is parsed as local wall-clock: "2026-09-26 00:00:00" → Sep 26, 2026
    expect(result).toContain("Sep 26, 2026");
  });

  it("formats a biweekly recurrence", () => {
    const result = formatRecurrence({ ...baseRecurring, recurrenceType: "biweekly" });

    expect(result?.startsWith("Every other Saturday")).toBe(true);
  });

  it("formats a monthly recurrence", () => {
    const result = formatRecurrence({
      ...baseRecurring,
      recurrenceType: "monthly",
      recurrenceDays: null,
    });

    expect(result?.startsWith("Monthly")).toBe(true);
  });
});

// ── easternOffsetFor ─────────────────────────────────────────────────────────
describe("easternOffsetFor", () => {
  it("returns -05:00 for a standard-time date in January", () => {
    // January is always EST
    const result = easternOffsetFor(new Date(2026, 0, 15)); // Jan 15, 2026

    expect(result).toBe("-05:00");
  });

  it("returns -04:00 for a DST date in July", () => {
    // July 4 is always EDT
    const result = easternOffsetFor(new Date(2026, 6, 4)); // Jul 4, 2026

    expect(result).toBe("-04:00");
  });

  it("returns -05:00 just before the spring-forward boundary on March 8, 2026", () => {
    // DST starts at 02:00 AM on the second Sunday of March (Mar 8, 2026)
    // One minute before the switch is still standard time
    const result = easternOffsetFor(new Date(2026, 2, 8, 1, 59)); // Mar 8 01:59 local

    expect(result).toBe("-05:00");
  });

  it("returns -04:00 just after the spring-forward boundary on March 8, 2026", () => {
    // At or after 02:00 AM on Mar 8, 2026 is DST
    const result = easternOffsetFor(new Date(2026, 2, 8, 2, 1)); // Mar 8 02:01 local

    expect(result).toBe("-04:00");
  });

  it("returns -04:00 just before the fall-back boundary on November 1, 2026", () => {
    // First Sunday of November 2026 is Nov 1; DST ends at 02:00 AM
    const result = easternOffsetFor(new Date(2026, 10, 1, 1, 59)); // Nov 1 01:59

    expect(result).toBe("-04:00");
  });

  it("returns -05:00 at and after the fall-back boundary on November 1, 2026", () => {
    // At 02:00 AM on Nov 1, 2026 we fall back to standard time
    const result = easternOffsetFor(new Date(2026, 10, 1, 2, 1)); // Nov 1 02:01

    expect(result).toBe("-05:00");
  });
});

// ── formatEventWhen ─────────────────────────────────────────────────────────
describe("formatEventWhen", () => {
  it("formats a timed event with the full date and time suffix", () => {
    const result = formatEventWhen({ startDate: "2026-07-04 12:30:00", isAllDay: false });

    expect(result).toMatch(/Saturday, July 4, 2026 at 12:30 PM/);
  });

  it("formats an all-day event with the full date but no time suffix", () => {
    // isAllDay branch — the critical coverage target
    const result = formatEventWhen({ startDate: "2026-07-04 00:00:00", isAllDay: true });

    expect(result).toBe("Saturday, July 4, 2026");
    // Must not contain " at " (time suffix) — "at" alone would false-fail on "SaturdAT"
    expect(result).not.toContain(" at ");
    expect(result).not.toContain("12:00");
  });
});

// ── getNextOccurrence — edge branches ────────────────────────────────────────
describe("getNextOccurrence — edge branches", () => {
  it("falls back to startDate day-of-week when recurrenceDays is null for a weekly series", () => {
    // Covers the no-recurrenceDays branch (lines 175-178) in getNextOccurrence
    const event: RecurringEvent = {
      startDate: "2026-05-16 12:30:00", // Saturday
      isRecurring: true,
      recurrenceType: "weekly",
      recurrenceDays: null, // no explicit days — fall back to startDate day-of-week
      recurrenceEndDate: null,
    };

    const result = getNextOccurrence(event, new Date("2026-05-18T00:00:00.000Z"));

    // Next Saturday after May 18 is May 23
    expect(result).not.toBeNull();
    expect(dateKey(result!)).toBe("2026-05-23");
  });

  it("returns null for an unknown recurrence type when startDate is in the past", () => {
    // Covers the unknown-type fallback (line 184) when the start is not in the future
    const event: RecurringEvent = {
      startDate: "2026-01-01 12:00:00",
      isRecurring: true,
      recurrenceType: "unknown-type",
      recurrenceDays: null,
      recurrenceEndDate: null,
    };

    const result = getNextOccurrence(event, new Date("2026-05-18T00:00:00.000Z"));

    expect(result).toBeNull();
  });

  it("returns startDate for an unknown recurrence type when startDate is in the future", () => {
    // Covers the unknown-type fallback returning startDate when it's future
    const event: RecurringEvent = {
      startDate: "2027-06-01 12:00:00",
      isRecurring: true,
      recurrenceType: "unknown-type",
      recurrenceDays: null,
      recurrenceEndDate: null,
    };

    const result = getNextOccurrence(event, new Date("2026-05-18T00:00:00.000Z"));

    expect(result).not.toBeNull();
    expect(dateKey(result!)).toBe("2027-06-01");
  });

  it("returns null when weekly search window exhausts all candidates due to series end — covers findNextDayOfWeek exhaustion", () => {
    // Covers the return null at the end of findNextDayOfWeek (line 230)
    // All remaining occurrences in the series are cancelled
    const event: RecurringEvent = {
      startDate: "2026-05-16 12:30:00",
      isRecurring: true,
      recurrenceType: "weekly",
      recurrenceDays: [6], // Saturday
      recurrenceEndDate: "2026-05-31 00:00:00", // Only May 23 and May 30 remain
    };
    // Cancel all remaining Saturdays
    const cancelledDates = new Set(["2026-05-23", "2026-05-30"]);

    const result = getNextOccurrence(
      event,
      new Date("2026-05-18T00:00:00.000Z"),
      cancelledDates
    );

    expect(result).toBeNull();
  });
});

// ── DST boundary test ─────────────────────────────────────────────────────────
describe("DST boundary — wall-clock stability across spring-forward", () => {
  it("preserves 12:30 PM wall-clock on weekly occurrences across the March 8, 2026 spring-forward", () => {
    // DST starts March 8, 2026 (second Sunday of March).
    // A weekly Sunday series starting March 1 at 12:30 should land at 12:30 on
    // March 1 (before DST), March 8 (DST day), and March 15 (after DST).
    // date-fns addDays() is calendar-safe and preserves local hour component across DST.
    const event: RecurringEvent = {
      startDate: "2026-03-01 12:30:00",
      isRecurring: true,
      recurrenceType: "weekly",
      recurrenceDays: [0], // Sunday
      recurrenceEndDate: null,
    };

    // Start from a moment before the series begins
    const results = generateOccurrences(event, new Date("2026-02-28T00:00:00.000Z"), 3);

    // All three occurrences must have local hour === 12, minute === 30
    for (const d of results.slice(0, 3)) {
      expect(d.getHours()).toBe(12);
      expect(d.getMinutes()).toBe(30);
    }
    expect(dateKey(results[0])).toBe("2026-03-01");
    expect(dateKey(results[1])).toBe("2026-03-08");
    expect(dateKey(results[2])).toBe("2026-03-15");
  });
});

// ── ICS generator ─────────────────────────────────────────────────────────────
//
// These tests are the primary guard against the wall-clock / naive-UTC bug
// (DECISION-005, memory: project_naive_timestamp_tz_bug). Every test that
// touches DTSTART must verify the local hour component is preserved, NOT
// silently converted to UTC.

const baseIcsEvent: IcsEventInput = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  title: "Lions Club Monthly Meeting",
  description: "Join us for our regular monthly meeting.",
  location: "Westerville Community Center",
  isAllDay: false,
  startDate: "2026-07-04 12:30:00",
  endDate: null,
  isPublic: true,
  url: "https://westervillelions.org/events/550e8400-e29b-41d4-a716-446655440000",
};

describe("icsEscape", () => {
  it("escapes backslashes before other characters", () => {
    expect(icsEscape("a\\b")).toBe("a\\\\b");
  });

  it("escapes semicolons", () => {
    expect(icsEscape("a;b")).toBe("a\\;b");
  });

  it("escapes commas", () => {
    expect(icsEscape("a,b")).toBe("a\\,b");
  });

  it("converts literal newlines to \\n escape sequences", () => {
    expect(icsEscape("line1\nline2")).toBe("line1\\nline2");
  });

  it("escapes a string containing all four special characters", () => {
    const input = "back\\slash;semi,comma\nnewline";
    const result = icsEscape(input);
    // Backslash is doubled; each special char gets a backslash prefix
    expect(result).toBe("back\\\\slash\\;semi\\,comma\\nnewline");
    // Must not contain unescaped semicolon, comma, or raw newline
    expect(result).not.toMatch(/(?<!\\);/);
    expect(result).not.toMatch(/(?<!\\),/);
    expect(result).not.toContain("\n");
  });
});

describe("icsFold", () => {
  it("returns a short line unchanged (≤75 octets)", () => {
    const line = "SUMMARY:Short title";
    expect(icsFold(line)).toBe(line);
  });

  it("folds a line that exceeds 75 octets with CRLF + space continuation", () => {
    // Construct a line that is exactly 80 ASCII characters
    const line = "SUMMARY:" + "A".repeat(72); // "SUMMARY:" = 8 chars, total = 80
    const folded = icsFold(line);
    expect(folded).toContain("\r\n ");
    // First segment must be exactly 75 bytes
    const firstLine = folded.split("\r\n")[0];
    expect(Buffer.byteLength(firstLine, "utf8")).toBe(75);
  });

  it("folds correctly on multibyte UTF-8 characters — must not split a multibyte sequence", () => {
    // "é" is 2 bytes in UTF-8. Build a line long enough to need folding
    // where the fold boundary would fall inside a 2-byte character if using char-length.
    // "SUMMARY:" = 8 bytes. Fill with 33 ASCII chars (41 total), then 17 "é" chars = 34 bytes,
    // total = 75 bytes — exactly at boundary. Next "é" starts at byte 76.
    const prefix = "SUMMARY:" + "A".repeat(33); // 41 bytes
    const accents = "é".repeat(20);              // 40 bytes → total 81 bytes
    const line = prefix + accents;
    const folded = icsFold(line);
    // Must contain a fold
    expect(folded).toContain("\r\n ");
    // Reconstruct: remove CRLF+space continuations and verify round-trip
    const reconstructed = folded.replace(/\r\n /g, "");
    expect(reconstructed).toBe(line);
  });

  it("folds a very long description into multiple continuation lines", () => {
    const longLine = "DESCRIPTION:" + "X".repeat(300);
    const folded = icsFold(longLine);
    const segments = folded.split("\r\n");
    // First segment ≤ 75 bytes; each continuation starts with a space
    expect(Buffer.byteLength(segments[0], "utf8")).toBeLessThanOrEqual(75);
    for (const seg of segments.slice(1)) {
      expect(seg.startsWith(" ")).toBe(true);
      // Continuation body (excluding the leading space) ≤ 74 bytes
      expect(Buffer.byteLength(seg.slice(1), "utf8")).toBeLessThanOrEqual(74);
    }
  });
});

describe("toIcsFilename", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(toIcsFilename("Lions Club Monthly Meeting")).toBe("lions-club-monthly-meeting.ics");
  });

  it("strips special characters and collapses runs to a single hyphen", () => {
    expect(toIcsFilename("Summer Fun & BBQ!")).toBe("summer-fun-bbq.ics");
  });

  it("trims leading and trailing hyphens", () => {
    expect(toIcsFilename("---Weird Title---")).toBe("weird-title.ics");
  });

  it("caps the base name at 60 characters", () => {
    const long = "a".repeat(80);
    const result = toIcsFilename(long);
    // 60 chars + ".ics" = 64 chars total
    expect(result.length).toBeLessThanOrEqual(64);
    expect(result.endsWith(".ics")).toBe(true);
  });
});

describe("buildVEvent — timed events (regression: wall-clock / naive-UTC bug)", () => {
  it("emits DTSTART;TZID=America/New_York with wall-clock local time, NOT a UTC-shifted value", () => {
    // This is the primary regression test for the naive-UTC bug.
    // Event is at 12:30 PM Eastern. In EDT (UTC-4) that would be 16:30Z.
    // The ICS output must show 12:30, never 16:30 or 08:30.
    const occurrence = parseWallClock("2026-07-04 12:30:00"); // EDT (UTC-4)
    const vevent = buildVEvent(baseIcsEvent, occurrence);

    // Must contain TZID=America/New_York with the local time
    expect(vevent).toContain("DTSTART;TZID=America/New_York:20260704T123000");
    // Must NOT contain a UTC timestamp (trailing Z) for the start
    expect(vevent).not.toMatch(/DTSTART[^:]*:20260704T163000Z/);
    expect(vevent).not.toMatch(/DTSTART[^:]*:20260704T083000Z/);
  });

  it("emits DTSTART with wall-clock time in EST (UTC-5) during winter months", () => {
    // January — standard time. If naive UTC were applied: 12:30 + 5h = 17:30Z.
    const occurrence = parseWallClock("2026-01-15 12:30:00");
    const vevent = buildVEvent(baseIcsEvent, occurrence);

    expect(vevent).toContain("DTSTART;TZID=America/New_York:20260115T123000");
    expect(vevent).not.toMatch(/DTSTART[^:]*:20260115T173000Z/);
  });

  it("derives DTEND as occurrence + 1 hour when endDate is null", () => {
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const vevent = buildVEvent(baseIcsEvent, occurrence);

    expect(vevent).toContain("DTEND;TZID=America/New_York:20260704T133000");
  });

  it("uses endDate time component for DTEND when endDate is set", () => {
    const eventWithEnd: IcsEventInput = {
      ...baseIcsEvent,
      endDate: "2026-07-04 15:00:00",
    };
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const vevent = buildVEvent(eventWithEnd, occurrence);

    expect(vevent).toContain("DTEND;TZID=America/New_York:20260704T150000");
  });

  it("emits SUMMARY with the event title (escaped)", () => {
    const vevent = buildVEvent(baseIcsEvent, parseWallClock("2026-07-04 12:30:00"));
    expect(vevent).toContain("SUMMARY:Lions Club Monthly Meeting");
  });

  it("emits LOCATION when present (escaped)", () => {
    const vevent = buildVEvent(baseIcsEvent, parseWallClock("2026-07-04 12:30:00"));
    expect(vevent).toContain("LOCATION:Westerville Community Center");
  });

  it("omits LOCATION when null", () => {
    const noLoc: IcsEventInput = { ...baseIcsEvent, location: null };
    const vevent = buildVEvent(noLoc, parseWallClock("2026-07-04 12:30:00"));
    expect(vevent).not.toContain("LOCATION:");
  });

  it("emits DESCRIPTION when present", () => {
    const vevent = buildVEvent(baseIcsEvent, parseWallClock("2026-07-04 12:30:00"));
    expect(vevent).toContain("DESCRIPTION:");
  });

  it("omits DESCRIPTION when null", () => {
    const noDesc: IcsEventInput = { ...baseIcsEvent, description: null };
    const vevent = buildVEvent(noDesc, parseWallClock("2026-07-04 12:30:00"));
    expect(vevent).not.toContain("DESCRIPTION:");
  });

  it("emits stable UID based on eventId and occurrence date — same input = same UID", () => {
    const occ1 = parseWallClock("2026-07-04 12:30:00");
    const occ2 = parseWallClock("2026-07-04 12:30:00");
    const uid1 = buildVEvent(baseIcsEvent, occ1).match(/^UID:(.+)$/m)?.[1];
    const uid2 = buildVEvent(baseIcsEvent, occ2).match(/^UID:(.+)$/m)?.[1];
    expect(uid1).toBe(uid2);
    expect(uid1).toContain("event-550e8400-e29b-41d4-a716-446655440000-20260704");
    expect(uid1).toContain("@westervillelions.org");
  });

  it("emits different UIDs for different occurrence dates — UID encodes the date", () => {
    const occ1 = parseWallClock("2026-07-04 12:30:00");
    const occ2 = parseWallClock("2026-07-11 12:30:00");
    const uid1 = buildVEvent(baseIcsEvent, occ1).match(/^UID:(.+)$/m)?.[1];
    const uid2 = buildVEvent(baseIcsEvent, occ2).match(/^UID:(.+)$/m)?.[1];
    expect(uid1).not.toBe(uid2);
  });

  it("emits BEGIN:VEVENT and END:VEVENT", () => {
    const vevent = buildVEvent(baseIcsEvent, parseWallClock("2026-07-04 12:30:00"));
    expect(vevent).toContain("BEGIN:VEVENT");
    expect(vevent).toContain("END:VEVENT");
  });

  it("emits DTSTAMP in UTC format (ends with Z)", () => {
    const vevent = buildVEvent(baseIcsEvent, parseWallClock("2026-07-04 12:30:00"));
    expect(vevent).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
  });
});

describe("buildVEvent — all-day events (C2)", () => {
  const allDayEvent: IcsEventInput = {
    ...baseIcsEvent,
    isAllDay: true,
    startDate: "2026-07-04 00:00:00",
    endDate: null,
  };

  it("emits DTSTART;VALUE=DATE:YYYYMMDD (no time, no TZID) for all-day events", () => {
    const occurrence = parseWallClock("2026-07-04 00:00:00");
    const vevent = buildVEvent(allDayEvent, occurrence);

    expect(vevent).toContain("DTSTART;VALUE=DATE:20260704");
    // Must NOT contain TZID on DTSTART for all-day
    expect(vevent).not.toMatch(/DTSTART;TZID=/);
    // Must NOT contain a time component
    expect(vevent).not.toMatch(/DTSTART[^:]*:20260704T/);
  });

  it("emits DTEND;VALUE=DATE as start + 1 day for all-day events", () => {
    const occurrence = parseWallClock("2026-07-04 00:00:00");
    const vevent = buildVEvent(allDayEvent, occurrence);

    expect(vevent).toContain("DTEND;VALUE=DATE:20260705");
  });
});

describe("buildIcsCalendar", () => {
  it("wraps VEVENTs in a valid VCALENDAR envelope", () => {
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const vevent = buildVEvent(baseIcsEvent, occurrence);
    const ics = buildIcsCalendar([vevent]);

    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("PRODID:");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toMatch(/END:VCALENDAR\r\n$/);
  });

  it("includes VTIMEZONE block for America/New_York exactly once", () => {
    const occ1 = parseWallClock("2026-07-04 12:30:00");
    const occ2 = parseWallClock("2026-07-11 12:30:00");
    const vevents = [
      buildVEvent(baseIcsEvent, occ1),
      buildVEvent(baseIcsEvent, occ2),
    ];
    const ics = buildIcsCalendar(vevents);

    // VTIMEZONE block must appear exactly once
    const vtimezoneCount = (ics.match(/BEGIN:VTIMEZONE/g) ?? []).length;
    expect(vtimezoneCount).toBe(1);
    expect(ics).toContain("TZID:America/New_York");
  });

  it("produces a valid empty VCALENDAR (no VEVENTs) for C6 zero-occurrence case", () => {
    const ics = buildIcsCalendar([]);

    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toMatch(/END:VCALENDAR\r\n$/);
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("uses CRLF line endings throughout the output", () => {
    const vevent = buildVEvent(baseIcsEvent, parseWallClock("2026-07-04 12:30:00"));
    const ics = buildIcsCalendar([vevent]);

    // Every line break must be CRLF, never bare LF
    // Split on CRLF and verify no remaining bare LF
    const withoutCrLf = ics.replace(/\r\n/g, "");
    expect(withoutCrLf).not.toContain("\n");
    expect(withoutCrLf).not.toContain("\r");
  });

  it("includes multiple VEVENTs in a series download", () => {
    const occ1 = parseWallClock("2026-07-04 12:30:00");
    const occ2 = parseWallClock("2026-07-11 12:30:00");
    const occ3 = parseWallClock("2026-07-18 12:30:00");
    const vevents = [
      buildVEvent(baseIcsEvent, occ1),
      buildVEvent(baseIcsEvent, occ2),
      buildVEvent(baseIcsEvent, occ3),
    ];
    const ics = buildIcsCalendar(vevents);

    const veventCount = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
    expect(veventCount).toBe(3);
  });

  it("per-occurrence UID matches the corresponding series-download UID (UID stability across download types)", () => {
    // A user who imports a single-occurrence download and then re-imports the
    // series download should get an update, not a duplicate. UIDs must match.
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const singleVevent = buildVEvent(baseIcsEvent, occurrence);
    const seriesVevents = [
      buildVEvent(baseIcsEvent, occurrence),
      buildVEvent(baseIcsEvent, parseWallClock("2026-07-11 12:30:00")),
    ];

    const singleUid = singleVevent.match(/^UID:(.+)$/m)?.[1];
    const seriesUid = buildIcsCalendar(seriesVevents).match(/^UID:(.+)$/m)?.[1];

    expect(singleUid).toBe(seriesUid);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildGoogleCalendarUrl
// ─────────────────────────────────────────────────────────────────────────────

const baseCalendarEvent: IcsEventInput = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  title: "Lions Club Monthly Meeting",
  description: "Join us for our regular monthly meeting.",
  location: "Westerville Community Center",
  isAllDay: false,
  startDate: "2026-07-04 12:30:00",
  endDate: "2026-07-04 13:30:00",
  isPublic: true,
  url: "https://westervillelions.org/events/550e8400-e29b-41d4-a716-446655440000",
};

describe("buildGoogleCalendarUrl — timed events (regression: wall-clock / naive-UTC bug)", () => {
  it("EDT event (UTC-4): encodes correct UTC time and the naive-UTC value is absent", () => {
    // July 4 at 12:30 PM EDT = UTC-4 → 16:30 UTC
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const url = buildGoogleCalendarUrl(baseCalendarEvent, occurrence);

    // Decode the dates param to check the plain value
    const datesMatch = url.match(/dates=([^&]+)/);
    expect(datesMatch).not.toBeNull();
    const datesDecoded = decodeURIComponent(datesMatch![1]);

    // Correct UTC start: 12:30 EDT = 16:30 UTC
    expect(datesDecoded).toContain("20260704T163000Z");
    // Naive UTC (treating wall-clock as UTC) must NOT appear — regression guard
    expect(datesDecoded).not.toContain("20260704T123000Z");
    // Correct UTC end (13:30 EDT = 17:30 UTC)
    expect(datesDecoded).toContain("20260704T173000Z");
  });

  it("EST event (UTC-5): encodes correct UTC time and the naive-UTC value is absent", () => {
    // January 15 at 12:30 PM EST = UTC-5 → 17:30 UTC
    const occurrence = parseWallClock("2026-01-15 12:30:00");
    const url = buildGoogleCalendarUrl(baseCalendarEvent, occurrence);

    const datesMatch = url.match(/dates=([^&]+)/);
    const datesDecoded = decodeURIComponent(datesMatch![1]);

    // Correct UTC start: 12:30 EST = 17:30 UTC
    expect(datesDecoded).toContain("20260115T173000Z");
    // Naive UTC must NOT appear — regression guard
    expect(datesDecoded).not.toContain("20260115T123000Z");
  });

  it("uses the correct Google Calendar base URL and action=TEMPLATE", () => {
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const url = buildGoogleCalendarUrl(baseCalendarEvent, occurrence);

    expect(url).toContain("https://calendar.google.com/calendar/render");
    expect(url).toContain("action=TEMPLATE");
  });

  it("URL-encodes text values — ampersand in title does not break URL param parsing", () => {
    const event = { ...baseCalendarEvent, title: "Lions & Club Event" };
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const url = buildGoogleCalendarUrl(event, occurrence);

    // The raw & must NOT appear unencoded in the title param (would break URL parsing)
    // URLSearchParams encodes & as %26
    expect(url).toContain("%26");
    // Round-trip: decoded URL should recover the original title
    const decoded = decodeURIComponent(url.replace(/\+/g, " "));
    expect(decoded).toContain("Lions & Club Event");
  });

  it("encodes title with spaces", () => {
    const event = { ...baseCalendarEvent, title: "Hello World" };
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const url = buildGoogleCalendarUrl(event, occurrence);

    // URLSearchParams encodes spaces as + in query strings
    // The title should appear encoded (either %20 or +) not as raw space
    expect(url).not.toContain("Hello World");
    // Decoded, the title should be recoverable
    const decoded = decodeURIComponent(url.replace(/\+/g, " "));
    expect(decoded).toContain("Hello World");
  });

  it("omits details param when description is null", () => {
    const event = { ...baseCalendarEvent, description: null };
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const url = buildGoogleCalendarUrl(event, occurrence);

    expect(url).not.toContain("details=");
    expect(url).not.toContain("details=null");
  });

  it("omits location param when location is null", () => {
    const event = { ...baseCalendarEvent, location: null };
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const url = buildGoogleCalendarUrl(event, occurrence);

    expect(url).not.toContain("location=");
    expect(url).not.toContain("location=null");
  });

  it("truncates description at 1000 chars and appends footer when truncated", () => {
    // Use a character unlikely to appear elsewhere in the URL
    const longDesc = "X".repeat(1500);
    const event = { ...baseCalendarEvent, description: longDesc };
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const url = buildGoogleCalendarUrl(event, occurrence);

    // Decode the URL to check the plain text content
    const decoded = decodeURIComponent(url.replace(/\+/g, " "));
    // Footer must be present
    expect(decoded).toContain("See the full event details at:");
    // Characters at position 1001+ of the original description must not appear
    const xCount = (decoded.match(/X/g) ?? []).length;
    // Truncated at 1000 → no more than 1000 X's in decoded URL
    expect(xCount).toBeLessThanOrEqual(1000);
  });

  it("appends footer even for short descriptions", () => {
    const event = { ...baseCalendarEvent, description: "Short desc." };
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const url = buildGoogleCalendarUrl(event, occurrence);

    const decoded = decodeURIComponent(url.replace(/\+/g, " "));
    expect(decoded).toContain("See the full event details at:");
    expect(decoded).toContain("westervillelions.org/events/");
  });
});

describe("buildGoogleCalendarUrl — all-day events", () => {
  const allDayEvent: IcsEventInput = {
    ...baseCalendarEvent,
    isAllDay: true,
    startDate: "2026-07-04 00:00:00",
    endDate: null,
  };

  it("single-day all-day: uses YYYYMMDD/YYYYMMDD format with end = start + 1 day", () => {
    const occurrence = parseWallClock("2026-07-04 00:00:00");
    const url = buildGoogleCalendarUrl(allDayEvent, occurrence);

    expect(url).toContain("20260704%2F20260705");
    // Must not contain T or Z in the dates portion
    const datesMatch = url.match(/dates=([^&]+)/);
    expect(datesMatch).not.toBeNull();
    const datesDecoded = decodeURIComponent(datesMatch![1]);
    expect(datesDecoded).toBe("20260704/20260705");
    expect(datesDecoded).not.toContain("T");
    expect(datesDecoded).not.toContain("Z");
  });

  it("multi-day all-day: end date = endDate + 1 day (exclusive end for Google)", () => {
    const multiDayEvent: IcsEventInput = {
      ...allDayEvent,
      startDate: "2026-07-04 00:00:00",
      endDate: "2026-07-06 00:00:00", // inclusive last day = July 6
    };
    const occurrence = parseWallClock("2026-07-04 00:00:00");
    const url = buildGoogleCalendarUrl(multiDayEvent, occurrence);

    const datesMatch = url.match(/dates=([^&]+)/);
    const datesDecoded = decodeURIComponent(datesMatch![1]);
    // Google requires exclusive end: July 6 + 1 = July 7
    expect(datesDecoded).toBe("20260704/20260707");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildOutlookCalendarUrl
// ─────────────────────────────────────────────────────────────────────────────

describe("buildOutlookCalendarUrl — timed events (regression: wall-clock / naive-UTC bug)", () => {
  it("EDT event (UTC-4): encodes correct UTC time and the naive-UTC value is absent", () => {
    // July 4 at 12:30 PM EDT = UTC-4 → 16:30 UTC
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const url = buildOutlookCalendarUrl(baseCalendarEvent, occurrence);

    // Decode startdt and enddt params to check the plain values
    const decoded = decodeURIComponent(url.replace(/\+/g, " "));
    const startdtMatch = decoded.match(/startdt=([^&]+)/);
    const enddtMatch = decoded.match(/enddt=([^&]+)/);
    expect(startdtMatch).not.toBeNull();
    expect(enddtMatch).not.toBeNull();

    // Correct UTC start: 12:30 EDT = 16:30 UTC
    expect(startdtMatch![1]).toBe("2026-07-04T16:30:00Z");
    // Naive UTC (treating wall-clock as UTC) must NOT appear — regression guard
    expect(startdtMatch![1]).not.toBe("2026-07-04T12:30:00Z");
    // Correct UTC end: 13:30 EDT = 17:30 UTC
    expect(enddtMatch![1]).toBe("2026-07-04T17:30:00Z");
  });

  it("EST event (UTC-5): encodes correct UTC time and the naive-UTC value is absent", () => {
    // January 15 at 12:30 PM EST = UTC-5 → 17:30 UTC
    const occurrence = parseWallClock("2026-01-15 12:30:00");
    const url = buildOutlookCalendarUrl(baseCalendarEvent, occurrence);

    const decoded = decodeURIComponent(url.replace(/\+/g, " "));
    const startdtMatch = decoded.match(/startdt=([^&]+)/);
    expect(startdtMatch).not.toBeNull();

    // Correct UTC start: 12:30 EST = 17:30 UTC
    expect(startdtMatch![1]).toBe("2026-01-15T17:30:00Z");
    // Naive UTC must NOT appear — regression guard
    expect(startdtMatch![1]).not.toBe("2026-01-15T12:30:00Z");
  });

  it("uses the correct Outlook.com base URL", () => {
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const url = buildOutlookCalendarUrl(baseCalendarEvent, occurrence);

    expect(url).toContain("https://outlook.live.com/calendar/0/deeplink/compose");
  });

  it("URL-encodes text values — ampersand in title appears encoded", () => {
    const event = { ...baseCalendarEvent, title: "Lions & Club Event" };
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const url = buildOutlookCalendarUrl(event, occurrence);

    expect(url).toContain("%26");
  });

  it("encodes title with spaces", () => {
    const event = { ...baseCalendarEvent, title: "Hello World" };
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const url = buildOutlookCalendarUrl(event, occurrence);

    // URLSearchParams encodes spaces as + — raw space must not appear
    expect(url).not.toContain("Hello World");
    // Decoded, the title should be recoverable
    const decoded = decodeURIComponent(url.replace(/\+/g, " "));
    expect(decoded).toContain("Hello World");
  });

  it("omits body param when description is null", () => {
    const event = { ...baseCalendarEvent, description: null };
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const url = buildOutlookCalendarUrl(event, occurrence);

    expect(url).not.toContain("body=");
    expect(url).not.toContain("body=null");
  });

  it("omits location param when location is null", () => {
    const event = { ...baseCalendarEvent, location: null };
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const url = buildOutlookCalendarUrl(event, occurrence);

    expect(url).not.toContain("location=");
    expect(url).not.toContain("location=null");
  });

  it("truncates description at 1000 chars and appends footer when truncated", () => {
    const longDesc = "B".repeat(1500);
    const event = { ...baseCalendarEvent, description: longDesc };
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const url = buildOutlookCalendarUrl(event, occurrence);

    const decoded = decodeURIComponent(url.replace(/\+/g, " "));
    expect(decoded).toContain("See the full event details at:");
    const bCount = (decoded.match(/B/g) ?? []).length;
    expect(bCount).toBeLessThanOrEqual(1000);
  });

  it("appends footer even for short descriptions", () => {
    const event = { ...baseCalendarEvent, description: "Short desc." };
    const occurrence = parseWallClock("2026-07-04 12:30:00");
    const url = buildOutlookCalendarUrl(event, occurrence);

    const decoded = decodeURIComponent(url.replace(/\+/g, " "));
    expect(decoded).toContain("See the full event details at:");
    expect(decoded).toContain("westervillelions.org/events/");
  });
});

describe("buildOutlookCalendarUrl — all-day events", () => {
  const allDayEvent: IcsEventInput = {
    ...baseCalendarEvent,
    isAllDay: true,
    startDate: "2026-07-04 00:00:00",
    endDate: null,
  };

  it("single-day all-day: uses date-only startdt=enddt format with allday=true", () => {
    const occurrence = parseWallClock("2026-07-04 00:00:00");
    const url = buildOutlookCalendarUrl(allDayEvent, occurrence);

    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("startdt=2026-07-04");
    expect(decoded).toContain("enddt=2026-07-04");
    expect(decoded).toContain("allday=true");
    // Must not contain T or Z in the date portion
    const startdtMatch = decoded.match(/startdt=([^&]+)/);
    expect(startdtMatch![1]).not.toContain("T");
    expect(startdtMatch![1]).not.toContain("Z");
  });

  it("multi-day all-day: end date = endDate as stored (inclusive end for Outlook)", () => {
    const multiDayEvent: IcsEventInput = {
      ...allDayEvent,
      startDate: "2026-07-04 00:00:00",
      endDate: "2026-07-06 00:00:00", // inclusive last day = July 6
    };
    const occurrence = parseWallClock("2026-07-04 00:00:00");
    const url = buildOutlookCalendarUrl(multiDayEvent, occurrence);

    const decoded = decodeURIComponent(url);
    // Outlook uses inclusive end — endDate as stored, NOT +1 day
    expect(decoded).toContain("enddt=2026-07-06");
    expect(decoded).toContain("allday=true");
  });
});
