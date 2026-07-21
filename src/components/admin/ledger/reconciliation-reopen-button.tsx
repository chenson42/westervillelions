"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface ReconciliationReopenButtonProps {
  sessionId: string;
  periodLabel: string;
}

/**
 * Reopen a closed session. Only ever rendered when the viewer has
 * LEDGER_MANAGE (checked in the parent page) — reopening a settled audit
 * record is gated more strictly than routine recording, per the Phase 3
 * design. The route itself re-checks the gate and the reopen-ordering rule
 * (can't reopen while a later-period session on this account is already
 * closed) — a raced or blocked reopen surfaces the server's own message.
 */
export default function ReconciliationReopenButton({
  sessionId,
  periodLabel,
}: ReconciliationReopenButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleReopen() {
    setPending(true);
    try {
      const res = await fetch(
        `/api/admin/ledger/reconciliation/sessions/${sessionId}/reopen`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to reopen the session.");
      }
      toast.success(
        `Session reopened — ${data.revertedTxnCount} transaction${data.revertedTxnCount === 1 ? "" : "s"} unreconciled.`,
      );
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not reopen the session. Try again."
      );
    } finally {
      setPending(false);
      setOpen(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
      >
        Reopen session
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Reopen this session?"
        description={`This un-reconciles every transaction cleared by the ${periodLabel} session and returns it to open. Existing matches are kept, so you can fix and re-close without re-picking everything.`}
        confirmLabel="Reopen"
        destructive
        onConfirm={handleReopen}
      />
    </>
  );
}
