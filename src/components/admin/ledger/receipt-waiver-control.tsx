"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const WAIVER_REASON_MAX_LEN = 500;

interface ReceiptWaiverControlProps {
  transactionId: string;
  /** Current waiver state for this row. */
  waived: boolean;
  waiverReason: string | null;
}

/**
 * Waive / un-waive control for an expense row's missing-receipt compliance
 * flag (DECISION-035). Only ever rendered by the caller when the viewer has
 * LEDGER_MANAGE — waiving suppresses a compliance signal, a step up from the
 * LEDGER_RECORD gate that covers ordinary transaction edits (server-side
 * routes re-check this regardless of what the UI hides).
 *
 * Never rendered for rows that already have a receipt attached — the waive
 * route 409s in that case, and the parent only shows this control when
 * receiptStorageKey is null.
 */
export default function ReceiptWaiverControl({
  transactionId,
  waived,
  waiverReason,
}: ReceiptWaiverControlProps) {
  const router = useRouter();
  const [waiveDialogOpen, setWaiveDialogOpen] = useState(false);
  const [unwaiveConfirmOpen, setUnwaiveConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleWaive(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error("A reason is required to waive the receipt requirement.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/ledger/transactions/${transactionId}/receipt/waive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to waive the receipt requirement.");
      }
      toast.success("Receipt requirement waived.");
      setWaiveDialogOpen(false);
      setReason("");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not waive the receipt requirement. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnwaive() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/ledger/transactions/${transactionId}/receipt/waive`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to un-waive the receipt requirement.");
      }
      toast.success("Receipt requirement restored — this transaction is flagged again.");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not un-waive the receipt requirement. Please try again."
      );
    } finally {
      setSubmitting(false);
      setUnwaiveConfirmOpen(false);
    }
  }

  if (waived) {
    return (
      <>
        <button
          type="button"
          onClick={() => setUnwaiveConfirmOpen(true)}
          disabled={submitting}
          className="text-xs font-medium text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1.5 py-0.5 disabled:opacity-60"
        >
          Un-waive
        </button>
        <ConfirmDialog
          open={unwaiveConfirmOpen}
          onOpenChange={setUnwaiveConfirmOpen}
          title="Un-waive receipt requirement?"
          description={`This transaction will count again toward the missing-receipt compliance warning.${
            waiverReason ? ` Current waiver reason: "${waiverReason}"` : ""
          }`}
          confirmLabel="Un-waive"
          onConfirm={handleUnwaive}
        />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setWaiveDialogOpen(true)}
        className="text-xs font-medium text-gray-500 hover:text-lions-blue transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1.5 py-0.5"
      >
        Waive
      </button>

      <Dialog.Root open={waiveDialogOpen} onOpenChange={setWaiveDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-lg font-semibold text-gray-900">
                Waive receipt requirement
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
              Mark this expense as &ldquo;no receipt available&rdquo; and exclude it from the
              missing-receipt compliance count. Record why — e.g. &ldquo;predates online
              records&rdquo; or &ldquo;receipt lost, treasurer confirmed.&rdquo;
            </Dialog.Description>
            <form onSubmit={handleWaive} className="space-y-4">
              <div>
                <label htmlFor="waiver-reason" className="block text-sm font-medium text-gray-700 mb-1">
                  Reason <span className="text-gray-400 font-normal">(required)</span>
                </label>
                <textarea
                  id="waiver-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, WAIVER_REASON_MAX_LEN))}
                  rows={3}
                  maxLength={WAIVER_REASON_MAX_LEN}
                  required
                  disabled={submitting}
                  className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60 resize-none"
                  placeholder="Why is a receipt not available for this transaction?"
                />
                <p className="mt-1 text-xs text-gray-400">
                  {reason.length}/{WAIVER_REASON_MAX_LEN} characters
                </p>
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setWaiveDialogOpen(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-lions-blue text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
                >
                  {submitting ? "Saving…" : "Waive"}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
