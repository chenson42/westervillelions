/**
 * PUT /api/admin/santas-workshop/sessions/[id]/scenes/order  SceneOrderRequest -> ScenesListResponse
 *
 * Reorders the storyline. `order` is the COMPLETE list of the session's scene ids. A non-uuid or
 * repeated id is 400 invalid_input; a list that differs from the stored set is 409 scenes_changed
 * (another tab changed the storyline; the client refetches).
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, fromFailure, notFound, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { reorderScenes } from "@/lib/santas-workshop/scene-admin";
import { parseSceneOrder } from "@/lib/santas-workshop/scene-input";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const body = (await readJson(request)) as { order?: unknown } | null;
    const order = parseSceneOrder(body?.order);
    if (!order) return adminError(400, "invalid_input", "order must list each scene id once", "order");
    const result = await reorderScenes(id.toLowerCase(), order, session.user.id);
    if (!result.ok) return fromFailure(result);
    return ok(result.response);
  } catch (e) {
    return serverError("reorder scenes", e);
  }
}
