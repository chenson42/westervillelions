"use client";

import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { BankLineWithMatch, CandidateTransactionRow } from "@/lib/reconciliation-queries";

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
 *  eyeball agreement against the bank line's own signed amount, even though
 *  inc2 enforces no amount/date agreement server-side (the human's judgment
 *  is the entire matching engine this increment). */
function signedAmount(txn: CandidateTransactionRow): number {
  return txn.flow === "expense" ? -txn.amountCents : txn.amountCents;
}

interface ReconciliationMatchPickerProps {
  sessionId: string;
  bankLine: BankLineWithMatch;
  /** Every unreconciled, unmatched posted transaction on this account —
   *  NOT pre-filtered or ranked by amount/date/party (design doc: inc2 has
   *  no auto-match/scoring engine). This dialog's search box is purely
   *  client-side convenience over that same full list. */
  candidateTransactions: CandidateTransactionRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Accept" a match — the human explicitly picks both sides of a pair. There
 * is no persisted "rejected" state (the design's resolved naming question):
 * simply not picking a candidate from this list is the reject action, and
 * it's non-persisted.
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
  const [matchingId, setMatchingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidateTransactions;
    return candidateTransactions.filter((t) => {
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
  }, [query, candidateTransactions]);

  async function handlePick(transactionId: string) {
    setMatchingId(transactionId);
    try {
      const res = await fetch(
        `/api/admin/ledger/reconciliation/sessions/${sessionId}/match`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bankLineId: bankLine.id, transactionId }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to match this transaction.");
      }
      toast.success("Matched.");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not match this transaction. Try again."
      );
    } finally {
      setMatchingId(null);
    }
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

          <div className="mt-4">
            {filtered.length === 0 ? (
              <div className="bg-gray-50 rounded-2xl p-8 text-center text-gray-500 text-sm">
                {candidateTransactions.length === 0
                  ? "No unreconciled posted transactions on this account to match against."
                  : "No transactions match this search."}
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <div className="overflow-x-auto max-h-96">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                          Date
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Party / Memo
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                          Check #
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                          Amount
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                          <span className="sr-only">Select</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {filtered.map((t) => (
                        <tr key={t.id}>
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
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => handlePick(t.id)}
                              disabled={matchingId !== null}
                              className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark transition disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-2 py-1"
                            >
                              {matchingId === t.id ? "Matching…" : "Match"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
              >
                Close
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
