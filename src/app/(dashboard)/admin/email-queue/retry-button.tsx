"use client";

import { useState } from "react";
import { toast } from "sonner";

export default function RetryButton() {
  const [loading, setLoading] = useState(false);

  async function handleRetry() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/email-queue/retry", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Retry failed");
      } else if (data.retried === 0) {
        toast.success("No eligible emails to retry right now");
      } else {
        toast.success(
          `Retried ${data.retried} email${data.retried !== 1 ? "s" : ""}: ${data.succeeded} succeeded, ${data.failed} failed`
        );
        // Refresh the page to show updated statuses
        window.location.reload();
      }
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleRetry}
      disabled={loading}
      className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-lions-blue-dark disabled:opacity-50 disabled:cursor-not-allowed transition"
    >
      {loading ? "Retrying..." : "Retry Failed Emails"}
    </button>
  );
}
