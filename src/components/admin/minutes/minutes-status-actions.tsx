"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface MinutesStatusActionsProps {
  minutesId: string;
  status: string; // 'draft' | 'approved'
  pendingDeleteAt: string | Date | null;
  canDelete: boolean;
  /** Opens the post-save email prompt — offered from here too, not only
   *  right after a form save, since a notetaker may want to (re)send an
   *  already-saved record's minutes without editing anything. */
  onRequestEmail: () => void;
}

export function MinutesStatusActions({
  minutesId,
  status,
  pendingDeleteAt,
  canDelete,
  onRequestEmail,
}: MinutesStatusActionsProps) {
  const router = useRouter();
  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const isDeleted = !!pendingDeleteAt;

  async function callAction(url: string, method: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "That action could not be completed.");
      }
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That action could not be completed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    const ok = await callAction(`/api/admin/minutes/${minutesId}`, "PATCH", { action: "approve" });
    if (ok) {
      toast.success("Minutes approved.");
      router.refresh();
    }
  }

  async function handleReopen() {
    const ok = await callAction(`/api/admin/minutes/${minutesId}`, "PATCH", { action: "reopen" });
    if (ok) {
      toast.success("Reopened for correction.");
      router.refresh();
    }
  }

  async function handleDelete() {
    const ok = await callAction(`/api/admin/minutes/${minutesId}`, "DELETE");
    if (ok) {
      toast.success("Minutes deleted.");
      router.refresh();
    }
  }

  async function handleRestore() {
    const ok = await callAction(`/api/admin/minutes/${minutesId}/restore`, "POST");
    if (ok) {
      toast.success("Minutes restored.");
      router.refresh();
    }
  }

  if (isDeleted) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-red-50 border border-red-200 p-4">
        <p className="text-sm text-red-700 flex-1 min-w-0">
          This record has been deleted. It is hidden from every member-facing and admin list.
        </p>
        {canDelete && (
          <button
            type="button"
            onClick={() => void handleRestore()}
            disabled={busy}
            className="bg-lions-blue text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
          >
            Restore
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {status === "draft" && (
        <button
          type="button"
          onClick={() => void handleApprove()}
          disabled={busy}
          className="bg-lions-blue text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
        >
          Approve
        </button>
      )}
      {status === "approved" && (
        <button
          type="button"
          onClick={() => setReopenConfirmOpen(true)}
          disabled={busy}
          className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
        >
          Reopen for correction
        </button>
      )}
      <button
        type="button"
        onClick={onRequestEmail}
        disabled={busy}
        className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
      >
        Email these minutes…
      </button>
      {canDelete && (
        <button
          type="button"
          onClick={() => setDeleteConfirmOpen(true)}
          disabled={busy}
          className="text-sm font-semibold text-gray-500 hover:text-red-600 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-3 py-2 min-h-[44px]"
        >
          Delete
        </button>
      )}

      <ConfirmDialog
        open={reopenConfirmOpen}
        onOpenChange={setReopenConfirmOpen}
        title="Reopen these minutes for correction?"
        description="The record goes back to draft status so its content can be edited. The prior approval date stays visible until it's re-approved."
        confirmLabel="Reopen"
        onConfirm={() => {
          setReopenConfirmOpen(false);
          void handleReopen();
        }}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete these minutes?"
        description="The record is hidden from every member-facing and admin view, but kept in the database and can be restored later. This action cannot be undone from here — restoring requires the Deleted filter."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          setDeleteConfirmOpen(false);
          void handleDelete();
        }}
      />
    </div>
  );
}
