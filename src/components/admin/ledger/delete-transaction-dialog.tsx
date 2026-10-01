"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import LedgerDialogShell from "./ledger-dialog-shell";
import CorrectionReasonField from "./correction-reason-field";
import { deleteFailureAction, isDeleteSubmittable } from "./correction-dialog-logic";
import {
  REASON_LIMITS,
  RECEIPT_SENT_MESSAGE,
  type CorrectionErrorBody,
  type DeleteResponse,
} from "@/lib/ledger-correction";

const secondaryButton =
  "border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-60 inline-flex items-center justify-center";
const destructiveButton =
  "bg-red-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-red-700 transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center";

export interface DeleteDialogBodyProps {
  isTransfer: boolean;
  /** Foundation income rows only; null elsewhere. */
  ackStatus: "pending" | "sent" | null;
  /** One-line description of what is being deleted (date, party, amount). */
  summary: string;
  reason: string;
  submitting: boolean;
  /** Server message shown inline; the dialog stays open. */
  error: string | null;
  /** True once the server (or the page's data) says a receipt was sent. */
  receiptSent: boolean;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Presentational body, renderable without a Radix portal. */
export function DeleteDialogBody(props: DeleteDialogBodyProps) {
  const blocked = props.receiptSent || props.ackStatus === "sent";
  const submittable = isDeleteSubmittable({ reason: props.reason });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!blocked && submittable && !props.submitting) props.onConfirm();
      }}
      className="space-y-4"
    >
      <div className="rounded-2xl bg-gray-50 p-3 text-sm">
        <p className="text-gray-500">
          {props.isTransfer ? "This will delete both entries of the transfer:" : "This will delete:"}
        </p>
        <p className="mt-0.5 font-medium text-gray-900 break-words">{props.summary}</p>
      </div>

      {blocked ? (
        <p role="alert" className="rounded-lg bg-amber-50 border border-lions-gold p-3 text-sm text-gray-800">
          {RECEIPT_SENT_MESSAGE}
        </p>
      ) : (
        <>
          <div className="text-sm text-gray-700">
            <p className="font-semibold text-gray-900">This cannot be undone. Also removed with it:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Any match to a bank line in an open reconciliation session.</li>
              {props.ackStatus === "pending" && (
                <li>The unsent acknowledgment letter record for this gift.</li>
              )}
            </ul>
            <p className="mt-2 text-gray-600">
              A record of the deleted entry and your reason is kept for the board to read.
            </p>
          </div>
          <CorrectionReasonField
            id="delete-reason"
            value={props.reason}
            onChange={props.onReasonChange}
            min={REASON_LIMITS.min}
            max={REASON_LIMITS.max}
            disabled={props.submitting}
            helpText="For example: entered twice by mistake; the second copy is being removed."
          />
        </>
      )}

      {props.error && !blocked && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {props.error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={props.onCancel}
          disabled={props.submitting}
          className={secondaryButton}
        >
          {blocked ? "Close" : "Cancel"}
        </button>
        {!blocked && (
          <button
            type="submit"
            disabled={!submittable || props.submitting}
            className={destructiveButton}
          >
            {props.submitting ? "Deleting…" : props.isTransfer ? "Delete transfer" : "Delete"}
          </button>
        )}
      </div>
    </form>
  );
}

interface DeleteTransactionDialogProps {
  transactionId: string;
  isTransfer: boolean;
  ackStatus: "pending" | "sent" | null;
  summary: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function DeleteTransactionDialog({
  transactionId,
  isTransfer,
  ackStatus,
  summary,
  open,
  onOpenChange,
}: DeleteTransactionDialogProps) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptSent, setReceiptSent] = useState(false);

  // Fresh form every time the dialog opens.
  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
      setReceiptSent(false);
    }
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (!next && submitting) return;
    onOpenChange(next);
  }

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/ledger/transactions/${transactionId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const failure = deleteFailureAction(res.status, data as Partial<CorrectionErrorBody> | null);
        setReceiptSent(failure.receiptSent);
        setError(failure.message);
        return;
      }
      const result = data as DeleteResponse;
      toast.success(
        result.deleted === 2
          ? "Transfer removed (both entries deleted)."
          : result.acknowledgmentRemoved
            ? "Transaction deleted along with its unsent acknowledgment."
            : "Transaction deleted.",
      );
      router.refresh();
      onOpenChange(false);
    } catch {
      setError("Could not delete this transaction. Nothing was changed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <LedgerDialogShell
      open={open}
      onOpenChange={handleOpenChange}
      title={isTransfer ? "Delete transfer?" : "Delete transaction?"}
      description="Permanently delete this ledger entry. A reason is required and is logged."
    >
      <DeleteDialogBody
        isTransfer={isTransfer}
        ackStatus={ackStatus}
        summary={summary}
        reason={reason}
        submitting={submitting}
        error={error}
        receiptSent={receiptSent}
        onReasonChange={setReason}
        onConfirm={handleConfirm}
        onCancel={() => handleOpenChange(false)}
      />
    </LedgerDialogShell>
  );
}
