/**
 * GET  /api/admin/santas-workshop/sessions  -> SessionListResponse
 * POST /api/admin/santas-workshop/sessions  -> 201 SessionResponse
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 * POST creates the row, the collage token and the retention dates; it makes no
 * Drive call and sends no email. `kind` is chosen here and immutable after.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { adminError, forbidden, fromFailure, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { createSession, listSessions } from "@/lib/santas-workshop/session-queries";
import { validateCreateSession } from "@/lib/santas-workshop/session-input";
import { getStorageStatus } from "@/lib/santas-workshop/storage-status";
import type { SessionListResponse, SessionResponse } from "@/lib/santas-workshop/admin-contract";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  try {
    const body: SessionListResponse = { sessions: await listSessions(), storage: await getStorageStatus() };
    return ok(body);
  } catch (e) {
    return serverError("list sessions", e);
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  try {
    const input = validateCreateSession(await readJson(request));
    if (!input.ok) return adminError(400, input.code, input.error, input.field);
    const created = await createSession(input.value, session.user.id);
    if (!created.ok) return fromFailure(created);
    const body: SessionResponse = { session: created.session };
    return ok(body, 201);
  } catch (e) {
    return serverError("create session", e);
  }
}
