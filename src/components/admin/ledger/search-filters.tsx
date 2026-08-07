"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fiscalYearLabel } from "@/lib/fiscal-year";

export interface SearchEntityOption {
  slug: string;
  label: string;
}

export interface SearchFundOption {
  slug: string;
  entitySlug: string;
  label: string;
}

export interface SearchCategoryOption {
  id: string;
  entitySlug: string;
  label: string;
}

export interface SearchBankAccountOption {
  id: string;
  entitySlug: string;
  label: string;
}

export interface SearchFiltersValue {
  q: string;
  /** "" = default to current FY, "all" = All years, else a numeric-string FY. */
  fy: string;
  entity: string;
  fund: string;
  categoryId: string;
  cause: string;
  bankAccountId: string;
  amountMin: string;
  amountMax: string;
  dateFrom: string;
  dateTo: string;
  status: string;
}

interface SearchFiltersProps {
  value: SearchFiltersValue;
  currentFY: number;
  fiscalYearOptions: number[];
  entityOptions: SearchEntityOption[];
  fundOptions: SearchFundOption[];
  categoryOptions: SearchCategoryOption[];
  bankAccountOptions: SearchBankAccountOption[];
  causeOptions: readonly string[];
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any status" },
  { value: "posted", label: "Posted" },
  { value: "pending", label: "Pending" },
  { value: "rejected", label: "Rejected" },
];

/**
 * The one genuine `'use client'` component in this feature (Phase 2/3
 * ruling) — ~10 filter axes that must submit together as a single
 * navigation, not one auto-navigating <select> per field. Holds local form
 * state seeded from `value` (itself derived from the current URL by
 * page.tsx), builds a fresh URLSearchParams from EVERY current field (not a
 * diff — so tweaking one filter never silently drops `q` or any other filter
 * already in flight) and does one router.push on submit. Changing any filter
 * resets both txnPage and budgetPage to 1 by omitting them from the new URL.
 */
