"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { ApprovalKind } from "@/lib/ledger-approval";
import LedgerDialogShell from "./ledger-dialog-shell";
import ApprovalDialogContext, { type ApprovalDialogContextData } from "./approval-dialog-context";
import {
  approvalDialogTitle,
  approvalFailureAction,
  approvalSuccessMessage,
  approvalEntryHref,
  approveHint,
  describeBatchDecision,
  minuteHelper,
  minuteRequiredMessage,
} from "./approval-dialog-logic";

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
  /** Fund, memo and recorder, shown above the field so the card need not stay visible. */
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
 * Renders its own trigger button and a dialog that collects a board-minute
 * reference, then POSTs to the approve route. A board-minute is required when
 * the row doesn't already carry one; when it does (e.g. a Sweep cited at
 * creation), the field is pre-filled and a blank submit preserves the original.
 *
 * A 409 (someone decided first) or 404 (entry gone) closes the dialog,
 * refreshes the page and says what happened; any other failure keeps the dialog
 * open with the typed text intact.
 */
export default function ApproveDialog({
  transactionId,
  amount,
  party,
  existingBoardMinute,
  context,
  noun = "disbursement",
  batchCount = null,
  triggerClassName,
  children,
}: ApproveDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [boardMinute, setBoardMinute] = useState(existingBoardMinute ?? "");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the field on open only with a fine pointer. On touch the keyboard
  // would cover the context above it; the person taps the field when ready.
  useEffect(() => {
    if (!open) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) {
      inputRef.current?.focus();
    }
  }, [open]);

  const hint = approveHint(boardMinute, existingBoardMinute);

  async function handleApprove() {
    const trimmed = boardMinute.trim();
    if (!trimmed && !existingBoardMinute) {
      toast.error(minuteRequiredMessage(noun));
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
        const data: unknown = await res.json().catch(() => null);
        const action = approvalFailureAction(res.status, data, "approve", noun);
        if (action.toastKind === "info") toast.info(action.message);
        else toast.error(action.message);
        if (action.close) {
          setOpen(false);
          setBoardMinute(existingBoardMinute ?? "");
        }
        // Lost to a colleague's approval: land on the entry, where the banner
        // offers Add your approval. Otherwise just refresh the list.
        if (action.showEntry) router.replace(approvalEntryHref(transactionId));
        else if (action.refresh) router.refresh();
        return;
      }

      toast.success(approvalSuccessMessage("approve", noun));
      setOpen(false);
      setBoardMinute(existingBoardMinute ?? "");
      router.refresh();
    } catch {
      toast.error(approvalFailureAction(null, null, "approve", noun).message);
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = submitting || !!hint;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={triggerClassName}>
        {children}
      </button>
      <LedgerDialogShell
        open={open}
        onOpenChange={setOpen}
        title={approvalDialogTitle("approve", noun)}
        description={`${amount}${party ? `, ${party}` : ""}. Fund: ${context.fundText}.${
          context.memo ? ` Memo: ${context.memo}.` : ""
        } Recorded by ${context.recordedBy ?? "an unknown user"}.`}
      >
        <p className="-mt-2 mb-3 break-words text-sm text-gray-600">
          <span className="font-semibold text-gray-900">{amount}</span>
          {party ? ` — ${party}` : ""}
        </p>
        <ApprovalDialogContext data={context} />
        {batchCount ? (
          <p role="note" className="mb-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-800">
            {describeBatchDecision("approve", batchCount)}
          </p>
        ) : null}

        <div>
          <label
            htmlFor="approve-board-minute"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Board-minute reference{" "}
            <span className="text-xs font-normal text-gray-500">
              {existingBoardMinute ? "(pre-filled from the original motion)" : "(required)"}
            </span>
          </label>
          <input
            ref={inputRef}
            id="approve-board-minute"
            type="text"
            value={boardMinute}
            onChange={(e) => setBoardMinute(e.target.value)}
            maxLength={500}
            placeholder="e.g., Motion passed May 2026 meeting, minute §4"
            className="block min-h-[44px] w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue sm:text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            {existingBoardMinute
              ? "This item already cites a board motion (shown above). Leave it as-is to keep the original citation, or edit only to amend it."
              : minuteHelper(noun)}
          </p>
        </div>

        {hint && (
          <p id="approve-hint" role="status" className="mt-4 text-xs text-gray-600">
            {hint}
          </p>
        )}

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
            onClick={handleApprove}
            disabled={disabled}
            aria-describedby={hint ? "approve-hint" : undefined}
            className="min-h-[44px] rounded-lg bg-lions-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-60"
          >
            {submitting ? "Approving…" : "Approve"}
          </button>
        </div>
      </LedgerDialogShell>
    </>
  );
}
