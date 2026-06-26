"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";

interface MarkSentDialogProps {
  txnId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called on success */
  onSuccess?: () => void;
}

/**
 * Mark-sent dialog for an acknowledgment.
 * PATCHes /api/admin/ledger/transactions/[id]/acknowledge with sentAt.
 * Optionally uploads a letter file (two-step: POST .../letter → key, then include key in PATCH).
 * Optionally accepts letter text as a paste-in alternative.
 * Gate: LEDGER_RECORD (caller must enforce).
 */
export default function MarkSentDialog({ txnId, open, onOpenChange, onSuccess }: MarkSentDialogProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const [sentAt, setSentAt] = useState(todayStr);
  const [letterText, setLetterText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadMode, setUploadMode] = useState<"none" | "file" | "text">("none");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function uploadLetter(ackId: string): Promise<string | null> {
    if (!file) return null;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`/api/admin/ledger/acknowledgments/${ackId}/letter`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.warning(`Letter upload failed — ${data.error ?? "unknown error"}. You can attach it later.`);
        return null;
      }
      const data = await res.json();
      return data.key as string;
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!sentAt) {
      toast.error("Enter the date the acknowledgment was sent.");
      return;
    }

    setSubmitting(true);
    try {
      // Step 1: create or get the ack (if it doesn't exist, POST first)
      // The PATCH endpoint handles mark-sent on the ack keyed by txnId.
      // First, try the PATCH (most common path — ack created earlier in the queue).
      // If that returns 404, we need to POST first then PATCH.

      // Build mark-sent body
      const body: Record<string, string | null | undefined> = {
        sentAt,
        letterText: uploadMode === "text" && letterText.trim() ? letterText.trim() : undefined,
      };

      // If file upload mode and file selected, upload will happen after we get the ack id.
      // We need to POST .../acknowledge first (to ensure ack exists) then upload + PATCH.
      // Strategy: PATCH first; if 404 → POST to create, then PATCH to mark-sent.

      let ackId: string | null = null;

      // Try mark-sent PATCH directly
      const patchRes = await fetch(`/api/admin/ledger/transactions/${txnId}/acknowledge`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentAt }), // minimal first pass to get ackId
      });

      if (patchRes.status === 404) {
        // Ack doesn't exist yet — create it first
        const postRes = await fetch(`/api/admin/ledger/transactions/${txnId}/acknowledge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!postRes.ok) {
          const d = await postRes.json().catch(() => ({}));
          throw new Error(d.error || "Failed to create acknowledgment record.");
        }
        const created = await postRes.json();
        ackId = created.id as string;
      } else if (!patchRes.ok) {
        if (patchRes.status === 409) {
          toast.warning("This acknowledgment has already been marked sent.");
          onOpenChange(false);
          return;
        }
        const d = await patchRes.json().catch(() => ({}));
        throw new Error(d.error || "Failed to mark acknowledgment as sent.");
      } else {
        const patchData = await patchRes.json();
        ackId = patchData.id as string;
      }

      // Step 2: upload letter file if provided (after we have ackId)
      let letterStorageKey: string | null = null;
      if (uploadMode === "file" && file && ackId) {
        letterStorageKey = await uploadLetter(ackId);
      }

      // Step 3: final PATCH with all fields (sentAt, letterText, letterStorageKey)
      if (letterStorageKey !== null || (uploadMode === "text" && letterText.trim()) || !patchRes.ok) {
        const finalBody: Record<string, string | undefined> = { sentAt };
        if (letterStorageKey) finalBody.letterStorageKey = letterStorageKey;
        if (uploadMode === "text" && letterText.trim()) finalBody.letterText = letterText.trim();

        const finalRes = await fetch(`/api/admin/ledger/transactions/${txnId}/acknowledge`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(finalBody),
        });
        if (!finalRes.ok && finalRes.status !== 409) {
          const d = await finalRes.json().catch(() => ({}));
          // Non-fatal: ack is already marked sent above; just warn about letter storage
          toast.warning(`Acknowledgment marked sent, but letter details failed to save: ${d.error ?? "unknown"}`);
        }
      }

      toast.success("Acknowledgment marked as sent.");
      onSuccess?.();
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not mark acknowledgment sent. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 focus:outline-none max-h-[90vh] overflow-y-auto">
          <Dialog.Title className="text-lg font-semibold text-gray-900 mb-1">
            Mark Acknowledgment Sent
          </Dialog.Title>
          <Dialog.Description className="text-sm text-gray-500 mb-4">
            Record that the acknowledgment letter was delivered to the donor. Optionally attach a
            copy of the letter for your records.
          </Dialog.Description>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Sent date */}
            <div>
              <label htmlFor="sent-at" className="block text-sm font-medium text-gray-700 mb-1">
                Date Sent
              </label>
              <input
                id="sent-at"
                type="date"
                value={sentAt}
                onChange={(e) => setSentAt(e.target.value)}
                required
                className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              />
            </div>

            {/* Letter attachment mode */}
            <div>
              <p className="block text-sm font-medium text-gray-700 mb-2">
                Letter Copy <span className="text-gray-400 font-normal">(optional)</span>
              </p>
              <div className="flex flex-wrap gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setUploadMode("none")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-lions-blue ${
                    uploadMode === "none"
                      ? "bg-lions-blue text-white"
                      : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  No attachment
                </button>
                <button
                  type="button"
                  onClick={() => setUploadMode("file")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-lions-blue ${
                    uploadMode === "file"
                      ? "bg-lions-blue text-white"
                      : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Upload file
                </button>
                <button
                  type="button"
                  onClick={() => setUploadMode("text")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-lions-blue ${
                    uploadMode === "text"
                      ? "bg-lions-blue text-white"
                      : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Paste text
                </button>
              </div>

              {uploadMode === "file" && (
                <div>
                  <label htmlFor="letter-file" className="sr-only">
                    Upload letter file
                  </label>
                  <input
                    id="letter-file"
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-lions-blue file:text-white hover:file:bg-lions-blue-dark cursor-pointer focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                  />
                  <p className="mt-1 text-xs text-gray-400">PDF, JPEG, or PNG — max 10 MB</p>
                </div>
              )}

              {uploadMode === "text" && (
                <div>
                  <label htmlFor="letter-text" className="sr-only">
                    Paste letter text
                  </label>
                  <textarea
                    id="letter-text"
                    value={letterText}
                    onChange={(e) => setLetterText(e.target.value)}
                    rows={6}
                    className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue resize-y"
                    placeholder="Paste the text of the acknowledgment letter here…"
                  />
                </div>
              )}
            </div>

            {uploading && (
              <p className="text-xs text-gray-500 animate-pulse">Uploading letter file…</p>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || uploading}
                className="bg-lions-blue text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                {submitting ? "Saving…" : "Mark Sent"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
