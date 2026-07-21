/**
 * GET /api/members/reimbursements/[id]
 *
 * Returns the signed-in member's own reimbursement detail.
 * Returns 404 (not 403) for IDs belonging to other members — prevents existence leaking.
 *
 * Gate: ownership (submittedByMemberId = session.user.memberId)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATCH /api/members/reimbursements/[id]
 *
 * Edit a submitted-status reimbursement. Locked once any board action occurs.
 *
 * Gate: ownership + status='submitted'
 *
 * Body (all fields optional):
 * {
 *   amountCents?: number;
 *   description?: string;
 *   receiptStorageKey?: string;
 *   beneficiaryCause?: string | null;
 * }
 *
 * Response 200: { id }
 * Response 403: not owned or not in submitted status
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * DELETE /api/members/reimbursements/[id]
 *
 * Withdraws (hard-deletes) a submitted-status reimbursement.
 * Note: receipt blob is NOT cleaned up (orphan blobs are accepted in inc2; see Phase 3 edge cases).
 *
 * Gate: ownership + status='submitted'
 *
 * Response 200: { deleted: 1 }
 * Response 403: not owned or not in submitted status
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerReimbursements } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getReimbursement } from "@/lib/ledger-queries";
import { RECEIPT_KEY_REGEX } from "@/lib/receipt-storage";

const AMOUNT_MAX = 1_000_000;
const DESC_MAX_LEN = 1000;
const CAUSE_MAX_LEN = 200;

// ---------------------------------------------------------------------------
// Ownership helper
// ---------------------------------------------------------------------------

async function getOwnedReimbursement(id: string, memberId: string) {
  const reimb = await getReimbursement(id);
  // Return null (→ 404) if not found OR belongs to another member
  if (!reimb || reimb.submittedByMemberId !== memberId) return null;
  return reimb;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

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
    const reimb = await getOwnedReimbursement(id, session.user.memberId);
    if (!reimb) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Strip receiptStorageKey
    const { receiptStorageKey: _k, ...safe } = reimb;
    return NextResponse.json({ reimbursement: safe });
  } catch (error) {
    console.error("Error fetching member reimbursement:", error);
    return NextResponse.json({ error: "Failed to fetch reimbursement" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
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
    const reimb = await getOwnedReimbursement(id, session.user.memberId);
    if (!reimb) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (reimb.status !== "submitted") {
      return NextResponse.json(
        { error: "This request can no longer be edited — it has already been reviewed" },
        { status: 403 },
      );
    }

    const body = await request.json();
    type UpdatePayload = Partial<{
      amountCents: number;
      description: string;
      receiptStorageKey: string;
      beneficiaryCause: string | null;
      updatedAt: Date;
    }>;
    const update: UpdatePayload = { updatedAt: new Date() };

    if (body.amountCents !== undefined) {
      const { amountCents } = body;
      if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents <= 0) {
        return NextResponse.json({ error: "amountCents must be a positive integer" }, { status: 400 });
      }
      if (amountCents > AMOUNT_MAX) {
        return NextResponse.json({ error: `amountCents must not exceed ${AMOUNT_MAX}` }, { status: 400 });
      }
      update.amountCents = amountCents;
    }

    if (body.description !== undefined) {
      if (!body.description || typeof body.description !== "string" || !body.description.trim()) {
        return NextResponse.json({ error: "description cannot be empty" }, { status: 400 });
      }
      update.description = body.description.trim().slice(0, DESC_MAX_LEN);
    }

    if (body.receiptStorageKey !== undefined) {
      const rawKey = body.receiptStorageKey;
      if (!rawKey || typeof rawKey !== "string" || !RECEIPT_KEY_REGEX.test(rawKey)) {
        return NextResponse.json({ error: "receiptStorageKey format is invalid" }, { status: 400 });
      }
      // Old key is not deleted — orphan blob accepted in inc2 (Phase 3 edge cases)
      update.receiptStorageKey = rawKey;
    }

    if (body.beneficiaryCause !== undefined) {
      const raw = body.beneficiaryCause;
      update.beneficiaryCause =
        raw === null ? null : typeof raw === "string" ? raw.trim().slice(0, CAUSE_MAX_LEN) || null : null;
    }

    await db
      .update(ledgerReimbursements)
      .set(update)
      .where(eq(ledgerReimbursements.id, id));

    return NextResponse.json({ id });
  } catch (error) {
    console.error("Error updating member reimbursement:", error);
    return NextResponse.json({ error: "Failed to update reimbursement" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE (withdraw)
// ---------------------------------------------------------------------------

export async function DELETE(
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
    const reimb = await getOwnedReimbursement(id, session.user.memberId);
    if (!reimb) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (reimb.status !== "submitted") {
      return NextResponse.json(
        { error: "This request can no longer be withdrawn — it has already been reviewed" },
        { status: 403 },
      );
    }

    // Atomically delete — WHERE status='submitted' guards against concurrent approval
    const deleted = await db
      .delete(ledgerReimbursements)
      .where(
        and(
          eq(ledgerReimbursements.id, id),
          eq(ledgerReimbursements.status, "submitted"),
        ),
      )
      .returning({ id: ledgerReimbursements.id });

    if (deleted.length === 0) {
      return NextResponse.json(
        { error: "This request can no longer be withdrawn" },
        { status: 403 },
      );
    }

    // Note: receipt blob is NOT deleted — orphan cleanup is deferred to inc3.
    return NextResponse.json({ deleted: 1 });
  } catch (error) {
    console.error("Error withdrawing member reimbursement:", error);
    return NextResponse.json({ error: "Failed to withdraw reimbursement" }, { status: 500 });
  }
}
