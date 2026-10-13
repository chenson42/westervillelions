/**
 * POST /api/admin/santas-workshop/sessions/[id]/photos/review  { throughPhotoId: uuid }  -> ReviewPhotosResponse
 *
 * Records that the admin looked through the group photos up to `throughPhotoId` (the
 * newest upload the page showed). "Reviewed" is `created_at <= that photo's created_at`,
 * compared in SQL. Publish is refused while any unhidden group photo is newer. Audited as `group_photos_reviewed`.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, fromFailure, notFound, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { markGroupPhotosReviewed } from "@/lib/santas-workshop/photo-admin";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const body = (await readJson(request)) as { throughPhotoId?: unknown } | null;
    if (!body || typeof body.throughPhotoId !== "string" || !isUuid(body.throughPhotoId)) {
      return adminError(400, "invalid_input", "throughPhotoId must be the newest group photo you reviewed", "throughPhotoId");
    }
    const result = await markGroupPhotosReviewed(id, body.throughPhotoId.toLowerCase(), session.user.id);
    if ("ok" in result) return fromFailure(result);
    return ok(result);
  } catch (e) {
    return serverError("review group photos", e);
  }
}
