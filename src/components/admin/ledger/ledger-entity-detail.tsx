import Link from "next/link";
import type {
  LedgerEntity,
  LedgerFund,
  LedgerBankAccount,
  LedgerCategory,
} from "@/lib/db/schema";
import type { EntityOverview, PendingApprovalRow } from "@/lib/ledger-queries";
import type { GuardrailFlag } from "@/lib/ledger";
import EntitySwitcher from "@/components/admin/ledger/entity-switcher";
import FiscalYearSelector from "@/components/admin/ledger/fiscal-year-selector";
import TransactionFormDialog from "@/components/admin/ledger/transaction-form-dialog";

interface LedgerEntityDetailProps {
  entity: LedgerEntity;
  entities: LedgerEntity[];
  resolvedSlug: string;
  fiscalYear: number;
  funds: LedgerFund[];
  bankAccounts: LedgerBankAccount[];
  categories: LedgerCategory[];
  overview: EntityOverview | null;
  fiscalYears: number[];
  pendingTxns: PendingApprovalRow[];
  canRecord: boolean;
  canApprove: boolean;
}

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

/**
 * Today's per-entity Ledger overview — funds, 990 chip, guardrails, quick
 * links. Pure extraction of the pre-dashboard page.tsx body (Ledger Dashboard
 * feature, DECISION-031/032): unchanged markup/behavior, now reached via a
 * dashboard entity card instead of being the page's only view.
 */
