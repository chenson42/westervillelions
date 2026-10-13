/**
 * POST /api/admin/santas-workshop/sessions/[id]/reset  (no body)  -> ResetResponse
 *
 * Wipes a PRACTICE session's registrants, orders, history and photos (bytes first, then rows) so the
 * drill can be run again; the session's settings and Zeffy connection stay. A real session is refused
 * (403 practice_only), checked on the server. Immediate (no date rule), resumable and time-boxed:
 * while `done` is false, call again. Audited as `reset` with counts.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { forbidden, fromFailure, notFound, ok, serverError, storageFailure, unauthorized } from "@/lib/santas-workshop/admin-http";
import { resetPracticeSession } from "@/lib/santas-workshop/retention";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const result = await resetPracticeSession(id, session.user.id);
    if ("ok" in result) return fromFailure(result);
    return ok(result);
  } catch (e) {
    return storageFailure(e) ?? serverError("reset practice session", e);
  }
}
