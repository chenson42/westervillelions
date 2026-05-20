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

// ─────────────────────────────────────────────────────────────────────────────
// ICS / iCalendar generator
// RFC 5545 — https://datatracker.ietf.org/doc/html/rfc5545
// See: docs/work-log/2026-05-20-add-to-calendar.md (Phase 3, C1–C11)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input shape for buildVEvent. All date strings are wall-clock "YYYY-MM-DD HH:MM:SS"
 * exactly as returned by Drizzle mode:"string". See DECISION-005.
 */
export type IcsEventInput = {
  id: string;           // event.id (UUID)
  title: string;        // event.title
  description: string | null; // event.description (plain text, no HTML)
  location: string | null;    // event.location
  isAllDay: boolean;    // event.isAllDay
  startDate: string;    // event.startDate (wall-clock string) — used for endDate derivation
  endDate: string | null;     // event.endDate (wall-clock string or null)
  isPublic: boolean;    // event.isPublic (controls URL path in VEVENT)
  url: string;          // fully-constructed canonical URL (caller provides from NEXTAUTH_URL)
};

/**
 * Escapes special characters in an ICS TEXT property value per RFC 5545 §3.3.11.
 * Caller must also apply icsFold() to the resulting "PROPERTY:value" line.
 */
export function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")   // backslash first (must come before other replacements)
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");   // literal newline → \n escape sequence
}

/**
 * Folds a single "PROPERTY:value" line to no more than 75 octets per line per
 * RFC 5545 §3.1. Continuation lines begin with a single SPACE character.
 * Uses Buffer.byteLength so that multibyte UTF-8 characters are never split.
 */
export function icsFold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    // First chunk: 75 bytes. Continuation chunks: 74 bytes (1 byte is the leading space).
    const limit = offset === 0 ? 75 : 74;
    let end = Math.min(offset + limit, bytes.length);

    // Back up if the byte at `end` is a UTF-8 continuation byte (10xxxxxx),
    // which would mean we are splitting in the middle of a multibyte sequence.
    while (end > offset && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end--;
    }

    parts.push(bytes.slice(offset, end).toString("utf8"));
    offset = end;
  }

  return parts.join("\r\n ");
}

/**
 * Derives a safe ASCII filename from an event title for Content-Disposition.
 * Appends ".ics".
 */
export function toIcsFilename(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")  // collapse non-alphanumeric runs to a single hyphen
      .replace(/^-+|-+$/g, "")       // trim leading/trailing hyphens
      .slice(0, 60)
    + ".ics"
  );
}

// Static VTIMEZONE block for America/New_York (EST/EDT).
// Calendar clients use TZID to look up current DST rules; this block is a
// hint covering standard (EST, -05:00) and daylight (EDT, -04:00) transitions.
const VTIMEZONE_AMERICA_NEW_YORK = [
  "BEGIN:VTIMEZONE",
  "TZID:America/New_York",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0400",
  "TZNAME:EDT",
  "DTSTART:19700308T020000",
  "RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:-0400",
  "TZOFFSETTO:-0500",
  "TZNAME:EST",
  "DTSTART:19701101T020000",
  "RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11",
  "END:STANDARD",
  "END:VTIMEZONE",
].join("\r\n");

/**
 * Builds a single VEVENT string (without the VCALENDAR envelope).
 *
 * IMPORTANT: `occurrence` must be a Date produced by parseWallClock() or
 * generateOccurrences() — it carries wall-clock local time components.
 * Do NOT pass new Date(wallClockString) here; that would re-introduce the
 * naive-UTC bug (DECISION-005, memory: project_naive_timestamp_tz_bug).
 */
