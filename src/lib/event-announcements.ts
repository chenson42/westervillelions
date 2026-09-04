/**
 * Event Announcement Emails — pure helpers: copy, template rendering, and
 * recipient classification. No DB import (mirrors the dues-reminders.ts /
 * dues-reminders-queries.ts split — DECISION-074/DECISION-084 generalized to
 * this domain).
 *
 * Imports escapeHtml from src/lib/html-escape.ts rather than adding a fourth
 * local copy (that file exists precisely to stop this — see its own header
 * comment) and formatWallClockDate/formatRecurrence/parseWallClock from
 * src/lib/events.ts, which is itself pure (no DB import), so this module
 * stays importable without DATABASE_URL/DB_URL set.
 *
 * docs/work-log/2026-09-04-event-announcement-emails.md, Phase 3
 * ("Template / Custom-Message Split", "API Contract", "Unit Tests To
 * Deliver").
 */

import { escapeHtml } from "@/lib/html-escape";
import {
  formatWallClockDate,
  formatRecurrence,
  parseWallClock,
  type RecurringEvent,
} from "@/lib/events";

// ---------------------------------------------------------------------------
// Note length limit — shared between the client-side textarea cap and the
// server's own enforcement (POST route).
// ---------------------------------------------------------------------------

export const EVENT_ANNOUNCEMENT_NOTE_MAX_LEN = 2000;

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

export type AnnouncementScope = "occurrence" | "series";

/**
 * Distinct subject wording per scope — a series announcement is describing a
 * recurring commitment, not a single date, so the subject says so.
 */
