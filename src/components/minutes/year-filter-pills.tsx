import Link from "next/link";

interface YearFilterPillsProps {
  /** undefined means the "All years" pill is active. */
  activeYear: number | undefined;
  currentFY: number;
  /** kind-scoped, only fiscal years with count > 0 (from getMinutesFiscalYearCounts). */
  counts: { fiscalYear: number; count: number }[];
  /** kind-scoped sum across every fiscal year, for the "All years" pill. */
  totalCount: number;
  /** Preserved across year switches so a kind filter stays applied while paging by year. */
  kind?: string;
}

/**
 * Short "2025-26" pill label for a Lions fiscal year. Deliberately NOT
 * fiscalYearLabel() from fiscal-year.ts — that formatter produces the long
 * prose form ("FY2026 (Jul 2026 – Jun 2027)") built for /members/impact;
 * this is presentation formatting of the *same* year, not a second
 * definition of which year a date belongs to, so it doesn't trip the
 * project's duplication rule (Phase 3 Component Plan).
 *
 * Exported (not module-private) because page.tsx reuses the identical
 * short form for the "nearest year with data" empty-state link — a single
 * definition, not a second copy in page.tsx.
 */
export function shortFyLabel(fy: number): string {
  return `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;
}

/**
 * Year filter pills for /members/records — a plain Server Component, no
 * client fetch, mirroring KindFilterTabs exactly (Phase 2 architect ruling:
 * "no interactivity requirement here that a client component would
 * justify"). Every pill is a real link, so browser back/forward and
 * bookmarking a specific year both work for free.
 *
 * Callers must NOT render this while a search is active (Phase 3 URL State
 * Contract) — year doesn't scope search results, so there is nothing for
 * an active pill to mean in that view; hiding the row (rather than showing
 * inert-looking clickable pills) is what makes "this is a browse control"
 * legible.
 */
export function YearFilterPills({ activeYear, currentFY, counts, totalCount, kind }: YearFilterPillsProps) {
  function href(year?: number): string {
    const params = new URLSearchParams();
    if (kind) params.set("kind", kind);
    if (year === undefined) {
      params.set("year", "all");
    } else if (year !== currentFY) {
      // Clean-URL convention already used by KindFilterTabs' "All" tab: the
      // default selection (current FY) omits the param entirely.
      params.set("year", String(year));
    }
    const qs = params.toString();
    return qs ? `/members/records?${qs}` : "/members/records";
  }

  function pillClass(isActive: boolean): string {
    return `inline-flex items-center rounded-full px-4 py-3 text-sm font-semibold transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue ${
      isActive ? "bg-lions-blue text-white" : "bg-white text-gray-600 hover:bg-gray-100"
    }`;
  }

  // Pills = the current FY (always rendered, data or not — decision #1)
  // union the fiscal years present in `counts`, deduped, sorted desc.
  const years = Array.from(new Set([currentFY, ...counts.map((c) => c.fiscalYear)])).sort((a, b) => b - a);
  const countByYear = new Map(counts.map((c) => [c.fiscalYear, c.count]));

  return (
    <nav className="flex flex-wrap gap-2" aria-label="Filter minutes by fiscal year">
      <Link href={href(undefined)} className={pillClass(activeYear === undefined)}>
        All years · {totalCount}
      </Link>
      {years.map((fy) => (
        <Link key={fy} href={href(fy)} className={pillClass(activeYear === fy)}>
          {shortFyLabel(fy)} · {countByYear.get(fy) ?? 0}
        </Link>
      ))}
    </nav>
  );
}
