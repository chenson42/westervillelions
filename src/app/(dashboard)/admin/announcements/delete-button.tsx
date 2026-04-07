"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export default function DeleteAnnouncementButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/admin/announcements/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete announcement");
      }

      toast.success("Announcement deleted");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "An error occurred");
      setIsDeleting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={isDeleting}
        className="inline-block rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:border-red-300 hover:bg-red-50 transition disabled:opacity-50"
      >
        {isDeleting ? "Deleting..." : "Delete"}
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete announcement?"
        description="This will permanently remove the announcement from the homepage. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </>
  );
}
