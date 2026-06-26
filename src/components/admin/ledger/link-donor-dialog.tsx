"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import DonorForm from "./donor-form";
import type { LedgerDonor } from "@/lib/db/schema";

interface LinkDonorDialogProps {
  txnId: string;
  txnAmountCents: number;
  txnDate: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently linked donor id, if any */
  currentDonorId?: string | null;
}

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/**
 * Dialog to link a Foundation income transaction to a donor.
 * PATCHes /api/admin/ledger/donors/[donorId] indirectly — uses
 * PATCH /api/admin/ledger/transactions/[id] to set donorId.
 *
 * Provides:
 *   - Search existing donors
 *   - Create new donor inline
 *   - Remove donor link
 *
 * Gate: LEDGER_RECORD (caller must enforce).
 */
export default function LinkDonorDialog({
  txnId,
  txnAmountCents,
  txnDate,
  open,
  onOpenChange,
  currentDonorId,
}: LinkDonorDialogProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"search" | "create">("search");
  const [search, setSearch] = useState("");
  const [donors, setDonors] = useState<LedgerDonor[]>([]);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);

  // Fetch donors for search
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);

    const params = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
    fetch(`/api/admin/ledger/donors${params}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setDonors(data.donors ?? []);
      })
      .catch(() => { /* aborted */ })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [open, search]);

  async function linkDonor(donorId: string) {
    setLinking(true);
    try {
      // PATCH the transaction to set donorId
      const res = await fetch(`/api/admin/ledger/transactions/${txnId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ donorId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to link donor.");
      }
      toast.success("Donor linked to this transaction.");
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not link donor. Try again.");
    } finally {
      setLinking(false);
    }
  }

  async function unlinkDonor() {
    setLinking(true);
    try {
      const res = await fetch(`/api/admin/ledger/transactions/${txnId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ donorId: null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove donor link.");
      }
      toast.success("Donor link removed.");
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove donor link. Try again.");
    } finally {
      setLinking(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 focus:outline-none max-h-[90vh] overflow-y-auto">
          <Dialog.Title className="text-lg font-semibold text-gray-900 mb-1">
            Link Donor
          </Dialog.Title>
          <Dialog.Description className="text-sm text-gray-500 mb-1">
            Link this {txnDate} donation of{" "}
            <span className="font-semibold text-green-700">{formatDollars(txnAmountCents)}</span>{" "}
            to a donor record for acknowledgment tracking.
          </Dialog.Description>

          {/* Remove link option */}
          {currentDonorId && (
            <div className="mb-4 mt-2 rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-center justify-between gap-3">
              <p className="text-xs text-amber-800">A donor is currently linked to this transaction.</p>
              <button
                type="button"
                onClick={unlinkDonor}
                disabled={linking}
                className="text-xs font-medium text-amber-700 hover:text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-400 rounded transition disabled:opacity-60 whitespace-nowrap"
              >
                Remove link
              </button>
            </div>
          )}

          {/* Mode toggle */}
          <div className="flex gap-2 mb-4 mt-3">
            <button
              type="button"
              onClick={() => setMode("search")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-lions-blue ${
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
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-lions-blue ${
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
              {/* Search input */}
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
                  className="block w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                  aria-label="Search donors"
                />
              </div>

              {/* Donor list */}
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
                  ))}
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
                        onClick={() => linkDonor(donor.id)}
                        disabled={linking || donor.id === currentDonorId}
                        className="w-full text-left px-4 py-3 hover:bg-gray-50 transition flex items-center justify-between gap-3 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-inset"
                      >
                        <div>
                          <p className="text-sm font-medium text-gray-900">{donor.name}</p>
                          {donor.email && (
                            <p className="text-xs text-gray-400">{donor.email}</p>
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

          {mode === "create" && (
            <DonorForm
              onClose={() => onOpenChange(false)}
              onSuccess={(newDonor) => {
                // After creating, immediately link the new donor
                linkDonor(newDonor.id);
              }}
            />
          )}

          {mode === "search" && (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
