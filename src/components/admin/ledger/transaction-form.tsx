"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import ReceiptFileInput from "./receipt-file-input";
import type { LedgerFund, LedgerCategory, LedgerBankAccount, LedgerTransaction } from "@/lib/db/schema";

// Convenience type for a partial transaction used when editing
type EditableTransaction = Pick<
  LedgerTransaction,
  | "id"
  | "flow"
  | "amountCents"
  | "txnDate"
  | "categoryId"
  | "party"
  | "memo"
  | "paymentMethod"
  | "checkNumber"
  | "bankAccountId"
  | "fundId"
  | "transferGroupId"
  | "receiptStorageKey"
  | "receiptWaivedAt"
  | "receiptWaiverReason"
  | "publicNote"
>;

interface TransactionFormProps {
  entityId: string;
  funds: LedgerFund[];
  categories: LedgerCategory[];
  bankAccounts: LedgerBankAccount[];
  onSuccess: () => void;
  onCancel: () => void;
  /** When provided, form is in edit mode. For a transfer edit, pass the debit row. */
  initialValues?: EditableTransaction;
  /** The linked row ID when editing a transfer pair */
  transferPartnerId?: string;
}

type FlowMode = "income" | "expense" | "transfer" | "income_refund" | "expense_refund";

const FLOW_LABELS: Record<FlowMode, string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer (between funds)",
  income_refund: "Income (Refund)",
  expense_refund: "Expense (Refund)",
};

const METHOD_LABELS: Record<string, string> = {
  check: "Check",
  cash: "Cash",
  zeffy: "Zeffy",
  debit_card: "Debit Card",
  bill_pay: "Bill Pay",
  other: "Other",
};

function centsToDisplay(cents: number): string {
  return (Math.abs(cents) / 100).toFixed(2);
}

