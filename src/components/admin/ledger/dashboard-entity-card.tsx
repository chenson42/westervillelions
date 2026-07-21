import Link from "next/link";
import type { DashboardEntitySummary } from "@/lib/ledger-queries";

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/**
 * One entity's stat card on the Ledger dashboard — name, current balance,
 * gross receipts YTD, fund count, and an alert-count badge. Links to the
 * existing per-entity detail view (?entity=<slug>). Server Component, no
 * client state — always-show-both is a different interaction model than
 * EntitySwitcher's single-select toggle (DECISION-032 point 3).
 */
export default function DashboardEntityCard({ summary }: { summary: DashboardEntitySummary }) {
  const { entity, entityBalanceCents, grossReceiptsCents, fundCount, alertCount } = summary;
  const isNegative = entityBalanceCents < 0;

  return (
    <Link
      href={`/admin/ledger?entity=${entity.slug}`}
      className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden block focus:outline-none focus:ring-2 focus:ring-lions-blue"
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-2 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {entity.shortName ?? entity.name}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {entity.taxClassification === "501c4" ? "501(c)(4)" : "501(c)(3)"}
            </p>
          </div>
          {alertCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 rounded-full bg-yellow-400 text-yellow-900 text-xs font-bold px-2 whitespace-nowrap">
              {alertCount} alert{alertCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <p className={`text-3xl font-bold tabular-nums ${isNegative ? "text-red-600" : "text-gray-900"}`}>
          {formatDollars(entityBalanceCents)}
        </p>
        <p className="text-xs text-gray-400 mt-1">Current balance</p>

        <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-gray-100">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Gross Receipts YTD</p>
            <p className="text-sm font-semibold text-gray-700 tabular-nums mt-0.5">
              {formatDollars(grossReceiptsCents)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Funds</p>
            <p className="text-sm font-semibold text-gray-700 mt-0.5">{fundCount}</p>
          </div>
        </div>
      </div>

      <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
        <span className="text-xs text-gray-500">View details</span>
        <svg
          className="h-4 w-4 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </div>
    </Link>
  );
}
