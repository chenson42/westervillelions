"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface ApproveDialogProps {
  transactionId: string;
  amount: string;
  party: string;
  /**
   * The transaction's existing board-minute citation, if any. Cross-entity
   * Sweeps carry a mandatory board-minute from creation time; pre-filling it
   * here means the approver sees and preserves the original motion reference
   * instead of being forced to retype (and silently overwrite) it. When this
   * is set, a blank submission is allowed — the server preserves the existing
   * citation ("required only if not already set").
   */
  existingBoardMinute?: string | null;
  children: React.ReactNode;
}

/**
 * Opens a dialog that collects a board-minute reference, then POSTs to the
 * approve route. A board-minute is required when the row doesn't already carry
 * one; when it does (e.g. a Sweep cited at creation), the field is pre-filled
 * and a blank submit preserves the original — matching the server's rule.
 *
 * The trigger element is passed as children so the parent controls the button
 * appearance without this component needing to know about it.
 */
export default function ApproveDialog({
  transactionId,
  amount,
  party,
  existingBoardMinute,
  children,
}: ApproveDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [boardMinute, setBoardMinute] = useState(existingBoardMinute ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function handleApprove() {
    const trimmed = boardMinute.trim();
    if (!trimmed && !existingBoardMinute) {
      toast.error("A board-minute reference is required to approve a disbursement.");
      return;
    }
    if (trimmed.length > 500) {
      toast.error("Board-minute reference must be 500 characters or fewer.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/ledger/transactions/${transactionId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardMinute: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to approve disbursement.");
      }

      toast.success("Disbursement approved.");
      setOpen(false);
      setBoardMinute(existingBoardMinute ?? "");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not approve disbursement. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <Dialog.Title className="text-lg font-semibold text-gray-900">
            Approve Disbursement
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-500">
            {amount}{party ? ` — ${party}` : ""}
          </Dialog.Description>

          <div className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="approve-board-minute"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Board-minute reference{" "}
                <span className="text-gray-400 font-normal text-xs">
                  {existingBoardMinute ? "(pre-filled from the original motion)" : "(required)"}
                </span>
              </label>
              <input
                id="approve-board-minute"
                type="text"
                value={boardMinute}
                onChange={(e) => setBoardMinute(e.target.value)}
                maxLength={500}
                placeholder="e.g., Motion passed May 2026 meeting, minute §4"
                className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                autoFocus
              />
              <p className="mt-1 text-xs text-gray-400">
                {existingBoardMinute
                  ? "This item already cites a board motion (shown above). Leave it as-is to keep the original citation, or edit only to amend it."
                  : "Enter the board-meeting minute or motion reference that authorized this disbursement."}
              </p>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <Dialog.Close className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
              Cancel
            </Dialog.Close>
            <button
              type="button"
              onClick={handleApprove}
              disabled={submitting || (!boardMinute.trim() && !existingBoardMinute)}
              className="bg-lions-blue text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              {submitting ? "Approving…" : "Approve"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
