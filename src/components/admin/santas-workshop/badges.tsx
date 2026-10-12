import type { SessionKind, SessionStatus } from "@/lib/santas-workshop/admin-contract";
import { KIND_LABELS, STATUS_LABELS } from "@/lib/santas-workshop/admin-ui";

const BASE = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold";

export function Chip({ tone, children }: { tone: "blue" | "gold" | "gray" | "green" | "red" | "amber"; children: React.ReactNode }) {
  const tones = {
    blue: "bg-lions-blue/10 text-lions-blue",
    gold: "bg-lions-gold/20 text-gray-900",
    gray: "bg-gray-100 text-gray-700",
    green: "bg-green-100 text-green-800",
    red: "bg-red-100 text-red-800",
    amber: "bg-amber-100 text-amber-800",
  } as const;
  return <span className={`${BASE} ${tones[tone]}`}>{children}</span>;
}

export function KindBadge({ kind }: { kind: SessionKind }) {
  return <Chip tone={kind === "practice" ? "gold" : "blue"}>{KIND_LABELS[kind]}</Chip>;
}

export function StatusBadge({ status }: { status: SessionStatus }) {
  const tone = status === "active" ? "green" : status === "draft" ? "gray" : "amber";
  return <Chip tone={tone}>{STATUS_LABELS[status]}</Chip>;
}
