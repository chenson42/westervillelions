"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { AdminCategoryRow } from "@/lib/ledger-category-ui";
import type { CategoryImpact } from "@/lib/ledger-category-queries";

interface CategoryDeactivateConfirmProps {
  /** null closes the dialog — same nullable-target pattern as donor-list.tsx. */
  category: AdminCategoryRow | null;
  onClose: () => void;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Deactivate warns on an open current-FY balance rather than blocking
 * (DECISION-066 item 4) — fetches GET .../impact on open to populate the
 * warning, then <ConfirmDialog destructive> for the PATCH { isActive: false }.
 */
export default function CategoryDeactivateConfirm({
  category,
  onClose,
}: CategoryDeactivateConfirmProps) {
  const router = useRouter();
  const [impact, setImpact] = useState<CategoryImpact | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!category) return;
    setImpact(null);
    setLoading(true);
    fetch(`/api/admin/ledger/categories/${category.id}/impact`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load impact"))))
      .then((data: CategoryImpact) => setImpact(data))
      .catch(() => {
        // Non-fatal — the confirm still works, just without the open-balance line.
      })
      .finally(() => setLoading(false));
  }, [category]);

  async function handleConfirm() {
    if (!category) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/ledger/categories/${category.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to deactivate category.");
      }
      toast.success(`"${data.name}" deactivated.`);
      router.refresh();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not deactivate category. Try again.");
    } finally {
      setSaving(false);
    }
  }

  let description =
    "This category will no longer appear in category pickers for new transactions or budget " +
    "lines. Historical transactions and budget rows keep their name and amount unchanged.";
  if (category) {
    description = `"${category.name}" will no longer appear in category pickers for new transactions or budget lines. Historical transactions and budget rows keep their name and amount unchanged.`;
  }
  if (loading) {
    description += " Checking for an open balance…";
  } else if (impact?.openBalance.hasNonLockedBudgetRow) {
    description += ` Warning: this category still has an open, non-locked FY${impact.openBalance.currentFiscalYear} budget of ${formatDollars(impact.openBalance.currentFyBudgetedCents ?? 0)} that hasn't been approved yet.`;
  }

  return (
    <ConfirmDialog
      open={Boolean(category)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={category ? `Deactivate "${category.name}"?` : "Deactivate category?"}
      description={description}
      confirmLabel={saving ? "Deactivating…" : "Deactivate"}
      destructive
      onConfirm={handleConfirm}
    />
  );
}
