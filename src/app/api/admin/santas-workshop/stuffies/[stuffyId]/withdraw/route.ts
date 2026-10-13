/**
 * POST /api/admin/santas-workshop/stuffies/[stuffyId]/withdraw  { reason }  -> RegistrantResponse
 * Allowed only from registered or tagged (409 withdraw_not_allowed once in custody:
 * a stuffy in custody can only be flagged). Idempotent on an already-withdrawn row.
 * A manual add is corrected by Withdraw plus Add again.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, fromFailure, notFound, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { adminWithdraw, loadStuffyContext, validateReason } from "@/lib/santas-workshop/stuffy-admin";

export async function POST(request: Request, { params }: { params: Promise<{ stuffyId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { stuffyId } = await params;
  if (!isUuid(stuffyId)) return notFound("Registrant not found");
  try {
    const body = (await readJson(request)) as { reason?: unknown } | null;
    const reason = validateReason(body?.reason);
    if (!reason.ok) return adminError(400, "invalid_input", reason.error, "reason");
    const context = await loadStuffyContext(stuffyId);
    if (!context) return notFound("Registrant not found");
    const result = await adminWithdraw(context.session, stuffyId, reason.value, session.user.id);
    return result.ok ? ok({ registrant: result.registrant }) : fromFailure(result);
  } catch (e) {
    return serverError("withdraw", e);
  }
}
