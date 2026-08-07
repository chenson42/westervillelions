import Link from "next/link";
import type { BudgetLineSearchResult } from "@/lib/ledger-search-queries";
import { SEARCH_PAGE_SIZE } from "@/lib/ledger-search-queries";

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function StarIcon() {
  return (
    <svg className="h-4 w-4 text-lions-gold" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 21.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
    </svg>
  );
}

interface SearchResultsBudgetLinesProps {
  result: BudgetLineSearchResult;
  q: string;
  /** True when an entity filter is active — omits the redundant Entity column. */
  entityScoped: boolean;
  /** True when a specific FY (not "All years") is filtered — omits the redundant FY column. */
  fyScoped: boolean;
  /** True when at least one transaction-only filter (bank account, date, status) is active —
   *  surfaces the inline "doesn't apply here" note (Filter Semantics rule 1, DECISION-063). */
  hasInapplicableFilters: boolean;
  pageHref: (budgetPage: number) => string;
}

/**
 * Read/navigate-only, same clickable-row pattern as
 * SearchResultsTransactions. Deep-links into the budgeting drill-down via
 * ?highlight=<id>. Pending-delete lines render struck-through with a badge,
 * reusing budget-cause-editor.tsx's existing dead-row visual language
 * (informational only — no Undo/Restore here).
 *
 * Fix 1 (Phase 4 loop-back, 2026-08-07 — superseding DECISION-063 #4): a row
 * can also be a lump-sum budget category (line.isLumpSum, no cause/label of
 * its own — a whole ledger_budgets row with zero ledger_budget_lines
 * children). It reads as the category-level line it is — the Cause column
 * shows the category name plus a "Lump sum" badge (same pill styling as the
 * existing "Pending removal" badge, not a new convention) and the Label
 * column shows a muted explanatory note instead of an empty cell (same
 * text-gray-400 treatment the generic-label case already uses below). Its
 * highlight target on the budgeting drill-down is `${categoryId}_${flow}` —
 * budget-editor.tsx's own per-category row key — not line.id, since a lump
 * sum has no ledger_budget_lines row to point at.
 */
export default function SearchResultsBudgetLines({
  result,
  q,
  entityScoped,
  fyScoped,
  hasInapplicableFilters,
  pageHref,
}: SearchResultsBudgetLinesProps) {
  const { rows, totalCount, totalIncomeCents, totalExpenseCents, page, pageSize } = result;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, totalCount);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-gray-900">
          Budget lines <span className="text-gray-400 font-normal">({totalCount})</span>
        </h2>
        {totalCount > 0 && (
          <p className="text-sm text-gray-600">
            Subtotal — <span className="text-green-700 font-medium">Income: +{formatDollars(totalIncomeCents)}</span>
            {" · "}
            <span className="font-medium">Expenses: -{formatDollars(totalExpenseCents)}</span>
          </p>
        )}
      </div>

      {hasInapplicableFilters && (
        <p className="text-xs text-gray-500 italic">
          Bank account, date range, and status filters don&rsquo;t apply to budget lines — showing
          matches across all of those.
        </p>
      )}

      {totalCount === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-6 text-center text-gray-500 text-sm">
          {q.trim()
            ? `No budget lines match "${q.trim()}".`
            : "No budget lines match these filters."}
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Cause
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Label
                    </th>
                    {!entityScoped && (
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Entity
                      </th>
                    )}
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Fund
                    </th>
                    {!fyScoped && (
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                        FY
                      </th>
                    )}
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Category
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {rows.map((line) => {
                    const isPendingDelete = line.pendingDeleteAt !== null;
                    // Lump-sum rows have no ledger_budget_lines row to
                    // highlight — target the category row's own
                    // `${categoryId}_${flow}` key instead (budget-editor.tsx
                    // gives that exact string an id="budget-line-<key>", see
                    // Fix 1). If categoryId is somehow null (a deleted
                    // category, ON DELETE SET NULL), omit the highlight
                    // param entirely rather than link to a target that can
                    // never exist — same graceful-degrade posture the
                    // RowHighlighter already has for a stale id.
                    const highlightTarget = line.isLumpSum
                      ? line.categoryId
                        ? `${line.categoryId}_${line.flow}`
                        : null
                      : line.id;
                    const href = highlightTarget
                      ? `/admin/ledger/budgeting/${line.fundSlug}?entity=${line.entitySlug}&fy=${line.fiscalYear}&highlight=${highlightTarget}`
                      : `/admin/ledger/budgeting/${line.fundSlug}?entity=${line.entitySlug}&fy=${line.fiscalYear}`;
                    const causeCellText = line.isLumpSum ? (line.categoryName ?? "—") : line.cause;
                    const rowClass = isPendingDelete
                      ? "relative hover:bg-gray-100 bg-gray-50 text-gray-400"
                      : "relative hover:bg-gray-50 focus-within:bg-gray-50";
                    return (
                      <tr key={line.id} className={rowClass}>
                        <td
                          className={`px-4 py-3 text-sm ${isPendingDelete ? "line-through text-gray-400" : "text-gray-700"}`}
                        >
                          <Link
                            href={href}
                            className="absolute inset-0 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-lions-blue"
                            aria-label={
                              line.isLumpSum
                                ? `View lump-sum budget: ${causeCellText}, ${formatDollars(line.amountCents)}`
                                : `View budget line: ${line.cause}${line.label ? `, ${line.label}` : ""}, ${formatDollars(line.amountCents)}`
                            }
                          >
                            <span className="sr-only">View</span>
                          </Link>
                          <span className="inline-flex items-center gap-1">
                            {line.starred && <StarIcon />}
                            {causeCellText}
                          </span>
                          {line.isLumpSum && (
                            <span className="ml-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-gray-100 text-gray-500 border border-gray-200 no-underline">
                              Lump sum
                            </span>
                          )}
                          {isPendingDelete && (
                            <span className="ml-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-gray-100 text-gray-500 border border-gray-200 no-underline">
                              Pending removal
                            </span>
                          )}
                        </td>
                        <td
                          className={`px-4 py-3 text-sm max-w-[160px] truncate ${isPendingDelete ? "line-through text-gray-400" : "text-gray-600"}`}
                        >
                          {line.isLumpSum ? (
                            <span className="text-gray-400">Not itemized by cause</span>
                          ) : (
                            line.label || <span className="text-gray-400">(generic)</span>
                          )}
                        </td>
                        {!entityScoped && (
                          <td className="px-4 py-3 text-sm max-w-[140px]">
                            <span className="truncate block">{line.entityName}</span>
                          </td>
                        )}
                        <td className="px-4 py-3 text-sm max-w-[140px]">
                          <span className="truncate block">{line.fundName}</span>
                        </td>
                        {!fyScoped && (
                          <td className="whitespace-nowrap px-4 py-3 text-sm">FY{line.fiscalYear}</td>
                        )}
                        <td className="px-4 py-3 text-sm max-w-[140px]">
                          {line.categoryName ?? <span className="text-gray-400">—</span>}
                        </td>
                        <td
                          className={`whitespace-nowrap px-4 py-3 text-right text-sm font-medium tabular-nums ${
                            isPendingDelete
                              ? "line-through text-gray-400"
                              : line.flow === "income"
                                ? "text-green-700"
                                : "text-gray-900"
                          }`}
                        >
                          {line.flow === "income" ? "+" : "-"}
                          {formatDollars(line.amountCents)}
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
