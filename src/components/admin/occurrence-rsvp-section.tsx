"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import { AdminRsvpRow } from "@/types/admin-rsvp";
import { WriteInForm } from "@/components/admin/write-in-form";

interface OccurrenceGroup {
  date: string; // ISO timestamp, sent as `occurrenceDate` to signup/RSVP APIs (preserves wall-clock time)
  dateKey: string; // YYYY-MM-DD wall-clock date, derived server-side via dateKey() — used for the cancel URL segment
  displayDate: string;
  isPast: boolean;
  isCancelled: boolean;
  cancellationReason: string | null;
  isOrphan: boolean;
  maxAttendees: number | null;
  rows: AdminRsvpRow[];
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
  const [rows, setRows] = useState<AdminRsvpRow[]>(group.rows);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Cancellation state — managed locally so the UI updates immediately after API call
  const [isCancelled, setIsCancelled] = useState(group.isCancelled);
  const [cancellationReason, setCancellationReason] = useState<string | null>(
    group.cancellationReason
  );

  // Cancel dialog (with reason textarea) — uses Radix Dialog directly since ConfirmDialog
  // has no children prop and we need a textarea inside the modal
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // Restore dialog — simple confirm, uses ConfirmDialog
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Inline edit state for guest rows
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [saving, setSaving] = useState(false);

  // Wall-clock date key computed server-side via dateKey() — never round-trips through UTC.
  // Slicing group.date.slice(0,10) here would silently produce the wrong date for late-evening
  // or early-morning events whenever server or client timezone shifts the ISO past midnight.
  const occurrenceDateKey = group.dateKey;

