/**
 * Dues helper utilities — pure functions, no DB access.
 *
 * Fiscal year convention: the Lions fiscal year runs Jul 1 – Jun 30.
 * The year is stored as the *starting* calendar year. FY2026 = Jul 1 2026 – Jun 30 2027.
 *
 * See DECISION-013 and DECISION-014 in docs/decisions.md.
 */

/**
 * Maps a date to the fiscal year it belongs to.
 *
 * Jan–Jun (months 0–5): the FY started in the previous calendar year → return year - 1.
 * Jul–Dec (months 6–11): the FY started in this calendar year → return year.
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

export type DuesStatus = "paid" | "partial" | "unpaid";

/**
 * Derives dues status for a member given their payment total and the expected amount.
 *
 * Rules:
 * - total <= 0 → "unpaid"  (includes negative totals from net refunds)
 * - expectedCents <= 0 → "unpaid"  (dues amount not configured / zero expected)
 * - total >= expectedCents → "paid"
 * - otherwise → "partial"
 */
export function deriveStatus(
  totalPaidCents: number,
  expectedCents: number,
): DuesStatus {
  if (totalPaidCents <= 0) return "unpaid";
  if (expectedCents <= 0) return "unpaid";
  if (totalPaidCents >= expectedCents) return "paid";
  return "partial";
}
