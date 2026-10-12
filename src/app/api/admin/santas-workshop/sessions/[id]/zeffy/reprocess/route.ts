/**
 * POST /api/admin/santas-workshop/sessions/[id]/zeffy/reprocess  -> RemapResponse
 *
 * Remap: re-apply the saved question map to the answers already stored, in
 * batches of 200 (post the returned cursor back until done). Local only, no
 * Zeffy call. Writes import-owned columns only.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, notFound, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { getSessionRow } from "@/lib/santas-workshop/session-queries";
import { remapBatch } from "@/lib/santas-workshop/remap";
import { logSessionEvent } from "@/lib/santas-workshop/session-log";
import type { RemapResponse } from "@/lib/santas-workshop/admin-contract";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const raw = await readJson(request);
    const cursor = raw && typeof raw === "object" && "cursor" in raw ? (raw as { cursor: unknown }).cursor : null;
    if (cursor !== null && cursor !== undefined && (typeof cursor !== "string" || !isUuid(cursor))) {
      return adminError(400, "invalid_input", "cursor must be an id from the previous response", "cursor");
    }
    const row = await getSessionRow(id);
    if (!row) return notFound("Session not found");
    if (row.personalPurgedAt) return adminError(409, "session_purged", "A purged session cannot be edited");

    const result = await remapBatch(row, (cursor as string | null | undefined) ?? null);
    if (result.done) await logSessionEvent(id, session.user.id, "remap_run", { changed: result.changed });
    const body: RemapResponse = result;
    return ok(body);
  } catch (e) {
    return serverError("remap", e);
  }
}
