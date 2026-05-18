import { format, parse, addDays, addWeeks, addMonths, setDate, isBefore, isAfter, differenceInCalendarWeeks } from "date-fns";

export type RecurringEvent = {
  startDate: string;              // wall-clock "YYYY-MM-DD HH:MM:SS" from Drizzle mode:"string"
  isRecurring: boolean;
  recurrenceType: string | null;
  recurrenceDays: number[] | null;
  recurrenceEndDate: string | null; // wall-clock "YYYY-MM-DD HH:MM:SS" or null
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Parses a wall-clock string as local time components.
 * Accepts "YYYY-MM-DD HH:MM:SS" (Drizzle mode:"string" output) or
 * "YYYY-MM-DDTHH:MM" (form input). Accepts a Date defensively (returns it as-is).
 * Never interprets the value as UTC. See DECISION-005.
 */
export function parseWallClock(s: string | Date): Date {
  if (s instanceof Date) return s;
  // Normalise T-separator to space so parse() handles both formats.
  const normalised = s.replace("T", " ");
  // Try "yyyy-MM-dd HH:mm:ss" first, then "yyyy-MM-dd HH:mm"
  const full = parse(normalised.slice(0, 19), "yyyy-MM-dd HH:mm:ss", new Date());
  if (!isNaN(full.getTime())) return full;
  const short = parse(normalised.slice(0, 16), "yyyy-MM-dd HH:mm", new Date());
  if (!isNaN(short.getTime())) return short;
  // Date-only fallback: "yyyy-MM-dd"
  const dateOnly = parse(normalised.slice(0, 10), "yyyy-MM-dd", new Date());
  return dateOnly;
}

/**
 * Returns "YYYY-MM-DD" from the LOCAL year/month/day components of d.
 * Never uses UTC. Use this everywhere a YYYY-MM-DD key is needed from a Date.
 */
export function dateKey(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/**
 * Returns the Eastern offset string for a given local Date.
 * DST: second Sunday of March through first Sunday of November = "-04:00".
 * Standard: all other dates = "-05:00".
 * Pure implementation — no Intl, no date-fns-tz.
 */
export function easternOffsetFor(d: Date): "-04:00" | "-05:00" {
  const year = d.getFullYear();

  // Second Sunday of March
  const marchFirst = new Date(year, 2, 1); // March 1
  const marchSundays: number[] = [];
  for (let day = 1; day <= 31; day++) {
    const candidate = new Date(year, 2, day);
    if (candidate.getDay() === 0) marchSundays.push(day);
    if (marchSundays.length === 2) break;
  }
  const dstStart = new Date(year, 2, marchSundays[1], 2, 0, 0); // 2 AM on second Sunday of March
  void marchFirst; // suppress unused warning

  // First Sunday of November
  let novFirstSunday = 0;
  for (let day = 1; day <= 7; day++) {
    if (new Date(year, 10, day).getDay() === 0) { novFirstSunday = day; break; }
  }
  const dstEnd = new Date(year, 10, novFirstSunday, 2, 0, 0); // 2 AM on first Sunday of November

  return d >= dstStart && d < dstEnd ? "-04:00" : "-05:00";
}

/**
 * Formats an event's date/time for display.
 * Branches on isAllDay. For all-day events, omits the time suffix.
 *
 * Examples:
 *   Timed:   "Saturday, July 4, 2026 at 12:30 PM"
 *   All-day: "Saturday, July 4, 2026"
 */
export function formatEventWhen(event: {
  startDate: string;
  isAllDay: boolean;
}): string {
  const d = parseWallClock(event.startDate);
  if (event.isAllDay) {
    return format(d, "EEEE, MMMM d, yyyy");
  }
  return format(d, "EEEE, MMMM d, yyyy 'at' h:mm a");
}

/**
 * Returns a human-readable recurrence description for an event.
 * Non-recurring events return null.
 */
export function formatRecurrence(event: RecurringEvent): string | null {
  if (!event.isRecurring) return null;

  const { recurrenceType, recurrenceDays, recurrenceEndDate, startDate } = event;

  const startStr = format(parseWallClock(startDate), "MMM d");
  const endStr = recurrenceEndDate
    ? format(parseWallClock(recurrenceEndDate), "MMM d, yyyy")
    : null;
  const range = endStr ? `${startStr} – ${endStr}` : null;
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
 *
 * @param cancelledDates  Optional set of YYYY-MM-DD strings for cancelled occurrences.
 *                        Cancelled dates are skipped when finding the next occurrence.
 *                        Per DECISION-002: exclusion lives here, not in generateOccurrences.
 */
export function getNextOccurrence(
  event: RecurringEvent,
  now: Date,
  cancelledDates: Set<string> = new Set()
): Date | null {
  const start = parseWallClock(event.startDate);
  const end = event.recurrenceEndDate ? parseWallClock(event.recurrenceEndDate) : null;

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
    // Same day-of-month each month — walk forward until we find an uncancelled date
    const dayOfMonth = start.getDate();
    let candidate = setDate(new Date(floor.getFullYear(), floor.getMonth(), 1), dayOfMonth);
    candidate.setHours(start.getHours(), start.getMinutes(), 0, 0);
    if (isBefore(candidate, floor)) {
      candidate = setDate(addMonths(candidate, 1), dayOfMonth);
      candidate.setHours(start.getHours(), start.getMinutes(), 0, 0);
    }
    // Walk up to 12 months forward to skip cancelled dates
    for (let i = 0; i < 12; i++) {
      if (end && isAfter(candidate, end)) return null;
      const key = dateKey(candidate);
      if (!cancelledDates.has(key)) return candidate;
      candidate = setDate(addMonths(candidate, 1), dayOfMonth);
      candidate.setHours(start.getHours(), start.getMinutes(), 0, 0);
    }
    return null;
  }

  if (type === "weekly" || type === "biweekly") {
    const days = event.recurrenceDays;
    if (!days || days.length === 0) {
      // Fall back to same day of week as startDate
      const dayOfWeek = start.getDay();
      return findNextDayOfWeek(floor, [dayOfWeek], type === "biweekly" ? 2 : 1, start, end, cancelledDates);
    }
    return findNextDayOfWeek(floor, days, type === "biweekly" ? 2 : 1, start, end, cancelledDates);
  }

  // Unknown type — return startDate if in future
  return isAfter(start, now) ? start : null;
}

function findNextDayOfWeek(
  floor: Date,
  days: number[],
  intervalWeeks: number,
  seriesStart: Date,
  seriesEnd: Date | null,
  cancelledDates: Set<string> = new Set()
): Date | null {
  const sortedDays = [...days].sort((a, b) => a - b);

  // Walk forward from floor (= max(now, seriesStart)), checking each candidate day.
  // Extend cap to handle cancelled dates: up to 4x the normal window.
  const maxDays = (intervalWeeks * 7 + 7) * 4;
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
      // Skip cancelled dates
      const key = dateKey(candidate);
      if (cancelledDates.has(key)) {
        candidate = addDays(candidate, 1);
        continue;
      }
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
    return [parseWallClock(event.startDate)];
  }

  const start = parseWallClock(event.startDate);
  const seriesEnd = event.recurrenceEndDate ? parseWallClock(event.recurrenceEndDate) : null;
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