export default function LedgerEntityDetail({
  entity,
  entities,
  resolvedSlug,
  fiscalYear,
  funds,
  bankAccounts,
  categories,
  overview,
  fiscalYears,
  pendingTxns,
  canRecord,
  canApprove,
}: LedgerEntityDetailProps) {
  const pendingCount = pendingTxns.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-1 font-semibold">
            The Ledger
          </p>
          <h1 className="text-3xl font-bold text-gray-900">
            {entity.shortName ?? entity.name} Overview
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {entity.taxClassification === "501c4" ? "501(c)(4)" : "501(c)(3)"} &bull;{" "}
            {entity.donationsDeductible ? "Donations deductible" : "Donations not deductible"}
            {entity.ein && <> &bull; EIN {entity.ein}</>}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {canApprove && (
            <Link
              href="/admin/ledger/approvals"
              className="relative inline-flex items-center border-2 border-lions-blue text-lions-blue px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
            >
              Approvals
              {pendingCount > 0 && (
                <span className="ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 rounded-full bg-yellow-400 text-yellow-900 text-xs font-bold px-1">
                  {pendingCount}
                </span>
              )}
            </Link>
          )}

          {canRecord && (
            <TransactionFormDialog
              entityId={entity.id}
              funds={funds}
              categories={categories}
              bankAccounts={bankAccounts}
              trigger={
                <button className="bg-lions-blue text-white px-5 py-2.5 rounded-lg font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] whitespace-nowrap text-sm">
                  Record Transaction
                </button>
              }
            />
          )}
        </div>
      </div>

      {/* Entity switcher + FY selector */}
      <div className="flex flex-wrap items-center gap-4">
        <EntitySwitcher entities={entities} activeSlug={resolvedSlug} />
        <FiscalYearSelector
          fiscalYears={fiscalYears}
          currentFY={fiscalYear}
          basePath="/admin/ledger"
        />
      </div>

      {/* 990 chip */}
      {overview && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center rounded-lg bg-lions-blue/10 px-3 py-1 text-sm font-medium text-lions-blue">
            Files: {overview.determine990Result.form}
          </span>
          <span className="text-xs text-gray-500">{overview.determine990Result.why}</span>
        </div>
      )}

      {/* Guardrail flags */}
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

      {/* Summary: gross receipts */}
      {overview && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="rounded-2xl bg-white shadow-sm p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
              Gross Receipts YTD
            </p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {formatDollars(overview.grossReceiptsCents)}
            </p>
          </div>
        </div>
      )}

      {/* Fund balance cards */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Fund Balances</h2>
        {funds.length === 0 ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
            No funds found for this entity.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(overview?.funds ?? []).map((fs) => {
              const isNegative = fs.endingCents < 0;
              return (
                <Link
                  key={fs.fund.id}
                  href={`/admin/ledger/${fs.fund.slug}?entity=${resolvedSlug}&fy=${fiscalYear}`}
                  className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden block focus:outline-none focus:ring-2 focus:ring-lions-blue"
                >
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div>
                        <h3 className="font-semibold text-gray-900">{fs.fund.name}</h3>
                        <p className="text-xs text-gray-400 capitalize">{fs.fund.kind}</p>
                      </div>
                      <span
                        className={`text-xl font-bold tabular-nums ${
                          isNegative ? "text-red-600" : "text-gray-900"
                        }`}
                      >
                        {formatDollars(fs.endingCents)}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-gray-400 uppercase tracking-wide">Opening</p>
                        <p className="font-medium text-gray-700 tabular-nums mt-0.5">
                          {formatDollars(fs.openingCents)}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-400 uppercase tracking-wide">Income</p>
                        <p className="font-medium text-green-700 tabular-nums mt-0.5">
                          +{formatDollars(fs.incomeCents)}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-400 uppercase tracking-wide">Expenses</p>
                        <p className="font-medium text-gray-700 tabular-nums mt-0.5">
                          -{formatDollars(fs.expenseCents)}
                        </p>
                      </div>
                    </div>
                    {fs.pendingExpenseCents > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-xs">
                        <p className="text-yellow-700">
                          Encumbered (pending approval)
                        </p>
                        <p className="font-semibold text-yellow-700 tabular-nums">
                          -{formatDollars(fs.pendingExpenseCents)}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="px-5 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-xs text-gray-500">View transactions</span>
                    <svg
                      className="h-4 w-4 text-gray-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth="1.5"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </div>
                </Link>
              );
            })}

            {/* Fallback if overview is null but funds exist */}
            {!overview &&
              funds.map((fund) => (
                <Link
                  key={fund.id}
                  href={`/admin/ledger/${fund.slug}?entity=${resolvedSlug}&fy=${fiscalYear}`}
                  className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden block focus:outline-none focus:ring-2 focus:ring-lions-blue"
                >
                  <div className="p-5">
                    <h3 className="font-semibold text-gray-900">{fund.name}</h3>
                    <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">
                      {formatDollars(fund.openingBalanceCents)}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">Opening balance</p>
                  </div>
                </Link>
              ))}
          </div>
        )}
      </div>

      {/* Quick links: Reimbursements + Approvals + Reports */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link
          href="/admin/ledger/reimbursements"
          className="flex items-center justify-between rounded-2xl bg-white shadow-sm px-5 py-3 hover:shadow-md transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
        >
          <span className="text-sm font-medium text-gray-900">Reimbursement Requests</span>
          <svg className="h-4 w-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </Link>
        {canApprove && (
          <Link
            href="/admin/ledger/approvals"
            className="flex items-center justify-between rounded-2xl bg-white shadow-sm px-5 py-3 hover:shadow-md transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
          >
            <span className="text-sm font-medium text-gray-900 flex items-center gap-2">
              Pending Approvals
              {pendingCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 rounded-full bg-yellow-400 text-yellow-900 text-xs font-bold px-1">
                  {pendingCount}
                </span>
              )}
            </span>
            <svg className="h-4 w-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </Link>
        )}
        <Link
          href={`/admin/ledger/reports?entity=${resolvedSlug}&fy=${fiscalYear}`}
          className="flex items-center justify-between rounded-2xl bg-white shadow-sm px-5 py-3 hover:shadow-md transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
        >
          <span className="text-sm font-medium text-gray-900">Financial Report &amp; Export</span>
          <svg className="h-4 w-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </Link>
      </div>

      {/* Quick links to fund reports */}
      {funds.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Fund Reports</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {funds.map((fund) => (
              <Link
                key={fund.id}
                href={`/admin/ledger/${fund.slug}/report?entity=${resolvedSlug}&fy=${fiscalYear}`}
                className="flex items-center justify-between rounded-2xl bg-white shadow-sm px-5 py-3 hover:shadow-md transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                <span className="text-sm font-medium text-gray-900">{fund.name} — Budget vs. Actual</span>
                <svg
                  className="h-4 w-4 text-gray-400 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="1.5"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
