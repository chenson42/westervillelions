"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function SuggestionMarkReadButton({
  id,
  isRead,
  handledBy,
}: {
  id: string;
  isRead: boolean;
  handledBy: string | null;
}) {
  const [optimisticRead, setOptimisticRead] = useState(isRead);
  const [optimisticHandledBy, setOptimisticHandledBy] = useState(handledBy);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function toggle() {
    const next = !optimisticRead;
    setOptimisticRead(next);
    setOptimisticHandledBy(next ? "You" : null);
    await fetch(`/api/admin/suggestions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRead: next }),
    });
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col items-end">
      <button
        onClick={toggle}
        disabled={isPending}
        className="text-sm text-gray-500 hover:text-gray-700 font-medium disabled:opacity-50"
      >
        {optimisticRead ? "Mark Unhandled" : "Mark Handled"}
      </button>
      {optimisticRead && optimisticHandledBy && (
        <span className="text-xs text-gray-400 mt-1 block">by {optimisticHandledBy}</span>
      )}
    </div>
  );
}
