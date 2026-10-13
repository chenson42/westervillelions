/**
 * GET  /api/admin/santas-workshop/sessions/[id]/crew-code  -> CrewCodeResponse (logs code_viewed, never the code)
 * POST /api/admin/santas-workshop/sessions/[id]/crew-code  { action: rotate | pause | resume, acknowledge? }  -> CrewCodeResponse
 *
 * The code is stored encrypted so an admin can re-read it. Rotating signs every phone
 * out on its next request; with devices active in the last hour the first call is
 * 409 devices_active { count } and the dialog repeats with acknowledge: true.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, fromFailure, notFound, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { crewCodeAction, viewCrewCode } from "@/lib/santas-workshop/crew-admin";
import { CREW_CODE_ACTIONS, type CrewCodeAction } from "@/lib/santas-workshop/admin-contract";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const response = await viewCrewCode(id, session.user.id);
    return response ? ok(response) : notFound("Session not found");
  } catch (e) {
    return serverError("view crew code", e);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const body = (await readJson(request)) as { action?: unknown; acknowledge?: unknown } | null;
    if (!body || typeof body.action !== "string" || !(CREW_CODE_ACTIONS as readonly string[]).includes(body.action)) {
      return adminError(400, "invalid_input", "Choose rotate, pause or resume", "action");
    }
    const result = await crewCodeAction(id, body.action as CrewCodeAction, body.acknowledge === true, session.user.id);
    return result.ok ? ok(result.response) : fromFailure(result);
  } catch (e) {
    return serverError("crew code action", e);
  }
}
