import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import {
  listMinutesForMembers,
  searchMinutes,
  getNextMeetingPointer,
  getMostRecentApprovedMinutes,
} from "@/lib/minutes-queries";
import { MINUTES_KINDS, minutesKindLabel } from "@/lib/minutes";
import { listDocumentsForMembers } from "@/lib/documents-queries";
import { NextMeetingPointer } from "@/components/minutes/next-meeting-pointer";
import { KindFilterTabs } from "@/components/minutes/kind-filter-tabs";
import { SearchBox } from "@/components/minutes/search-box";

export const dynamic = "force-dynamic";

function statusBadgeClass(status: string): string {
  return status === "approved" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800";
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
 */
export default async function MemberRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; q?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const memberId = session.user.memberId ?? null;

  const { kind, q } = await searchParams;
  const query = (q ?? "").trim();

  const [rows, pointers, documents] = memberId
    ? await Promise.all([
        query ? searchMinutes(query, kind) : listMinutesForMembers({ kind }),
        Promise.all(
          MINUTES_KINDS.map(async (k) => ({
            kind: k,
            pointer: await getNextMeetingPointer(k),
            mostRecentApproved: await getMostRecentApprovedMinutes(k),
          })),
        ),
        listDocumentsForMembers({ isAuthenticated: true }),
      ])
    : [[], [], []];

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
                <KindFilterTabs activeKind={kind} query={query} />
                <div className="sm:w-80">
                  <SearchBox defaultValue={query} kind={kind} />
                </div>
              </div>

              {rows.length === 0 ? (
                <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
                  {query ? (
                    <p>No minutes match &ldquo;{query}&rdquo;.</p>
                  ) : (
                    <p>No meeting minutes have been posted yet.</p>
                  )}
                </div>
              ) : (
                <ul className="space-y-2">
                  {rows.map((row) => (
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
          </>
        )}
      </div>
    </div>
  );
}
