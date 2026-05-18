import { describe, it, expect } from "vitest";
import { getNextOccurrence, formatRecurrence, type RecurringEvent } from "./events";

const baseRecurring: RecurringEvent = {
  startDate: new Date("2026-05-16T12:30:00.000Z"),
  isRecurring: true,
  recurrenceType: "weekly",
  recurrenceDays: [6], // Saturday
  recurrenceEndDate: new Date("2026-09-26T00:00:00.000Z"),
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
      startDate: new Date("2027-01-01T12:00:00.000Z"),
    };

    const result = getNextOccurrence(event, new Date("2026-06-01T00:00:00.000Z"));

    expect(result?.toISOString()).toBe("2027-01-01T12:00:00.000Z");
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
    expect(result?.getUTCDate()).toBe(23);
    expect(result?.getUTCMonth()).toBe(4); // May (0-indexed)
  });

  it("handles a monthly recurrence", () => {
    const monthly: RecurringEvent = {
      startDate: new Date("2026-01-15T18:00:00.000Z"),
      isRecurring: true,
      recurrenceType: "monthly",
      recurrenceDays: null,
      recurrenceEndDate: null,
    };

    const result = getNextOccurrence(monthly, new Date("2026-03-20T00:00:00.000Z"));

    expect(result?.getUTCDate()).toBe(15);
    expect(result?.getUTCMonth()).toBe(3); // April
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
    // The end date prints in local time, so the exact day may shift by one
    // around midnight UTC depending on the runner's timezone. We only assert
    // the month and year so the test is timezone-agnostic.
    expect(result).toMatch(/Sep \d{1,2}, 2026/);
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
