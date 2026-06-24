"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import TransactionForm from "./transaction-form";
import type { LedgerFund, LedgerCategory, LedgerBankAccount, LedgerTransaction } from "@/lib/db/schema";

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
  | "bankAccountId"
  | "fundId"
  | "transferGroupId"
>;

interface TransactionFormDialogProps {
  entityId: string;
  funds: LedgerFund[];
  categories: LedgerCategory[];
  bankAccounts: LedgerBankAccount[];
  /** Trigger element — a button that opens the dialog */
  trigger?: React.ReactNode;
  /** When provided, opens in edit mode for this transaction */
  initialValues?: EditableTransaction;
  transferPartnerId?: string;
  /** Whether the dialog is controlled externally */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Dialog wrapper around TransactionForm.
 * Used from the overview page "Record transaction" button
 * and from TransactionActions for editing.
 */
export default function TransactionFormDialog({
  entityId,
  funds,
  categories,
  bankAccounts,
  trigger,
  initialValues,
  transferPartnerId,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: TransactionFormDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  function setOpen(val: boolean) {
    if (isControlled) {
      controlledOnOpenChange?.(val);
    } else {
      setUncontrolledOpen(val);
    }
  }

  const isEdit = Boolean(initialValues);
  const isTransfer = Boolean(initialValues?.transferGroupId);
  const title = isEdit
    ? isTransfer
      ? "Edit Transfer"
      : "Edit Transaction"
    : "Record Transaction";

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl overflow-y-auto max-h-[90vh] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold text-gray-900">
              {title}
            </Dialog.Title>
            <Dialog.Close
              className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Dialog.Close>
          </div>

          <TransactionForm
            entityId={entityId}
            funds={funds}
            categories={categories}
            bankAccounts={bankAccounts}
            onSuccess={() => setOpen(false)}
            onCancel={() => setOpen(false)}
            initialValues={initialValues}
            transferPartnerId={transferPartnerId}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