export function buildVEvent(event: IcsEventInput, occurrence: Date): string {
  const lines: string[] = [];

  lines.push("BEGIN:VEVENT");

  if (event.isAllDay) {
    // C2: All-day events use DATE value type — no TZID, no time component.
    const dateStr = format(occurrence, "yyyyMMdd");
    // DTEND = start + 1 day per iCalendar spec for all-day events
    const nextDay = addDays(occurrence, 1);
    const nextDateStr = format(nextDay, "yyyyMMdd");
    lines.push(`DTSTART;VALUE=DATE:${dateStr}`);
    lines.push(`DTEND;VALUE=DATE:${nextDateStr}`);
  } else {
    // C3: Timed events — VTIMEZONE + TZID approach (Option A).
    // format() reads LOCAL components of the occurrence Date, which is exactly
    // the wall-clock time stored in the DB. No UTC conversion takes place.
    const localStr = format(occurrence, "yyyyMMdd'T'HHmmss");
    lines.push(`DTSTART;TZID=America/New_York:${localStr}`);

    // C5: Derive DTEND
    let dtendStr: string;
    if (event.endDate) {
      // Use the endDate time components applied to the occurrence's date.
      // For recurring events with a fixed duration, this yields the correct
      // end time on the same local date as the occurrence.
      const endTime = parseWallClock(event.endDate);
      const dtend = new Date(occurrence);
      dtend.setHours(endTime.getHours(), endTime.getMinutes(), 0, 0);
      dtendStr = format(dtend, "yyyyMMdd'T'HHmmss");
    } else {
      // Default: occurrence + 1 hour
      const dtend = new Date(occurrence.getTime() + 60 * 60 * 1000);
      dtendStr = format(dtend, "yyyyMMdd'T'HHmmss");
    }
    lines.push(`DTEND;TZID=America/New_York:${dtendStr}`);
  }

  // C9: UID — stable per event + occurrence date
  const dateKey = format(occurrence, "yyyyMMdd");
  lines.push(`UID:event-${event.id}-${dateKey}@westervillelions.org`);

  // DTSTAMP — required by RFC 5545, current UTC timestamp at generation time
  const now = new Date();
  const dtstamp =
    now.getUTCFullYear().toString() +
    String(now.getUTCMonth() + 1).padStart(2, "0") +
    String(now.getUTCDate()).padStart(2, "0") +
    "T" +
    String(now.getUTCHours()).padStart(2, "0") +
    String(now.getUTCMinutes()).padStart(2, "0") +
    String(now.getUTCSeconds()).padStart(2, "0") +
    "Z";
  lines.push(`DTSTAMP:${dtstamp}`);

  // C9: SUMMARY (escaped + folded)
  lines.push(icsFold(`SUMMARY:${icsEscape(event.title)}`));

  // C9: DESCRIPTION (if present)
  if (event.description) {
    lines.push(icsFold(`DESCRIPTION:${icsEscape(event.description)}`));
  }

  // C9: LOCATION (if present)
  if (event.location) {
    lines.push(icsFold(`LOCATION:${icsEscape(event.location)}`));
  }

  // C9: URL
  lines.push(icsFold(`URL:${event.url}`));

  lines.push("END:VEVENT");

  return lines.join("\r\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider calendar URL builders
// See: docs/work-log/2026-05-20-add-to-calendar-dropdown.md (Phase 3, sections 1–3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a wall-clock Date (produced by parseWallClock) to a UTC Date
 * using the Eastern offset for that date.
 *
 * IMPORTANT: `wallClockDate` must be a Date produced by parseWallClock() — it
 * carries local wall-clock time components. Do NOT pass new Date(wallClockString)
 * here; that would re-introduce the naive-UTC bug (DECISION-005,
 * memory: project_naive_timestamp_tz_bug).
 *
 * The conversion reads LOCAL components (year, month, day, hours, minutes,
 * seconds) from the Date — which are the wall-clock values — and then applies
 * the Eastern UTC offset to produce actual UTC milliseconds. This is
 * timezone-safe: it works regardless of the server's local timezone setting.
 */
function wallClockToUtc(wallClockDate: Date): Date {
  // Extract LOCAL (wall-clock) components — these are the Eastern local values
  // regardless of what timezone the server is running in.
  const wallClockAsUtcMs = Date.UTC(
    wallClockDate.getFullYear(),
    wallClockDate.getMonth(),
    wallClockDate.getDate(),
    wallClockDate.getHours(),
    wallClockDate.getMinutes(),
    wallClockDate.getSeconds(),
    0
  );

  // Eastern offset for this wall-clock date: "-04:00" (EDT) or "-05:00" (EST)
  const offsetStr = easternOffsetFor(wallClockDate);
  // Eastern is behind UTC, so offset sign = +1 to convert Eastern → UTC
  const offsetSign = offsetStr[0] === "-" ? 1 : -1;
  const offsetMinutes =
    parseInt(offsetStr.slice(1, 3)) * 60 + parseInt(offsetStr.slice(4, 6));

  return new Date(wallClockAsUtcMs + offsetSign * offsetMinutes * 60_000);
}

/**
 * Formats a UTC Date as "YYYYMMDDTHHmmssZ" for Google Calendar TEMPLATE URL.
 * Uses UTC components only.
 */
function formatUtcGoogle(utcDate: Date): string {
  return (
    utcDate.getUTCFullYear().toString() +
    String(utcDate.getUTCMonth() + 1).padStart(2, "0") +
    String(utcDate.getUTCDate()).padStart(2, "0") +
    "T" +
    String(utcDate.getUTCHours()).padStart(2, "0") +
    String(utcDate.getUTCMinutes()).padStart(2, "0") +
    String(utcDate.getUTCSeconds()).padStart(2, "0") +
    "Z"
  );
}

/**
 * Formats a UTC Date as "YYYY-MM-DDTHH:mm:ssZ" for Outlook.com deeplink URL.
 * Uses UTC components only.
 */
function formatUtcOutlook(utcDate: Date): string {
  return (
    utcDate.getUTCFullYear().toString() +
    "-" +
    String(utcDate.getUTCMonth() + 1).padStart(2, "0") +
    "-" +
    String(utcDate.getUTCDate()).padStart(2, "0") +
    "T" +
    String(utcDate.getUTCHours()).padStart(2, "0") +
    ":" +
    String(utcDate.getUTCMinutes()).padStart(2, "0") +
    ":" +
    String(utcDate.getUTCSeconds()).padStart(2, "0") +
    "Z"
  );
}

const DESCRIPTION_MAX_CHARS = 1000;
const DESCRIPTION_FOOTER_PREFIX = "\n\nSee the full event details at: ";

/**
 * Prepares the description text for a provider calendar URL.
 * - If null: returns null (caller omits the param).
 * - If > 1000 chars: truncates to 1000 chars, then appends footer.
 * - Otherwise: appends footer with event URL.
 * The returned string is ready for encodeURIComponent().
 */
function prepareDescription(
  description: string | null,
  eventUrl: string
): string | null {
  if (description === null) return null;
  const footer = DESCRIPTION_FOOTER_PREFIX + eventUrl;
  if (description.length > DESCRIPTION_MAX_CHARS) {
    return description.slice(0, DESCRIPTION_MAX_CHARS) + footer;
  }
  return description + footer;
}

/**
 * Builds a Google Calendar TEMPLATE URL for adding an event.
 *
 * IMPORTANT: `occurrence` must be a Date produced by parseWallClock() —
 * it carries local wall-clock time components. Do NOT pass
 * new Date(wallClockString) here; that would re-introduce the naive-UTC bug
 * (DECISION-005, memory: project_naive_timestamp_tz_bug).
 *
 * See: docs/work-log/2026-05-20-add-to-calendar-dropdown.md (Phase 3, D2–D5)
 */
export function buildGoogleCalendarUrl(event: IcsEventInput, occurrence: Date): string {
  const params = new URLSearchParams();
  params.set("action", "TEMPLATE");
  params.set("text", event.title);

  if (event.isAllDay) {
    // D4: All-day events use date-only format YYYYMMDD/YYYYMMDD (exclusive end)
    const startStr = format(occurrence, "yyyyMMdd");
    let endStr: string;
    if (event.endDate) {
      // Multi-day: endDate stores inclusive last day; Google requires exclusive end (+1 day)
      endStr = format(addDays(parseWallClock(event.endDate), 1), "yyyyMMdd");
    } else {
      // Single-day: end = start + 1 day
      endStr = format(addDays(occurrence, 1), "yyyyMMdd");
    }
    params.set("dates", `${startStr}/${endStr}`);
  } else {
    // D2/D3: Timed events — wall-clock → UTC conversion using easternOffsetFor
    const utcStart = wallClockToUtc(occurrence);
    let utcEnd: Date;
    if (event.endDate) {
      // Apply the end time's HH:mm:ss to the occurrence date (same pattern as buildVEvent)
      const endTime = parseWallClock(event.endDate);
      const dtend = new Date(occurrence);
      dtend.setHours(endTime.getHours(), endTime.getMinutes(), endTime.getSeconds(), 0);
      utcEnd = wallClockToUtc(dtend);
    } else {
      // Default: start + 1 hour
      utcEnd = new Date(utcStart.getTime() + 60 * 60_000);
    }
    params.set("dates", `${formatUtcGoogle(utcStart)}/${formatUtcGoogle(utcEnd)}`);
  }

  // D5: Description — omit if null, truncate at 1000 chars + footer
  const descText = prepareDescription(event.description, event.url);
  if (descText !== null) {
    params.set("details", descText);
  }

  // D5: Location — omit if null
  if (event.location !== null) {
    params.set("location", event.location);
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Builds an Outlook.com deeplink URL for adding an event.
 *
 * IMPORTANT: `occurrence` must be a Date produced by parseWallClock() —
 * it carries local wall-clock time components. Do NOT pass
 * new Date(wallClockString) here; that would re-introduce the naive-UTC bug
 * (DECISION-005, memory: project_naive_timestamp_tz_bug).
 *
 * See: docs/work-log/2026-05-20-add-to-calendar-dropdown.md (Phase 3, D2–D5)
 */
export function buildOutlookCalendarUrl(event: IcsEventInput, occurrence: Date): string {
  const params = new URLSearchParams();
  params.set("subject", event.title);
  params.set("path", "/calendar/action/compose");
  params.set("rru", "addevent");

  if (event.isAllDay) {
    // D4: All-day events use date-only strings; Outlook uses inclusive end
    const startStr = format(occurrence, "yyyy-MM-dd");
    let endStr: string;
    if (event.endDate) {
      // Multi-day: endDate stores inclusive last day — use as-is for Outlook
      endStr = event.endDate.slice(0, 10);
    } else {
      // Single-day: end = start (same day, inclusive)
      endStr = startStr;
    }
    params.set("startdt", startStr);
    params.set("enddt", endStr);
    params.set("allday", "true");
  } else {
    // D2/D3: Timed events — wall-clock → UTC conversion using easternOffsetFor
    const utcStart = wallClockToUtc(occurrence);
    let utcEnd: Date;
    if (event.endDate) {
      // Apply the end time's HH:mm:ss to the occurrence date
      const endTime = parseWallClock(event.endDate);
      const dtend = new Date(occurrence);
      dtend.setHours(endTime.getHours(), endTime.getMinutes(), endTime.getSeconds(), 0);
      utcEnd = wallClockToUtc(dtend);
    } else {
      // Default: start + 1 hour
      utcEnd = new Date(utcStart.getTime() + 60 * 60_000);
    }
    params.set("startdt", formatUtcOutlook(utcStart));
    params.set("enddt", formatUtcOutlook(utcEnd));
  }

  // D5: Description — omit if null, truncate at 1000 chars + footer
  const descText = prepareDescription(event.description, event.url);
  if (descText !== null) {
    params.set("body", descText);
  }

  // D5: Location — omit if null
  if (event.location !== null) {
    params.set("location", event.location);
  }

  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/**
 * Wraps an array of VEVENT strings in a complete VCALENDAR envelope.
 * Always includes the VTIMEZONE block for America/New_York.
 * Returns the full ICS string with CRLF line endings throughout.
 * An empty array produces a valid (empty) VCALENDAR — see C6.
 */
export function buildIcsCalendar(vevents: string[]): string {
  const parts: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Westerville Lions Club//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    VTIMEZONE_AMERICA_NEW_YORK,
    ...vevents,
    "END:VCALENDAR",
  ];

  // Join with CRLF and add a final CRLF terminator (required by strict ICS parsers)
  return parts.join("\r\n") + "\r\n";
}
