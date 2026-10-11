"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import LedgerDialogShell from "./ledger-dialog-shell";
import ApprovalDialogContext from "./approval-dialog-context";
import {
  COSIGN_RETRY_MESSAGE,
  COSIGN_SUCCESS_MESSAGE,
  cosignFailureAction,
  cosignRequest,
  type CosignDialogProps,
} from "./approval-dialog-logic";

/** Shared trigger styling: a secondary 44px button (Approve stays the primary action). */
export const COSIGN_TRIGGER_CLASS =
  "inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border-2 border-lions-blue px-5 py-2 text-sm font-semibold text-lions-blue transition hover:bg-lions-blue/5 focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 sm:w-auto";

/**
 * "Add your approval" on an entry that is already approved and posted. Renders
 * its own trigger and a Radix dialog (never a native confirm). The request has
 * no body; the server uses the session user. Typed refusals close, refresh and
 * explain through `cosignFailureAction`; any other failure keeps the dialog open.
 * An informational endorsement only: it does not change the books.
 */
export default function CosignDialog({
  transactionId,
  amountText,
  party,
  noun,
  fundText,
  memo,
  recorderName,
  boardMinute,
  triggerClassName = COSIGN_TRIGGER_CLASS,
  children = "Add your approval",
}: CosignDialogProps & { triggerClassName?: string; children?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleCosign() {
    setSubmitting(true);
    try {
      const { url, init } = cosignRequest(transactionId);
      const res = await fetch(url, init);
      if (res.ok) {
        toast.success(COSIGN_SUCCESS_MESSAGE);
        setOpen(false);
        router.refresh();
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      const action = cosignFailureAction(res.status, data, noun);
      if (action.toastKind === "info") toast.info(action.message);
      else toast.error(action.message);
      if (action.close) setOpen(false);
      if (action.refresh) router.refresh();
    } catch {
      toast.error(COSIGN_RETRY_MESSAGE);
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
        title="Add your approval"
        description={`${amountText}${party ? `, ${party}` : ""}. Fund: ${fundText}.${
          memo ? ` Memo: ${memo}.` : ""
        } Recorded by ${recorderName ?? "an unknown user"}.`}
      >
        <p className="-mt-2 mb-3 break-words text-sm text-gray-600">
          <span className="font-semibold text-gray-900">{amountText}</span>
          {party ? ` — ${party}` : ""}
        </p>
        <ApprovalDialogContext
          data={{
            kind: noun === "disbursement" ? "plain" : noun,
            fundText,
            memo,
            recordedBy: recorderName,
          }}
        />
        <div className="mb-4 rounded-lg bg-gray-50 p-3 text-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Board minute on file
          </p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-gray-800">{boardMinute}</p>
        </div>
        <p className="text-sm text-gray-600">
          Your name will be added to this entry. This does not change the books.
        </p>
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
            onClick={handleCosign}
            disabled={submitting}
            className="min-h-[44px] rounded-lg bg-lions-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-60"
          >
            {submitting ? "Adding…" : "Add my approval"}
          </button>
        </div>
      </LedgerDialogShell>
    </>
  );
}
