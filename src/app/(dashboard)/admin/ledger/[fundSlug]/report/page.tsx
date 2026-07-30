import { Fragment } from "react";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasAnyFeature, hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getEntities,
  getEntity,
  getFunds,
  getFundReport,
  listLedgerFiscalYears,
  getBudgetCauseLineLabels,
  getDuesTimingAdjustment,
} from "@/lib/ledger-queries";
import { currentFiscalYear, fiscalYearLabel } from "@/lib/fiscal-year";
import FiscalYearSelector from "@/components/admin/ledger/fiscal-year-selector";
import BudgetEditor from "@/components/admin/ledger/budget-editor";
import FundBalanceOverview from "@/components/admin/ledger/fund-balance-overview";
import type { FundReportCategoryLine } from "@/lib/ledger-queries";
import { isAllZeroRow, budgetVariance } from "@/lib/ledger";

export const dynamic = "force-dynamic";

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/**
 * Cause/line-item breakdown row for the admin Fund Report (B-30, DECISION-061
 * fold-in of the fiscal-report-breakdown work). Reads getFundReport's
 * already-resolved per-line actualCents/isFuzzyFallback (exact link wins,
 * fuzzy payee-name match is the flagged fallback) — no re-derivation here.
 */
type ReportCauseLine = {
  id: string;
  cause: string;
  label: string;
  actualCents: number;
  budgetCents: number | null;
  varianceStr: string;
  pctStr: string;
  isOverBudget: boolean;
  isFuzzyFallback: boolean;
  isOtherRow: boolean;
};

/**
 * Builds the breakdown for one category line, or null when the category has
 * no cause breakdown at all (lump-sum / not countsAsGiving). Always includes
 * a synthesized "Other" row so visible detail foots to the category's own
 * actualCents — same zero-omission rule as the member Statement, reusing
 * isAllZeroRow with a fixed oneMonthCents: 0 (this table has no bank-cleared-
 * date grain — only Actual YTD / Budget).
 */
function buildReportCauseLines(line: FundReportCategoryLine): ReportCauseLine[] | null {
  if (!line.causeLines) return null;

  let namedActualTotal = 0;
  const named: ReportCauseLine[] = line.causeLines.map((cl) => {
    namedActualTotal += cl.actualCents;
    const v = budgetVariance(cl.actualCents, cl.amountCents);
    return {
      id: cl.id,
      cause: cl.cause,
      label: cl.label,
      actualCents: cl.actualCents,
      budgetCents: cl.amountCents,
      varianceStr: v.varianceCents !== null ? formatDollars(v.varianceCents) : "—",
      pctStr: v.pct !== null ? `${v.pct >= 0 ? "+" : ""}${v.pct.toFixed(1)}%` : "—",
      isOverBudget: v.varianceCents !== null && v.varianceCents < 0,
      isFuzzyFallback: cl.isFuzzyFallback,
      isOtherRow: false,
    };
  });

  const other: ReportCauseLine = {
    id: "other",
    cause: "Other",
    label: "",
    actualCents: line.actualCents - namedActualTotal,
    budgetCents: null,
    varianceStr: "—",
    pctStr: "—",
    isOverBudget: false,
    isFuzzyFallback: false,
    isOtherRow: true,
  };

  return [...named, other].filter(
    (row) => !isAllZeroRow({ oneMonthCents: 0, twelveMonthCents: row.actualCents, annualBudgetCents: row.budgetCents }),
  );
}

function causeLineName(row: ReportCauseLine): string {
  return row.label ? `${row.cause} — ${row.label}` : row.cause;
}

function varianceDisplay(line: FundReportCategoryLine): {
  budgetStr: string;
  varianceStr: string;
  pctStr: string;
  isOverBudget: boolean;
} {
  if (line.budgetCents === null) {
    return { budgetStr: "—", varianceStr: "—", pctStr: "—", isOverBudget: false };
  }
  const v = line.variance;
  const isOverBudget = v.varianceCents !== null && v.varianceCents < 0;
  return {
    budgetStr: formatDollars(line.budgetCents),
    varianceStr: v.varianceCents !== null ? formatDollars(v.varianceCents) : "—",
    pctStr:
      v.pct !== null ? `${v.pct >= 0 ? "+" : ""}${v.pct.toFixed(1)}%` : "—",
    isOverBudget,
  };
}

