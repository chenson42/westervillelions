"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface DuesCategoryControlProps {
  memberId: string;
  currentCategory: string;
  /** Expected amount in cents for the currently-set category (for display) */
  expectedAmountCents: number;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Inline select on the per-member detail page to change the member's
 * dues category (individual / family). Visible only when canManage is true.
 *
 * Note: dues_category is on the members row, not per-FY.
 * Changing it retroactively recalculates status for all years.
 */
export default function DuesCategoryControl({
  memberId,
  currentCategory,
  expectedAmountCents,
}: DuesCategoryControlProps) {
  const [category, setCategory] = useState(currentCategory);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleChange(newCategory: string) {
    if (newCategory === category) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/dues/${memberId}/category`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duesCategory: newCategory }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update dues category.");
      }
      setCategory(newCategory);
      toast.success("Dues category updated.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update dues category. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div>
        <label htmlFor="dues-category" className="block text-xs font-medium text-gray-500 mb-1">
          Dues Category
        </label>
        <select
          id="dues-category"
          value={category}
          disabled={saving}
          onChange={(e) => handleChange(e.target.value)}
          className="rounded-md border border-gray-300 py-1.5 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
          title="Changing category recalculates dues status across all fiscal years for this member."
        >
          <option value="individual">Individual</option>
          <option value="family">Family</option>
        </select>
        <p className="mt-1 text-xs text-gray-400 max-w-[16rem]">
          Recalculates dues status across all fiscal years for this member.
        </p>
      </div>
      <div className="text-sm text-gray-500 pt-4">
        <span className="text-xs text-gray-400">Expected: </span>
        <span className="font-medium text-gray-700">{formatDollars(expectedAmountCents)}</span>
      </div>
      {saving && (
        <span className="pt-4 text-xs text-gray-400">Saving...</span>
      )}
    </div>
  );
}
