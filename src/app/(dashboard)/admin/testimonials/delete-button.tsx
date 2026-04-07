"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export default function DeleteTestimonialButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/admin/testimonials/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete testimonial");
      }

      toast.success("Testimonial deleted");
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
        className="inline-block rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:border-gray-400 hover:bg-gray-50 transition disabled:opacity-50"
      >
        {isDeleting ? "Deleting..." : "Delete"}
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete testimonial?"
        description="This will permanently remove the testimonial from the join page. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </>
  );
}
