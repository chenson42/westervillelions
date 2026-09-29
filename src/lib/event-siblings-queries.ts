/**
 * Bulk-edit same-titled upcoming events — DB-facing query layer.
 *
 * One function: fetch every OTHER event row sharing a given event's exact
 * title. Cardinality is a handful of rows for this club's data (a same-
 * title schedule like "Board Meeting"), so no index work is warranted —
 * same reasoning as ledger-search-queries.ts / minutes-queries.ts.
 *
 * "Upcoming" filtering is deliberately NOT done here in SQL — see
 * isUpcomingWallClock() in src/lib/events.ts and DECISION-005. This module
 * only narrows by title; callers filter the (small) result in application
 * code with isUpcomingWallClock().
 *
 * No FEATURES check inside this file, matching every other `*-queries.ts`
 * module's convention — permission gating is the caller's job.
 *
 * docs/work-log/2026-09-29-bulk-edit-same-title-events.md (Phase 3,
 * Component Plan — "Files to create").
 */

import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { and, eq, ne } from "drizzle-orm";

export type EventSiblingCandidate = {
  id: string;
  title: string;
  startDate: string;
  isAllDay: boolean;
};

/**
 * Every OTHER event row (`id <> excludeId`) whose title exactly matches
 * `title`. Callable with either `db` (page-load display) or the `tx`
 * handed to `db.transaction()`'s callback (save-time write) — both expose
 * the same Drizzle query-builder `.select().from().where()` shape, so this
 * one function serves both call sites with zero duplication of the
 * `WHERE title = ... AND id <> ...` SQL.
 */
export async function getSiblingCandidatesByTitle(
  dbOrTx: { select: typeof db.select },
  title: string,
  excludeId: string
): Promise<EventSiblingCandidate[]> {
  const rows = await dbOrTx
    .select({
      id: events.id,
      title: events.title,
      startDate: events.startDate,
      isAllDay: events.isAllDay,
    })
    .from(events)
    .where(and(eq(events.title, title), ne(events.id, excludeId)));
  return rows;
}
