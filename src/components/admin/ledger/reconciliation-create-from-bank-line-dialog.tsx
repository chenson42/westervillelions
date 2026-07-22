"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { BankLineWithMatch } from "@/lib/reconciliation-queries";
import type { LedgerFund, LedgerCategory } from "@/lib/db/schema";

const METHOD_LABELS: Record<string, string> = {
  check: "Check",
  cash: "Cash",
  zeffy: "Zeffy",
  debit_card: "Debit Card",
  bill_pay: "Bill Pay",
  other: "Other",
};

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface ReconciliationCreateFromBankLineDialogProps {
  sessionId: string;
  bankLine: BankLineWithMatch;
  funds: LedgerFund[];
  categories: LedgerCategory[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * One-click create-transaction-from-bank-line shortcut (bank fees, interest,
 * missed entries). Date and amount are ALWAYS server-derived from the bank
 * line — never client-editable here — so the new row can never disagree
 * with the statement line it's clearing against.
 *
 * Deposit-slip pre-fill rule (resolves inc1's Phase 6 forward note,
 * DECISION-036): checkNumber pre-fills from the bank line's Check or Slip #
 * ONLY when the line is a debit (negative amountCents). A credit/deposit
 * line's value is a deposit-slip number, not a check number, and is never
 * copied in automatically — the admin can still type one manually.
 */
export default function ReconciliationCreateFromBankLineDialog({
  sessionId,
  bankLine,
  funds,
  categories,
  open,
  onOpenChange,
}: ReconciliationCreateFromBankLineDialogProps) {
  const router = useRouter();
  const isDebit = bankLine.amountCents < 0;

  const [flow, setFlow] = useState<"income" | "expense">(isDebit ? "expense" : "income");
  const [fundId, setFundId] = useState(funds[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [party, setParty] = useState(bankLine.description);
  const [memo, setMemo] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [checkNumber, setCheckNumber] = useState(
    isDebit ? bankLine.checkOrSlipNumber ?? "" : ""
  );
  const [submitting, setSubmitting] = useState(false);

  // Reset every field whenever a different bank line is opened (or this one
  // re-opened) so stale values from a prior line never leak in.
  useEffect(() => {
    if (open) {
      setFlow(isDebit ? "expense" : "income");
      setFundId(funds[0]?.id ?? "");
      setCategoryId("");
      setParty(bankLine.description);
      setMemo("");
      setPaymentMethod("");
      setCheckNumber(isDebit ? bankLine.checkOrSlipNumber ?? "" : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bankLine.id]);

  const activeFund = funds.find((f) => f.id === fundId);
  const filteredCategories = categories.filter(
    (c) => (!activeFund || c.fundKind === activeFund.kind) && c.flow === flow
  );

  // Reset category if it no longer belongs to the selected fund/flow —
  // mirrors transaction-form.tsx's equivalent effect.
  useEffect(() => {
    if (categoryId && !filteredCategories.find((c) => c.id === categoryId)) {
      setCategoryId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundId, flow]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fundId) {
      toast.error("Select a fund.");
      return;
    }
    if (flow === "income" && !party.trim()) {
      toast.error("Payer (party) is required for income transactions.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/admin/ledger/reconciliation/sessions/${sessionId}/create-from-bank-line`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bankLineId: bankLine.id,
            fundId,
            categoryId: categoryId || undefined,
            party: party.trim() || undefined,
            memo: memo.trim() || undefined,
            flow,
            paymentMethod: paymentMethod || undefined,
            checkNumber: checkNumber.trim() || null,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to create the transaction.");
      }
      toast.success("Transaction created and matched.");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not create the transaction. Try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg max-h-[90vh] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl overflow-y-auto data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <Dialog.Title className="text-lg font-semibold text-gray-900">
            Create transaction from bank line
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-500">
            {formatDate(bankLine.postingDate)} &middot; {bankLine.description} &middot;{" "}
            <span className="font-semibold tabular-nums">
              {formatDollars(bankLine.amountCents)}
            </span>
            . Date and amount come from the statement and can&rsquo;t be changed here.
          </Dialog.Description>

          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <div className="grid grid-cols-2 gap-2">
                {(["income", "expense"] as const).map((mode) => (
                  <label
                    key={mode}
                    className={`flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium cursor-pointer transition select-none ${
                      flow === mode
                        ? "border-lions-blue bg-lions-blue/5 text-lions-blue"
                        : "border-gray-200 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="cfbl-flow"
                      value={mode}
                      checked={flow === mode}
                      onChange={() => setFlow(mode)}
                      className="sr-only"
                    />
                    {mode === "income" ? "Income" : "Expense"}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="cfbl-fund" className="block text-sm font-medium text-gray-700 mb-1">
                Fund
              </label>
              <select
                id="cfbl-fund"
                value={fundId}
                onChange={(e) => setFundId(e.target.value)}
                required
                className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              >
                {funds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="cfbl-category" className="block text-sm font-medium text-gray-700 mb-1">
                Category <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <select
                id="cfbl-category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              >
                <option value="">Select category...</option>
                {filteredCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="cfbl-party" className="block text-sm font-medium text-gray-700 mb-1">
                {flow === "income" ? (
                  <>
                    Payer <span className="text-gray-400 font-normal text-xs">(required)</span>
                  </>
                ) : (
                  <>
                    Payee <span className="text-gray-400 font-normal text-xs">(optional)</span>
                  </>
                )}
              </label>
              <input
                id="cfbl-party"
                type="text"
                value={party}
                onChange={(e) => setParty(e.target.value)}
                required={flow === "income"}
                maxLength={200}
                className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              />
            </div>

            <div>
              <label htmlFor="cfbl-memo" className="block text-sm font-medium text-gray-700 mb-1">
                Memo <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="cfbl-memo"
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                maxLength={500}
                className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              />
            </div>

            <div>
              <label htmlFor="cfbl-method" className="block text-sm font-medium text-gray-700 mb-1">
                Payment Method <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <select
                id="cfbl-method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              >
                <option value="">Not specified</option>
                {Object.entries(METHOD_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="cfbl-check-number" className="block text-sm font-medium text-gray-700 mb-1">
                Check # <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="cfbl-check-number"
                type="text"
                value={checkNumber}
                onChange={(e) => setCheckNumber(e.target.value)}
                maxLength={20}
                className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              />
              {!isDebit && bankLine.checkOrSlipNumber && (
                <p className="mt-1 text-xs text-gray-400">
                  This line&rsquo;s statement value (&ldquo;{bankLine.checkOrSlipNumber}&rdquo;) is a deposit
                  slip number, not a check number — it isn&rsquo;t pre-filled here.
                </p>
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
                type="submit"
                disabled={submitting}
                className="bg-lions-blue text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                {submitting ? "Saving…" : "Create & Match"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
