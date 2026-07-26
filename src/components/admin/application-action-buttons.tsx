"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function ApplicationActionButtons({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [adminNotes, setAdminNotes] = useState("");

  async function handleAction(action: "approve" | "approve_prospective" | "reject") {
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

    if (action === "approve") {
      toast.success("Application approved — member record created.");
    } else if (action === "approve_prospective") {
      toast.success("Application approved as prospective — added to club email list.");
    } else {
      toast.success("Application rejected.");
    }
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
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            onClick={() => handleAction("approve")}
            disabled={isPending}
            className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
          >
            {isPending ? "Approving..." : "Approve"}
          </button>
          <button
            onClick={() => handleAction("approve_prospective")}
            disabled={isPending}
            title="Adds them to the club email list without portal login or dues billing until inducted."
            className="flex-1 border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg text-sm font-medium hover:bg-lions-blue/5 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
          >
            {isPending ? "Approving..." : "Approve as Prospective"}
          </button>
          <button
            onClick={() => setShowRejectForm(true)}
            disabled={isPending}
            className="flex-1 bg-red-50 text-red-700 border border-red-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-100 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
