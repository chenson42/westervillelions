"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { mirrorTargetOptions, type AdminCategoryRow, type EntityCategoryData } from "@/lib/ledger-category-ui";
import { MIRROR_COPY, mirrorErrorMessage, type MirrorErrorCode } from "@/lib/ledger-category-mirror";
import type { FundLabels } from "@/lib/ledger-fund-labels";

interface CategoryMirrorDialogProps {
  category: AdminCategoryRow;
  /** Every entity's categories; the Foundation's feed the picker. */
  entities: EntityCategoryData[];
  labels: FundLabels;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function isMirrorCode(code: unknown): code is MirrorErrorCode {
  return typeof code === "string" && code in MIRROR_COPY;
}

/**
 * Set or clear the Foundation counterpart of a Public Funds income category
 * (`PATCH .../categories/[id] { mirrorsCategoryId }`, `ledger.manage`). The
 * counterpart decides where a swept gift lands and whether it needs a receipt,
 * so the dialog says so. A refusal shows the server's plain-language reason
 * (the typed code is mapped through `mirrorErrorMessage`), never a bare status.
 */
export default function CategoryMirrorDialog({
  category,
  entities,
  labels,
  open,
  onOpenChange,
}: CategoryMirrorDialogProps) {
  const router = useRouter();
  const options = mirrorTargetOptions(entities, category.id);
  const [targetId, setTargetId] = useState(category.mirrorsCategoryId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTargetId(category.mirrorsCategoryId ?? "");
    setError(null);
  }, [open, category.id, category.mirrorsCategoryId]);

  const unchanged = targetId === (category.mirrorsCategoryId ?? "");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (unchanged) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/ledger/categories/${category.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mirrorsCategoryId: targetId || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = isMirrorCode(data.code)
          ? mirrorErrorMessage(data.code, labels)
          : data.error || "Could not change the counterpart. Try again.";
        setError(message);
        toast.error(message);
        return;
      }
      toast.success(targetId ? "Foundation counterpart set." : `Counterpart cleared. Gifts stay in ${labels.activity}.`);
      router.refresh();
      onOpenChange(false);
    } catch {
      const message = "Could not change the counterpart. Check your connection and try again.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 focus:outline-none max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-1">
            <Dialog.Title className="text-lg font-semibold text-gray-900">
              Foundation counterpart &mdash; {category.name}
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
            Records which Foundation category this {labels.activity} category belongs with. The Foundation
            category also decides whether a gift counts as giving and whether a receipt is needed. Itemized
            sweeps will use it; today&apos;s lump sweep ignores it, and no copy or donor reaches the
            Foundation yet.
          </Dialog.Description>

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label htmlFor="mirror-target" className="block text-sm font-medium text-gray-700 mb-1">
                Foundation category
              </label>
              <select
                id="mirror-target"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue min-h-[44px]"
              >
                <option value="">None, stays in {labels.activity}</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              {options.length === 0 && (
                <p className="mt-2 text-xs text-gray-500">
                  The Foundation has no active income category in its Charitable fund yet. Create one first.
                </p>
              )}
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={saving}
                className="bg-lions-blue text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
