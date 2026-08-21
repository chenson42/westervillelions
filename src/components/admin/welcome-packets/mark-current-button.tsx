"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface MarkCurrentButtonProps {
  packetId: string;
  lionsYear: string;
  isCurrent: boolean;
}

/**
 * The one client island for "publish" — flips the welcome_packet_current
 * singleton pointer to this packet. `<ConfirmDialog>`, never
 * `window.confirm()` (CLAUDE.md invariant).
 *
 * docs/work-log/2026-08-21-welcome-packet-live-page.md, Phase 3 (Revised)
 * "MarkCurrentButton — the one <ConfirmDialog> island".
 *
 * `destructive` per CLAUDE.md's rule for irreversible-in-effect actions —
 * this isn't strictly irreversible (another packet can be marked current
 * afterward), but it is immediately club-wide-visible with no preview step,
 * the same bar PendingVersionsPanel's "Adopt Version" confirmation uses.
 *
 * When already current, renders a disabled indicator instead of a button —
 * there's nothing to confirm, it's already the one members see.
 */
export function MarkCurrentButton({ packetId, lionsYear, isCurrent }: MarkCurrentButtonProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submitMarkCurrent() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/welcome-packets/${packetId}/mark-current`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Unable to publish this packet.");
      }
      toast.success(`The ${lionsYear} packet is now live at /members/records/welcome-packet.`);
      setConfirmOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to publish this packet.");
    } finally {
      setBusy(false);
    }
  }

  if (isCurrent) {
    return (
      <div className="rounded-2xl bg-lions-blue/5 border border-lions-blue/20 p-4">
        <p className="text-sm font-semibold text-lions-blue">This is the current packet.</p>
        <p className="mt-1 text-xs text-gray-600">
          Every linked member sees this version at <code className="rounded bg-white px-1 py-0.5">/members/records/welcome-packet</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white shadow-sm p-4">
      <p className="text-sm text-gray-600 mb-3">
        Not currently published. Publishing replaces whatever packet members see now, immediately.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => setConfirmOpen(true)}
        className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
      >
        Mark as Current
      </button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Publish the ${lionsYear} packet?`}
        description="This makes it the packet every linked member sees immediately at /members/records/welcome-packet, replacing whatever is current now. It can be undone by marking a different packet current, but there is no separate preview step before this takes effect."
        confirmLabel="Publish"
        destructive
        onConfirm={() => void submitMarkCurrent()}
      />
    </div>
  );
}
