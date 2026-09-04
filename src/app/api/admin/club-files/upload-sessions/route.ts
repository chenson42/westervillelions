/**
 * POST /api/admin/club-files/upload-sessions — upload-session init.
 *
 * Step 1 of the chunked-upload protocol (DECISION-095). Before creating the
 * session row, lazily sweeps any prior session older than 24h that never
 * reached status='complete' (cascades to its orphaned chunk rows) — the
 * whole cleanup story for abandoned uploads, no cron required.
 *
 * Gate: club_files.manage
 *
 * Body: { filename: string, declaredSize: number, replaceFileId?: string }
 * Response 200: { sessionId, chunkSize, totalChunks }
 *
 * 400 — declaredSize missing/non-positive or over the 25MB cap
 * 404 — replaceFileId doesn't resolve to an existing file
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { createUploadSession, CLUB_FILE_MAX_DECLARED_SIZE } from "@/lib/club-file-upload-queries";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.CLUB_FILES_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { filename, declaredSize, replaceFileId } = (body ?? {}) as {
      filename?: unknown;
      declaredSize?: unknown;
      replaceFileId?: unknown;
    };

    if (typeof filename !== "string" || !filename.trim()) {
      return NextResponse.json({ error: "filename is required" }, { status: 400 });
    }
    if (typeof declaredSize !== "number" || !Number.isInteger(declaredSize) || declaredSize <= 0) {
      return NextResponse.json({ error: "declaredSize must be a positive integer" }, { status: 400 });
    }
    if (replaceFileId !== undefined && typeof replaceFileId !== "string") {
      return NextResponse.json({ error: "replaceFileId must be a string" }, { status: 400 });
    }

    const result = await createUploadSession({
      filename,
      declaredSize,
      replaceFileId: (replaceFileId as string | undefined) ?? null,
      createdByUserId: session.user.id,
    });

    if (!result.ok) {
      if (result.reason === "too_large") {
        return NextResponse.json(
          {
            error: `Files must be under ${(CLUB_FILE_MAX_DECLARED_SIZE / (1024 * 1024)).toFixed(0)} MB`,
          },
          { status: 400 },
        );
      }
      if (result.reason === "replace_target_not_found") {
        return NextResponse.json({ error: "File to replace was not found" }, { status: 404 });
      }
      return NextResponse.json({ error: "declaredSize must be a positive integer" }, { status: 400 });
    }

    return NextResponse.json({
      sessionId: result.sessionId,
      chunkSize: result.chunkSize,
      totalChunks: result.totalChunks,
    });
  } catch (error) {
    console.error("Error creating club file upload session:", error);
    return NextResponse.json({ error: "Failed to create upload session" }, { status: 500 });
  }
}
