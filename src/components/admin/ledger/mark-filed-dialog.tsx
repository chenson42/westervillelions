"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { FilingRow } from "@/lib/ledger-queries";

interface MarkFiledDialogProps {
  filing: FilingRow;
  children: React.ReactNode;
}

/**
 * Dialog for marking a filing as In Progress or Filed.
 *
 * Two submit paths:
 *   1. "Save as In Progress" — no date required, status → in_progress
 *   2. "Mark as Filed"       — filedOn required (defaults today), status → filed
 *
 * Uses Radix Dialog (not ConfirmDialog) because this is data-entry, not a
 * destructive irreversible action.
 */
export default function MarkFiledDialog({ filing, children }: MarkFiledDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filedOn, setFiledOn] = useState(todayIso());
  const [confirmation, setConfirmation] = useState(filing.confirmation ?? "");
  const [note, setNote] = useState(filing.note ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function handleOpen(val: boolean) {
    if (val) {
      // Reset form to filing's current values on open
      setFiledOn(filing.filedOn ?? todayIso());
      setConfirmation(filing.confirmation ?? "");
      setNote(filing.note ?? "");
      setFieldError(null);
    }
    setOpen(val);
  }

  async function submit(status: "in_progress" | "filed") {
    setFieldError(null);

    if (status === "filed" && !filedOn) {
      setFieldError("Filed date is required.");
      return;
    }

    // Warn (not block) if filed date is in the future
    if (status === "filed" && filedOn) {
      const d = new Date(filedOn + "T00:00:00");
      if (d > new Date()) {
        // Future date — we proceed, just no blocking
      }
    }

    setSubmitting(true);

    try {
      const body: Record<string, unknown> = { status };
      if (status === "filed" && filedOn) body.filedOn = filedOn;
      if (confirmation) body.confirmation = confirmation;
      if (note) body.note = note;

      const res = await fetch(`/api/admin/ledger/filings/${filing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to update filing.");
      }

      const label = status === "filed" ? "Filing marked as filed." : "Filing saved as in progress.";
      toast.success(label);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update filing.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpen}>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <Dialog.Title className="text-lg font-semibold text-gray-900">
            {filing.title}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-500">
            {filing.agency} &bull; Update filing status
          </Dialog.Description>

          <div className="mt-5 space-y-4">
            {/* Filed On */}
            <div>
              <label
                htmlFor="filed-on"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Filed date{" "}
                <span className="text-gray-400 font-normal">(required when marking filed)</span>
              </label>
              <input
                id="filed-on"
                type="date"
                value={filedOn}
                onChange={(e) => {
                  setFiledOn(e.target.value);
                  setFieldError(null);
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue"
              />
              {fieldError && (
                <p className="mt-1 text-xs text-red-600">{fieldError}</p>
              )}
              {filedOn && new Date(filedOn + "T00:00:00") > new Date() && (
                <p className="mt-1 text-xs text-yellow-700">
                  Filed date is in the future — confirm if this is correct.
                </p>
              )}
            </div>

            {/* Confirmation Number */}
            <div>
              <label
                htmlFor="confirmation"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Confirmation / acknowledgment number{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="confirmation"
                type="text"
                maxLength={100}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder="e.g. 1234567890"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue"
              />
            </div>

            {/* Note */}
            <div>
              <label
                htmlFor="filing-note"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Note{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                id="filing-note"
                maxLength={1000}
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue resize-none"
              />
            </div>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row justify-end gap-3">
            <Dialog.Close asChild>
              <button
                type="button"
                className="border border-gray-300 px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              disabled={submitting}
              onClick={() => submit("in_progress")}
              className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
            >
              {submitting ? "Saving…" : "Save as In Progress"}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => submit("filed")}
              className="bg-lions-blue text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
            >
              {submitting ? "Saving…" : "Mark as Filed"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
