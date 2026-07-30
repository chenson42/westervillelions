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

/** The other entity's funds/bank accounts/categories, needed to offer a
 *  cross-entity Sweep. Populated ONLY on Club pages (never Foundation pages),
 *  and only when the viewer can record — see DECISION-058 /
 *  docs/work-log/2026-07-29-ledger-account-transfers.md Phase 3 UI plan. */
interface CrossEntityContext {
  entityId: string;
  entityName: string;
  funds: LedgerFund[];
  bankAccounts: LedgerBankAccount[];
  /** Pre-filtered by the page to fundKind='charitable' && flow='income' —
   *  the only categories a Sweep's destination leg is allowed to carry. */
  categories: LedgerCategory[];
}

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
  /** Default fund for a NEW transaction — e.g. the fund whose page opened the
   *  dialog. Ignored in edit mode (initialValues.fundId wins) and falls back to
   *  the first fund when absent. */
  defaultFundId?: string;
  /** Foundation entity's funds/bank accounts/categories — only present on Club
   *  pages. Enables the "Sweep to Foundation" mode. Undefined on Foundation
   *  pages, where Sweep simply never renders as an option. */
  crossEntityContext?: CrossEntityContext;
}

type FlowMode = "income" | "expense" | "transfer" | "sweep" | "income_refund" | "expense_refund";

const FLOW_LABELS: Record<FlowMode, string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer (Move Cash Between Accounts)",
  sweep: "Sweep to Foundation",
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

