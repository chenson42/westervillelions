"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface ReconcileToggleProps {
  transactionId: string;
  reconciled: boolean;
}

/**
 * Per-row reconcile toggle for posted transactions.
 *
 * Gating: only rendered when the viewer has LEDGER_RECORD (checked in parent).
 * Pending and rejected rows never receive this toggle.
 */
export default function ReconcileToggle({ transactionId, reconciled }: ReconcileToggleProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [localReconciled, setLocalReconciled] = useState(reconciled);

  async function handleToggle() {
    const newValue = !localReconciled;
    setPending(true);
    // Optimistic update
    setLocalReconciled(newValue);
    try {
      const res = await fetch(`/api/admin/ledger/transactions/${transactionId}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reconciled: newValue }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update reconcile status.");
      }

      router.refresh();
    } catch (err) {
      // Revert optimistic update on failure
      setLocalReconciled(!newValue);
      toast.error(
        err instanceof Error ? err.message : "Could not update reconcile status. Try again."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={pending}
      title={localReconciled ? "Mark unreconciled" : "Mark reconciled"}
      aria-label={localReconciled ? "Mark as unreconciled" : "Mark as reconciled"}
      className={`inline-flex items-center justify-center w-6 h-6 rounded border transition focus:outline-none focus:ring-2 focus:ring-lions-blue disabled:opacity-50 ${
        localReconciled
          ? "bg-green-100 border-green-400 text-green-700 hover:bg-green-50"
          : "bg-white border-gray-300 text-gray-300 hover:border-gray-400"
      }`}
    >
      {localReconciled ? (
        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <span className="w-3 h-3" aria-hidden="true" />
      )}
    </button>
  );
}

// ------------------------------------------------------------------
// ReconcileAllButton — posts reconcile=true for each unreconciled ID
// ------------------------------------------------------------------

interface ReconcileAllButtonProps {
  unreconciledIds: string[];
}

/**
 * "Reconcile all displayed" convenience button.
 * Fires one POST per unreconciled transaction in the displayed list.
 * Only rendered when canRecord is true and there are unreconciled rows.
 */
export function ReconcileAllButton({ unreconciledIds }: ReconcileAllButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (unreconciledIds.length === 0) return null;

  async function handleReconcileAll() {
    setBusy(true);
    let successCount = 0;
    let failCount = 0;

    for (const id of unreconciledIds) {
      try {
        const res = await fetch(`/api/admin/ledger/transactions/${id}/reconcile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reconciled: true }),
        });
        if (res.ok) {
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    }

    if (failCount === 0) {
      toast.success(`${successCount} transaction${successCount !== 1 ? "s" : ""} marked reconciled.`);
    } else {
      toast.error(`${successCount} succeeded, ${failCount} failed. Refresh and retry.`);
    }

    router.refresh();
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={handleReconcileAll}
      disabled={busy}
      className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
    >
      {busy
        ? "Reconciling…"
        : `Reconcile all displayed (${unreconciledIds.length})`}
    </button>
  );
}
