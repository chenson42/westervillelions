/**
 * GET /api/santas-workshop/family/[token]/portrait?v=thumb|full&download=1
 *
 * The family's own portrait, through the photo door with the family viewer. The token is the
 * credential (128-bit, unthrottled by design: Phase 3 ruling 9). Serves ONLY that stuffy's current,
 * unhidden portrait, whatever the photo-sharing choice, once the collage is published and before the
 * public purge. `download=1` sends it as an attachment with a neutral file name. 404 on every failure
 * (unknown or malformed token, no portrait, hidden, purged, missing bytes, storage outage), never 403.
 */

import { photoHeaders, servePhoto } from "@/lib/santas-workshop/photo-access";
import { resolveFamilyPortrait } from "@/lib/santas-workshop/family-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const notFound = () => new Response("Not found", { status: 404, headers: NOT_FOUND_HEADERS });

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const target = await resolveFamilyPortrait(token);
    if (!target) return notFound();
    const q = new URL(request.url).searchParams;
    const variant = q.get("v") === "thumb" ? "thumb" : "full";
    const viewer = { kind: "family", stuffyId: target.stuffyId } as const;
    const served = await servePhoto(viewer, target.photoId, variant);
    if (!served) return notFound();
    return new Response(served.stream, { status: 200, headers: photoHeaders(viewer, served, q.get("download") === "1") });
  } catch {
    return notFound();
  }
}
