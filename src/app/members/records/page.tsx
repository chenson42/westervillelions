import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import {
  listMinutesForMembers,
  searchMinutes,
  getNextMeetingPointer,
  getMostRecentApprovedMinutes,
  getMinutesFiscalYearCounts,
  type MinutesSummaryRow,
  type MinutesSearchRow,
  type NextMeetingPointer as NextMeetingPointerData,
  type MostRecentApprovedMinutes,
} from "@/lib/minutes-queries";
import {
  MINUTES_KINDS,
  minutesKindLabel,
  minutesSearchMatchFieldLabel,
  resolveYearParam,
  nearestFiscalYearWithData,
  type MinutesSearchSnippet,
} from "@/lib/minutes";
import { currentFiscalYear } from "@/lib/fiscal-year";
import { nowEastern } from "@/lib/events";
import { listDocumentsForMembers } from "@/lib/documents-queries";
import { NextMeetingPointer } from "@/components/minutes/next-meeting-pointer";
import { KindFilterTabs } from "@/components/minutes/kind-filter-tabs";
import { SearchBox } from "@/components/minutes/search-box";
import { YearFilterPills, shortFyLabel } from "@/components/minutes/year-filter-pills";

export const dynamic = "force-dynamic";

function statusBadgeClass(status: string): string {
  return status === "approved" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800";
}

/**
 * Href for `/members/records` carrying only `kind` and (when it diverges
 * from the default) `year` — the same "omit the default" clean-URL
 * convention YearFilterPills uses for its own links. Shared by the
 * Clear-search control and the "nearest year with data" empty-state link
 * so both produce URLs in the same shape.
 */
function recordsHref(opts: { kind?: string; year?: number; currentFY: number }): string {
  const params = new URLSearchParams();
  if (opts.kind) params.set("kind", opts.kind);
  if (opts.year !== undefined && opts.year !== opts.currentFY) params.set("year", String(opts.year));
  const qs = params.toString();
  return qs ? `/members/records?${qs}` : "/members/records";
}

/**
 * Clear-search href — drops `q`, preserves `kind` and the raw (unvalidated)
 * `year` param exactly as received, so returning to the browse view
 * restores whatever year selection was in effect before the member started
 * typing (Phase 3 Flow 4). Deliberately takes the raw string, not a
 * resolved number — search mode never resolves `year` at all (see the
 * "search ignores the year pill entirely" branch above).
 */
function clearSearchHref(kind: string | undefined, rawYear: string | undefined): string {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (rawYear) params.set("year", rawYear);
  const qs = params.toString();
  return qs ? `/members/records?${qs}` : "/members/records";
}

/**
 * Turns a snippet's excerpt + match offsets into highlighted JSX — same
 * pattern as renderHighlightedLabel() in admin-sidebar.tsx (slice + <mark>,
 * never dangerouslySetInnerHTML). These bodies are text imported from
 * member-authored PDFs, so no HTML string may ever exist in this path.
 */
function renderSnippet(snippet: MinutesSearchSnippet): ReactNode {
  const { excerpt, matchStart, matchLength } = snippet;
  const before = excerpt.slice(0, matchStart);
  const match = excerpt.slice(matchStart, matchStart + matchLength);
  const after = excerpt.slice(matchStart + matchLength);
  return (
    <>
      {before}
      <mark className="bg-lions-gold/40 text-gray-900 rounded px-0.5">{match}</mark>
      {after}
    </>
  );
}

/**
 * Member-facing Club Records landing page — the "Minutes" experience
 * (docs/work-log/2026-08-08-meeting-minutes.md, Phase 3 Flow 1/5;
 * DECISION-077 §6 — route is /members/records, tile "Club Records", while
 * the underlying modules/components stay "minutes"-named).
 *
 * Server Component throughout — auth() + inline memberId check, NO
 * FEATURES gate, mirroring /members/financial-reports exactly (any linked
 * member reads any minutes record, any kind, any status).
 *
 * 2026-09-09 rework (docs/work-log/2026-09-09-minutes-browse-and-search-
 * context.md): the 49-record flat list is now Lions-year-chunked with
 * kind-scoped pill counts, and the search view renders through a distinct
 * "Results for…" chrome instead of the plain browse `<ul>` — see the two
 * branches below. `?year=` is pure post-auth searchParams state; it never
 * touches session.user.features (Phase 3 "Permissions").
 */
