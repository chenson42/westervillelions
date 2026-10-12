/**
 * GET   /api/admin/santas-workshop/sessions/[id]  -> SessionOverview
 * PATCH /api/admin/santas-workshop/sessions/[id]  -> SessionResponse
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 * PATCH rejects `kind` and `slug` (400 immutable_field); removing a window that
 * registrants chose is 409 window_in_use. Dates are validated on the merged row.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, fromFailure, notFound, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { getSessionOverview, updateSession } from "@/lib/santas-workshop/session-queries";
import { validateUpdateSession } from "@/lib/santas-workshop/session-input";
import type { SessionResponse } from "@/lib/santas-workshop/admin-contract";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const overview = await getSessionOverview(id);
    return overview ? ok(overview) : notFound("Session not found");
  } catch (e) {
    return serverError("get session", e);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const patch = validateUpdateSession(await readJson(request));
    if (!patch.ok) return adminError(400, patch.code, patch.error, patch.field);
    const updated = await updateSession(id, patch.value, session.user.id);
    if (!updated.ok) return fromFailure(updated);
    const body: SessionResponse = { session: updated.session };
    return ok(body);
  } catch (e) {
    return serverError("update session", e);
  }
}
