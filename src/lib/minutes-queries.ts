/**
 * Meeting Minutes — server-only query module (DB reads/writes).
 *
 * docs/work-log/2026-08-08-meeting-minutes.md (Phase 3 "API Contract" /
 * "Data Model" / "Search" / "The event link"), DECISION-074 Ruling 2
 * (module placement — a new top-level pair, not a `ledger-*` sibling),
 * DECISION-077.
 *
 * Pure constants/validators live in the sibling `src/lib/minutes.ts` — this
 * file is exclusively the DB-facing half, matching the Ledger's
 * `ledger.ts`/`ledger-queries.ts` split generalized to a new domain
 * (DECISION-074 Ruling 2 is explicit that this does NOT join the Ledger's
 * module family; the split pattern is reused, the module family is not).
 *
 * Search stays inside this file rather than a separate
 * `minutes-search-queries.ts` — `ledger-search-queries.ts` was split out
 * because `ledger-queries.ts` was already huge; this file starts at zero, so
 * that reason doesn't apply yet (DECISION-074 Ruling 2).
 *
 * Search implementation is sequential `ILIKE`, no full-text index — same
 * "cheap at this club's data volume" ruling `ledger-search-queries.ts`
 * already established, at even lower volume here (~30 minutes/year).
 *
 * Permission gating is the CALLER's responsibility (route handlers / Server
 * Component pages), matching every other query module in this codebase —
 * nothing in this file checks `FEATURES` itself.
 *
 * Mutation functions that transition `status` (approve/reopen) and the
 * `update` action use an atomic `WHERE`-guarded update-then-check-rows-
 * affected pattern (mirrors the reimbursements route's double-pay guard,
 * `src/app/api/admin/ledger/reimbursements/[id]/route.ts`) rather than a
 * separate read-then-write, so a race between two concurrent requests can't
 * silently apply an update meant for a different status. The feature's own
 * accepted gap (Phase 3 "Edge Cases") is last-write-wins on the CONTENT of
 * concurrent `update` calls, not a state-machine violation — this guard
 * prevents the latter regardless.
 *
 * DECISION-079 (Phase 4 loop-back, 2026-08-09, superseding DECISION-078):
 * there is no `minutesAttendance` child table and no per-member attendance
 * concept in this module at all. The treasurer clarified the actual
 * requirement was "a single count number for attendance," not a roster
 * fact — `minutes.presentCount` is a plain nullable integer column on the
 * parent row, set (or left null) alongside every other content field.
 * DECISION-078's merge-vs-replace contract question, and the data-loss
 * defect it fixed, are moot: there's no child-row array to replace or
 * merge, so there's nothing to lose by omission. `motions`/`actionItems`
 * are unaffected — still delete-then-reinsert, per the original Phase 3
 * design.
 *
 * A further Phase 4 increment (2026-08-09) added `notetakerMemberId`/
 * `notetakerNameSnapshot` — the notetaker OF RECORD, distinct from
 * `authorUserId` (data-entry attribution only, never displayed). Same
 * shape/rationale as the removed `minutesAttendance` design got right for
 * its own member FK: nullable, `ON DELETE SET NULL`, paired with a name
 * snapshot written once at create/update time via `getMemberNameSnapshot()`
 * below — never recomputed from, or invalidated by, the current roster.
 *
 * Deliberately NOT built in this pass (see the work-log's Phase 4 (server)
 * handoff notes for the reasoning): a "candidate events for a new minutes
 * record" / "default event with no minutes yet" query. Phase 3's own
 * Component Plan describes that as an admin-form convenience, not a named
 * function in this file's list, and correctly computing "past occurrences
 * with no minutes yet" for a recurring series needs `generateOccurrences()`
 * walked backward from now — a real, separate, non-trivial piece of logic
 * this round's task scope (getNextOccurrence-based "next meeting" +
 * "previous meeting's minutes" resolution) doesn't cover. `eventId` stays a
 * plain dropdown of `db.query.events.findMany()` for ux-developer to build
 * directly, same as `/members/events/page.tsx` already does for its own
 * event listing — no query-module function needed for that part.
 */

