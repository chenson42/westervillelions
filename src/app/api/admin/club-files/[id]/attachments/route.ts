/**
 * PUT /api/admin/club-files/[id]/attachments
 *
 * Replace-the-full-set semantics: the caller sends the complete desired set
 * of eventIds; the server dedupes it, diffs against the current
 * attachments, and inserts/deletes only the difference inside one
 * transaction (src/lib/club-files-queries.ts's setClubFileEventAttachments).
 *
 * Gate: club_files.manage
 *
 * Body: { eventIds: string[] }
 * Response 200: { eventIds: string[] }
 *
 * 400 — eventIds missing or not an array of strings
 * 404 — file not found
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { setClubFileEventAttachments } from "@/lib/club-files-queries";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.CLUB_FILES_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const eventIds = (body as { eventIds?: unknown })?.eventIds;

    if (!Array.isArray(eventIds) || eventIds.some((v) => typeof v !== "string")) {
      return NextResponse.json({ error: "eventIds must be an array of strings" }, { status: 400 });
    }

    const result = await setClubFileEventAttachments(id, eventIds);
    if (!result.ok) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    return NextResponse.json({ eventIds: result.eventIds });
  } catch (error) {
    console.error("Error updating club file attachments:", error);
    return NextResponse.json({ error: "Failed to update attachments" }, { status: 500 });
  }
}
