"use client";

import { useState } from "react";
import Link from "next/link";
import { SocialRequestStatusBadge } from "@/components/members/social-request-status";
import { socialRequestPlatformLabel } from "@/lib/social-requests";

export interface SocialRequestReviewRow {
  id: string;
  subjectLine: string;
  platforms: string[];
  status: string;
  submittedAt: string | null; // ISO
  requesterName: string | null;
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "submitted", label: "Submitted" },
  { value: "under_review", label: "Under Review" },
  { value: "posted", label: "Posted" },
  { value: "declined", label: "Declined" },
  { value: "deferred", label: "Deferred" },
] as const;

function platformsText(platforms: string[]): string {
  if (!platforms || platforms.length === 0) return "—";
  return platforms.map((p) => socialRequestPlatformLabel(p)).join(", ");
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Board review list. "use client" because the status filter is local UI
 * state over an already-fetched, already-excludes-drafts list — not a
 * URL/server round trip. Mirrors `proposal-review-table.tsx`'s shape;
 * columns adapted since this feature has no `type`/`chair` equivalent
 * fields.
 */
export function SocialRequestReviewTable({ requests }: { requests: SocialRequestReviewRow[] }) {
  const [filter, setFilter] = useState<string>("all");

  const filtered = filter === "all" ? requests : requests.filter((r) => r.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-lions-blue ${
              filter === f.value ? "bg-lions-blue text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          <p>No requests match this filter.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Request
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Platforms
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Submitted
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Status
                </th>
                <th scope="col" className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="text-sm font-semibold text-gray-900">{r.subjectLine}</div>
                    {r.requesterName && <div className="text-xs text-gray-500">by {r.requesterName}</div>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{platformsText(r.platforms)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{formatDate(r.submittedAt)}</td>
                  <td className="px-4 py-3">
                    <SocialRequestStatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/social-requests/${r.id}`}
                      className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                    >
                      Review →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
