"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MINUTES_KINDS, minutesKindLabel } from "@/lib/minutes";
import { MotionsEditor, type MotionRow } from "./motions-editor";
import { ActionItemsEditor, type ActionItemRow } from "./action-items-editor";
import { MinutesBodyEditor } from "./minutes-body-editor";

export interface EventOption {
  id: string;
  label: string;
}

export interface MemberOption {
  id: string;
  label: string;
}

export interface InitialMinutesData {
  kind: string;
  eventId: string | null;
  meetingDate: string;
  title: string | null;
  presentCount: number | null;
  notetakerMemberId: string | null;
  bodyMarkdown: string | null;
  motions: { text: string; moverName: string; seconderName: string | null; result: string }[];
  actionItems: { text: string; ownerName: string; dueDate: string | null }[];
}

interface MinutesFormProps {
  mode: "create" | "edit";
  minutesId?: string;
  eventOptions: EventOption[];
  memberOptions: MemberOption[];
  /** The signed-in user's own linked member id, if they have one — used
   *  ONLY to pre-select the notetaker picker when it doesn't already have a
   *  value (a fresh create, or a draft nobody has set a notetaker on yet).
   *  Never overrides an already-recorded notetaker; "freely changeable"
   *  either way. */
  currentMemberId?: string | null;
  initial?: InitialMinutesData;
  /** Fired after a successful save. Create mode navigates to the new
   *  record's detail page itself; edit mode leaves navigation to the
   *  caller (the [id] page needs to refresh + surface the post-save email
   *  prompt in place, per Phase 3's "appears after every successful
   *  save"). */
  onSaved?: (id: string) => void;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function MinutesForm({
  mode,
  minutesId,
  eventOptions,
  memberOptions,
  currentMemberId,
  initial,
  onSaved,
}: MinutesFormProps) {
  const router = useRouter();
  const [kind, setKind] = useState(initial?.kind ?? MINUTES_KINDS[0]);
  const [eventId, setEventId] = useState(initial?.eventId ?? "");
  const [meetingDate, setMeetingDate] = useState(initial?.meetingDate ?? todayIsoDate());
  const [title, setTitle] = useState(initial?.title ?? "");
  // A single headcount, not a roster — DECISION-079. Kept as a text-backed
  // string in state so the field can be legitimately empty (no count taken)
  // without fighting a numeric input's own coercion of "" to 0.
  const [presentCount, setPresentCount] = useState(
    initial?.presentCount !== null && initial?.presentCount !== undefined ? String(initial.presentCount) : "",
  );
  // Notetaker OF RECORD — who took the minutes, not who's typing them in
  // (that's authorUserId, stamped server-side, never shown here). Defaults
  // to the signed-in user's own linked member id ONLY when no notetaker has
  // been recorded yet (a fresh create, or a still-unset draft) — an
  // already-recorded notetaker is never silently overridden by whoever
  // happens to open the record next.
  const [notetakerMemberId, setNotetakerMemberId] = useState(
    initial?.notetakerMemberId ?? currentMemberId ?? "",
  );
  const [bodyMarkdown, setBodyMarkdown] = useState(initial?.bodyMarkdown ?? "");
  const [saving, setSaving] = useState(false);

  const [motions, setMotions] = useState<MotionRow[]>(
    () =>
      initial?.motions.map((m) => ({
        text: m.text,
        moverName: m.moverName,
        seconderName: m.seconderName ?? "",
        result: (m.result as MotionRow["result"]) ?? "passed",
      })) ?? [],
  );
  const [actionItems, setActionItems] = useState<ActionItemRow[]>(
    () =>
      initial?.actionItems.map((a) => ({
        text: a.text,
        ownerName: a.ownerName,
        dueDate: a.dueDate ?? "",
      })) ?? [],
  );

  function buildPayload():
    | {
        kind: string;
        eventId: string | null;
        meetingDate: string;
        title: string | null;
        presentCount: number | null;
        notetakerMemberId: string | null;
        bodyMarkdown: string;
        motions: { text: string; moverName: string; seconderName: string | null; result: string }[];
        actionItems: { text: string; ownerName: string; dueDate: string | null }[];
      }
    | { error: string } {
    if (!meetingDate) return { error: "Enter the meeting date." };

    let presentCountValue: number | null = null;
    const trimmedCount = presentCount.trim();
    if (trimmedCount) {
      const parsed = Number(trimmedCount);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return { error: "Present count must be a whole number, 0 or greater." };
      }
      presentCountValue = parsed;
    }

    const motionsPayload: { text: string; moverName: string; seconderName: string | null; result: string }[] = [];
    for (const [i, m] of motions.entries()) {
      const text = m.text.trim();
      const moverName = m.moverName.trim();
      if (!text && !moverName) continue; // blank placeholder row — drop silently
      if (!text || !moverName) {
        return { error: `Motion ${i + 1} needs both motion text and who moved it.` };
      }
      motionsPayload.push({
        text,
        moverName,
        seconderName: m.seconderName.trim() || null,
        result: m.result,
      });
    }

    const actionItemsPayload: { text: string; ownerName: string; dueDate: string | null }[] = [];
    for (const [i, a] of actionItems.entries()) {
      const text = a.text.trim();
      const ownerName = a.ownerName.trim();
      if (!text && !ownerName) continue;
      if (!text || !ownerName) {
        return { error: `Action item ${i + 1} needs both a description and an owner.` };
      }
      actionItemsPayload.push({ text, ownerName, dueDate: a.dueDate || null });
    }

    return {
      kind,
      eventId: eventId || null,
      meetingDate,
      title: title.trim() || null,
      presentCount: presentCountValue,
      notetakerMemberId: notetakerMemberId || null,
      bodyMarkdown,
      motions: motionsPayload,
      actionItems: actionItemsPayload,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = buildPayload();
    if ("error" in payload) {
      toast.error(payload.error);
      return;
    }

    setSaving(true);
    try {
      const res =
        mode === "create"
          ? await fetch("/api/admin/minutes", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetch(`/api/admin/minutes/${minutesId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "update", ...payload }),
            });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not save minutes. Try again.");
      }
      const data: { id: string } = await res.json();
      toast.success(mode === "create" ? "Minutes draft created." : "Minutes saved.");

      if (mode === "create") {
        router.push(`/admin/minutes/${data.id}?justSaved=1`);
      } else {
        router.refresh();
        onSaved?.(data.id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save minutes. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="minutes-kind" className="block text-sm font-medium text-gray-700 mb-1">
            Kind
          </label>
          <select
            id="minutes-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
          >
            {MINUTES_KINDS.map((k) => (
              <option key={k} value={k}>
                {minutesKindLabel(k)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="minutes-meeting-date" className="block text-sm font-medium text-gray-700 mb-1">
            Meeting date
          </label>
          <input
            id="minutes-meeting-date"
            type="date"
            value={meetingDate}
            onChange={(e) => setMeetingDate(e.target.value)}
            required
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
          />
        </div>
        <div>
          <label htmlFor="minutes-event" className="block text-sm font-medium text-gray-700 mb-1">
            Linked meeting event (optional)
          </label>
          <select
            id="minutes-event"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
          >
            <option value="">No linked event (ad hoc / historical)</option>
            {eventOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="minutes-title" className="block text-sm font-medium text-gray-700 mb-1">
            Title (optional)
          </label>
          <input
            id="minutes-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="e.g. Officer Elections"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
          />
        </div>
        <div>
          <label htmlFor="minutes-present-count" className="block text-sm font-medium text-gray-700 mb-1">
            Members present (optional)
          </label>
          <input
            id="minutes-present-count"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={presentCount}
            onChange={(e) => setPresentCount(e.target.value)}
            placeholder="e.g. 22"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
          />
          <p className="mt-1 text-xs text-gray-500">A single headcount — not a per-member roster.</p>
        </div>
        <div>
          <label htmlFor="minutes-notetaker" className="block text-sm font-medium text-gray-700 mb-1">
            Notetaker (optional)
          </label>
          <select
            id="minutes-notetaker"
            value={notetakerMemberId}
            onChange={(e) => setNotetakerMemberId(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
          >
            <option value="">Not recorded</option>
            {memberOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Who took these minutes — not necessarily who&rsquo;s entering them here.
          </p>
        </div>
      </div>

      <MotionsEditor value={motions} onChange={setMotions} />

      <ActionItemsEditor value={actionItems} onChange={setActionItems} />

      <MinutesBodyEditor value={bodyMarkdown} onChange={setBodyMarkdown} />

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
        >
          {saving ? "Saving…" : "Save Draft"}
        </button>
      </div>
    </form>
  );
}
