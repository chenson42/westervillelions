"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export interface PendingVersionRow {
  id: string;
  versionNumber: number;
  changeNote: string;
  authorName: string | null;
  createdAt: string; // ISO
}

export interface NeedsCitationRow {
  id: string;
  versionNumber: number;
  adoptedAt: string; // ISO
}

export interface MinutesOption {
  id: string;
  label: string;
}

interface PendingVersionsPanelProps {
  slug: string;
  pending: PendingVersionRow[];
  needsCitation: NeedsCitationRow[];
  minutesOptions: MinutesOption[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Admin-only panel: review pending substantive amendments (Adopt, via
 * `<ConfirmDialog>` — never `window.confirm()`) and link a citing minutes
 * record onto an already-adopted version whose citation wasn't known yet at
 * adoption time (deliberately backfillable — Phase 3 "The Version
 * Lifecycle").
 *
 * Adopting is the one action here wrapped in `<ConfirmDialog>` (CLAUDE.md —
 * "adopting an amendment qualifies" as consequential): it is irreversible
 * and immediately becomes the club's operative governing text. Linking a
 * citation afterward is comparatively low-stakes (re-linkable, doesn't move
 * `currentVersionId`) and doesn't get the extra confirmation step.
 *
 * `"use client"` — fetch, component state, `<ConfirmDialog>` — mirrors
 * `minutes-status-actions.tsx`'s fetch-and-toast idiom exactly.
 */
export function PendingVersionsPanel({ slug, pending, needsCitation, minutesOptions }: PendingVersionsPanelProps) {
  const router = useRouter();

  const [openAdoptId, setOpenAdoptId] = useState<string | null>(null);
  const [adoptionNote, setAdoptionNote] = useState("");
  const [citingMinutesId, setCitingMinutesId] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [linkOpenId, setLinkOpenId] = useState<string | null>(null);
  const [linkMinutesId, setLinkMinutesId] = useState("");

  async function submitAdopt(versionId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/documents/${slug}/versions/${versionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "adopt",
          adoptionNote: adoptionNote.trim(),
          citingMinutesId: citingMinutesId || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Unable to adopt this version.");
      }
      toast.success("Version adopted — it is now the current text.");
      setOpenAdoptId(null);
      setAdoptionNote("");
      setCitingMinutesId("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to adopt this version.");
    } finally {
      setBusy(false);
      setConfirmId(null);
    }
  }

  async function submitLinkMinutes(versionId: string) {
    if (!linkMinutesId) {
      toast.error("Choose which minutes to cite.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/documents/${slug}/versions/${versionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link-minutes", citingMinutesId: linkMinutesId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Unable to link citing minutes.");
      }
      toast.success("Citing minutes linked.");
      setLinkOpenId(null);
      setLinkMinutesId("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to link citing minutes.");
    } finally {
      setBusy(false);
    }
  }

  if (pending.length === 0 && needsCitation.length === 0) return null;

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Pending amendments — awaiting a board vote
          </h2>
          {pending.map((row) => (
            <div key={row.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                  Pending — not yet in effect
                </span>
                <span className="text-sm font-semibold text-gray-900">Version {row.versionNumber}</span>
              </div>
              <p className="mt-2 text-sm text-gray-700">{row.changeNote}</p>
              <p className="mt-1 text-xs text-gray-500">
                {row.authorName ? `Drafted by ${row.authorName}` : "Author not recorded"} — {formatDate(row.createdAt)}.
                Diffs shown against this draft compare vs. current as of now — the current text may have changed
                since this was drafted.
              </p>

              {openAdoptId !== row.id ? (
                <button
                  type="button"
                  onClick={() => {
                    setOpenAdoptId(row.id);
                    setAdoptionNote("");
                    setCitingMinutesId("");
                  }}
                  className="mt-3 bg-lions-blue text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
                >
                  Adopt this version…
                </button>
              ) : (
                <div className="mt-3 space-y-3 rounded-lg bg-white border border-amber-200 p-3">
                  <p className="text-xs text-gray-600">
                    Adopting records the board&apos;s vote and makes this the club&apos;s current, operative text
                    immediately.
                  </p>
                  <div>
                    <label htmlFor={`adopt-note-${row.id}`} className="block text-xs font-semibold text-gray-700 mb-1">
                      Adoption note (required) — how/when the vote happened
                    </label>
                    <textarea
                      id={`adopt-note-${row.id}`}
                      value={adoptionNote}
                      onChange={(e) => setAdoptionNote(e.target.value)}
                      rows={2}
                      placeholder='e.g. "Adopted by 2/3 vote at the September 10 general meeting, per Article XV."'
                      className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                    />
                  </div>
                  <div>
                    <label htmlFor={`adopt-minutes-${row.id}`} className="block text-xs font-semibold text-gray-700 mb-1">
                      Citing minutes (optional — can be added later once approved)
                    </label>
                    <select
                      id={`adopt-minutes-${row.id}`}
                      value={citingMinutesId}
                      onChange={(e) => setCitingMinutesId(e.target.value)}
                      className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue min-h-[44px]"
                    >
                      <option value="">Not yet known</option>
                      {minutesOptions.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy || !adoptionNote.trim()}
                      onClick={() => setConfirmId(row.id)}
                      className="bg-lions-blue text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
                    >
                      Adopt Version {row.versionNumber}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenAdoptId(null)}
                      disabled={busy}
                      className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <ConfirmDialog
                open={confirmId === row.id}
                onOpenChange={(open) => !open && setConfirmId(null)}
                title={`Adopt Version ${row.versionNumber}?`}
                description="This records the board's vote and makes this version the club's current, operative text immediately. It cannot be undone — a further change requires a new version."
                confirmLabel="Adopt"
                destructive
                onConfirm={() => void submitAdopt(row.id)}
              />
            </div>
          ))}
        </div>
      )}

      {needsCitation.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Adopted amendments awaiting a minutes citation
          </h2>
          {needsCitation.map((row) => (
            <div key={row.id} className="rounded-2xl border border-gray-200 bg-white p-4">
              <p className="text-sm text-gray-900">
                Version {row.versionNumber} — adopted {formatDate(row.adoptedAt)}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                No minutes citation on record yet — normal until the meeting that approves the minutes has happened.
              </p>
              {linkOpenId !== row.id ? (
                <button
                  type="button"
                  onClick={() => {
                    setLinkOpenId(row.id);
                    setLinkMinutesId("");
                  }}
                  className="mt-2 text-sm font-semibold text-lions-blue hover:text-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                >
                  Link citing minutes…
                </button>
              ) : (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <select
                    value={linkMinutesId}
                    onChange={(e) => setLinkMinutesId(e.target.value)}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue min-h-[44px]"
                  >
                    <option value="">Choose minutes…</option>
                    {minutesOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitLinkMinutes(row.id)}
                    className="bg-lions-blue text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setLinkOpenId(null)}
                    disabled={busy}
                    className="text-sm font-semibold text-gray-500 hover:text-gray-700 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-2 py-2 min-h-[44px]"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
