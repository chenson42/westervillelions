"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import LedgerDialogShell from "./ledger-dialog-shell";
import CorrectionReasonField from "./correction-reason-field";
import SweepBatchSummary from "./sweep-batch-summary";
import { isDeleteSubmittable } from "./correction-dialog-logic";
import {
  SWEEP_BATCH_LOAD_ERROR,
  SWEEP_STATE_LABEL,
  SWEEP_VOID_REASON_HELP,
  detailBatchState,
  voidFailure,
  voidSuccessMessage,
  type SweepVoidFailure,
} from "./sweep-batch-dialog-logic";
import type { FundLabels } from "@/lib/ledger-fund-labels";
import {
  REASON_LIMITS,
  SWEEP_VOID_BLOCK_COPY,
  sweepBatchNextStep,
  type SweepBatchDetail,
  type SweepVoidResponse,
} from "@/lib/ledger-sweep";

const secondaryButton =
  "border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-60 inline-flex items-center justify-center";
const destructiveButton =
  "bg-red-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-red-700 transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center";

export type SweepBatchDialogPhase = "loading" | "error" | "loaded";

export interface SweepBatchDialogBodyProps {
  phase: SweepBatchDialogPhase;
  detail: SweepBatchDetail | null;
  labels: FundLabels;
  /** The viewer holds ledger.manage (void). */
  canManage: boolean;
  /** The reason form is showing. */
  voiding: boolean;
  reason: string;
  submitting: boolean;
  failure: SweepVoidFailure | null;
  onStartVoid: () => void;
  onReasonChange: (reason: string) => void;
  onConfirmVoid: () => void;
  onCancelVoid: () => void;
  onClose: () => void;
}

