/**
 * GET /api/admin/ledger/acknowledgments/letters/generatable
 *
 * Acknowledgment / Thank-You Letter Generation (DECISION-072/073,
 * 2026-08-08). Gate: LEDGER_RECORD.
 *
 * Returns the candidate rows for the batch-select screen — recorded
 * acknowledgments not yet sent, minus any whose transaction's category is
 * flagged ackNotRequired. This is a thin read wrapper so the selector page
 * can be a Server Component for the initial load (no client fetch needed on
 * mount); this route exists for the "select all -> generate" client refresh
 * after a batch completes, not as the only way to load the list.
 *
 * No query params.
 *
 * Response 200: { rows: GeneratableAcknowledgmentRow[] }
 * Response 401: not authenticated.
 * Response 403: lacks LEDGER_RECORD.
 * Response 500: server error.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { listGeneratableAcknowledgments } from "@/lib/ledger-acknowledgment-letter-queries";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_RECORD))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rows = await listGeneratableAcknowledgments();

    return NextResponse.json({ rows });
  } catch (error) {
    console.error("Error listing generatable acknowledgments:", error);
    return NextResponse.json(
      { error: "Failed to list generatable acknowledgments" },
      { status: 500 },
    );
  }
}
