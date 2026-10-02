"use client";

import { useState } from "react";
import TransactionFormDialog from "./transaction-form-dialog";
import SplitTransactionDialog from "./split-transaction-dialog";
import MoveTransactionDialog from "./move-transaction-dialog";
import DeleteTransactionDialog from "./delete-transaction-dialog";
import CorrectReimbursementDialog from "./correct-reimbursement-dialog";
import type { CorrectMode } from "./correct-reimbursement-dialog-logic";
import { moveButtonState } from "./transaction-move-eligibility";
import { formatMoneyCents } from "./correction-dialog-logic";
import {
  LOCK_COPY,
  editLockDisplayKind,
  editLockKind,
  isTransactionReconciled,
  type TransactionLockKind,
} from "@/lib/ledger-transaction-lock";
import type { LedgerTransaction, LedgerFund, LedgerCategory, LedgerBankAccount } from "@/lib/db/schema";
import type { BudgetLineOption } from "@/lib/ledger-queries";

interface TransactionActionsProps {
  transaction: LedgerTransaction;
  /** The partner row for transfer pairs (needed to show linked fund name and for edit) */
  transferPartner?: LedgerTransaction | null;
  entityId: string;
  funds: LedgerFund[];
  /**
   * EVERY entity's active funds and the entities that have an active bank
   * account: what the Move button's eligibility is decided from (`funds` above
   * is only this entity's, for the edit form).
   */
  moveFunds: Pick<LedgerFund, "id" | "entityId" | "kind">[];
  entityIdsWithActiveBank: string[];
  /** Club income rows: the Delete dialog points to the Foundation's register. */
  foundationPointer: boolean;
  categories: LedgerCategory[];
  bankAccounts: LedgerBankAccount[];
  /** Threaded to the edit dialog's TransactionForm (B-30, DECISION-061). */
  budgetLines: BudgetLineOption[];
  /** Whether the viewer holds LEDGER_MANAGE (reconciled / prior-year moves). */
  canManage: boolean;
  /** Foundation income rows: the acknowledgment's state, else null. */
  ackStatus: "pending" | "sent" | null;
  /** Server "now" (ISO) so the fiscal-year tier is the same on server and client. */
  nowIso: string;
  /** Slug of the entity whose register this is (for the sweep deep link). */
  entitySlug: string;
  /**
   * Server-derived (ledger-reimbursement-link.ts): a PAID reimbursement links to
   * this row. Swaps Edit for Correct and the lock label for "Paid
   * reimbursement" (B-108 / DECISION-114). Optional so other callers are unchanged.
   */
  paidReimbursement?: boolean;
}

const actionBase =
  "text-xs font-medium transition focus:outline-none focus:ring-2 rounded px-2 py-1 min-h-[44px] sm:min-h-0 inline-flex items-center disabled:opacity-50 disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:text-gray-400";

/**
 * Edit, split, move and delete controls for a single ledger row.
 *
 * Gating: only rendered in the parent when the viewer has LEDGER_RECORD; the
 * server re-checks every action. Rows that are hard-locked (approved, rejected,
 * cleared by a closed reconciliation session) render Edit and Delete disabled
 * with the reason up front. Move is omitted unless the row has a legal
 * destination, and disabled only when the caller lacks LEDGER_MANAGE (D1).
 * Delete opens a dialog that requires a reason — never window.confirm.
 */