import { db } from "@/lib/db";
import {
  minutes,
  minutesMotions,
  minutesActionItems,
  events,
  eventOccurrenceOverrides,
  members,
} from "@/lib/db/schema";
import { and, desc, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import { getNextOccurrence } from "@/lib/events";
import { escapeIlikeTerm, MINUTES_KIND_EVENT_TITLES, type MinutesKind } from "@/lib/minutes";

// ---------------------------------------------------------------------------
// Shared row/result types
// ---------------------------------------------------------------------------

export interface MotionInput {
  text: string;
  moverName: string;
  seconderName?: string | null;
  result: string;
}

export interface ActionItemInput {
  text: string;
  ownerName: string;
  dueDate?: string | null;
}

export interface CreateMinutesInput {
  kind: string;
  eventId?: string | null;
  meetingDate: string;
  title?: string | null;
  /** A single headcount of members present, or null/omitted if not taken
   *  for this record — DECISION-079. Not a roster, not a `members` FK. */
  presentCount?: number | null;
  /** The notetaker OF RECORD — who took the minutes, not who's typing this
   *  in. Resolved by the caller (the route handler) via
   *  `getMemberNameSnapshot()` BEFORE this function is called, so
   *  `notetakerNameSnapshot` always reflects the member's name at the
   *  moment of this write — never trust a client-supplied name string for
   *  an FK'd field. Both fields are set together or not at all; omitted/null
   *  means no notetaker recorded (a real, legitimate state — see the
   *  schema comment on `minutes.notetakerMemberId`). */
  notetakerMemberId?: string | null;
  notetakerNameSnapshot?: string | null;
  bodyMarkdown?: string | null;
  authorUserId: string;
  motions: MotionInput[];
  actionItems: ActionItemInput[];
}

/** All fields optional — only provided keys are updated. `motions` /
 *  `actionItems`, when provided, fully REPLACE the existing child rows
 *  (delete-then-reinsert), per the Phase 3 API Contract — unchanged.
 *  `presentCount` is a plain scalar column update, same as `title` or
 *  `bodyMarkdown` — DECISION-079 removed the per-member attendance concept
 *  (and the merge-vs-replace question it used to raise, DECISION-078)
 *  entirely; there is no child-row array to lose by omission.
 *  `notetakerMemberId`/`notetakerNameSnapshot` are likewise a plain scalar
 *  pair — present (even as `null`, to clear) means "update it," omitted
 *  means "leave it alone," exactly like every other optional field here. */
export interface UpdateMinutesInput {
  kind?: string;
  eventId?: string | null;
  meetingDate?: string;
  title?: string | null;
  presentCount?: number | null;
  notetakerMemberId?: string | null;
  notetakerNameSnapshot?: string | null;
  bodyMarkdown?: string | null;
  motions?: MotionInput[];
  actionItems?: ActionItemInput[];
}

export type MinutesMutationResult =
  | { ok: true; id: string }
  | { ok: false; reason: "not_found" | "conflict" };

export interface MinutesSummaryRow {
  id: string;
  kind: string;
  title: string | null;
  meetingDate: string;
  status: string;
  eventId: string | null;
  presentCount: number | null;
  pendingDeleteAt: Date | null;
}

/** Admin list rows and member-facing list rows are the same shape now that
 *  attendance is a scalar column on `minutes` itself rather than a joined
 *  child table (DECISION-079) — kept as a distinct exported name since the
 *  two list functions below are still semantically different (admin sees
 *  every kind/status; member-facing excludes soft-deleted rows only). */
export type MinutesAdminSummaryRow = MinutesSummaryRow;

export interface MinutesDetail {
  id: string;
  kind: string;
  eventId: string | null;
  meetingDate: string;
  status: string;
  title: string | null;
  presentCount: number | null;
  notetakerMemberId: string | null;
  notetakerNameSnapshot: string | null;
  bodyMarkdown: string | null;
  authorUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  pendingDeleteAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  motions: {
    id: string;
    text: string;
    moverName: string;
    seconderName: string | null;
    result: string;
  }[];
  actionItems: { id: string; text: string; ownerName: string; dueDate: string | null }[];
}

export interface MostRecentApprovedMinutes {
  id: string;
  kind: string;
  meetingDate: string;
  title: string | null;
  approvedAt: Date | null;
}

export interface NextMeetingPointer {
  eventId: string;
  title: string;
  location: string | null;
  isAllDay: boolean;
  /** Wall-clock local Date, per getNextOccurrence()'s own contract — see
   *  src/lib/events.ts. Never re-derive with `new Date(string)`. */
  occurrence: Date;
}

export interface MinutesSearchRow {
  id: string;
  kind: string;
  meetingDate: string;
  status: string;
  title: string | null;
}

// ---------------------------------------------------------------------------
// Create / update / approve / reopen / delete / restore
// ---------------------------------------------------------------------------

export async function createMinutes(input: CreateMinutesInput): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(minutes)
      .values({
        kind: input.kind,
        eventId: input.eventId ?? null,
        meetingDate: input.meetingDate,
        title: input.title ?? null,
        presentCount: input.presentCount ?? null,
        notetakerMemberId: input.notetakerMemberId ?? null,
        notetakerNameSnapshot: input.notetakerNameSnapshot ?? null,
        bodyMarkdown: input.bodyMarkdown ?? null,
        authorUserId: input.authorUserId,
        status: "draft",
      })
      .returning({ id: minutes.id });

    const minutesId = row.id;

    if (input.motions.length > 0) {
      await tx.insert(minutesMotions).values(
        input.motions.map((m) => ({
          minutesId,
          text: m.text,
          moverName: m.moverName,
          seconderName: m.seconderName ?? null,
          result: m.result,
        })),
      );
    }

    if (input.actionItems.length > 0) {
      await tx.insert(minutesActionItems).values(
        input.actionItems.map((a) => ({
          minutesId,
          text: a.text,
          ownerName: a.ownerName,
          dueDate: a.dueDate ?? null,
        })),
      );
    }

    return { id: minutesId };
  });
}

