/**
 * GET    /api/admin/ledger/donors/[id]  — Donor detail with giving history
 * PATCH  /api/admin/ledger/donors/[id]  — Update donor fields
 * DELETE /api/admin/ledger/donors/[id]  — Delete donor (LEDGER_MANAGE)
 *
 * GET + PATCH gate: LEDGER_RECORD
 * DELETE gate: LEDGER_MANAGE
 *
 * GET returns 403 (NOT 404) when the caller lacks LEDGER_RECORD — enumeration guard
 * for PII-sensitive donor records (Phase 1 Pass 5 / Phase 3 design).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { db } from "@/lib/db";
import { ledgerDonors, members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getDonor } from "@/lib/ledger-queries";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAILS = 20;

/**
 * Validates and normalizes a donor `emails` payload — same rules as the
 * create route (src/app/api/admin/ledger/donors/route.ts): trim + lowercase
 * each entry, reject malformed addresses, reject case-insensitive
 * duplicates within the submitted list.
 */
function normalizeEmails(input: unknown): { emails: string[] } | { error: string } {
  if (!Array.isArray(input)) {
    return { error: "emails must be an array of strings" };
  }
  if (input.length > MAX_EMAILS) {
    return { error: `emails must contain ${MAX_EMAILS} or fewer addresses` };
  }
  const normalized: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") {
      return { error: "each email must be a string" };
    }
    const trimmed = raw.trim().toLowerCase();
    if (trimmed.length === 0) continue;
    if (!EMAIL_REGEX.test(trimmed)) {
      return { error: `"${raw}" is not a valid email address` };
    }
    if (normalized.includes(trimmed)) {
      return { error: `"${trimmed}" is a duplicate within this donor's email list` };
    }
    normalized.push(trimmed);
  }
  return { emails: normalized };
}

/**
 * GET /api/admin/ledger/donors/[id]
 *
 * Returns donor record + giving history (linked Foundation income transactions
 * with acknowledgment status).
 *
 * Returns 403 (not 404) when lacking LEDGER_RECORD — enumeration guard.
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
    // Return 403 (not 404) to prevent enumeration of donor IDs
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_RECORD))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const donor = await getDonor(id);
    if (!donor) {
      return NextResponse.json({ error: "Donor not found" }, { status: 404 });
    }

    return NextResponse.json(donor);
  } catch (error) {
    console.error("Error fetching donor:", error);
    return NextResponse.json({ error: "Failed to fetch donor" }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/ledger/donors/[id]
 *
 * Partial update — any subset of { name, emails, address, memberId }.
 * `emails` is a full-list replace (same pattern as events' `recurrenceDays`):
 * omitted leaves the stored list untouched, `null` clears it to `[]`, an
 * array replaces it wholesale after validation/normalization.
 */
export async function PATCH(
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

    const existing = await db.query.ledgerDonors.findFirst({
      where: eq(ledgerDonors.id, id),
      columns: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Donor not found" }, { status: 404 });
    }

    const body = await request.json();
    const { name, emails, address, memberId } = body;

    const patch: Partial<{
      name: string;
      emails: string[];
      address: string | null;
      memberId: string | null;
      updatedAt: Date;
    }> = { updatedAt: new Date() };

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
      }
      if (name.trim().length > 200) {
        return NextResponse.json(
          { error: "name must be 200 characters or fewer" },
          { status: 400 },
        );
      }
      patch.name = name.trim();
    }

    if (emails !== undefined) {
      if (emails === null) {
        patch.emails = [];
      } else {
        const result = normalizeEmails(emails);
        if ("error" in result) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }
        patch.emails = result.emails;
      }
    }

    if (address !== undefined) {
      if (address === null) {
        patch.address = null;
      } else {
        if (typeof address !== "string") {
          return NextResponse.json({ error: "address must be a string or null" }, { status: 400 });
        }
        if (address.length > 500) {
          return NextResponse.json(
            { error: "address must be 500 characters or fewer" },
            { status: 400 },
          );
        }
        patch.address = address.trim();
      }
    }

    if (memberId !== undefined) {
      if (memberId === null) {
        patch.memberId = null;
      } else {
        if (typeof memberId !== "string") {
          return NextResponse.json({ error: "memberId must be a string or null" }, { status: 400 });
        }
        const member = await db.query.members.findFirst({
          where: eq(members.id, memberId),
          columns: { id: true },
        });
        if (!member) {
          return NextResponse.json({ error: "Member not found" }, { status: 400 });
        }
        patch.memberId = memberId;
      }
    }

    const [updated] = await db
      .update(ledgerDonors)
      .set(patch)
      .where(eq(ledgerDonors.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating donor:", error);
    return NextResponse.json({ error: "Failed to update donor" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/ledger/donors/[id]
 *
 * Hard-delete. Postgres ON DELETE SET NULL handles FK cleanup on
 * ledger_transactions.donor_id and ledger_acknowledgments.donor_id automatically.
 *
 * Gate: LEDGER_MANAGE (destructive action — higher gate than RECORD).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await db.query.ledgerDonors.findFirst({
      where: eq(ledgerDonors.id, id),
      columns: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Donor not found" }, { status: 404 });
    }

    await db.delete(ledgerDonors).where(eq(ledgerDonors.id, id));

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Error deleting donor:", error);
    return NextResponse.json({ error: "Failed to delete donor" }, { status: 500 });
  }
}
