"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export interface ReconciliationAccountOption {
  id: string;
  name: string;
  last4: string | null;
  entityId: string;
  entityName: string;
}

interface NewReconciliationSessionFormProps {
  /** Cash-type accounts (Petty Cash, T-20) are already filtered out by the
   *  caller — the server re-enforces this on POST regardless. */
  accounts: ReconciliationAccountOption[];
}

/** Parses a dollar string into signed integer cents. Unlike the main
 *  transaction form's parseDollars(), balances may legitimately be zero or
 *  negative (an overdrawn account), so this does not reject <= 0. */
function parseSignedDollars(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = parseFloat(trimmed.replace(/[$,]/g, ""));
  if (isNaN(n)) return null;
  return Math.round(n * 100);
}

function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Most banks post their statement for the month that just closed, so a new
 *  session almost always covers the previous calendar month. */
function previousMonthRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  return { start: toDateInputValue(start), end: toDateInputValue(end) };
}

/**
 * "New session" trigger + dialog + form. Bundles button/dialog/form in one
 * file, mirroring this codebase's existing dialog-composition convention
 * (filing-form-dialog.tsx, fund-manage-dialog.tsx).
 *
 * Server-side validation (overlap 409, cash-account 400, balance/date shape)
 * is authoritative — this form's own checks are a UX nicety, not a trust
 * boundary. A non-blocking gapWarning from a successful create is surfaced as
 * a separate toast, never treated as an error.
 */
export default function NewReconciliationSessionForm({
  accounts,
}: NewReconciliationSessionFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const defaultRange = previousMonthRange();
  const [bankAccountId, setBankAccountId] = useState(accounts[0]?.id ?? "");
  const [periodStart, setPeriodStart] = useState(defaultRange.start);
  const [periodEnd, setPeriodEnd] = useState(defaultRange.end);
  const [openingBalance, setOpeningBalance] = useState("");
  const [closingBalance, setClosingBalance] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(val: boolean) {
    if (val) {
      const range = previousMonthRange();
      setBankAccountId(accounts[0]?.id ?? "");
      setPeriodStart(range.start);
      setPeriodEnd(range.end);
      setOpeningBalance("");
      setClosingBalance("");
    }
    setOpen(val);
  }

  const groupedByEntity = accounts.reduce<
    Record<string, { entityName: string; accounts: ReconciliationAccountOption[] }>
  >((acc, a) => {
    if (!acc[a.entityId]) acc[a.entityId] = { entityName: a.entityName, accounts: [] };
    acc[a.entityId].accounts.push(a);
    return acc;
  }, {});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!bankAccountId) {
      toast.error("Select a bank account.");
      return;
    }
    if (!periodStart || !periodEnd) {
      toast.error("Enter both a statement start and end date.");
      return;
    }
    if (periodStart > periodEnd) {
      toast.error("Statement start date must be on or before the end date.");
      return;
    }
    const openingCents = parseSignedDollars(openingBalance);
    const closingCents = parseSignedDollars(closingBalance);
    if (openingCents === null || closingCents === null) {
      toast.error("Enter valid opening and closing balances.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/ledger/reconciliation/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankAccountId,
          statementPeriodStart: periodStart,
          statementPeriodEnd: periodEnd,
          openingBalanceCents: openingCents,
          closingBalanceCents: closingCents,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The server's overlap (409) and validation (400) messages are
        // already human-readable ("This period overlaps an existing
        // session (Jul 1–Jul 31, 2025)") — surfaced verbatim, dialog stays
        // open so the admin can adjust the dates.
        throw new Error(data.error || "Failed to create the reconciliation session.");
      }

      toast.success("Reconciliation session created.");
      if (data.gapWarning) {
        toast.warning(data.gapWarning);
      }
      setOpen(false);
      router.push(`/admin/ledger/reconciliation/${data.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not create the session. Try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (accounts.length === 0) {
    return null;
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
        >
          New session
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg max-h-[90vh] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl overflow-y-auto data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <Dialog.Title className="text-lg font-semibold text-gray-900">
            New reconciliation session
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-500">
            Pick the account and statement period, then enter the opening and closing
            balances from the statement. You&rsquo;ll upload the CSV on the next screen.
          </Dialog.Description>

          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <div>
              <label htmlFor="nrs-account" className="block text-sm font-medium text-gray-700 mb-1">
                Bank account
              </label>
              <select
                id="nrs-account"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                required
                className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              >
                {Object.values(groupedByEntity).map((group) => (
                  <optgroup key={group.entityName} label={group.entityName}>
                    {group.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.last4 ? ` (…${a.last4})` : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="nrs-start" className="block text-sm font-medium text-gray-700 mb-1">
                  Statement start
                </label>
                <input
                  id="nrs-start"
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  required
                  className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                />
              </div>
              <div>
                <label htmlFor="nrs-end" className="block text-sm font-medium text-gray-700 mb-1">
                  Statement end
                </label>
                <input
                  id="nrs-end"
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  required
                  className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="nrs-opening" className="block text-sm font-medium text-gray-700 mb-1">
                  Opening balance ($)
                </label>
                <input
                  id="nrs-opening"
                  type="number"
                  step="0.01"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  required
                  placeholder="0.00"
                  className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                />
              </div>
              <div>
                <label htmlFor="nrs-closing" className="block text-sm font-medium text-gray-700 mb-1">
                  Closing balance ($)
                </label>
                <input
                  id="nrs-closing"
                  type="number"
                  step="0.01"
                  value={closingBalance}
                  onChange={(e) => setClosingBalance(e.target.value)}
                  required
                  placeholder="0.00"
                  className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                />
              </div>
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
                disabled={submitting}
                className="bg-lions-blue text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                {submitting ? "Creating…" : "Create session"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
