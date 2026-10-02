/**
 * PATCH /api/admin/ledger/funds/[id]
 *
 * Edit a fund's name and/or opening balance. Allows administrators to correct
 * placeholder seed values without a migration.
 *
 * Gate: LEDGER_MANAGE
 *
 * Audited (DECISION-115): a change writes ONE `fund_updated` ledger_audit_log
 * row (changed fields, old and new) in the same transaction, so an edit with no
 * audit row cannot commit. A PATCH that changes nothing is a no-op: no write, no
 * updatedAt bump, no audit row, same 200 response. These rows have no reader yet.
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
import { recordLedgerAuditNote } from "@/lib/ledger-audit";
import { diffChangedFields } from "@/lib/ledger-audit-notes";
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

    const actorUserId = session.user.id;
    const patch = { name: update.name, openingBalanceCents: update.openingBalanceCents };

    const outcome = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          id: ledgerFunds.id,
          name: ledgerFunds.name,
          openingBalanceCents: ledgerFunds.openingBalanceCents,
        })
        .from(ledgerFunds)
        .where(eq(ledgerFunds.id, id))
        .for("update");
      if (!current) return "not_found" as const;

      const diff = diffChangedFields(
        { name: current.name, openingBalanceCents: current.openingBalanceCents },
        patch,
        ["name", "openingBalanceCents"],
      );
      if (!diff) return "noop" as const;

      await tx
        .update(ledgerFunds)
        .set({ ...diff.set, updatedAt: update.updatedAt })
        .where(eq(ledgerFunds.id, id));

      const changes = Object.keys(diff.after)
        .map((key) => {
          const k = key as "name" | "openingBalanceCents";
          return `${k} ${JSON.stringify(diff.before[k])} to ${JSON.stringify(diff.after[k])}`;
        })
        .join("; ");
      await recordLedgerAuditNote(tx, {
        actorUserId,
        action: "fund_updated",
        before: { fundId: id, ...diff.before },
        after: { fundId: id, ...diff.after },
        details: `Edited fund "${current.name}" (${id}): ${changes}`,
      });
      return "updated" as const;
    });

    if (outcome === "not_found") {
      return NextResponse.json({ error: "Fund not found" }, { status: 404 });
    }

    return NextResponse.json({ id });
  } catch (error) {
    console.error("Error updating ledger fund:", error);
    return NextResponse.json({ error: "Failed to update fund" }, { status: 500 });
  }
}
