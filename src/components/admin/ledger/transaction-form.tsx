"use client";

import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import ReceiptFileInput from "./receipt-file-input";
import BudgetLinePicker from "./budget-line-picker";
import BudgetContextPanel from "./budget-context-panel";
import DonorPickerField, { type PickedDonor } from "./donor-picker-field";
import FoundationBoundHint from "./foundation-bound-hint";
import type { LedgerFund, LedgerCategory, LedgerBankAccount, LedgerTransaction } from "@/lib/db/schema";
import type { BudgetLineOption } from "@/lib/ledger-queries";
import { getFiscalYear } from "@/lib/fiscal-year";
import { CHECK_NUMBER_MAX_LEN, pickDefaultBankAccount } from "@/lib/ledger";
import { buildFundLabels } from "@/lib/ledger-fund-labels";
import { describeMirrorHint, type MirrorProjection } from "@/lib/ledger-category-mirror";

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
  | "beneficiaryCause"
  | "budgetLineId"
>;

interface TransactionFormProps {
  entityId: string;
  funds: LedgerFund[];
  categories: LedgerCategory[];
  bankAccounts: LedgerBankAccount[];
  /** Every expense-flow budget line for this entity, across every fiscal
   *  year (B-30, DECISION-061) — the picker filters to fund + derived FY
   *  client-side. */
  budgetLines: BudgetLineOption[];
  onSuccess: () => void;
  onCancel: () => void;
  /** When provided, form is in edit mode. For a transfer edit, pass the debit row. */
  initialValues?: EditableTransaction;
  /** The linked row ID when editing a transfer pair */
  transferPartnerId?: string;
  /** Default fund for a NEW transaction — e.g. the fund whose page opened the
   *  dialog. Ignored in edit mode (initialValues.fundId wins) and falls back to
   *  the first fund when absent. */
  defaultFundId?: string;
  /** Category id -> the Foundation counterpart of a Public Funds income
   *  category (B-172), computed on the server with loadMirrorProjections().
   *  Absent or empty: no "Foundation-bound" hint is shown. */
  mirrorHints?: Record<string, MirrorProjection>;
}

type FlowMode = "income" | "expense" | "transfer" | "income_refund" | "expense_refund";

const FLOW_LABELS: Record<FlowMode, string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer (Move Cash Between Accounts)",
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
 * Fund names are read from the stored fund rows (DECISION-127), never typed here.
 *
 * Handles three code paths:
 *   1. Regular income/expense (and refund convenience labels)
 *   2. New Transfer — same fund, two of the CURRENT entity's bank accounts
 *      (e.g. Admin Checking -> Petty Cash). No board minute, no category.
 *   3. Edit existing (PATCH /api/admin/ledger/transactions/[id])
 *      - transfer rows use ?both=true for symmetric amount/date/memo
 *        edits; bank account is immutable post-creation for any pair.
 *
 * A sweep to the Foundation is NOT recorded here: it is an itemized batch built
 * at /admin/ledger/sweep (B-172 Increment 2b).
 *
 * Amounts are entered in dollars and converted to cents on submit.
 * The server returns derivedFiscalYear so we can display the correct FY in the toast.
 */
