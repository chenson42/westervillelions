"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import GiftPurposeField from "./gift-purpose-field";

interface GiftPurposeDialogProps {
  txnId: string;
  /** Current stored purpose, or null when none was typed. */
  currentPurpose: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

/**
 * Edits the gift purpose on an acknowledgment that has NOT been sent.
 * PATCHes /api/admin/ledger/transactions/[id]/acknowledge with
 * `{ mode: 'purpose' }`.
 * Gate: LEDGER_RECORD (caller must enforce).
 *
 * Only ever offered for unsent acknowledgments — the pending queue is the only
 * place it is mounted, and every row there is unsent by that query's own WHERE
 * clause. The server refuses a sent row with 409 regardless (that guard, not
 * this component, is what protects the record); the 409 is surfaced here as
 * plain language rather than an error, because it is a legitimate outcome of a
 * race with a colleague marking the letter sent, not a malfunction.
 */
export default function GiftPurposeDialog({
  txnId,
  currentPurpose,
  open,
  onOpenChange,
  onSuccess,
}: GiftPurposeDialogProps) {
  const router = useRouter();
  const [purpose, setPurpose] = useState(currentPurpose ?? "");
  const [submitting, setSubmitting] = useState(false);

  // Re-seed when reopened for a different row (the parent mounts one dialog
  // and swaps which row it points at).
  useEffect(() => {
    if (open) setPurpose(currentPurpose ?? "");
  }, [open, currentPurpose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/ledger/transactions/${txnId}/acknowledge`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Always sent, even when blank: clearing a purpose is a real edit, and
        // omitting the key would normalize to the same NULL but read as "no
        // opinion". `mode` is what keeps this off the mark-sent path.
        body: JSON.stringify({ mode: "purpose", purpose: purpose.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          toast.warning(
            data.error ||
              "This acknowledgment has already been sent — its gift purpose can no longer be changed.",
          );
          onOpenChange(false);
          router.refresh();
          return;
        }
        throw new Error(data.error || "Failed to save the gift purpose.");
      }

      const data = await res.json().catch(() => ({}));
      toast.success(
        data.letterTextCleared
          ? "Gift purpose saved. The previously generated letter was discarded — generate it again to pick up the new wording."
          : purpose.trim()
            ? "Gift purpose saved."
            : "Gift purpose cleared.",
      );
      onSuccess?.();
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the gift purpose. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 focus:outline-none">
          <Dialog.Title className="text-lg font-semibold text-gray-900 mb-1">
            Gift Purpose
          </Dialog.Title>
          <Dialog.Description className="text-sm text-gray-500 mb-4">
            Name what this gift supported, in words the donor would recognize. This can be changed
            until the acknowledgment is marked sent.
          </Dialog.Description>

          <form onSubmit={handleSubmit} className="space-y-4">
            <GiftPurposeField
              id="edit-ack-purpose"
              value={purpose}
              onChange={setPurpose}
              disabled={submitting}
            />

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="bg-lions-blue text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                {submitting ? "Saving…" : "Save Purpose"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
