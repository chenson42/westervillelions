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
