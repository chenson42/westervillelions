"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface RowRetryButtonProps {
  id: string;
  to: string;
  subject: string;
}

/**
 * Per-message retry (Follow-Up #2, docs/work-log/2026-09-25-email-silent-success.md).
 *
 * An explicit admin click on ONE row IS the retry decision, so this always
 * calls the API with `{ ids: [id] }`, which bypasses the nextRetryAt
 * cooldown that gates the bulk "Retry Failed Emails" button above the
 * table. This is genuinely irreversible outbound mail to a real person, so
 * it goes through a confirm step naming the exact recipient and subject
 * rather than firing on a single click.
 */
export default function RowRetryButton({ id, to, subject }: RowRetryButtonProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const [retried, setRetried] = useState(false);

  async function handleConfirm() {
    if (inFlight) return; // guard against a double-fire from a fast double-click
    setInFlight(true);
    try {
      const res = await fetch("/api/admin/email-queue/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Retry failed");
        return;
      }

      const result = Array.isArray(data.results)
        ? data.results.find((r: { id: string }) => r.id === id)
        : undefined;

      if (result?.success) {
        toast.success(`Retried — sent to ${to}`);
        setRetried(true);
        // The row is now `sent`, so it no longer belongs in the Failed
        // Emails table. Re-render the Server Component so it moves out
        // without the admin having to reload the page; `retried` covers
        // the brief window before that refresh lands.
        router.refresh();
      } else {
        toast.error(result?.error ?? "Retry failed — no result returned");
      }
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setInFlight(false);
    }
  }

  if (retried) {
    return <span className="text-sm text-green-700 font-medium">Sent</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={inFlight}
        className="rounded-lg border border-lions-blue px-3 py-1.5 text-sm font-medium text-lions-blue hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {inFlight ? "Retrying..." : "Retry"}
      </button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Retry this email?"
        description={`This will resend the message now, immediately, to ${to} (subject: "${subject}"). This bypasses the normal retry cooldown — only do this because you've reviewed the error and believe the underlying issue is fixed.`}
        confirmLabel="Send now"
        onConfirm={handleConfirm}
      />
    </>
  );
}
