import Link from "next/link";
import type { TransactionSearchResult } from "@/lib/ledger-search-queries";
import { SEARCH_PAGE_SIZE } from "@/lib/ledger-search-queries";
import { getFiscalYear } from "@/lib/fiscal-year";

// Duplicated from [fundSlug]/page.tsx (Phase 3 design's explicit call: "low-
// stakes either way" — these ~20 lines of pure presentational helpers aren't
// worth a page<->component export just to share once more).
function flowBadgeClass(flow: string): string {
  return flow === "income" ? "bg-green-50 text-green-700" : "bg-orange-50 text-orange-700";
}

function flowLabel(flow: string): string {
  return flow === "income" ? "Income" : "Expense";
}

function statusBadge(status: string) {
  if (status === "posted") return null;
  if (status === "pending") {
    return (
      <span className="ml-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-yellow-50 text-yellow-700 border border-yellow-200">
        Pending
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="ml-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-gray-100 text-gray-500 border border-gray-200">
        Rejected
      </span>
    );
  }
  return null;
}

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

interface SearchResultsTransactionsProps {
  result: TransactionSearchResult;
  q: string;
  /** True when an entity filter is active — omits the redundant Entity column. */
  entityScoped: boolean;
  /** True when a transaction-only filter (bank account, date, status) is set
   *  while also viewing this section — always applies here (it's the native
   *  home of those filters), included for symmetry/documentation only. */
  pageHref: (txnPage: number) => string;
}

/**
 * Read/navigate-only — no Actions column. Every row is a single stretched
 * <Link> (absolute inset-0 inside the first cell, tr positioned relative) so
 * the whole row is one clickable/focusable target, deep-linking into the
 * existing register via ?highlight=<id> (DECISION-062/063) rather than a new
 * detail surface. Reuses the register's own overflow-x-auto table wrapper —
 * confirmed that pattern (not cards) already handles 360px, per Phase 3.
 */
export default function SearchResultsTransactions({
  result,
  q,
  entityScoped,
  pageHref,
}: SearchResultsTransactionsProps) {
  const { rows, totalCount, totalIncomeCents, totalExpenseCents, page, pageSize } = result;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, totalCount);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-gray-900">
          Transactions <span className="text-gray-400 font-normal">({totalCount})</span>
        </h2>
        {totalCount > 0 && (
          <p className="text-sm text-gray-600">
            Subtotal — <span className="text-green-700 font-medium">Income: +{formatDollars(totalIncomeCents)}</span>
            {" · "}
            <span className="font-medium">Expenses: -{formatDollars(totalExpenseCents)}</span>
          </p>
        )}
      </div>

      {totalCount === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-6 text-center text-gray-500 text-sm">
          {q.trim()
            ? `No transactions match "${q.trim()}".`
            : "No transactions match these filters."}
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Type
                    </th>
                    {!entityScoped && (
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Entity
                      </th>
                    )}
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Fund
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Category
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Party
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                      Amount
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Check # / Method
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {rows.map((txn) => {
                    const fy = getFiscalYear(new Date(`${txn.txnDate}T00:00:00`));
                    const href = `/admin/ledger/${txn.fundSlug}?entity=${txn.entitySlug}&fy=${fy}&highlight=${txn.id}`;
                    return (
                      <tr key={txn.id} className="relative hover:bg-gray-50 focus-within:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                          <Link
                            href={href}
                            className="absolute inset-0 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-lions-blue"
                            aria-label={`View transaction: ${txn.party ?? "no party"} on ${txn.txnDate}, ${formatDollars(txn.amountCents)}`}
                          >
                            <span className="sr-only">View</span>
                          </Link>
                          {txn.txnDate}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${flowBadgeClass(txn.flow)}`}
                          >
                            {flowLabel(txn.flow)}
                          </span>
                          {statusBadge(txn.status)}
                        </td>
                        {!entityScoped && (
                          <td className="px-4 py-3 text-sm text-gray-600 max-w-[140px]">
                            <span className="truncate block">{txn.entityName}</span>
                          </td>
                        )}
                        <td className="px-4 py-3 text-sm text-gray-600 max-w-[140px]">
                          <span className="truncate block">{txn.fundName}</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 max-w-[140px]">
                          {txn.categoryName ?? <span className="text-gray-400">—</span>}
                        </td>
                        <td
                          className="px-4 py-3 text-sm text-gray-700 max-w-[160px] truncate"
                          title={txn.party ?? undefined}
                        >
                          {txn.party || <span className="text-gray-400">—</span>}
                          {txn.memo && (
                            <div className="text-xs text-gray-400 truncate mt-0.5" title={txn.memo}>
                              {txn.memo}
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium tabular-nums">
                          <span className={txn.flow === "income" ? "text-green-700" : "text-gray-900"}>
                            {txn.flow === "income" ? "+" : "-"}
                            {formatDollars(txn.amountCents)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                          {txn.checkNumber ?? txn.paymentMethod ?? <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm text-gray-700 flex-wrap gap-2">
            <p>
              Showing {rangeStart}–{rangeEnd} of {totalCount}
              {totalCount > SEARCH_PAGE_SIZE ? " (subtotals above span every match, not just this page)" : ""}
            </p>
            <div className="flex gap-2">
              {page > 1 && (
                <a
                  href={pageHref(page - 1)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-lions-blue"
                >
                  Previous
                </a>
              )}
              {page < totalPages && (
                <a
                  href={pageHref(page + 1)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-lions-blue"
                >
                  Next
                </a>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
