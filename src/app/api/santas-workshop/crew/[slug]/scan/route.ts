/**
 * POST /api/santas-workshop/crew/[slug]/scan  { code }  -> ScanResult
 * The decoded sticker text is in the body, never in a URL. A code bound in another
 * session answers exactly like an unbound one.
 */

import { requireCrew } from "@/lib/santas-workshop/crew-auth";
import { crewError, crewOk, crewServerError, readCrewJson } from "@/lib/santas-workshop/crew-http";
import { scanCode } from "@/lib/santas-workshop/crew-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gate = await requireCrew(request, { slug });
  if (!gate.ok) return gate.response;
  try {
    const body = (await readCrewJson(request)) as { code?: unknown } | null;
    const result = await scanCode(gate.session.id, body?.code);
    if ("invalid" in result) return crewError(400, "invalid_input", result.invalid);
    return crewOk(result);
  } catch (e) {
    return crewServerError("scan", e);
  }
}
