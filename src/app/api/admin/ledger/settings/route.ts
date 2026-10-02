/**
 * PATCH /api/admin/ledger/settings
 * Gate: LEDGER_MANAGE
 *
 * Edits the singleton `ledger_settings` row (one row in the table).
 * All fields are optional (PATCH semantics) — send only the fields to update.
 * At least one field is required.
 *
 * Body:
 * {
 *   disbApprovalThresholdCents?: number;   // integer ≥ 0
 *   reserveWarnThresholdCents?: number;    // integer ≥ 0
 *   treasurerBonded?: boolean;
 *   philanthropyVisibility?: 'board' | 'members';
 *   holdingPeriodWarnDays?: number;        // positive integer (days); default 365 — inc7
 * }
 *
 * Audited (DECISION-115): when at least one value actually changes, ONE
 * `ledger_settings_updated` ledger_audit_log row (changed keys, old and new) is
 * written in the same transaction, so a change with no audit row cannot commit.
 * The disbursement approval threshold gates the recorder's own large spend,
 * which is why this is recorded. A PATCH that changes nothing writes nothing.
 * The row has no reader yet.
 *
 * Response 200: { settings: LedgerSettings }
 * Response 400: validation error or no fields provided
 * Response 401: not authenticated
 * Response 403: lacks LEDGER_MANAGE
 * Response 500: server error
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerSettings } from "@/lib/db/schema";
import { recordLedgerAuditNote } from "@/lib/ledger-audit";
import { diffChangedFields } from "@/lib/ledger-audit-notes";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

const SETTINGS_KEYS = [
  "disbApprovalThresholdCents",
  "reserveWarnThresholdCents",
  "treasurerBonded",
  "philanthropyVisibility",
  "holdingPeriodWarnDays",
] as const;

// ---------------------------------------------------------------------------
// PATCH /api/admin/ledger/settings
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();

    // Validate individual fields and build the update payload
    type SettingsUpdate = Partial<{
      disbApprovalThresholdCents: number;
      reserveWarnThresholdCents: number;
      treasurerBonded: boolean;
      philanthropyVisibility: string;
      holdingPeriodWarnDays: number;
      updatedAt: Date;
    }>;

    const update: SettingsUpdate = {};

    if (body.disbApprovalThresholdCents !== undefined) {
      const v = body.disbApprovalThresholdCents;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        return NextResponse.json(
          { error: "disbApprovalThresholdCents must be a non-negative integer" },
          { status: 400 },
        );
      }
      update.disbApprovalThresholdCents = v;
    }

    if (body.reserveWarnThresholdCents !== undefined) {
      const v = body.reserveWarnThresholdCents;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        return NextResponse.json(
          { error: "reserveWarnThresholdCents must be a non-negative integer" },
          { status: 400 },
        );
      }
      update.reserveWarnThresholdCents = v;
    }

    if (body.treasurerBonded !== undefined) {
      if (typeof body.treasurerBonded !== "boolean") {
        return NextResponse.json(
          { error: "treasurerBonded must be a boolean" },
          { status: 400 },
        );
      }
      update.treasurerBonded = body.treasurerBonded;
    }

    if (body.philanthropyVisibility !== undefined) {
      if (
        body.philanthropyVisibility !== "board" &&
        body.philanthropyVisibility !== "members"
      ) {
        return NextResponse.json(
          { error: "philanthropyVisibility must be 'board' or 'members'" },
          { status: 400 },
        );
      }
      update.philanthropyVisibility = body.philanthropyVisibility;
    }

    if (body.holdingPeriodWarnDays !== undefined) {
      const v = body.holdingPeriodWarnDays;
      if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
        return NextResponse.json(
          { error: "holdingPeriodWarnDays must be a positive integer" },
          { status: 400 },
        );
      }
      update.holdingPeriodWarnDays = v;
    }

    // Require at least one field
    const fieldsToUpdate = Object.keys(update);
    if (fieldsToUpdate.length === 0) {
      return NextResponse.json(
        { error: "At least one field must be provided for update" },
        { status: 400 },
      );
    }

    const patch = update; // updatedAt is stamped inside the transaction, only when something changes
    const actorUserId = session.user.id;

    const settings = await db.transaction(async (tx) => {
      // The singleton row (exactly one, established by migration), locked so
      // two concurrent edits cannot interleave their diffs.
      const [current] = await tx.select().from(ledgerSettings).limit(1).for("update");
      if (!current) throw new Error("ledger_settings singleton row is missing");

      const diff = diffChangedFields(current, patch, SETTINGS_KEYS);
      if (!diff) return current; // nothing changed: no write, no audit row

      const [row] = await tx
        .update(ledgerSettings)
        .set({ ...diff.set, updatedAt: new Date() })
        .where(eq(ledgerSettings.id, current.id))
        .returning();

      await recordLedgerAuditNote(tx, {
        actorUserId,
        action: "ledger_settings_updated",
        before: diff.before,
        after: diff.after,
        details: `Ledger settings changed: ${Object.keys(diff.after).join(", ")}`,
      });
      return row;
    });

    return NextResponse.json({ settings });
  } catch (error) {
    console.error("Error updating ledger settings:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
