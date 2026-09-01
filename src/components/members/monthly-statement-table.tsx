import {
  monthBounds,
  type MonthlyStatement,
  type MonthlyStatementCategoryLine,
  type MonthlyStatementCauseLine,
  type MonthlyStatementTotals,
} from "@/lib/financial-report-queries";
import CopyableAmount from "./copyable-amount";

/**
 * Server-rendered (no 'use client') three-column Statement of Financial
 * Condition table, reproducing the prior treasurer's reference reports
 * (WLC_June_2026_Monthly_Report.pdf / WLCF_June_2026_Monthly_Report.pdf) —
 * see docs/work-log/2026-07-28-monthly-financial-report.md Phase 4 (UI) for
 * the full rationale behind each display decision below.
 *
 * Money formatting deliberately follows this app's OWN established
 * convention (the admin fund-report page's `formatDollars`: "$" prefix,
 * "-" sign for negatives, always 2 decimals) rather than the reference
 * PDFs' spreadsheet-export styling (no "$", parens for negatives, "-" for
 * exact zero) — CLAUDE.md's Invariants section requires reusing the app's
 * existing formatter, and a member switching between this page and the
 * admin fund-report page should see the same number style. Thousands
 * separators are added (toLocaleString, not toFixed) since this statement's
 * FYTD figures regularly run into five digits and the reference reports
 * always comma-format them — the admin page's smaller numbers rarely
 * needed it, but this is a strict readability improvement, not a
 * divergence in convention.
 *
 * Twelve-Month "Beginning fund balance" is NOT a field on MonthlyStatement —
 * the query layer only returns beginningBookBalanceCents (the report
 * month's OWN start, i.e. the prior month's close — correct for the
 * One-Month column) and a single canonical endingBookBalanceCents (same
 * value in both columns, per the locked Q2 answer). The Twelve-Month
 * column's beginning balance is derived here via the accounting identity
 * ending = beginning + net, i.e. `endingBookBalanceCents - net.twelveMonthCents`
 * — verified byte-for-byte against both reference PDFs' real numbers
 * (Administrative: 16,547.84 - (-3,613.81) = 20,161.65; Charitable:
 * 6,036.57 - (-13,963.71) = 20,000.28). This is safe specifically for the
 * Twelve-Month column because getFundReport()'s FYTD net is posted/book
 * basis throughout (no cash-basis mixing), so ending = beginning + net holds
 * exactly with no divergence risk — unlike the One-Month column, which DOES
 * mix cash-basis actuals with the book balance and can genuinely diverge
 * (bookVsCashDivergenceCents), so its beginning balance uses the real
 * beginningBookBalanceCents field instead of being back-derived.
 *
 * Annual-Budget-column "Beginning/Ending fund balance" cells render "—" —
 * DECISION-050 item 3: no field exists for them anywhere in this data
 * model (the reference reports' figure was a separate hand-tracked estimate
 * outside the books software), so there is nothing to derive.
 */

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${m}/${d}/${String(y).slice(2)}`;
}

interface MonthlyStatementTableProps {
  entityLabel: string;
  fundName: string;
  statement: MonthlyStatement;
}

export default function MonthlyStatementTable({
  entityLabel,
  fundName,
  statement,
}: MonthlyStatementTableProps) {
  const { monthEnd } = monthBounds(statement.month);
  const shortMonthEnd = shortDate(monthEnd);

  const twelveMonthBeginningCents = statement.endingBookBalanceCents - statement.net.twelveMonthCents;

  const allLines = [...statement.income, ...statement.expense];
  const hasAnyUncashedCheck = allLines.some((l) => l.hasUncashedCheck);
  const hasDivergence = statement.bookVsCashDivergenceCents !== 0;
  // B-30/DECISION-061 fold-in: any visible cause-line row sourced via the
  // fuzzy payee-name-match fallback — drives the shared footnote below (one
  // per table, not one per row).
  const hasAnyFuzzyCauseLine = allLines.some((l) =>
    l.causeLines?.some((cl) => cl.isFuzzyFallback),
  );
  const hasFootnotes =
    hasAnyUncashedCheck ||
    hasDivergence ||
    statement.usedLegacyReconciledAtFallback ||
    statement.hasUndatedHistoricalRows ||
    hasAnyFuzzyCauseLine;

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden print:shadow-none print:rounded-none print:border print:border-gray-300">
      {/* Title block */}
      <div className="px-6 py-6 text-center border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-600">{entityLabel}</p>
        <h2 className="text-lg font-bold text-gray-900 mt-0.5">
          Statement of Financial Condition &mdash; {fundName}
        </h2>
        <p className="text-sm text-gray-500 mt-1">as of {statement.monthEndLabel}</p>
      </div>

      {/* Table — overflow-x-auto for 360px mobile; print:overflow-visible so
          the printed/saved page never clips a column (only 4 columns here,
          narrower than the 5-column admin report, but the wrapper stays per
          UX Guidelines convention regardless). */}
      <div className="overflow-x-auto print:overflow-visible">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 min-w-[180px]">
                Category
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                One Month Ended
                <span className="block normal-case font-normal text-gray-400">{shortMonthEnd}</span>
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                Twelve Months Ended
                <span className="block normal-case font-normal text-gray-400">{shortMonthEnd}</span>
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                Annual Budget
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <SectionHeader label="Revenue" />
            {statement.income.length === 0 ? (
              <EmptySectionRow />
            ) : (
              statement.income.map((line) => <CategoryRow key={line.categoryId} line={line} />)
            )}
            <TotalRow label="Total Revenue" totals={statement.totalRevenue} />

            <SectionHeader label="Expenses" />
            {statement.expense.length === 0 ? (
              <EmptySectionRow />
            ) : (
              statement.expense.map((line) => <CategoryRow key={line.categoryId} line={line} />)
            )}
            <TotalRow label="Total Expenses" totals={statement.totalExpense} />

            <NetRow net={statement.net} />

            <BalanceRow
              label="Beginning fund balance"
              oneMonthCents={statement.beginningBookBalanceCents}
              twelveMonthCents={twelveMonthBeginningCents}
            />
            <BalanceRow
              label="Ending fund balance"
              oneMonthCents={statement.endingBookBalanceCents}
              twelveMonthCents={statement.endingBookBalanceCents}
              emphasize
            />
          </tbody>
        </table>
      </div>

      {/* Footer disclosures */}
      <div className="px-6 py-4 border-t border-gray-100 space-y-2 text-xs text-gray-500">
        <p>
          Revenue and expense transactions are not included in this report until posted by the
          bank in the month of the report.
        </p>
        {hasAnyUncashedCheck && (
          <p>
            <span className="inline-flex items-center rounded px-1.5 py-0.5 mr-1 text-[10px] font-semibold bg-lions-gold/25 text-lions-blue-dark align-middle">
              check outstanding
            </span>
            marks a category with a check that has been written but not yet cashed by the bank.
          </p>
        )}
        {hasDivergence && (
          <p>
            Book balance and one-month cash totals differ by{" "}
            {formatDollars(Math.abs(statement.bookVsCashDivergenceCents))} this month &mdash; see
            the highlighted line(s) above for outstanding checks not yet cleared by the bank.
          </p>
        )}
        {statement.usedLegacyReconciledAtFallback && (
          <p>
            Some historical entries use the date they were marked reconciled rather than the
            bank&rsquo;s posting date, since no matching bank-statement line exists for them.
          </p>
        )}
        {statement.hasUndatedHistoricalRows && (
          <p>
            Some imported historical entries have no reliable bank-clear date and are excluded
            from the One Month Ended column; they remain reflected in the Twelve Months Ended and
            Annual Budget totals.
          </p>
        )}
        {hasAnyFuzzyCauseLine && (
          <p>
            <sup>&dagger;</sup> Amounts marked are matched by payee name and may not capture every
            transaction — the category total above is fully reconciled regardless.
          </p>
        )}
        {!hasFootnotes && (
          <p className="sr-only">No additional disclosures apply to this month&rsquo;s statement.</p>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <tr className="bg-gray-50">
      <td
        colSpan={4}
        className="px-4 py-2 text-xs font-semibold uppercase tracking-widest text-gray-700"
      >
        {label}
      </td>
    </tr>
  );
}

function EmptySectionRow() {
  return (
    <tr>
      <td colSpan={4} className="px-4 py-3 text-sm text-gray-400 text-center">
        No categories
      </td>
    </tr>
  );
}

function CategoryRow({ line }: { line: MonthlyStatementCategoryLine }) {
  return (
    <>
      <tr className="hover:bg-gray-50">
        <td className="px-4 py-2.5 text-gray-800">
          {line.categoryName}
          {line.hasUncashedCheck && (
            <span
              className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-lions-gold/25 text-lions-blue-dark align-middle"
              aria-label="check outstanding — written but not yet cashed by the bank"
            >
              check outstanding
            </span>
          )}
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-gray-800">
          <CopyableAmount value={formatDollars(line.oneMonthCents)} />
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-gray-800">
          <CopyableAmount value={formatDollars(line.twelveMonthCents)} />
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-gray-500">
          {line.annualBudgetCents === null ? "—" : <CopyableAmount value={formatDollars(line.annualBudgetCents)} />}
        </td>
      </tr>
      {line.causeLines?.map((cl) => (
        <CauseLineRow key={cl.id} cl={cl} />
      ))}
    </>
  );
}

/**
 * Cause/line-item breakdown sub-row (B-30, DECISION-061 — folds in the
 * fiscal-report cause/line breakdown work) — indented under its category
 * row, always rendered (never collapsible; this is a printed/read board
 * document). A fuzzy-fallback row gets a small, non-alarming superscript
 * marker; the shared footnote explaining it lives once at the bottom of the
 * table (see hasAnyFuzzyCauseLine above).
 */
function CauseLineRow({ cl }: { cl: MonthlyStatementCauseLine }) {
  const name = cl.label ? `${cl.cause} — ${cl.label}` : cl.cause;
  return (
    <tr className="bg-gray-50/50">
      <td className="pl-8 pr-4 py-1.5 text-xs text-gray-500">
        {name}
        {cl.isFuzzyFallback && <sup className="ml-0.5 text-gray-400">&dagger;</sup>}
      </td>
      <td className="px-4 py-1.5 text-right tabular-nums whitespace-nowrap text-xs text-gray-500">
        <CopyableAmount value={formatDollars(cl.oneMonthCents)} />
      </td>
      <td className="px-4 py-1.5 text-right tabular-nums whitespace-nowrap text-xs text-gray-500">
        <CopyableAmount value={formatDollars(cl.twelveMonthCents)} />
      </td>
      <td className="px-4 py-1.5 text-right tabular-nums whitespace-nowrap text-xs text-gray-400">
        {cl.annualBudgetCents === null ? "—" : <CopyableAmount value={formatDollars(cl.annualBudgetCents)} />}
      </td>
    </tr>
  );
}

function TotalRow({ label, totals }: { label: string; totals: MonthlyStatementTotals }) {
  return (
    <tr className="border-t-2 border-gray-300 bg-gray-50/60 font-semibold">
      <td className="px-4 py-2.5 text-gray-900">{label}</td>
      <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-gray-900">
        <CopyableAmount value={formatDollars(totals.oneMonthCents)} />
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-gray-900">
        <CopyableAmount value={formatDollars(totals.twelveMonthCents)} />
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-gray-900">
        <CopyableAmount value={formatDollars(totals.budgetCents)} />
      </td>
    </tr>
  );
}

function NetRow({ net }: { net: MonthlyStatementTotals }) {
  return (
    <tr className="font-semibold">
      <td className="px-4 py-3 text-gray-900">Net income (loss)</td>
      <td
        className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${net.oneMonthCents < 0 ? "text-red-700" : "text-gray-900"}`}
      >
        <CopyableAmount value={formatDollars(net.oneMonthCents)} />
      </td>
      <td
        className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${net.twelveMonthCents < 0 ? "text-red-700" : "text-gray-900"}`}
      >
        <CopyableAmount value={formatDollars(net.twelveMonthCents)} />
      </td>
      <td
        className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${net.budgetCents < 0 ? "text-red-700" : "text-gray-900"}`}
      >
        <CopyableAmount value={formatDollars(net.budgetCents)} />
      </td>
    </tr>
  );
}

function BalanceRow({
  label,
  oneMonthCents,
  twelveMonthCents,
  emphasize = false,
}: {
  label: string;
  oneMonthCents: number;
  twelveMonthCents: number;
  emphasize?: boolean;
}) {
  return (
    <tr className={emphasize ? "border-t-2 border-gray-300 bg-blue-50/30 font-bold" : "font-semibold"}>
      <td className="px-4 py-3 text-gray-900">{label}</td>
      <td className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${emphasize ? "text-lions-blue" : "text-gray-900"}`}>
        <CopyableAmount value={formatDollars(oneMonthCents)} />
      </td>
      <td className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${emphasize ? "text-lions-blue" : "text-gray-900"}`}>
        <CopyableAmount value={formatDollars(twelveMonthCents)} />
      </td>
      <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-gray-400">&mdash;</td>
    </tr>
  );
}
