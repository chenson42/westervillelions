/**
 * GET /api/santas-workshop/crew/[slug]/roster  -> CrewRosterResponse
 * Crew DTOs carry no email, mobile, Zeffy id, note or parent name (crew-contract.ts).
 */

import { requireCrew } from "@/lib/santas-workshop/crew-auth";
import { crewOk, crewServerError } from "@/lib/santas-workshop/crew-http";
import { loadRoster } from "@/lib/santas-workshop/crew-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gate = await requireCrew(request, { slug });
  if (!gate.ok) return gate.response;
  try {
    return crewOk(await loadRoster(gate.session, gate.credential.kind === "admin"));
  } catch (e) {
    return crewServerError("roster", e);
  }
}
