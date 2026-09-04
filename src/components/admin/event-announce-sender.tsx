"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EVENT_ANNOUNCEMENT_NOTE_MAX_LEN, type AnnouncementScope } from "@/lib/event-announcements";

interface RecipientSummary {
  memberId: string;
  firstName: string;
  lastName: string;
}

interface OccurrenceOption {
  date: string; // YYYY-MM-DD
  label: string;
}

interface EventAnnounceSenderProps {
  eventId: string;
  event: {
    title: string;
    isRecurring: boolean;
    isAllDay: boolean;
    location: string | null;
  };
  initialOccurrenceOptions: OccurrenceOption[];
  initialHasFutureOccurrence: boolean;
  initialRecipients: {
    withEmail: RecipientSummary[];
    withoutEmail: RecipientSummary[];
  };
}

type SkipReason = "no_longer_active" | "no_email_on_file" | "not_selected";

interface SentRow {
  memberId: string;
  success: boolean;
  error?: string;
  name?: string;
}

interface SkippedRow {
  memberId: string;
  reason: SkipReason;
  name?: string;
}

interface SendResult {
  scope: AnnouncementScope;
  occurrenceDate: string | null;
  sent: SentRow[];
  skipped: SkippedRow[];
}

const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  no_longer_active: "No longer an active member.",
  no_email_on_file: "No email address on file.",
  not_selected: "Not selected for this send.",
};

function fullName(r: { firstName: string; lastName: string }): string {
  return `${r.firstName} ${r.lastName}`;
}

/**
 * Occurrence-vs-series picker, cohort review (with-email selectable list +
 * no-email cohort shown, not dropped — Dues Reminders precedent), optional
 * note, ConfirmDialog before sending, and a persistent post-send summary.
 *
 * `/admin/events/[id]/announce`
 * (src/app/(dashboard)/admin/events/[id]/announce/page.tsx).
 *
 * See docs/work-log/2026-09-04-event-announcement-emails.md, Phase 3
 * "Component / Page Plan".
 */
