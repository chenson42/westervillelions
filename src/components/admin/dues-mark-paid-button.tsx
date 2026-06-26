"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface DuesMarkPaidButtonProps {
  memberId: string;
  fiscalYear: number;
  expectedCents: number;
  totalPaidCents: number;
}

/**
 * Quick "Mark Paid" button for the admin dues list.
 * Posts the remaining balance as a single electronic (Zeffy) payment — most
 * members pay dues online, so that is the sensible default for the one-click action.
 *
 * Render conditions (caller must enforce):
 *  - canManage (DUES_MANAGE feature gate)
 *  - status !== "paid"
 *  - expectedCents > 0
 *
 * If expectedCents <= 0 (amounts not configured), the caller should not render
 * this button. This component hides itself if remainingCents < 1 as a safety
 * guard (e.g., partial overpayment edge cases).
 */
export default function DuesMarkPaidButton({
  memberId,
  fiscalYear,
  expectedCents,
  totalPaidCents,
}: DuesMarkPaidButtonProps) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const remainingCents = expectedCents - totalPaidCents;

  // Safety guard: should not render if nothing remains, but hide rather than throw.
  if (remainingCents < 1) return null;

  function buildLocalDateString(): string {
    // Use local Y/M/D — NOT toISOString() which gives UTC and can be a day off
    // relative to the user's timezone (the naive-timestamp-as-UTC gotcha).
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  async function handleMarkPaid() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/dues/${memberId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fiscalYear,
          amountCents: remainingCents,
          paymentDate: buildLocalDateString(),
          method: "zeffy",
          notes: "Marked paid from dues list",
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not record payment.");
      }

      const data = await res.json().catch(() => ({}));
      if (data.syncFailed) {
        toast.warning("Payment saved, but the ledger auto-post failed — record the income manually in the Ledger.");
      } else {
        toast.success("Marked paid");
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record payment. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleMarkPaid}
      disabled={loading}
      className="ml-2 rounded-lg bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 transition disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-green-600"
    >
      {loading ? "Saving…" : "Mark Paid"}
    </button>
  );
}
