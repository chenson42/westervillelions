/**
 * Event Announcement Emails — DB-facing query/orchestration layer.
 *
 * Mirrors the dues-reminders.ts / dues-reminders-queries.ts split. Used by
 * both the GET/POST route handlers (src/app/api/admin/events/[id]/announce/route.ts)
 * and the announce page's server-rendered first paint (ux-developer's slice).
 *
 * docs/work-log/2026-09-04-event-announcement-emails.md, Phase 3
 * ("Implementation Order" item 4, "Unit Tests To Deliver").
 */

import { isAfter } from "date-fns";
import { db } from "@/lib/db";
import {
  eventAnnouncements,
  eventOccurrenceOverrides,
  members,
  users,
  type NewEventAnnouncement,
} from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import {
  dateKey,
  formatWallClockDate,
  generateOccurrences,
  nowEastern,
  type RecurringEvent,
} from "@/lib/events";
import type { AnnouncementScope } from "@/lib/event-announcements";

// ---------------------------------------------------------------------------
// getAnnouncementRecipients — every currently active member, regardless of
// whether they have an email on file. The GET route splits this into
// withEmail/withoutEmail for the client (never sending addresses to the
// browser); the POST route feeds it straight into
// classifyAnnouncementRecipients() as the fresh eligibility source of truth.
// ---------------------------------------------------------------------------

export interface ActiveMemberForAnnouncement {
  memberId: string;
  firstName: string;
  lastName: string;
  email: string;
}

export async function getAnnouncementRecipients(): Promise<ActiveMemberForAnnouncement[]> {
  const rows = await db
    .select({
      memberId: members.id,
      firstName: members.firstName,
      lastName: members.lastName,
      email: members.email,
    })
    .from(members)
    .where(eq(members.membershipStatus, "active"));
  return rows;
}

// ---------------------------------------------------------------------------
// getFutureOccurrenceOptions — future, non-cancelled occurrence dates for the
// occurrence picker. Excludes past dates explicitly (generateOccurrences()
// only excludes past dates for RECURRING events via its `from` walk-start;
// for a non-recurring event it always returns the single startDate
// regardless of `from` — see src/lib/events.ts — so this function applies
// its own isAfter(now) filter on top, which is what makes a non-recurring
// past event correctly resolve to an empty array here).
// ---------------------------------------------------------------------------

/**
 * Every cancelled occurrence date (event_occurrence_overrides) for an event,
 * as a YYYY-MM-DD set. Shared by getFutureOccurrenceOptions() (picker) and
 * the POST route's own re-validation of a submitted occurrenceDate — same
 * source of truth, fetched once per call site rather than duplicated.
 */
export async function getCancelledOccurrenceDates(eventId: string): Promise<Set<string>> {
  const overrides = await db
    .select({ occurrenceDate: eventOccurrenceOverrides.occurrenceDate })
    .from(eventOccurrenceOverrides)
    .where(eq(eventOccurrenceOverrides.eventId, eventId));
  return new Set(overrides.map((o) => o.occurrenceDate));
}

export async function getFutureOccurrenceOptions(
  eventId: string,
  event: RecurringEvent & { isAllDay: boolean },
): Promise<{ date: string; label: string }[]> {
  const now = nowEastern();
  const all = generateOccurrences(event, now, 520);
  const cancelledSet = await getCancelledOccurrenceDates(eventId);

  return all
    .filter((d) => isAfter(d, now) && !cancelledSet.has(dateKey(d)))
    .map((d) => ({ date: dateKey(d), label: formatWallClockDate(d, event.isAllDay) }));
}

// ---------------------------------------------------------------------------
// getEventAnnouncementHistory — one summary row per batchId (DECISION-093),
// newest first.
// ---------------------------------------------------------------------------

export interface AnnouncementHistoryBatch {
  batchId: string;
  scope: AnnouncementScope;
  occurrenceDate: string | null;
  sentAt: string;
  sentByName: string | null;
  recipientCount: number;
  successCount: number;
  failureCount: number;
  note: string | null;
}

export async function getEventAnnouncementHistory(
  eventId: string,
): Promise<AnnouncementHistoryBatch[]> {
  const rows = await db
    .select({
      batchId: eventAnnouncements.batchId,
      scope: eventAnnouncements.scope,
      occurrenceDate: eventAnnouncements.occurrenceDate,
      success: eventAnnouncements.success,
      note: eventAnnouncements.note,
      sentAt: eventAnnouncements.sentAt,
      sentByName: users.name,
      sentByEmail: users.email,
    })
    .from(eventAnnouncements)
    .leftJoin(users, eq(eventAnnouncements.sentByUserId, users.id))
    .where(eq(eventAnnouncements.eventId, eventId))
    .orderBy(desc(eventAnnouncements.sentAt));

  // In-memory grouping — table volumes here are small (one row per member
  // per send), same reasoning dues-reminders-queries.ts uses for its own
  // DISTINCT ON query, just without even needing raw SQL since we want
  // every row, not just the latest. Map preserves insertion order, and rows
  // arrive newest-first, so the first time a batchId is seen fixes its
  // position — the returned array stays newest-first.
  const byBatch = new Map<string, AnnouncementHistoryBatch>();
  for (const row of rows) {
    const existing = byBatch.get(row.batchId);
    if (existing) {
      existing.recipientCount += 1;
      if (row.success) existing.successCount += 1;
      else existing.failureCount += 1;
      continue;
    }
    byBatch.set(row.batchId, {
      batchId: row.batchId,
      scope: row.scope === "series" ? "series" : "occurrence",
      occurrenceDate: row.occurrenceDate,
      sentAt: row.sentAt instanceof Date ? row.sentAt.toISOString() : String(row.sentAt),
      sentByName: row.sentByName ?? row.sentByEmail ?? null,
      recipientCount: 1,
      successCount: row.success ? 1 : 0,
      failureCount: row.success ? 0 : 1,
      note: row.note,
    });
  }

  return Array.from(byBatch.values());
}

// ---------------------------------------------------------------------------
// insertEventAnnouncementRows — persists one row per attempted (has-email,
// selected) recipient, all sharing one batchId. Only attempted recipients
// get a row — matches duesReminders/insertDuesReminderRows; skipped members
// (no_longer_active / no_email_on_file / not_selected) appear only in the
// POST response, never persisted.
// ---------------------------------------------------------------------------

export async function insertEventAnnouncementRows(rows: NewEventAnnouncement[]): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(eventAnnouncements).values(rows);
}
