"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { TieOutResult } from "@/lib/reconciliation";

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

interface ReconciliationTieOutSummaryProps {
  sessionId: string;
  tieOut: TieOutResult;
  isOpen: boolean;
  canRecord: boolean;
}

/**
 * Running tie-out delta (opening + cleared vs. closing) and the Close
 * button. HARD gate, no override — Close is disabled client-side until
 * balanced && every in-period line is matched, and the server re-checks the
 * exact same condition (2026-07-21 user decision: no discrepancy-note
 * escape hatch). A raced close (e.g. a line unmatched in another tab after
 * this page loaded) surfaces the server's own error/delta, never a generic
 * failure.
 */
export default function ReconciliationTieOutSummary({
  sessionId,
  tieOut,
  isOpen,
  canRecord,
}: ReconciliationTieOutSummaryProps) {
  const router = useRouter();
  const [closing, setClosing] = useState(false);

  const canClose = tieOut.balanced && tieOut.unmatchedInPeriodCount === 0;

  async function handleClose() {
    setClosing(true);
    try {
      const res = await fetch(
        `/api/admin/ledger/reconciliation/sessions/${sessionId}/close`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (typeof data.deltaCents === "number") {
          toast.error(
            `Does not balance — off by ${formatDollars(Math.abs(data.deltaCents))}. Resolve the outstanding lines below before closing.`,
          );
        } else if (Array.isArray(data.unmatchedBankLineIds)) {
          toast.error(data.error ?? "Some bank lines are still unmatched.");
        } else {
          toast.error(data.error ?? "Failed to close session.");
        }
        router.refresh();
        return;
      }

      toast.success(
        `Session closed — ${data.clearedCount} transaction${data.clearedCount === 1 ? "" : "s"} reconciled.`,
      );
      router.refresh();
    } catch {
      toast.error("Could not close the session. Try again.");
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Tie-Out</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">Opening</p>
          <p className="text-lg font-semibold text-gray-900 tabular-nums">
            {formatDollars(tieOut.openingBalanceCents)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">Cleared activity</p>
          <p className="text-lg font-semibold text-gray-900 tabular-nums">
            {formatDollars(tieOut.matchedTotalCents)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">Statement closing</p>
          <p className="text-lg font-semibold text-gray-900 tabular-nums">
            {formatDollars(tieOut.closingBalanceCents)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">Delta</p>
          <p
            className={`text-lg font-semibold tabular-nums ${
              tieOut.balanced ? "text-green-700" : "text-amber-700"
            }`}
          >
            {formatDollars(tieOut.deltaCents)}
          </p>
        </div>
      </div>

      {tieOut.balanced ? (
        <p className="text-sm text-green-700 font-medium mb-4">
          Balanced
          {tieOut.unmatchedInPeriodCount > 0
            ? " — but bank lines are still unmatched below."
            : "."}
        </p>
      ) : (
        <p className="text-sm text-amber-700 font-medium mb-4">
          Does not balance yet — match or create the remaining activity below.
        </p>
      )}

      {isOpen && canRecord && (
        <button
          type="button"
          onClick={handleClose}
          disabled={!canClose || closing}
          title={canClose ? undefined : "Balance the session and match every in-period bank line before closing"}
          className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
        >
          {closing ? "Closing…" : "Close session"}
        </button>
      )}
    </div>
  );
}
