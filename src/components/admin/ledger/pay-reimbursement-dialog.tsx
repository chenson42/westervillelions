"use client";

import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { LedgerFund, LedgerCategory } from "@/lib/db/schema";
import type { BudgetLineOption } from "@/lib/ledger-queries";
import BudgetLinePicker from "./budget-line-picker";
import { getFiscalYear } from "@/lib/fiscal-year";

interface PayReimbursementDialogProps {
  reimbursementId: string;
  memberName: string;
  amount: string;
  funds: LedgerFund[];
  /** Expense-flow categories across every entity — filtered client-side to
   *  the selected fund's (entityId, kind) pair. */
  categories: LedgerCategory[];
  /** Every expense-flow budget line across every entity (B-30, DECISION-061). */
  budgetLines: BudgetLineOption[];
  children: React.ReactNode;
}

const METHOD_LABELS: Record<string, string> = {
  check: "Check",
  cash: "Cash",
  other: "Other",
};

/**
 * Collects a fund (required — treasurer assigns per R-3), payment date, and
 * payment method, then sends the pay action to
 * PATCH /api/admin/ledger/reimbursements/[id] with action='pay'.
 *
 * The server creates the expense transaction from this data.
 */
export default function PayReimbursementDialog({
  reimbursementId,
  memberName,
  amount,
  funds,
  categories,
  budgetLines,
  children,
}: PayReimbursementDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fundId, setFundId] = useState(funds[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [budgetLineId, setBudgetLineId] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState("check");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedFund = funds.find((f) => f.id === fundId);
  // categoryId is REQUIRED (B-30, DECISION-061) — closes the permanent blind
  // spot where a paid reimbursement's transaction was born with no category
  // and no way to link a budget line.
  const filteredCategories = categories.filter(
    (c) => selectedFund && c.entityId === selectedFund.entityId && c.fundKind === selectedFund.kind,
  );

  // Reset category (and any budget-line link) when the fund changes and the
  // current category no longer belongs to it — mirrors transaction-form.tsx's
  // identical fund/category-reset effect.
  useEffect(() => {
    if (categoryId && !filteredCategories.find((c) => c.id === categoryId)) {
      setCategoryId("");
      setBudgetLineId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundId]);

  // Same client-side mirror as transaction-form.tsx's identical effect: drop
  // a selected budget line if a payment-date edit moves its FY out of range.
  useEffect(() => {
    if (!budgetLineId) return;
    const line = budgetLines.find((l) => l.id === budgetLineId);
    if (!line) {
      setBudgetLineId("");
      return;
    }
    const parsed = new Date(paymentDate + "T00:00:00");
    if (isNaN(parsed.getTime())) return;
    if (line.fiscalYear !== getFiscalYear(parsed)) {
      setBudgetLineId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentDate]);

  async function handlePay() {
    if (!fundId) {
      toast.error("Select a fund before marking this reimbursement paid.");
      return;
    }
    if (!categoryId) {
      toast.error("Select a category before marking this reimbursement paid.");
      return;
    }
    if (!paymentDate) {
      toast.error("A payment date is required.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/ledger/reimbursements/${reimbursementId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "pay",
          fundId,
          categoryId,
          budgetLineId: budgetLineId || null,
          paymentDate,
          paymentMethod,
          note: note.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to mark reimbursement paid.");
      }

      toast.success("Reimbursement marked paid. Expense transaction posted to ledger.");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not mark reimbursement paid. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <Dialog.Title className="text-lg font-semibold text-gray-900">
            Mark Reimbursement Paid
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-500">
            {memberName} — {amount}. Assign a fund and confirm payment to post the expense.
          </Dialog.Description>

          <div className="mt-4 space-y-4">
            {/* Fund picker — required; treasurer assigns (R-3) */}
            <div>
              <label htmlFor="pay-fund" className="block text-sm font-medium text-gray-700 mb-1">
                Fund <span className="text-gray-400 font-normal text-xs">(required)</span>
              </label>
              <select
                id="pay-fund"
                value={fundId}
                onChange={(e) => setFundId(e.target.value)}
                required
                className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              >
                <option value="">Select fund…</option>
                {funds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.kind})
                  </option>
                ))}
              </select>
            </div>

            {/* Category picker — required (B-30, DECISION-061). Reimbursement
                mark-paid used to create a categoryless, cause-less
                transaction, permanently invisible to every budget-vs-actual
                view; category is now a mandatory field alongside fund/date/
                method. */}
            <div>
              <label htmlFor="pay-category" className="block text-sm font-medium text-gray-700 mb-1">
                Category <span className="text-gray-400 font-normal text-xs">(required)</span>
              </label>
              <select
                id="pay-category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                required
                disabled={!fundId}
                className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
              >
                <option value="">{fundId ? "Select category…" : "Select a fund first"}</option>
                {filteredCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Applies to budget line — optional (B-30, DECISION-061), same
                shared picker the main transaction form uses. */}
            {fundId && categoryId && (
              <BudgetLinePicker
                id="pay-budget-line"
                budgetLines={budgetLines.filter((l) => l.categoryId === categoryId)}
                fundId={fundId}
                txnDate={paymentDate}
                value={budgetLineId}
                onSelect={(line) => setBudgetLineId(line?.id ?? "")}
              />
            )}

            {/* Payment date */}
            <div>
              <label htmlFor="pay-date" className="block text-sm font-medium text-gray-700 mb-1">
                Payment date
              </label>
              <input
                id="pay-date"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                required
                className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              />
            </div>

            {/* Payment method */}
            <div>
              <label htmlFor="pay-method" className="block text-sm font-medium text-gray-700 mb-1">
                Payment method
              </label>
              <select
                id="pay-method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              >
                {Object.entries(METHOD_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {/* Optional note */}
            <div>
              <label htmlFor="pay-note" className="block text-sm font-medium text-gray-700 mb-1">
                Note <span className="text-gray-400 font-normal text-xs">(optional)</span>
              </label>
              <input
                id="pay-note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                placeholder="Check number, reference, etc."
                className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <Dialog.Close className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
              Cancel
            </Dialog.Close>
            <button
              type="button"
              onClick={handlePay}
              disabled={submitting || !fundId || !categoryId}
              className="bg-lions-blue text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              {submitting ? "Posting…" : "Mark Paid"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
