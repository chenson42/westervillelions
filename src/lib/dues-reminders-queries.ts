/**
 * Dues Reminder Emails — DB-facing query/orchestration layer.
 *
 * Cohort computation goes through the EXISTING listMemberDuesStatus()
 * (src/lib/dues-queries.ts) — not a second, parallel query — so the
 * reminder screen can never disagree with /admin/dues or a member's own
 * /members/dues page (Phase 2 §1, non-negotiable).
 *
 * Signer resolution lives in src/lib/board-positions.ts (resolveTreasurer())
 * — DECISION-086 — shared with the five treasury-email CC sites. Import it
 * directly rather than re-wrapping it here.
 *
 * docs/work-log/2026-08-12-dues-reminder-emails.md, Phase 3 §5.
 */

import { db } from "@/lib/db";
import { duesReminders, type NewDuesReminder } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { listMemberDuesStatus } from "@/lib/dues-queries";
import type { DuesReminderCohort } from "@/lib/dues-reminders";

export type ReminderCandidate = {
  memberId: string;
  firstName: string;
  lastName: string;
  email: string;
  duesCategory: string;
  lastReminded: { sentAt: string; cohort: DuesReminderCohort } | null;
};

/**
 * Most recent dues_reminders row per member for a fiscal year (used for the
 * "Last reminded" badge, Flow 3). DISTINCT ON isn't expressible declaratively
 * via Drizzle's query builder, so this is a small raw sql query — matches
 * the existing style in dues-queries.ts (listMemberDuesStatus/
 * getDuesMethodTotals both use db.execute with the sql tag for the same
 * reason).
 */
async function getLastRemindedMap(
  fiscalYear: number,
): Promise<Map<string, { sentAt: string; cohort: DuesReminderCohort }>> {
  const rows = await db.execute<{ member_id: string; sent_at: string; cohort: string }>(sql`
    SELECT DISTINCT ON (member_id) member_id, sent_at, cohort
    FROM dues_reminders
    WHERE fiscal_year = ${fiscalYear}
    ORDER BY member_id, sent_at DESC
  `);

  const map = new Map<string, { sentAt: string; cohort: DuesReminderCohort }>();
  for (const r of rows) {
    map.set(r.member_id, {
      sentAt: r.sent_at,
      cohort: r.cohort === "partial" ? "partial" : "unpaid",
    });
  }
  return map;
}

/**
 * Returns the fresh unpaid/partial cohorts for a fiscal year, each member
 * annotated with their most recent reminder (if any). Used both by the
 * GET preview route and by page.tsx's server-rendered first paint.
 */
export async function getReminderCandidates(fiscalYear: number): Promise<{
  unpaid: ReminderCandidate[];
  partial: ReminderCandidate[];
}> {
  const [statuses, lastRemindedMap] = await Promise.all([
    listMemberDuesStatus(fiscalYear),
    getLastRemindedMap(fiscalYear),
  ]);

  const unpaid: ReminderCandidate[] = [];
  const partial: ReminderCandidate[] = [];

  for (const s of statuses) {
    if (s.status !== "unpaid" && s.status !== "partial") continue;
    const candidate: ReminderCandidate = {
      memberId: s.memberId,
      firstName: s.firstName,
      lastName: s.lastName,
      email: s.email,
      duesCategory: s.duesCategory,
      lastReminded: lastRemindedMap.get(s.memberId) ?? null,
    };
    if (s.status === "unpaid") unpaid.push(candidate);
    else partial.push(candidate);
  }

  return { unpaid, partial };
}

/**
 * Persists one dues_reminders row per attempted send (success or failure) —
 * the domain record of what was sent to whom, when, signed as whom, and by
 * whom, independent of email_queue's own retention.
 */
export async function insertDuesReminderRows(rows: NewDuesReminder[]): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(duesReminders).values(rows);
}
