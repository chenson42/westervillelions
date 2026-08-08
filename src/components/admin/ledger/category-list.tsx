"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import CategoryCreateDialog from "./category-create-dialog";
import CategoryRenameDialog from "./category-rename-dialog";
import CategoryFlagsDialog from "./category-flags-dialog";
import CategoryMergeDialog from "./category-merge-dialog";
import CategoryDeactivateConfirm from "./category-deactivate-confirm";
import {
  filterCategoryRows,
  groupCategoriesByFundKind,
  fundKindLabel,
  type AdminCategoryRow,
  type EntityCategoryData,
} from "@/lib/ledger-category-ui";

interface CategoryListProps {
  entities: EntityCategoryData[];
  currentFiscalYear: number;
}

/**
 * Client-owned filter state + grouped accordion + every dialog for
 * `/admin/ledger/settings/categories` (Phase 3 UI Design). The Server
 * Component page hands over every category for every entity (active AND
 * inactive) up front; everything here — entity tab, fund/flow filters,
 * search, show-inactive — is local client-side narrowing over that already-
 * fetched list, matching every other ~100-row admin list in this app
 * (donor-list.tsx).
 */
export default function CategoryList({ entities, currentFiscalYear }: CategoryListProps) {
  const router = useRouter();
  const [activeEntityId, setActiveEntityId] = useState(entities[0]?.id ?? "");
  const [fundKindFilter, setFundKindFilter] = useState("");
  const [flowFilter, setFlowFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<AdminCategoryRow | null>(null);
  const [flagsTarget, setFlagsTarget] = useState<AdminCategoryRow | null>(null);
  const [mergeTarget, setMergeTarget] = useState<AdminCategoryRow | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<AdminCategoryRow | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<AdminCategoryRow | null>(null);
  const [reactivating, setReactivating] = useState(false);

  const activeEntity = entities.find((e) => e.id === activeEntityId) ?? entities[0];

  const filtered = useMemo(() => {
    if (!activeEntity) return [];
    return filterCategoryRows(activeEntity.categories, {
      fundKind: fundKindFilter,
      flow: flowFilter,
      showInactive,
      search,
    });
  }, [activeEntity, fundKindFilter, flowFilter, showInactive, search]);

  const groups = useMemo(() => groupCategoriesByFundKind(filtered), [filtered]);

  const filtersActive = Boolean(fundKindFilter || flowFilter || search.trim() || showInactive);

  function clearFilters() {
    setFundKindFilter("");
    setFlowFilter("");
    setShowInactive(false);
    setSearch("");
  }

  async function handleReactivate() {
    if (!reactivateTarget) return;
    setReactivating(true);
    try {
      const res = await fetch(`/api/admin/ledger/categories/${reactivateTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to reactivate category.");
      }
      toast.success(`"${data.name}" reactivated.`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reactivate category. Try again.");
    } finally {
      setReactivating(false);
      setReactivateTarget(null);
    }
  }

  if (!activeEntity) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        No ledger entities are configured yet.
      </div>
    );
  }

  const hasAnyCategoriesForEntity = activeEntity.categories.length > 0;

  return (
    <div className="space-y-6">
      {/* Entity tabs */}
      {entities.length > 1 && (
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 w-fit">
          {entities.map((entity) => {
            const isActive = entity.id === activeEntityId;
            return (
              <button
                key={entity.id}
                type="button"
                onClick={() => setActiveEntityId(entity.id)}
                aria-current={isActive ? "page" : undefined}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] ${
                  isActive ? "bg-white text-lions-blue shadow-sm" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {entity.shortName ?? entity.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Filter/search toolbar */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex-1 min-w-[180px]">
            <label htmlFor="cat-search" className="block text-xs font-medium text-gray-600 mb-1">
              Search
            </label>
            <input
              id="cat-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by category name…"
              className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
            />
          </div>

          <div className="min-w-[160px]">
            <label htmlFor="cat-fund-filter" className="block text-xs font-medium text-gray-600 mb-1">
              Fund
            </label>
            <select
              id="cat-fund-filter"
              value={fundKindFilter}
              onChange={(e) => setFundKindFilter(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
            >
              <option value="">All funds</option>
              {activeEntity.funds.map((f) => (
                <option key={f.kind} value={f.kind}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[140px]">
            <label htmlFor="cat-flow-filter" className="block text-xs font-medium text-gray-600 mb-1">
              Flow
            </label>
            <select
              id="cat-flow-filter"
              value={flowFilter}
              onChange={(e) => setFlowFilter(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
            >
              <option value="">All flows</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 min-h-[44px]">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
            />
            Show inactive
          </label>

          <div className="sm:ml-auto flex items-center gap-3">
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-sm font-semibold text-gray-500 hover:text-gray-700 transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-2 py-2.5 min-h-[44px]"
              >
                Clear filters
              </button>
            )}
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="bg-lions-blue text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue whitespace-nowrap min-h-[44px]"
            >
              + New Category
            </button>
          </div>
        </div>
      </div>

      {/* Category groups */}
      {!hasAnyCategoriesForEntity ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          <p className="font-medium">No categories yet for {activeEntity.shortName ?? activeEntity.name}.</p>
          <p className="mt-1 text-sm">Create the first one to get started.</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          <p className="font-medium">No categories match your filters.</p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-2 text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <details
              key={group.fundKind}
              open
              className="bg-white rounded-2xl shadow-sm overflow-hidden"
            >
              <summary className="cursor-pointer select-none px-5 py-4 text-base font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-lions-blue">
                {fundKindLabel(group.fundKind, activeEntity.funds)}
                <span className="ml-2 text-sm font-normal text-gray-400">
                  ({group.income.length + group.expense.length})
                </span>
              </summary>
              <div className="border-t border-gray-100 px-2 pb-4 sm:px-4">
                {group.income.length > 0 && (
                  <CategoryFlowTable
                    label="Income"
                    rows={group.income}
                    fundLabel={fundKindLabel(group.fundKind, activeEntity.funds)}
                    onRename={setRenameTarget}
                    onFlags={setFlagsTarget}
                    onMerge={setMergeTarget}
                    onDeactivate={setDeactivateTarget}
                    onReactivate={setReactivateTarget}
                  />
                )}
                {group.expense.length > 0 && (
                  <CategoryFlowTable
                    label="Expense"
                    rows={group.expense}
                    fundLabel={fundKindLabel(group.fundKind, activeEntity.funds)}
                    onRename={setRenameTarget}
                    onFlags={setFlagsTarget}
                    onMerge={setMergeTarget}
                    onDeactivate={setDeactivateTarget}
                    onReactivate={setReactivateTarget}
                  />
                )}
              </div>
            </details>
          ))}
        </div>
      )}

      {/* Dialogs */}
      <CategoryCreateDialog
        entities={entities}
        defaultEntityId={activeEntity.id}
        currentFiscalYear={currentFiscalYear}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />

      {renameTarget && (
        <CategoryRenameDialog
          category={renameTarget}
          fundLabel={fundKindLabel(renameTarget.fundKind, activeEntity.funds)}
          open={Boolean(renameTarget)}
          onOpenChange={(open) => {
            if (!open) setRenameTarget(null);
          }}
        />
      )}

      {flagsTarget && (
        <CategoryFlagsDialog
          category={flagsTarget}
          fundLabel={fundKindLabel(flagsTarget.fundKind, activeEntity.funds)}
          open={Boolean(flagsTarget)}
          onOpenChange={(open) => {
            if (!open) setFlagsTarget(null);
          }}
        />
      )}

      {mergeTarget && (
        <CategoryMergeDialog
          source={mergeTarget}
          allCategories={activeEntity.categories}
          open={Boolean(mergeTarget)}
          onOpenChange={(open) => {
            if (!open) setMergeTarget(null);
          }}
        />
      )}

      <CategoryDeactivateConfirm category={deactivateTarget} onClose={() => setDeactivateTarget(null)} />

      <ConfirmDialog
        open={Boolean(reactivateTarget)}
        onOpenChange={(open) => {
          if (!open) setReactivateTarget(null);
        }}
        title={reactivateTarget ? `Reactivate "${reactivateTarget.name}"?` : "Reactivate category?"}
        description="This category will become available again in category pickers for new transactions and budget lines."
        confirmLabel={reactivating ? "Reactivating…" : "Reactivate"}
        onConfirm={handleReactivate}
      />
    </div>
  );
}

interface CategoryFlowTableProps {
  label: string;
  rows: AdminCategoryRow[];
  fundLabel: string;
  onRename: (row: AdminCategoryRow) => void;
  onFlags: (row: AdminCategoryRow) => void;
  onMerge: (row: AdminCategoryRow) => void;
  onDeactivate: (row: AdminCategoryRow) => void;
  onReactivate: (row: AdminCategoryRow) => void;
}

function CategoryFlowTable({
  label,
  rows,
  fundLabel,
  onRename,
  onFlags,
  onMerge,
  onDeactivate,
  onReactivate,
}: CategoryFlowTableProps) {
  return (
    <div className="mt-4 first:mt-2">
      <h3 className="px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
        {fundLabel} &middot; {label}
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Name
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                Giving
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                Form 990 line
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.id} className={row.isActive ? undefined : "bg-gray-50"}>
                <td className="px-3 py-2 text-sm">
                  <span className={row.isActive ? "text-gray-900 font-medium" : "text-gray-400 line-through"}>
                    {row.name}
                  </span>
                  {!row.isActive && (
                    <span className="ml-2 rounded-lg bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                      Inactive
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-sm whitespace-nowrap">
                  {row.countsAsGiving ? (
                    <span className="text-green-700">Yes</span>
                  ) : (
                    <span className="text-gray-400">No</span>
                  )}
                </td>
                <td className="px-3 py-2 text-sm text-gray-600 whitespace-nowrap">
                  {row.form990Line ?? <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 justify-end">
                    {row.isActive ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onRename(row)}
                          className="text-xs font-medium text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-2 py-1"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => onFlags(row)}
                          className="text-xs font-medium text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-2 py-1"
                        >
                          Edit flags
                        </button>
                        <button
                          type="button"
                          onClick={() => onMerge(row)}
                          className="text-xs font-medium text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-2 py-1"
                        >
                          Merge into…
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeactivate(row)}
                          className="text-xs font-medium text-gray-500 hover:text-red-600 transition focus:outline-none focus:ring-2 focus:ring-gray-300 rounded px-2 py-1"
                        >
                          Deactivate
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onReactivate(row)}
                          className="text-xs font-medium text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-2 py-1"
                        >
                          Reactivate
                        </button>
                        <button
                          type="button"
                          onClick={() => onRename(row)}
                          className="text-xs font-medium text-gray-500 hover:text-gray-700 transition focus:outline-none focus:ring-2 focus:ring-gray-300 rounded px-2 py-1"
                        >
                          Rename
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
