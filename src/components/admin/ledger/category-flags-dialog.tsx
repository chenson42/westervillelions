"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MAX_FORM_990_LINE_LENGTH } from "@/lib/ledger";
import type { AdminCategoryRow } from "@/lib/ledger-category-ui";
import type { CategoryImpact } from "@/lib/ledger-category-queries";

interface CategoryFlagsDialogProps {
  category: AdminCategoryRow;
  fundLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * countsAsGiving / form990Line editor. countsAsGiving retroactively changes
 * what /members/impact shows for every transaction already posted to this
 * category, so flipping it fetches GET .../impact for the dollar figure and
 * gates the save behind a <ConfirmDialog destructive> — literally
 * reversible, but retroactive-and-public-facing enough to deserve the same
 * weight as an irreversible action (architect Ruling #7). form990Line is
 * compliance text with no dollar impact — a plain save when it's the only
 * thing that changed.
 */
export default function CategoryFlagsDialog({
  category,
  fundLabel,
  open,
  onOpenChange,
}: CategoryFlagsDialogProps) {
  const router = useRouter();
  const [countsAsGiving, setCountsAsGiving] = useState(category.countsAsGiving);
  const [form990Line, setForm990Line] = useState(category.form990Line ?? "");
  const [impact, setImpact] = useState<CategoryImpact | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCountsAsGiving(category.countsAsGiving);
    setForm990Line(category.form990Line ?? "");
    setImpact(null);
    setLoadingImpact(true);
    fetch(`/api/admin/ledger/categories/${category.id}/impact`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load impact"))))
      .then((data: CategoryImpact) => setImpact(data))
      .catch(() => {
        toast.error("Couldn't load this category's giving impact — try reopening the dialog.");
      })
      .finally(() => setLoadingImpact(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category.id]);

  const trimmedForm990Line = form990Line.trim();
  const givingChanged = countsAsGiving !== category.countsAsGiving;
  const form990Changed = trimmedForm990Line !== (category.form990Line ?? "");
  const nothingChanged = !givingChanged && !form990Changed;

  async function doSave() {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      if (givingChanged) patch.countsAsGiving = countsAsGiving;
      if (form990Changed) patch.form990Line = trimmedForm990Line || null;

      const res = await fetch(`/api/admin/ledger/categories/${category.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to update category.");
      }
      toast.success("Category updated.");
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update category. Try again.");
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  }

  function handleSaveClick(e: React.FormEvent) {
    e.preventDefault();
    if (trimmedForm990Line.length > MAX_FORM_990_LINE_LENGTH) {
      toast.error(`Form 990 line must be ${MAX_FORM_990_LINE_LENGTH} characters or fewer.`);
      return;
    }
    if (nothingChanged) {
      onOpenChange(false);
      return;
    }
    if (givingChanged) {
      setConfirmOpen(true);
      return;
    }
    void doSave();
  }

  const dollarImpact = impact ? formatDollars(impact.transactions.postedGivingCents) : null;

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 focus:outline-none max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <Dialog.Title className="text-lg font-semibold text-gray-900">
                Edit Flags — {category.name}
              </Dialog.Title>
              <Dialog.Close
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
                aria-label="Close"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Dialog.Close>
            </div>
            <Dialog.Description className="text-sm text-gray-500 mb-4">
              {fundLabel} &middot; {category.flow === "income" ? "Income" : "Expense"}
            </Dialog.Description>

            <form onSubmit={handleSaveClick} className="space-y-4">
              <div className="rounded-lg bg-gray-50 p-4">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={countsAsGiving}
                    onChange={(e) => setCountsAsGiving(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
                  />
                  Counts toward reported community giving
                </label>
                <p className="mt-2 text-xs text-gray-500">
                  {loadingImpact
                    ? "Loading dollar impact…"
                    : dollarImpact
                      ? `${dollarImpact} in posted transactions on this category ${countsAsGiving ? "count" : "would count"} toward the Club's public /members/impact giving totals.`
                      : "No posted giving-eligible transactions on this category."}
                </p>
              </div>

              <div>
                <label htmlFor="flags-cat-990" className="block text-sm font-medium text-gray-700 mb-1">
                  Form 990 line
                </label>
                <input
                  id="flags-cat-990"
                  type="text"
                  value={form990Line}
                  onChange={(e) => setForm990Line(e.target.value)}
                  maxLength={MAX_FORM_990_LINE_LENGTH}
                  placeholder="Leave blank for Unmapped"
                  className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                />
                <p className="mt-1 text-xs text-gray-400 text-right tabular-nums">
                  {form990Line.length}/{MAX_FORM_990_LINE_LENGTH}
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
                  >
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={saving || loadingImpact}
                  className="bg-lions-blue text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
                >
                  {saving ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={countsAsGiving ? "Include this category in reported giving?" : "Exclude this category from reported giving?"}
        description={`${dollarImpact ?? "$0.00"} in posted transactions on "${category.name}" will ${countsAsGiving ? "start counting" : "stop counting"} toward the Club's public giving totals on /members/impact, effective immediately.`}
        confirmLabel={saving ? "Saving…" : "Confirm"}
        destructive
        onConfirm={doSave}
      />
    </>
  );
}
