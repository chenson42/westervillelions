/**
 * Budget-Balance Overview banner — top of the per-fund report page
 * (docs/work-log/2026-07-28-budget-balance-overview.md).
 *
 * Server Component: all data (the fund's actuals from getFundReport, and the
 * dues-timing adjustment from getDuesTimingAdjustment) is already fetched by
 * the page — this component is presentation-only, no client interactivity.
 *
 * Status badge reuses computeBudgetBalanceStatus() (src/lib/ledger.ts) AS-IS,
 * fed the fund's ACTUAL FY income/expense (not budgeted lines) — already
 * fund-kind-aware: a real administrative deficit is flagged, the activity
 * fund's pass-through tolerance applies, and charitable/scholarship funds
 * stay informational (a planned drawdown is legitimate under the two-fund
 * rule, never shown as "broken").
 *
 * The dues-timing adjustment is a secondary, additive figure — it never
 * changes the status badge itself (which stays strictly cash-basis, per
 * Phase 1) — surfaced only when the fund has any dues-linked activity.
 */

import { computeBudgetBalanceStatus, type DuesTimingAdjustment } from "@/lib/ledger";
import { fiscalYearLabel } from "@/lib/fiscal-year";

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

type Status = "ok" | "warn" | "info";

/** Presentation-only badge color — never gates a write. Mirrors the amber/gold/green
 *  vocabulary already established in guided-budget-setup.tsx, with a red variant for
 *  an administrative fund's REAL (actuals) deficit — more severe than a pre-year plan. */
function overviewBadgeClass(fundKind: string, status: Status): string {
  if (status === "warn" && fundKind === "administrative") return "bg-red-50 text-red-800";
  if (status === "warn") return "bg-amber-50 text-amber-800";
  if (status === "info") return "bg-lions-gold/10 text-gray-800";
  return "bg-green-50 text-green-800";
}

/** Short badge label per the five statuses named in the Phase 1 design. */
function overviewLabel(fundKind: string, status: Status, netCents: number): string {
  if (fundKind === "administrative") {
    if (status === "warn") return "Deficit flagged";
    return netCents > 0 ? "Surplus" : "Balanced";
  }
  if (fundKind === "activity") {
    return status === "warn" ? "Off-balance" : "Balanced";
  }
  if (fundKind === "charitable" || fundKind === "scholarship") {
    if (netCents < 0) return "Planned drawdown — OK";
    return netCents > 0 ? "Surplus" : "Balanced";
  }
  return "Informational";
}

/** One-line explanation of the verdict, framed as an actuals/FY-close read (not a plan). */
function overviewMessage(
  fundKind: string,
  status: Status,
  netCents: number,
  isClosed: boolean,
): string {
  const netAbs = formatDollars(Math.abs(netCents));
  const yearWord = isClosed ? "the year" : "the year so far";

  if (fundKind === "administrative") {
    if (status === "warn") {
      return `Actual expenses exceeded actual income by ${netAbs} for ${yearWord} — operating deficit.`;
    }
    if (netCents === 0) return `Actual income equaled actual expenses for ${yearWord} — balanced.`;
    return `Actual income exceeded expenses by ${netAbs} for ${yearWord} — surplus.`;
  }
  if (fundKind === "activity") {
    if (status === "warn") {
      return `Actual receipts and disbursements differ by ${netAbs} for ${yearWord} — outside the $100 pass-through tolerance.`;
    }
    return `Actual receipts and disbursements were within $100 of each other for ${yearWord} — balanced pass-through.`;
  }
  if (fundKind === "charitable" || fundKind === "scholarship") {
    if (netCents < 0) {
      return `Actual drawdown from fund balance: ${netAbs} for ${yearWord} — a planned use of reserves, not a problem.`;
    }
    if (netCents > 0) return `Actual addition to fund balance: ${netAbs} for ${yearWord}.`;
    return `Net $0 for ${yearWord} — income matched spending.`;
  }
  return `Net actual: ${netCents < 0 ? "-" : ""}${netAbs} for ${yearWord}.`;
}

/** Per-fund-kind "why" one-liner — same rule explanations as guided-budget-setup.tsx,
 *  reframed for an actuals/FY-close read rather than a pre-year plan. */
