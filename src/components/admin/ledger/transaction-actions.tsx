"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import TransactionFormDialog from "./transaction-form-dialog";
import type { LedgerTransaction, LedgerFund, LedgerCategory, LedgerBankAccount } from "@/lib/db/schema";

interface TransactionActionsProps {
  transaction: LedgerTransaction;
  /** The partner row for transfer pairs (needed to show linked fund name and for edit) */
  transferPartner?: LedgerTransaction | null;
  entityId: string;
  funds: LedgerFund[];
  categories: LedgerCategory[];
  bankAccounts: LedgerBankAccount[];
}

/**
 * Edit + delete controls for a single ledger row.
 *
 * Gating: only rendered in the parent when the viewer has LEDGER_RECORD.
 * Delete uses <ConfirmDialog destructive> — never window.confirm.
 * Transfer delete warns that both rows will be removed.
 */
export default function TransactionActions({
  transaction,
  transferPartner,
  entityId,
  funds,
  categories,
  bankAccounts,
}: TransactionActionsProps) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isTransfer = Boolean(transaction.transferGroupId);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/ledger/transactions/${transaction.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete transaction.");
      }
      const data = await res.json();
      const count = data.deleted as number;
      toast.success(
        count === 2 ? "Transfer removed (both entries deleted)." : "Transaction deleted."
      );
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not delete transaction. Try again."
      );
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

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
  };

  const deleteTitle = isTransfer ? "Delete transfer?" : "Delete transaction?";
  const deleteDescription = isTransfer
    ? "This will delete both the debit and credit entries for this transfer. This action cannot be undone."
    : "This will permanently delete this transaction. This action cannot be undone.";

  return (
    <>
      <div className="flex items-center gap-2 justify-end">
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="text-xs font-medium text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-2 py-1"
        >
          {isTransfer ? "Edit transfer" : "Edit"}
        </button>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          disabled={deleting}
          className="text-xs font-medium text-gray-500 hover:text-red-600 transition focus:outline-none focus:ring-2 focus:ring-gray-300 rounded px-2 py-1 disabled:opacity-60"
        >
          Delete
        </button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={deleteTitle}
        description={deleteDescription}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />

      <TransactionFormDialog
        entityId={entityId}
        funds={funds}
        categories={categories}
        bankAccounts={bankAccounts}
        open={editOpen}
        onOpenChange={setEditOpen}
        initialValues={editInitialValues}
        transferPartnerId={transferPartner?.id}
      />
    </>
  );
}
