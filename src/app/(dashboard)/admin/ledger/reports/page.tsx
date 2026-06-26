import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasAnyFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getEntities,
  getEntity,
  getEntityReport,
  getOverview,
  listLedgerFiscalYears,
} from "@/lib/ledger-queries";
import { currentFiscalYear, fiscalYearLabel } from "@/lib/fiscal-year";
import EntitySwitcher from "@/components/admin/ledger/entity-switcher";
import FiscalYearSelector from "@/components/admin/ledger/fiscal-year-selector";
import type { GuardrailFlag } from "@/lib/ledger";
import type { FundReport } from "@/lib/ledger-queries";

export const dynamic = "force-dynamic";

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function guardrailBadgeClass(severity: GuardrailFlag["severity"]): string {
  switch (severity) {
    case "high":
      return "bg-red-50 border border-red-200 text-red-800";
    case "warn":
      return "bg-yellow-50 border border-yellow-200 text-yellow-800";
    case "info":
      return "bg-gray-50 border border-gray-200 text-gray-700";
    default:
      return "bg-gray-50 border border-gray-200 text-gray-700";
  }
}

function guardrailIconClass(severity: GuardrailFlag["severity"]): string {
  switch (severity) {
    case "high":
      return "text-red-500";
    case "warn":
      return "text-yellow-500";
    default:
      return "text-gray-400";
  }
}