const BOARD_MINUTE_MAX_LEN = 500;

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
 * Handles four code paths:
 *   1. Regular income/expense (and refund convenience labels)
 *   2. New Transfer — same fund, two of the CURRENT entity's bank accounts
 *      (e.g. Admin Checking -> Petty Cash). No board minute, no category.
 *   3. New Sweep — Club Activity Fund -> Foundation Charitable Fund, each leg
 *      its own entity's bank account. Requires a board-minute reference;
 *      routes through <ConfirmDialog> since it's two permanent, independent
 *      transactions on two separate books (DECISION-058).
 *   4. Edit existing (PATCH /api/admin/ledger/transactions/[id])
 *      - transfer/sweep rows use ?both=true for symmetric amount/date/memo
 *        edits; bank account is immutable post-creation for any pair.
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
  defaultFundId,
  crossEntityContext,
}: TransactionFormProps) {
  const router = useRouter();
  const isEdit = Boolean(initialValues);
  const isEditingTransfer = isEdit && Boolean(initialValues?.transferGroupId);

  // Derive initial flow mode for edit. We can't tell Transfer from Sweep just
  // from the row itself (both merely carry a transferGroupId) — "transfer" is
  // a safe generic label for edit mode since the Type selector is hidden for
  // isEditingTransfer regardless (amount/date/memo are the only editable
  // fields on a pair; see the PATCH bank-account-immutability fix, DECISION-058).
  function initFlowMode(): FlowMode {
    if (!initialValues) return "income";
    if (initialValues.transferGroupId) return "transfer";
    return initialValues.flow as "income" | "expense";
  }

  // The current entity's Activity fund and the Foundation's Charitable fund —
  // the only two funds a Sweep ever touches. Undefined/false when either
  // side is missing, which is what gates the Sweep option out of the Type
  // selector entirely (never offered as a UI path, not just disabled).
  const clubActivityFund = funds.find((f) => f.kind === "activity");
  const foundationCharitableFund = crossEntityContext?.funds.find((f) => f.kind === "charitable");
  const canSweep = Boolean(crossEntityContext && clubActivityFund && foundationCharitableFund);
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
  // for a new Transfer/Sweep (e.g. Admin Checking, where the cash sits).
  const defaultBankAccountId = bankAccounts.find((a) => a.isDefault)?.id ?? "";
  const [bankAccountId, setBankAccountId] = useState(
    initialValues?.bankAccountId ?? defaultBankAccountId
  );
  // Destination account — Transfer: the current entity's other account
  // (e.g. Petty Cash). Sweep: the Foundation's account (e.g. Foundation
  // Checking). Only ever used for a NEW Transfer/Sweep — never on edit,
  // since bank account is immutable post-creation for any pair.
  const [destBankAccountId, setDestBankAccountId] = useState("");
  // Sweep-only: mandatory board-minute reference, mirroring the approve-
  // dialog's existing trim/cap/required validation shape.
  const [boardMinute, setBoardMinute] = useState("");
  // Sweep-only, optional: Foundation income category override. Blank means
  // "let the server default to Public donations."
  const [destCategoryId, setDestCategoryId] = useState("");
  const [sweepConfirmOpen, setSweepConfirmOpen] = useState(false);
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
  const isSweep = flowMode === "sweep";
  const isTransferOrSweep = isTransfer || isSweep;
  const apiFlow = isTransferOrSweep ? "income" : resolveApiFlow(flowMode);
  // Receipts only ever apply to expense transactions, never transfers/sweeps
  // (which always resolve apiFlow to "income" above) or income rows.
  const showReceiptSection = !isTransferOrSweep && !isEditingTransfer && apiFlow === "expense";
  // Public note (Impact Gift Public Note) — independent conditional from
  // beneficiaryCause's create-only gate (`!isEdit`). This field's entire
  // purpose is annotating already-existing transactions, so it must render
  // on edit too, not just create.
  const showPublicNoteSection = !isTransferOrSweep && !isEditingTransfer && apiFlow === "expense";

  // The effective fund kind for category filtering (regular income/expense
  // only — Transfer/Sweep never show the generic category picker below).
  const activeFund = funds.find((f) => f.id === fundId);

  // Filter categories by active fund kind and api flow
  const filteredCategories = categories.filter(
    (c) =>
      (!activeFund || c.fundKind === activeFund.kind) &&
      (isTransferOrSweep ? false : c.flow === apiFlow)
  );

  // Only offer Type options that are actually usable: Sweep requires both
  // funds to exist; Transfer requires a second bank account to move cash
  // into. Hiding an unusable mode (rather than offering it and 400ing) is
  // what makes the wrong direction never a UI path in the first place.
  const visibleFlowModes = (Object.keys(FLOW_LABELS) as FlowMode[]).filter(
    (m) => (m !== "sweep" || canSweep) && (m !== "transfer" || canTransfer)
  );

  // Reset category if it no longer belongs to the selected fund/flow
  useEffect(() => {
    if (categoryId && !filteredCategories.find((c) => c.id === categoryId)) {
      setCategoryId("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundId, flowMode]);

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
  // or Sweep (new transactions only — bank account is immutable on edit).
  useEffect(() => {
    if (isEdit) return;
    if (flowMode === "transfer") {
      const fallback = bankAccounts.find((a) => a.id !== bankAccountId)?.id ?? "";
      setDestBankAccountId(fallback);
    } else if (flowMode === "sweep" && crossEntityContext) {
      const fallback =
        crossEntityContext.bankAccounts.find((a) => a.isDefault)?.id ??
        crossEntityContext.bankAccounts[0]?.id ??
        "";
      setDestBankAccountId(fallback);
    } else {
      setDestBankAccountId("");
      setBoardMinute("");
      setDestCategoryId("");
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
    } else if (!isEdit && isSweep) {
      if (!clubActivityFund || !foundationCharitableFund) {
        return "Sweep is not available — the Activity Fund or Foundation Charitable Fund could not be found.";
      }
      if (!destBankAccountId) return "Select both a source and destination bank account.";
      if (!boardMinute.trim()) {
        return "A board-minute reference is required for a cross-entity sweep.";
      }
      if (boardMinute.trim().length > BOARD_MINUTE_MAX_LEN) {
        return `Board-minute reference must be ${BOARD_MINUTE_MAX_LEN} characters or fewer.`;
      }
    } else if (!isTransferOrSweep && apiFlow === "income" && !party.trim()) {
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
          // Bank account is immutable post-creation for any transfer/sweep
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
      } else if (isTransferOrSweep) {
        // New Transfer or Sweep path (DECISION-058) — one underlying
        // mechanism, two names. entityId is NOT sent: the server derives
        // both legs' entities from sourceFundId/destFundId themselves.
        url = "/api/admin/ledger/transactions";
        method = "POST";
        body = {
          transfer: true,
          sourceFundId: isSweep ? clubActivityFund!.id : fundId,
          destFundId: isSweep ? foundationCharitableFund!.id : fundId,
          sourceBankAccountId: bankAccountId,
          destBankAccountId,
          txnDate,
          amountCents,
          memo: memo || null,
          ...(isSweep ? { boardMinute: boardMinute.trim() } : {}),
          ...(isSweep && destCategoryId ? { destCategoryId } : {}),
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
    // A Sweep is functionally irreversible — two permanent, independent
    // transactions on two entities' books — so route it through a confirm
    // step rather than saving on the first click (Phase 1 Gaps section).
    if (!isEdit && isSweep) {
      setSweepConfirmOpen(true);
      return;
    }
    void performSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Flow mode selector — hidden for transfer/sweep edit (can't change flow on a pair row) */}
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

      {/* Sweep: implied Activity -> Charitable, cross-entity — explicit
          two-books framing per DECISION-058 (never a single reversible entry). */}
      {isSweep && !isEdit && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-900 space-y-1">
          <p>
            <span className="font-semibold">From:</span> {clubActivityFund?.name ?? "Activity Fund"} (this entity)
            {" "}&rarr;{" "}
            <span className="font-semibold">To:</span> {foundationCharitableFund?.name ?? "Charitable Fund"}
            {crossEntityContext ? ` (${crossEntityContext.entityName})` : ""}
          </p>
          <p className="text-xs text-blue-800">
            This records two separate, permanent transactions — a Club expense and a Foundation
            gift/income — both citing the board-minute reference below, on two separate sets of books.
          </p>
        </div>
      )}

      {/* Regular: fund picker (not for transfer/sweep, whose fund is implied) */}
      {!isTransferOrSweep && !isEdit && (
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

      {/* Category (not for transfer/sweep) */}
      {!isTransferOrSweep && !isEditingTransfer && (
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

      {/* Party (not for transfer/sweep) */}
      {!isTransferOrSweep && !isEditingTransfer && (
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

      {/* Check # (not for transfer/sweep) */}
      {!isTransferOrSweep && !isEditingTransfer && (
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

      {/* Beneficiary cause — optional, only for new non-transfer/sweep expenses */}
      {!isTransferOrSweep && !isEdit && apiFlow === "expense" && (
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

      {/* Payment method (not for transfer/sweep) */}
      {!isTransferOrSweep && !isEditingTransfer && (
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

      {/* Bank account — regular transactions & edit (transfer/sweep pairs
          hide this: bank account is immutable post-creation, and NEW
          transfer/sweep use the two per-leg pickers below instead). */}
      {bankAccounts.length > 0 && !isTransferOrSweep && (
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

      {/* Transfer / Sweep: per-leg bank-account pickers (new only — immutable on edit) */}
      {isTransferOrSweep && !isEdit && (
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
              {(isSweep ? crossEntityContext?.bankAccounts ?? [] : bankAccounts.filter((a) => a.id !== bankAccountId)).map(
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

      {/* Sweep-only: mandatory board-minute + optional Foundation category */}
      {isSweep && !isEdit && (
        <>
          <div>
            <label htmlFor="txn-board-minute" className="block text-sm font-medium text-gray-700 mb-1">
              Board-minute reference <span className="text-gray-400 font-normal text-xs">(required)</span>
            </label>
            <input
              id="txn-board-minute"
              type="text"
              value={boardMinute}
              onChange={(e) => setBoardMinute(e.target.value)}
              maxLength={BOARD_MINUTE_MAX_LEN}
              placeholder="e.g., Motion passed May 2026 meeting, minute §4"
              className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
            <p className="mt-1 text-xs text-gray-400">
              Enter the board-meeting minute or motion reference that authorized this sweep.
            </p>
          </div>
          {crossEntityContext && crossEntityContext.categories.length > 0 && (
            <div>
              <label htmlFor="txn-dest-category" className="block text-sm font-medium text-gray-700 mb-1">
                Foundation income category <span className="text-gray-400 font-normal text-xs">(optional — defaults to Public donations)</span>
              </label>
              <select
                id="txn-dest-category"
                value={destCategoryId}
                onChange={(e) => setDestCategoryId(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              >
                <option value="">Public donations (default)</option>
                {crossEntityContext.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
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
                : isSweep
                  ? "Record Sweep"
                  : "Record Transaction"}
        </button>
      </div>

      {/* Sweep confirm — functionally irreversible (two permanent,
          independent transactions on two entities' books), so it never saves
          on the first click (Phase 1 Gaps / DECISION-058). */}
      <ConfirmDialog
        open={sweepConfirmOpen}
        onOpenChange={setSweepConfirmOpen}
        title="Confirm Sweep to Foundation?"
        description="This creates two separate, permanent transactions — a Club Activity Fund expense and a Foundation Charitable Fund gift/income — both citing the board-minute reference you entered. This cannot be undone in the Ledger; reversing it requires a new, opposite transaction and a new board decision."
        confirmLabel="Confirm Sweep"
        destructive
        onConfirm={() => {
          setSweepConfirmOpen(false);
          void performSubmit();
        }}
      />
    </form>
  );
}
