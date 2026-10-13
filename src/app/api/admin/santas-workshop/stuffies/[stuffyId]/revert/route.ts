/**
 * POST /api/admin/santas-workshop/stuffies/[stuffyId]/revert  AdminRevertRequest  -> RegistrantResponse
 * An admin's backward move, on any session kind, with a REQUIRED reason kept in the
 * history. Pinned on the state the admin saw (409 stale_state otherwise). Reverting to
 * "registered" clears the sticker (the old code then scans as retired).
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, fromFailure, notFound, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { adminRevert, loadStuffyContext, validateReason } from "@/lib/santas-workshop/stuffy-admin";
import { isStuffyState } from "@/lib/santas-workshop/state-machine";

export async function POST(request: Request, { params }: { params: Promise<{ stuffyId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { stuffyId } = await params;
  if (!isUuid(stuffyId)) return notFound("Registrant not found");
  try {
    const body = (await readJson(request)) as { toState?: unknown; expectedState?: unknown; reason?: unknown } | null;
    if (!body || typeof body.toState !== "string" || !isStuffyState(body.toState)) return adminError(400, "invalid_input", "Choose a state to go back to", "toState");
    if (typeof body.expectedState !== "string" || !isStuffyState(body.expectedState)) return adminError(400, "invalid_input", "The expected state is required", "expectedState");
    const reason = validateReason(body.reason);
    if (!reason.ok) return adminError(400, "invalid_input", reason.error, "reason");
    const context = await loadStuffyContext(stuffyId);
    if (!context) return notFound("Registrant not found");
    const result = await adminRevert(context.session, stuffyId, { toState: body.toState, expectedState: body.expectedState, reason: reason.value }, session.user.id);
    return result.ok ? ok({ registrant: result.registrant }) : fromFailure(result);
  } catch (e) {
    return serverError("admin revert", e);
  }
}
