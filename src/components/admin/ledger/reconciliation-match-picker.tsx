"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { BankLineWithMatch, CandidateTransactionRow } from "@/lib/reconciliation-queries";
import { computeSelectionSummary } from "@/lib/reconciliation";

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

/** Income displays positive, expense displays negative — lets the treasurer
 *  eyeball agreement against the bank line's own signed amount. Same
 *  convention as computeSelectionSummary() and the server's own exact-sum
 *  re-check (match/route.ts's signedAmountCents) — generalizes correctly to
 *  a debit line matched against a set of expense rows, and a credit line
 *  against income rows (DECISION-051). */
function signedAmount(txn: CandidateTransactionRow): number {
  return txn.flow === "expense" ? -txn.amountCents : txn.amountCents;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  check: "Check",
  cash: "Cash",
  zeffy: "Zeffy",
  debit_card: "Debit Card",
  bill_pay: "Bill Pay",
  other: "Other",
};

function paymentMethodLabel(method: string): string {
  return (
    PAYMENT_METHOD_LABELS[method] ??
    method
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

type SortKey = "date" | "amount";

interface ReconciliationMatchPickerProps {
  sessionId: string;
  bankLine: BankLineWithMatch;
  /** Every unreconciled, unmatched posted transaction on this account —
   *  income AND expense alike, NOT pre-filtered or ranked (candidate list is
   *  deliberately generic — Phase 1 Scope Decision, DECISION-051). The
   *  payment-method chips and sort below are pure client-side display
   *  narrowing; they never remove a row from the underlying selectable set. */
  candidateTransactions: CandidateTransactionRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Batch match picker: select one or more candidate transactions whose signed
 * amounts sum EXACTLY to this bank line's signed amount, then commit them as
 * a single match (DECISION-051). A single-row pick is just a batch of one —
 * same commit path, same POST shape (`transactionIds: string[]`).
 *
 * The server re-validates and re-sums everything (match/route.ts) — this
 * component's running-sum indicator and disabled-until-balanced gate are a
 * UX convenience only, never trusted as the source of truth.
 */
export default function ReconciliationMatchPicker({
  sessionId,
  bankLine,
  candidateTransactions,
  open,
  onOpenChange,
}: ReconciliationMatchPickerProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeMethods, setActiveMethods] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const paymentMethods = useMemo(() => {
    const set = new Set<string>();
    for (const t of candidateTransactions) set.add(t.paymentMethod ?? "other");
    return Array.from(set).sort();
  }, [candidateTransactions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = candidateTransactions;
    if (activeMethods.size > 0) {
      rows = rows.filter((t) => activeMethods.has(t.paymentMethod ?? "other"));
    }
    if (q) {
      rows = rows.filter((t) => {
        const haystack = [
          t.party ?? "",
          t.memo ?? "",
          t.checkNumber ?? "",
          (Math.abs(t.amountCents) / 100).toFixed(2),
          t.txnDate,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }
    return rows;
  }, [query, activeMethods, candidateTransactions]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      const cmp =
        sortKey === "date" ? a.txnDate.localeCompare(b.txnDate) : signedAmount(a) - signedAmount(b);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [filtered, sortKey, sortDir]);

  const selectedTransactions = useMemo(
    () => candidateTransactions.filter((t) => selectedIds.has(t.id)),
    [candidateTransactions, selectedIds],
  );
  const summary = useMemo(
    () => computeSelectionSummary(selectedTransactions, bankLine.amountCents),
    [selectedTransactions, bankLine.amountCents],
  );

  const allVisibleSelected = sorted.length > 0 && sorted.every((t) => selectedIds.has(t.id));
  const someVisibleSelected = sorted.some((t) => selectedIds.has(t.id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [someVisibleSelected, allVisibleSelected]);

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const t of sorted) next.delete(t.id);
      } else {
        for (const t of sorted) next.add(t.id);
      }
      return next;
    });
  }

  function toggleMethod(method: string) {
    setActiveMethods((prev) => {
      const next = new Set(prev);
      if (next.has(method)) next.delete(method);
      else next.add(method);
      return next;
    });
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return null;
    return <span aria-hidden="true">{sortDir === "asc" ? " ▲" : " ▼"}</span>;
  }

  function mapMatchError(status: number, data: { error?: string; deltaCents?: number }): string {
    if (status === 400 && typeof data.deltaCents === "number") {
      const dollars = (Math.abs(data.deltaCents) / 100).toFixed(2);
      return `Selected transactions must sum exactly to this line (off by $${dollars}).`;
    }
    if (status === 409) {
      return "One of these was just matched elsewhere — refresh and reselect.";
    }
    return data.error || "Failed to match this bank line.";
  }

  async function handleCommit() {
    if (selectedIds.size === 0 || !summary.balanced || committing) return;
    setCommitting(true);
    try {
      const res = await fetch(
        `/api/admin/ledger/reconciliation/sessions/${sessionId}/match`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bankLineId: bankLine.id,
            transactionIds: Array.from(selectedIds),
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(mapMatchError(res.status, data));
      }
      const count = typeof data.count === "number" ? data.count : selectedIds.size;
      toast.success(count > 1 ? `Matched ${count} transactions.` : "Matched.");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      // Dialog stays open, selectedIds preserved — a dropped request
      // shouldn't force the treasurer to re-check every box (Flow 1).
      toast.error(
        err instanceof Error ? err.message : "Could not match these transactions. Try again.",
      );
    } finally {
      setCommitting(false);
    }
  }

  const summaryColorClass = summary.balanced
    ? "text-green-700"
    : selectedIds.size === 0
      ? "text-gray-500"
      : "text-amber-700";

  let summaryLabel: string;
  if (selectedIds.size === 0) {
    summaryLabel = `Select rows summing to ${formatDollars(bankLine.amountCents)}`;
  } else if (summary.balanced) {
    summaryLabel = `${formatDollars(summary.selectedSumCents)} of ${formatDollars(bankLine.amountCents)} — balanced`;
  } else if (summary.deltaCents > 0) {
    summaryLabel = `${formatDollars(summary.selectedSumCents)} of ${formatDollars(bankLine.amountCents)} — ${formatDollars(summary.deltaCents)} short`;
  } else {
    summaryLabel = `${formatDollars(summary.selectedSumCents)} of ${formatDollars(bankLine.amountCents)} — over by ${formatDollars(-summary.deltaCents)}`;
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl max-h-[85vh] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl overflow-y-auto data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <Dialog.Title className="text-lg font-semibold text-gray-900">
            Match bank line
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-500">
            {formatDate(bankLine.postingDate)} &middot; {bankLine.description} &middot;{" "}
            <span className="font-semibold tabular-nums">
              {formatDollars(bankLine.amountCents)}
            </span>
          </Dialog.Description>
          <p className="mt-1 text-xs text-gray-500">
            Select one or more transactions whose amounts sum exactly to this line — income and
            expense rows both eligible.
          </p>

          <div className="mt-4">
            <label htmlFor="match-picker-search" className="sr-only">
              Search candidate transactions by party, memo, check number, amount, or date
            </label>
            <input
              id="match-picker-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by party, memo, check #, amount, or date…"
              className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>

          {paymentMethods.length > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-500">Filter:</span>
              {paymentMethods.map((m) => {
                const active = activeMethods.has(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleMethod(m)}
                    aria-pressed={active}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-lions-blue ${
                      active
                        ? "bg-lions-blue text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {paymentMethodLabel(m)}
                  </button>
                );
              })}
              {activeMethods.size > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveMethods(new Set())}
                  className="text-xs font-semibold text-lions-blue hover:text-lions-blue-dark hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          <div className="mt-4">
            {sorted.length === 0 ? (
              <div className="bg-gray-50 rounded-2xl p-8 text-center text-gray-500 text-sm">
                {candidateTransactions.length === 0
                  ? "No unreconciled posted transactions on this account to match against."
                  : "No transactions match this search/filter."}
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <div className="overflow-x-auto max-h-96">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left whitespace-nowrap">
                          <label className="flex h-11 w-11 -my-3 cursor-pointer items-center justify-center">
                            <span className="sr-only">Select all visible rows</span>
                            <input
                              ref={selectAllRef}
                              type="checkbox"
                              checked={allVisibleSelected}
                              onChange={toggleSelectAllVisible}
                              className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
                            />
                          </label>
                        </th>
                        <th
                          className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap cursor-pointer select-none"
                          onClick={() => handleSort("date")}
                        >
                          Date{sortIndicator("date")}
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Party / Memo
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                          Check #
                        </th>
                        <th
                          className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap cursor-pointer select-none"
                          onClick={() => handleSort("amount")}
                        >
                          Amount{sortIndicator("amount")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {sorted.map((t) => {
                        const checked = selectedIds.has(t.id);
                        return (
                          <tr key={t.id} className={checked ? "bg-lions-blue/5" : undefined}>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <label className="flex h-11 w-11 -my-3 cursor-pointer items-center justify-center">
                                <span className="sr-only">
                                  Select {t.party || t.memo || "transaction"} for{" "}
                                  {formatDollars(signedAmount(t))} on {formatDate(t.txnDate)}
                                </span>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleRow(t.id)}
                                  className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
                                />
                              </label>
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">
                              {formatDate(t.txnDate)}
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-700">
                              {t.party || t.memo || <span className="text-gray-400">&mdash;</span>}
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-700 tabular-nums whitespace-nowrap">
                              {t.checkNumber ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-sm font-semibold tabular-nums text-right whitespace-nowrap">
                              {formatDollars(signedAmount(t))}
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

          <div className="mt-4 sticky bottom-0 -mx-6 -mb-6 border-t border-gray-200 bg-white px-6 py-4 rounded-b-2xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className={`text-sm font-semibold ${summaryColorClass}`}>
                {selectedIds.size > 0 && (
                  <span className="tabular-nums">
                    {selectedIds.size} selected &middot;{" "}
                  </span>
                )}
                {summaryLabel}
              </p>
              <div className="flex justify-end gap-3">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
                  >
                    Close
                  </button>
                </Dialog.Close>
                <button
                  type="button"
                  onClick={handleCommit}
                  disabled={selectedIds.size === 0 || !summary.balanced || committing}
                  className="bg-lions-blue text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-lions-blue"
                >
                  {committing
                    ? "Matching…"
                    : `Match selected${selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}`}
                </button>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
