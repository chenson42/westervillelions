/**
 * POST /api/admin/santas-workshop/sessions/[id]/scenes/copy  SceneCopyRequest -> ScenesListResponse
 *
 * Copies title, caption and order (never photos) from another session into this one, which must
 * have no scenes (409 scenes_not_empty). 409 no_scenes_to_copy when the source has none; 404 when
 * the source does not exist; 400 for a non-uuid or the same session.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, fromFailure, notFound, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { copySceneStoryline } from "@/lib/santas-workshop/scene-admin";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const body = (await readJson(request)) as { fromSessionId?: unknown } | null;
    const from = body?.fromSessionId;
    if (typeof from !== "string" || !isUuid(from)) return adminError(400, "invalid_input", "fromSessionId must be a session id", "fromSessionId");
    const result = await copySceneStoryline(id.toLowerCase(), from.toLowerCase(), session.user.id);
    if (!result.ok) return fromFailure(result);
    return ok(result.response);
  } catch (e) {
    return serverError("copy scenes", e);
  }
}
