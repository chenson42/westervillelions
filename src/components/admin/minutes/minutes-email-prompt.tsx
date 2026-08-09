"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { resolveMinutesEmailTarget, minutesKindLabel } from "@/lib/minutes";

interface MinutesEmailPromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  minutesId: string;
  kind: string;
  status: string; // 'draft' | 'approved'
}

/**
 * Post-save "email these minutes" prompt (Phase 3 "Email — full contract").
 * Appears after every successful save (create or edit), and is also
 * reachable on demand from MinutesStatusActions's "Email these minutes…"
 * button. Resolution of whether sending is even offered — and to whom —
 * mirrors the server's own `resolveMinutesEmailTarget()` exactly (same
 * function, imported from the same pure module) so the UI never shows an
 * option the API would reject; the server re-checks independently and is
 * the actual authority (DECISION-075).
 *
 * The send result is surfaced immediately — sendEmail()'s own
 * {success, error?} passed straight through by the route — never a
 * generic "saved" toast that could imply the email went out regardless
 * (DECISION-075 §6).
 */
export function MinutesEmailPrompt({ open, onOpenChange, minutesId, kind, status }: MinutesEmailPromptProps) {
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<{ success: boolean; error?: string } | null>(null);

  const resolution = resolveMinutesEmailTarget(kind, status);

  async function handleSend() {
    setSending(true);
    setLastResult(null);
    try {
      const res = await fetch(`/api/admin/minutes/${minutesId}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Could not send this email.");
        return;
      }
      // data is sendEmail()'s own { success, error? } — the actual send may
      // still have failed even though the API call itself succeeded.
      setLastResult(data);
      if (data.success) {
        toast.success(
          resolution.allowed ? `Emailed to ${resolution.address}.` : "Email sent.",
        );
      } else {
        toast.error(data.error || "The email could not be sent.");
      }
    } catch {
      toast.error("Could not reach the server. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setNote("");
          setLastResult(null);
        }
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <Dialog.Title className="text-lg font-semibold text-gray-900">
            Email these {minutesKindLabel(kind)} minutes?
          </Dialog.Title>

          {resolution.allowed ? (
            <>
              <Dialog.Description className="mt-2 text-sm text-gray-600">
                Sends to <span className="font-medium">{resolution.address}</span> as an inline HTML
                email.
                {resolution.showDraftBanner && (
                  <span className="block mt-1 text-amber-700">
                    These minutes are still a draft — the email will carry a "DRAFT — subject to
                    approval" banner.
                  </span>
                )}
              </Dialog.Description>

              <div className="mt-4">
                <label htmlFor="minutes-email-note" className="block text-sm font-medium text-gray-700 mb-1">
                  Add a note for the recipients (optional)
                </label>
                <textarea
                  id="minutes-email-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="e.g. Please review before Thursday's meeting."
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                />
              </div>

              {lastResult && (
                <p
                  className={`mt-3 text-sm ${lastResult.success ? "text-green-700" : "text-red-600"}`}
                  role="status"
                >
                  {lastResult.success
                    ? `Emailed to ${resolution.address}.`
                    : lastResult.error || "The email could not be sent."}
                </p>
              )}

              <div className="mt-6 flex justify-end gap-3">
                <Dialog.Close className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition min-h-[44px]">
                  Close
                </Dialog.Close>
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={sending}
                  className="bg-lions-blue text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
                >
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </>
          ) : (
            <>
              <Dialog.Description className="mt-2 text-sm text-gray-600">
                {resolution.reason}
              </Dialog.Description>
              <div className="mt-6 flex justify-end">
                <Dialog.Close className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition min-h-[44px]">
                  Close
                </Dialog.Close>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
