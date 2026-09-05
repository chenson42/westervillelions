/**
 * Pure helpers behind the public "impact numbers" band on /donate (and the
 * homepage's one-line summary) — Site Review Fixes Batch 5, 2026-09-04
 * (docs/work-log/2026-09-04-site-review-fixes.md).
 *
 * No DB access here — see src/lib/impact-stats-queries.ts for the live
 * ledger query that uses these. Kept separate and pure so the FY-selection
 * and rounding logic can be unit-tested without a database.
 */

import { getFiscalYear } from "@/lib/fiscal-year";

/**
 * Returns the two most recently COMPLETED fiscal years as of `now`, oldest
 * first. A fiscal year (Jul 1–Jun 30, start-year convention — see
 * fiscal-year.ts) is "completed" once its own end date has passed; the
 * current, still-in-progress fiscal year is deliberately excluded so the
 * public-facing total never includes a partial year.
 *
 * Example: `now` in FY2026 (Jul 2026–Jun 2027, in progress) → [2024, 2025].
 */
export function getRecentCompletedFiscalYears(now: Date): [number, number] {
  const currentFY = getFiscalYear(now);
  return [currentFY - 2, currentFY - 1];
}

/**
 * Rounds a cents amount DOWN to the nearest $1,000 and returns the result in
 * whole dollars. Always rounds toward zero on the dollar axis — a real
 * $60,350 renders as "$60,000+", never rounded up past the true total.
 */
export function roundDownToThousand(cents: number): number {
  const dollars = Math.floor(cents / 100);
  return Math.floor(dollars / 1000) * 1000;
}

/** Formats a rounded whole-dollar amount as a "$X,000+" display string. */
export function formatImpactAmount(dollars: number): string {
  return `$${dollars.toLocaleString("en-US")}+`;
}