/**
 * Updates a draft's content fields. `motions`/`actionItems`, when provided,
 * fully replace their child rows (delete-then-reinsert — unchanged).
 * `presentCount` is a plain scalar column update (DECISION-079 — there is no
 * per-member attendance child row to merge or replace). Atomically guarded
 * on `status='draft'` — returns `{ ok: false, reason: 'conflict' }` if the
 * record exists but is no longer a draft (the caller — the PATCH route —
 * returns 409), or `{ ok: false, reason: 'not_found' }` if the id doesn't
 * exist at all.
 */
export async function updateMinutesDraft(
  id: string,
  input: UpdateMinutesInput,
): Promise<MinutesMutationResult> {
  return db.transaction(async (tx) => {
    const updateSet: Record<string, unknown> = { updatedAt: new Date() };
    if (input.kind !== undefined) updateSet.kind = input.kind;
    if (input.eventId !== undefined) updateSet.eventId = input.eventId;
    if (input.meetingDate !== undefined) updateSet.meetingDate = input.meetingDate;
    if (input.title !== undefined) updateSet.title = input.title;
    if (input.presentCount !== undefined) updateSet.presentCount = input.presentCount;
    if (input.notetakerMemberId !== undefined) updateSet.notetakerMemberId = input.notetakerMemberId;
    if (input.notetakerNameSnapshot !== undefined) updateSet.notetakerNameSnapshot = input.notetakerNameSnapshot;
    if (input.bodyMarkdown !== undefined) updateSet.bodyMarkdown = input.bodyMarkdown;

    const updated = await tx
      .update(minutes)
      .set(updateSet)
      .where(and(eq(minutes.id, id), eq(minutes.status, "draft")))
      .returning({ id: minutes.id });

    if (updated.length === 0) {
      const [existing] = await tx.select({ id: minutes.id }).from(minutes).where(eq(minutes.id, id)).limit(1);
      return { ok: false, reason: existing ? "conflict" : "not_found" };
    }

    if (input.motions !== undefined) {
      await tx.delete(minutesMotions).where(eq(minutesMotions.minutesId, id));
      if (input.motions.length > 0) {
        await tx.insert(minutesMotions).values(
          input.motions.map((m) => ({
            minutesId: id,
            text: m.text,
            moverName: m.moverName,
            seconderName: m.seconderName ?? null,
            result: m.result,
          })),
        );
      }
    }

    if (input.actionItems !== undefined) {
      await tx.delete(minutesActionItems).where(eq(minutesActionItems.minutesId, id));
      if (input.actionItems.length > 0) {
        await tx.insert(minutesActionItems).values(
          input.actionItems.map((a) => ({
            minutesId: id,
            text: a.text,
            ownerName: a.ownerName,
            dueDate: a.dueDate ?? null,
          })),
        );
      }
    }

    return { ok: true, id };
  });
}

