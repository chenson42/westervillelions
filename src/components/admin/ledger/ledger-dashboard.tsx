import DashboardEntityCard from "@/components/admin/ledger/dashboard-entity-card";
import UncashedChecksPanel from "@/components/admin/ledger/uncashed-checks-panel";
import AuditItemsPanel from "@/components/admin/ledger/audit-items-panel";
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
      <div>
        <p className="uppercase tracking-widest text-sm text-lions-gold mb-1 font-semibold">
          The Ledger
        </p>
        <h1 className="text-3xl font-bold text-gray-900">Overview</h1>
        <p className="mt-1 text-sm text-gray-500">
          Club and Foundation books at a glance, as of today (FY {dashboard.fiscalYear}).
        </p>
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

      <UncashedChecksPanel checks={dashboard.uncashedChecks} />

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
