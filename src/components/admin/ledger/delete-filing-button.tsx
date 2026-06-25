"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { FilingRow } from "@/lib/ledger-queries";

interface DeleteFilingButtonProps {
  filing: FilingRow;
}

/**
 * Destructive delete button for a compliance filing.
 *
 * Disabled (with tooltip) when the filing is already filed — the API also
 * returns 409 in that case, but we prevent the click at the UI layer first.
 *
 * Uses <ConfirmDialog destructive> per the UX Guidelines — no window.confirm().
 */
export default function DeleteFilingButton({ filing }: DeleteFilingButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isFiled = filing.status === "filed";

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/ledger/filings/${filing.id}`, {
        method: "DELETE",
      });

      if (res.status === 409) {
        toast.error("Cannot delete a filed filing. Mark as N/A instead.");
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to delete filing.");
      }

      toast.success("Filing deleted.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete filing.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={isFiled || deleting}
        onClick={() => setOpen(true)}
        title={isFiled ? "Cannot delete a filed filing. Mark as N/A instead." : "Delete filing"}
        className="inline-flex items-center justify-center rounded-lg p-2 text-gray-400 hover:text-red-600 transition disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] min-w-[44px]"
        aria-label="Delete filing"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
          />
        </svg>
      </button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete filing?"
        description={`This will permanently delete "${filing.title}" from the ${filing.agency} compliance calendar. This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </>
  );
}
