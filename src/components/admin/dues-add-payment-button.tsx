"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import DuesPaymentForm from "@/components/admin/dues-payment-form";

interface DuesAddPaymentButtonProps {
  memberId: string;
  fiscalYear: number;
}

/**
 * "Add Payment" button + modal for the per-member dues detail page.
 * Only rendered when canManage is true.
 */
export default function DuesAddPaymentButton({ memberId, fiscalYear }: DuesAddPaymentButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="bg-lions-blue text-white px-5 py-2.5 rounded-lg font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue text-sm min-h-[44px]"
        >
          Add Payment
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <Dialog.Title className="text-lg font-semibold text-gray-900 mb-4">
            Record Payment — FY{fiscalYear}
          </Dialog.Title>
          <DuesPaymentForm
            memberId={memberId}
            fiscalYear={fiscalYear}
            onClose={() => setOpen(false)}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
