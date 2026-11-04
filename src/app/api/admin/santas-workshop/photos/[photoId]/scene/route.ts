/**
 * PUT /api/admin/santas-workshop/photos/[photoId]/scene  PhotoSceneRequest -> PhotoSceneResponse
 *
 * Moves ONE group photo to a scene, or to none (`sceneId: null`). It never changes the photo's
 * publish, review, hidden or capture stamps. 404 for an unknown, non-group or purged photo (one
 * body); 409 scene_gone when the scene is not in the photo's session (the client refreshes its list).
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, fromFailure, notFound, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { setPhotoScene } from "@/lib/santas-workshop/scene-admin";

export async function PUT(request: Request, { params }: { params: Promise<{ photoId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { photoId } = await params;
  if (!isUuid(photoId)) return notFound("Photo not found");
  try {
    const body = (await readJson(request)) as { sceneId?: unknown } | null;
    const raw = body?.sceneId;
    if (raw !== null && (typeof raw !== "string" || !isUuid(raw))) return adminError(400, "invalid_input", "sceneId must be a scene id or null", "sceneId");
    const result = await setPhotoScene(photoId.toLowerCase(), raw as string | null, session.user.id);
    if (!result.ok) return fromFailure(result);
    return ok(result.response);
  } catch (e) {
    return serverError("reassign photo scene", e);
  }
}
