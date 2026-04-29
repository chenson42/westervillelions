"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Props {
  userId: string;
  userName: string;
  isActive: boolean;
}

export function SuspendUserButton({ userId, userName, isActive }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/suspend`, {
        method: isActive ? "POST" : "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed");
        return;
      }
      toast.success(isActive ? `${userName} has been suspended` : `${userName} has been unsuspended`);
      router.refresh();
    } catch {
      toast.error("An error occurred");
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={loading}
        className={`text-sm font-medium ${
          isActive
            ? "text-red-600 hover:text-red-800"
            : "text-green-700 hover:text-green-900"
        } disabled:opacity-50`}
      >
        {isActive ? "Suspend" : "Unsuspend"}
      </button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={isActive ? `Suspend ${userName}?` : `Unsuspend ${userName}?`}
        description={
          isActive
            ? `${userName} will immediately lose access to the member portal and will be blocked from signing in.`
            : `${userName} will regain access to the member portal.`
        }
        confirmLabel={isActive ? "Suspend" : "Unsuspend"}
        destructive={isActive}
        onConfirm={handleConfirm}
      />
    </>
  );
}
