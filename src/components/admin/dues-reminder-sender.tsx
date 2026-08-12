"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  formatDuesAmount,
  isWithinReminderCooldown,
  renderDuesReminderBody,
  renderDuesReminderSubject,
  REMINDER_COOLDOWN_DAYS,
} from "@/lib/dues-reminders";
import type { DuesReminderCohort } from "@/lib/dues-reminders";
import type { ReminderCandidate } from "@/lib/dues-reminders-queries";
import type { TreasurerResolution } from "@/lib/board-positions";

interface DuesSettingsSummary {
  individualAmountCents: number;
  familyAmountCents: number;
}

interface DuesReminderSenderProps {
  fiscalYear: number;
  seasonLabel: string;
  duesSettings: DuesSettingsSummary | null;
  signer: TreasurerResolution;
  initialUnpaid: ReminderCandidate[];
  initialPartial: ReminderCandidate[];
}

type SkipReason = "now_paid" | "no_longer_active" | "no_email_on_file";

interface SentRow {
  memberId: string;
  email: string;
  cohort: DuesReminderCohort;
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
  signer: { firstName: string; lastName: string };
  sent: SentRow[];
  skipped: SkippedRow[];
}

const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  now_paid: "Already paid in full since this list loaded.",
  no_longer_active: "No longer an active member.",
  no_email_on_file: "No email address on file.",
};

const SIGNER_FAILURE_MESSAGE: Record<"no_board_group" | "none" | "multiple", string> = {
  no_board_group:
    "No \"Board of Directors\" group was found, so there's no one to sign this reminder as Treasurer.",
  none: "No single Treasurer found in the Board of Directors group — fix the group position before sending reminders.",
  multiple:
    "More than one member is marked as Treasurer in the Board of Directors group — fix the group position before sending reminders.",
};

