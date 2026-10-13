/**
 * GET /api/santas-workshop/photos/[id]?v=thumb|full
 *
 * The photo door for admins and crew. The viewer is resolved against THE PHOTO'S
 * session (a crew cookie for another session is nothing), then photo-access.ts
 * decides. 404 on every failure, never 403: unknown, denied, hidden, purged,
 * missing bytes and a storage outage are indistinguishable.
 */

import { isUuid } from "@/lib/utils";
import { requireCrew } from "@/lib/santas-workshop/crew-auth";
import { photoHeaders, photoSessionId, servePhoto, type PhotoViewer } from "@/lib/santas-workshop/photo-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const notFound = () => new Response("Not found", { status: 404, headers: NOT_FOUND_HEADERS });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  try {
    const sessionId = await photoSessionId(id.toLowerCase());
    if (!sessionId) return notFound();
    const gate = await requireCrew(request, { sessionId });
    if (!gate.ok) return notFound();
    const viewer: PhotoViewer = gate.credential.kind === "admin" ? { kind: "admin" } : { kind: "crew", sessionId };

    const v = new URL(request.url).searchParams.get("v");
    const variant = v === "thumb" ? "thumb" : "full";
    const served = await servePhoto(viewer, id.toLowerCase(), variant);
    if (!served) return notFound();
    return new Response(served.stream, { status: 200, headers: photoHeaders(viewer, served) });
  } catch {
    return notFound();
  }
}
