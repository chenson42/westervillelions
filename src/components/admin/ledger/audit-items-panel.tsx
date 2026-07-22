import Link from "next/link";
import type { EntityTaggedGuardrailFlag } from "@/lib/ledger-queries";
import type { GuardrailFlag } from "@/lib/ledger";

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

interface AuditItemsPanelProps {
  guardrailFlags: EntityTaggedGuardrailFlag[];
  syncStaleTxnsTotal: number;
  unreconciledPriorMonthTotal: number;
  canApprove: boolean;
  pendingCount: number;
}

/**
 * "State of the books" panel — merged, entity-tagged guardrail flags from
 * both entities, plus sync-stale/unreconciled counts and (approvers only)
 * the pending-approvals count. Ledger Dashboard, DECISION-031/032.
 */
export default function AuditItemsPanel({
  guardrailFlags,
  syncStaleTxnsTotal,
  unreconciledPriorMonthTotal,
  canApprove,
  pendingCount,
}: AuditItemsPanelProps) {
  const showPending = canApprove && pendingCount > 0;
  const isClean =
    guardrailFlags.length === 0 &&
    syncStaleTxnsTotal === 0 &&
    unreconciledPriorMonthTotal === 0 &&
    !showPending;

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Audit Items</h2>

      {isClean ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          Books are clean — no outstanding audit items.
        </div>
      ) : (
        <div className="space-y-4">
          {showPending && (
            <Link
              href="/admin/ledger/approvals"
              className="flex items-center justify-between rounded-2xl bg-white shadow-sm px-5 py-3 hover:shadow-md transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              <span className="text-sm font-medium text-gray-900 flex items-center gap-2">
                Pending Approvals
                <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 rounded-full bg-yellow-400 text-yellow-900 text-xs font-bold px-1">
                  {pendingCount}
                </span>
              </span>
              <svg
                className="h-4 w-4 text-gray-400 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </Link>
          )}

          {syncStaleTxnsTotal > 0 && (
            <div className="rounded-2xl bg-white shadow-sm px-5 py-3 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-900">
                Dues payments needing re-sync
              </span>
              <span className="text-sm font-semibold text-gray-700 tabular-nums">
                {syncStaleTxnsTotal}
              </span>
            </div>
          )}

          {unreconciledPriorMonthTotal > 0 && (
            <div className="rounded-2xl bg-white shadow-sm px-5 py-3 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-900">
                Unreconciled transactions (prior month+)
              </span>
              <span className="text-sm font-semibold text-gray-700 tabular-nums">
                {unreconciledPriorMonthTotal}
              </span>
            </div>
          )}

          {guardrailFlags.length > 0 && (
            <div className="space-y-2">
              {guardrailFlags.map((flag, i) => (
                <div key={i} className={`rounded-2xl p-4 ${guardrailBadgeClass(flag.severity)}`}>
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold">{flag.title}</p>
                        <span className="inline-flex items-center rounded-lg bg-white/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                          {flag.entityName}
                        </span>
                      </div>
                      <p className="text-xs mt-0.5">{flag.detail}</p>
                      {flag.policyCite && (
                        <p className="text-xs mt-1 opacity-70">{flag.policyCite}</p>
                      )}
                      {flag.linkHref && (
                        <Link
                          href={flag.linkHref}
                          className="text-xs font-semibold underline mt-1 inline-block focus:outline-none focus:ring-2 focus:ring-current rounded"
                        >
                          View flagged transactions &rarr;
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
