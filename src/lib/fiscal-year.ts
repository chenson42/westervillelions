/**
 * Shared fiscal-year helpers — pure functions, no DB access.
 *
 * The Lions fiscal year runs Jul 1 – Jun 30 and is labeled by its *starting*
 * calendar year: FY2026 = Jul 1 2026 – Jun 30 2027.
 *
 * Single source of truth shared by the dues feature and The Ledger accounting
 * feature (see docs/features/the-ledger-accounting.md and DECISION-015). Keeping
 * one definition prevents the off-by-one labeling drift that would mis-file dues
 * and accounting against different 12-month windows.
 */

/**
 * Maps a date to the fiscal year it belongs to.
 *
 * Jan–Jun (months 0–5): the FY started in the previous calendar year → year - 1.
 * Jul–Dec (months 6–11): the FY started in this calendar year → year.
 *
 * Examples:
 *   2026-03-15 → FY2025 (Jan–Jun 2026 belongs to FY2025 = Jul 2025 – Jun 2026)
 *   2026-07-01 → FY2026
 *   2026-12-31 → FY2026
 *   2026-06-30 → FY2025
 */
export function getFiscalYear(date: Date): number {
  const month = date.getMonth(); // 0-indexed; June = 5
  const year = date.getFullYear();
  return month < 6 ? year - 1 : year;
}

/**
 * Returns the current fiscal year based on the provided date.
 * Pass `new Date()` from the call site for testability.
 */
export function currentFiscalYear(now: Date): number {
  return getFiscalYear(now);
}

/**
 * Returns a human-readable label for a fiscal year.
 * e.g. fiscalYearLabel(2026) → "FY2026 (Jul 2026 – Jun 2027)"
 */
export function fiscalYearLabel(fy: number): string {
  return `FY${fy} (Jul ${fy} – Jun ${fy + 1})`;
}

/**
 * Derives the fiscal-year pill split for the "Giving by Cause" filter on
 * /members/impact (2026-07-20 rework).
 *
 * `fixed`: the current FY plus the two prior FYs (three pills, newest
 * first) — but never a year earlier than the earliest FY with giving data
 * (`Math.min(...dataYears)`). The current FY is exempt from that clamp: it
 * always renders, data or not, since it's the default selection and has its
 * own empty-state message.
 *
 * `more`: any data-bearing FY older than the fixed set, newest first. Empty
 * when there's nothing older to reveal — callers should skip rendering a
 * "More" pill in that case.
 *
 * Pure function — `dataYears` is the set of fiscal years that actually have
 * giving data (e.g. `philanthropy.byFiscalYear.map(fy => fy.fiscalYear)`),
 * in any order; `currentFY` is passed in for testability.
 */
export function deriveCauseFyPills(
  dataYears: number[],
  currentFY: number,
): { fixed: number[]; more: number[] } {
  const earliestDataFy = dataYears.length > 0 ? Math.min(...dataYears) : currentFY;

  const fixed = [currentFY, currentFY - 1, currentFY - 2].filter(
    (fy) => fy === currentFY || fy >= earliestDataFy,
  );
  const minFixed = Math.min(...fixed);

  const more = dataYears.filter((fy) => fy < minFixed).sort((a, b) => b - a);

  return { fixed, more };
}
