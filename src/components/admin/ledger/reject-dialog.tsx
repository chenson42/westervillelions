"use client";

import { useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface RejectTransactionDialogProps {
  transactionId: string;
  amount: string;
  party: string;
  children: React.ReactNode;
}

/**
 * Opens a ConfirmDialog-style destructive dialog that collects a required rejection
 * reason, then POSTs to the reject route.
 *
 * Uses Radix AlertDialog (same as ConfirmDialog) for the destructive confirm pattern.
 */
export function RejectTransactionDialog({
  transactionId,
  amount,
  party,
  children,
}: RejectTransactionDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleReject() {
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error("A rejection reason is required.");
      return;
    }
    if (trimmed.length > 1000) {
      toast.error("Rejection reason must be 1000 characters or fewer.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/ledger/transactions/${transactionId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to reject disbursement.");
      }

      toast.success("Disbursement rejected.");
      setOpen(false);
      setReason("");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not reject disbursement. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        {children}
      </button>

      {/* Custom modal — AlertDialog doesn't support text input inside it cleanly, so use Dialog */}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
            <Dialog.Title className="text-lg font-semibold text-gray-900">
              Reject Disbursement
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-gray-500">
              {amount}{party ? ` — ${party}` : ""}. This action cannot be undone.
            </Dialog.Description>

            <div className="mt-4">
              <label
                htmlFor="reject-reason"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Reason for rejection <span className="text-gray-400 font-normal text-xs">(required)</span>
              </label>
              <textarea
                id="reject-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Explain why this disbursement is being rejected…"
                className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue resize-none"
                autoFocus
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Dialog.Close className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
                Cancel
              </Dialog.Close>
              <button
                type="button"
                onClick={handleReject}
                disabled={submitting || !reason.trim()}
                className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-700 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-600"
              >
                {submitting ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

// ------------------------------------------------------------------
// RejectReimbursementDialog — same pattern, hits the reimbursements PATCH endpoint
// ------------------------------------------------------------------

interface RejectReimbursementDialogProps {
  reimbursementId: string;
  memberName: string;
  amount: string;
  children: React.ReactNode;
}

export function RejectReimbursementDialog({
  reimbursementId,
  memberName,
  amount,
  children,
}: RejectReimbursementDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleReject() {
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error("A rejection reason is required.");
      return;
    }
    if (trimmed.length > 1000) {
      toast.error("Rejection reason must be 1000 characters or fewer.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/ledger/reimbursements/${reimbursementId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", reason: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to reject reimbursement.");
      }

      toast.success("Reimbursement rejected.");
      setOpen(false);
      setReason("");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not reject reimbursement. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        {children}
      </button>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
            <Dialog.Title className="text-lg font-semibold text-gray-900">
              Reject Reimbursement Request
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-gray-500">
              {memberName} — {amount}. The member will be notified of the rejection reason.
            </Dialog.Description>

            <div className="mt-4">
              <label
                htmlFor="reimb-reject-reason"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Reason for rejection <span className="text-gray-400 font-normal text-xs">(required)</span>
              </label>
              <textarea
                id="reimb-reject-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Explain why this reimbursement request is being rejected…"
                className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue resize-none"
                autoFocus
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Dialog.Close className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
                Cancel
              </Dialog.Close>
              <button
                type="button"
                onClick={handleReject}
                disabled={submitting || !reason.trim()}
                className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-700 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-600"
              >
                {submitting ? "Rejecting…" : "Reject Request"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
