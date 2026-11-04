/**
 * GET  /api/admin/santas-workshop/sessions/[id]/scenes  -> ScenesListResponse (with admin-only photo counts)
 * POST /api/admin/santas-workshop/sessions/[id]/scenes  SceneSaveRequest -> 201 SceneSaveResponse
 *
 * The storyline: scene title, caption and order for the public collage (DECISION-128). The text is
 * validated by validateSceneText() in scene-admin.ts. Errors: 400 invalid_input (field = title/caption),
 * 404 not_found, 409 scene_limit / session_purged.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements of each handler.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, fromFailure, notFound, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import type { ScenesListResponse, SceneSaveResponse } from "@/lib/santas-workshop/scene-contract";
import { createScene } from "@/lib/santas-workshop/scene-admin";
import { listAdminScenes } from "@/lib/santas-workshop/scene-queries";
import { getSessionRow } from "@/lib/santas-workshop/session-queries";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    if (!(await getSessionRow(id.toLowerCase()))) return notFound("Session not found");
    const body: ScenesListResponse = { scenes: await listAdminScenes(id.toLowerCase()) };
    return ok(body);
  } catch (e) {
    return serverError("list scenes", e);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const body = (await readJson(request)) as { title?: unknown; caption?: unknown } | null;
    if (!body || typeof body !== "object") return adminError(400, "invalid_input", "Send a title and an optional caption", "title");
    const result = await createScene(id.toLowerCase(), body, session.user.id);
    if (!result.ok) return fromFailure(result);
    const response: SceneSaveResponse = result.response;
    return ok(response, 201);
  } catch (e) {
    return serverError("create scene", e);
  }
}
