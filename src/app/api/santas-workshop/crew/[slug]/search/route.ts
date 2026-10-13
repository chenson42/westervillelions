/**
 * GET /api/santas-workshop/crew/[slug]/search?q=  -> CrewSearchResponse
 * q of at least 3 characters; at most 10 rows. Matches the parent's name but never returns it.
 */

import { requireCrew } from "@/lib/santas-workshop/crew-auth";
import type { CrewSearchResponse } from "@/lib/santas-workshop/crew-contract";
import { crewOk, crewServerError } from "@/lib/santas-workshop/crew-http";
import { searchRoster } from "@/lib/santas-workshop/crew-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gate = await requireCrew(request, { slug });
  if (!gate.ok) return gate.response;
  try {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    const body: CrewSearchResponse = { stuffies: await searchRoster(gate.session, q) };
    return crewOk(body);
  } catch (e) {
    return crewServerError("search", e);
  }
}
