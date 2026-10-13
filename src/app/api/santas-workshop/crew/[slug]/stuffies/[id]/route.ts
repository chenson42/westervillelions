/**
 * GET /api/santas-workshop/crew/[slug]/stuffies/[id]?view=tag|checkin|portrait|pickup  -> CrewViewCard
 * Least data per screen. A stuffy of another session is a 404 (the session comes from the credential).
 */

import { isUuid } from "@/lib/utils";
import { requireCrew } from "@/lib/santas-workshop/crew-auth";
import { CREW_VIEWS, type CrewView } from "@/lib/santas-workshop/crew-contract";
import { crewError, crewOk, crewServerError } from "@/lib/santas-workshop/crew-http";
import { getViewCard } from "@/lib/santas-workshop/crew-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const gate = await requireCrew(request, { slug });
  if (!gate.ok) return gate.response;
  try {
    const view = new URL(request.url).searchParams.get("view") ?? "";
    if (!isUuid(id) || !(CREW_VIEWS as readonly string[]).includes(view)) return crewError(404, "not_found", "That stuffy is not on this list");
    const card = await getViewCard(gate.session, id, view as CrewView);
    return card ? crewOk(card) : crewError(404, "not_found", "That stuffy is not on this list");
  } catch (e) {
    return crewServerError("view card", e);
  }
}
