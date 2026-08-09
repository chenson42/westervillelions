/**
 * Plain, server-renderable presentational component (no "use client" needed)
 * — lists a proposal's `proposalDecisions` rows oldest → newest. Mirrors the
 * visual shape of `components/documents/version-history-list.tsx`'s
 * governing-document version history, per Phase 3's Component Plan.
 *
 * Shared by the member detail page (`/members/proposals/[id]`) and the admin
 * detail page (`/admin/proposals/[id]`) — same append-only history, same
 * component, different surrounding chrome.
 */

export interface ProposalTimelineRow {
  id: string;
  status: string;
  decidedByName: string | null;
  decidedAt: Date | string;
  meetingDate: string | null;
  note: string | null;
  citingMinutes: { label: string; href: string } | null;
}

const STATUS_BADGE_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-500 border border-gray-200",
  submitted: "bg-yellow-50 text-yellow-700 border border-yellow-200",
  under_review: "bg-blue-50 text-lions-blue border border-blue-200",
  approved: "bg-green-50 text-green-700 border border-green-200",
  declined: "bg-gray-100 text-gray-600 border border-gray-200",
  deferred: "bg-amber-50 text-amber-700 border border-amber-200",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under Review",
  approved: "Approved",
  declined: "Declined",
  deferred: "Deferred",
};

export function ProposalStatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE_STYLES[status] ?? "bg-gray-50 text-gray-500";
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span className={`inline-flex items-center rounded-lg px-2.5 py-0.5 text-sm font-semibold ${cls}`}>{label}</span>
  );
}

function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function ProposalStatusTimeline({ rows }: { rows: ProposalTimelineRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        <p>No history yet.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.id} className="bg-white rounded-2xl shadow-sm overflow-hidden p-4">
          <div className="flex flex-wrap items-center gap-2">
            <ProposalStatusBadge status={row.status} />
            <span className="text-sm text-gray-500">
              {row.decidedByName ? `by ${row.decidedByName}` : ""} on {formatDate(row.decidedAt)}
            </span>
          </div>

          {row.meetingDate && (
            <p className="mt-1.5 text-sm text-gray-500">
              Board meeting date: {formatDate(`${row.meetingDate}T00:00:00`)}
            </p>
          )}

          {row.note && <p className="mt-1.5 text-sm text-gray-700">&ldquo;{row.note}&rdquo;</p>}

          {row.citingMinutes ? (
            <p className="mt-1.5 text-sm text-gray-500">
              Cited:{" "}
              <a
                href={row.citingMinutes.href}
                className="text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
              >
                {row.citingMinutes.label}
              </a>
            </p>
          ) : (
            row.status !== "submitted" && (
              <p className="mt-1.5 text-xs text-amber-700">
                No minutes citation on record yet — normal until the next meeting&rsquo;s minutes are written.
              </p>
            )
          )}
        </li>
      ))}
    </ul>
  );
}
