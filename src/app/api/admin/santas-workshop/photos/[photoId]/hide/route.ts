/**
 * POST /api/admin/santas-workshop/photos/[photoId]/hide  { hidden: boolean }  -> HidePhotoResponse
 *
 * Hides or unhides one photo (any kind). A hidden photo is withheld from every
 * non-admin surface and is a 404 at the photo door on the next fetch (a browser
 * that already loaded it may show it for up to 5 minutes: accepted). Audited as
 * `photo_hidden` / `photo_unhidden`.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, fromFailure, notFound, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { setPhotoHidden } from "@/lib/santas-workshop/photo-admin";

export async function POST(request: Request, { params }: { params: Promise<{ photoId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { photoId } = await params;
  if (!isUuid(photoId)) return notFound("Photo not found");
  try {
    const body = (await readJson(request)) as { hidden?: unknown } | null;
    if (!body || typeof body.hidden !== "boolean") return adminError(400, "invalid_input", "hidden must be true or false", "hidden");
    const result = await setPhotoHidden(photoId.toLowerCase(), body.hidden, session.user.id);
    if ("ok" in result) return fromFailure(result);
    return ok(result);
  } catch (e) {
    return serverError("hide photo", e);
  }
}
