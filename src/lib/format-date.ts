/**
 * Shared date-formatting helpers.
 *
 * This project has two genuinely different date inputs, and conflating them
 * is the project's most-repeated bug (DECISION-001, DECISION-015, the
 * 2026-08 meeting-schedule import, `ack-queue.tsx` on 2026-09-10):
 *
 *  1. A **calendar date** — a Postgres `date` column (`txnDate`, `dueDate`,
 *     `meetingDate`, `desiredPostDate`, ...), which Drizzle returns as a
 *     bare `'YYYY-MM-DD'` string with no time-of-day or offset. Parsing
 *     this with a bare `new Date(dateStr)` reads it as UTC midnight, which
 *     rolls back to the previous calendar day once rendered in any US
 *     timezone. Use `formatCalendarDate` (or `parseCalendarDate` if you
 *     need a `Date`, not a string) for these — always.
 *
 *  2. An **instant** — a `timestamptz` column, a `timestamp` column that
 *     genuinely carries a real moment (`createdAt`, `decidedAt`,
 *     `submittedAt`, ...), a full ISO datetime string, or an
 *     already-parsed `Date`. Here, letting the `Date` constructor parse
 *     the string is CORRECT — there is real time/offset information to
 *     recover. Use `formatTimestamp` for these.
 *
 * Picking the wrong one for a given column is a real, silent, timezone-
 * dependent rendering bug, not a style nit — see the code review this
 * module resolves (`docs/reviews/2026-09-10-code.md`, HIGH-1b) for the
 * count of independent hand-rolled copies of the safe pattern before this
 * module existed.
 */

export type DateFormatStyle = "short" | "long" | "full";

function styleToOptions(style: DateFormatStyle): Intl.DateTimeFormatOptions {
  switch (style) {
    case "long":
      return { month: "long", day: "numeric", year: "numeric" };
    case "full":
      return { weekday: "long", month: "long", day: "numeric", year: "numeric" };
    case "short":
    default:
      return { month: "short", day: "numeric", year: "numeric" };
  }
}

/**
 * Parses a `'YYYY-MM-DD'` calendar-date string into a local `Date` via
 * explicit local construction (`new Date(y, m - 1, d)`) — never
 * `new Date(dateStr)`, which parses a date-only string as UTC midnight.
 *
 * Use this (instead of `formatCalendarDate`) when a caller needs a `Date`
 * object rather than a formatted string — e.g. to hand to `getFiscalYear()`.
 */
export function parseCalendarDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Formats a calendar-date-only value (a `'YYYY-MM-DD'` string from a
 * Postgres `date` column) as a human-readable date, e.g. `"Aug 8, 2026"`.
 *
 * Styles:
 *  - `"short"` (default) — `"Aug 8, 2026"`
 *  - `"long"` — `"August 8, 2026"`
 *  - `"full"` — `"Friday, August 8, 2026"` (adds weekday)
 */
export function formatCalendarDate(dateStr: string, style: DateFormatStyle = "short"): string {
  return parseCalendarDate(dateStr).toLocaleDateString("en-US", styleToOptions(style));
}

/**
 * Formats an instant — a `Date`, a full ISO datetime string, or a
 * `timestamptz`/genuine-instant `timestamp` value — as a human-readable
 * date, e.g. `"Aug 8, 2026"`. Letting the `Date` constructor parse the
 * string is correct here, unlike `formatCalendarDate`.
 *
 * Same `style` options as `formatCalendarDate`.
 */
export function formatTimestamp(d: Date | string, style: DateFormatStyle = "short"): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", styleToOptions(style));
}