export default function SearchFilters({
  value,
  currentFY,
  fiscalYearOptions,
  entityOptions,
  fundOptions,
  categoryOptions,
  bankAccountOptions,
  causeOptions,
}: SearchFiltersProps) {
  const router = useRouter();
  const [form, setForm] = useState<SearchFiltersValue>(value);

  function set<K extends keyof SearchFiltersValue>(key: K, next: SearchFiltersValue[K]) {
    setForm((prev) => {
      // Changing the entity invalidates any fund/category/bank-account
      // selection scoped to the PREVIOUS entity — clear them rather than
      // silently submitting a mismatched combination.
      if (key === "entity") {
        return { ...prev, entity: next as string, fund: "", categoryId: "", bankAccountId: "" };
      }
      return { ...prev, [key]: next };
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (form.q.trim()) params.set("q", form.q.trim());
    if (form.fy) params.set("fy", form.fy);
    if (form.entity) params.set("entity", form.entity);
    if (form.fund) params.set("fund", form.fund);
    if (form.categoryId) params.set("category", form.categoryId);
    if (form.cause) params.set("cause", form.cause);
    if (form.bankAccountId) params.set("bankAccount", form.bankAccountId);
    if (form.amountMin) params.set("amountMin", form.amountMin);
    if (form.amountMax) params.set("amountMax", form.amountMax);
    if (form.dateFrom) params.set("dateFrom", form.dateFrom);
    if (form.dateTo) params.set("dateTo", form.dateTo);
    if (form.status) params.set("status", form.status);
    // txnPage/budgetPage deliberately omitted — a filter change starts a
    // fresh result set at page 1 for both groups.
    const query = params.toString();
    router.push(`/admin/ledger/search${query ? `?${query}` : ""}`);
  }

  function handleClear() {
    router.push("/admin/ledger/search");
  }

  const visibleFundOptions = form.entity
    ? fundOptions.filter((f) => f.entitySlug === form.entity)
    : fundOptions;
  const visibleCategoryOptions = form.entity
    ? categoryOptions.filter((c) => c.entitySlug === form.entity)
    : categoryOptions;
  const visibleBankAccountOptions = form.entity
    ? bankAccountOptions.filter((b) => b.entitySlug === form.entity)
    : bankAccountOptions;

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-2xl shadow-sm overflow-hidden p-4 sm:p-5 space-y-4"
    >
      <h2 className="text-sm font-semibold text-gray-700">Advanced filters</h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label htmlFor="filter-fy" className="block text-xs font-medium text-gray-600 mb-1">
            Fiscal year
          </label>
          <select
            id="filter-fy"
            value={form.fy}
            onChange={(e) => set("fy", e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
          >
            <option value="">{fiscalYearLabel(currentFY)} (current)</option>
            <option value="all">All years</option>
            {fiscalYearOptions
              .filter((fy) => fy !== currentFY)
              .map((fy) => (
                <option key={fy} value={String(fy)}>
                  {fiscalYearLabel(fy)}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label htmlFor="filter-entity" className="block text-xs font-medium text-gray-600 mb-1">
            Entity
          </label>
          <select
            id="filter-entity"
            value={form.entity}
            onChange={(e) => set("entity", e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
          >
            <option value="">All entities</option>
            {entityOptions.map((e) => (
              <option key={e.slug} value={e.slug}>
                {e.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="filter-fund" className="block text-xs font-medium text-gray-600 mb-1">
            Fund
          </label>
          <select
            id="filter-fund"
            value={form.fund}
            onChange={(e) => set("fund", e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
          >
            <option value="">All funds</option>
            {visibleFundOptions.map((f) => (
              <option key={`${f.entitySlug}-${f.slug}`} value={f.slug}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="filter-category" className="block text-xs font-medium text-gray-600 mb-1">
            Category
          </label>
          <select
            id="filter-category"
            value={form.categoryId}
            onChange={(e) => set("categoryId", e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
          >
            <option value="">All categories</option>
            {visibleCategoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="filter-cause" className="block text-xs font-medium text-gray-600 mb-1">
            Cause
          </label>
          <select
            id="filter-cause"
            value={form.cause}
            onChange={(e) => set("cause", e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
          >
            <option value="">All causes</option>
            {causeOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="filter-bank-account" className="block text-xs font-medium text-gray-600 mb-1">
            Bank account <span className="text-gray-400 font-normal">(transactions only)</span>
          </label>
          <select
            id="filter-bank-account"
            value={form.bankAccountId}
            onChange={(e) => set("bankAccountId", e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
          >
            <option value="">All bank accounts</option>
            {visibleBankAccountOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="filter-amount-min" className="block text-xs font-medium text-gray-600 mb-1">
            Amount min ($)
          </label>
          <input
            id="filter-amount-min"
            type="number"
            min="0"
            step="0.01"
            value={form.amountMin}
            onChange={(e) => set("amountMin", e.target.value)}
            placeholder="Exact match if alone"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
          />
        </div>

        <div>
          <label htmlFor="filter-amount-max" className="block text-xs font-medium text-gray-600 mb-1">
            Amount max ($)
          </label>
          <input
            id="filter-amount-max"
            type="number"
            min="0"
            step="0.01"
            value={form.amountMax}
            onChange={(e) => set("amountMax", e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
          />
        </div>

        <div>
          <label htmlFor="filter-status" className="block text-xs font-medium text-gray-600 mb-1">
            Status <span className="text-gray-400 font-normal">(transactions only)</span>
          </label>
          <select
            id="filter-status"
            value={form.status}
            onChange={(e) => set("status", e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="filter-date-from" className="block text-xs font-medium text-gray-600 mb-1">
            Date from <span className="text-gray-400 font-normal">(transactions only)</span>
          </label>
          <input
            id="filter-date-from"
            type="date"
            value={form.dateFrom}
            onChange={(e) => set("dateFrom", e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
          />
        </div>

        <div>
          <label htmlFor="filter-date-to" className="block text-xs font-medium text-gray-600 mb-1">
            Date to <span className="text-gray-400 font-normal">(transactions only)</span>
          </label>
          <input
            id="filter-date-to"
            type="date"
            value={form.dateTo}
            onChange={(e) => set("dateTo", e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          className="bg-lions-blue text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
        >
          Apply filters
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="text-sm font-semibold text-gray-500 hover:text-gray-700 transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-2 py-2.5 min-h-[44px]"
        >
          Clear all
        </button>
      </div>
    </form>
  );
}
