import { NextRequest, NextResponse } from "next/server";
import { getEventImage } from "@/lib/event-images-queries";

/**
 * GET /api/public/events/[id]/image
 * Serve an event's banner image bytes. No authentication required — this is
 * the src of an <img>/<Image> on public pages (homepage, /events,
 * /events/[id]) and in admin surfaces alike.
 *
 * Site Review Fixes Batch 3 — replaces base64 data: URIs that used to live
 * directly in events.image. docs/work-log/2026-09-04-site-review-fixes.md
 *
 * Mirrors the shape of GET /api/public/members/[id]/photo: 404 (never an
 * error page) when there's nothing to serve, short-cached so a later upload
 * isn't stuck behind a stale negative cache; a hit is cached long and
 * immutable because the caller always requests a specific `?v=` version and
 * bumps it on replace.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const notFoundHeaders = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" };

  try {
    const { id } = await params;

    const image = await getEventImage(id);
    if (!image) {
      return new NextResponse(null, { status: 404, headers: notFoundHeaders });
    }

    return new Response(new Uint8Array(image.data), {
      headers: {
        "Content-Type": image.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(image.data.length),
      },
    });
  } catch (error) {
    console.error("Error serving event image:", error);
    return new NextResponse(null, { status: 500, headers: notFoundHeaders });
  }
}
