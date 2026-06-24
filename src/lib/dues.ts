/**
 * Dues helper utilities — pure functions, no DB access.
 *
 * Fiscal-year helpers (getFiscalYear / currentFiscalYear / fiscalYearLabel) now live
 * in src/lib/fiscal-year.ts — a single source of truth shared with The Ledger — and are
 * re-exported here for back-compat. Convention unchanged: Lions FY runs Jul 1 – Jun 30,
 * labeled by its starting year (FY2026 = Jul 2026 – Jun 2027).
 *
 * See DECISION-013, DECISION-014, DECISION-015 in docs/decisions.md.
 */

export { getFiscalYear, currentFiscalYear, fiscalYearLabel } from "./fiscal-year";

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
