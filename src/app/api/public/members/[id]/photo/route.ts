import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/public/members/[id]/photo
 * Serve a member's profile picture as a proper image response.
 * No authentication required — used by the About page leadership grid.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const member = await db.query.members.findFirst({
      where: eq(members.id, id),
      columns: { profilePicture: true },
    });

    // A short cache on 404s (not the full 24h) — a member who currently has
    // no photo may add one later, and we don't want that stale for a day.
    const notFoundHeaders = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" };

    if (!member || !member.profilePicture) {
      return new NextResponse(null, { status: 404, headers: notFoundHeaders });
    }

    // Parse the data URI: data:<mime>;base64,<data>
    const dataUri = member.profilePicture;
    const commaIndex = dataUri.indexOf(",");
    if (commaIndex === -1) {
      return new NextResponse(null, { status: 404, headers: notFoundHeaders });
    }

    const meta = dataUri.slice(0, commaIndex); // e.g. "data:image/jpeg;base64"
    const base64Data = dataUri.slice(commaIndex + 1);

    // Extract mime type from "data:<mime>;base64"
    const mimeMatch = meta.match(/^data:([^;]+);base64$/);
    if (!mimeMatch) {
      return new NextResponse(null, { status: 404, headers: notFoundHeaders });
    }

    const mimeType = mimeMatch[1];
    const buffer = Buffer.from(base64Data, "base64");

    return new Response(buffer, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
        "Content-Length": String(buffer.length),
      },
    });
  } catch (error) {
    console.error("Error serving member photo:", error);
    return new NextResponse(null, { status: 500 });
  }
}
