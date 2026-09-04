"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { parseWallClock } from "@/lib/events";

interface EventOption {
  id: string;
  title: string;
  startDate: string;
}

/**
 * Searchable multi-select for attaching a Club File to events (docs/
 * work-log/2026-09-04-club-documents.md, Phase 3 Component Plan). Sends the
 * COMPLETE desired set of eventIds on every save — PUT
 * /api/admin/club-files/[id]/attachments is full-set-replace semantics; the
 * server computes the insert/delete diff, so this component never diffs
 * client-side.
 */
export function EventAttachPicker({
  fileId,
  initialEventIds,
}: {
  fileId: string;
  initialEventIds: string[];
}) {
  const router = useRouter();
  const [events, setEvents] = useState<EventOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialEventIds));
  const [query, setQuery] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/events")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load events");
        return res.json();
      })
      .then((data: EventOption[]) => {
        if (!cancelled) setEvents(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load the event list. Try reloading the page.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!events) return [];
    const q = query.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) => e.title.toLowerCase().includes(q));
  }, [events, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/club-files/${fileId}/attachments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventIds: Array.from(selected) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save attachments");
      }
      toast.success("Event attachments saved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save attachments");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Attach to events</h2>
        <p className="text-sm text-gray-500">
          {selected.size === 0
            ? "Not attached to any event."
            : `Attached to ${selected.size} event${selected.size === 1 ? "" : "s"}.`}
        </p>
      </div>

      {loadError && (
        <p className="text-sm text-red-600" role="alert">
          {loadError}
        </p>
      )}

      {!events && !loadError && <p className="text-sm text-gray-500">Loading events…</p>}

      {events && events.length === 0 && (
        <div className="bg-gray-50 rounded-2xl p-6 text-center text-gray-500 text-sm">No events exist yet.</div>
      )}

      {events && events.length > 0 && (
        <>
          <label htmlFor="event-attach-search" className="sr-only">
            Search events
          </label>
          <input
            id="event-attach-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search events…"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue"
          />

          <ul className="max-h-64 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
            {filtered.length === 0 ? (
              <li className="p-3 text-sm text-gray-400">No events match your search.</li>
            ) : (
              filtered.map((e) => (
                <li key={e.id}>
                  <label className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(e.id)}
                      onChange={() => toggle(e.id)}
                      className="focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                    />
                    <span className="flex-1 text-sm text-gray-900">{e.title}</span>
                    <span className="text-xs text-gray-400">
                      {format(parseWallClock(e.startDate), "MMM d, yyyy")}
                    </span>
                  </label>
                </li>
              ))
            )}
          </ul>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
          >
            {isSaving ? "Saving…" : "Save attachments"}
          </button>
        </>
      )}
    </div>
  );
}
