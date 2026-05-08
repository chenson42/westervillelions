"use client";

import { useState } from "react";
import { toast } from "sonner";

export default function SyncClubButton() {
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/members/sync-club", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        const added = data.added?.length ?? 0;
        const removed = data.removed?.length ?? 0;
        const failed: { email: string; op: string; error: string }[] = data.failed ?? [];
        const parts: string[] = [];
        if (added > 0) parts.push(`${added} added (${data.added.join(", ")})`);
        if (removed > 0) parts.push(`${removed} removed (${data.removed.join(", ")})`);

        if (parts.length === 0 && failed.length === 0) {
          toast.success("club@ is already up to date — no changes needed");
        } else if (parts.length > 0) {
          toast.success(`club@ synced: ${parts.join(" · ")}`);
        }

        if (failed.length > 0) {
          const summary = failed
            .map((f) => `${f.email} (${f.op}: ${f.error})`)
            .join("; ");
          toast.warning(`${failed.length} email${failed.length === 1 ? "" : "s"} skipped — ${summary}`, {
            duration: 10000,
          });
        }
      } else {
        toast.error(data.error || "Sync failed");
      }
    } catch {
      toast.error("Sync request failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <button
      onClick={handleSync}
      disabled={syncing}
      className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
      title="Sync all active members to club@westervillelions.org"
    >
      {syncing ? "Syncing..." : "Sync club@"}
    </button>
  );
}
