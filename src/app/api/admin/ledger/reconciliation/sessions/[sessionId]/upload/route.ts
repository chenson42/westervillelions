/**
 * POST /api/admin/ledger/reconciliation/sessions/[sessionId]/upload
 *
 * Accepts a multipart/form-data request with a single `file` field — a Chase
 * activity-export CSV. Parsed in memory and discarded; only the derived bank
 * lines are persisted (architect's parse-and-discard ruling — no Vercel Blob
 * call, no raw-file retention). One CSV upload per session (idempotency's
 * primary defense is this session-level one-shot gate, not row-level dedupe).
 *
 * Gate: LEDGER_RECORD
 *
 * Request: multipart/form-data, field `file`
 * Response 201: { sessionId, rowCount, outOfPeriodCount, gapWarning: null }
 *
 * Errors:
 *   400 — invalid multipart body, empty/non-UTF-8 file, bad header, or a
 *         row-level parse failure (names the row number + bad value)
 *   404 — session not found
 *   409 — session is not open, or already has an uploaded statement
 *   413 — file exceeds the 2 MB cap
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getReconciliationSessionById,
  markSessionUploaded,
  insertBankLines,
  type NewBankLineRow,
} from "@/lib/reconciliation-queries";
import {
  splitCsvLine,
  validateChaseCsvHeader,
  parseChaseCsvRow,
  bankLineDedupeKey,
} from "@/lib/reconciliation";

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const authSession = await auth();
    if (!authSession?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(authSession.user.id, FEATURES.LEDGER_RECORD))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { sessionId } = await params;

    // 1. Session exists and is open
    const reconSession = await getReconciliationSessionById(sessionId);
    if (!reconSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (reconSession.status !== "open") {
      return NextResponse.json(
        { error: "This session is closed — reopen it before uploading a new statement" },
        { status: 409 },
      );
    }

    // 2. One CSV upload per session
    if (reconSession.uploadedAt !== null) {
      return NextResponse.json(
        { error: "This session already has an uploaded statement" },
        { status: 409 },
      );
    }

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

    // 3. Size cap
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: "File is too large (max 2MB)" }, { status: 413 });
    }

    // 4. UTF-8 decode + non-empty
    const arrayBuffer = await file.arrayBuffer();
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(arrayBuffer);
    } catch {
      return NextResponse.json(
        { error: "File is empty or not a valid text file" },
        { status: 400 },
      );
    }
    if (text.trim() === "") {
      return NextResponse.json(
        { error: "File is empty or not a valid text file" },
        { status: 400 },
      );
    }

    const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim() !== "");
    if (lines.length === 0) {
      return NextResponse.json(
        { error: "File is empty or not a valid text file" },
        { status: 400 },
      );
    }

    // 5. Header validation (order-independent, case/whitespace-tolerant)
    const headerCells = splitCsvLine(lines[0]);
    const headerResult = validateChaseCsvHeader(headerCells);
    if (!headerResult.valid) {
      return NextResponse.json({ error: headerResult.error }, { status: 400 });
    }
    const columnIndex = headerResult.columnIndex;

    // 6. Row-level parse — first bad row aborts with a named error
    const dataLines = lines.slice(1);
    const parsedRows: NewBankLineRow[] = [];
    let outOfPeriodCount = 0;

    for (let i = 0; i < dataLines.length; i++) {
      const rowNumber = i + 1;
      const cells = splitCsvLine(dataLines[i]);
      const result = parseChaseCsvRow(cells, columnIndex, rowNumber);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      const { row } = result;
      // 7. inStatementPeriod + dedupeKey
      const inStatementPeriod =
        row.postingDate >= reconSession.statementPeriodStart &&
        row.postingDate <= reconSession.statementPeriodEnd;
      if (!inStatementPeriod) outOfPeriodCount++;

      const dedupeKey = bankLineDedupeKey(row);

      parsedRows.push({
        sessionId,
        bankAccountId: reconSession.bankAccountId,
        postingDate: row.postingDate,
        description: row.description,
        amountCents: row.amountCents,
        rawType: row.rawType,
        checkOrSlipNumber: row.checkOrSlipNumber,
        balanceCents: row.balanceCents,
        inStatementPeriod,
        dedupeKey,
      });
    }

    // 8. Bulk insert (ON CONFLICT (session_id, dedupe_key) DO NOTHING — defense
    // in depth against a self-duplicated row inside one file)
    await insertBankLines(parsedRows);

    // 9. Mark session uploaded. csvFilename is display-only (never used as a
    // storage path — the raw file itself is never persisted).
    const csvFilename = (file.name || "statement.csv").slice(0, 255);
    await markSessionUploaded(sessionId, {
      uploadedAt: new Date(),
      csvFilename,
      csvRowCount: parsedRows.length,
    });

    // 10. The raw file is discarded here — nothing further references `text`
    // or `arrayBuffer` after this point.

    return NextResponse.json(
      { sessionId, rowCount: parsedRows.length, outOfPeriodCount, gapWarning: null },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error uploading reconciliation CSV:", error);
    return NextResponse.json({ error: "Failed to upload statement" }, { status: 500 });
  }
}
