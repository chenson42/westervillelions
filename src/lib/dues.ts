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

// ---------------------------------------------------------------------------
// Dues payment-method composition (for the /admin/dues donut chart)
// ---------------------------------------------------------------------------

/** Known dues_payments.method values that get their own slice. Anything else buckets into "other". */
export type DuesMethodKey = "check" | "zeffy" | "cash" | "other";

const KNOWN_METHODS: readonly string[] = ["check", "zeffy", "cash"];

/** Fixed slice order — also the categorical color-slot assignment order (see dues-method-donut.tsx). */
export const DUES_METHOD_ORDER: readonly DuesMethodKey[] = ["check", "zeffy", "cash", "other"];

export const DUES_METHOD_LABELS: Record<DuesMethodKey, string> = {
  check: "Check",
  zeffy: "Zeffy",
  cash: "Cash",
  other: "Other",
};

export type DuesMethodSlice = {
  key: DuesMethodKey | "unpaid";
  label: string;
  cents: number;
  /** Share of the denominator (expected total, or collected total if no expected total exists), 0–100. */
  pct: number;
};

export type DuesMethodComposition = {
  totalCollectedCents: number;
  totalExpectedCents: number;
  /** Non-zero slices only, in fixed order: check, zeffy, cash, other, unpaid. */
  slices: DuesMethodSlice[];
};

/**
 * Composes payment-method totals + the FY's expected total into donut slices.
 *
 * Pure function — no DB access. `methodTotalsCents` is the raw per-method sum
 * (e.g. from getDuesMethodTotals), keyed by whatever string dues_payments.method
 * holds; any key other than "check" | "zeffy" | "cash" (including an unexpected
 * value, or an explicitly-"other" key) is folded into the "other" bucket.
 *
 * `totalCollectedCents` is the caller's own trusted collected figure (the page
 * already computes this from listMemberDuesStatus) and is passed through
 * unchanged for the prominent "total collected" display — it is NOT
 * recomputed from methodTotalsCents, so a negative-method edge case (a refund
 * recorded against one method) can't silently understate the headline number.
 *
 * Rules:
 * - Each method's contribution to the slices is clamped at 0 (a net-negative
 *   method total, e.g. a refund, contributes no wedge rather than a negative one).
 * - Unpaid = max(0, totalExpectedCents − totalCollectedCents); overpayment clamps to 0.
 * - The denominator (100% of the pie) is totalCollectedCents + unpaidCents — i.e.
 *   totalExpectedCents when collected falls short of it, but totalCollectedCents
 *   itself on overpayment (when unpaidCents is already 0). This keeps every
 *   slice's pct within 0–100 in both cases, and means "no dues configured"
 *   (totalExpectedCents <= 0) still charts fine as 100% of whatever's collected.
 * - Zero-value slices (including a zero Unpaid) are omitted entirely.
 */
export function computeDuesMethodComposition(
  methodTotalsCents: Record<string, number | null | undefined>,
  totalExpectedCents: number,
  totalCollectedCents: number,
): DuesMethodComposition {
  const buckets: Record<DuesMethodKey, number> = { check: 0, zeffy: 0, cash: 0, other: 0 };

  for (const [rawMethod, rawCents] of Object.entries(methodTotalsCents)) {
    const cents = Math.max(0, rawCents ?? 0);
    if (cents <= 0) continue;
    const key: DuesMethodKey = KNOWN_METHODS.includes(rawMethod)
      ? (rawMethod as DuesMethodKey)
      : "other";
    buckets[key] += cents;
  }

  const unpaidCents =
    totalExpectedCents > 0 ? Math.max(0, totalExpectedCents - totalCollectedCents) : 0;
  // The pie always sums to 100%: collected + whatever's still unpaid. On
  // overpayment, unpaidCents is already 0, so this correctly falls back to
  // totalCollectedCents rather than the (smaller) totalExpectedCents — a
  // slice can never read as more than 100% of its own pie.
  const denomCents = totalCollectedCents + unpaidCents;

  const slices: DuesMethodSlice[] = [];
  if (denomCents > 0) {
    for (const key of DUES_METHOD_ORDER) {
      const cents = buckets[key];
      if (cents <= 0) continue;
      slices.push({ key, label: DUES_METHOD_LABELS[key], cents, pct: (cents / denomCents) * 100 });
    }
    if (unpaidCents > 0) {
      slices.push({
        key: "unpaid",
        label: "Unpaid",
        cents: unpaidCents,
        pct: (unpaidCents / denomCents) * 100,
      });
    }
  }

  return { totalCollectedCents, totalExpectedCents, slices };
}
