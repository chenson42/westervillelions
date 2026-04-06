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
        if (added === 0 && removed === 0) {
          toast.success("club@ is already up to date — no changes needed");
        } else {
          const parts = [];
          if (added > 0) parts.push(`${added} added (${data.added.join(", ")})`);
          if (removed > 0) parts.push(`${removed} removed (${data.removed.join(", ")})`);
          toast.success(`club@ synced: ${parts.join(" · ")}`);
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