/** Requires status='draft'. Sets status='approved', approvedByUserId, approvedAt. */
export async function approveMinutes(
  id: string,
  approvedByUserId: string,
): Promise<MinutesMutationResult> {
  const updated = await db
    .update(minutes)
    .set({ status: "approved", approvedByUserId, approvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(minutes.id, id), eq(minutes.status, "draft")))
    .returning({ id: minutes.id });

  if (updated.length === 0) {
    const existing = await getMinutesById(id);
    return { ok: false, reason: existing ? "conflict" : "not_found" };
  }
  return { ok: true, id };
}

/**
 * Requires status='approved'. Sets status='draft'. Does NOT clear
 * approvedByUserId/approvedAt (DECISION-077 §8) — a subsequent approve
 * overwrites them.
 */
export async function reopenMinutes(id: string): Promise<MinutesMutationResult> {
  const updated = await db
    .update(minutes)
    .set({ status: "draft", updatedAt: new Date() })
    .where(and(eq(minutes.id, id), eq(minutes.status, "approved")))
    .returning({ id: minutes.id });

  if (updated.length === 0) {
    const existing = await getMinutesById(id);
    return { ok: false, reason: existing ? "conflict" : "not_found" };
  }
  return { ok: true, id };
}

/** Sets pendingDeleteAt=now() if not already set. Idempotent — an
 *  already-deleted record returns success, not an error. Returns null only
 *  if the id doesn't exist at all (caller 404s). */
export async function softDeleteMinutes(id: string): Promise<{ id: string } | null> {
  const [existing] = await db
    .select({ id: minutes.id, pendingDeleteAt: minutes.pendingDeleteAt })
    .from(minutes)
    .where(eq(minutes.id, id))
    .limit(1);
  if (!existing) return null;
  if (!existing.pendingDeleteAt) {
    await db
      .update(minutes)
      .set({ pendingDeleteAt: new Date(), updatedAt: new Date() })
      .where(eq(minutes.id, id));
  }
  return { id };
}

/** Clears pendingDeleteAt. Idempotent — restoring an already-live record is
 *  a no-op success, not an error. Returns null only if the id doesn't exist
 *  at all (caller 404s). */
export async function restoreMinutes(id: string): Promise<{ id: string } | null> {
  const [existing] = await db.select({ id: minutes.id }).from(minutes).where(eq(minutes.id, id)).limit(1);
  if (!existing) return null;
  await db.update(minutes).set({ pendingDeleteAt: null, updatedAt: new Date() }).where(eq(minutes.id, id));
  return { id };
}

/**
 * Resolves a member id to a display-name snapshot ("{firstName} {lastName}")
 * for the notetaker-of-record field, or `null` if no member with that id
 * exists. Called by the route handlers (POST /api/admin/minutes, PATCH
 * .../[id] `{action:'update'}`) BEFORE createMinutes()/updateMinutesDraft()
 * — never trust a client-supplied name string for an FK'd field; the
 * canonical name always comes from `members` at the moment of the write.
 * Deliberately NOT a live join read at display time (see the schema comment
 * on `minutes.notetakerNameSnapshot`) — this function's result is written
 * once, into a snapshot column, and never consulted again for that record.
 */