function parseDollars(value: string): number | null {
  const n = parseFloat(value.replace(/[$,]/g, "").trim());
  if (isNaN(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function resolveApiFlow(mode: FlowMode): "income" | "expense" {
  if (mode === "income" || mode === "income_refund") return "income";
  return "expense";
}

/**
 * Form for recording or editing a ledger transaction.
 *
 * Handles three code paths:
 *   1. Regular income/expense (and refund convenience labels)
 *   2. New transfer (two-row atomic insert via transfer:true body)
 *   3. Edit existing (PATCH /api/admin/ledger/transactions/[id])
 *      - transfer rows use ?both=true for symmetric updates
 *
 * Amounts are entered in dollars and converted to cents on submit.
 * The server returns derivedFiscalYear so we can display the correct FY in the toast.
 */
export default function TransactionForm({
  entityId,
  funds,
  categories,
  bankAccounts,
  onSuccess,
  onCancel,
  initialValues,
  transferPartnerId,
}: TransactionFormProps) {
  const router = useRouter();
  const isEdit = Boolean(initialValues);
  const isEditingTransfer = isEdit && Boolean(initialValues?.transferGroupId);

  // Derive initial flow mode for edit
  function initFlowMode(): FlowMode {
    if (!initialValues) return "income";
    if (initialValues.transferGroupId) return "transfer";
    return initialValues.flow as "income" | "expense";
  }

  const [flowMode, setFlowMode] = useState<FlowMode>(initFlowMode);
  const [amount, setAmount] = useState(
    initialValues ? centsToDisplay(initialValues.amountCents) : ""
  );
  const [txnDate, setTxnDate] = useState(
    initialValues?.txnDate ?? new Date().toISOString().slice(0, 10)
  );
  const [fundId, setFundId] = useState(initialValues?.fundId ?? (funds[0]?.id ?? ""));
  const [sourceFundId, setSourceFundId] = useState(
    isEditingTransfer ? (initialValues?.fundId ?? "") : ""
  );
  const [destFundId, setDestFundId] = useState(
    isEditingTransfer && transferPartnerId ? "" : ""
  );
  const [categoryId, setCategoryId] = useState(initialValues?.categoryId ?? "");
  const [party, setParty] = useState(initialValues?.party ?? "");
  const [memo, setMemo] = useState(initialValues?.memo ?? "");
  const [paymentMethod, setPaymentMethod] = useState(initialValues?.paymentMethod ?? "check");
  const [checkNumber, setCheckNumber] = useState(initialValues?.checkNumber ?? "");
  const [bankAccountId, setBankAccountId] = useState(initialValues?.bankAccountId ?? "");
  const [beneficiaryCause, setBeneficiaryCause] = useState("");
  const [publicNote, setPublicNote] = useState(initialValues?.publicNote ?? "");
  const [submitting, setSubmitting] = useState(false);

  // Receipt (expense-only, DECISION-035) —
  //   existingReceiptKey: the key already saved on this row (edit mode only)
  //   replacingReceipt: user chose "Replace" — show the file input even though
  //     existingReceiptKey is still set (until the form is actually saved)
  //   pendingReceipt: a freshly uploaded file, ready to attach/replace on save
  //   removeReceipt: user chose "Remove" — clears the key on save
  const [existingReceiptKey] = useState<string | null>(initialValues?.receiptStorageKey ?? null);
  const [replacingReceipt, setReplacingReceipt] = useState(false);
  const [pendingReceipt, setPendingReceipt] = useState<{ key: string; displayName: string } | null>(null);
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [removeReceiptConfirmOpen, setRemoveReceiptConfirmOpen] = useState(false);

  const isTransfer = flowMode === "transfer";
  const apiFlow = isTransfer ? "income" : resolveApiFlow(flowMode);
  // Receipts only ever apply to expense transactions, never transfers
  // (transfer rows always resolve apiFlow to "income" above) or income rows.
  const showReceiptSection = !isTransfer && !isEditingTransfer && apiFlow === "expense";
  // Public note (Impact Gift Public Note) — independent conditional from
  // beneficiaryCause's create-only gate (`!isEdit`). This field's entire
  // purpose is annotating already-existing transactions, so it must render
  // on edit too, not just create.
  const showPublicNoteSection = !isTransfer && !isEditingTransfer && apiFlow === "expense";

  // The effective fund kind for category filtering
  const activeFundId = isTransfer ? destFundId : fundId;
  const activeFund = funds.find((f) => f.id === activeFundId);

  // Filter categories by active fund kind and api flow
  const filteredCategories = categories.filter(
    (c) =>
      (!activeFund || c.fundKind === activeFund.kind) &&
      (isTransfer ? false : c.flow === apiFlow)
  );

  // Reset category if it no longer belongs to the selected fund/flow
  useEffect(() => {
    if (categoryId && !filteredCategories.find((c) => c.id === categoryId)) {
      setCategoryId("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundId, flowMode, destFundId]);

  // Prepopulate memo hint for refunds
  useEffect(() => {
    if (flowMode === "income_refund" && !memo) {
      setMemo("Refund of ");
    } else if (flowMode === "expense_refund" && !memo) {
      setMemo("Refund of ");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowMode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountCents = parseDollars(amount);
    if (amountCents === null) {
      toast.error("Enter a valid positive amount.");
      return;
    }
    if (amountCents > 2_147_483_647) {
      toast.error("Amount exceeds the maximum allowed ($21,474,836.47).");
      return;
    }

    if (isTransfer && !isEdit) {
      // New transfer path
      if (!sourceFundId || !destFundId) {
        toast.error("Select both source and destination funds.");
        return;
      }
      if (sourceFundId === destFundId) {
        toast.error("Source and destination funds must be different.");
        return;
      }
    } else if (!isTransfer && apiFlow === "income" && !party.trim()) {
      toast.error("Payer (party) is required for income transactions.");
      return;
    }

    setSubmitting(true);
    try {
      let url: string;
      let method: string;
      let body: Record<string, unknown>;

      if (isEdit) {
        // Edit path
        url = `/api/admin/ledger/transactions/${initialValues!.id}`;
        if (isEditingTransfer) {
          url += "?both=true";
        }
        method = "PATCH";
        body = {
          amountCents,
          txnDate,
          memo: memo || null,
          bankAccountId: bankAccountId || null,
          ...(isEditingTransfer
            ? {}
            : {
                categoryId: categoryId || null,
                party: party || null,
                paymentMethod: paymentMethod || null,
                checkNumber: checkNumber || null,
                flow: apiFlow,
              }),
          // Public note (Impact Gift Public Note): only sent when the
          // expense-only section is showing — omit entirely for transfers/
          // income so the field is never touched outside its own conditional.
          ...(showPublicNoteSection ? { publicNote: publicNote.trim() || null } : {}),
          // Receipt (DECISION-035): null removes (Flow D — does NOT waive);
          // a fresh key attaches/replaces (Flow B/C) and the server clears
          // any existing waiver in the same update. Omit entirely when the
          // receipt state hasn't changed this edit.
          ...(showReceiptSection && removeReceipt
            ? { receiptStorageKey: null }
            : showReceiptSection && pendingReceipt
              ? { receiptStorageKey: pendingReceipt.key }
              : {}),
        };
      } else if (isTransfer) {
        // New transfer path
        url = "/api/admin/ledger/transactions";
        method = "POST";
        body = {
          transfer: true,
          entityId,
          sourceFundId,
          destFundId,
          txnDate,
          amountCents,
          memo: memo || null,
          bankAccountId: bankAccountId || null,
        };
      } else {
        // New regular transaction
        url = "/api/admin/ledger/transactions";
        method = "POST";
        body = {
          entityId,
          fundId,
          txnDate,
          flow: apiFlow,
          amountCents,
          categoryId: categoryId || null,
          party: party || null,
          memo: memo || null,
          paymentMethod: paymentMethod || null,
          checkNumber: checkNumber || null,
          bankAccountId: bankAccountId || null,
          beneficiaryCause: beneficiaryCause.trim() || null,
          publicNote: publicNote.trim() || null,
          // Receipt (DECISION-035): the opaque key already minted by
          // ReceiptFileInput's upload-on-select flow, if the admin attached
          // one before saving (Flow A). Omitted entirely when none was
          // picked — the transaction save is never blocked by a receipt.
          ...(showReceiptSection && pendingReceipt
            ? { receiptStorageKey: pendingReceipt.key }
            : {}),
        };
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to ${isEdit ? "update" : "record"} transaction.`);
      }

      const data = await res.json();
      const fyNote = data.derivedFiscalYear ? ` (FY${data.derivedFiscalYear})` : "";
      if (!isEdit && data.status === "pending") {
        toast.success(`Disbursement submitted${fyNote} — awaiting board approval.`);
      } else {
        toast.success(isEdit ? "Transaction updated." : `Transaction recorded${fyNote}.`);
      }
      router.refresh();
      onSuccess();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save transaction. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Flow mode selector — hidden for transfer edit (can't change flow on a transfer row) */}
      {!isEditingTransfer && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Type
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {(Object.keys(FLOW_LABELS) as FlowMode[]).map((mode) => (
              <label
                key={mode}
                className={`flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium cursor-pointer transition select-none ${
                  flowMode === mode
                    ? "border-lions-blue bg-lions-blue/5 text-lions-blue"
                    : "border-gray-200 text-gray-700 hover:bg-gray-50"
                }`}
              >
                <input
                  type="radio"
                  name="flow-mode"
                  value={mode}
                  checked={flowMode === mode}
                  onChange={() => setFlowMode(mode)}
                  className="sr-only"
                />
                {FLOW_LABELS[mode]}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Transfer: source + dest fund pickers */}
      {isTransfer && !isEdit && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="txn-source-fund" className="block text-sm font-medium text-gray-700 mb-1">
              From Fund
            </label>
            <select
              id="txn-source-fund"
              value={sourceFundId}
              onChange={(e) => setSourceFundId(e.target.value)}
              required
              className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            >
              <option value="">Select fund...</option>
              {funds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="txn-dest-fund" className="block text-sm font-medium text-gray-700 mb-1">
              To Fund
            </label>
            <select
              id="txn-dest-fund"
              value={destFundId}
              onChange={(e) => setDestFundId(e.target.value)}
              required
              className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            >
              <option value="">Select fund...</option>
              {funds
                .filter((f) => f.id !== sourceFundId)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}

      {/* Regular: fund picker */}
      {!isTransfer && !isEdit && (
        <div>
          <label htmlFor="txn-fund" className="block text-sm font-medium text-gray-700 mb-1">
            Fund
          </label>
          <select
            id="txn-fund"
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
      )}

      {/* Amount */}
      <div>
        <label htmlFor="txn-amount" className="block text-sm font-medium text-gray-700 mb-1">
          Amount ($)
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm select-none">
            $
          </span>
          <input
            id="txn-amount"
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className="block w-full rounded-lg border border-gray-300 py-2 pl-7 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            placeholder="0.00"
          />
        </div>
      </div>

      {/* Date */}
      <div>
        <label htmlFor="txn-date" className="block text-sm font-medium text-gray-700 mb-1">
          Date
        </label>
        <input
          id="txn-date"
          type="date"
          value={txnDate}
          onChange={(e) => setTxnDate(e.target.value)}
          required
          className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
        />
      </div>

      {/* Category (not for transfers) */}
      {!isTransfer && !isEditingTransfer && (
        <div>
          <label htmlFor="txn-category" className="block text-sm font-medium text-gray-700 mb-1">
            Category <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <select
            id="txn-category"
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
      )}

      {/* Party (not for transfers) */}
      {!isTransfer && !isEditingTransfer && (
        <div>
          <label htmlFor="txn-party" className="block text-sm font-medium text-gray-700 mb-1">
            {apiFlow === "income" ? (
              <>Payer <span className="text-gray-400 font-normal text-xs">(required for income)</span></>
            ) : (
              <>Payee <span className="text-gray-400 font-normal text-xs">(optional)</span></>
            )}
          </label>
          <input
            id="txn-party"
            type="text"
            value={party}
            onChange={(e) => setParty(e.target.value)}
            required={apiFlow === "income"}
            maxLength={200}
            className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            placeholder={apiFlow === "income" ? "Name of payer / source" : "Name of payee (optional)"}
          />
        </div>
      )}

      {/* Check # (not for transfers) */}
      {!isTransfer && !isEditingTransfer && (
        <div>
          <label htmlFor="txn-check-number" className="block text-sm font-medium text-gray-700 mb-1">
            Check # <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="txn-check-number"
            type="text"
            value={checkNumber}
            onChange={(e) => setCheckNumber(e.target.value)}
            maxLength={20}
            className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            placeholder="e.g., 8249"
          />
        </div>
      )}

      {/* Memo */}
      <div>
        <label htmlFor="txn-memo" className="block text-sm font-medium text-gray-700 mb-1">
          Memo <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          id="txn-memo"
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          maxLength={500}
          className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
          placeholder="Transaction reference, notes, etc."
        />
      </div>

      {/* Beneficiary cause — optional, only for new non-transfer expenses */}
      {!isTransfer && !isEdit && apiFlow === "expense" && (
        <div>
          <label htmlFor="txn-cause" className="block text-sm font-medium text-gray-700 mb-1">
            Beneficiary cause <span className="text-gray-400 font-normal text-xs">(optional)</span>
          </label>
          <input
            id="txn-cause"
            type="text"
            value={beneficiaryCause}
            onChange={(e) => setBeneficiaryCause(e.target.value)}
            maxLength={200}
            className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            placeholder="e.g., Rudolph Run, Vision Care Fund"
          />
        </div>
      )}

      {/* Public note — treasurer-curated, member-facing annotation shown on
          /members/impact. Independent conditional from beneficiaryCause above:
          this one renders on EDIT too (not create-only), since its whole
          purpose is annotating already-existing transactions. */}
      {showPublicNoteSection && (
        <div>
          <label htmlFor="txn-public-note" className="block text-sm font-medium text-gray-700 mb-1">
            Public note <span className="text-gray-400 font-normal text-xs">(optional, shown to members)</span>
          </label>
          <input
            id="txn-public-note"
            type="text"
            value={publicNote}
            onChange={(e) => setPublicNote(e.target.value)}
            maxLength={200}
            className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            placeholder="Brief public-facing context, e.g. 'Sponsored Westerville Autumn Arborfest 2026'"
          />
        </div>
      )}

      {/* Receipt — expense transactions only (DECISION-035) */}
      {showReceiptSection && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Receipt <span className="text-gray-400 font-normal">(optional)</span>
          </label>

          {removeReceipt ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
              <span>Receipt will be removed when you save.</span>
              <button
                type="button"
                onClick={() => setRemoveReceipt(false)}
                className="text-xs font-semibold text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-0.5"
              >
                Undo
              </button>
            </div>
          ) : pendingReceipt ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              <span className="truncate">✓ {pendingReceipt.displayName} ready to attach</span>
              <button
                type="button"
                onClick={() => setPendingReceipt(null)}
                className="text-xs font-semibold text-green-800 hover:text-green-900 transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-0.5 whitespace-nowrap"
              >
                Cancel
              </button>
            </div>
          ) : existingReceiptKey && !replacingReceipt ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <a
                href={`/api/admin/ledger/transactions/${initialValues!.id}/receipt`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-lions-blue hover:text-lions-blue-dark font-semibold transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
              >
                View receipt
              </a>
              <button
                type="button"
                onClick={() => setReplacingReceipt(true)}
                className="text-gray-600 hover:text-lions-blue transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-0.5"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={() => setRemoveReceiptConfirmOpen(true)}
                className="text-gray-500 hover:text-red-600 transition focus:outline-none focus:ring-2 focus:ring-gray-300 rounded px-1 py-0.5"
              >
                Remove
              </button>
            </div>
          ) : (
            <>
              {!existingReceiptKey && initialValues?.receiptWaivedAt && (
                <p className="mb-2 text-xs text-gray-500">
                  Receipt requirement waived: &ldquo;{initialValues.receiptWaiverReason}&rdquo;.
                  Attaching a receipt here will clear the waiver.
                </p>
              )}
              <ReceiptFileInput
                idSuffix={isEdit ? `-${initialValues!.id}` : "-new"}
                onUploaded={(result) => setPendingReceipt(result)}
                onCancel={existingReceiptKey ? () => setReplacingReceipt(false) : undefined}
              />
            </>
          )}

          <ConfirmDialog
            open={removeReceiptConfirmOpen}
            onOpenChange={setRemoveReceiptConfirmOpen}
            title="Remove receipt?"
            description="This transaction will go back to showing as missing a receipt in compliance checks. You can attach a new one at any time, or waive the requirement instead."
            confirmLabel="Remove"
            destructive
            onConfirm={() => {
              setRemoveReceipt(true);
              setRemoveReceiptConfirmOpen(false);
            }}
          />
        </div>
      )}

      {/* Payment method (not for transfers) */}
      {!isTransfer && !isEditingTransfer && (
        <div>
          <label htmlFor="txn-method" className="block text-sm font-medium text-gray-700 mb-1">
            Payment Method <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <select
            id="txn-method"
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
      )}

      {/* Bank account (optional) */}
      {bankAccounts.length > 0 && (
        <div>
          <label htmlFor="txn-bank" className="block text-sm font-medium text-gray-700 mb-1">
            Bank Account <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <select
            id="txn-bank"
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
          >
            <option value="">Not specified</option>
            {bankAccounts.map((acct) => (
              <option key={acct.id} value={acct.id}>
                {acct.name} {acct.last4 ? `(…${acct.last4})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="bg-lions-blue text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
        >
          {submitting
            ? "Saving..."
            : isEdit
              ? "Update Transaction"
              : isTransfer
                ? "Record Transfer"
                : "Record Transaction"}
        </button>
      </div>
    </form>
  );
}
