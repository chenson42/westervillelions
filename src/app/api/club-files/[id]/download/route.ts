/**
 * GET /api/club-files/[id]/download
 *
 * The unified, visibility-checked download route — one code path for both
 * public and members-only files (Phase 2 ruling: no mirrored /api/public/...
 * + /api/members/... pair over the same table).
 *
 * Checks club_files.visibility on EVERY request:
 *   - visibility === 'public'        → served unauthenticated
 *   - visibility === anything else   → requires an authenticated session
 *     with a non-null session.user.memberId (a linked member account)
 *
 * EVERY failure mode returns 404 — never 403 — per Phase 1's
 * adversarial-pass ruling: a private file's existence must not be
 * confirmed to an anonymous or non-member caller. That covers: id doesn't
 * exist, id was deleted, visibility is members-only and the caller has no
 * session, has a session but no linked memberId, or the blob itself is
 * missing from storage.
 *
 * Success is a genuinely streamed Response — bytes are read from storage
 * into one Buffer server-side (the file is capped at 25MB, well inside a
 * serverless invocation's memory ceiling per DECISION-094), then enqueued
 * into a ReadableStream in 256KB slices. This is what actually avoids
 * Vercel's 4.5MB *buffered*-response cap (streaming a response bypasses it;
 * a single large body does not) — do NOT copy the buffered
 * receiptBytesToBodyInit() pattern here, which is exactly what this route's
 * streaming requirement exists to avoid.
 *
 * Headers: Content-Type: application/pdf, Content-Disposition: inline with
 * a re-sanitized filename (never echoed from storage unsanitized, per
 * Phase 1's adversarial-pass requirement).
 *
 * Response 200: streamed PDF bytes
 * Response 404: { error } — every failure mode, see above
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getClubFileForDownload } from "@/lib/club-files-queries";
import { getClubFileStorage, sanitizeClubFileName } from "@/lib/club-file-storage";

const STREAM_SLICE_SIZE = 256 * 1024; // 256 KB

/**
 * Wraps a Buffer in a ReadableStream, enqueuing fixed-size slices copied
 * (not merely viewed) via Uint8Array.from — the same safety measure
 * receiptBytesToBodyInit() documents: Buffer.subarray() returns a view
 * sharing the parent's backing ArrayBuffer, and Uint8Array.from() copies
 * exactly that view's own bytes into a freshly allocated, exactly-sized
 * buffer, immune to Node's small-allocation pooling by construction.
 */
function bufferToReadableStream(buffer: Buffer): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= buffer.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + STREAM_SLICE_SIZE, buffer.byteLength);
      controller.enqueue(Uint8Array.from(buffer.subarray(offset, end)));
      offset = end;
    },
  });
}

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const file = await getClubFileForDownload(id);
    if (!file) return notFound();

    if (file.visibility !== "public") {
      const session = await auth();
      if (!session?.user?.memberId) {
        return notFound();
      }
    }

    const stored = await getClubFileStorage().read(file.storageKey);
    if (!stored) return notFound();

    const safeFilename = sanitizeClubFileName(file.filename || "file.pdf");
    const stream = bufferToReadableStream(stored.bytes);

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": stored.contentType || "application/pdf",
        "Content-Disposition": `inline; filename="${safeFilename}"`,
        "Content-Length": stored.bytes.byteLength.toString(),
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Error streaming club file download:", error);
    return NextResponse.json({ error: "Failed to retrieve file" }, { status: 500 });
  }
}