export default function TransactionActions({
  transaction,
  transferPartner,
  entityId,
  funds,
  moveFunds,
  entityIdsWithActiveBank,
  foundationPointer,
  categories,
  bankAccounts,
  budgetLines,
  canManage,
  ackStatus,
  nowIso,
  entitySlug,
  paidReimbursement = false,
}: TransactionActionsProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [correctMode, setCorrectMode] = useState<CorrectMode | null>(null);

  const isTransfer = Boolean(transaction.transferGroupId);

  // Split eligibility (base conditions checked client-side; the authoritative
  // guards — approved, rejected, reconciled, reconciledSessionId,
  // matched-in-any-reconciliation-session, and transfer-leg — live server-side
  // on the /split route and surface via toast.error if hit anyway, e.g. a
  // stale row). Transfer legs are excluded here too: splitting one leg would
  // break the transfer pair's mirror-sum invariant.
  const canSplit =
    transaction.status === "posted" &&
    !transaction.approvedAt &&
    !transaction.reconciled &&
    !isTransfer;

  const hardLock = editLockKind(transaction);
  // The label and the advice shown for a hard lock: a paid reimbursement reads
  // "Paid reimbursement" (use Correct), not "Approved" (refund entry).
  const displayLock = editLockDisplayKind({
    approvedAt: transaction.approvedAt,
    status: transaction.status,
    reconciledSessionId: transaction.reconciledSessionId,
    paidReimbursement,
  });
  const canCorrect = paidReimbursement && transaction.status === "posted";
  // A null-account row can never have been matched, so it is repairable.
  const needsBankAccount =
    canCorrect && transaction.bankAccountId == null && !isTransactionReconciled(transaction);
  const moveState = moveButtonState({
    transaction,
    funds: moveFunds,
    entityIdsWithActiveBank,
    canManage,
    now: new Date(nowIso),
  });
  // Informational labels for rows whose Edit still works but which have a
  // special shape the treasurer should know about before clicking.
  const infoLock: TransactionLockKind | null = hardLock
    ? null
    : transaction.duesPaymentId
      ? "dues_synced"
      : isTransfer
        ? "transfer_leg"
        : null;
  const labelKind = displayLock ?? infoLock;

  const deleteSummary = `${transaction.txnDate} · ${
    isTransfer ? "Transfer" : (transaction.party || transaction.memo || "No party")
  } · ${transaction.flow === "income" ? "+" : "-"}${formatMoneyCents(transaction.amountCents)}`;

  // Build the edit initial values from the transaction row
  const editInitialValues = {
    id: transaction.id,
    flow: transaction.flow as "income" | "expense",
    amountCents: transaction.amountCents,
    txnDate: transaction.txnDate,
    categoryId: transaction.categoryId,
    party: transaction.party,
    memo: transaction.memo,
    paymentMethod: transaction.paymentMethod,
    checkNumber: transaction.checkNumber,
    bankAccountId: transaction.bankAccountId,
    fundId: transaction.fundId,
    transferGroupId: transaction.transferGroupId,
    receiptStorageKey: transaction.receiptStorageKey,
    receiptWaivedAt: transaction.receiptWaivedAt,
    receiptWaiverReason: transaction.receiptWaiverReason,
    publicNote: transaction.publicNote,
    beneficiaryCause: transaction.beneficiaryCause,
    budgetLineId: transaction.budgetLineId,
  };

  return (
    <>
      {/* flex-wrap: a third action (Split) doesn't always fit on one line at
          360px — wrap to a second line rather than clipping or overflowing
          the cell (unlike the membership-buttons overflow bug). The parent
          table already scrolls horizontally too, but this keeps the actions
          cell itself well-behaved regardless. */}
      <div className="flex flex-wrap items-center gap-2 justify-end">
        {canCorrect ? (
          <button
            type="button"
            onClick={() => setCorrectMode("correct")}
            className={`${actionBase} text-lions-blue hover:text-lions-blue-dark focus:ring-lions-blue`}
          >
            Correct
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            disabled={hardLock !== null}
            title={displayLock ? LOCK_COPY[displayLock].nextStep : undefined}
            className={`${actionBase} text-lions-blue hover:text-lions-blue-dark focus:ring-lions-blue`}
          >
            {isTransfer ? "Edit transfer" : "Edit"}
          </button>
        )}
        {canSplit && (
          <button
            type="button"
            onClick={() => setSplitOpen(true)}
            className={`${actionBase} text-lions-blue hover:text-lions-blue-dark focus:ring-lions-blue`}
          >
            Split
          </button>
        )}
        {moveState.kind !== "omit" && (
          <button
            type="button"
            onClick={() => setMoveOpen(true)}
            disabled={moveState.kind === "disabled"}
            title={moveState.kind === "disabled" ? moveState.reason : undefined}
            className={`${actionBase} text-lions-blue hover:text-lions-blue-dark focus:ring-lions-blue`}
          >
            Move
          </button>
        )}
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          disabled={hardLock !== null}
          title={displayLock ? LOCK_COPY[displayLock].nextStep : undefined}
          className={`${actionBase} text-gray-500 hover:text-red-600 focus:ring-gray-300`}
        >
          Delete
        </button>
      </div>

      {labelKind && (
        <p className="mt-1 flex flex-wrap items-start justify-end gap-x-1 whitespace-normal text-right text-xs text-gray-500">
          <svg
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
              clipRule="evenodd"
            />
          </svg>
          <span className="font-medium">{LOCK_COPY[labelKind].label}.</span>
          {displayLock && (
            <span className="hidden max-w-[14rem] sm:inline">{LOCK_COPY[displayLock].nextStep}</span>
          )}
        </p>
      )}
      {needsBankAccount && (
        <div className="mt-1 ml-auto flex max-w-[14rem] flex-col items-end gap-1 whitespace-normal text-right text-xs text-gray-500">
          <p>No bank account. It can&rsquo;t be reconciled yet.</p>
          <button
            type="button"
            onClick={() => setCorrectMode("add_bank_account")}
            className={`${actionBase} border border-lions-blue text-lions-blue hover:bg-lions-blue/5 focus:ring-lions-blue`}
          >
            Add bank account
          </button>
        </div>
      )}
      {hardLock === "reconciled_session" &&
        moveState.kind !== "omit" &&
        moveState.crossEntityOnly && (
          <p className="mt-1 ml-auto max-w-[14rem] whitespace-normal text-right text-xs text-gray-500">
            If the money is in the Club&rsquo;s account, see Move to the Club.
          </p>
        )}
      {moveState.kind === "disabled" && (
        <p className="mt-1 max-w-[14rem] whitespace-normal text-right text-xs text-gray-500 ml-auto">
          {moveState.reason}
        </p>
      )}

      <DeleteTransactionDialog
        transactionId={transaction.id}
        isTransfer={isTransfer}
        ackStatus={ackStatus}
        summary={deleteSummary}
        foundationPointer={foundationPointer}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />

      {moveState.kind !== "omit" && (
        <MoveTransactionDialog
          transactionId={transaction.id}
          entitySlug={entitySlug}
          open={moveOpen}
          onOpenChange={setMoveOpen}
        />
      )}

      {canCorrect && correctMode && (
        <CorrectReimbursementDialog
          transactionId={transaction.id}
          mode={correctMode}
          open
          onOpenChange={(o) => !o && setCorrectMode(null)}
        />
      )}

      <TransactionFormDialog
        entityId={entityId}
        funds={funds}
        categories={categories}
        bankAccounts={bankAccounts}
        budgetLines={budgetLines}
        open={editOpen}
        onOpenChange={setEditOpen}
        initialValues={editInitialValues}
        transferPartnerId={transferPartner?.id}
      />

      {canSplit && (
        <SplitTransactionDialog
          transactionId={transaction.id}
          currentAmountCents={transaction.amountCents}
          open={splitOpen}
          onOpenChange={setSplitOpen}
        />
      )}
    </>
  );
}
