"use client";

import { useState } from "react";
import TransactionFormDialog from "./transaction-form-dialog";
import SplitTransactionDialog from "./split-transaction-dialog";
import MoveTransactionDialog from "./move-transaction-dialog";
import DeleteTransactionDialog from "./delete-transaction-dialog";
import { moveButtonState } from "./transaction-move-eligibility";
import { formatMoneyCents } from "./correction-dialog-logic";
import { LOCK_COPY, editLockKind, type TransactionLockKind } from "@/lib/ledger-transaction-lock";
import type { LedgerTransaction, LedgerFund, LedgerCategory, LedgerBankAccount } from "@/lib/db/schema";
import type { BudgetLineOption } from "@/lib/ledger-queries";

interface TransactionActionsProps {
  transaction: LedgerTransaction;
  /** The partner row for transfer pairs (needed to show linked fund name and for edit) */
  transferPartner?: LedgerTransaction | null;
  entityId: string;
  funds: LedgerFund[];
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
  categories,
  bankAccounts,
  budgetLines,
  canManage,
  ackStatus,
  nowIso,
  entitySlug,
}: TransactionActionsProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

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
  const moveState = moveButtonState({
    transaction,
    funds,
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
  const labelKind = hardLock ?? infoLock;

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
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          disabled={hardLock !== null}
          title={hardLock ? LOCK_COPY[hardLock].nextStep : undefined}
          className={`${actionBase} text-lions-blue hover:text-lions-blue-dark focus:ring-lions-blue`}
        >
          {isTransfer ? "Edit transfer" : "Edit"}
        </button>
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
          title={hardLock ? LOCK_COPY[hardLock].nextStep : undefined}
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
          {hardLock && (
            <span className="hidden max-w-[14rem] sm:inline">{LOCK_COPY[hardLock].nextStep}</span>
          )}
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
