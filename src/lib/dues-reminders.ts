/**
 * Dues Reminder Emails — pure helpers: copy, template rendering, and
 * classification logic. No DB import (mirrors the dues.ts / dues-queries.ts
 * split — DECISION-074/DECISION-084 generalized to a fourth domain).
 *
 * docs/work-log/2026-08-12-dues-reminder-emails.md, Phase 3 §6/§9.
 */

import type { DuesStatus } from "@/lib/dues";

// ---------------------------------------------------------------------------
// seasonLabel / formatDuesAmount
// ---------------------------------------------------------------------------

/**
 * Member-facing "season" rendering of a fiscal year, distinct from the
 * existing admin-facing fiscalYearLabel() ("FY2026 (Jul 2026 – Jun 2027)").
 * seasonLabel(2026) → "2026–27".
 */
export function seasonLabel(fy: number): string {
  const endYearShort = String(fy + 1).slice(-2);
  return `${fy}–${endYearShort}`;
}

/**
 * Friendlier prose rendering of a dues amount — drops the trailing ".00"
 * (every seeded amount today is a round dollar figure) but stays exact for
 * a non-round figure. formatDuesAmount(12000) → "$120";
 * formatDuesAmount(9650) → "$96.50".
 */
export function formatDuesAmount(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// HTML escaping — this is a templated HTML email built from free text
// (a member's stored first name, the treasurer's own note); neither is
// trusted content.
// ---------------------------------------------------------------------------

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

export function renderDuesReminderSubject(fiscalYear: number): string {
  return `A friendly note about your ${seasonLabel(fiscalYear)} Westerville Lions dues`;
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

export type DuesReminderCohort = "unpaid" | "partial";

export interface DuesReminderBodyInput {
  firstName: string;
  fiscalYear: number;
  individualAmountCents: number;
  familyAmountCents: number;
  /** Absolute or relative URL to the member's own /members/dues page. */
  membersDuesUrl: string;
  signerFirstName: string;
  signerLastName: string;
  /** The treasurer's optional per-send free-text note, rendered verbatim
   *  (HTML-escaped) above the closing gratitude line when present. */
  note?: string | null;
}

/**
 * Renders one of the two dues-reminder email bodies as a plain HTML string.
 * Pure function — no DB access. The standard-rate sentence is built from
 * whatever duesSettings amounts the caller passes in — never hard-coded, so
 * it can never drift from the books (this is the load-bearing property
 * tested by dues-reminders.test.ts). No per-member dollar-owed figure is
 * ever included — a live link to /members/dues stands in for a number that
 * could go stale or be disputed out of context.
 */
export function renderDuesReminderBody(
  cohort: DuesReminderCohort,
  input: DuesReminderBodyInput,
): string {
  const season = seasonLabel(input.fiscalYear);
  const firstName = escapeHtml(input.firstName);
  const signer = `${escapeHtml(input.signerFirstName)} ${escapeHtml(input.signerLastName)}`;
  const rateSentence = `Dues are ${formatDuesAmount(input.individualAmountCents)} for the year, or ${formatDuesAmount(
    input.familyAmountCents,
  )} for a family membership.`;
  const linkHtml = `<a href="${input.membersDuesUrl}">${input.membersDuesUrl}</a>`;
  const noteHtml =
    input.note && input.note.trim()
      ? `<p style="margin:0 0 16px;padding:10px 14px;background:#f5f7fb;border-radius:6px;">${escapeHtml(
          input.note.trim(),
        )}</p>`
      : "";

  const openingUnpaid = `I hope this finds you well! I'm reaching out with a quick, friendly note &mdash; our records show we haven't yet received your dues for the ${season} Lions year. It's an easy thing to lose track of, especially with everything else going on, so consider this a gentle nudge rather than anything to worry about.`;
  const followupUnpaid = `You can see your dues status anytime at ${linkHtml}. If you've already sent a payment and it just hasn't made it into our records yet, please just let me know &mdash; that happens on my end sometimes, and I'd love to get it squared away.`;
  const closingUnpaid = `Thank you, truly, for everything you do for our club and our community &mdash; it means a great deal, and it's never gone unnoticed.`;

  const openingPartial = `Hope you're doing well! Just a friendly note that our records show a balance still remaining on your ${season} Lions dues. No stress at all &mdash; these things happen, and I just wanted to flag it in case it slipped your mind.`;
  const followupPartial = `You can see the details anytime at ${linkHtml}. If this doesn't look right, just reply and let me know &mdash; happy to sort it out together.`;
  const closingPartial = `Thank you for all you do for our club!`;

  const opening = cohort === "unpaid" ? openingUnpaid : openingPartial;
  const followup = cohort === "unpaid" ? followupUnpaid : followupPartial;
  const closing = cohort === "unpaid" ? closingUnpaid : closingPartial;

  return `<div style="font-family:Arial, Helvetica, sans-serif;color:#1a1a1a;font-size:14px;max-width:640px;">
<p style="margin:0 0 12px;">Hi ${firstName},</p>
<p style="margin:0 0 12px;line-height:1.5;">${opening}</p>
<p style="margin:0 0 12px;line-height:1.5;">${rateSentence}</p>
<p style="margin:0 0 12px;line-height:1.5;">${followup}</p>
${noteHtml}
<p style="margin:0 0 16px;line-height:1.5;">${closing}</p>
<p style="margin:0;">With gratitude,<br />${signer}<br />Treasurer, Westerville Lions Club</p>
</div>`;
}

// ---------------------------------------------------------------------------
// classifyRecipients — pure, extracted from the send route so it's testable
// without a DB. Splits a requested member-id list into per-cohort sends vs.
// skipped, using the FRESH status query the route re-runs at send time
// (never the client's stale payload).
// ---------------------------------------------------------------------------

export type SkipReason = "now_paid" | "no_longer_active" | "no_email_on_file";

export interface FreshStatusRow {
  memberId: string;
  status: DuesStatus;
  email: string;
}

export interface RecipientClassification {
  toSend: Array<{ memberId: string; cohort: DuesReminderCohort }>;
  skipped: Array<{ memberId: string; reason: SkipReason }>;
}

/**
 * `freshStatuses` is expected to be the result of listMemberDuesStatus() for
 * the fiscal year in question, which already scopes to active members only
 * — a requested memberId absent from it is therefore no longer active (it
 * was deactivated between page load and send, or never existed). De-dupes
 * `requestedMemberIds` via Set, so a memberId appearing twice in the
 * request is only ever classified — and sent — once.
 */
export function classifyRecipients(
  requestedMemberIds: string[],
  freshStatuses: FreshStatusRow[],
): RecipientClassification {
  const dedupedIds = Array.from(new Set(requestedMemberIds));
  const byId = new Map(freshStatuses.map((s) => [s.memberId, s]));

  const toSend: RecipientClassification["toSend"] = [];
  const skipped: RecipientClassification["skipped"] = [];

  for (const memberId of dedupedIds) {
    const status = byId.get(memberId);
    if (!status) {
      skipped.push({ memberId, reason: "no_longer_active" });
      continue;
    }
    if (status.status === "paid") {
      skipped.push({ memberId, reason: "now_paid" });
      continue;
    }
    if (!status.email || !status.email.trim()) {
      skipped.push({ memberId, reason: "no_email_on_file" });
      continue;
    }
    // status.status is narrowed to "unpaid" | "partial" here.
    toSend.push({ memberId, cohort: status.status });
  }

  return { toSend, skipped };
}

// ---------------------------------------------------------------------------
// isWithinReminderCooldown — badge/warning threshold (Phase 1 ruling: badge
// and warning, not a hard block). >= 14 days is no longer a warning.
// ---------------------------------------------------------------------------

export const REMINDER_COOLDOWN_DAYS = 14;

export function isWithinReminderCooldown(
  lastRemindedAt: Date | string | null | undefined,
  now: Date,
): boolean {
  if (!lastRemindedAt) return false;
  const last = typeof lastRemindedAt === "string" ? new Date(lastRemindedAt) : lastRemindedAt;
  const diffDays = (now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays < REMINDER_COOLDOWN_DAYS;
}
