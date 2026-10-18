"use client";

import { useEffect, useState } from "react";
import DonorForm from "./donor-form";
import type { LedgerDonor } from "@/lib/db/schema";
import { formatEmailList } from "@/lib/utils";

interface DonorSearchPanelProps {
  /** Fetch donors only while true (a closed dialog must not query). */
  active: boolean;
  /** Called with the donor the treasurer picked or just created. */
  onSelect: (donor: LedgerDonor) => void;
  /** The donor already chosen; shown as "Current" and not selectable. */
  currentDonorId?: string | null;
  /** Disables the rows while the parent is saving the choice. */
  busy?: boolean;
  /** Closes the surrounding dialog (Cancel, and the create form's Cancel). */
  onCancel: () => void;
}

/**
 * Search existing donors or create a new one, then hand the donor to the
 * caller. Extracted from LinkDonorDialog so the transaction form's donor
 * picker and the register's Link donor dialog share one panel. Gate:
 * LEDGER_RECORD (the caller enforces it).
 */
export default function DonorSearchPanel({
  active,
  onSelect,
  currentDonorId,
  busy = false,
  onCancel,
}: DonorSearchPanelProps) {
  const [mode, setMode] = useState<"search" | "create">("search");
  const [search, setSearch] = useState("");
  // The last finished search. "Loading" is derived (no result for the current
  // query yet), so the effect never sets state synchronously.
  const [result, setResult] = useState<{ query: string; donors: LedgerDonor[] | null } | null>(null);
  const query = search.trim();
  const loading = active && result?.query !== query;
  const loadFailed = !loading && result?.donors === null;
  const donors = result?.donors ?? [];

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const params = query ? `?search=${encodeURIComponent(query)}` : "";
    fetch(`/api/admin/ledger/donors${params}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load failed"))))
      .then((data) => setResult({ query, donors: data.donors ?? [] }))
      .catch((err) => {
        if (err?.name !== "AbortError") setResult({ query, donors: null });
      });
    return () => controller.abort();
  }, [active, query]);

  return (
    <>
      <div className="flex gap-2 mb-4 mt-3">
        <button
          type="button"
          onClick={() => setMode("search")}
          className={`px-3 py-2 rounded-lg text-xs font-medium transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue ${
            mode === "search"
              ? "bg-lions-blue text-white"
              : "border border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          Search existing donors
        </button>
        <button
          type="button"
          onClick={() => setMode("create")}
          className={`px-3 py-2 rounded-lg text-xs font-medium transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue ${
            mode === "create"
              ? "bg-lions-blue text-white"
              : "border border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          Create new donor
        </button>
      </div>

      {mode === "search" && (
        <div className="space-y-3">
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="block w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm min-h-[44px] focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              aria-label="Search donors"
            />
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : loadFailed ? (
            <div className="text-center py-6 text-sm text-red-700">
              Couldn&rsquo;t load donors. Check your connection and try again.
            </div>
          ) : donors.length === 0 ? (
            <div className="text-center py-6 text-sm text-gray-500">
              {search.trim()
                ? `No donors match "${search}". Try creating a new donor.`
                : "No donors yet. Create one below."}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 max-h-64 overflow-y-auto">
              {donors.map((donor) => (
                <li key={donor.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(donor)}
                    disabled={busy || donor.id === currentDonorId}
                    className="w-full text-left px-4 py-3 min-h-[44px] hover:bg-gray-50 transition flex items-center justify-between gap-3 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-inset"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">{donor.name}</p>
                      {formatEmailList(donor.emails) && (
                        <p className="text-xs text-gray-400">{formatEmailList(donor.emails)}</p>
                      )}
                    </div>
                    {donor.id === currentDonorId ? (
                      <span className="text-xs text-gray-400 italic">Current</span>
                    ) : (
                      <span className="text-xs font-semibold text-lions-blue">Select</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mode === "create" && <DonorForm onClose={onCancel} onSuccess={(newDonor) => onSelect(newDonor)} />}

      {mode === "search" && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue"
          >
            Cancel
          </button>
        </div>
      )}
    </>
  );
}
