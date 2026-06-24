/**
 * PATCH /api/admin/ledger/funds/[id]
 *
 * Edit a fund's name and/or opening balance. Allows administrators to correct
 * placeholder seed values without a migration.
 *
 * Gate: LEDGER_MANAGE
 *
 * Body (all optional, at least one required):
 * {
 *   name?: string;
 *   openingBalanceCents?: number;   // non-negative integer
 * }
 *
 * Response 200: { id: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerFunds } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

const INT4_MAX = 2_147_483_647;

export async function PATCH(
  request: NextRequest,
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

    // Verify fund exists
    const existing = await db.query.ledgerFunds.findFirst({
      where: eq(ledgerFunds.id, id),
      columns: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Fund not found" }, { status: 404 });
    }

    const body = await request.json();
    const { name, openingBalanceCents } = body;

    // At least one editable field required
    if (name === undefined && openingBalanceCents === undefined) {
      return NextResponse.json(
        { error: "At least one of name or openingBalanceCents must be provided" },
        { status: 400 },
      );
    }

    type UpdatePayload = Partial<{
      name: string;
      openingBalanceCents: number;
      updatedAt: Date;
    }>;

    const update: UpdatePayload = { updatedAt: new Date() };

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
      }
      if (name.length > 200) {
        return NextResponse.json(
          { error: "name must be 200 characters or fewer" },
          { status: 400 },
        );
      }
      update.name = name.trim();
    }

    if (openingBalanceCents !== undefined) {
      if (
        typeof openingBalanceCents !== "number" ||
        !Number.isInteger(openingBalanceCents) ||
        openingBalanceCents < 0
      ) {
        return NextResponse.json(
          { error: "openingBalanceCents must be a non-negative integer" },
          { status: 400 },
        );
      }
      if (openingBalanceCents > INT4_MAX) {
        return NextResponse.json(
          { error: `openingBalanceCents must not exceed ${INT4_MAX}` },
          { status: 400 },
        );
      }
      update.openingBalanceCents = openingBalanceCents;
    }

    await db.update(ledgerFunds).set(update).where(eq(ledgerFunds.id, id));

    return NextResponse.json({ id });
  } catch (error) {
    console.error("Error updating ledger fund:", error);
    return NextResponse.json({ error: "Failed to update fund" }, { status: 500 });
  }
}
