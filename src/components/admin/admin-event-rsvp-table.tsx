"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface RsvpRow {
  id: string;
  userId: string | null;
  status: string;
  guestCount: number | null;
  createdAt: string;
  userName: string | null;
  userEmail: string | null;
  rsvpName: string | null;
  rsvpEmail: string | null;
}

interface AdminEventRsvpTableProps {
  eventId: string;
  rows: RsvpRow[];
  members: { id: string; name: string }[];
}

function statusBadgeClass(status: string): string {
  if (status === "attending")
    return "inline-flex rounded-full px-2 text-xs font-semibold leading-5 bg-green-100 text-green-800";
  if (status === "maybe")
    return "inline-flex rounded-full px-2 text-xs font-semibold leading-5 bg-yellow-100 text-yellow-800";
  return "inline-flex rounded-full px-2 text-xs font-semibold leading-5 bg-red-100 text-red-800";
}

export function AdminEventRsvpTable({ eventId, rows: initialRows, members }: AdminEventRsvpTableProps) {
  const router = useRouter();
  const [rows, setRows] = useState<RsvpRow[]>(initialRows);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const existingUserIds = rows.map((r) => r.userId).filter(Boolean) as string[];
  const availableMembers = members.filter((m) => !existingUserIds.includes(m.id));

  async function handleRemove(row: RsvpRow) {
    if (!row.userId) return;
    setRemovingId(row.id);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/signup`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to remove signup");
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success("Signup removed");
      router.refresh();
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
        body: JSON.stringify({ userId: selectedUserId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !data.alreadyExists) {
        toast.error(data.error ?? "Failed to add signup");
        return;
      }
      if (data.alreadyExists) {
        toast.info("Member is already signed up");
        return;
      }
      const member = members.find((m) => m.id === selectedUserId);
      setRows((prev) => [
        ...prev,
        {
          id: data.id,
          userId: selectedUserId,
          status: "attending",
          guestCount: 0,
          createdAt: data.createdAt,
          userName: member?.name ?? null,
          userEmail: null,
          rsvpName: null,
          rsvpEmail: null,
        },
      ]);
      setSelectedUserId("");
      toast.success("Member added");
      router.refresh();
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-4">
      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-md border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Guests
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Date RSVPd
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {rows.map((rsvp) => (
                <tr key={rsvp.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">
                      {rsvp.userName || rsvp.rsvpName || "—"}
                    </div>
                    <div className="text-xs text-gray-500">
                      {rsvp.userEmail || rsvp.rsvpEmail || ""}
                      {rsvp.rsvpEmail && (
                        <span className="ml-1 text-gray-400">(guest)</span>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={statusBadgeClass(rsvp.status)}>
                      {rsvp.status.charAt(0).toUpperCase() + rsvp.status.slice(1)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {rsvp.guestCount ?? 0}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {new Date(rsvp.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {rsvp.userId && (
                      <button
                        type="button"
                        onClick={() => handleRemove(rsvp)}
                        disabled={removingId === rsvp.id}
                        className="text-xs text-gray-400 hover:text-red-500 transition font-medium disabled:opacity-50"
                      >
                        {removingId === rsvp.id ? "Removing…" : "Remove"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-gray-500">No RSVPs yet.</p>
      )}

      {/* Add Member form */}
      {availableMembers.length > 0 && (
        <div className="flex items-center gap-2 pt-2">
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
  );
}
