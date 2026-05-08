"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

interface RsvpRowData {
  id: string;
  userId: string | null;
  status: string;
  createdAt: string; // ISO
  name: string | null;
  email: string | null;
  isGuest: boolean;
  guestCount: number | null;
  extraAnswer: string | null;
}

interface OccurrenceGroup {
  date: string; // ISO
  displayDate: string;
  isPast: boolean;
  maxAttendees: number | null;
  rows: RsvpRowData[];
}

interface AdminOccurrenceRsvpSectionProps {
  occurrenceGroups: OccurrenceGroup[];
  eventId: string;
  members: { id: string; name: string }[];
  extraQuestion?: string | null;
}

function statusBadgeClass(status: string): string {
  if (status === "attending")
    return "inline-flex rounded-full px-2 text-xs font-semibold leading-5 bg-green-100 text-green-800";
  if (status === "maybe")
    return "inline-flex rounded-full px-2 text-xs font-semibold leading-5 bg-yellow-100 text-yellow-800";
  return "inline-flex rounded-full px-2 text-xs font-semibold leading-5 bg-red-100 text-red-800";
}

function OccurrenceAccordionRow({
  group,
  eventId,
  members,
  extraQuestion,
}: {
  group: OccurrenceGroup;
  eventId: string;
  members: { id: string; name: string }[];
  extraQuestion?: string | null;
}) {
  // Past occurrences with no signups start collapsed; all others start expanded if they have signups
  const [expanded, setExpanded] = useState(!group.isPast && group.rows.length > 0);
  const [rows, setRows] = useState<RsvpRowData[]>(group.rows);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const existingUserIds = rows.map((r) => r.userId).filter(Boolean) as string[];
  const availableMembers = members.filter((m) => !existingUserIds.includes(m.id));
  const attendingRows = rows.filter((r) => r.status === "attending");
  const attendingTotal = attendingRows.reduce(
    (sum, r) => sum + 1 + (r.guestCount ?? 0),
    0
  );

  async function handleRemove(row: RsvpRowData) {
    if (!row.userId) return;
    setRemovingId(row.id);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/signup`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.userId, occurrenceDate: group.date }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to remove signup");
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success("Signup removed");
    } finally {
      setRemovingId(null);
    }
  }

  async function handleAdd() {
    if (!selectedUserId) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUserId, occurrenceDate: group.date }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !data.alreadyExists) {
        toast.error(data.error ?? "Failed to add signup");
        return;
      }
      if (data.alreadyExists) {
        toast.info("Member is already signed up for this occurrence");
        return;
      }
      const member = members.find((m) => m.id === selectedUserId);
      setRows((prev) => [
        ...prev,
        {
          id: data.id,
          userId: selectedUserId,
          status: "attending",
          createdAt: data.createdAt,
          name: member?.name ?? null,
          email: null,
          isGuest: false,
          guestCount: 0,
          extraAnswer: null,
        },
      ]);
      setSelectedUserId("");
      toast.success("Member added");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className={`rounded-md border border-gray-200 overflow-hidden ${group.isPast ? "opacity-60" : ""}`}>
      {/* Header row — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? (
            <ChevronDown className="h-4 w-4 flex-shrink-0 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-400" />
          )}
          <span className="text-sm font-semibold text-gray-900 truncate">{group.displayDate}</span>
          {group.isPast && (
            <span className="flex-shrink-0 text-xs font-medium text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
              Past
            </span>
          )}
        </div>
        <div className="flex-shrink-0 text-sm text-gray-600 text-right">
          {group.maxAttendees != null ? (
            <span>
              <span className="font-semibold">{attendingTotal}</span>
              <span className="text-gray-400"> / {group.maxAttendees}</span>
              <span className="text-gray-400"> (incl. guests)</span>
            </span>
          ) : (
            <span>
              <span className="font-semibold">{attendingTotal}</span>
              <span className="text-gray-400"> attendees (incl. guests)</span>
            </span>
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="bg-white">
          {rows.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-400 italic">No signups for this occurrence.</p>
          ) : (
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Name
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Status
                  </th>
                  {extraQuestion && (
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {extraQuestion}
                    </th>
                  )}
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Signed Up
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">
                        {row.name || "—"}
                      </div>
                      {row.email && (
                        <div className="text-xs text-gray-500">
                          {row.email}
                          {row.isGuest && (
                            <span className="ml-1 text-gray-400">(guest)</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={statusBadgeClass(row.status)}>
                        {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
                      </span>
                    </td>
                    {extraQuestion && (
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {row.extraAnswer || <span className="text-gray-400">—</span>}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {new Date(row.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {row.userId && (
                        <button
                          type="button"
                          onClick={() => handleRemove(row)}
                          disabled={removingId === row.id}
                          className="text-xs text-gray-400 hover:text-red-500 transition font-medium disabled:opacity-50"
                        >
                          {removingId === row.id ? "Removing…" : "Remove"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Add Member form */}
          {availableMembers.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-100">
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="rounded-md border border-gray-300 text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                <option value="">Select a member…</option>
                {availableMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAdd}
                disabled={!selectedUserId || adding}
                className="bg-lions-blue text-white px-3 py-1.5 rounded-md text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-50"
              >
                {adding ? "Adding…" : "Add"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AdminOccurrenceRsvpSection({
  occurrenceGroups,
  eventId,
  members,
  extraQuestion,
}: AdminOccurrenceRsvpSectionProps) {
  return (
    <div className="space-y-2">
      {occurrenceGroups.map((group) => (
        <OccurrenceAccordionRow
          key={group.date}
          group={group}
          eventId={eventId}
          members={members}
          extraQuestion={extraQuestion}
        />
      ))}
    </div>
  );
}
