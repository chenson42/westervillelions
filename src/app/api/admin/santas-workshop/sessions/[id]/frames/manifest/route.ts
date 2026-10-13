/**
 * POST /api/admin/santas-workshop/sessions/[id]/frames/manifest  -> FrameManifest
 *
 * The frame-export manifest (Slice 4). POST, not GET, because it allocates persisted frame
 * numbers (idempotent; numbers are never reassigned). Lists every stuffy with an exportable
 * portrait, plus the withheld ones (hidden or no portrait), counts and the QR payload.
 * 409 `collage_url_not_production` when a real session's collage link is not the production
 * origin. Parent names only: no email, phone or notes.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { forbidden, fromFailure, notFound, ok, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { buildFrameManifest } from "@/lib/santas-workshop/frame-export";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const result = await buildFrameManifest(id);
    if ("ok" in result) return fromFailure(result);
    return ok(result);
  } catch (e) {
    return serverError("frame manifest", e);
  }
}
