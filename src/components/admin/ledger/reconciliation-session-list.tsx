import Link from "next/link";
import type { ReconciliationSessionListRow } from "@/lib/reconciliation-queries";

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Reconciliation session audit-trail list — cross-account, cross-entity.
 * Read-only: each row links to the session workbench
 * (`/admin/ledger/reconciliation/[sessionId]`). Reuses the existing
 * overflow-x-auto table convention (uncashed-checks-panel.tsx) for narrow
 * widths.
 */
export default function ReconciliationSessionList({
  sessions,
}: {
  sessions: ReconciliationSessionListRow[];
}) {
  if (sessions.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        No reconciliation sessions yet for this account — start one.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                Entity
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                Account
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                Period
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                Opening
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                Closing
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                Status
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                <span className="sr-only">View</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {sessions.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap capitalize">
                  {s.entitySlug}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                  {s.bankAccountName}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                  {formatDate(s.statementPeriodStart)} &ndash; {formatDate(s.statementPeriodEnd)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 tabular-nums text-right whitespace-nowrap">
                  {formatDollars(s.openingBalanceCents)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 tabular-nums text-right whitespace-nowrap">
                  {formatDollars(s.closingBalanceCents)}
                </td>
                <td className="px-4 py-3 text-sm whitespace-nowrap">
                  {s.status === "closed" ? (
                    <span className="inline-flex items-center rounded-lg bg-green-50 border border-green-200 text-green-800 text-xs font-semibold px-2 py-0.5">
                      Closed
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold px-2 py-0.5">
                      Open
                    </span>
                  )}
                  {!s.uploadedAt && (
                    <span className="ml-2 text-xs text-gray-400 whitespace-nowrap">
                      no statement yet
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <Link
                    href={`/admin/ledger/reconciliation/${s.id}`}
                    className="inline-flex items-center text-lions-blue hover:text-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                  >
                    <span className="sr-only">View session</span>
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
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
