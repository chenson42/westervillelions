import { format, addDays, addWeeks, addMonths, setDate, isBefore, isAfter, differenceInCalendarWeeks } from "date-fns";

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

  // Never return an occurrence before the series starts
  const floor = isAfter(start, now) ? start : now;

  if (type === "monthly") {
    // Same day-of-month each month
    const dayOfMonth = start.getDate();
    let candidate = setDate(new Date(floor.getFullYear(), floor.getMonth(), 1), dayOfMonth);
    if (isBefore(candidate, floor)) {
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
      return findNextDayOfWeek(floor, [dayOfWeek], type === "biweekly" ? 2 : 1, start, end);
    }
    return findNextDayOfWeek(floor, days, type === "biweekly" ? 2 : 1, start, end);
  }

  // Unknown type — return startDate if in future
  return isAfter(start, now) ? start : null;
}

function findNextDayOfWeek(
  floor: Date,
  days: number[],
  intervalWeeks: number,
  seriesStart: Date,
  seriesEnd: Date | null
): Date | null {
  const sortedDays = [...days].sort((a, b) => a - b);

  // Walk forward from floor (= max(now, seriesStart)), checking each candidate day
  // Cap search at 2 * intervalWeeks weeks to avoid infinite loops
  const maxDays = intervalWeeks * 7 + 7;
  let candidate = new Date(floor);
  candidate.setHours(seriesStart.getHours(), seriesStart.getMinutes(), 0, 0);
  // If setting the time pushed us before floor, advance one day
  if (isBefore(candidate, floor)) candidate = addDays(candidate, 1);

  for (let i = 0; i < maxDays; i++) {
    const dow = candidate.getDay();
    if (sortedDays.includes(dow) && !isBefore(candidate, floor)) {
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

/**
 * Generates all occurrence dates for a recurring event, ordered ascending.
 * For non-recurring events returns [event.startDate].
 *
 * @param event     Event fields needed to compute recurrence
 * @param from      Start of window (default: now). Occurrences before this are excluded.
 * @param maxWeeks  Maximum weeks to generate into the future (default: 52).
 *                  Ignored if recurrenceEndDate is set and is sooner.
 */
export function generateOccurrences(
  event: RecurringEvent,
  from: Date = new Date(),
  maxWeeks = 52
): Date[] {
  if (!event.isRecurring) {
    return [new Date(event.startDate)];
  }

  const start = new Date(event.startDate);
  const seriesEnd = event.recurrenceEndDate ? new Date(event.recurrenceEndDate) : null;
  const windowEnd = seriesEnd
    ? (isBefore(seriesEnd, addWeeks(from, maxWeeks)) ? seriesEnd : addWeeks(from, maxWeeks))
    : addWeeks(from, maxWeeks);

  // Walk from the later of series start or from
  const walkStart = isBefore(start, from) ? from : start;

  const occurrences: Date[] = [];
  const MAX_OCCURRENCES = 200;
  const type = event.recurrenceType;

  if (type === "monthly") {
    const dayOfMonth = start.getDate();
    // Align to the first candidate month
    let candidate = setDate(new Date(walkStart.getFullYear(), walkStart.getMonth(), 1), dayOfMonth);
    // Inherit time from startDate
    candidate.setHours(start.getHours(), start.getMinutes(), 0, 0);
    // If this candidate is before walkStart, advance one month
    if (isBefore(candidate, walkStart)) {
      candidate = setDate(addMonths(candidate, 1), dayOfMonth);
      candidate.setHours(start.getHours(), start.getMinutes(), 0, 0);
    }

    while (!isAfter(candidate, windowEnd) && occurrences.length < MAX_OCCURRENCES) {
      occurrences.push(new Date(candidate));
      candidate = setDate(addMonths(candidate, 1), dayOfMonth);
      candidate.setHours(start.getHours(), start.getMinutes(), 0, 0);
    }
  } else if (type === "weekly" || type === "biweekly") {
    const intervalWeeks = type === "biweekly" ? 2 : 1;
    const days =
      event.recurrenceDays && event.recurrenceDays.length > 0
        ? event.recurrenceDays
        : [start.getDay()];

    let candidate = new Date(walkStart);
    candidate.setHours(start.getHours(), start.getMinutes(), 0, 0);
    // If setting the time pushed candidate before walkStart, advance one day
    if (isBefore(candidate, walkStart)) {
      candidate = addDays(candidate, 1);
      candidate.setHours(start.getHours(), start.getMinutes(), 0, 0);
    }

    while (!isAfter(candidate, windowEnd) && occurrences.length < MAX_OCCURRENCES) {
      const dow = candidate.getDay();
      if (days.includes(dow)) {
        // For biweekly: verify this week is a valid occurrence week
        if (intervalWeeks > 1) {
          const weeksDiff = differenceInCalendarWeeks(candidate, start);
          if (weeksDiff % intervalWeeks === 0) {
            occurrences.push(new Date(candidate));
          }
        } else {
          occurrences.push(new Date(candidate));
        }
      }
      candidate = addDays(candidate, 1);
      candidate.setHours(start.getHours(), start.getMinutes(), 0, 0);
    }
  }

  return occurrences;
}

/**
 * Returns true if `candidate` matches any occurrence in `occurrences` within ±1 minute.
 * Uses minute-precision comparison to handle minor clock drift or timezone serialization.
 */
export function isValidOccurrence(candidate: Date, occurrences: Date[]): boolean {
  const t = Math.round(candidate.getTime() / 60000);
  return occurrences.some((o) => Math.round(o.getTime() / 60000) === t);
}
