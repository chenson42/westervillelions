/**
 * POST /api/admin/santas-workshop/sessions/[id]/zeffy/sync  -> SyncResponse
 *
 * "Sync from Zeffy": pulls the session's campaign (never the whole
 * organisation) through the same apply path as the webhook. Time-boxed to about
 * 45 seconds per request: post the returned cursor back until done. A Zeffy rate
 * limit is a normal state (retryAfterMs), not an error. Safe to repeat.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { ZeffyError } from "@/lib/zeffy/client";
import { adminError, forbidden, notFound, ok, readJson, serverError, unauthorized, zeffyFailure } from "@/lib/santas-workshop/admin-http";
import { getSessionRow } from "@/lib/santas-workshop/session-queries";
import { logSessionEvent } from "@/lib/santas-workshop/session-log";
import { runSyncStep } from "@/lib/santas-workshop/sync";
import { parseSyncCursor } from "@/lib/santas-workshop/sync-cursor";

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const parsed = parseSyncCursor(await readJson(request));
    if (!parsed.ok) return adminError(400, "invalid_input", parsed.error, "cursor");

    const row = await getSessionRow(id);
    if (!row) return notFound("Session not found");
    if (row.personalPurgedAt) return adminError(409, "session_purged", "A purged session cannot be synced");
    if (!row.zeffyCampaignId) return adminError(409, "not_mapped", "Connect a Zeffy form first");

    const result = await runSyncStep(row, parsed.cursor);
    if (result.done) {
      await logSessionEvent(id, session.user.id, "sync_run", { ...result.progress.counts, processed: result.progress.processed });
    }
    return ok(result);
  } catch (e) {
    if (e instanceof ZeffyError) return zeffyFailure(e);
    return serverError("sync", e);
  }
}
