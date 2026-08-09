"use client";

import { useState } from "react";
import Link from "next/link";
import { ProposalStatusBadge } from "@/components/members/proposal-status-timeline";

export interface ProposalReviewRow {
  id: string;
  projectName: string;
  type: string | null;
  chairName: string | null;
  status: string;
  submittedAt: string | null; // ISO
  proposerName: string | null;
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "submitted", label: "Submitted" },
  { value: "under_review", label: "Under Review" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
  { value: "deferred", label: "Deferred" },
] as const;

function typeLabel(type: string | null): string {
  if (type === "fundraiser") return "Fundraiser";
  if (type === "service_project") return "Service Project";
  if (type === "both") return "Both";
  return "—";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Board review list. "use client" because the status filter is local UI
 * state over an already-fetched, already-excludes-drafts list (Phase 3
 * Component Plan) — not a URL/server round trip.
 */
export function ProposalReviewTable({ proposals }: { proposals: ProposalReviewRow[] }) {
  const [filter, setFilter] = useState<string>("all");

  const filtered = filter === "all" ? proposals : proposals.filter((p) => p.status === filter);

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
          <p>No proposals match this filter.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Project
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Type
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Chair
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
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="text-sm font-semibold text-gray-900">{p.projectName}</div>
                    {p.proposerName && <div className="text-xs text-gray-500">by {p.proposerName}</div>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{typeLabel(p.type)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{p.chairName || "—"}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{formatDate(p.submittedAt)}</td>
                  <td className="px-4 py-3">
                    <ProposalStatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/proposals/${p.id}`}
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
