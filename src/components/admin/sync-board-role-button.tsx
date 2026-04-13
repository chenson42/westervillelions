"use client";

import { useState } from "react";
import { toast } from "sonner";

export function SyncBoardRoleButton() {
  const [loading, setLoading] = useState(false);

  async function handleSync() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/groups/sync-board-role", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Sync failed");
        return;
      }
      toast.success(
        `Sync complete — Assigned: ${data.assigned}, Removed: ${data.removed}, Skipped: ${data.skipped}`
      );
    } catch {
      toast.error("Sync failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleSync}
      disabled={loading}
      className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg font-semibold hover:bg-lions-blue/5 transition disabled:opacity-50"
    >
      {loading ? "Syncing..." : "Sync Board Member Role"}
    </button>
  );
}
