/**
 * Shared plan-balance presentation — extracted from guided-budget-setup.tsx
 * (Budgeting Overview/Drill-Down Restructure, architect Ruling 3). Five pure
 * functions (formatDollars/fundKindLabel/balanceBadgeClass/balanceMessage/
 * balanceWhyNote), copied verbatim (no logic change), plus two thin
 * presentational wrapper components so BudgetOverviewTable and
 * BudgetFundEditor don't each re-derive the badge/message/why-note JSX.
 *
 * Deliberately parallel to, and NOT merged with, fund-balance-overview.tsx's
 * own badge/message/why-note trio — that file is framed around ACTUALS
 * (computeBudgetBalanceStatus fed a fund's real posted income/expense);
 * this file is framed around the BUDGETED PLAN (the same status function fed
 * budgeted lines). Same underlying computeBudgetBalanceStatus, deliberately
 * different copy per framing (architect Ruling 3) — a third consumer of the
 * *plan* trio reuses this file; it does not touch fund-balance-overview.tsx.
 *
 * Server-Component-compatible (no hooks, no "use client") — conditional
 * rendering alone doesn't require client-side state, same reasoning
 * fund-balance-overview.tsx already establishes for its own trio.
 */

import { computeBudgetBalanceStatus, type BudgetBalanceStatus } from "@/lib/ledger";

export function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function fundKindLabel(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Presentation-only per Phase 3 design — never gates a write. */
export function balanceBadgeClass(status: "ok" | "warn" | "info"): string {
  switch (status) {
    case "warn":
      return "bg-amber-50 text-amber-800";
    case "info":
      return "bg-lions-gold/10 text-gray-800";
    default:
      return "bg-green-50 text-green-800";
  }
}

/** Four fixed message templates keyed by (fundKind, status) per Phase 3 design. */
export function balanceMessage(
  fundKind: string,
  status: "ok" | "warn" | "info",
  netCents: number,
): string {
  const netAbs = formatDollars(Math.abs(netCents));

  if (fundKind === "administrative") {
    if (status === "warn") return `Expenses exceed budgeted income by ${netAbs} — operating deficit planned.`;
    if (netCents === 0) return "Budgeted income equals planned expenses — balanced.";
    return `Budgeted income exceeds expenses by ${netAbs} — balanced.`;
  }
  if (fundKind === "activity") {
    if (status === "warn") {
      return `Planned receipts and disbursements differ by ${netAbs} — outside the $100 pass-through tolerance.`;
    }
    return "Planned receipts and disbursements are within $100 of each other — balanced pass-through.";
  }
  if (fundKind === "charitable" || fundKind === "scholarship") {
    if (netCents > 0) return `Planned addition to fund balance: ${netAbs}.`;
    if (netCents < 0) return `Planned drawdown from fund balance: ${netAbs}.`;
    return "Net $0 planned — income matches planned spending.";
  }
  return `Net budgeted: ${netCents < 0 ? "-" : ""}${netAbs}.`;
}

/**
 * Per-fund "why" one-liner, appended under balanceMessage() (Phase 1 work-log
 * docs/work-log/2026-07-27-ledger-budgeting-guide.md). Copy must match
 * computeBudgetBalanceStatus's actual rule per fund kind, not a generic
 * restatement — see that function's JSDoc in src/lib/ledger.ts. Unrecognized
 * fund kinds get no note (nothing meaningful to explain).
 */
export function balanceWhyNote(fundKind: string): string | null {
  if (fundKind === "administrative") {
    return "This fund covers the club's own operations, so it's expected to hold a real reserve — budgeted income should never fall short of planned expense.";
  }
  if (fundKind === "activity") {
    return "This fund is a pass-through for publicly-raised money on its way to the Foundation, so “balanced” means net income and expense land within about $100 of each other — not a surplus.";
  }
  if (fundKind === "charitable" || fundKind === "scholarship") {
    return "This fund holds public and charitable money meant to be disbursed, not stockpiled — a planned drawdown is normal and won't trigger a warning.";
  }
  return null;
}

/** Small standalone status badge — used on BudgetOverviewTable's compact rows
 *  and inside BudgetPlanBalanceSummary's own "detailed" header. */
export function BudgetPlanBalanceBadge({ status }: { status: BudgetBalanceStatus["status"] }) {
  return (
    <span
      className={`inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${balanceBadgeClass(status)}`}
    >
      {status === "warn" ? "Needs review" : status === "info" ? "Informational" : "Balanced"}
    </span>
  );
}

export interface BudgetPlanBalanceSummaryProps {
  /** Required for variant="detailed" (rendered in the header row); unused for "compact". */
  fundName?: string;
  fundKind: string;
  incomeCents: number;
  expenseCents: number;
  /**
   * "compact" — badge + one-line message only (BudgetOverviewTable's summary
   * rows). "detailed" — the full card header block: fund name, kind badge,
   * status badge, message, why-note, and the Income/Expenses/Net `dl` grid —
   * byte-for-byte the same markup guided-budget-setup.tsx L936-985 rendered
   * inline before this extraction (BudgetFundEditor's drill-down card header).
   */
  variant: "compact" | "detailed";
}

export function BudgetPlanBalanceSummary({
  fundName,
  fundKind,
  incomeCents,
  expenseCents,
  variant,
}: BudgetPlanBalanceSummaryProps) {
  const balance = computeBudgetBalanceStatus(fundKind, incomeCents, expenseCents);
  const message = balanceMessage(fundKind, balance.status, balance.netCents);

  if (variant === "compact") {
    return (
      <>
        <BudgetPlanBalanceBadge status={balance.status} />
        <p className="mt-1 text-xs text-gray-600">{message}</p>
      </>
    );
  }

  const whyNote = balanceWhyNote(fundKind);

  // No wrapping <div> here (a Fragment root) — this markup renders directly
  // inside BudgetFundEditor's "px-5 pt-5 pb-3 border-b" header container,
  // matching the DOM depth the pre-restructure guided-budget-setup.tsx card
  // header had (h3's outer card is 3 ancestor <div>s up) byte-for-byte,
  // which e2e/budget-star-notes.spec.ts's fundCard() xpath helper depends on.
  return (
    <>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-gray-900 text-base">{fundName}</h3>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-lg bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 whitespace-nowrap">
            {fundKindLabel(fundKind)}
          </span>
          <BudgetPlanBalanceBadge status={balance.status} />
        </div>
      </div>
      <p className="mt-2 text-sm text-gray-600">{message}</p>
      {whyNote && <p className="mt-1 text-xs text-gray-500">{whyNote}</p>}
      {/* Live running totals behind the balance verdict. "Banked used" = drawdown
          from the fund balance when expenses outrun income; a surplus reads as
          "To balance". */}
      <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-gray-50 px-3 py-2 text-center">
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-gray-400">Income</dt>
          <dd className="text-sm font-semibold tabular-nums text-gray-900">
            {formatDollars(incomeCents)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-gray-400">Expenses</dt>
          <dd className="text-sm font-semibold tabular-nums text-gray-900">
            {formatDollars(expenseCents)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-gray-400">
            {balance.netCents < 0 ? "Banked used" : balance.netCents > 0 ? "To balance" : "Net"}
          </dt>
          <dd
            className={`text-sm font-semibold tabular-nums ${
              balance.netCents < 0 ? "text-amber-700" : "text-gray-900"
            }`}
          >
            {formatDollars(Math.abs(balance.netCents))}
          </dd>
        </div>
      </dl>
    </>
  );
}
