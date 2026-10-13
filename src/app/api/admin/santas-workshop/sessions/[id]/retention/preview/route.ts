/**
 * GET /api/admin/santas-workshop/sessions/[id]/retention/preview  -> RetentionPreview
 *
 * What each purge scope (and, for a practice session, the reset) would remove right now, as counts
 * only, plus whether each scope may run (closed session and the removal date). Writes nothing.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { forbidden, notFound, ok, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { getRetentionPreview } from "@/lib/santas-workshop/retention";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const preview = await getRetentionPreview(id);
    return preview ? ok(preview) : notFound("Session not found");
  } catch (e) {
    return serverError("retention preview", e);
  }
}
