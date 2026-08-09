/**
 * Small page-data helpers for the admin minutes create/edit form
 * (docs/work-log/2026-08-08-meeting-minutes.md, Phase 3 Component Plan /
 * Implementation Order step 6). Deliberately NOT part of
 * `minutes-queries.ts` — api-developer's Phase 4 handoff explicitly left
 * the "candidate events for a new minutes record" dropdown to ux-developer
 * ("a plain `db.query.events.findMany()` dropdown, same as
 * /members/events/page.tsx already does for its own event listing — no
 * query-module function needed for that part").
 *
 * A roster-lookup helper (`getMinutesFormRoster`) lived here through the
 * original attendance-checklist design — removed under DECISION-079
 * (Phase 4 loop-back): attendance is a single headcount, not a per-member
 * roster fact, so there is no roster to fetch for this form anymore.
 *
 * `getMinutesFormMemberOptions()` below (further Phase 4 increment,
 * 2026-08-09) is a NEW, separate roster-adjacent helper for the notetaker
 * picker — not a revival of the removed one. It's read-only page data for a
 * dropdown, same category as `getMinutesFormEventOptions()`; the actual
 * write-time name resolution for the notetaker field lives in
 * `minutes-queries.ts`'s `getMemberNameSnapshot()`, which this file does
 * NOT call — the two are deliberately independent (this one lists every
 * candidate for the picker; that one resolves exactly one chosen id at save
 * time).
 */

import { db } from "@/lib/db";
import { formatEventWhen } from "@/lib/events";
import { asc } from "drizzle-orm";
import { members } from "@/lib/db/schema";

export interface MinutesEventOption {
  id: string;
  label: string;
}

/** Every event row, most recent first, as `{id, label}` for the "linked
 *  meeting event" dropdown. `minutes.eventId` references the events SERIES
 *  row, not a specific occurrence date, so this lists rows, not enumerated
 *  occurrences — matches the schema's own eventId FK target exactly. */
export async function getMinutesFormEventOptions(): Promise<MinutesEventOption[]> {
  const rows = await db.query.events.findMany({
    orderBy: (e, { desc }) => [desc(e.startDate)],
  });
  return rows.map((e) => ({
    id: e.id,
    label: `${e.title} — ${formatEventWhen({ startDate: e.startDate, isAllDay: e.isAllDay })}`,
  }));
}

export interface MinutesMemberOption {
  id: string;
  label: string;
}

/**
 * Every member (not filtered to `isActive`, unlike e.g. the `link-member-
 * form.tsx` caller's active-only roster) for the "notetaker of record"
 * picker — deliberately unfiltered, so an admin correcting or entering a
 * historical minutes record can still pick someone no longer active. A
 * currently-inactive member's label is suffixed so the picker stays legible
 * about who's on the live roster today without hiding anyone who might
 * legitimately be that meeting's notetaker of record. Sorted by last name,
 * then first name, matching every other member picker in this codebase
 * (e.g. `link-member-form.tsx`).
 */
export async function getMinutesFormMemberOptions(): Promise<MinutesMemberOption[]> {
  const rows = await db
    .select({
      id: members.id,
      firstName: members.firstName,
      lastName: members.lastName,
      membershipStatus: members.membershipStatus,
    })
    .from(members)
    .orderBy(asc(members.lastName), asc(members.firstName));

  return rows.map((m) => ({
    id: m.id,
    label:
      m.membershipStatus === "active"
        ? `${m.firstName} ${m.lastName}`
        : `${m.firstName} ${m.lastName} (no longer active)`,
  }));
}
