/**
 * POST /api/santas-workshop/crew/[slug]/stuffies/[id]/revert  RevertRequest  -> CrewActionResponse
 * PRACTICE sessions only (403 practice_only otherwise, even for an admin credential:
 * a real session's backward move is the admin route, with a reason).
 */

import { isUuid } from "@/lib/utils";
import { requireCrew } from "@/lib/santas-workshop/crew-auth";
import { crewError, crewServerError, readCrewJson } from "@/lib/santas-workshop/crew-http";
import { parseRevert } from "@/lib/santas-workshop/crew-input";
import { transitionResponse, writeContextFor } from "@/lib/santas-workshop/crew-respond";
import { revertStuffy } from "@/lib/santas-workshop/stuffy-transitions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const gate = await requireCrew(request, { slug });
  if (!gate.ok) return gate.response;
  try {
    if (!isUuid(id)) return crewError(404, "not_found", "That stuffy is not on this list");
    if (gate.session.kind !== "practice") return crewError(403, "practice_only", "Going backward is only available on a practice session.");
    const input = parseRevert(await readCrewJson(request));
    if (!input.ok) return crewError(400, "invalid_input", input.error);
    const result = await revertStuffy(writeContextFor(gate.credential, gate.session), {
      stuffyId: id,
      toState: input.value.toState,
      expectedState: input.value.expectedState,
      reason: "practice revert",
    });
    return await transitionResponse(gate.session.id, result);
  } catch (e) {
    return crewServerError("revert", e);
  }
}
