/**
 * POST /api/admin/santas-workshop/stuffies/[stuffyId]/dismiss-attention  -> RegistrantResponse
 * Per-stuffy dismissal of the "details being checked" flag. Pinned on the flag being
 * set, so a second click is a no-op. The dismissal resets by itself if a later
 * apply or Remap finds a different set of reasons.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { forbidden, fromFailure, notFound, ok, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { dismissAttention, loadStuffyContext } from "@/lib/santas-workshop/stuffy-admin";

export async function POST(_request: Request, { params }: { params: Promise<{ stuffyId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { stuffyId } = await params;
  if (!isUuid(stuffyId)) return notFound("Registrant not found");
  try {
    const context = await loadStuffyContext(stuffyId);
    if (!context) return notFound("Registrant not found");
    const result = await dismissAttention(context.session, stuffyId, session.user.id);
    return result.ok ? ok({ registrant: result.registrant }) : fromFailure(result);
  } catch (e) {
    return serverError("dismiss attention", e);
  }
}
