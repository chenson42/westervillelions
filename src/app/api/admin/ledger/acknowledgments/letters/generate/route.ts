/**
 * POST /api/admin/ledger/acknowledgments/letters/generate
 *
 * Acknowledgment / Thank-You Letter Generation (DECISION-072/073,
 * 2026-08-08). Gate: LEDGER_RECORD — same surface as
 * AcknowledgeDialog/MarkSentDialog today.
 *
 * Single-letter generation is this same endpoint called with a one-item
 * array — no second code path (DECISION-072 §4).
 *
 * Body:
 * {
 *   ackIds: string[];   // 1..N acknowledgment ids (NOT transaction ids)
 * }
 *
 * Response 200:
 * {
 *   results: Array<{
 *     ackId: string;
 *     status: "generated" | "skipped";
 *     reason?: string;         // present only when status === "skipped"
 *     letterText?: string;     // present only when status === "generated" —
 *                               // the composed letter, so the client can
 *                               // render the preview/print set from this
 *                               // response alone, no follow-up GET
 *   }>;
 * }
 *
 * `reason` strings (stable, user-facing): "not found", "no donor linked",
 * "donor missing address", "category excluded from acknowledgments",
 * "already sent", "unrecognized acknowledgment type".
 *
 * Skip-vs-write is decided by a deterministic pre-check for every row
 * BEFORE db.transaction() opens (see generateAcknowledgmentLetters()); only
 * rows that pass are written, all inside one transaction. Regeneration is
 * free for any not-yet-sent row (overwrites letterText) — clicking
 * "Generate" IS the review step (DECISION-073 item 2) — and hard-refused
 * once sentAt is set.
 *
 * Response 400: ackIds missing/not an array/empty/non-string entries.
 * Response 401: not authenticated.
 * Response 403: lacks LEDGER_RECORD.
 * Response 500: server error (a genuine DB failure inside the transaction
 * rolls back the whole batch's writes; ordinary business-rule skips above
 * never reach the transaction, so they can't cause this).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { generateAcknowledgmentLetters } from "@/lib/ledger-acknowledgment-letter-queries";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_RECORD))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { ackIds } = body;

    if (
      !Array.isArray(ackIds) ||
      ackIds.length === 0 ||
      ackIds.some((id: unknown) => typeof id !== "string")
    ) {
      return NextResponse.json(
        { error: "ackIds must be a non-empty array of strings" },
        { status: 400 },
      );
    }

    const results = await generateAcknowledgmentLetters(ackIds as string[]);

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Error generating acknowledgment letters:", error);
    return NextResponse.json(
      { error: "Failed to generate acknowledgment letters" },
      { status: 500 },
    );
  }
}
