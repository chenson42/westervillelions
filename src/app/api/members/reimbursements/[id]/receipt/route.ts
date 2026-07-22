/**
 * GET /api/members/reimbursements/[id]/receipt
 *
 * Server-side receipt proxy for the submitting member.
 * Returns 404 (not 403) for IDs belonging to other members — prevents existence leaking.
 *
 * The underlying storage key / blob URL is NEVER sent to the browser (DECISION-020).
 *
 * Gate: ownership (submittedByMemberId = session.user.memberId)
 *
 * Responses:
 *   200  — bytes streamed with Content-Type and Content-Disposition: inline
 *   401  — not authenticated
 *   403  — no member account linked
 *   404  — reimbursement not found / not owned, or receipt file not found in storage
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getReimbursement } from "@/lib/ledger-queries";
import { getReceiptStorage, receiptBytesToBodyInit } from "@/lib/receipt-storage";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.memberId) {
      return NextResponse.json({ error: "Member account required" }, { status: 403 });
    }

    const { id } = await params;
    const reimb = await getReimbursement(id);

    // Return 404 (not 403) for non-existent or other-member rows — prevents existence leaking
    if (!reimb || reimb.submittedByMemberId !== session.user.memberId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Read bytes from storage — never send the key to the browser
    const stored = await getReceiptStorage().read(reimb.receiptStorageKey);
    if (!stored) {
      return NextResponse.json({ error: "Receipt file not found" }, { status: 404 });
    }

    return new Response(receiptBytesToBodyInit(stored.bytes), {
      status: 200,
      headers: {
        "Content-Type": stored.contentType,
        "Content-Disposition": "inline",
        "Content-Length": stored.bytes.byteLength.toString(),
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Error streaming member receipt:", error);
    return NextResponse.json({ error: "Failed to retrieve receipt" }, { status: 500 });
  }
}
