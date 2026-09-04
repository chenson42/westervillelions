"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface DeleteClubFileButtonProps {
  fileId: string;
  fileName: string;
  /** Attached event titles, when known (detail page) — named explicitly in the confirm copy. */
  attachedEventNames?: string[];
  /** Attached event count, when only the count is known (list page row). */
  attachedEventCount?: number;
  /** Where to navigate after a successful delete. Omit to just refresh in place (list page). */
  redirectTo?: string;
  variant?: "primary" | "row";
}

export function DeleteClubFileButton({
  fileId,
  fileName,
  attachedEventNames,
  attachedEventCount,
  redirectTo,
  variant = "primary",
}: DeleteClubFileButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const count = attachedEventNames?.length ?? attachedEventCount ?? 0;
  const description =
    count === 0
      ? `Delete "${fileName}"? This action cannot be undone.`
      : attachedEventNames && attachedEventNames.length > 0
        ? `Delete "${fileName}"? It will also be removed from: ${attachedEventNames.join(", ")}. This action cannot be undone.`
        : `Delete "${fileName}"? It is currently attached to ${count} event${count === 1 ? "" : "s"} and will be removed from all of them. This action cannot be undone.`;

  async function handleDelete() {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/admin/club-files/${fileId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete file");
      }
      toast.success("File deleted");
      if (redirectTo) {
        router.push(redirectTo);
        router.refresh();
      } else {
        router.refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete file");
    } finally {
      setIsDeleting(false);
      setOpen(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={isDeleting}
        className={
          variant === "primary"
            ? "border-2 border-red-600 text-red-600 px-6 py-3 rounded-lg font-semibold hover:bg-red-50 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
            : "text-xs font-semibold text-red-600 hover:text-red-800 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-0.5"
        }
      >
        Delete
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete file?"
        description={description}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </>
  );
}
