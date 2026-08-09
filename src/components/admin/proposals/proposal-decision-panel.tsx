"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export interface MinutesOption {
  id: string;
  label: string;
}

export interface BackfillableDecision {
  id: string;
  status: string;
  citingMinutesId: string | null;
  meetingDate: string | null;
}

const DECISION_TARGETS = [
  { value: "under_review", label: "Under Review" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
  { value: "deferred", label: "Deferred" },
] as const;

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under Review",
  approved: "Approved",
  declined: "Declined",
  deferred: "Deferred",
};

/**
 * Board decision surface. A status change is not wrapped in <ConfirmDialog>
 * — it's additive history, not destructive/irreversible in the sense
 * minutes/documents use it (Phase 2 §4, confirmed unchanged by Phase 3).
 *
 * The <select> here (rather than radio buttons) is deliberate — this
 * audience is a handful of tech-comfortable board members, not the
 * accessibility-research target the member-facing form was built for
 * (Phase 3 Component Plan).
 */
export function ProposalDecisionPanel({
  proposalId,
  currentStatus,
  currentChairName,
  minutesOptions,
  decisions,
}: {
  proposalId: string;
  currentStatus: string;
  currentChairName: string | null;
  minutesOptions: MinutesOption[];
  decisions: BackfillableDecision[];
}) {
  const router = useRouter();

  const [targetStatus, setTargetStatus] = useState("");
  const [note, setNote] = useState("");
  const [chairName, setChairName] = useState("");
  const [citingMinutesId, setCitingMinutesId] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const needsChair = currentChairName === "Not yet identified";

  async function handleDecide(e: React.FormEvent) {
    e.preventDefault();
    if (!targetStatus) {
      toast.error("Choose a status to move this proposal to.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/proposals/${proposalId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: targetStatus,
          note: note.trim() || undefined,
          chairName: needsChair && chairName.trim() ? chairName.trim() : undefined,
          citingMinutesId: citingMinutesId || undefined,
          meetingDate: meetingDate || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not record this decision.");
      }
      toast.success(`Proposal moved to ${STATUS_LABELS[targetStatus] ?? targetStatus}.`);
      setTargetStatus("");
      setNote("");
      setChairName("");
      setCitingMinutesId("");
      setMeetingDate("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record this decision.");
    } finally {
      setSubmitting(false);
    }
  }

  const missingBackfill = decisions.filter((d) => !d.citingMinutesId || !d.meetingDate);

  return (
    <div className="space-y-6">
      <form onSubmit={handleDecide} className="bg-white rounded-2xl shadow-sm overflow-hidden p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Record a Decision</h2>

        <div>
          <label htmlFor="decision-status" className="block text-sm font-medium text-gray-700 mb-1">
            New status
          </label>
          <select
            id="decision-status"
            value={targetStatus}
            onChange={(e) => setTargetStatus(e.target.value)}
            disabled={submitting}
            className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
          >
            <option value="">Choose a status…</option>
            {DECISION_TARGETS.filter((d) => d.value !== currentStatus).map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        {needsChair && (
          <div>
            <label htmlFor="decision-chair" className="block text-sm font-medium text-gray-700 mb-1">
              Chairperson{" "}
              <span className="text-gray-400 font-normal text-xs">
                (optional — this proposal doesn&rsquo;t have one yet)
              </span>
            </label>
            <input
              id="decision-chair"
              type="text"
              value={chairName}
              onChange={(e) => setChairName(e.target.value)}
              disabled={submitting}
              placeholder="Name a chair found during review"
              className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
            />
          </div>
        )}

        <div>
          <label htmlFor="decision-note" className="block text-sm font-medium text-gray-700 mb-1">
            Note <span className="text-gray-400 font-normal text-xs">(optional)</span>
          </label>
          <textarea
            id="decision-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={2000}
            disabled={submitting}
            placeholder='e.g., "tabled pending updated budget"'
            className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60 resize-none"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="decision-meeting-date" className="block text-sm font-medium text-gray-700 mb-1">
              Meeting date <span className="text-gray-400 font-normal text-xs">(optional)</span>
            </label>
            <input
              id="decision-meeting-date"
              type="date"
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
              disabled={submitting}
              className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
            />
          </div>
          <div>
            <label htmlFor="decision-minutes" className="block text-sm font-medium text-gray-700 mb-1">
              Citing minutes <span className="text-gray-400 font-normal text-xs">(optional — can add later)</span>
            </label>
            <select
              id="decision-minutes"
              value={citingMinutesId}
              onChange={(e) => setCitingMinutesId(e.target.value)}
              disabled={submitting}
              className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
            >
              <option value="">None yet</option>
              {minutesOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
        >
          {submitting ? "Recording…" : "Record Decision"}
        </button>
      </form>

      {missingBackfill.length > 0 && (
        <BackfillPanel proposalId={proposalId} decisions={missingBackfill} minutesOptions={minutesOptions} />
      )}
    </div>
  );
}

function BackfillPanel({
  proposalId,
  decisions,
  minutesOptions,
}: {
  proposalId: string;
  decisions: BackfillableDecision[];
  minutesOptions: MinutesOption[];
}) {
  const router = useRouter();
  // Keyed by decision id, but ONLY holds rows the admin has actually
  // touched — never synced wholesale from the `decisions` prop. A
  // useState(...) initializer runs once at mount, so after
  // router.refresh() brings a NEW decision row (e.g. the one just recorded
  // above) the old approach — pre-seeding this map from `decisions` at
  // mount — left it with no entry for that row, and `drafts[d.id]` read
  // undefined and crashed. Reading through `draftFor()` below with a
  // computed fallback avoids ever needing this state to "match" props.
  const [overrides, setOverrides] = useState<Record<string, { citingMinutesId: string; meetingDate: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  function draftFor(d: BackfillableDecision) {
    return overrides[d.id] ?? { citingMinutesId: d.citingMinutesId ?? "", meetingDate: d.meetingDate ?? "" };
  }

  async function handleSave(d: BackfillableDecision) {
    const draft = draftFor(d);
    const decisionId = d.id;
    setSavingId(decisionId);
    try {
      const res = await fetch(`/api/admin/proposals/${proposalId}/decisions/${decisionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          citingMinutesId: draft.citingMinutesId || null,
          meetingDate: draft.meetingDate || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not update this decision record.");
      }
      toast.success("Decision record updated.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update this decision record.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Backfill Past Decisions</h2>
      <p className="text-sm text-gray-500">
        Link the citing minutes or meeting date once they&rsquo;re available — normal to leave these blank right
        after a meeting.
      </p>
      <ul className="space-y-4 divide-y divide-gray-100">
        {decisions.map((d) => {
          const draft = draftFor(d);
          return (
            <li key={d.id} className="pt-4 first:pt-0">
              <p className="text-sm font-semibold text-gray-800 mb-2">{STATUS_LABELS[d.status] ?? d.status}</p>
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Meeting date</label>
                  <input
                    type="date"
                    value={draft.meetingDate}
                    onChange={(e) =>
                      setOverrides((prev) => ({ ...prev, [d.id]: { ...draftFor(d), meetingDate: e.target.value } }))
                    }
                    className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Citing minutes</label>
                  <select
                    value={draft.citingMinutesId}
                    onChange={(e) =>
                      setOverrides((prev) => ({
                        ...prev,
                        [d.id]: { ...draftFor(d), citingMinutesId: e.target.value },
                      }))
                    }
                    className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                  >
                    <option value="">None yet</option>
                    {minutesOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => handleSave(d)}
                  disabled={savingId === d.id}
                  className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg font-semibold hover:bg-lions-blue/5 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
                >
                  {savingId === d.id ? "Saving…" : "Save"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
