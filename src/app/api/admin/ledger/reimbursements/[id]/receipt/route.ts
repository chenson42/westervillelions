/**
 * GET /api/admin/ledger/reimbursements/[id]/receipt
 *
 * Server-side receipt proxy for admins. Reads the stored bytes and streams
 * them with the correct Content-Type. The underlying storage key / blob URL
 * is NEVER sent to the browser (DECISION-020).
 *
 * Gate: LEDGER_VIEW
 *
 * Responses:
 *   200  — bytes streamed with Content-Type and Content-Disposition: inline
 *   401  — not authenticated
 *   403  — forbidden
 *   404  — reimbursement not found, or receipt file not found in storage
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getReimbursement } from "@/lib/ledger-queries";
import { getReceiptStorage } from "@/lib/receipt-storage";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_VIEW))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const reimb = await getReimbursement(id);
    if (!reimb) {
      return NextResponse.json({ error: "Reimbursement not found" }, { status: 404 });
    }

    // Read bytes from storage — never send the key to the browser
    const stored = await getReceiptStorage().read(reimb.receiptStorageKey);
    if (!stored) {
      return NextResponse.json({ error: "Receipt file not found" }, { status: 404 });
    }

    return new Response(stored.bytes.buffer as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": stored.contentType,
        "Content-Disposition": "inline",
        "Content-Length": stored.bytes.length.toString(),
        // Prevent caching of financial documents in the browser
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Error streaming admin receipt:", error);
    return NextResponse.json({ error: "Failed to retrieve receipt" }, { status: 500 });
  }
}
