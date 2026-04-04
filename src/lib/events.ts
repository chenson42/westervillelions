import { format, addDays, addWeeks, addMonths, setDate, isBefore, isAfter } from "date-fns";

export type RecurringEvent = {
  startDate: Date;
  isRecurring: boolean;
  recurrenceType: string | null;
  recurrenceDays: number[] | null;
  recurrenceEndDate: Date | null;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Returns a human-readable recurrence description for an event.
 * Non-recurring events return null.
 */
export function formatRecurrence(event: RecurringEvent): string | null {
  if (!event.isRecurring) return null;

  const { recurrenceType, recurrenceDays, recurrenceEndDate, startDate } = event;

  const startStr = format(new Date(startDate), "MMM d");
  const endStr = recurrenceEndDate
    ? format(new Date(recurrenceEndDate), "MMM d, yyyy")
    : null;
  const range = endStr ? `${startStr} \u2013 ${endStr}` : null;
  const startingStr = `starting ${startStr}`;

  if (recurrenceType === "monthly") {
    return range ? `Monthly, ${range}` : `Monthly ${startingStr}`;
  }

  // Weekly or Biweekly
  const prefix = recurrenceType === "biweekly" ? "Every other" : "Every";
  const days =
    recurrenceDays && recurrenceDays.length > 0
      ? recurrenceDays.map((d) => DAY_NAMES[d]).join(", ")
      : null;

  if (!days) {
    return range ? `${prefix} week, ${range}` : `${prefix} week ${startingStr}`;
  }

  return range ? `${prefix} ${days}, ${range}` : `${prefix} ${days} ${startingStr}`;
}

/**
 * Computes the next occurrence date for a recurring (or non-recurring) event
 * relative to `now`. Returns null if the series has ended.
 */
export function getNextOccurrence(event: RecurringEvent, now: Date): Date | null {
  const start = new Date(event.startDate);
  const end = event.recurrenceEndDate ? new Date(event.recurrenceEndDate) : null;

  if (!event.isRecurring) {
    // Non-recurring: it "occurs" at its startDate
    return isAfter(start, now) ? start : null;
  }

  // Series already ended
  if (end && isBefore(end, now)) return null;

  const type = event.recurrenceType;

  if (type === "monthly") {
    // Same day-of-month each month
    const dayOfMonth = start.getDate();
    let candidate = setDate(new Date(now.getFullYear(), now.getMonth(), 1), dayOfMonth);
    if (isBefore(candidate, now)) {
      candidate = setDate(addMonths(candidate, 1), dayOfMonth);
    }
    if (end && isAfter(candidate, end)) return null;
    return candidate;
  }

  if (type === "weekly" || type === "biweekly") {
    const days = event.recurrenceDays;
    if (!days || days.length === 0) {
      // Fall back to same day of week as startDate
      const dayOfWeek = start.getDay();
      return findNextDayOfWeek(now, [dayOfWeek], type === "biweekly" ? 2 : 1, start, end);
    }
    return findNextDayOfWeek(now, days, type === "biweekly" ? 2 : 1, start, end);
  }

  // Unknown type — return startDate if in future
  return isAfter(start, now) ? start : null;
}

function findNextDayOfWeek(
  now: Date,
  days: number[],
  intervalWeeks: number,
  seriesStart: Date,
  seriesEnd: Date | null
): Date | null {
  const sortedDays = [...days].sort((a, b) => a - b);

  // Walk forward from today, checking each candidate day
  // Cap search at 2 * intervalWeeks weeks to avoid infinite loops
  const maxDays = intervalWeeks * 7 + 7;
  let candidate = new Date(now);
  candidate.setHours(seriesStart.getHours(), seriesStart.getMinutes(), 0, 0);

  for (let i = 0; i < maxDays; i++) {
    const dow = candidate.getDay();
    if (sortedDays.includes(dow) && isAfter(candidate, now)) {
      // For biweekly: check that this candidate falls in a valid week
      // A "valid week" is one where (floor difference in weeks from seriesStart) % intervalWeeks === 0
      if (intervalWeeks > 1) {
        const msPerWeek = 7 * 24 * 60 * 60 * 1000;
        const weeksDiff = Math.floor((candidate.getTime() - seriesStart.getTime()) / msPerWeek);
        if (weeksDiff % intervalWeeks !== 0) {
          candidate = addDays(candidate, 1);
          continue;
        }
      }
      if (seriesEnd && isAfter(candidate, seriesEnd)) return null;
      return candidate;
    }
    candidate = addDays(candidate, 1);
  }

  return null;
}