export default async function AdminFundReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ fundSlug: string }>;
  searchParams: Promise<{ entity?: string; fy?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canView = await hasAnyFeature(session.user.id, [
    FEATURES.LEDGER_VIEW,
    FEATURES.LEDGER_RECORD,
    FEATURES.LEDGER_MANAGE,
  ]);
  if (!canView) redirect("/access-pending");

  const canManage = await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE);

  const { fundSlug } = await params;
  const { entity: entityParam, fy: fyParam } = await searchParams;

  // Validate entity
  const entities = await getEntities();
  const validSlugs = entities.map((e) => e.slug);
  const resolvedEntitySlug =
    entityParam && validSlugs.includes(entityParam) ? entityParam : entities[0]?.slug ?? "";
  const entity = await getEntity(resolvedEntitySlug);
  if (!entity) redirect("/admin/ledger");

  // Validate fund slug
  const allFunds = await getFunds(entity.id);
  const fund = allFunds.find((f) => f.slug === fundSlug);
  if (!fund) notFound();

  // Validate fiscal year. Default anchor is the most-recently-CLOSED FY
  // (currentFY - 1), not the in-progress current FY — a "balanced?" verdict
  // for a year still underway isn't final (docs/work-log/2026-07-28-budget-
  // balance-overview.md Phase 1). The FiscalYearSelector below stays fully
  // live to view any other year, including the current in-progress one.
  const currentFY = currentFiscalYear(new Date());
  const mostRecentlyClosedFY = currentFY - 1;
  const parsedFY = fyParam ? parseInt(fyParam, 10) : NaN;
  const fiscalYear =
    !isNaN(parsedFY) && parsedFY > 2000 && parsedFY < 2100 ? parsedFY : mostRecentlyClosedFY;
  const isClosedFY = fiscalYear < currentFY;

  const [report, fiscalYears, labelOptions, duesAdjustment] = await Promise.all([
    getFundReport(fund.id, fiscalYear),
    listLedgerFiscalYears(entity.id),
    getBudgetCauseLineLabels(entity.id),
    getDuesTimingAdjustment(fund.id, fiscalYear),
  ]);

  const basePath = `/admin/ledger/${fundSlug}/report`;

  // B-30/DECISION-061: one shared footnote for the whole table, not one per
  // row — only rendered when at least one visible cause-line row is sourced
  // via the fuzzy payee-name-match fallback.
  const hasAnyFuzzyCauseLine = [...(report?.income ?? []), ...(report?.expense ?? [])].some(
    (line) => buildReportCauseLines(line)?.some((cl) => cl.isFuzzyFallback),
  );

  // Combine income + expense lines for the budget editor
  const budgetEditorLines = [
    ...(report?.income ?? []).map((l) => ({
      categoryId: l.categoryId,
      categoryName: l.categoryName,
      flow: "income" as const,
      budgetCents: l.budgetCents,
      countsAsGiving: l.countsAsGiving,
      causeLines: l.causeLines,
    })),
    ...(report?.expense ?? []).map((l) => ({
      categoryId: l.categoryId,
      categoryName: l.categoryName,
      flow: "expense" as const,
      budgetCents: l.budgetCents,
      countsAsGiving: l.countsAsGiving,
      causeLines: l.causeLines,
    })),
  ];

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href={`/admin/ledger?entity=${resolvedEntitySlug}&fy=${fiscalYear}`}
          className="text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Ledger Overview
        </Link>
        <span className="text-gray-400">/</span>
        <Link
          href={`/admin/ledger/${fundSlug}?entity=${resolvedEntitySlug}&fy=${fiscalYear}`}
          className="text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          {fund.name}
        </Link>
      </div>

      {/* Header */}
      <div>
        <p className="uppercase tracking-widest text-sm text-lions-gold mb-1 font-semibold">
          Budget vs. Actual
        </p>
        <h1 className="text-3xl font-bold text-gray-900">{fund.name} — Fund Report</h1>
        <p className="mt-1 text-sm text-gray-500">
          {entity.shortName ?? entity.name} &bull; {fiscalYearLabel(fiscalYear)}
        </p>
      </div>

      {/* FY selector */}
      <FiscalYearSelector
        fiscalYears={fiscalYears}
        currentFY={fiscalYear}
        basePath={basePath}
      />

      {/* No report state */}
      {!report ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          <p className="font-medium">No report data available for {fiscalYearLabel(fiscalYear)}.</p>
          <p className="mt-1 text-sm">Record transactions for this fund to generate a report.</p>
        </div>
      ) : (
        <>
          {/* Budget-Balance Overview banner */}
          <FundBalanceOverview
            fundKind={fund.kind}
            fiscalYear={fiscalYear}
            isClosed={isClosedFY}
            totalIncomeCents={report.totalIncomeCents}
            totalExpenseCents={report.totalExpenseCents}
            duesAdjustment={duesAdjustment}
          />

          {/* Balance summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Opening Balance", value: formatDollars(report.openingCents), color: "text-gray-900 bg-gray-50" },
              { label: "Total Income", value: formatDollars(report.totalIncomeCents), color: "text-green-700 bg-green-50" },
              { label: "Total Expenses", value: formatDollars(report.totalExpenseCents), color: "text-orange-700 bg-orange-50" },
              {
                label: "Ending Balance",
                value: formatDollars(report.endingCents),
                color: report.endingCents < 0 ? "text-red-700 bg-red-50" : "text-lions-blue bg-blue-50",
              },
            ].map((stat) => (
              <div key={stat.label} className={`rounded-2xl p-4 ${stat.color}`}>
                <p className="text-xs font-medium opacity-70 uppercase tracking-wide">{stat.label}</p>
                <p className="text-xl font-bold tabular-nums mt-0.5">{stat.value}</p>
              </div>
            ))}
          </div>

          {/* Report table — overflow-x-auto required for mobile (5 columns) */}
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 min-w-[160px]">
                      Category
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                      Actual YTD
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                      Budget
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                      Variance ($)
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                      Variance (%)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {/* Income section */}
                  <tr className="bg-green-50">
                    <td colSpan={5} className="px-4 py-2 text-xs font-semibold uppercase tracking-widest text-green-800">
                      Income
                    </td>
                  </tr>
                  {report.income.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-3 text-sm text-gray-400 text-center">
                        No income categories
                      </td>
                    </tr>
                  ) : (
                    report.income.map((line) => {
                      const { budgetStr, varianceStr, pctStr, isOverBudget } = varianceDisplay(line);
                      const causeLines = buildReportCauseLines(line);
                      return (
                        <Fragment key={line.categoryId}>
                          <tr className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900">{line.categoryName}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium tabular-nums text-green-700">
                              {formatDollars(line.actualCents)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums text-gray-600">
                              {budgetStr}
                            </td>
                            <td
                              className={`whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums ${
                                line.budgetCents === null
                                  ? "text-gray-400"
                                  : isOverBudget
                                    ? "text-orange-700 font-medium"
                                    : "text-gray-700"
                              }`}
                            >
                              {varianceStr}
                            </td>
                            <td
                              className={`whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums ${
                                line.budgetCents === null
                                  ? "text-gray-400"
                                  : isOverBudget
                                    ? "text-orange-700 font-medium"
                                    : "text-gray-700"
                              }`}
                            >
                              {pctStr}
                            </td>
                          </tr>
                          {causeLines?.map((cl) => (
                            <tr key={`${line.categoryId}-${cl.id}`} className="bg-gray-50/50">
                              <td className="pl-8 pr-4 py-1.5 text-xs text-gray-500">
                                {causeLineName(cl)}
                                {cl.isFuzzyFallback && <sup className="ml-0.5 text-gray-400">&dagger;</sup>}
                              </td>
                              <td className="whitespace-nowrap px-4 py-1.5 text-right text-xs tabular-nums text-gray-600">
                                {formatDollars(cl.actualCents)}
                              </td>
                              <td className="whitespace-nowrap px-4 py-1.5 text-right text-xs tabular-nums text-gray-400">
                                {cl.budgetCents === null ? "—" : formatDollars(cl.budgetCents)}
                              </td>
                              <td
                                className={`whitespace-nowrap px-4 py-1.5 text-right text-xs tabular-nums ${cl.isOverBudget ? "text-orange-600" : "text-gray-400"}`}
                              >
                                {cl.varianceStr}
                              </td>
                              <td
                                className={`whitespace-nowrap px-4 py-1.5 text-right text-xs tabular-nums ${cl.isOverBudget ? "text-orange-600" : "text-gray-400"}`}
                              >
                                {cl.pctStr}
                              </td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })
                  )}
                  {/* Income total */}
                  <tr className="bg-green-50/50">
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900">Total Income</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-sm font-semibold tabular-nums text-green-700">
                      {formatDollars(report.totalIncomeCents)}
                    </td>
                    <td colSpan={3} />
                  </tr>

                  {/* Expense section */}
                  <tr className="bg-orange-50">
                    <td colSpan={5} className="px-4 py-2 text-xs font-semibold uppercase tracking-widest text-orange-800">
                      Expenses
                    </td>
                  </tr>
                  {report.expense.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-3 text-sm text-gray-400 text-center">
                        No expense categories
                      </td>
                    </tr>
                  ) : (
                    report.expense.map((line) => {
                      const { budgetStr, varianceStr, pctStr, isOverBudget } = varianceDisplay(line);
                      const causeLines = buildReportCauseLines(line);
                      return (
                        <Fragment key={line.categoryId}>
                          <tr className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900">{line.categoryName}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium tabular-nums text-gray-900">
                              {formatDollars(line.actualCents)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums text-gray-600">
                              {budgetStr}
                            </td>
                            <td
                              className={`whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums ${
                                line.budgetCents === null
                                  ? "text-gray-400"
                                  : isOverBudget
                                    ? "text-orange-700 font-medium"
                                    : "text-gray-700"
                              }`}
                            >
                              {varianceStr}
                            </td>
                            <td
                              className={`whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums ${
                                line.budgetCents === null
                                  ? "text-gray-400"
                                  : isOverBudget
                                    ? "text-orange-700 font-medium"
                                    : "text-gray-700"
                              }`}
                            >
                              {pctStr}
                            </td>
                          </tr>
                          {causeLines?.map((cl) => (
                            <tr key={`${line.categoryId}-${cl.id}`} className="bg-gray-50/50">
                              <td className="pl-8 pr-4 py-1.5 text-xs text-gray-500">
                                {causeLineName(cl)}
                                {cl.isFuzzyFallback && <sup className="ml-0.5 text-gray-400">&dagger;</sup>}
                              </td>
                              <td className="whitespace-nowrap px-4 py-1.5 text-right text-xs tabular-nums text-gray-600">
                                {formatDollars(cl.actualCents)}
                              </td>
                              <td className="whitespace-nowrap px-4 py-1.5 text-right text-xs tabular-nums text-gray-400">
                                {cl.budgetCents === null ? "—" : formatDollars(cl.budgetCents)}
                              </td>
                              <td
                                className={`whitespace-nowrap px-4 py-1.5 text-right text-xs tabular-nums ${cl.isOverBudget ? "text-orange-600" : "text-gray-400"}`}
                              >
                                {cl.varianceStr}
                              </td>
                              <td
                                className={`whitespace-nowrap px-4 py-1.5 text-right text-xs tabular-nums ${cl.isOverBudget ? "text-orange-600" : "text-gray-400"}`}
                              >
                                {cl.pctStr}
                              </td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })
                  )}
                  {/* Expense total */}
                  <tr className="bg-orange-50/50">
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900">Total Expenses</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-sm font-semibold tabular-nums text-gray-900">
                      {formatDollars(report.totalExpenseCents)}
                    </td>
                    <td colSpan={3} />
                  </tr>

                  {/* Net / ending balance row */}
                  <tr className={`border-t-2 border-gray-200 ${report.endingCents < 0 ? "bg-red-50/30" : "bg-blue-50/30"}`}>
                    <td className="px-4 py-3 text-sm font-bold text-gray-900">Ending Balance</td>
                    <td
                      className={`whitespace-nowrap px-4 py-3 text-right text-sm font-bold tabular-nums ${
                        report.endingCents < 0 ? "text-red-700" : "text-lions-blue"
                      }`}
                    >
                      {formatDollars(report.endingCents)}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tbody>
              </table>
            </div>
            {hasAnyFuzzyCauseLine && (
              <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">
                <sup>&dagger;</sup> Amounts marked are matched by payee name and may not capture every
                transaction — the category total above is fully reconciled regardless.
              </p>
            )}
          </div>

          {/* Budget editor — LEDGER_MANAGE only */}
          {canManage && budgetEditorLines.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <h2 className="text-base font-semibold text-gray-900 mb-4">
                Set Budget Amounts
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                Enter annual budget amounts in dollars. Changes save automatically when you press Enter or click away.
                Leave blank to remove a budget line (report will show &ldquo;—&rdquo;).
              </p>
              <BudgetEditor
                fundId={fund.id}
                fiscalYear={fiscalYear}
                lines={budgetEditorLines}
                labelOptions={labelOptions}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
