/**
 * Plain, server-renderable presentational component (no "use client" needed)
 * — lists a social request's `socialRequestDecisions` rows oldest → newest.
 * Mirrors `components/members/proposal-status-timeline.tsx`'s shape exactly,
 * per Phase 3's Component Plan.
 *
 * Shared by the member detail page (`/members/social-requests/[id]`) and the
 * admin detail page (`/admin/social-requests/[id]`) — same append-only
 * history, same component, different surrounding chrome. Unlike
 * ProposalStatusTimeline, there is no `meetingDate` / `citingMinutes` row —
 * this feature's decisions carry no minutes-citation trio (Phase 3 Data
 * Model deviation).
 */

import { socialRequestStatusLabel } from "@/lib/social-requests";

export interface SocialRequestTimelineRow {
  id: string;
  status: string;
  decidedByName: string | null;
  decidedAt: Date | string;
  note: string | null;
}

const STATUS_BADGE_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-500 border border-gray-200",
  submitted: "bg-yellow-50 text-yellow-700 border border-yellow-200",
  under_review: "bg-blue-50 text-lions-blue border border-blue-200",
  posted: "bg-green-50 text-green-700 border border-green-200",
  declined: "bg-gray-100 text-gray-600 border border-gray-200",
  deferred: "bg-amber-50 text-amber-700 border border-amber-200",
};

export function SocialRequestStatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE_STYLES[status] ?? "bg-gray-50 text-gray-500";
  return (
    <span className={`inline-flex items-center rounded-lg px-2.5 py-0.5 text-sm font-semibold ${cls}`}>
      {socialRequestStatusLabel(status)}
    </span>
  );
}

function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function SocialRequestStatusTimeline({ rows }: { rows: SocialRequestTimelineRow[] }) {
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
            <SocialRequestStatusBadge status={row.status} />
            <span className="text-sm text-gray-500">
              {row.decidedByName ? `by ${row.decidedByName}` : ""} on {formatDate(row.decidedAt)}
            </span>
          </div>

          {row.note && <p className="mt-1.5 text-sm text-gray-700">&ldquo;{row.note}&rdquo;</p>}
        </li>
      ))}
    </ul>
  );
}
