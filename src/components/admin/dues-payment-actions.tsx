"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import DuesPaymentForm from "@/components/admin/dues-payment-form";
import type { PaymentRow } from "@/lib/dues-queries";
import * as Dialog from "@radix-ui/react-dialog";

interface DuesPaymentActionsProps {
  memberId: string;
  payment: PaymentRow;
}

/**
 * Edit + Delete action buttons for a single dues payment row.
 * Shown only when canManage is true (caller controls rendering).
 */
export default function DuesPaymentActions({ memberId, payment }: DuesPaymentActionsProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/dues/${memberId}/${payment.id}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete payment.");
      }
      toast.success("Payment deleted.");
      setDeleteOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete payment. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {/* Edit */}
      <Dialog.Root open={editOpen} onOpenChange={setEditOpen}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="text-lions-blue hover:text-lions-blue-dark text-sm font-medium focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
          >
            Edit
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
            <Dialog.Title className="text-lg font-semibold text-gray-900 mb-4">
              Edit Payment
            </Dialog.Title>
            <DuesPaymentForm
              memberId={memberId}
              fiscalYear={payment.fiscalYear}
              payment={payment}
              onClose={() => setEditOpen(false)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Delete */}
      <button
        type="button"
        onClick={() => setDeleteOpen(true)}
        className="text-red-600 hover:text-red-700 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-red-500 rounded ml-3"
      >
        Delete
      </button>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this payment?"
        description="This action cannot be undone. The payment record will be permanently removed."
        confirmLabel={deleting ? "Deleting..." : "Delete"}
        destructive
        onConfirm={handleDelete}
      />
    </>
  );
}
