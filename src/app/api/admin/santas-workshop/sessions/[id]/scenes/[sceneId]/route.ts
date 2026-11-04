/**
 * PATCH  /api/admin/santas-workshop/sessions/[id]/scenes/[sceneId]  SceneSaveRequest -> SceneSaveResponse
 * DELETE /api/admin/santas-workshop/sessions/[id]/scenes/[sceneId]  -> SceneDeleteResponse
 *
 * PATCH replaces title and caption (last write wins). DELETE removes the scene; its photos fall back
 * to "no scene" through the foreign key (they appear under Other pictures). An unknown scene, or a
 * scene of another session, is one identical 404.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements of each handler.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, fromFailure, notFound, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { deleteScene, updateScene } from "@/lib/santas-workshop/scene-admin";

type Params = { params: Promise<{ id: string; sceneId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id, sceneId } = await params;
  if (!isUuid(id) || !isUuid(sceneId)) return notFound("Scene not found");
  try {
    const body = (await readJson(request)) as { title?: unknown; caption?: unknown } | null;
    if (!body || typeof body !== "object") return adminError(400, "invalid_input", "Send a title and an optional caption", "title");
    const result = await updateScene(id.toLowerCase(), sceneId.toLowerCase(), body, session.user.id);
    if (!result.ok) return fromFailure(result);
    return ok(result.response);
  } catch (e) {
    return serverError("update scene", e);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id, sceneId } = await params;
  if (!isUuid(id) || !isUuid(sceneId)) return notFound("Scene not found");
  try {
    const result = await deleteScene(id.toLowerCase(), sceneId.toLowerCase(), session.user.id);
    if (!result.ok) return fromFailure(result);
    return ok(result.response);
  } catch (e) {
    return serverError("delete scene", e);
  }
}