export async function getMemberNameSnapshot(memberId: string): Promise<string | null> {
  const [row] = await db
    .select({ firstName: members.firstName, lastName: members.lastName })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  return row ? `${row.firstName} ${row.lastName}` : null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Lightweight parent-row-only fetch, INCLUDING soft-deleted rows — used for
 *  guard checks (404 vs conflict) and the admin restore flow, which needs to
 *  see a deleted record to restore it. */
export async function getMinutesById(id: string): Promise<typeof minutes.$inferSelect | null> {
  const [row] = await db.select().from(minutes).where(eq(minutes.id, id)).limit(1);
  return row ?? null;
}

/** Full joined detail (parent + motions + action items), INCLUDING
 *  soft-deleted rows — matches the admin GET /[id] contract ("including
 *  soft-deleted rows — an admin restoring a record needs to see it").
 *  `presentCount` comes straight off the parent row (DECISION-079 — no
 *  attendance join). Member-facing callers must check
 *  `pendingDeleteAt`/`status` themselves, or use a page-level filter, since
 *  read access is otherwise universal by design (no read gate exists for
 *  minutes). */
export async function getMinutesDetail(id: string): Promise<MinutesDetail | null> {
  const [row] = await db.select().from(minutes).where(eq(minutes.id, id)).limit(1);
  if (!row) return null;

  const [motionRows, actionItemRows] = await Promise.all([
    db
      .select({
        id: minutesMotions.id,
        text: minutesMotions.text,
        moverName: minutesMotions.moverName,
        seconderName: minutesMotions.seconderName,
        result: minutesMotions.result,
      })
      .from(minutesMotions)
      .where(eq(minutesMotions.minutesId, id))
      .orderBy(minutesMotions.createdAt),
    db
      .select({
        id: minutesActionItems.id,
        text: minutesActionItems.text,
        ownerName: minutesActionItems.ownerName,
        dueDate: minutesActionItems.dueDate,
      })
      .from(minutesActionItems)
      .where(eq(minutesActionItems.minutesId, id))
      .orderBy(minutesActionItems.createdAt),
  ]);

  return { ...row, motions: motionRows, actionItems: actionItemRows };
}

export interface MinutesAdminListFilters {
  kind?: string;
  status?: string;
  /** Default false — matches every other soft-delete list in this codebase
   *  (`WHERE pending_delete_at IS NULL` by default). */
  includeDeleted?: boolean;
}

/** Admin list — summary rows only (no bodyMarkdown/motions/action items),
 *  per the API Contract ("list view, not detail"). `presentCount` is a
 *  plain column on `minutes` (DECISION-079) — no join/group-by needed. */
export async function listMinutesForAdmin(
  filters: MinutesAdminListFilters = {},
): Promise<MinutesAdminSummaryRow[]> {
  const conditions: SQL[] = [];
  if (filters.kind) conditions.push(eq(minutes.kind, filters.kind));
  if (filters.status) conditions.push(eq(minutes.status, filters.status));
  if (!filters.includeDeleted) conditions.push(isNull(minutes.pendingDeleteAt));

  const rows = await db
    .select({
      id: minutes.id,
      kind: minutes.kind,
      title: minutes.title,
      meetingDate: minutes.meetingDate,
      status: minutes.status,
      eventId: minutes.eventId,
      presentCount: minutes.presentCount,
      pendingDeleteAt: minutes.pendingDeleteAt,
    })
    .from(minutes)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(minutes.meetingDate));

  return rows;
}

export interface MinutesMemberListFilters {
  kind?: string;
}

/** Member-facing list — always excludes soft-deleted rows; every kind and
 *  status otherwise included (read access is universal by design, no
 *  FEATURES gate — Phase 3 Permissions table). */
export async function listMinutesForMembers(
  filters: MinutesMemberListFilters = {},
): Promise<MinutesSummaryRow[]> {
  const conditions: SQL[] = [isNull(minutes.pendingDeleteAt)];
  if (filters.kind) conditions.push(eq(minutes.kind, filters.kind));

  return db
    .select({
      id: minutes.id,
      kind: minutes.kind,
      title: minutes.title,
      meetingDate: minutes.meetingDate,
      status: minutes.status,
      eventId: minutes.eventId,
      presentCount: minutes.presentCount,
      pendingDeleteAt: minutes.pendingDeleteAt,
    })
    .from(minutes)
    .where(and(...conditions))
    .orderBy(desc(minutes.meetingDate));
}

/** Latest by meetingDate among status='approved' only — excludes drafts and
 *  soft-deleted rows. Used for the "Read {date}'s minutes" link on
 *  /members/records (Flow 1: a member clicking through to "last time's
 *  minutes" should land on the official record, never an in-progress
 *  draft). */
