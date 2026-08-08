"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  getMergeDestinationOptions,
  isPriorFiscalYearMergeRefusal,
  type AdminCategoryRow,
} from "@/lib/ledger-category-ui";

interface CategoryMergeDialogProps {
  source: AdminCategoryRow;
  /** Every category for this entity (active + inactive) — narrowed to
   *  eligible destinations client-side via getMergeDestinationOptions. */
  allCategories: AdminCategoryRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

interface MergePlanResponse {
  plan: Array<{
    fiscalYear: number;
    entityName: string;
    fundName: string;
    annualAmountCents: number;
    locked: boolean;
  }>;
  sourceTransactionCount: number;
  destinationName: string;
}

/**
 * Merge dialog — destination picker, dry-run preview
 * (`POST .../merge {confirm:false}`), then apply
 * (`{confirm:true}`) behind a <ConfirmDialog destructive>. When the API
 * refuses (source has transactions / both-sides budget-year collision /
 * inactive destination / locked current FY / any affected fiscal year is
 * prior to the current FY / any affected fiscal year is locked) the
 * refusal reason AND its counts/years are surfaced verbatim from the 409
 * body — never a bare "failed" (Treasurer Decision 2 / Phase 3 design; the
 * locked-fiscal-year refusal is a 2026-08-07 treasurer decision, and the
 * prior-fiscal-year refusal is a 2026-08-08 treasurer decision,
 * DECISION-068 — merging moves a budgeted amount, unlike a rename, so both
 * whole-refuse rather than skipping the affected year(s) silently).
 *
 * The prior-fiscal-year refusal gets its own, non-alarming presentation
 * (see `isPriorFiscalYearMergeRefusal` below) rather than the generic red
 * "failed" treatment — a category whose only remaining budget row is from
 * a closed prior year (e.g. `Awards`, which now has only a leftover FY2025
 * row) has nothing mergeable today, and that's the correct, board-
 * preserving outcome, not a bug a treasurer needs to work around.
 *
 * A plan is only ever returned by the server when NO affected year is
 * prior to the current FY or locked, so `plan.plan[].locked` reads `false`
 * on every entry actually rendered here — the amber "locked" chip below is
 * defensive display only, kept in case a future increment relaxes the
 * block for a subset of years.
 */
export default function CategoryMergeDialog({
  source,
  allCategories,
  open,
  onOpenChange,
}: CategoryMergeDialogProps) {
  const router = useRouter();
  const [destinationId, setDestinationId] = useState("");
  const [plan, setPlan] = useState<MergePlanResponse | null>(null);
  const [refusalError, setRefusalError] = useState<string | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [merging, setMerging] = useState(false);

  const destinationOptions = getMergeDestinationOptions(allCategories, source);

  useEffect(() => {
    if (!open) return;
    setDestinationId(destinationOptions[0]?.id ?? "");
    setPlan(null);
    setRefusalError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source.id]);

  async function fetchPlan(nextDestinationId: string) {
    if (!nextDestinationId) {
      setPlan(null);
      setRefusalError(null);
      return;
    }
    setLoadingPlan(true);
    setPlan(null);
    setRefusalError(null);
    try {
      const res = await fetch("/api/admin/ledger/categories/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: source.id, destinationId: nextDestinationId, confirm: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRefusalError(data.error || "This merge isn't possible.");
        return;
      }
      setPlan(data as MergePlanResponse);
    } catch {
      setRefusalError("Couldn't preview this merge — try again.");
    } finally {
      setLoadingPlan(false);
    }
  }

  function handleDestinationChange(nextId: string) {
    setDestinationId(nextId);
    void fetchPlan(nextId);
  }

  async function handleConfirmMerge() {
    if (!destinationId) return;
    setMerging(true);
    try {
      const res = await fetch("/api/admin/ledger/categories/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: source.id, destinationId, confirm: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "This merge isn't possible.");
      }
      toast.success(`Merged "${source.name}" into "${plan?.destinationName ?? "destination"}".`);
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not merge categories. Try again.");
    } finally {
      setMerging(false);
      setConfirmOpen(false);
    }
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 focus:outline-none max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <Dialog.Title className="text-lg font-semibold text-gray-900">
                Merge &ldquo;{source.name}&rdquo;
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
              Only supported when the source has zero transactions — budget rows are re-pointed
              to the destination, transactions are never touched. The source category is not
              deleted. A merge moves a budgeted amount, not just a label, so it only ever touches
              the current fiscal year&rsquo;s budget line: a category whose only remaining budget
              row is from a closed prior year has nothing left to merge, and that row stays
              exactly as the board approved it. It&rsquo;s also blocked outright if any affected
              fiscal year is locked &mdash; unlock that year first, or ask the board to reopen it,
              if the merge is still needed.
            </Dialog.Description>

            {destinationOptions.length === 0 ? (
              <div className="bg-gray-50 rounded-2xl p-6 text-center text-sm text-gray-500">
                No other active category in this fund and flow to merge into.
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label htmlFor="merge-destination" className="block text-sm font-medium text-gray-700 mb-1">
                    Merge into
                  </label>
                  <select
                    id="merge-destination"
                    value={destinationId}
                    onChange={(e) => handleDestinationChange(e.target.value)}
                    className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue min-h-[44px]"
                  >
                    {destinationOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-lg bg-gray-50 p-4 text-sm">
                  {loadingPlan ? (
                    <p className="text-gray-500">Checking this merge…</p>
                  ) : refusalError && isPriorFiscalYearMergeRefusal(refusalError) ? (
                    <div className="space-y-1">
                      <p className="font-medium text-gray-700">
                        Nothing to merge in the current fiscal year
                      </p>
                      <p className="text-gray-600">{refusalError}</p>
                    </div>
                  ) : refusalError ? (
                    <p className="text-red-700">{refusalError}</p>
                  ) : plan ? (
                    plan.plan.length === 0 ? (
                      <p className="text-gray-600">
                        No budget rows to move — &ldquo;{source.name}&rdquo; has no budget lines to
                        re-point. Merging will still leave the source with zero transactions and no
                        budget rows.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-gray-700">
                          {plan.plan.length} fiscal year{plan.plan.length === 1 ? "" : "s"} will move
                          to &ldquo;{plan.destinationName}&rdquo;:
                        </p>
                        <ul className="space-y-1">
                          {plan.plan.map((p) => (
                            <li
                              key={p.fiscalYear}
                              className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-1.5"
                            >
                              <span className="text-gray-700">
                                FY{p.fiscalYear} &middot; {p.fundName}
                                {p.locked && (
                                  <span className="ml-2 rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                    locked
                                  </span>
                                )}
                              </span>
                              <span className="font-semibold tabular-nums text-gray-900">
                                {formatDollars(p.annualAmountCents)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  ) : (
                    <p className="text-gray-500">Choose a destination to preview this merge.</p>
                  )}
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
                    type="button"
                    onClick={() => setConfirmOpen(true)}
                    disabled={!plan || loadingPlan}
                    className="bg-lions-blue text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-lions-blue"
                  >
                    Merge
                  </button>
                </div>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Merge these categories?"
        description={`"${source.name}" will be merged into "${plan?.destinationName ?? ""}". Every fiscal year's budget line listed above moves to the destination. "${source.name}" is not deleted — it stays as an unused category with no budget rows. This cannot be undone from the UI.`}
        confirmLabel={merging ? "Merging…" : "Merge"}
        destructive
        onConfirm={handleConfirmMerge}
      />
    </>
  );
}