export function EventAnnounceSender({
  eventId,
  event,
  initialOccurrenceOptions,
  initialHasFutureOccurrence,
  initialRecipients,
}: EventAnnounceSenderProps) {
  const [occurrenceOptions, setOccurrenceOptions] = useState(initialOccurrenceOptions);
  const [hasFutureOccurrence, setHasFutureOccurrence] = useState(initialHasFutureOccurrence);
  const [withEmail, setWithEmail] = useState(initialRecipients.withEmail);
  const [withoutEmail, setWithoutEmail] = useState(initialRecipients.withoutEmail);

  // Non-recurring events never offer a series option (Phase 3 Edge Cases:
  // "Non-recurring events never get scope: 'series' rows") — the picker is
  // hidden entirely and scope defaults silently to "occurrence".
  const [scope, setScope] = useState<AnnouncementScope>("occurrence");
  const [occurrenceDate, setOccurrenceDate] = useState<string>(
    initialOccurrenceOptions[0]?.date ?? "",
  );
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialRecipients.withEmail.map((m) => m.memberId)),
  );
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  const selectedCount = selected.size;
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of [...withEmail, ...withoutEmail]) map.set(m.memberId, fullName(m));
    return map;
  }, [withEmail, withoutEmail]);

  function toggle(memberId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(withEmail.map((m) => m.memberId)) : new Set());
  }

  async function loadPreview() {
    const res = await fetch(`/api/admin/events/${eventId}/announce`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || "Could not refresh the announcement preview.");
      return null;
    }
    return data as {
      occurrenceOptions: OccurrenceOption[];
      hasFutureOccurrence: boolean;
      recipients: { withEmail: RecipientSummary[]; withoutEmail: RecipientSummary[] };
    };
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const data = await loadPreview();
      if (!data) return;
      setOccurrenceOptions(data.occurrenceOptions);
      setHasFutureOccurrence(data.hasFutureOccurrence);
      setWithEmail(data.recipients.withEmail);
      setWithoutEmail(data.recipients.withoutEmail);
      setSelected(new Set(data.recipients.withEmail.map((m) => m.memberId)));
      if (!data.occurrenceOptions.some((o) => o.date === occurrenceDate)) {
        setOccurrenceDate(data.occurrenceOptions[0]?.date ?? "");
      }
      toast.success("Announcement preview refreshed.");
    } catch {
      toast.error("Could not reach the server. Try again.");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSend() {
    setSending(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/announce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          ...(scope === "occurrence" ? { occurrenceDate } : {}),
          note: note.trim() || undefined,
          memberIds: Array.from(selected),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Could not send the announcement.");
        return;
      }
      const sent: SentRow[] = (data.sent ?? []).map((s: SentRow) => ({
        ...s,
        name: nameById.get(s.memberId),
      }));
      const skipped: SkippedRow[] = (data.skipped ?? []).map((s: SkippedRow) => ({
        ...s,
        name: nameById.get(s.memberId),
      }));
      setResult({ scope: data.scope, occurrenceDate: data.occurrenceDate, sent, skipped });

      const successCount = sent.filter((s) => s.success).length;
      const failCount = sent.length - successCount;
      if (sent.length === 0) {
        toast.warning("Nobody was emailed — see the results below.");
      } else if (failCount === 0) {
        toast.success(`Emailed ${successCount} of ${sent.length} member${sent.length === 1 ? "" : "s"}.`);
      } else {
        toast.error(`Emailed ${successCount} of ${sent.length} — ${failCount} failed. See details below.`);
      }
      setNote("");

      const refreshed = await loadPreview();
      if (refreshed) {
        setOccurrenceOptions(refreshed.occurrenceOptions);
        setHasFutureOccurrence(refreshed.hasFutureOccurrence);
        setWithEmail(refreshed.recipients.withEmail);
        setWithoutEmail(refreshed.recipients.withoutEmail);
        setSelected(new Set(refreshed.recipients.withEmail.map((m) => m.memberId)));
      }
    } catch {
      toast.error("Could not reach the server. Try again.");
    } finally {
      setSending(false);
      setConfirmOpen(false);
    }
  }

  const scopeLabel =
    scope === "series"
      ? "the whole recurring series"
      : occurrenceOptions.find((o) => o.date === occurrenceDate)?.label ?? "the selected occurrence";

  const confirmDescription = `This emails ${selectedCount} member${
    selectedCount === 1 ? "" : "s"
  } about ${scopeLabel}, with a calendar invite attached. This sends real email and cannot be undone.`;

  const sendDisabled =
    sending || !hasFutureOccurrence || selectedCount === 0 || (scope === "occurrence" && !occurrenceDate);

  return (
    <div className="space-y-6">
      {!hasFutureOccurrence && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">Nothing upcoming to announce</p>
          <p>This event has no upcoming occurrences, so there&apos;s nothing to send an announcement about.</p>
        </div>
      )}

      {hasFutureOccurrence && event.isRecurring && (
        <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">What are you announcing?</h2>
            <p className="text-sm text-gray-500">Pick one upcoming date, or the whole recurring series.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="scope"
                checked={scope === "occurrence"}
                onChange={() => setScope("occurrence")}
                className="h-4 w-4 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
              />
              A single occurrence
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="scope"
                checked={scope === "series"}
                onChange={() => setScope("series")}
                className="h-4 w-4 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
              />
              The whole recurring series
            </label>
          </div>
          {scope === "occurrence" && (
            <div>
              <label htmlFor="occurrence-date" className="mb-1 block text-sm font-medium text-gray-700">
                Occurrence
              </label>
              <select
                id="occurrence-date"
                value={occurrenceDate}
                onChange={(e) => setOccurrenceDate(e.target.value)}
                className="block w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              >
                {occurrenceOptions.map((o) => (
                  <option key={o.date} value={o.date}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {hasFutureOccurrence && !event.isRecurring && (
        <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6 text-sm text-gray-600">
          This is a one-time event on{" "}
          <span className="font-medium text-gray-900">
            {occurrenceOptions[0]?.label ?? "its scheduled date"}
          </span>
          .
        </div>
      )}

      {hasFutureOccurrence && (
        <>
          {/* With-email cohort */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 sm:px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Will be emailed ({withEmail.length})
                </h2>
                <p className="text-sm text-gray-500">Every active member with an email on file. Selected by default.</p>
              </div>
              {withEmail.length > 0 && (
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={withEmail.every((m) => selected.has(m.memberId))}
                    onChange={(e) => toggleAll(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
                  />
                  Select all
                </label>
              )}
            </div>
            {withEmail.length === 0 ? (
              <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 m-4">
                No active members have an email on file.
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
                {withEmail.map((m) => (
                  <label
                    key={m.memberId}
                    className="flex items-center gap-3 px-4 sm:px-6 py-3 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(m.memberId)}
                      onChange={() => toggle(m.memberId)}
                      className="h-5 w-5 shrink-0 rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
                    />
                    <span className="text-sm font-medium text-gray-900">{fullName(m)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* No-email cohort — shown, not dropped (Dues Reminders precedent) */}
          {withoutEmail.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 sm:px-6 py-3">
              <p className="mb-2 text-sm font-medium text-amber-800">
                No email on file ({withoutEmail.length}) — won&apos;t be emailed
              </p>
              <ul className="space-y-1 text-sm text-amber-700 max-h-40 overflow-y-auto">
                {withoutEmail.map((m) => (
                  <li key={m.memberId}>{fullName(m)}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Optional note */}
          <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6">
            <label htmlFor="announcement-note" className="mb-1 block text-sm font-medium text-gray-700">
              Add a note for recipients (optional)
            </label>
            <textarea
              id="announcement-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, EVENT_ANNOUNCEMENT_NOTE_MAX_LEN))}
              rows={3}
              maxLength={EVENT_ANNOUNCEMENT_NOTE_MAX_LEN}
              placeholder="e.g. Hope to see you there — bring a friend!"
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
            <p className="mt-1 text-xs text-gray-400">
              {note.length}/{EVENT_ANNOUNCEMENT_NOTE_MAX_LEN}
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="min-h-[44px] rounded-lg border-2 border-lions-blue px-4 py-2 text-sm font-semibold text-lions-blue transition hover:bg-lions-blue/5 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={sendDisabled}
              className="min-h-[44px] rounded-lg bg-lions-blue px-6 py-3 font-semibold text-white transition hover:bg-lions-blue-dark disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              {sending ? "Sending…" : `Send to ${selectedCount} member${selectedCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Send this announcement?"
        description={confirmDescription}
        confirmLabel={sending ? "Sending…" : "Send Announcement"}
        // Deliberately NOT `destructive` — sending mail is consequential but
        // not a delete. See Phase 3 Component Plan.
        onConfirm={() => void handleSend()}
      />

      {/* Persistent post-send summary — survives after the toast disappears */}
      {result && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="border-b border-gray-100 px-4 sm:px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Send results</h2>
            <p className="text-sm text-gray-500">
              Emailed {result.sent.filter((s) => s.success).length} of {result.sent.length} member
              {result.sent.length === 1 ? "" : "s"}
              {result.sent.some((s) => !s.success) ? " — some failed, see below." : "."}
            </p>
          </div>
          {result.sent.length === 0 ? (
            <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 m-4">
              Nobody was emailed this time.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {result.sent.map((s) => (
                <div key={s.memberId} className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3">
                  <div className="min-w-0 truncate text-sm font-medium text-gray-900">
                    {s.name ?? "A member"}
                  </div>
                  {s.success ? (
                    <span className="inline-flex shrink-0 items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      Emailed
                    </span>
                  ) : (
                    <span
                      className="inline-flex shrink-0 items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800"
                      title={s.error}
                    >
                      Failed
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {result.skipped.length > 0 && (
            <div className="border-t border-gray-100 bg-gray-50 px-4 sm:px-6 py-3">
              <p className="mb-2 text-sm font-medium text-gray-700">Not sent ({result.skipped.length})</p>
              <ul className="space-y-1 text-sm text-gray-600">
                {result.skipped.map((s) => (
                  <li key={s.memberId}>
                    {s.name ?? "A member"} — {SKIP_REASON_LABEL[s.reason]}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
