"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function MarkReadButton({ id, isRead }: { id: string; isRead: boolean }) {
  const [optimisticRead, setOptimisticRead] = useState(isRead);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function toggle() {
    const next = !optimisticRead;
    setOptimisticRead(next);
    await fetch(`/api/admin/contact/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRead: next }),
    });
    startTransition(() => router.refresh());
  }

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      className="text-sm text-gray-500 hover:text-gray-700 font-medium disabled:opacity-50"
    >
      {optimisticRead ? "Mark unread" : "Mark read"}
    </button>
  );
}
