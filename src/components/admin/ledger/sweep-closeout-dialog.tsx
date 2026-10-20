"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import LedgerDialogShell from "./ledger-dialog-shell";
import CorrectionReasonField from "./correction-reason-field";
import { normalizeCorrectionReason } from "@/lib/ledger-correction";
import type { FundLabels } from "@/lib/ledger-fund-labels";
import {
  REASON_LIMITS,
  SWEEP_CLOSEOUT_SKIP_COPY,
  SWEEP_ERROR_COPY,
  type SweepCloseoutResponse,
  type SweepErrorBody,
} from "@/lib/ledger-sweep";

const secondaryButton =
  "border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-60 inline-flex items-center justify-center";
const primaryButton =
  "bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center";

export interface SweepCloseoutBodyProps {
  labels: FundLabels;
  count: number;
  reason: string;
  submitting: boolean;
  /** Server message shown inline; the dialog stays open. */
  error: string | null;
  /** Gifts the server skipped, with their codes; shown after a mark. */
  skipped: SweepCloseoutResponse["skipped"] | null;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function isCloseoutSubmittable(reason: string): boolean {
  return normalizeCorrectionReason(reason).ok;
}

/** Presentational body, renderable without a Radix portal. */
export function SweepCloseoutBody(props: SweepCloseoutBodyProps) {
  const submittable = isCloseoutSubmittable(props.reason);

  if (props.skipped && props.skipped.length > 0) {
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm text-gray-700">
          Some gifts were left as they were:
        </p>
        <ul className="space-y-2 text-sm text-gray-700">
          {props.skipped.map((s) => (
            <li key={s.sourceId} className="rounded-lg bg-gray-50 p-3">
              {SWEEP_CLOSEOUT_SKIP_COPY[s.code](props.labels)}
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <button type="button" onClick={props.onCancel} className={secondaryButton}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (submittable && !props.submitting) props.onConfirm();
      }}
      className="space-y-4"
    >
      <p className="text-sm text-gray-700">
        {props.count === 1 ? "This gift" : `These ${props.count} gifts`} will no longer be offered
        for a sweep. Use this for money that already reached the Foundation by another route. It
        moves no money and creates no entry, and you can unmark a gift later.
      </p>
      <CorrectionReasonField
        id="closeout-reason"
        value={props.reason}
        onChange={props.onReasonChange}
        min={REASON_LIMITS.min}
        max={REASON_LIMITS.max}
        disabled={props.submitting}
        label="Why is it already handled?"
        helpText="For example: covered by the October 1 transfer. Do not type a donor's name."
      />
      {props.error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {props.error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={props.onCancel} disabled={props.submitting} className={secondaryButton}>
          Cancel
        </button>
        <button type="submit" disabled={!submittable || props.submitting} className={primaryButton}>
          {props.submitting ? "Saving…" : "Mark as already handled"}
        </button>
      </div>
    </form>
  );
}

interface SweepCloseoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceIds: string[];
  labels: FundLabels;
  /** Called after a mark that changed something, so the page can clear its selection. */
  onMarked?: () => void;
}

export default function SweepCloseoutDialog({
  open,
  onOpenChange,
  sourceIds,
  labels,
  onMarked,
}: SweepCloseoutDialogProps) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<SweepCloseoutResponse["skipped"] | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next && submitting) return;
    if (!next) {
      setReason("");
      setError(null);
      setSkipped(null);
    }
    onOpenChange(next);
  }

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ledger/sweep-batches/closeouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark", sourceIds, reason }),
      });
      const data = (await res.json().catch(() => null)) as (SweepCloseoutResponse & Partial<SweepErrorBody>) | null;
      if (!res.ok || !data) {
        const code = data?.code;
        setError(
          (typeof data?.error === "string" && data.error) ||
            (code ? SWEEP_ERROR_COPY[code](labels) : "Could not update the list. Nothing was changed."),
        );
        return;
      }
      if (data.changed > 0) {
        toast.success(
          data.changed === 1 ? "Marked 1 gift as already handled." : `Marked ${data.changed} gifts as already handled.`,
        );
        onMarked?.();
        router.refresh();
      }
      if (data.skipped.length > 0) {
        setSkipped(data.skipped);
        return;
      }
      handleOpenChange(false);
    } catch {
      setError("Could not update the list. Nothing was changed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <LedgerDialogShell
      open={open}
      onOpenChange={handleOpenChange}
      title="Mark as already handled"
      description="Stop offering the selected gifts for a sweep to the Foundation."
    >
      <SweepCloseoutBody
        labels={labels}
        count={sourceIds.length}
        reason={reason}
        submitting={submitting}
        error={error}
        skipped={skipped}
        onReasonChange={setReason}
        onConfirm={() => void handleConfirm()}
        onCancel={() => handleOpenChange(false)}
      />
    </LedgerDialogShell>
  );
}
