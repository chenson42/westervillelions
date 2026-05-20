"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AdminRsvpRow } from "@/types/admin-rsvp";
import { WriteInForm } from "@/components/admin/write-in-form";

interface AdminEventRsvpTableProps {
  eventId: string;
  rows: AdminRsvpRow[];
  members: { id: string; name: string }[];
  extraQuestion?: string | null;
  maxAttendees?: number | null;
}

function statusBadgeClass(status: string): string {
  if (status === "attending")
    return "inline-flex rounded-full px-2 text-xs font-semibold leading-5 bg-green-100 text-green-800";
  if (status === "maybe")
    return "inline-flex rounded-full px-2 text-xs font-semibold leading-5 bg-yellow-100 text-yellow-800";
  return "inline-flex rounded-full px-2 text-xs font-semibold leading-5 bg-red-100 text-red-800";
}

export function AdminEventRsvpTable({ eventId, rows: initialRows, members, extraQuestion, maxAttendees }: AdminEventRsvpTableProps) {
  const router = useRouter();
  const [rows, setRows] = useState<AdminRsvpRow[]>(initialRows);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Inline edit state for guest rows
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [saving, setSaving] = useState(false);

  const existingUserIds = rows.map((r) => r.userId).filter(Boolean) as string[];
  const availableMembers = members.filter((m) => !existingUserIds.includes(m.id));

  const attendingTotal = rows
    .filter((r) => r.status === "attending")
    .reduce((sum, r) => sum + 1 + (r.guestCount ?? 0), 0);

  async function handleRemove(row: AdminRsvpRow) {
    if (!row.userId && !row.isGuest) return; // should never fire given the button guard
    setRemovingId(row.id);
    try {
      const body = row.userId
        ? { userId: row.userId }
        : { rsvpId: row.id };
      const res = await fetch(`/api/admin/events/${eventId}/signup`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to remove signup");
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success(row.isGuest ? "Guest removed" : "Signup removed");
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
        body: JSON.stringify({ kind: "member", userId: selectedUserId }),
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
      router.refresh();
    } finally {
      setAdding(false);
    }
  }

  function startEdit(row: AdminRsvpRow) {
    setEditingId(row.id);
    setEditName(row.name ?? "");
    setEditEmail(row.email ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditEmail("");
  }

  async function handleSaveEdit(row: AdminRsvpRow) {
    const trimmedName = editName.trim();
    if (!trimmedName) {
      toast.error("Guest name is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/signup/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestName: trimmedName,
          guestEmail: editEmail.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to update guest.");
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? { ...r, name: trimmedName, email: editEmail.trim() || null }
            : r
        )
      );
      setEditingId(null);
      toast.success("Guest updated");
      router.refresh();
    } finally {
      setSaving(false);
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
                {extraQuestion && (
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    {extraQuestion}
                  </th>
                )}
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
                    {editingId === rsvp.id ? (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Guest name"
                          className="rounded-md border border-gray-300 text-sm px-2 py-1 focus:outline-none focus:ring-2 focus:ring-lions-blue min-w-0"
                          autoFocus
                        />
                        <input
                          type="email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          placeholder="Email (optional)"
                          className="rounded-md border border-gray-300 text-sm px-2 py-1 focus:outline-none focus:ring-2 focus:ring-lions-blue min-w-0"
                        />
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(rsvp)}
                            disabled={saving}
                            className="text-xs font-semibold text-white bg-lions-blue hover:bg-lions-blue-dark rounded px-2 py-1 transition disabled:opacity-50"
                          >
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={saving}
                            className="text-xs font-semibold text-gray-600 hover:text-gray-900 rounded px-2 py-1 border border-gray-300 transition disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                          {rsvp.isGuest ? (
                            <button
                              type="button"
                              onClick={() => startEdit(rsvp)}
                              className="hover:underline text-left"
                              title="Click to edit"
                            >
                              {rsvp.name || "—"}
                            </button>
                          ) : (
                            <span>{rsvp.name || "—"}</span>
                          )}
                          {rsvp.isGuest && (
                            <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs font-medium">
                              Guest
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">
                          {rsvp.email || ""}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={statusBadgeClass(rsvp.status)}>
                      {rsvp.status.charAt(0).toUpperCase() + rsvp.status.slice(1)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {rsvp.guestCount ?? 0}
                  </td>
                  {extraQuestion && (
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {rsvp.extraAnswer || <span className="text-gray-400">—</span>}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {new Date(rsvp.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {(rsvp.userId || rsvp.isGuest) && (
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

      {/* Write-in guest form — non-recurring path (no occurrenceDate) */}
      <WriteInForm
        eventId={eventId}
        occurrenceCapacity={maxAttendees}
        occurrenceAttendingCount={attendingTotal}
        onAdded={(row) => {
          setRows((prev) => [...prev, row]);
          router.refresh();
        }}
      />
    </div>
  );
}
