import Link from "next/link";
import DashboardEntityCard from "@/components/admin/ledger/dashboard-entity-card";
import UncashedChecksPanel from "@/components/admin/ledger/uncashed-checks-panel";
import UnremittedDepositsPanel from "@/components/admin/ledger/unremitted-deposits-panel";
import BankAccountBalancesPanel from "@/components/admin/ledger/bank-account-balances-panel";
import AuditItemsPanel from "@/components/admin/ledger/audit-items-panel";
import LedgerSearchBox from "@/components/admin/ledger/ledger-search-box";
import type { DashboardData } from "@/lib/ledger-queries";

interface LedgerDashboardProps {
  dashboard: DashboardData;
  canApprove: boolean;
  pendingCount: number;
}

/**
 * Two-entity Ledger homepage — bare /admin/ledger (no or invalid ?entity=)
 * renders this instead of the old single-entity view (Ledger Dashboard,
 * DECISION-031/032). Composes the entity-card row, the cross-entity
 * uncashed-checks list, and the audit-items panel. Server Component — no
 * client state needed for v1 (read-only, each card/row links out).
 */
export default function LedgerDashboard({ dashboard, canApprove, pendingCount }: LedgerDashboardProps) {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-1 font-semibold">
            The Ledger
          </p>
          <h1 className="text-3xl font-bold text-gray-900">Overview</h1>
          <p className="mt-1 text-sm text-gray-500">
            Club and Foundation books at a glance, as of today (FY {dashboard.fiscalYear}).
          </p>
        </div>

        <Link
          href="/admin/ledger/guide"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded self-start"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
            />
          </svg>
          Treasurer&rsquo;s Guide
        </Link>
      </div>

      {/* Quick search (Ledger & Budget Search, DECISION-062/063) — plain GET
          form, zero JS, submits straight to /admin/ledger/search?q=... */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-4">
        <LedgerSearchBox />
      </div>

      {/* Entity cards */}
      {dashboard.entities.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          No ledger entities found. Contact the administrator.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {dashboard.entities.map((summary) => (
            <DashboardEntityCard key={summary.entity.id} summary={summary} />
          ))}
        </div>
      )}

      <BankAccountBalancesPanel accounts={dashboard.bankAccountBalances} />

      <UncashedChecksPanel checks={dashboard.uncashedChecks} />

      <UnremittedDepositsPanel deposits={dashboard.unremittedDeposits} />

      <AuditItemsPanel
        guardrailFlags={dashboard.guardrailFlags}
        syncStaleTxnsTotal={dashboard.syncStaleTxnsTotal}
        unreconciledPriorMonthTotal={dashboard.unreconciledPriorMonthTotal}
        canApprove={canApprove}
        pendingCount={pendingCount}
      />
    </div>
  );
}
