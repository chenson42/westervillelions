import Link from "next/link";
import type { SessionKind, SessionStatus } from "@/lib/santas-workshop/admin-contract";
import { KindBadge, StatusBadge } from "./badges";

const TABS = [
  { key: "overview", label: "Overview", path: "" },
  { key: "connect", label: "Connect to Zeffy", path: "/connect" },
  { key: "registrants", label: "Registrants", path: "/registrants" },
  { key: "photos", label: "Photos", path: "/photos" },
  { key: "frames", label: "Frames", path: "/frames" },
  { key: "edit", label: "Edit session", path: "/edit" },
] as const;

export type SessionTab = (typeof TABS)[number]["key"];

export function SessionNav({
  session,
  active,
}: {
  session: { id: string; name: string; slug: string; kind: SessionKind; status: SessionStatus };
  active: SessionTab;
}) {
  const base = `/admin/santas-workshop/${session.id}`;
  return (
    <header className="space-y-4">
      <Link href="/admin/santas-workshop" className="inline-block text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded">
        &larr; All sessions
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold text-gray-900 break-words">{session.name}</h1>
        <KindBadge kind={session.kind} />
        <StatusBadge status={session.status} />
      </div>
      <p className="text-sm text-gray-500">Short name: {session.slug}</p>
      <nav aria-label="Session sections" className="flex flex-wrap gap-2 border-b border-gray-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`${base}${t.path}`}
            aria-current={t.key === active ? "page" : undefined}
            className={`min-h-[44px] inline-flex items-center px-4 text-sm font-semibold border-b-2 -mb-px focus:outline-none focus:ring-2 focus:ring-lions-blue rounded-t ${
              t.key === active ? "border-lions-blue text-lions-blue" : "border-transparent text-gray-600 hover:text-lions-blue"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
