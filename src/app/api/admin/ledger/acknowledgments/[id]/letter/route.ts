/**
 * GET  /api/admin/ledger/acknowledgments/[id]/letter  — Proxy letter file
 * POST /api/admin/ledger/acknowledgments/[id]/letter  — Upload letter file
 *
 * Both gates: LEDGER_RECORD
 *
 * GET: Reads ledgerAcknowledgments.letterStorageKey for this ack id,
 *   calls getReceiptStorage().read(key), streams bytes.
 *   - 403 (not 404) if lacking LEDGER_RECORD — enumeration guard.
 *   - 404 if ack not found or letterStorageKey is null.
 *
 * POST: Multipart upload. Validates magic bytes (PDF/JPEG/PNG) + 10 MB limit.
 *   Key namespace: acknowledgments/<uuid>/<sanitized-name>.
 *   If ack already has a letterStorageKey, deletes the old file before saving.
 *   Returns { key } on success.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { db } from "@/lib/db";
import { ledgerAcknowledgments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getReceiptStorage } from "@/lib/receipt-storage";
import { validateMagicBytes } from "@/lib/receipt-magic-bytes";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Sanitize a filename to safe path characters. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 100);
}

/**
 * GET /api/admin/ledger/acknowledgments/[id]/letter
 *
 * Proxy the stored acknowledgment letter file.
 * Returns 403 (not 404) when lacking LEDGER_RECORD — enumeration guard for PII.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Return 403 (not 404) to prevent enumeration of ack IDs
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_RECORD))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const ack = await db.query.ledgerAcknowledgments.findFirst({
      where: eq(ledgerAcknowledgments.id, id),
      columns: { id: true, letterStorageKey: true },
    });

    if (!ack) {
      return NextResponse.json({ error: "Acknowledgment not found" }, { status: 404 });
    }
    if (!ack.letterStorageKey) {
      return NextResponse.json({ error: "No letter file stored for this acknowledgment" }, { status: 404 });
    }

    // Read bytes from storage — never send the key to the browser (DECISION-020)
    const stored = await getReceiptStorage().read(ack.letterStorageKey);
    if (!stored) {
      return NextResponse.json({ error: "Letter file not found in storage" }, { status: 404 });
    }

    return new Response(stored.bytes.buffer as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": stored.contentType,
        "Content-Disposition": "inline",
        "Content-Length": stored.bytes.length.toString(),
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Error streaming acknowledgment letter:", error);
    return NextResponse.json({ error: "Failed to retrieve letter" }, { status: 500 });
  }
}

/**
 * POST /api/admin/ledger/acknowledgments/[id]/letter
 *
 * Upload a letter file for an acknowledgment.
 * If the ack already has a letterStorageKey, the old file is deleted first.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_RECORD))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const ack = await db.query.ledgerAcknowledgments.findFirst({
      where: eq(ledgerAcknowledgments.id, id),
      columns: { id: true, letterStorageKey: true },
    });

    if (!ack) {
      return NextResponse.json({ error: "Acknowledgment not found" }, { status: 404 });
    }

    // Parse multipart form
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
    }

    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "file field is required" }, { status: 400 });
    }

    // Size limit: 10 MB
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: "File exceeds the 10 MB size limit" }, { status: 400 });
    }

    // Read and validate magic bytes
    const arrayBuffer = await file.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    const contentType = validateMagicBytes(bytes);
    if (!contentType) {
      return NextResponse.json(
        { error: "Only PDF, JPEG, and PNG files are accepted for acknowledgment letters" },
        { status: 400 },
      );
    }

    // Generate storage key under the acknowledgments/ namespace (separate from receipts/)
    const uuid = crypto.randomUUID();
    const safeName = sanitizeFilename(file.name || "letter");
    const key = `acknowledgments/${uuid}/${safeName}`;

    // Delete the old file before saving (best-effort: log failure but don't abort)
    if (ack.letterStorageKey) {
      try {
        await getReceiptStorage().delete(ack.letterStorageKey);
      } catch (err) {
        console.error("[ack-letter-upload] Failed to delete old letter key:", ack.letterStorageKey, err);
        // Orphan in Blob storage — acceptable; do not fail the upload
      }
    }

    // Save the new file
    await getReceiptStorage().save(key, bytes, contentType);

    // Update the ack record with the new key
    await db
      .update(ledgerAcknowledgments)
      .set({ letterStorageKey: key, updatedAt: new Date() })
      .where(eq(ledgerAcknowledgments.id, id));

    return NextResponse.json({ key });
  } catch (error) {
    console.error("Error uploading acknowledgment letter:", error);
    return NextResponse.json({ error: "Failed to upload letter" }, { status: 500 });
  }
}
