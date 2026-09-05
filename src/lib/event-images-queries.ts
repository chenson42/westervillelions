/**
 * Event Images — server-only DB access. Site Review Fixes Batch 3.
 * docs/work-log/2026-09-04-site-review-fixes.md
 *
 * One row per event (eventId is the primary key), mirroring the upsert
 * shape of DatabaseClubFileStorage.save() (DECISION-094 sibling). Callers
 * (the admin event create/edit routes, and the public serve route) are
 * responsible for their own permission gating — this module only reads and
 * writes rows.
 */

import { db } from "@/lib/db";
import { eventImages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface EventImageBytes {
  contentType: string;
  data: Buffer;
}

/**
 * Insert or replace the stored image for an event. `updatedAt` is
 * re-stamped on every call (unlike the receipt/club-file blobs' first-write-
 * wins `createdAt`) — it exists purely so a future admin surface could show
 * "image last changed", and there's no first-write to preserve here since
 * each event has at most one row.
 */
export async function upsertEventImage(
  eventId: string,
  data: Buffer,
  contentType: string
): Promise<void> {
  await db
    .insert(eventImages)
    .values({ eventId, data, contentType, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [eventImages.eventId],
      set: { data, contentType, updatedAt: new Date() },
    });
}

/** No-op if the event has no stored image. */
export async function deleteEventImage(eventId: string): Promise<void> {
  await db.delete(eventImages).where(eq(eventImages.eventId, eventId));
}

/** Returns `null` if the event has no stored image — caller should 404. */
export async function getEventImage(eventId: string): Promise<EventImageBytes | null> {
  const rows = await db
    .select({ data: eventImages.data, contentType: eventImages.contentType })
    .from(eventImages)
    .where(eq(eventImages.eventId, eventId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { data: row.data, contentType: row.contentType };
}
