"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MAX_CATEGORY_NAME_LENGTH } from "@/lib/ledger";
import type { AdminCategoryRow } from "@/lib/ledger-category-ui";
import type { CategoryImpact } from "@/lib/ledger-category-queries";

interface CategoryRenameDialogProps {
  category: AdminCategoryRow;
  fundLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Rename dialog — the single most important interaction in this feature
 * (Treasurer Decision 1). Fetches `GET .../impact` on open and shows what
 * the rename affects — transaction count, budget-line count, and every
 * fiscal year that will relabel, flagging locked ones — BEFORE the treasurer
 * can save. Renaming is allowed even when a locked year is affected (a name
 * is a label, not a figure); the impact display is disclosure, not a block.
 * A plain Save is fine when no locked year is affected; a
 * <ConfirmDialog> (non-destructive — this isn't reversal-costly the way
 * deactivate/merge are) gates the save when a locked year IS affected.
 */
export default function CategoryRenameDialog({
  category,
  fundLabel,
  open,
  onOpenChange,
}: CategoryRenameDialogProps) {
  const router = useRouter();
  const [name, setName] = useState(category.name);
  const [impact, setImpact] = useState<CategoryImpact | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(category.name);
    setImpact(null);
    setLoadingImpact(true);
    fetch(`/api/admin/ledger/categories/${category.id}/impact`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load impact"))))
      .then((data: CategoryImpact) => setImpact(data))
      .catch(() => {
        toast.error("Couldn't load what this rename affects — try reopening the dialog.");
      })
      .finally(() => setLoadingImpact(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category.id]);

  const lockedYears = (impact?.budgetLines.fiscalYears ?? []).filter((fy) => fy.locked);
  const trimmedName = name.trim();
  const unchanged = trimmedName === category.name;

  async function doSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/ledger/categories/${category.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to rename category.");
      }
      toast.success(`Renamed to "${data.name}".`);
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rename category. Try again.");
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  }

  function handleSaveClick(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmedName) {
      toast.error("Category name cannot be empty.");
      return;
    }
    if (trimmedName.length > MAX_CATEGORY_NAME_LENGTH) {
      toast.error(`Category name must be ${MAX_CATEGORY_NAME_LENGTH} characters or fewer.`);
      return;
    }
    if (unchanged) {
      onOpenChange(false);
      return;
    }
    if (lockedYears.length > 0) {
      setConfirmOpen(true);
      return;
    }
    void doSave();
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 focus:outline-none max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <Dialog.Title className="text-lg font-semibold text-gray-900">
                Rename Category
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

            <div className="rounded-lg bg-gray-50 p-4 mb-4 text-sm">
              {loadingImpact ? (
                <p className="text-gray-500">Loading what this rename affects…</p>
              ) : impact ? (
                <div className="space-y-2">
                  <p className="text-gray-700">
                    <span className="font-semibold tabular-nums">{impact.transactions.total}</span>{" "}
                    transaction{impact.transactions.total === 1 ? "" : "s"} and{" "}
                    <span className="font-semibold tabular-nums">{impact.budgetLines.total}</span>{" "}
                    budget line{impact.budgetLines.total === 1 ? "" : "s"} will display under the
                    new name.
                  </p>
                  {impact.budgetLines.fiscalYears.length > 0 && (
                    <div>
                      <p className="text-gray-500">Fiscal years affected:</p>
                      <ul className="mt-1 flex flex-wrap gap-1.5">
                        {impact.budgetLines.fiscalYears.map((fy) => (
                          <li
                            key={fy.fiscalYear}
                            className={`rounded-lg px-2 py-0.5 text-xs font-medium ${
                              fy.locked
                                ? "bg-amber-100 text-amber-800"
                                : "bg-gray-200 text-gray-700"
                            }`}
                          >
                            FY{fy.fiscalYear}
                            {fy.locked ? " (locked)" : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {lockedYears.length > 0 && (
                    <p className="text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
                      This rename will relabel {lockedYears.length} locked, board-approved fiscal
                      year{lockedYears.length === 1 ? "" : "s"}. A category name is a label, not a
                      figure — renaming is allowed, but you&apos;ll be asked to confirm.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-gray-500">Couldn&apos;t load impact.</p>
              )}
            </div>

            <form onSubmit={handleSaveClick} className="space-y-4">
              <div>
                <label htmlFor="rename-cat-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Category name
                </label>
                <input
                  id="rename-cat-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={MAX_CATEGORY_NAME_LENGTH}
                  className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                />
                <p className="mt-1 text-xs text-gray-400 text-right tabular-nums">
                  {name.length}/{MAX_CATEGORY_NAME_LENGTH}
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
        title="Relabel locked fiscal years?"
        description={`"${category.name}" will become "${trimmedName}" everywhere it's referenced, including ${lockedYears.length} locked, board-approved fiscal year${lockedYears.length === 1 ? "" : "s"} (${lockedYears.map((fy) => `FY${fy.fiscalYear}`).join(", ")}). This does not change any dollar amount, only the label.`}
        confirmLabel={saving ? "Saving…" : "Rename"}
        onConfirm={doSave}
      />
    </>
  );
}
