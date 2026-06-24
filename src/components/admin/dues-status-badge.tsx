import type { DuesStatus } from "@/lib/dues";

interface DuesStatusBadgeProps {
  status: DuesStatus;
}

const STATUS_STYLES: Record<DuesStatus, string> = {
  paid: "bg-green-100 text-green-800",
  partial: "bg-yellow-100 text-yellow-800",
  unpaid: "bg-red-100 text-red-800",
};

const STATUS_LABELS: Record<DuesStatus, string> = {
  paid: "Paid",
  partial: "Partial",
  unpaid: "Unpaid",
};

/**
 * Small pill badge for dues status. Server Component — no 'use client' needed.
 */
export default function DuesStatusBadge({ status }: DuesStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