function FundCard({ report }: { report: FundReport }) {
  const hasIncomeLines = report.income.some((l) => l.actualCents > 0);
  const hasExpenseLines = report.expense.some((l) => l.actualCents > 0);

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      {/* Fund header */}
      <div className="px-5 pt-5 pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-gray-900 text-base">{report.fund.name}</h3>
          <span className="inline-flex items-center rounded-lg bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 capitalize whitespace-nowrap">
            {report.fund.kind}
          </span>
        </div>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Opening balance */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Opening Balance</span>
          <span className="font-medium text-gray-700 tabular-nums">
            {formatDollars(report.openingCents)}
          </span>
        </div>

        {/* Income lines */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
            Income
          </p>
          {hasIncomeLines ? (
            <ul className="space-y-1">
              {report.income
                .filter((l) => l.actualCents > 0)
                .map((line) => (
                  <li
                    key={line.categoryId}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-gray-600">{line.categoryName}</span>
                    <span className="text-green-700 font-medium tabular-nums">
                      +{formatDollars(line.actualCents)}
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400 italic">No income recorded.</p>
          )}
          <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-sm">
            <span className="text-gray-700 font-medium">Total Income</span>
            <span className="text-green-700 font-semibold tabular-nums">
              +{formatDollars(report.totalIncomeCents)}
            </span>
          </div>
        </div>

        {/* Expense lines */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
            Expenses
          </p>
          {hasExpenseLines ? (
            <ul className="space-y-1">
              {report.expense
                .filter((l) => l.actualCents > 0)
                .map((line) => (
                  <li
                    key={line.categoryId}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-gray-600">{line.categoryName}</span>
                    <span className="text-gray-700 font-medium tabular-nums">
                      -{formatDollars(line.actualCents)}
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400 italic">No expenses recorded.</p>
          )}
          <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-sm">
            <span className="text-gray-700 font-medium">Total Expenses</span>
            <span className="text-gray-700 font-semibold tabular-nums">
              -{formatDollars(report.totalExpenseCents)}
            </span>
          </div>
        </div>

        {/* Ending balance */}
        <div className="pt-2 border-t-2 border-gray-200 flex items-center justify-between">
          <span className="text-gray-900 font-semibold">Ending Balance</span>
          <span
            className={`text-lg font-bold tabular-nums ${
              report.endingCents < 0 ? "text-red-600" : "text-gray-900"
            }`}
          >
            {formatDollars(report.endingCents)}
          </span>
        </div>

        {/* Pending encumbered */}
        {report.pendingExpenseCents > 0 && (
          <div className="flex items-center justify-between text-xs text-yellow-700 bg-yellow-50 rounded-lg px-3 py-2">
            <span>Encumbered (pending approval)</span>
            <span className="font-semibold tabular-nums">
              -{formatDollars(report.pendingExpenseCents)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default async function AdminLedgerReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; fy?: string }>;
}) {
  // --- Auth ---
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canView = await hasAnyFeature(session.user.id, [
    FEATURES.LEDGER_VIEW,
    FEATURES.LEDGER_RECORD,
    FEATURES.LEDGER_MANAGE,
  ]);
  if (!canView) redirect("/access-pending");

  // --- Params ---
  const { entity: entityParam, fy: fyParam } = await searchParams;

  const entities = await getEntities();
  if (entities.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        No ledger entities found. Contact the administrator.
      </div>
    );
  }

  const validSlugs = entities.map((e) => e.slug);
  // An explicit but invalid ?entity= slug is a 404, not a silent fallback (inc3 lesson).
  if (entityParam && !validSlugs.includes(entityParam)) notFound();
  const resolvedSlug = entityParam ?? entities[0].slug;

  const entity = await getEntity(resolvedSlug);
  if (!entity) notFound();

  const currentFY = currentFiscalYear(new Date());
  const parsedFY = fyParam ? parseInt(fyParam, 10) : NaN;
  const fiscalYear =
    !isNaN(parsedFY) && parsedFY > 2000 && parsedFY < 2100 ? parsedFY : currentFY;

  // --- Data (parallel) ---
  const [entityReport, overview, fiscalYears] = await Promise.all([
    getEntityReport(entity.id, fiscalYear),
    getOverview(entity.id, fiscalYear),
    listLedgerFiscalYears(entity.id),
  ]);

  const fyLabel = fiscalYearLabel(fiscalYear);

  const exportBase = `/api/admin/ledger/export?entity=${resolvedSlug}&fy=${fiscalYear}`;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div>
        <Link
          href="/admin/ledger"
          className="text-lions-blue hover:underline text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Ledger Overview
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-1 font-semibold">
            The Ledger
          </p>
          <h1 className="text-3xl font-bold text-gray-900">
            {entity.shortName ?? entity.name} — Financial Report
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {fyLabel} &bull; Entity-level financial statement with fund detail.
          </p>
        </div>

        {/* Export buttons — right-aligned on desktop, stacked full-width on mobile */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-2 flex-shrink-0">
          <a
            href={`${exportBase}&type=transactions`}
            className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] inline-flex items-center justify-center whitespace-nowrap"
          >
            Export transaction ledger (CSV)
          </a>
          <a
            href={`${exportBase}&type=990prep`}
            className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] inline-flex items-center justify-center whitespace-nowrap"
          >
            Export 990-prep worksheet (CSV)
          </a>
        </div>
      </div>

      {/* Entity switcher + FY selector */}
      <div className="flex flex-wrap items-center gap-4">
        <EntitySwitcher
          entities={entities}
          activeSlug={resolvedSlug}
          basePath="/admin/ledger/reports"
        />
        <FiscalYearSelector
          fiscalYears={fiscalYears}
          currentFY={fiscalYear}
          basePath="/admin/ledger/reports"
        />
      </div>

      {/* Guardrail flags (from getOverview — by design, getEntityReport returns []) */}
      {overview && overview.guardrailFlags.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Guardrail Alerts
          </h2>
          {overview.guardrailFlags.map((flag, i) => (
            <div
              key={i}
              className={`rounded-2xl p-4 ${guardrailBadgeClass(flag.severity)}`}
            >
              <div className="flex items-start gap-3">
                <svg
                  className={`h-5 w-5 mt-0.5 flex-shrink-0 ${guardrailIconClass(flag.severity)}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="1.5"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                  />
                </svg>
                <div>
                  <p className="text-sm font-semibold">{flag.title}</p>
                  <p className="text-xs mt-0.5">{flag.detail}</p>
                  {flag.policyCite && (
                    <p className="text-xs mt-1 opacity-70">{flag.policyCite}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Per-fund consolidation cards */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Fund Detail</h2>
        {!entityReport || entityReport.funds.length === 0 ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
            <p className="font-medium">No funds configured for this entity.</p>
            <p className="mt-1 text-sm">
              Set up funds in{" "}
              <Link
                href="/admin/ledger/settings"
                className="text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
              >
                Ledger Settings
              </Link>
              .
            </p>
          </div>
        ) : (
          <>
            {entityReport.funds.every(
              (f) => f.totalIncomeCents === 0 && f.totalExpenseCents === 0,
            ) && (
              <div className="mb-4 rounded-2xl bg-yellow-50 border border-yellow-200 px-5 py-3 text-sm text-yellow-800">
                No transactions recorded for {fyLabel}. Opening balances are shown.
              </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {entityReport.funds.map((report) => (
                <FundCard key={report.fund.id} report={report} />
              ))}
            </div>
          </>
        )}
      </section>

      {/* Entity totals bar */}
      {entityReport && entityReport.funds.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Entity Totals</h2>
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
              <div className="px-5 py-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
                  Gross Receipts
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">
                  {formatDollars(entityReport.grossReceiptsCents)}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">Posted income, excl. transfers</p>
              </div>

              <div className="px-5 py-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
                  Net
                </p>
                <p
                  className={`text-2xl font-bold mt-1 tabular-nums ${
                    entityReport.netCents < 0 ? "text-red-600" : "text-gray-900"
                  }`}
                >
                  {formatDollars(entityReport.netCents)}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">Receipts minus expenses</p>
              </div>

              <div className="px-5 py-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
                  IRS Form
                </p>
                <div className="mt-1 flex items-baseline gap-2 flex-wrap">
                  <span className="inline-flex items-center rounded-lg bg-lions-blue/10 px-3 py-1 text-sm font-semibold text-lions-blue whitespace-nowrap">
                    {entityReport.determine990Result.form}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  {entityReport.determine990Result.why}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Cash-basis disclaimer */}
      <p className="text-xs text-gray-400">
        Cash-basis report. Figures reflect posted transactions only. Transfer rows are
        excluded from gross receipts and expense totals. This is not a filed tax return
        — consult your tax preparer for 990/990-EZ preparation.
      </p>
    </div>
  );
}
