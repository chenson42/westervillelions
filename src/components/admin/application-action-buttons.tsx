"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function ApplicationActionButtons({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [adminNotes, setAdminNotes] = useState("");

  async function handleAction(action: "approve" | "reject") {
    const res = await fetch(`/api/admin/membership-applications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, adminNotes: adminNotes || undefined }),
    });

    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error || "Action failed");
      return;
    }

    toast.success(action === "approve" ? "Application approved — member record created." : "Application rejected.");
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-3">
      {showRejectForm ? (
        <div className="space-y-2">
          <textarea
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-400 focus:border-transparent"
          />
          <div className="flex gap-2">
            <button
              onClick={() => handleAction("reject")}
              disabled={isPending}
              className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition disabled:opacity-60"
            >
              {isPending ? "Rejecting..." : "Confirm Reject"}
            </button>
            <button
              onClick={() => setShowRejectForm(false)}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 hover:bg-gray-50 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => handleAction("approve")}
            disabled={isPending}
            className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition disabled:opacity-60"
          >
            {isPending ? "Approving..." : "Approve"}
          </button>
          <button
            onClick={() => setShowRejectForm(true)}
            disabled={isPending}
            className="flex-1 bg-red-50 text-red-700 border border-red-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-100 transition disabled:opacity-60"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
