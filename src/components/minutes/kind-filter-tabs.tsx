import Link from "next/link";
import { MINUTES_KINDS, minutesKindLabel } from "@/lib/minutes";

interface KindFilterTabsProps {
  activeKind?: string;
  /** Preserved across tab switches so a search stays live while browsing by kind. */
  query?: string;
  /** Preserved across tab switches as opaque, unvalidated state — the raw
   *  `?year=` searchParams value, carried through exactly like `query`/
   *  `kind` already carry each other. Kind scopes search results, year does
   *  not (Phase 3 URL State Contract), so there's nothing to resolve here;
   *  `resolveYearParam()` in @/lib/minutes.ts is the single place validity
   *  is decided, on the next page load. */
  year?: string;
}

/**
 * Kind filter tabs for /members/records — a plain Server Component, no
 * client fetch (Phase 3 "Search": "searchParams-driven, form GET submit —
 * no client fetch, no loading spinner needed"). Every tab is a real link,
 * so browser back/forward and bookmarking a specific kind both work for
 * free.
 */
export function KindFilterTabs({ activeKind, query, year }: KindFilterTabsProps) {
  function href(kind?: string): string {
    const params = new URLSearchParams();
    if (kind) params.set("kind", kind);
    if (query) params.set("q", query);
    if (year) params.set("year", year);
    const qs = params.toString();
    return qs ? `/members/records?${qs}` : "/members/records";
  }

  function tabClass(isActive: boolean): string {
    return `inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue ${
      isActive ? "bg-lions-blue text-white" : "text-gray-600 hover:bg-gray-100"
    }`;
  }

  return (
    <nav className="flex flex-wrap gap-2" aria-label="Filter minutes by kind">
      <Link href={href(undefined)} className={tabClass(!activeKind)}>
        All
      </Link>
      {MINUTES_KINDS.map((k) => (
        <Link key={k} href={href(k)} className={tabClass(activeKind === k)}>
          {minutesKindLabel(k)}
        </Link>
      ))}
    </nav>
  );
}
