// Slice-based date and time formatters. Nothing here calls new Date(str): a
// date-only string is parsed by hand, and weekday arithmetic uses UTC parts only.

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(iso: string): { y: number; m: number; d: number } {
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) };
}

/** Weekday index (0 = Sunday) of a date-only ISO string. */
export function weekdayIndex(iso: string): number {
  const { y, m, d } = parts(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "Friday, Dec 18" */
export function formatLongDate(iso: string): string {
  const { m, d } = parts(iso);
  return `${WEEKDAYS[weekdayIndex(iso)]}, ${MONTHS[m - 1]} ${d}`;
}

/** "Fri, Dec 18" */
export function formatShortDate(iso: string): string {
  const { m, d } = parts(iso);
  return `${WEEKDAYS[weekdayIndex(iso)].slice(0, 3)}, ${MONTHS[m - 1]} ${d}`;
}

/** "Dec 18" */
export function formatMonthDay(iso: string): string {
  const { m, d } = parts(iso);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "Wednesday" */
export function formatWeekday(iso: string): string {
  return WEEKDAYS[weekdayIndex(iso)];
}

/** "Dec 18 to 20" (first and last day of the weekend). */
export function formatDateRange(dates: { dropoff: string; pickup: string }): string {
  const a = parts(dates.dropoff);
  const b = parts(dates.pickup);
  return a.m === b.m
    ? `${MONTHS[a.m - 1]} ${a.d} to ${b.d}`
    : `${MONTHS[a.m - 1]} ${a.d} to ${MONTHS[b.m - 1]} ${b.d}`;
}

function clock(hhmm: string): { h12: number; mm: string; meridiem: "AM" | "PM" } {
  const h = Number(hhmm.slice(0, 2));
  return { h12: h % 12 === 0 ? 12 : h % 12, mm: hhmm.slice(3, 5), meridiem: h < 12 ? "AM" : "PM" };
}

/** "4:00 PM" */
export function formatTime(hhmm: string): string {
  const c = clock(hhmm);
  return `${c.h12}:${c.mm} ${c.meridiem}`;
}

/** "4:00 to 5:00 PM", or "11:00 AM to 1:00 PM" when the meridiem differs. */
export function formatTimeRange(start: string, end: string): string {
  const a = clock(start);
  const b = clock(end);
  return a.meridiem === b.meridiem
    ? `${a.h12}:${a.mm} to ${b.h12}:${b.mm} ${b.meridiem}`
    : `${formatTime(start)} to ${formatTime(end)}`;
}
