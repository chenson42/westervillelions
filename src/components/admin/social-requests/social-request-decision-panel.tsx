"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DECISION_TARGET_STATUSES, DECISION_NOTE_MAX_LEN, socialRequestStatusLabel } from "@/lib/social-requests";

/**
 * Board decision surface for a social media post request. A status change is
 * NOT wrapped in <ConfirmDialog> — it's additive history, not
 * destructive/irreversible, matching `proposal-decision-panel.tsx`'s exact
 * ruling (Phase 3 Component Plan).
 *
 * Simpler than its Proposals counterpart by design: no `minutesOptions`/
 * citing-minutes `<select>`, no chair-backfill panel — this feature's
 * decisions carry no minutes-citation trio (see schema.ts doc comment on
 * `social_request_decisions`). `note` is also where a board member records
 * *where/when* a request was actually posted when marking it `posted` — no
 * separate column.
 *
 * The <select> (rather than checkboxes/radio) is deliberate — this audience
 * is a handful of tech-comfortable board members, same reasoning as
 * Proposals' decision panel.
 */
export function SocialRequestDecisionPanel({
  requestId,
  currentStatus,
}: {
  requestId: string;
  currentStatus: string;
}) {
  const router = useRouter();

  const [targetStatus, setTargetStatus] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleDecide(e: React.FormEvent) {
    e.preventDefault();
    if (!targetStatus) {
      toast.error("Choose a status to move this request to.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/social-requests/${requestId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: targetStatus,
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not record this decision.");
      }
      toast.success(`Request moved to ${socialRequestStatusLabel(targetStatus)}.`);
      setTargetStatus("");
      setNote("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record this decision.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleDecide} className="bg-white rounded-2xl shadow-sm overflow-hidden p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Record a Decision</h2>

      <div>
        <label htmlFor="social-decision-status" className="block text-sm font-medium text-gray-700 mb-1">
          New status
        </label>
        <select
          id="social-decision-status"
          value={targetStatus}
          onChange={(e) => setTargetStatus(e.target.value)}
          disabled={submitting}
          className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
        >
          <option value="">Choose a status…</option>
          {DECISION_TARGET_STATUSES.filter((s) => s !== currentStatus).map((s) => (
            <option key={s} value={s}>
              {socialRequestStatusLabel(s)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="social-decision-note" className="block text-sm font-medium text-gray-700 mb-1">
          Note <span className="text-gray-400 font-normal text-xs">(optional)</span>
        </label>
        <textarea
          id="social-decision-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={DECISION_NOTE_MAX_LEN}
          disabled={submitting}
          placeholder='e.g., "Posted to Facebook and Instagram 9/5" or "Declined — off-brand messaging"'
          className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60 resize-none"
        />
        <p className="mt-1 text-xs text-gray-400">
          If marking this Posted, this is a good place to note where and when it went up.
        </p>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
      >
        {submitting ? "Recording…" : "Record Decision"}
      </button>
    </form>
  );
}
