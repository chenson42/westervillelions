"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import DonorSearchPanel from "./donor-search-panel";

interface LinkDonorDialogProps {
  txnId: string;
  txnAmountCents: number;
  txnDate: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently linked donor id, if any */
  currentDonorId?: string | null;
}

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/**
 * Dialog to link a Foundation income transaction to a donor.
 * PATCHes /api/admin/ledger/donors/[donorId] indirectly — uses
 * PATCH /api/admin/ledger/transactions/[id] to set donorId.
 *
 * Provides:
 *   - Search existing donors
 *   - Create new donor inline
 *   - Remove donor link
 *
 * Gate: LEDGER_RECORD (caller must enforce).
 */
export default function LinkDonorDialog({
  txnId,
  txnAmountCents,
  txnDate,
  open,
  onOpenChange,
  currentDonorId,
}: LinkDonorDialogProps) {
  const router = useRouter();
  const [linking, setLinking] = useState(false);

  async function linkDonor(donorId: string) {
    setLinking(true);
    try {
      // PATCH the transaction to set donorId
      const res = await fetch(`/api/admin/ledger/transactions/${txnId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ donorId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to link donor.");
      }
      toast.success("Donor linked to this transaction.");
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not link donor. Try again.");
    } finally {
      setLinking(false);
    }
  }

  async function unlinkDonor() {
    setLinking(true);
    try {
      const res = await fetch(`/api/admin/ledger/transactions/${txnId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ donorId: null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove donor link.");
      }
      toast.success("Donor link removed.");
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove donor link. Try again.");
    } finally {
      setLinking(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 focus:outline-none max-h-[90vh] overflow-y-auto">
          <Dialog.Title className="text-lg font-semibold text-gray-900 mb-1">
            Link Donor
          </Dialog.Title>
          <Dialog.Description className="text-sm text-gray-500 mb-1">
            Link this {txnDate} donation of{" "}
            <span className="font-semibold text-green-700">{formatDollars(txnAmountCents)}</span>{" "}
            to a donor record for acknowledgment tracking.
          </Dialog.Description>

          {/* Remove link option */}
          {currentDonorId && (
            <div className="mb-4 mt-2 rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-center justify-between gap-3">
              <p className="text-xs text-amber-800">A donor is currently linked to this transaction.</p>
              <button
                type="button"
                onClick={unlinkDonor}
                disabled={linking}
                className="text-xs font-medium text-amber-700 hover:text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-400 rounded transition disabled:opacity-60 whitespace-nowrap"
              >
                Remove link
              </button>
            </div>
          )}

          <DonorSearchPanel
            active={open}
            currentDonorId={currentDonorId}
            busy={linking}
            onSelect={(donor) => void linkDonor(donor.id)}
            onCancel={() => onOpenChange(false)}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
