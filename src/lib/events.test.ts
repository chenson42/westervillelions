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
  type RecurringEvent,
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
