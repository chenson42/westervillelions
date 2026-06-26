"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { PaymentRow } from "@/lib/dues-queries";

interface DuesPaymentFormProps {
  memberId: string;
  fiscalYear: number;
  /** When provided, the form is in edit mode for this payment */
  payment?: PaymentRow;
  onClose: () => void;
}

const METHOD_LABELS: Record<string, string> = {
  check: "Check",
  cash: "Cash",
  zeffy: "Zeffy",
  other: "Other",
};

function centsToDisplay(cents: number): string {
  return (Math.abs(cents) / 100).toFixed(2);
}

function parseDollarsInput(value: string, isRefund: boolean): number | null {
  const n = parseFloat(value.replace(/[$,]/g, "").trim());
  if (isNaN(n) || n === 0) return null;
  if (n < 0) return null; // sign controlled by isRefund toggle
  const cents = Math.round(n * 100);
  return isRefund ? -cents : cents;
}

/**
 * Add or edit a dues payment for a member.
 * Renders inline — the parent wraps it in a modal/panel.
 */
export default function DuesPaymentForm({
  memberId,
  fiscalYear,
  payment,
  onClose,
}: DuesPaymentFormProps) {
  const isEdit = Boolean(payment);
  const isExistingRefund = payment ? payment.amountCents < 0 : false;

  const [amount, setAmount] = useState(payment ? centsToDisplay(payment.amountCents) : "");
  const [isRefund, setIsRefund] = useState(isExistingRefund);
  const [method, setMethod] = useState(payment?.method ?? "check");
  const [paymentDate, setPaymentDate] = useState(
    payment?.paymentDate ?? new Date().toISOString().slice(0, 10)
  );
  const [notes, setNotes] = useState(payment?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountCents = parseDollarsInput(amount, isRefund);
    if (amountCents === null) {
      toast.error("Enter a valid amount (non-zero dollar value).");
      return;
    }

    setSubmitting(true);
    try {
      const url = isEdit
        ? `/api/admin/dues/${memberId}/${payment!.id}`
        : `/api/admin/dues/${memberId}`;
      const method_ = isEdit ? "PATCH" : "POST";
      const body = isEdit
        ? { amountCents, method, paymentDate, notes: notes || undefined }
        : { fiscalYear, amountCents, method, paymentDate, notes: notes || undefined };

      const res = await fetch(url, {
        method: method_,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to ${isEdit ? "update" : "record"} payment.`);
      }

      const data = await res.json().catch(() => ({}));

      if (!isEdit && data.syncFailed) {
        toast.warning("Payment saved, but the ledger auto-post failed — record the income manually in the Ledger.");
      } else if (isEdit && data.syncStale) {
        toast.info("Saved. The linked ledger entry was reconciled, so it's flagged out-of-sync for the treasurer to reconcile.");
      } else {
        toast.success(isEdit ? "Payment updated." : "Payment recorded.");
      }

      router.refresh();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save payment. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Amount + refund toggle */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor="payment-amount" className="block text-sm font-medium text-gray-700">
            Amount ($)
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isRefund}
              onChange={(e) => setIsRefund(e.target.checked)}
              className="rounded border-gray-300 text-lions-blue focus:ring-lions-blue"
            />
            Refund / reversal
          </label>
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
            {isRefund ? "-$" : "$"}
          </span>
          <input
            id="payment-amount"
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className={`block w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 ${
              isRefund
                ? "border-orange-300 focus:border-orange-400 focus:ring-orange-400 bg-orange-50 text-orange-700"
                : "border-gray-300 focus:border-lions-blue focus:ring-lions-blue"
            }`}
            placeholder="0.00"
          />
        </div>
        {isRefund && (
          <p className="mt-1 text-xs text-orange-600">
            This will be saved as a negative amount (refund/reversal).
          </p>
        )}
      </div>

      {/* Payment method */}
      <div>
        <label htmlFor="payment-method" className="block text-sm font-medium text-gray-700 mb-1">
          Payment Method
        </label>
        <select
          id="payment-method"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          required
          className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
        >
          {Object.entries(METHOD_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Payment date */}
      <div>
        <label htmlFor="payment-date" className="block text-sm font-medium text-gray-700 mb-1">
          Payment Date
        </label>
        <input
          id="payment-date"
          type="date"
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
          required
          className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
        />
      </div>

      {/* Notes */}
      <div>
        <label htmlFor="payment-notes" className="block text-sm font-medium text-gray-700 mb-1">
          Notes <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <textarea
          id="payment-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={500}
          className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue resize-none"
          placeholder="Check number, Zeffy transaction ID, etc."
        />
      </div>

      <div className="flex justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="bg-lions-blue text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
        >
          {submitting ? "Saving..." : isEdit ? "Update Payment" : "Record Payment"}
        </button>
      </div>
    </form>
  );
}
