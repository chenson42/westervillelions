/**
 * POST /api/admin/ledger/acknowledgments/letters/email
 *
 * Emailing the Donor Acknowledgment Letter (DECISION-087/088, 2026-08-12).
 * Gate: LEDGER_RECORD — same surface as Generate/Print/Mark Sent on the
 * same screen. Sibling of .../letters/generate/route.ts, copied line for
 * line: manual array validation (no zod), auth() + hasFeature(...,
 * LEDGER_RECORD), identical error-response conventions, 200 always on a
 * successful call (per-row failure is data in the response body, never an
 * HTTP failure — matches the dues-reminder POST route's own "200 always"
 * rule).
 *
 * Body:
 * {
 *   ackIds: string[];   // 1..N acknowledgment ids — same id space as
 *                        // .../letters/generate
 * }
 *
 * Response 200:
 * {
 *   results: Array<
 *     | { ackId: string; status: "emailed"; addresses: Array<{ to: string; success: boolean; error?: string }> }
 *     | { ackId: string; status: "skipped"; reason: string }
 *     | { ackId: string; status: "failed"; reason: string }   // claimed, but delivery
 *                                                               // failed at every
 *                                                               // address — the claim
 *                                                               // was reverted, safe
 *                                                               // to retry
 *   >;
 * }
 *
 * `reason` strings (stable, user-facing), in guard order: "not found",
 * "already sent" (pre-check OR lost the atomic-claim race — both mean the
 * same thing to the caller), "letter not yet generated", "no donor linked",
 * "donor has no email on file".
 *
 * The atomic claim (THE load-bearing requirement, DECISION-087 item 4 /
 * DECISION-088 item 1): emailAcknowledgmentLetters() claims each surviving
 * candidate with a single conditional UPDATE ... WHERE sent_at IS NULL
 * RETURNING id BEFORE sending anything — see that function's own doc
 * comment for the full claim-then-send-then-revert-on-total-failure shape.
 * This route does not (and must not) reimplement any part of that logic —
 * it only validates the request shape and gates access.
 *
 * Response 400: ackIds missing/not an array/empty/non-string entries.
 * Response 401: not authenticated.
 * Response 403: lacks LEDGER_RECORD.
 * Response 500: genuine server error — a DB failure claiming a row, or an
 * unexpected throw. A per-address Resend failure is never a 500; it is
 * always reported as data in `results` (status: "failed" for the ack).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { emailAcknowledgmentLetters } from "@/lib/ledger-acknowledgment-letter-queries";

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

    const results = await emailAcknowledgmentLetters(ackIds as string[]);

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Error emailing acknowledgment letters:", error);
    return NextResponse.json(
      { error: "Failed to email acknowledgment letters" },
      { status: 500 },
    );
  }
}