export default function TransactionForm({
  entityId,
  funds,
  categories,
  bankAccounts,
  budgetLines,
  onSuccess,
  onCancel,
  initialValues,
  defaultFundId,
  mirrorHints,
}: TransactionFormProps) {
  const router = useRouter();
  const isEdit = Boolean(initialValues);
  const isEditingTransfer = isEdit && Boolean(initialValues?.transferGroupId);

  // Derive initial flow mode for edit. A row with a transferGroupId is a pair
  // leg; the Type selector is hidden for isEditingTransfer regardless
  // (amount/date/memo are the only editable fields on a pair; see the PATCH
  // bank-account-immutability fix, DECISION-058).
  function initFlowMode(): FlowMode {
    if (!initialValues) return "income";
    if (initialValues.transferGroupId) return "transfer";
    return initialValues.flow as "income" | "expense";
  }

  // Stored fund names for every user-facing sentence (DECISION-127).
  // Stored fund names for every user-facing sentence (DECISION-127).
  const labels = useMemo(() => buildFundLabels(funds), [funds]);
  const canTransfer = bankAccounts.length >= 2;

  const [flowMode, setFlowMode] = useState<FlowMode>(initFlowMode);
  const [amount, setAmount] = useState(
    initialValues ? centsToDisplay(initialValues.amountCents) : ""
  );
  const [txnDate, setTxnDate] = useState(
    initialValues?.txnDate ?? new Date().toISOString().slice(0, 10)
  );
  const [fundId, setFundId] = useState(
    initialValues?.fundId ?? defaultFundId ?? (funds[0]?.id ?? "")
  );
  const [categoryId, setCategoryId] = useState(initialValues?.categoryId ?? "");
  const [party, setParty] = useState(initialValues?.party ?? "");
  const [memo, setMemo] = useState(initialValues?.memo ?? "");
  const [paymentMethod, setPaymentMethod] = useState(initialValues?.paymentMethod ?? "check");
  const [checkNumber, setCheckNumber] = useState(initialValues?.checkNumber ?? "");
  // Default/operating account (default-bank-account bug fix): every
  // transaction must carry a bank account by construction. Pre-fill the
  // entity's default whenever there's no stored value to fall back to —
  // covers both new transactions (initialValues undefined) AND editing a
  // legacy row whose stored bankAccountId is NULL, so opening Edit on one of
  // those rows is itself a one-click fix. Also doubles as the SOURCE account
  // for a new Transfer (e.g. Admin Checking, where the cash sits).
  const defaultBankAccountId = pickDefaultBankAccount(bankAccounts)?.id ?? "";
  const [bankAccountId, setBankAccountId] = useState(
    initialValues?.bankAccountId ?? defaultBankAccountId
  );
  // Destination account for a NEW Transfer: the current entity's other account
  // (e.g. Petty Cash). Never used on edit, since bank account is immutable
  // post-creation for any pair.
  const [destBankAccountId, setDestBankAccountId] = useState("");
  const [beneficiaryCause, setBeneficiaryCause] = useState(initialValues?.beneficiaryCause ?? "");
  const [publicNote, setPublicNote] = useState(initialValues?.publicNote ?? "");
  // Explicit budget-line link (B-30, DECISION-061).
  const [budgetLineId, setBudgetLineId] = useState(initialValues?.budgetLineId ?? "");
  // Donor on a NEW Public Funds / Foundation income gift (B-172); sent as donorId.
  const [donor, setDonor] = useState<PickedDonor | null>(null);
  const [categoryMismatchNotice, setCategoryMismatchNotice] = useState<string | null>(null);
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
  // (which always resolve apiFlow to "income" above) or income rows.
  const showReceiptSection = !isTransfer && !isEditingTransfer && apiFlow === "expense";
  // Public note (Impact Gift Public Note) — independent conditional from
  // beneficiaryCause's OLD create-only gate. This field's entire purpose is
  // annotating already-existing transactions, so it must render on edit
  // too, not just create.
  const showPublicNoteSection = !isTransfer && !isEditingTransfer && apiFlow === "expense";
  // Explicit budget-line link (B-30, DECISION-061) — and the fix for the
  // found bug: beneficiaryCause is now editable on the SAME condition
  // (previously create-only, `!isEdit`, even though the PATCH API already
  // accepted edits) since the picker's edit-mode auto-fill needs to write
  // into it.
  const showBudgetLineSection = !isTransfer && !isEditingTransfer && apiFlow === "expense";

  // The effective fund kind for category filtering (regular income/expense
  // only — Transfer never show the generic category picker below).
  const activeFund = funds.find((f) => f.id === fundId);

  // Budget-context panel's projected figure (2026-08-08-budget-context-on-
  // transaction-entry, Phase 3) — reuses the form's existing parseDollars
  // parser rather than a second implementation; null while empty/zero/
  // invalid, which BudgetContextPanel treats as "suppress the projected
  // clause," never "+$0."
  const parsedAmountCents = parseDollars(amount);

  // The donor picker: new, regular income into a public or Foundation fund
  // (the kinds the server accepts a donorId for).
  const showDonorPicker =
    !isEdit &&
    !isTransfer &&
    apiFlow === "income" &&
    (activeFund?.kind === "activity" || activeFund?.kind === "charitable");

  // "Foundation-bound" hint for a Public Funds income category (B-172). The
  // form's categories belong to the current Club entity, so deductible = false.
  const selectedCategory = categories.find((c) => c.id === categoryId);
  const mirrorHint = describeMirrorHint(
    selectedCategory && !isTransfer
      ? { fundKind: selectedCategory.fundKind, flow: selectedCategory.flow, entityDonationsDeductible: false }
      : null,
    selectedCategory ? (mirrorHints?.[selectedCategory.id] ?? null) : null,
    parsedAmountCents,
  );

  // Filter categories by active fund kind and api flow
  const filteredCategories = categories.filter(
    (c) =>
      (!activeFund || c.fundKind === activeFund.kind) &&
      (isTransfer ? false : c.flow === apiFlow)
  );

  // Only offer Type options that are actually usable: Transfer requires a
  // second bank account to move cash into. Hiding an unusable mode (rather
  // than offering it and 400ing) is what keeps a wrong request from being a UI path.
  const visibleFlowModes = (Object.keys(FLOW_LABELS) as FlowMode[]).filter(
    (m) => m !== "transfer" || canTransfer
  );

  // Reset category if it no longer belongs to the selected fund/flow
  useEffect(() => {
    if (categoryId && !filteredCategories.find((c) => c.id === categoryId)) {
      setCategoryId("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundId, flowMode]);

  // Client-side mirror of the server's auto-clear (B-30, DECISION-061): if
  // the fund or date change moves the selected budget line's fund/FY out of
  // range, drop the selection here too rather than letting the picker keep
  // showing a value no longer in its own candidate list. The server is the
  // authority (this only prevents submitting a stale value the user can no
  // longer even see selected).
  useEffect(() => {
    if (!budgetLineId) return;
    const line = budgetLines.find((l) => l.id === budgetLineId);
    if (!line || line.fundId !== fundId) {
      setBudgetLineId("");
      return;
    }
    const parsed = new Date(txnDate + "T00:00:00");
    if (isNaN(parsed.getTime())) return;
    if (line.fiscalYear !== getFiscalYear(parsed)) {
      setBudgetLineId("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundId, txnDate]);

  // Prepopulate memo hint for refunds
  useEffect(() => {
    if (flowMode === "income_refund" && !memo) {
      setMemo("Refund of ");
    } else if (flowMode === "expense_refund" && !memo) {
      setMemo("Refund of ");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowMode]);

  // Default the destination account whenever the mode switches into Transfer
  // (new transactions only — bank account is immutable on edit).
  useEffect(() => {
    if (isEdit) return;
    if (flowMode === "transfer") {
      const fallback = bankAccounts.find((a) => a.id !== bankAccountId)?.id ?? "";
      setDestBankAccountId(fallback);
    } else {
      setDestBankAccountId("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowMode]);

  // Keep the Transfer "To Account" from silently colliding with a newly
  // picked "From Account".
  useEffect(() => {
    if (isTransfer && destBankAccountId === bankAccountId) {
      const fallback = bankAccounts.find((a) => a.id !== bankAccountId)?.id ?? "";
      setDestBankAccountId(fallback);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankAccountId]);

  /** All client-side validation. Returns an error message, or null if valid. */
  function validate(): string | null {
    const amountCents = parseDollars(amount);
    if (amountCents === null) return "Enter a valid positive amount.";
    if (amountCents > 2_147_483_647) return "Amount exceeds the maximum allowed ($21,474,836.47).";
    if (!bankAccountId) return "Select a bank account before saving this transaction.";

    if (!isEdit && isTransfer) {
      if (!destBankAccountId) return "Select both a source and destination bank account.";
      if (bankAccountId === destBankAccountId) {
        return "Select a different bank account, or transfer to a different fund.";
      }
    } else if (!isTransfer && apiFlow === "income" && !party.trim()) {
      return "Payer (party) is required for income transactions.";
    }
    return null;
  }

  async function performSubmit() {
    const amountCents = parseDollars(amount)!;

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
          // Bank account is immutable post-creation for any transfer
          // pair (DECISION-058) — omit it entirely for those rows rather
          // than send a value the server will silently ignore anyway.
          ...(isEditingTransfer ? {} : { bankAccountId }),
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
          // Beneficiary cause + explicit budget-line link (B-30, DECISION-061)
          // — the bug fix: beneficiaryCause is now sent on edit too (the
          // PATCH API already accepted it; the form previously never sent
          // it at all). budgetLineId omitted entirely (rather than sent as
          // null) when its own section isn't showing, so a transfer/income
          // edit never touches an existing link some OTHER edit created —
          // not reachable in practice (only expense rows ever carry a
          // link), but matches the same defensive pattern as publicNote.
          ...(showBudgetLineSection
            ? { beneficiaryCause: beneficiaryCause.trim() || null, budgetLineId: budgetLineId || null }
            : {}),
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
        // New same-fund Transfer (DECISION-058). entityId is NOT sent: the
        // server derives both legs' entities from sourceFundId/destFundId.
        url = "/api/admin/ledger/transactions";
        method = "POST";
        body = {
          transfer: true,
          sourceFundId: fundId,
          destFundId: fundId,
          sourceBankAccountId: bankAccountId,
          destBankAccountId,
          txnDate,
          amountCents,
          memo: memo || null,
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
          bankAccountId,
          beneficiaryCause: beneficiaryCause.trim() || null,
          publicNote: publicNote.trim() || null,
          budgetLineId: budgetLineId || null,
          ...(showDonorPicker && donor ? { donorId: donor.id } : {}),
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
        toast.success(`Submitted${fyNote} — awaiting board approval (over the disbursement threshold).`);
      } else {
        toast.success(isEdit ? "Transaction updated." : `Transaction recorded${fyNote}.`);
      }
      // B-30/DECISION-061: the server auto-cleared a now-stale budget-line
      // link (the edit moved the transaction's date/category out of range
      // of the line it was linked to) rather than rejecting the edit — the
      // treasurer needs to see this happened, not discover it later.
      if (data.budgetLineLinkCleared) {
        toast(
          "This transaction's budget-line link was cleared because the date or category moved it out of range — re-select it if it still applies.",
        );
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const error = validate();
    if (error) {
      toast.error(error);
      return;
    }
    void performSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Flow mode selector — hidden for transfer edit (can't change flow on a pair row) */}
      {!isEditingTransfer && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Type
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {visibleFlowModes.map((mode) => (
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

      {/* Transfer: implied same fund (only Administrative has >1 bank account
          today) — show which fund is affected as read-only context, then two
          bank-account pickers. This is the sanctioned way to fund Petty Cash. */}
      {isTransfer && !isEdit && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-600">
          Moving cash within the <span className="font-semibold">{activeFund?.name ?? "selected fund"}</span> —
          this fund&rsquo;s balance is unaffected; only the bank account holding the cash changes.
        </div>
      )}

      {/* Regular: fund picker (not for transfer, whose fund is implied) */}
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

      {/* Category (not for transfer) */}
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
          {mirrorHint.state !== "not_applicable" && <FoundationBoundHint labels={labels} hint={mirrorHint} />}
        </div>
      )}

      {/* Budget context — read-only, right after Category. Gated on the SAME
          condition as the Category select itself (NOT showBudgetLineSection,
          which is expense-only) so income transactions get context too
          (2026-08-08-budget-context-on-transaction-entry, Phase 3). */}
      {!isTransfer && !isEditingTransfer && (
        <BudgetContextPanel
          fundId={fundId}
          txnDate={txnDate}
          flow={apiFlow}
          categoryId={categoryId}
          budgetLineId={budgetLineId}
          amountCents={parsedAmountCents}
        />
      )}

      {/* Party (not for transfer) */}
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

      {/* Donor (new public/Foundation income only) */}
      {showDonorPicker && <DonorPickerField donor={donor} onChange={setDonor} disabled={submitting} />}

      {/* Check # (not for transfer) */}
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
            maxLength={CHECK_NUMBER_MAX_LEN}
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

      {/* Beneficiary cause — optional, non-transfer expenses. Editable
          in BOTH create and edit mode (B-30 bug fix — the PATCH API already
          accepted edits here; the form just never sent them). Hand-editing
          this text after picking a budget line below does NOT invalidate
          the link — only a fund/date/category change that moves the line
          out of range does (see the picker's own auto-clear notice). */}
      {showBudgetLineSection && (
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

      {/* Applies to budget line — explicit transaction<->budget-line link
          (B-30, DECISION-061). Picking a line auto-fills category + cause
          above. */}
      {showBudgetLineSection && (
        <div>
          <BudgetLinePicker
            id="txn-budget-line"
            budgetLines={budgetLines}
            fundId={fundId}
            txnDate={txnDate}
            value={budgetLineId}
            onSelect={(line) => {
              if (!line) {
                setBudgetLineId("");
                return;
              }
              setBudgetLineId(line.id);
              setBeneficiaryCause(line.cause);
              if (categoryId && categoryId !== line.categoryId) {
                setCategoryMismatchNotice(
                  `This line belongs to ${line.categoryName} — category will update.`,
                );
              } else {
                setCategoryMismatchNotice(null);
              }
              setCategoryId(line.categoryId);
            }}
          />
          {categoryMismatchNotice && (
            <p className="mt-1 text-xs text-lions-blue">{categoryMismatchNotice}</p>
          )}
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

      {/* Payment method (not for transfer) */}
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

      {/* Bank account — regular transactions & edit (transfer pairs
          hide this: bank account is immutable post-creation, and NEW
          transfer use the two per-leg pickers below instead). */}
      {bankAccounts.length > 0 && !isTransfer && (
        <div>
          <label htmlFor="txn-bank" className="block text-sm font-medium text-gray-700 mb-1">
            Bank Account
          </label>
          <select
            id="txn-bank"
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            required
            className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
          >
            {bankAccounts.map((acct) => (
              <option key={acct.id} value={acct.id}>
                {acct.name} {acct.last4 ? `(…${acct.last4})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Transfer: per-leg bank-account pickers (new only — immutable on edit) */}
      {isTransfer && !isEdit && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="txn-from-account" className="block text-sm font-medium text-gray-700 mb-1">
              From Account
            </label>
            <select
              id="txn-from-account"
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
              required
              className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            >
              {bankAccounts.map((acct) => (
                <option key={acct.id} value={acct.id}>
                  {acct.name} {acct.last4 ? `(…${acct.last4})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="txn-to-account" className="block text-sm font-medium text-gray-700 mb-1">
              To Account
            </label>
            <select
              id="txn-to-account"
              value={destBankAccountId}
              onChange={(e) => setDestBankAccountId(e.target.value)}
              required
              className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            >
              <option value="">Select account...</option>
              {bankAccounts.filter((a) => a.id !== bankAccountId).map(
                (acct) => (
                  <option key={acct.id} value={acct.id}>
                    {acct.name} {acct.last4 ? `(…${acct.last4})` : ""}
                  </option>
                )
              )}
            </select>
          </div>
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
