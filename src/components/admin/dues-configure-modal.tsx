"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface DuesConfigureModalProps {
  fiscalYear: number;
  currentIndividualCents: number;
  currentFamilyCents: number;
  /** True when this fiscal year is currently the active default. */
  isCurrentlyActive?: boolean;
  /** The fiscal year currently marked active (for display in the modal). */
  activeFiscalYear?: number | null;
}

function centsToDisplayDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function parseDollars(value: string): number | null {
  const n = parseFloat(value.replace(/[$,]/g, "").trim());
  if (isNaN(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * Modal for configuring per-FY dues amounts (individual + family).
 * Gated: only render when canManage is true.
 */
export default function DuesConfigureModal({
  fiscalYear,
  currentIndividualCents,
  currentFamilyCents,
  isCurrentlyActive = false,
  activeFiscalYear = null,
}: DuesConfigureModalProps) {
  const [open, setOpen] = useState(false);
  const [individual, setIndividual] = useState(centsToDisplayDollars(currentIndividualCents));
  const [family, setFamily] = useState(centsToDisplayDollars(currentFamilyCents));
  const [makeActive, setMakeActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const individualCents = parseDollars(individual);
    const familyCents = parseDollars(family);

    if (individualCents === null || individualCents <= 0) {
      toast.error("Individual dues must be a positive dollar amount.");
      return;
    }
    if (familyCents === null || familyCents <= 0) {
      toast.error("Family dues must be a positive dollar amount.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/dues/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fiscalYear,
          individualAmountCents: individualCents,
          familyAmountCents: familyCents,
          ...(makeActive ? { isActive: true } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save dues amounts.");
      }
      toast.success("Dues amounts updated.");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save dues amounts. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 bg-white border border-lions-blue text-lions-blue px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
        >
          Configure Dues Amounts
          {isCurrentlyActive && (
            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              Active
            </span>
          )}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <Dialog.Title className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            Configure Dues Amounts — FY{fiscalYear}
            {isCurrentlyActive && (
              <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                Active
              </span>
            )}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-500">
            Set the annual dues amounts for individual and family members. Changes take effect immediately for all payment calculations.
            {!isCurrentlyActive && activeFiscalYear !== null && (
              <span className="block mt-1 text-yellow-700">
                Currently active year: FY{activeFiscalYear}
              </span>
            )}
          </Dialog.Description>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label htmlFor="individual-dues" className="block text-sm font-medium text-gray-700 mb-1">
                Individual Rate ($)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  id="individual-dues"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={individual}
                  onChange={(e) => setIndividual(e.target.value)}
                  required
                  className="block w-full rounded-lg border border-gray-300 py-2 pl-7 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                  placeholder="120.00"
                />
              </div>
            </div>

            <div>
              <label htmlFor="family-dues" className="block text-sm font-medium text-gray-700 mb-1">
                Family Rate ($)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  id="family-dues"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={family}
                  onChange={(e) => setFamily(e.target.value)}
                  required
                  className="block w-full rounded-lg border border-gray-300 py-2 pl-7 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                  placeholder="96.00"
                />
              </div>
            </div>

            {!isCurrentlyActive && (
              <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <input
                  id="make-active"
                  type="checkbox"
                  checked={makeActive}
                  onChange={(e) => setMakeActive(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-lions-blue focus:ring-lions-blue"
                />
                <label htmlFor="make-active" className="text-sm text-gray-700 cursor-pointer">
                  <span className="font-medium">Set as the active fiscal year (default on all dues pages)</span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    All dues surfaces will default to FY{fiscalYear} when no year is specified.
                  </span>
                </label>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
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
                disabled={submitting}
                className="bg-lions-blue text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                {submitting ? "Saving..." : "Save Amounts"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
