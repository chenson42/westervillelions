/**
 * Admin-action audit for a session (`sw_session_log`). Counts and ids only,
 * NEVER names, contact data, question answers or codes. The vocabulary is the
 * Phase 3 list; later slices add their kinds as they ship.
 */

import { db } from "@/lib/db";
import { swSessionLog } from "@/lib/db/schema";

export const SESSION_LOG_KINDS = [
  "created",
  "campaign_connected",
  "mapping_saved",
  "sync_run",
  "remap_run",
  "session_updated",
  "status_changed",
  "code_viewed",
  "code_rotated",
  "code_paused",
  "code_resumed",
  "storage_test",
  "storage_check",
  "storage_orphans_deleted",
  "manual_add",
  "stuffy_reverted",
  "stuffy_withdrawn",
  "attention_dismissed",
  "refund_kept",
  "refund_withdraw",
  "photo_hidden",
  "photo_unhidden",
  "group_photos_reviewed",
  "collage_published",
  "collage_unpublished",
  "frames_exported",
  "purge_step",
  "purge_done",
  "reset",
] as const;
export type SessionLogKind = (typeof SESSION_LOG_KINDS)[number];

export async function logSessionEvent(
  sessionId: string,
  userId: string | null,
  kind: SessionLogKind,
  detail: Record<string, number | string | boolean | null> = {},
): Promise<void> {
  await db.insert(swSessionLog).values({ sessionId, userId, kind, detail });
}
