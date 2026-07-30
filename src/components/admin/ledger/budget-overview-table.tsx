import Link from "next/link";
import { computeBudgetBalanceStatus } from "@/lib/ledger";
import {
  BudgetPlanBalanceBadge,
  formatDollars,
  fundKindLabel,
} from "@/components/admin/ledger/budget-plan-status";

export interface BudgetOverviewRow {
  fundSlug: string;
  fundName: string;
  fundKind: string;
  /** getFundReport(fund, targetFY).openingCents — "Beginning Bank (Jul 1)". */
  openingCents: number;
  /** computeFundPlanSums(fund.budgetEditorLines).incomeCents */
  incomeCents: number;
  /** computeFundPlanSums(fund.budgetEditorLines).expenseCents */
  expenseCents: number;
  /** Lines + cause-lines with pendingDeleteAt !== null, this fund only. */
  pendingDeleteCount: number;
}

export interface BudgetOverviewTableProps {
  targetFY: number;
  /** Prebuilt once in the page ("?entity=<slug>&fy=<fy>"), reused for every row's href. */
  fyQuery: string;
  rows: BudgetOverviewRow[];
}

/**
 * All-funds summary — one DashboardEntityCard-styled row per fund (Budgeting
 * Overview/Drill-Down Restructure, architect Ruling 3). Server Component:
 * pure read-only presentation over server-fetched data plus Links, no client
 * state. Whole-row navigation to the fund's drill-down PLUS an explicit
 * "Edit budget →" footer label (Phase 1 Open Question 4, resolved: both).
 *
 * Rows use `rounded-2xl` card styling, not a `<table>` — resolves the
 * mobile-360px column-count problem the design flagged for a five-numeric-
 * column table (Phase 1 Gap 6 / architect Ruling 3), and matches this
 * codebase's DashboardEntityCard precedent for a click-through summary card.
 */
export default function BudgetOverviewTable({ targetFY, fyQuery, rows }: BudgetOverviewTableProps) {
  const totals = rows.reduce(
    (acc, row) => {
      const netCents = row.incomeCents - row.expenseCents;
      return {
        openingCents: acc.openingCents + row.openingCents,
        incomeCents: acc.incomeCents + row.incomeCents,
        expenseCents: acc.expenseCents + row.expenseCents,
        netCents: acc.netCents + netCents,
        finalCents: acc.finalCents + row.openingCents + netCents,
      };
    },
    { openingCents: 0, incomeCents: 0, expenseCents: 0, netCents: 0, finalCents: 0 },
  );

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const netCents = row.incomeCents - row.expenseCents;
        const finalCents = row.openingCents + netCents;
        const balance = computeBudgetBalanceStatus(row.fundKind, row.incomeCents, row.expenseCents);

        return (
          <Link
            key={row.fundSlug}
            href={`/admin/ledger/budgeting/${row.fundSlug}${fyQuery}`}
            className="block bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden focus:outline-none focus:ring-2 focus:ring-lions-blue"
          >
            <div className="p-5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-gray-900 text-base">{row.fundName}</h3>
                  <span className="inline-flex items-center rounded-lg bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 whitespace-nowrap">
                    {fundKindLabel(row.fundKind)}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {row.pendingDeleteCount > 0 && (
                    <span className="inline-flex items-center rounded-lg bg-amber-50 text-amber-800 px-2 py-0.5 text-xs font-medium whitespace-nowrap">
                      {row.pendingDeleteCount} pending removal{row.pendingDeleteCount === 1 ? "" : "s"}
                    </span>
                  )}
                  <BudgetPlanBalanceBadge status={balance.status} />
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
                <StatCell label="Beginning Bank (Jul 1)" cents={row.openingCents} />
                <StatCell label="Income" cents={row.incomeCents} />
                <StatCell label="Expense" cents={row.expenseCents} />
                <StatCell label="Net" cents={netCents} warn={netCents < 0} />
                <StatCell label="Final Bank (Jun 30)" cents={finalCents} />
              </dl>
            </div>

            <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-500">FY{targetFY}</span>
              <span className="text-sm font-semibold text-lions-blue inline-flex items-center gap-1">
                Edit budget
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="1.5"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </span>
            </div>
          </Link>
        );
      })}

      {/* All-funds total row — not a Link (nothing to drill into, it's a sum). */}
      <div className="bg-gray-50 rounded-2xl overflow-hidden">
        <div className="p-5">
          <h3 className="font-semibold text-gray-700 text-base">All Funds</h3>
          <dl className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
            <StatCell label="Beginning Bank (Jul 1)" cents={totals.openingCents} />
            <StatCell label="Income" cents={totals.incomeCents} />
            <StatCell label="Expense" cents={totals.expenseCents} />
            <StatCell label="Net" cents={totals.netCents} warn={totals.netCents < 0} />
            <StatCell label="Final Bank (Jun 30)" cents={totals.finalCents} />
          </dl>
        </div>
      </div>
    </div>
  );
}

function StatCell({ label, cents, warn }: { label: string; cents: number; warn?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-gray-400">{label}</dt>
      <dd
        className={`text-sm font-semibold tabular-nums ${warn ? "text-amber-700" : "text-gray-900"}`}
      >
        {formatDollars(cents)}
      </dd>
    </div>
  );
}
