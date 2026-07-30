"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface SplitTransactionDialogProps {
  transactionId: string;
  /** The row's CURRENT amount in cents — used for client-side validation and
   *  the "current total" display. Repeatable splits validate against this
   *  current value, not any original historical amount. */
  currentAmountCents: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function centsToDisplay(cents: number): string {
  return (cents / 100).toFixed(2);
}

function parseDollars(value: string): number | null {
  const n = parseFloat(value.replace(/[$,]/g, "").trim());
  if (isNaN(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/**
 * Split dialog: takes a required split-amount input, so it cannot be a
 * plain <ConfirmDialog> (no free-form input) and must never be
 * window.prompt() (forbidden). Follows the TransactionFormDialog shadcn
 * Dialog pattern.
 *
 * Client-side validates > $0 and < the row's current amount, but the
 * server (POST /api/admin/ledger/transactions/[id]/split) is the source of
 * truth for all guards — any server block message is surfaced via
 * toast.error.
 */
export default function SplitTransactionDialog({
  transactionId,
  currentAmountCents,
  open,
  onOpenChange,
}: SplitTransactionDialogProps) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setAmount("");
      setClientError(null);
    }
    onOpenChange(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setClientError(null);

    const amountCents = parseDollars(amount);
    if (amountCents === null) {
      setClientError("Enter an amount greater than $0.");
      return;
    }
    if (amountCents >= currentAmountCents) {
      setClientError("Split amount must be less than the transaction's current total.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/ledger/transactions/${transactionId}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to split transaction.");
      }
      toast.success("Transaction split into two rows.");
      handleOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not split transaction. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl overflow-y-auto max-h-[90vh] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold text-gray-900">
              Split Transaction
            </Dialog.Title>
            <Dialog.Close
              className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Dialog.Close>
          </div>

          <Dialog.Description className="text-sm text-gray-500 mb-4">
            Current total: <span className="font-semibold text-gray-700">${centsToDisplay(currentAmountCents)}</span>.
            Enter the amount for the new part — the remainder stays on this row. Everything
            else (fund, category, party, memo, bank account, date) carries over to the new row
            unchanged; edit it afterward if needed.
          </Dialog.Description>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="split-amount" className="block text-sm font-medium text-gray-700 mb-1">
                Split amount ($)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm select-none">
                  $
                </span>
                <input
                  id="split-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  autoFocus
                  className="block w-full rounded-lg border border-gray-300 py-2 pl-7 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                  placeholder="0.00"
                />
              </div>
              {clientError && (
                <p className="mt-1 text-xs text-red-600">{clientError}</p>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="bg-lions-blue text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                {submitting ? "Splitting..." : "Split Transaction"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
