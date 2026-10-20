"use client";

import { useState } from "react";
import SweepBatchDialog from "./sweep-batch-dialog";
import type { FundLabels } from "@/lib/ledger-fund-labels";

const base =
  "text-xs font-medium transition focus:outline-none focus:ring-2 rounded px-2 py-1 min-h-[44px] sm:min-h-0 inline-flex items-center text-lions-blue hover:text-lions-blue-dark focus:ring-lions-blue";

/**
 * "Batch": opens the batch dialog for the sweep a register row belongs to
 * (B-172 Increment 2b, B9/B11). `legId` is the badge's `legId` (a leg's own id).
 */
export default function SweepBatchButton({
  legId,
  canManage,
  labels,
}: {
  legId: string;
  canManage: boolean;
  labels: FundLabels;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={base}>
        Batch
      </button>
      <SweepBatchDialog legId={legId} open={open} onOpenChange={setOpen} canManage={canManage} labels={labels} />
    </>
  );
}
