"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { ApprovalKind } from "@/lib/ledger-approval";
import LedgerDialogShell from "./ledger-dialog-shell";
import type { ApprovalDialogContextData } from "./approval-dialog-context";
import ApprovalDialogContext from "./approval-dialog-context";
import {
  approvalDialogTitle,
  approvalFailureAction,
  approvalSuccessMessage,
  describeBatchDecision,
  rejectPlaceholder,
} from "./approval-dialog-logic";

interface RejectTransactionDialogProps {
  transactionId: string;
  amount: string;
  party: string;
  /** Fund, memo and recorder, shown above the field. */
  context: ApprovalDialogContextData;
  /** Disbursement, transfer or sweep: used in toast copy. */
  noun?: ApprovalKind;
  /** An itemized sweep batch: the number of gifts this one decision covers (B-172 Inc 2b, B8). */
  batchCount?: number | null;
  /** Classes for the trigger button this component renders. */
  triggerClassName: string;
  /** The trigger button's label. */
  children: React.ReactNode;
}

/**
 * Renders its own trigger button and a dialog that collects a required
 * rejection reason, then POSTs to the reject route. A 409 (someone decided
 * first) or 404 closes the dialog, refreshes and says what happened; other
 * failures keep it open with the typed reason intact.
 */
export function RejectTransactionDialog({
  transactionId,
  amount,
  party,
  context,
  noun = "disbursement",
  batchCount = null,
  triggerClassName,
  children,
}: RejectTransactionDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus on open only with a fine pointer; on touch the keyboard would cover the context.
  useEffect(() => {
    if (!open) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) {
      textareaRef.current?.focus();
    }
  }, [open]);

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
        const data: unknown = await res.json().catch(() => null);
        const action = approvalFailureAction(res.status, data, "reject", noun);
        if (action.toastKind === "info") toast.info(action.message);
        else toast.error(action.message);
        if (action.close) {
          setOpen(false);
          setReason("");
        }
        if (action.refresh) router.refresh();
        return;
      }

      toast.success(approvalSuccessMessage("reject", noun));
      setOpen(false);
      setReason("");
      router.refresh();
    } catch {
      toast.error(approvalFailureAction(null, null, "reject", noun).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={triggerClassName}>
        {children}
      </button>

      <LedgerDialogShell
        open={open}
        onOpenChange={setOpen}
        title={approvalDialogTitle("reject", noun)}
        description={`${amount}${party ? `, ${party}` : ""}. Fund: ${context.fundText}.${
          context.memo ? ` Memo: ${context.memo}.` : ""
        } Recorded by ${context.recordedBy ?? "an unknown user"}. This action cannot be undone.`}
      >
        <p className="-mt-2 mb-3 break-words text-sm text-gray-600">
          <span className="font-semibold text-gray-900">{amount}</span>
          {party ? ` — ${party}` : ""}. This action cannot be undone.
        </p>
        <ApprovalDialogContext data={context} />
        {batchCount ? (
          <p role="note" className="mb-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-800">
            {describeBatchDecision("reject", batchCount)}
          </p>
        ) : null}

        <div>
          <label htmlFor="reject-reason" className="mb-1 block text-sm font-medium text-gray-700">
            Reason for rejection <span className="text-xs font-normal text-gray-500">(required)</span>
          </label>
          <textarea
            ref={textareaRef}
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder={rejectPlaceholder(noun)}
            className="block w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue sm:text-sm"
          />
        </div>

        <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-lions-blue"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleReject}
            disabled={submitting || !reason.trim()}
            className="min-h-[44px] rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 disabled:opacity-60"
          >
            {submitting ? "Rejecting…" : "Reject"}
          </button>
        </div>
      </LedgerDialogShell>
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
        const message = data.error || "Failed to reject reimbursement.";
        if (res.status === 409) {
          // Already processed by someone else — show why and reload the list.
          toast.error(message);
          setOpen(false);
          router.refresh();
          return;
        }
        throw new Error(message);
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
