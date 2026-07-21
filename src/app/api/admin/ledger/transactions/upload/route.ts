/**
 * POST /api/admin/ledger/transactions/upload
 *
 * Accepts a multipart/form-data request with a single `file` field. Mints an
 * opaque receipt storage key BEFORE any transaction row exists — mirrors
 * POST /api/members/reimbursements/upload's ordering, which solves the same
 * problem: a transaction can be created with a receipt attached (Flow A) but
 * has no `id` yet at upload time. The client submits the returned key as
 * `receiptStorageKey` on the subsequent POST/PATCH
 * /api/admin/ledger/transactions[/[id]] call.
 *
 * Flat route (no [id]) — used by both the create dialog (Flow A) and the edit
 * dialog (Flow B/C); the transaction id is irrelevant to the upload step.
 *
 * Validates the file by magic bytes (DECISION-019) and size (≤ 10 MB) —
 * authoritative server-side regardless of any client-side image downscaling,
 * which is a UX nicety, never a trust boundary. Stores the bytes via the
 * pluggable receipt storage interface (DECISION-020).
 *
 * Gate: LEDGER_RECORD
 *
 * Request: multipart/form-data, field `file`
 * Response 200: { key: string }
 *
 * Errors:
 *   400 — no file, file too large, unsupported file type
 *   401 — not authenticated
 *   403 — forbidden (missing feature)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getReceiptStorage } from "@/lib/receipt-storage";
import { validateMagicBytes } from "@/lib/receipt-magic-bytes";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Sanitize a filename: keep only safe characters, truncate to 100 chars. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "_") // no leading dots
    .slice(0, 100);
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_RECORD))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

    // Size check before reading bytes — authoritative regardless of client resize
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "File exceeds the 10 MB size limit" },
        { status: 400 },
      );
    }

    // Read bytes
    const arrayBuffer = await file.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);

    // Magic-byte validation (DECISION-019) — Content-Type header is spoofable
    const contentType = validateMagicBytes(bytes);
    if (!contentType) {
      return NextResponse.json(
        { error: "Only PDF, JPEG, and PNG files are accepted for receipts" },
        { status: 400 },
      );
    }

    // Generate opaque storage key: receipts/<uuid>/<sanitized-name>
    const uuid = crypto.randomUUID();
    const safeName = sanitizeFilename(file.name || "receipt");
    const key = `receipts/${uuid}/${safeName}`;

    // Persist via the pluggable storage interface (DECISION-020)
    // In local dev: writes to .receipt-store/<key>
    // In production: writes to Vercel Blob
    await getReceiptStorage().save(key, bytes, contentType);

    // Return the opaque key only — NOT a blob URL or filesystem path
    return NextResponse.json({ key });
  } catch (error) {
    console.error("Error uploading ledger transaction receipt:", error);
    return NextResponse.json({ error: "Failed to upload receipt" }, { status: 500 });
  }
}
