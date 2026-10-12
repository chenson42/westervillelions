/**
 * GET /api/admin/santas-workshop/sessions/[id]/zeffy/questions  -> QuestionsResponse
 *
 * The distinct question strings seen in stored answers (learned from payments,
 * not from the campaign endpoint: an unmapped campaign stores nothing, so strings
 * can only be seen after the campaign is connected), with counts and the field
 * each currently maps to. Question TEXT only; no answers are returned.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { forbidden, notFound, ok, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { listSeenQuestions } from "@/lib/santas-workshop/session-queries";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const result = await listSeenQuestions(id);
    return result ? ok(result) : notFound("Session not found");
  } catch (e) {
    return serverError("list questions", e);
  }
}