export async function getMostRecentApprovedMinutes(
  kind: string,
): Promise<MostRecentApprovedMinutes | null> {
  const rows = await db
    .select({
      id: minutes.id,
      kind: minutes.kind,
      meetingDate: minutes.meetingDate,
      title: minutes.title,
      approvedAt: minutes.approvedAt,
    })
    .from(minutes)
    .where(and(eq(minutes.kind, kind), eq(minutes.status, "approved"), isNull(minutes.pendingDeleteAt)))
    .orderBy(desc(minutes.meetingDate), desc(minutes.approvedAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Resolves the "next meeting" for a minutes kind by matching
 * `MINUTES_KIND_EVENT_TITLES[kind]` against `events.title` (exact,
 * case-insensitive — ILIKE with no wildcards) and running every candidate
 * through the already-existing `getNextOccurrence()` (src/lib/events.ts),
 * which already handles both a true recurring series and a plain one-off
 * row through the same call — see the Phase 3 "The event link" section for
 * why this is robust regardless of which shape the club's real meeting
 * events turn out to be. Cancelled-occurrence overrides
 * (`event_occurrence_overrides`) are honored, same as
 * `/members/events/page.tsx`'s own next-occurrence resolution.
 *
 * Returns the EARLIEST non-null occurrence across every candidate event, or
 * null if no candidate exists or every candidate's series has ended
 * (unmapped kind, or no future row matches — Phase 3 "empty state").
 */
export async function getNextMeetingPointer(kind: string): Promise<NextMeetingPointer | null> {
  const titlePatterns = MINUTES_KIND_EVENT_TITLES[kind as MinutesKind];
  if (!titlePatterns || titlePatterns.length === 0) return null;

  const candidateRows = await db
    .select({
      id: events.id,
      title: events.title,
      location: events.location,
      isAllDay: events.isAllDay,
      startDate: events.startDate,
      isRecurring: events.isRecurring,
      recurrenceType: events.recurrenceType,
      recurrenceDays: events.recurrenceDays,
      recurrenceEndDate: events.recurrenceEndDate,
    })
    .from(events)
    .where(or(...titlePatterns.map((pattern) => ilike(events.title, pattern)))!);

  if (candidateRows.length === 0) return null;

  const overrideRows = await db
    .select({
      eventId: eventOccurrenceOverrides.eventId,
      occurrenceDate: eventOccurrenceOverrides.occurrenceDate,
    })
    .from(eventOccurrenceOverrides)
    .where(
      inArray(
        eventOccurrenceOverrides.eventId,
        candidateRows.map((c) => c.id),
      ),
    );

  const cancelledByEvent = new Map<string, Set<string>>();
  for (const o of overrideRows) {
    if (!cancelledByEvent.has(o.eventId)) cancelledByEvent.set(o.eventId, new Set());
    cancelledByEvent.get(o.eventId)!.add(o.occurrenceDate);
  }

  const now = new Date();
  let best: { row: (typeof candidateRows)[number]; occurrence: Date } | null = null;
  for (const row of candidateRows) {
    const occurrence = getNextOccurrence(row, now, cancelledByEvent.get(row.id) ?? new Set());
    if (!occurrence) continue;
    if (!best || occurrence.getTime() < best.occurrence.getTime()) {
      best = { row, occurrence };
    }
  }
  if (!best) return null;

  return {
    eventId: best.row.id,
    title: best.row.title,
    location: best.row.location,
    isAllDay: best.row.isAllDay,
    occurrence: best.occurrence,
  };
}

/**
 * `ILIKE`, no full-text index (architect Ruling 2). Matches
 * `minutes.title`/`bodyMarkdown`, `minutesMotions.text`/`moverName`/
 * `seconderName`, and `minutesActionItems.text`/`ownerName`. There is no
 * per-member attendance field to search (DECISION-079 — `presentCount` is a
 * number, not a name). Excludes soft-deleted records. Every non-deleted row
 * is searchable regardless of `kind`/`status` — read access is already
 * universal, so there is no per-result permission filtering to apply here
 * (architect's own note: the cross-audience leak concern that shaped
 * `ledger-search`'s admin-only design doesn't apply to minutes).
 */
export async function searchMinutes(query: string, kind?: string): Promise<MinutesSearchRow[]> {
  const term = query.trim();
  if (!term) return [];

  const escaped = `%${escapeIlikeTerm(term)}%`;
  const conditions: SQL[] = [isNull(minutes.pendingDeleteAt)];
  if (kind) conditions.push(eq(minutes.kind, kind));
  conditions.push(
    or(
      ilike(minutes.title, escaped),
      ilike(minutes.bodyMarkdown, escaped),
      ilike(minutesMotions.text, escaped),
      ilike(minutesMotions.moverName, escaped),
      ilike(minutesMotions.seconderName, escaped),
      ilike(minutesActionItems.text, escaped),
      ilike(minutesActionItems.ownerName, escaped),
    )!,
  );

  return db
    .selectDistinct({
      id: minutes.id,
      kind: minutes.kind,
      meetingDate: minutes.meetingDate,
      status: minutes.status,
      title: minutes.title,
    })
    .from(minutes)
    .leftJoin(minutesMotions, eq(minutesMotions.minutesId, minutes.id))
    .leftJoin(minutesActionItems, eq(minutesActionItems.minutesId, minutes.id))
    .where(and(...conditions))
    .orderBy(desc(minutes.meetingDate));
}