function hasEmail(c: ReminderCandidate): boolean {
  return Boolean(c.email && c.email.trim());
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function LastRemindedBadge({ lastReminded }: { lastReminded: ReminderCandidate["lastReminded"] }) {
  if (!lastReminded) {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
        Never reminded
      </span>
    );
  }
  const within = isWithinReminderCooldown(lastReminded.sentAt, new Date());
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        within ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-500"
      }`}
    >
      Last reminded {formatDate(lastReminded.sentAt)}
      {within ? ` (within ${REMINDER_COOLDOWN_DAYS} days)` : ""}
    </span>
  );
}

function CandidateRow({
  candidate,
  checked,
  onToggle,
}: {
  candidate: ReminderCandidate;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 sm:px-6 py-3 hover:bg-gray-50 cursor-pointer">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
        />
        <div className="min-w-0">
          <div className="font-medium text-gray-900 truncate">
            {candidate.firstName} {candidate.lastName}
          </div>
          <div className="text-xs text-gray-500 truncate">{candidate.email}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 pl-8 sm:pl-0 sm:shrink-0">
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 capitalize">
          {candidate.duesCategory}
        </span>
        <LastRemindedBadge lastReminded={candidate.lastReminded} />
      </div>
    </label>
  );
}

/**
 * Preview/select/confirm/send screen for a fiscal year's dues reminders.
 * `/admin/dues/reminders` (src/app/(dashboard)/admin/dues/reminders/page.tsx).
 *
 * See docs/work-log/2026-08-12-dues-reminder-emails.md, Phase 3 §7.
 */
export default function DuesReminderSender({
  fiscalYear,
  seasonLabel,
  duesSettings,
  signer,
  initialUnpaid,
  initialPartial,
}: DuesReminderSenderProps) {
  const [unpaid, setUnpaid] = useState(initialUnpaid);
  const [partial, setPartial] = useState(initialPartial);
  const [currentSigner, setCurrentSigner] = useState(signer);
  const [currentSettings, setCurrentSettings] = useState(duesSettings);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialUnpaid.filter(hasEmail).map((m) => m.memberId)),
  );
  const [note, setNote] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  const unpaidSelectable = useMemo(() => unpaid.filter(hasEmail), [unpaid]);
  const unpaidNoEmail = useMemo(() => unpaid.filter((c) => !hasEmail(c)), [unpaid]);
  const partialSelectable = useMemo(() => partial.filter(hasEmail), [partial]);
  const partialNoEmail = useMemo(() => partial.filter((c) => !hasEmail(c)), [partial]);

  const selectedCount = selected.size;
  const selectedWithinCooldown = useMemo(() => {
    const now = new Date();
    return [...unpaidSelectable, ...partialSelectable].filter(
      (c) => selected.has(c.memberId) && isWithinReminderCooldown(c.lastReminded?.sentAt ?? null, now),
    ).length;
  }, [selected, unpaidSelectable, partialSelectable]);

  const nobodyAtAll = unpaid.length === 0 && partial.length === 0;

  function toggle(memberId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  function toggleAll(list: ReminderCandidate[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of list) {
        if (checked) next.add(c.memberId);
        else next.delete(c.memberId);
      }
      return next;
    });
  }

  async function loadCandidates() {
    const res = await fetch(`/api/admin/dues/reminders?fiscalYear=${fiscalYear}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || "Could not refresh the recipient list.");
      return null;
    }
    return data as {
      unpaid: ReminderCandidate[];
      partial: ReminderCandidate[];
      signer: TreasurerResolution;
      duesSettings: DuesSettingsSummary | null;
    };
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const data = await loadCandidates();
      if (!data) return;
      setUnpaid(data.unpaid);
      setPartial(data.partial);
      setCurrentSigner(data.signer);
      setCurrentSettings(data.duesSettings);
      setSelected(new Set(data.unpaid.filter(hasEmail).map((m) => m.memberId)));
      toast.success("Recipient list refreshed.");
    } catch {
      toast.error("Could not reach the server. Try again.");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSend() {
    setSending(true);
    const nameById = new Map(
      [...unpaid, ...partial].map((c) => [c.memberId, `${c.firstName} ${c.lastName}`]),
    );
    try {
      const res = await fetch("/api/admin/dues/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fiscalYear,
          memberIds: Array.from(selected),
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Could not send reminders.");
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
      setResult({ signer: data.signer, sent, skipped });

      const successCount = sent.filter((s) => s.success).length;
      const failCount = sent.length - successCount;
      if (sent.length === 0) {
        toast.warning("Nobody was sent a reminder — see the results below.");
      } else if (failCount === 0) {
        toast.success(`Sent ${successCount} of ${sent.length} reminder${sent.length === 1 ? "" : "s"}.`);
      } else {
        toast.error(`Sent ${successCount} of ${sent.length} — ${failCount} failed. See details below.`);
      }
      setNote("");

      const refreshed = await loadCandidates();
      if (refreshed) {
        setUnpaid(refreshed.unpaid);
        setPartial(refreshed.partial);
        setCurrentSigner(refreshed.signer);
        setCurrentSettings(refreshed.duesSettings);
        setSelected(new Set(refreshed.unpaid.filter(hasEmail).map((m) => m.memberId)));
      }
    } catch {
      toast.error("Could not reach the server. Try again.");
    } finally {
      setSending(false);
      setConfirmOpen(false);
    }
  }

  const previewSubject = renderDuesReminderSubject(fiscalYear);
  const previewUnpaidHtml =
    currentSettings && currentSigner.ok
      ? renderDuesReminderBody("unpaid", {
          firstName: "Alex",
          fiscalYear,
          individualAmountCents: currentSettings.individualAmountCents,
          familyAmountCents: currentSettings.familyAmountCents,
          membersDuesUrl: "/members/dues",
          signerFirstName: currentSigner.firstName,
          signerLastName: currentSigner.lastName,
          note: note || null,
        })
      : null;
  const previewPartialHtml =
    currentSettings && currentSigner.ok
      ? renderDuesReminderBody("partial", {
          firstName: "Alex",
          fiscalYear,
          individualAmountCents: currentSettings.individualAmountCents,
          familyAmountCents: currentSettings.familyAmountCents,
          membersDuesUrl: "/members/dues",
          signerFirstName: currentSigner.firstName,
          signerLastName: currentSigner.lastName,
          note: note || null,
        })
      : null;

  const signerName = currentSigner.ok ? `${currentSigner.firstName} ${currentSigner.lastName}` : null;
  const confirmDescription = [
    signerName ? `Signed by ${signerName}, Treasurer, Westerville Lions Club.` : null,
    selectedWithinCooldown > 0
      ? `${selectedWithinCooldown} of these ${selectedWithinCooldown === 1 ? "was" : "were"} already reminded within the last ${REMINDER_COOLDOWN_DAYS} days.`
      : null,
    "This sends real email and cannot be undone.",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-6">
      {!currentSigner.ok && (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold mb-1">Can&apos;t send reminders yet</p>
          <p>{SIGNER_FAILURE_MESSAGE[currentSigner.reason]}</p>
          {currentSigner.boardGroupId && (
            <Link
              href={`/admin/groups/${currentSigner.boardGroupId}`}
              className="mt-2 inline-block font-medium text-red-800 underline focus:outline-none focus:ring-2 focus:ring-red-600 rounded"
            >
              Fix the Board of Directors group &rarr;
            </Link>
          )}
        </div>
      )}

      {currentSigner.ok && !currentSettings && (
        <div className="rounded-2xl border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-800">
          Dues amounts are not configured for {seasonLabel} —{" "}
          <Link href="/admin/dues" className="font-medium underline">
            configure them
          </Link>{" "}
          before sending reminders.
        </div>
      )}

      {currentSigner.ok && currentSettings && (
        <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6 space-y-1 text-sm text-gray-600">
          <p>
            This reminder will be signed by{" "}
            <span className="font-medium text-gray-900">{signerName}</span>, Treasurer, Westerville
            Lions Club.
          </p>
          <p>
            Dues are {formatDuesAmount(currentSettings.individualAmountCents)} for the year, or{" "}
            {formatDuesAmount(currentSettings.familyAmountCents)} for a family membership.
          </p>
        </div>
      )}

      {nobodyAtAll ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          Nobody owes dues for the {seasonLabel} season right now.
        </div>
      ) : (
        <>
          {/* Unpaid cohort */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 sm:px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Unpaid ({unpaidSelectable.length})
                </h2>
                <p className="text-sm text-gray-500">
                  Zero dues paid for {seasonLabel}. Selected by default.
                </p>
              </div>
              {unpaidSelectable.length > 0 && (
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={unpaidSelectable.every((c) => selected.has(c.memberId))}
                    onChange={(e) => toggleAll(unpaidSelectable, e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
                  />
                  Select all
                </label>
              )}
            </div>
            {unpaidSelectable.length === 0 ? (
              <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 m-4">
                Nobody in this cohort has an email on file.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {unpaidSelectable.map((c) => (
                  <CandidateRow
                    key={c.memberId}
                    candidate={c}
                    checked={selected.has(c.memberId)}
                    onToggle={() => toggle(c.memberId)}
                  />
                ))}
              </div>
            )}
            {unpaidNoEmail.length > 0 && (
              <div className="border-t border-gray-100 bg-amber-50 px-4 sm:px-6 py-3">
                <p className="mb-2 text-sm font-medium text-amber-800">
                  Excluded — no email on file ({unpaidNoEmail.length})
                </p>
                <ul className="space-y-1 text-sm text-amber-700">
                  {unpaidNoEmail.map((c) => (
                    <li key={c.memberId}>
                      {c.firstName} {c.lastName}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Partial cohort */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 sm:px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Balance remaining ({partialSelectable.length})
                </h2>
                <p className="text-sm text-gray-500">
                  Partially paid for {seasonLabel}. Not selected by default — different wording, since
                  these members have already paid something.
                </p>
              </div>
              {partialSelectable.length > 0 && (
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={partialSelectable.every((c) => selected.has(c.memberId))}
                    onChange={(e) => toggleAll(partialSelectable, e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
                  />
                  Select all
                </label>
              )}
            </div>
            {partialSelectable.length === 0 ? (
              <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 m-4">
                Nobody has a partial balance for {seasonLabel}.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {partialSelectable.map((c) => (
                  <CandidateRow
                    key={c.memberId}
                    candidate={c}
                    checked={selected.has(c.memberId)}
                    onToggle={() => toggle(c.memberId)}
                  />
                ))}
              </div>
            )}
            {partialNoEmail.length > 0 && (
              <div className="border-t border-gray-100 bg-amber-50 px-4 sm:px-6 py-3">
                <p className="mb-2 text-sm font-medium text-amber-800">
                  Excluded — no email on file ({partialNoEmail.length})
                </p>
                <ul className="space-y-1 text-sm text-amber-700">
                  {partialNoEmail.map((c) => (
                    <li key={c.memberId}>
                      {c.firstName} {c.lastName}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Optional note */}
          <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6">
            <label htmlFor="dues-reminder-note" className="mb-1 block text-sm font-medium text-gray-700">
              Add a note for recipients (optional)
            </label>
            <textarea
              id="dues-reminder-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="e.g. Thank you for your patience while we update our records."
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
            <p className="mt-1 text-xs text-gray-400">{note.length}/1000</p>
          </div>

          {/* Preview */}
          {previewUnpaidHtml && previewPartialHtml && (
            <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Preview</h2>
                <p className="text-sm text-gray-500">
                  Subject: <span className="text-gray-700">{previewSubject}</span>. First names are
                  personalized per recipient — shown here as &quot;Alex&quot;.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">
                    Unpaid wording
                  </p>
                  <div className="h-64 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                    <iframe
                      sandbox=""
                      srcDoc={previewUnpaidHtml}
                      title="Preview: unpaid reminder"
                      className="h-full w-full bg-white"
                    />
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">
                    Balance-remaining wording
                  </p>
                  <div className="h-64 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                    <iframe
                      sandbox=""
                      srcDoc={previewPartialHtml}
                      title="Preview: partial-balance reminder"
                      className="h-full w-full bg-white"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="min-h-[44px] rounded-lg border-2 border-lions-blue px-4 py-2 text-sm font-semibold text-lions-blue transition hover:bg-lions-blue/5 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              {refreshing ? "Refreshing…" : "Refresh list"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={sending || selectedCount === 0 || !currentSigner.ok || !currentSettings}
              className="min-h-[44px] rounded-lg bg-lions-blue px-6 py-3 font-semibold text-white transition hover:bg-lions-blue-dark disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              {sending
                ? "Sending…"
                : `Send to ${selectedCount} member${selectedCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Send this reminder to ${selectedCount} member${selectedCount === 1 ? "" : "s"}?`}
        description={confirmDescription}
        confirmLabel={sending ? "Sending…" : "Send Reminders"}
        // Deliberately NOT `destructive` (Phase 3). Sending is irreversible, but
        // a red danger button on a warm, friendly dues nudge reads as a warning
        // about the act itself. The safety here is the recipient count in the
        // title and the named list behind it, not the colour of the button.
        onConfirm={() => void handleSend()}
      />

      {/* Results */}
      {result && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="border-b border-gray-100 px-4 sm:px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Send results</h2>
            <p className="text-sm text-gray-500">
              Signed by {result.signer.firstName} {result.signer.lastName}.
            </p>
          </div>
          {result.sent.length === 0 ? (
            <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 m-4">
              Nobody was sent a reminder this time.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {result.sent.map((s) => (
                <div
                  key={s.memberId}
                  className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-gray-900">
                      {s.name ?? s.email}
                    </div>
                    <div className="truncate text-xs text-gray-500">
                      {s.email} &middot; <span className="capitalize">{s.cohort}</span>
                    </div>
                  </div>
                  {s.success ? (
                    <span className="inline-flex shrink-0 items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      Sent
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
              <p className="mb-2 text-sm font-medium text-gray-700">
                Not sent ({result.skipped.length})
              </p>
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
