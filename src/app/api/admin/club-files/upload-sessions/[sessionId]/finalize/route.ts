/**
 * POST /api/admin/club-files/upload-sessions/[sessionId]/finalize
 *
 * Step 3 of the chunked-upload protocol (DECISION-095). Assembles the
 * uploaded chunks, verifies size (and optionally a checksum), validates the
 * result is genuinely a PDF via magic bytes, and persists it as a durable
 * club_files/club_file_blobs row — replacing an existing file's bytes
 * atomically when the session's replaceFileId is set (src/lib/
 * club-file-upload-queries.ts's finalizeUploadSession).
 *
 * Any failure below leaves the session alive (not deleted) so the client
 * can retry just the failed step rather than re-uploading every chunk.
 *
 * Gate: club_files.manage
 *
 * Body: { name?, description?, visibility?, checksumSha256? }
 *   name/visibility are REQUIRED for a new file (replaceFileId null on the
 *   session) and IGNORED when replacing (Phase 1 ruling: replace keeps the
 *   existing row's metadata).
 * Response 200: { id, replaced: boolean }
 *
 * 400 — missing/gapped chunk, size mismatch, checksum mismatch, not a
 *       valid PDF, or missing required metadata for a new file
 * 404 — session not found
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { finalizeUploadSession } from "@/lib/club-file-upload-queries";
import { isValidClubFileVisibility } from "@/lib/club-files-queries";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.CLUB_FILES_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { sessionId } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const { name, description, visibility, checksumSha256 } = (body ?? {}) as {
      name?: unknown;
      description?: unknown;
      visibility?: unknown;
      checksumSha256?: unknown;
    };

    if (visibility !== undefined && !isValidClubFileVisibility(visibility)) {
      return NextResponse.json(
        { error: "visibility must be 'public' or 'members-only'" },
        { status: 400 },
      );
    }

    const result = await finalizeUploadSession(sessionId, {
      name: typeof name === "string" ? name : undefined,
      description: typeof description === "string" || description === null ? description : undefined,
      visibility: isValidClubFileVisibility(visibility) ? visibility : undefined,
      checksumSha256: typeof checksumSha256 === "string" ? checksumSha256 : undefined,
    });

    if (!result.ok) {
      switch (result.reason) {
        case "session_not_found":
          return NextResponse.json({ error: "Upload session not found" }, { status: 404 });
        case "missing_chunk":
          return NextResponse.json(
            { error: `Upload incomplete — missing chunk ${result.missingIndex}` },
            { status: 400 },
          );
        case "size_mismatch":
          return NextResponse.json(
            { error: "Uploaded size doesn't match the declared size — please retry the upload" },
            { status: 400 },
          );
        case "checksum_mismatch":
          return NextResponse.json(
            { error: "Checksum mismatch — please retry the upload" },
            { status: 400 },
          );
        case "invalid_type":
          return NextResponse.json({ error: "This isn't a valid PDF file" }, { status: 400 });
        case "missing_metadata":
          return NextResponse.json(
            { error: "name and visibility are required for a new file" },
            { status: 400 },
          );
      }
    }

    return NextResponse.json({ id: result.fileId, replaced: result.replaced });
  } catch (error) {
    console.error("Error finalizing club file upload:", error);
    return NextResponse.json({ error: "Failed to finalize upload" }, { status: 500 });
  }
}
