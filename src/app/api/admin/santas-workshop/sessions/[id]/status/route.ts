/**
 * POST /api/admin/santas-workshop/sessions/[id]/status  { to: "draft" | "active" | "closed" }  -> SetStatusResponse
 *
 * The allowed-transition table is session-status.ts. Activating generates the worker
 * code when none exists and, for a REAL session, requires a passing storage test in
 * the last 10 minutes (409 storage_not_ready). Going back to draft is refused once
 * anything has been tagged or photographed (409 has_activity). "Paused" is not a
 * status: see crew-code.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, fromFailure, notFound, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { setSessionStatus } from "@/lib/santas-workshop/crew-admin";
import { isSettableStatus } from "@/lib/santas-workshop/session-status";
import type { SetStatusResponse } from "@/lib/santas-workshop/admin-contract";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const body = (await readJson(request)) as { to?: unknown } | null;
    if (!body || !isSettableStatus(body.to)) return adminError(400, "invalid_input", "Choose draft, active or closed", "to");
    const result = await setSessionStatus(id, body.to, session.user.id);
    if (!result.ok) return fromFailure(result);
    const response: SetStatusResponse = { session: result.session, noop: result.noop };
    return ok(response);
  } catch (e) {
    return serverError("set status", e);
  }
}
