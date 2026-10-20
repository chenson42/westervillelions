"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { FundLabels } from "@/lib/ledger-fund-labels";
import {
  SWEEP_CLOSEOUT_SKIP_COPY,
  type SweepCloseoutResponse,
} from "@/lib/ledger-sweep";

/** The body text of the Unmark confirmation (exported for tests). */
export const UNMARK_DESCRIPTION =
  "This gift will be offered for a sweep to the Foundation again. Nothing else changes.";

interface SweepUnmarkConfirmProps {
  sourceId: string;
  /** One-line description of the gift (date, party, amount) for the button's accessible name. */
  summary: string;
  labels: FundLabels;
}

/** A row-level "Unmark" button with its confirmation. */
export default function SweepUnmarkConfirm({ sourceId, summary, labels }: SweepUnmarkConfirmProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function unmark() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/ledger/sweep-batches/closeouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unmark", sourceIds: [sourceId] }),
      });
      const data = (await res.json().catch(() => null)) as SweepCloseoutResponse | null;
      if (!res.ok || !data) {
        toast.error("Could not unmark this gift. Nothing was changed.");
        return;
      }
      const skip = data.skipped[0];
      if (skip) toast.error(SWEEP_CLOSEOUT_SKIP_COPY[skip.code](labels));
      else toast.success("Unmarked. The gift can be swept again.");
      router.refresh();
    } catch {
      toast.error("Could not unmark this gift. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        aria-label={`Unmark ${summary}`}
        className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark min-h-[44px] px-3 rounded focus:outline-none focus:ring-2 focus:ring-lions-blue disabled:opacity-60"
      >
        Unmark
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Unmark this gift?"
        description={UNMARK_DESCRIPTION}
        confirmLabel="Unmark"
        onConfirm={() => void unmark()}
      />
    </>
  );
}