  async function handleCancel() {
    setCancelling(true);
    try {
      const res = await fetch(
        `/api/admin/events/${eventId}/occurrences/${occurrenceDateKey}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cancelled: true, reason: cancelReason.trim() }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to cancel occurrence. Please try again.");
        return;
      }
      const data = await res.json();
      setIsCancelled(true);
      setCancellationReason(data.cancellationReason ?? null);
      setCancelReason("");
      setCancelDialogOpen(false);
      toast.success("Occurrence cancelled.");
    } finally {
      setCancelling(false);
    }
  }

  async function handleRestore() {
    setRestoring(true);
    try {
      const res = await fetch(
        `/api/admin/events/${eventId}/occurrences/${occurrenceDateKey}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cancelled: false }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to restore occurrence. Please try again.");
        return;
      }
      setIsCancelled(false);
      setCancellationReason(null);
      setRestoreDialogOpen(false);
      toast.success("Occurrence restored.");
    } finally {
      setRestoring(false);
    }
  }

  const existingUserIds = rows.map((r) => r.userId).filter(Boolean) as string[];
  const availableMembers = members.filter((m) => !existingUserIds.includes(m.id));
  const attendingRows = rows.filter((r) => r.status === "attending");
  const attendingTotal = attendingRows.reduce(
    (sum, r) => sum + 1 + (r.guestCount ?? 0),
    0
  );

  async function handleRemove(row: AdminRsvpRow) {
    if (!row.userId && !row.isGuest) return; // should never fire given the button guard
    setRemovingId(row.id);
    try {
      const body = row.userId
        ? { userId: row.userId, occurrenceDate: group.date }
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
        body: JSON.stringify({ kind: "member", userId: selectedUserId, occurrenceDate: group.date }),
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
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`rounded-md border overflow-hidden ${
        isCancelled ? "border-amber-200" : "border-gray-200"
      } ${group.isPast ? "opacity-60" : ""}`}
    >
      {/* Header row — always visible */}
      <div
        className={`flex items-center justify-between gap-3 px-4 py-3 ${
          isCancelled ? "bg-amber-50" : "bg-gray-50"
        }`}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 flex items-center gap-2 min-w-0 text-left hover:opacity-80 transition"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 flex-shrink-0 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-400" />
          )}
          <span className="text-sm font-semibold text-gray-900 truncate">
            {group.displayDate}
          </span>
          {group.isPast && !isCancelled && (
            <span className="flex-shrink-0 text-xs font-medium text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
              Past
            </span>
          )}
          {isCancelled && (
            <span className="flex-shrink-0 text-xs font-semibold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">
              Cancelled
            </span>
          )}
        </button>

        {/* Count + cancel/restore buttons */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {group.maxAttendees != null ? (
            <span className="text-sm">
              <span className={`font-semibold ${attendingTotal > group.maxAttendees ? "text-amber-600" : "text-gray-600"}`}>
                {attendingTotal}
              </span>
              <span className="text-gray-400"> / {group.maxAttendees}</span>
              <span className="text-gray-400"> (incl. guests)</span>
            </span>
          ) : (
            <span className="text-sm text-gray-600">
              <span className="font-semibold">{attendingTotal}</span>
              <span className="text-gray-400"> attendees (incl. guests)</span>
            </span>
          )}

          {/* Cancel / Restore button — not shown on orphan rows since they are already
              cancelled but have no ISO timestamp to derive a valid occurrence date from */}
          {!group.isOrphan && (
            isCancelled ? (
              <button
                type="button"
                onClick={() => setRestoreDialogOpen(true)}
                disabled={restoring}
                className="text-xs font-semibold text-lions-blue hover:text-lions-blue-dark transition disabled:opacity-50"
              >
                Restore
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCancelDialogOpen(true)}
                disabled={cancelling}
                className="text-xs font-semibold text-gray-500 hover:text-amber-700 transition disabled:opacity-50"
              >
                Cancel
              </button>
            )
          )}
        </div>
      </div>

      {/* Cancellation reason (shown under header when cancelled) */}
      {isCancelled && cancellationReason && (
        <div className="px-4 py-2 bg-amber-50 border-t border-amber-100 text-xs text-amber-800">
          Reason: {cancellationReason}
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="bg-white">
          {isCancelled && rows.length > 0 && (
            <p className="px-4 pt-3 text-xs text-gray-400 italic">
              Signups below were recorded before this occurrence was cancelled.
            </p>
          )}
          {rows.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-400 italic">
              {isCancelled ? "No signups were recorded for this occurrence." : "No signups for this occurrence."}
            </p>
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
                      {editingId === row.id ? (
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
                              onClick={() => handleSaveEdit(row)}
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
                            {row.isGuest && !isCancelled ? (
                              <button
                                type="button"
                                onClick={() => startEdit(row)}
                                className="hover:underline text-left"
                                title="Click to edit"
                              >
                                {row.name || "—"}
                              </button>
                            ) : (
                              <span>{row.name || "—"}</span>
                            )}
                            {row.isGuest && (
                              <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs font-medium">
                                Guest
                              </span>
                            )}
                          </div>
                          {row.email && (
                            <div className="text-xs text-gray-500">
                              {row.email}
                            </div>
                          )}
                        </>
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
                      {(row.userId || row.isGuest) && !isCancelled && (
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

          {/* Add Member form — suppressed on cancelled occurrences */}
          {!isCancelled && availableMembers.length > 0 && (
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

          {/* Write-in guest form — suppressed on cancelled occurrences */}
          {!isCancelled && (
            <WriteInForm
              eventId={eventId}
              occurrenceDate={group.date}
              occurrenceCapacity={group.maxAttendees}
              occurrenceAttendingCount={attendingTotal}
              onAdded={(row) => setRows((prev) => [...prev, row])}
            />
          )}
        </div>
      )}

      {/* Cancel dialog — uses Radix Dialog directly to include the optional reason textarea */}
      <Dialog.Root open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
            <Dialog.Title className="text-lg font-semibold text-gray-900">
              Cancel this occurrence?
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-gray-600">
              Members will see a &ldquo;Cancelled&rdquo; badge for this date. This action is
              reversible — you can restore it at any time.
            </Dialog.Description>
            <div className="mt-4">
              <label
                htmlFor="cancel-reason"
                className="block text-sm font-medium text-gray-700"
              >
                Reason <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                id="cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="e.g. No market on July 4"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue resize-none"
              />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Dialog.Close
                disabled={cancelling}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
              >
                Dismiss
              </Dialog.Close>
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 transition disabled:opacity-50"
              >
                {cancelling ? "Cancelling…" : "Cancel Occurrence"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Restore dialog — simple confirm via ConfirmDialog */}
      <ConfirmDialog
        open={restoreDialogOpen}
        onOpenChange={setRestoreDialogOpen}
        title="Restore this occurrence?"
        description="The occurrence will be marked as active again and members will be able to sign up."
        confirmLabel={restoring ? "Restoring…" : "Restore"}
        onConfirm={handleRestore}
      />
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