/** Presentational body, renderable without a Radix portal. */
export function SweepBatchDialogBody(props: SweepBatchDialogBodyProps) {
  const { phase, detail, labels, canManage } = props;

  if (phase === "loading") {
    return (
      <div role="status" aria-live="polite" className="space-y-3" data-testid="sweep-batch-loading">
        <span className="sr-only">Loading the batch&hellip;</span>
        <div className="h-5 w-2/3 animate-pulse rounded bg-gray-100" />
        <div className="h-4 w-full animate-pulse rounded bg-gray-100" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-gray-100" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-gray-100" />
      </div>
    );
  }

  if (phase === "error" || !detail) {
    return (
      <div className="space-y-4">
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {SWEEP_BATCH_LOAD_ERROR}
        </p>
        <div className="flex justify-end">
          <button type="button" onClick={props.onClose} className={secondaryButton}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const state = detailBatchState(detail);
  const canVoid = canManage && state === "posted";
  const clearedCopy = detail.reconciled && state !== "rejected" ? SWEEP_VOID_BLOCK_COPY.reconciled(labels) : null;
  const submittable = isDeleteSubmittable({ reason: props.reason });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gray-50 p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          {SWEEP_STATE_LABEL[state]}
        </p>
        <SweepBatchSummary data={detail} />
      </div>

      <p className="text-sm text-gray-700">{sweepBatchNextStep(state)}</p>

      {clearedCopy && (
        <p role="note" className="rounded-lg bg-amber-50 p-3 text-sm text-gray-800">
          {clearedCopy.message} {clearedCopy.nextStep}
        </p>
      )}

      {state === "pending" && (
        <p className="text-sm">
          <Link
            href={`/admin/ledger/approvals?txn=${encodeURIComponent(detail.legId)}`}
            className="font-semibold text-lions-blue hover:text-lions-blue-dark rounded focus:outline-none focus:ring-2 focus:ring-lions-blue"
          >
            Open this batch on Approvals
          </Link>
        </p>
      )}

      {canVoid && props.voiding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (submittable && !props.submitting) props.onConfirmVoid();
          }}
          className="space-y-4"
        >
          <div className="text-sm text-gray-700">
            <p className="font-semibold text-gray-900">This cannot be undone. Voiding removes:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                The transfer entry and all {detail.count} {detail.count === 1 ? "copy" : "copies"} on the
                Foundation&rsquo;s books.
              </li>
              <li>Any unsent receipt record for those copies.</li>
            </ul>
            <p className="mt-2 text-gray-600">
              The gifts become free to sweep again. A record of the void and your reason is kept for the board.
            </p>
          </div>
          <CorrectionReasonField
            id="void-sweep-reason"
            value={props.reason}
            onChange={props.onReasonChange}
            min={REASON_LIMITS.min}
            max={REASON_LIMITS.max}
            disabled={props.submitting}
            helpText={SWEEP_VOID_REASON_HELP}
          />
          {props.failure && (
            <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              <p>{props.failure.message}</p>
              {props.failure.nextStep ? <p className="mt-1 font-medium">{props.failure.nextStep}</p> : null}
            </div>
          )}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={props.onCancelVoid} disabled={props.submitting} className={secondaryButton}>
              Cancel
            </button>
            <button type="submit" disabled={!submittable || props.submitting} className={destructiveButton}>
              {props.submitting ? "Voiding…" : "Void batch"}
            </button>
          </div>
        </form>
      )}

      {/* A refusal that arrived after the form closed (a stale state) still reads. */}
      {!props.voiding && props.failure && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <p>{props.failure.message}</p>
          {props.failure.nextStep ? <p className="mt-1 font-medium">{props.failure.nextStep}</p> : null}
        </div>
      )}

      {!props.voiding && (
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={props.onClose} className={secondaryButton}>
            Close
          </button>
          {canVoid && (
            <button type="button" onClick={props.onStartVoid} className={destructiveButton}>
              Void this batch
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export interface SweepBatchDialogProps {
  /** The batch id: the id of the sweep's transfer entry. */
  legId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  labels: FundLabels;
}

/**
 * The one place a swept batch is read and voided (B-172 Increment 2b, B9). It
 * reads the PII-free detail on open, so any ledger reader may see the summary;
 * Void needs the Manage Ledger permission and a posted batch, and every refusal
 * shows the carrier's message and next step.
 */
export default function SweepBatchDialog({ legId, open, onOpenChange, canManage, labels }: SweepBatchDialogProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<SweepBatchDialogPhase>("loading");
  const [detail, setDetail] = useState<SweepBatchDetail | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<SweepVoidFailure | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase("loading");
    (async () => {
      try {
        const res = await fetch(`/api/admin/ledger/sweep-batches/${encodeURIComponent(legId)}`);
        if (!res.ok) throw new Error("load");
        const body = (await res.json()) as SweepBatchDetail;
        if (cancelled) return;
        setDetail(body);
        setPhase("loaded");
      } catch {
        if (cancelled) return;
        setDetail(null);
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, legId, reloadKey]);

  // A fresh form every time the dialog opens.
  useEffect(() => {
    if (open) {
      setVoiding(false);
      setReason("");
      setFailure(null);
    }
  }, [open]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && submitting) return;
      onOpenChange(next);
    },
    [onOpenChange, submitting],
  );

  async function handleVoid() {
    setSubmitting(true);
    setFailure(null);
    try {
      const res = await fetch(`/api/admin/ledger/sweep-batches/${encodeURIComponent(legId)}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const f = voidFailure(res.status, data, labels);
        setFailure(f);
        if (f.refresh) {
          setVoiding(false);
          setReloadKey((k) => k + 1);
          router.refresh();
        }
        return;
      }
      toast.success(voidSuccessMessage((data as SweepVoidResponse).copiesRemoved));
      router.refresh();
      onOpenChange(false);
    } catch {
      setFailure(voidFailure(null, null, labels));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <LedgerDialogShell
      open={open}
      onOpenChange={handleOpenChange}
      title="Sweep batch"
      description="The summary of an itemized sweep to the Foundation. A manager can void a posted batch with a reason."
    >
      <SweepBatchDialogBody
        phase={phase}
        detail={detail}
        labels={labels}
        canManage={canManage}
        voiding={voiding}
        reason={reason}
        submitting={submitting}
        failure={failure}
        onStartVoid={() => {
          setFailure(null);
          setVoiding(true);
        }}
        onReasonChange={setReason}
        onConfirmVoid={handleVoid}
        onCancelVoid={() => {
          setVoiding(false);
          setFailure(null);
        }}
        onClose={() => handleOpenChange(false)}
      />
    </LedgerDialogShell>
  );
}
