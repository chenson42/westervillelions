/**
 * GET /api/admin/ledger/transactions/[id]/receipt
 *
 * Server-side receipt proxy for admins. Reads the stored bytes and streams
 * them with the correct Content-Type. The underlying storage key / blob URL
 * is NEVER sent to the browser (DECISION-020). Mirrors
 * GET /api/admin/ledger/reimbursements/[id]/receipt exactly.
 *
 * Gate: LEDGER_VIEW (broader than LEDGER_RECORD — board members who can see
 * the books but not edit them can still open a receipt).
 *
 * Opened directly in a new tab by the UI, so 404s return a human-readable
 * JSON body (the click-through surfaces this as page text, not a raw error).
 *
 * Responses:
 *   200  — bytes streamed with Content-Type and Content-Disposition: inline
 *   401  — not authenticated
 *   403  — forbidden
 *   404  — transaction not found, no receipt attached, or receipt file not found in storage
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerTransactions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getReceiptStorage, receiptBytesToBodyInit } from "@/lib/receipt-storage";

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

    const rows = await db
      .select({ receiptStorageKey: ledgerTransactions.receiptStorageKey })
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.id, id))
      .limit(1);
    const txn = rows[0];
    if (!txn) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }
    if (!txn.receiptStorageKey) {
      return NextResponse.json({ error: "This transaction has no receipt attached" }, { status: 404 });
    }

    // Read bytes from storage — never send the key to the browser
    const stored = await getReceiptStorage().read(txn.receiptStorageKey);
    if (!stored) {
      return NextResponse.json({ error: "Receipt file not found" }, { status: 404 });
    }

    return new Response(receiptBytesToBodyInit(stored.bytes), {
      status: 200,
      headers: {
        "Content-Type": stored.contentType,
        "Content-Disposition": "inline",
        "Content-Length": stored.bytes.byteLength.toString(),
        // Prevent caching of financial documents in the browser
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Error streaming ledger transaction receipt:", error);
    return NextResponse.json({ error: "Failed to retrieve receipt" }, { status: 500 });
  }
}