export function renderAnnouncementSubject(eventTitle: string, scope: AnnouncementScope): string {
  return scope === "series"
    ? `Westerville Lions Club: ${eventTitle} (recurring meeting)`
    : `Westerville Lions Club: ${eventTitle}`;
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

export interface AnnouncementEventInput extends RecurringEvent {
  title: string;
  description: string | null;
  location: string | null;
  isAllDay: boolean;
}

export interface AnnouncementBodyInput {
  firstName: string;
  event: AnnouncementEventInput;
  scope: AnnouncementScope;
  /**
   * The chosen occurrence's wall-clock Date (produced by parseWallClock() or
   * generateOccurrences() — never `new Date(wallClockString)`, see
   * DECISION-005). Required when scope === "occurrence"; ignored for
   * "series". Falls back to the event's own startDate if omitted, so a
   * caller can never crash the renderer, but callers should always pass it
   * for an occurrence send.
   */
  occurrenceDate?: Date;
  /** Absolute URL to the existing /api/events/[id]/ics download route —
   *  defense-in-depth for webmail clients that strip attachments. */
  icsDownloadUrl: string;
  /** The admin's optional per-send free-text note, rendered verbatim
   *  (HTML-escaped) in a highlighted box below the salutation. */
  note?: string | null;
}

/**
 * Renders the event-announcement email body as a plain HTML string. Pure
 * function — no DB access. Event title/date/location/description are never
 * admin-editable inline; only the optional note is free text, and it is
 * always escaped, never rendered as HTML (this feature does not claim the
 * Welcome Packet's narrow raw-HTML exception).
 *
 * `isSeries` (the "recurring meeting" language + formatRecurrence() date
 * text) requires BOTH scope === "series" AND event.isRecurring — a
 * non-recurring event can never render series language even if a caller
 * mistakenly passes scope: "series" (defense-in-depth; the server forces
 * scope: "occurrence" for non-recurring events before this is ever called).
 */
export function renderAnnouncementBody(input: AnnouncementBodyInput): string {
  const { event } = input;
  const isSeries = input.scope === "series" && event.isRecurring;

  const firstName = escapeHtml(input.firstName);
  const title = escapeHtml(event.title);

  const introLine = isSeries
    ? "Here are the details for our recurring Westerville Lions Club meeting:"
    : "You're invited to an upcoming Westerville Lions Club event:";

  const whenLabel = isSeries
    ? (formatRecurrence(event) ?? formatWallClockDate(parseWallClock(event.startDate), event.isAllDay))
    : formatWallClockDate(input.occurrenceDate ?? parseWallClock(event.startDate), event.isAllDay);

  const noteHtml =
    input.note && input.note.trim()
      ? `<p style="margin:0 0 16px;padding:10px 14px;background:#f5f7fb;border-radius:6px;">${escapeHtml(
          input.note.trim(),
        )}</p>`
      : "";

  const locationHtml = event.location
    ? `<p style="margin:0 0 4px;line-height:1.5;"><strong>Where:</strong> ${escapeHtml(event.location)}</p>`
    : "";

  const descriptionHtml = event.description
    ? `<p style="margin:12px 0;line-height:1.5;">${escapeHtml(event.description)}</p>`
    : "";

  return `<div style="font-family:Arial, Helvetica, sans-serif;color:#1a1a1a;font-size:14px;max-width:640px;">
<p style="margin:0 0 12px;">Hi ${firstName},</p>
<p style="margin:0 0 12px;line-height:1.5;">${introLine}</p>
${noteHtml}
<h2 style="margin:0 0 8px;font-size:18px;">${title}</h2>
<p style="margin:0 0 4px;line-height:1.5;"><strong>When:</strong> ${escapeHtml(whenLabel)}</p>
${locationHtml}
${descriptionHtml}
<p style="margin:16px 0 4px;line-height:1.5;">A calendar invite is attached to this email so you can add it directly. If your email doesn't show the attachment, you can also <a href="${input.icsDownloadUrl}">download the calendar file here</a>.</p>
<p style="margin:16px 0 0;">&mdash; Westerville Lions Club</p>
</div>`;
}

// ---------------------------------------------------------------------------
// classifyAnnouncementRecipients — pure, extracted from the send route so
// it's testable without a DB. Splits a requested member-id list against the
// FRESH active-member/has-email cohort the route re-derives at send time
// (never the client's stale payload) — mirrors dues-reminders.ts's
// classifyRecipients().
// ---------------------------------------------------------------------------

export type AnnouncementSkipReason = "no_longer_active" | "no_email_on_file" | "not_selected";

export interface FreshActiveMember {
  memberId: string;
  email: string;
}

export interface AnnouncementRecipientClassification {
  toSend: Array<{ memberId: string; email: string }>;
  skipped: Array<{ memberId: string; reason: AnnouncementSkipReason }>;
}

/**
 * `freshActiveMembers` is expected to be every currently
 * `membershipStatus = 'active'` member (regardless of whether they were
 * requested) — the source of truth for who is eligible at all right now.
 * `requestedMemberIds` is the admin's reviewed cohort from the POST body,
 * de-duped via Set so a repeated id is only ever classified — and sent —
 * once.
 *
 * A requested id absent from `freshActiveMembers` is `no_longer_active` (it
 * was deactivated between page load and send, or never existed). An active
 * member with no email on file is always `no_email_on_file`, whether or not
 * they were requested. An active member WITH an email who simply wasn't in
 * the submitted list is `not_selected` — an intentional admin uncheck, not
 * an error.
 */
export function classifyAnnouncementRecipients(
  requestedMemberIds: string[],
  freshActiveMembers: FreshActiveMember[],
): AnnouncementRecipientClassification {
  const dedupedRequested = new Set(requestedMemberIds);
  const activeIds = new Set(freshActiveMembers.map((m) => m.memberId));

  const toSend: AnnouncementRecipientClassification["toSend"] = [];
  const skipped: AnnouncementRecipientClassification["skipped"] = [];

  for (const member of freshActiveMembers) {
    const hasEmail = Boolean(member.email && member.email.trim());
    if (!hasEmail) {
      skipped.push({ memberId: member.memberId, reason: "no_email_on_file" });
      continue;
    }
    if (!dedupedRequested.has(member.memberId)) {
      skipped.push({ memberId: member.memberId, reason: "not_selected" });
      continue;
    }
    toSend.push({ memberId: member.memberId, email: member.email });
  }

  for (const memberId of dedupedRequested) {
    if (!activeIds.has(memberId)) {
      skipped.push({ memberId, reason: "no_longer_active" });
    }
  }

  return { toSend, skipped };
}