export default async function MemberRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; q?: string; year?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const memberId = session.user.memberId ?? null;

  const { kind, q, year: rawYear } = await searchParams;
  const query = (q ?? "").trim();
  const currentFY = currentFiscalYear(nowEastern());

  let pointers: {
    kind: string;
    pointer: NextMeetingPointerData | null;
    mostRecentApproved: MostRecentApprovedMinutes | null;
  }[] = [];
  let documents: Awaited<ReturnType<typeof listDocumentsForMembers>> = [];

  // Browse-mode state (populated only when !query).
  let browseRows: MinutesSummaryRow[] = [];
  let counts: { fiscalYear: number; count: number }[] = [];
  let totalCount = 0;
  let resolvedYear = currentFY;
  let isAllYears = false;
  let nearestYear: number | null = null;

  // Search-mode state (populated only when query).
  let searchRows: MinutesSearchRow[] = [];

  if (memberId) {
    const pointersAndDocs = Promise.all([
      Promise.all(
        MINUTES_KINDS.map(async (k) => ({
          kind: k,
          pointer: await getNextMeetingPointer(k),
          mostRecentApproved: await getMostRecentApprovedMinutes(k),
        })),
      ),
      listDocumentsForMembers({ isAuthenticated: true }),
    ]);

    if (query) {
      // Search ignores the year pill entirely (Phase 3 Flow 3) — no counts
      // query, which the search view has no use for.
      const [rows, [ptrs, docs]] = await Promise.all([searchMinutes(query, kind), pointersAndDocs]);
      searchRows = rows;
      pointers = ptrs;
      documents = docs;
    } else {
      // Counts must be fetched BEFORE resolveYearParam()/listMinutesForMembers()
      // — knownYears (derived from counts) is an input to resolveYearParam().
      const [countsResult, [ptrs, docs]] = await Promise.all([getMinutesFiscalYearCounts(kind), pointersAndDocs]);
      counts = countsResult;
      pointers = ptrs;
      documents = docs;

      // getMinutesFiscalYearCounts() does NOT force-include the current FY
      // when it has zero records — the page unions it in itself, since the
      // current FY always renders its own pill regardless of data (Phase 1
      // decision #1). Deliberately NOT used for nearestFiscalYearWithData()
      // below — that call needs the true data-bearing set so it can return
      // null when nothing exists at all, distinct from "the default year
      // happens to be empty."
      const knownYears = Array.from(new Set([currentFY, ...counts.map((c) => c.fiscalYear)]));
      const resolved = resolveYearParam(rawYear, knownYears, currentFY);
      resolvedYear = resolved.year;
      isAllYears = resolved.isAll;

      browseRows = await listMinutesForMembers({ kind, year: isAllYears ? undefined : resolvedYear });
      totalCount = counts.reduce((sum, c) => sum + c.count, 0);

      if (browseRows.length === 0) {
        nearestYear = nearestFiscalYearWithData(
          resolvedYear,
          counts.map((c) => c.fiscalYear),
        );
      }
    }
  }

  const kindLabel = kind ? minutesKindLabel(kind) : "";

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
          <h1 className="text-3xl font-bold mb-1">Club Records</h1>
          <p className="text-blue-100 max-w-2xl">
            Meeting minutes for the whole club — general meetings, board meetings, and committees.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 space-y-8">
        <Link
          href="/members"
          className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Back to Member Portal
        </Link>

        {!memberId ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 max-w-md mx-auto">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Account Not Linked</h2>
            <p className="text-sm">
              Your user account is not linked to a member record. Contact the club treasurer or an
              administrator to have your account linked so you can view meeting minutes.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">New Member Welcome Packet</h2>
              <Link
                href="/members/records/welcome-packet"
                className="block bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden p-4 max-w-md focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                <p className="font-semibold text-gray-900">Welcome Packet</p>
                <p className="text-sm text-gray-500">
                  New-member orientation and club overview for the current Lions year.
                </p>
              </Link>
            </div>

            <div className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Club Files</h2>
              <Link
                href="/members/records/files"
                className="block bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden p-4 max-w-md focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                <p className="font-semibold text-gray-900">Files</p>
                <p className="text-sm text-gray-500">
                  Sponsorship packets, event handouts, and other files the club shares.
                </p>
              </Link>
            </div>

            {documents.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Governing Documents</h2>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {documents.map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/members/records/documents/${d.slug}`}
                        className="block bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden p-4 focus:outline-none focus:ring-2 focus:ring-lions-blue"
                      >
                        <p className="font-semibold text-gray-900">{d.title}</p>
                        <p className="text-sm text-gray-500">
                          {d.currentVersionNumber !== null
                            ? `Current version ${d.currentVersionNumber} — the club's operative text`
                            : "Not yet published"}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {pointers.map(({ kind: k, pointer, mostRecentApproved }) => (
                <NextMeetingPointer key={k} kind={k} pointer={pointer} mostRecentApproved={mostRecentApproved} />
              ))}
            </div>

            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <KindFilterTabs activeKind={kind} query={query} year={rawYear} />
                <div className="sm:w-80">
                  <SearchBox defaultValue={query} kind={kind} year={rawYear} />
                </div>
              </div>

              {/* Year pills only make sense while browsing — year doesn't
                  scope search results, so rendering them next to a "Results
                  for…" header would show inert-looking active state for a
                  control that does nothing in this view (Phase 3 URL State
                  Contract). */}
              {!query && (
                <YearFilterPills
                  activeYear={isAllYears ? undefined : resolvedYear}
                  currentFY={currentFY}
                  counts={counts}
                  totalCount={totalCount}
                  kind={kind}
                />
              )}

              {query ? (
                // ── Search view — deliberately distinct chrome (the fix for
                // "I couldn't tell it was search results"): a heading naming
                // the term, a result count, and a Clear-search control, none
                // of which the browse view renders.
                <div className="space-y-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">
                        Results for &ldquo;{query}&rdquo;
                      </h2>
                      <p className="text-sm text-gray-500">
                        {searchRows.length} {searchRows.length === 1 ? "result" : "results"}
                      </p>
                    </div>
                    <Link
                      href={clearSearchHref(kind, rawYear)}
                      className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                    >
                      Clear search
                    </Link>
                  </div>

                  {searchRows.length === 0 ? (
                    <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
                      <p>No minutes match &ldquo;{query}&rdquo;.</p>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {searchRows.map((row) => (
                        <li key={row.id}>
                          <Link
                            href={`/members/records/${row.id}`}
                            className="block bg-white rounded-2xl shadow-sm overflow-hidden p-4 hover:shadow-md transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
                          >
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div>
                                <p className="font-semibold text-gray-900">
                                  {row.title || `${minutesKindLabel(row.kind)} minutes — ${row.meetingDate}`}
                                </p>
                                <p className="text-sm text-gray-500">{row.meetingDate}</p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="inline-flex items-center rounded-full bg-lions-blue/10 px-2.5 py-0.5 text-xs font-semibold text-lions-blue">
                                  {minutesKindLabel(row.kind)}
                                </span>
                                <span
                                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(row.status)}`}
                                >
                                  {row.status === "approved" ? "Approved" : "Draft"}
                                </span>
                              </div>
                            </div>
                            {/* Title matches render like a plain browse row —
                                no label, no excerpt: the title is already the
                                full, visible headline above (Phase 3 "Title
                                matches"). */}
                            {row.matchField !== "title" && row.snippet && (
                              <div className="mt-2 pt-2 border-t border-gray-100">
                                <p className="text-xs font-semibold text-lions-blue uppercase tracking-wide mb-1">
                                  Matched in {minutesSearchMatchFieldLabel(row.matchField)}
                                </p>
                                <p className="text-sm text-gray-600">{renderSnippet(row.snippet)}</p>
                              </div>
                            )}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                // ── Browse view
                <div className="space-y-3">
                  {totalCount > 0 && (
                    <p className="text-sm text-gray-500">
                      Showing {browseRows.length} of {totalCount} record{totalCount === 1 ? "" : "s"}
                    </p>
                  )}

                  {browseRows.length === 0 ? (
                    <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
                      {nearestYear !== null ? (
                        <>
                          <p>
                            No {kindLabel ? `${kindLabel} ` : ""}minutes recorded yet for{" "}
                            {isAllYears ? "any year" : shortFyLabel(resolvedYear)}.
                          </p>
                          <Link
                            href={recordsHref({ kind, year: nearestYear, currentFY })}
                            className="mt-3 inline-flex items-center text-sm font-semibold text-lions-blue hover:text-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                          >
                            {/* Single expression, not `View {expr} instead` as JSX text nodes:
                                the adjacent-text-node form rendered glued ("View 2025-26instead")
                                in Phase 5 QA. Building the whole string in one expression removes
                                the text-node boundary entirely rather than relying on `{" "}`
                                placement. */}
                            {`View ${shortFyLabel(nearestYear)} instead →`}
                          </Link>
                        </>
                      ) : (
                        <p>No meeting minutes have been posted yet.</p>
                      )}
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {browseRows.map((row) => (
                        <li key={row.id}>
                          <Link
                            href={`/members/records/${row.id}`}
                            className="block bg-white rounded-2xl shadow-sm overflow-hidden p-4 hover:shadow-md transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
                          >
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div>
                                <p className="font-semibold text-gray-900">
                                  {row.title || `${minutesKindLabel(row.kind)} minutes — ${row.meetingDate}`}
                                </p>
                                <p className="text-sm text-gray-500">{row.meetingDate}</p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="inline-flex items-center rounded-full bg-lions-blue/10 px-2.5 py-0.5 text-xs font-semibold text-lions-blue">
                                  {minutesKindLabel(row.kind)}
                                </span>
                                <span
                                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(row.status)}`}
                                >
                                  {row.status === "approved" ? "Approved" : "Draft"}
                                </span>
                              </div>
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
