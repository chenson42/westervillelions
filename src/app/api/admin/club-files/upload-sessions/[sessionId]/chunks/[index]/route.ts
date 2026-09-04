/**
 * PUT /api/admin/club-files/upload-sessions/[sessionId]/chunks/[index]
 *
 * Step 2 of the chunked-upload protocol (DECISION-095). Body is the raw
 * chunk bytes (application/octet-stream — never base64/multipart, which
 * would inflate a 3MB chunk past the safety margin under Vercel's 4.5MB
 * request-body cap).
 *
 * Idempotent by construction: upserts by (sessionId, chunkIndex), the
 * table's composite PK — retrying an identical chunk PUT after a network
 * blip is always safe, and re-PUTting stores the latest bytes.
 *
 * Gate: club_files.manage
 *
 * Response 200: { chunkIndex, receivedChunks, totalChunks }
 *
 * 400 — index out of range, or byte length doesn't match the expected
 *       chunk size for that index
 * 404 — session not found (already finalized, swept, or never existed)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { putUploadChunk } from "@/lib/club-file-upload-queries";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; index: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.CLUB_FILES_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { sessionId, index } = await params;
    const chunkIndex = Number(index);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return NextResponse.json({ error: "Invalid chunk index" }, { status: 400 });
    }

    const arrayBuffer = await request.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);

    const result = await putUploadChunk(sessionId, chunkIndex, bytes);

    if (!result.ok) {
      if (result.reason === "session_not_found") {
        return NextResponse.json({ error: "Upload session not found" }, { status: 404 });
      }
      if (result.reason === "index_out_of_range") {
        return NextResponse.json({ error: "Invalid chunk index" }, { status: 400 });
      }
      return NextResponse.json(
        { error: `Chunk ${chunkIndex} has an unexpected size` },
        { status: 400 },
      );
    }

    return NextResponse.json({
      chunkIndex: result.chunkIndex,
      receivedChunks: result.receivedChunks,
      totalChunks: result.totalChunks,
    });
  } catch (error) {
    console.error("Error uploading club file chunk:", error);
    return NextResponse.json({ error: "Failed to upload chunk" }, { status: 500 });
  }
}
