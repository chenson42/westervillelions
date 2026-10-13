/**
 * POST /api/admin/santas-workshop/sessions/[id]/purge  PurgeRequest { phase, force?, reason? }  -> PurgeResponse
 *
 * Removes one scope of a session's data (DECISION-125): `personal` (parent and child data, form answers,
 * notes, the stored webhook snapshot, check-in photos) or `public` (portraits and group photos). The
 * server decides eligibility: the session must be closed and the scope's date must have come
 * (409 not_eligible), unless `force: true` with a `reason`. Resumable and time-boxed (about 25 s): while
 * `done` is false, call again. A photo-store failure is a 503 with the storage code; progress made
 * before it is kept and the next call continues. Audited as purge_step / purge_done (counts, no names).
 * Preview the counts first with GET .../retention/preview.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, fromFailure, notFound, ok, readJson, serverError, storageFailure, unauthorized } from "@/lib/santas-workshop/admin-http";
import { isRetentionScope, parseForce } from "@/lib/santas-workshop/retention-policy";
import { purgeSession } from "@/lib/santas-workshop/retention";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const body = (await readJson(request)) as { phase?: unknown; force?: unknown; reason?: unknown } | null;
    if (!body || !isRetentionScope(body.phase)) return adminError(400, "invalid_input", "Choose personal or public", "phase");
    const force = parseForce(body);
    if (!force.ok) return adminError(400, "invalid_input", force.error, force.field);

    const result = await purgeSession({ sessionId: id, scope: body.phase, userId: session.user.id, force: force.force, reason: force.reason });
    if ("ok" in result) return fromFailure(result);
    return ok(result);
  } catch (e) {
    return storageFailure(e) ?? serverError("purge session", e);
  }
}