function overviewWhyNote(fundKind: string): string | null {
  if (fundKind === "administrative") {
    return "This fund covers the club's own operations, so it's expected to hold a real reserve — actual income should never fall short of actual expense.";
  }
  if (fundKind === "activity") {
    return "This fund is a pass-through for publicly-raised money on its way to the Foundation, so “balanced” means actual income and expense land within about $100 of each other — not a surplus.";
  }
  if (fundKind === "charitable" || fundKind === "scholarship") {
    return "This fund holds public and charitable money meant to be disbursed, not stockpiled — a planned drawdown is normal and isn't flagged as a problem.";
  }
  return null;
}

export interface FundBalanceOverviewProps {
  fundKind: string;
  fiscalYear: number;
  isClosed: boolean;
  totalIncomeCents: number;
  totalExpenseCents: number;
  /** null when the adjustment query failed — degrade to cash-basis only. */
  duesAdjustment: DuesTimingAdjustment | null;
}

export default function FundBalanceOverview({
  fundKind,
  fiscalYear,
  isClosed,
  totalIncomeCents,
  totalExpenseCents,
  duesAdjustment,
}: FundBalanceOverviewProps) {
  const hasActivity = totalIncomeCents !== 0 || totalExpenseCents !== 0;

  if (!hasActivity) {
    return (
      <div className="bg-gray-50 rounded-2xl p-6 text-center text-gray-500">
        <p className="font-medium">No activity recorded yet for {fiscalYearLabel(fiscalYear)}.</p>
        <p className="mt-1 text-sm">Balance status will appear once income or expenses are posted.</p>
      </div>
    );
  }

  const balance = computeBudgetBalanceStatus(fundKind, totalIncomeCents, totalExpenseCents);
  const label = overviewLabel(fundKind, balance.status, balance.netCents);
  const badgeClass = overviewBadgeClass(fundKind, balance.status);
  const message = overviewMessage(fundKind, balance.status, balance.netCents, isClosed);
  const whyNote = overviewWhyNote(fundKind);

  // Only surface the dues-adjustment block when the fund actually has
  // dues-linked activity (any FY) — an all-zero object (no dues activity)
  // and a null (query failed) both hide the block, per Phase 1's "no
  // confusing $0 adjustment" and "degrade gracefully" requirements.
  const showDuesAdjustment =
    duesAdjustment !== null &&
    (duesAdjustment.cashBasisDuesCents !== 0 || duesAdjustment.adjustedDuesCents !== 0);
  const adjustedTotalIncomeCents = duesAdjustment
    ? totalIncomeCents + duesAdjustment.deltaCents
    : totalIncomeCents;

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
            {fiscalYearLabel(fiscalYear)} &bull; {isClosed ? "Closed" : "In progress"}
          </p>
          <h2 className="text-lg font-bold text-gray-900 mt-0.5">Is this fund&rsquo;s budget balanced?</h2>
        </div>
        <span
          className={`inline-flex items-center rounded-lg px-3 py-1 text-sm font-semibold whitespace-nowrap ${badgeClass}`}
        >
          {label}
        </span>
      </div>

      <p className="mt-3 text-sm text-gray-700">{message}</p>
      {whyNote && <p className="mt-1 text-xs text-gray-500">{whyNote}</p>}

      {showDuesAdjustment && duesAdjustment && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Cash-basis income</p>
              <p className="text-base font-semibold tabular-nums text-gray-900 mt-0.5">
                {formatDollars(totalIncomeCents)}
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Dues-adjusted income</p>
              <p className="text-base font-semibold tabular-nums text-gray-900 mt-0.5">
                {formatDollars(adjustedTotalIncomeCents)}
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Members sometimes pay next year&rsquo;s dues before this fiscal year closes. Cash-basis counts dues
            the day they were received; the dues-adjusted figure counts each payment toward the membership year
            it&rsquo;s actually for
            {duesAdjustment.deltaCents !== 0
              ? ` — a difference of ${formatDollars(Math.abs(duesAdjustment.deltaCents))} ${
                  duesAdjustment.deltaCents > 0 ? "more" : "less"
                } for this year.`
              : "."}
          </p>
        </div>
      )}
    </div>
  );
}
