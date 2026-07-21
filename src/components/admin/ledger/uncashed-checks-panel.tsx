import Link from "next/link";
import type { UncashedCheckRow } from "@/lib/ledger-queries";
import { getFiscalYear } from "@/lib/fiscal-year";

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
 * Cross-entity list of check-method, unreconciled expense transactions
 * (Ledger Dashboard, DECISION-031/032) — oldest-first, both entities. Reuses
 * the Approvals page's overflow-x-auto table pattern (established convention
 * for tabular admin-ledger lists at narrow widths). Read-only in v1: each row
 * links to the transaction's own fund/FY, derived from the row's own txnDate
 * via getFiscalYear() — NOT the dashboard's current fiscalYear, since a check
 * can be dated in a prior FY.
 */
export default function UncashedChecksPanel({ checks }: { checks: UncashedCheckRow[] }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Uncashed Checks</h2>
      {checks.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          No uncashed checks.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    Entity
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    Fund
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Party
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    Date
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    Age
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Memo
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    <span className="sr-only">View</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {checks.map((row) => {
                  const isAged = row.ageDays > 90;
                  const fy = getFiscalYear(new Date(row.txnDate));
                  return (
                    <tr key={row.id}>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                        {row.entityName}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                        {row.fundName}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{row.party ?? "—"}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 font-semibold tabular-nums text-right whitespace-nowrap">
                        {formatDollars(row.amountCents)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                        {formatDate(row.txnDate)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right whitespace-nowrap">
                        {isAged ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-amber-700 font-semibold tabular-nums">
                              {row.ageDays}d
                            </span>
                            <span className="inline-flex items-center rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-800 text-[10px] font-semibold px-1.5 py-0.5 whitespace-nowrap">
                              90+ days
                            </span>
                          </span>
                        ) : (
                          <span className="text-gray-700 tabular-nums">{row.ageDays}d</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-[16rem] truncate">
                        {row.memo ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Link
                          href={`/admin/ledger/${row.fundSlug}?entity=${row.entitySlug}&fy=${fy}`}
                          className="inline-flex items-center text-lions-blue hover:text-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                        >
                          <span className="sr-only">View transaction for {row.party ?? "this check"}</span>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
