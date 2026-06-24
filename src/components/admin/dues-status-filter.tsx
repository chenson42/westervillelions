"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { DuesStatus } from "@/lib/dues";

interface DuesStatusFilterProps {
  currentStatus: string;
  currentFY: number;
  currentSearch?: string;
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All Members" },
  { value: "paid", label: "Paid" },
  { value: "partial", label: "Partial" },
  { value: "unpaid", label: "Unpaid" },
];

/**
 * Status filter tabs for the admin dues list.
 * Navigates with fy + status search params.
 */
export default function DuesStatusFilter({
  currentStatus,
  currentFY,
  currentSearch,
}: DuesStatusFilterProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick(status: string) {
    const params = new URLSearchParams({ fy: String(currentFY) });
    if (status !== "all") params.set("status", status);
    if (currentSearch) params.set("search", currentSearch);
    startTransition(() => router.push(`/admin/dues?${params}`));
  }

  return (
    <div className={`flex gap-2 flex-wrap ${isPending ? "opacity-60 pointer-events-none" : ""}`}>
      {STATUS_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => handleClick(opt.value)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue ${
            currentStatus === opt.value || (opt.value === "all" && !currentStatus)
              ? "bg-lions-blue text-white"
              : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
