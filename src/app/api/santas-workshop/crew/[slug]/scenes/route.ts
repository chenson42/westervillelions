/**
 * GET /api/santas-workshop/crew/[slug]/scenes  -> CrewScenesResponse
 * The storyline for the credential's own session (never the URL's), for the group-photo picker.
 * Crew can read scenes, never author them. No counts.
 */

import { requireCrew } from "@/lib/santas-workshop/crew-auth";
import type { CrewScenesResponse } from "@/lib/santas-workshop/crew-contract";
import { crewOk, crewServerError } from "@/lib/santas-workshop/crew-http";
import { listCrewScenes } from "@/lib/santas-workshop/scene-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gate = await requireCrew(request, { slug });
  if (!gate.ok) return gate.response;
  try {
    const body: CrewScenesResponse = { scenes: await listCrewScenes(gate.session.id) };
    return crewOk(body);
  } catch (e) {
    return crewServerError("scenes", e);
  }
}
