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
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

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

    update.updatedAt = new Date();

    // Update the singleton row (no WHERE clause — exactly one row, established by migration)
    const updated = await db
      .update(ledgerSettings)
      .set(update)
      .returning();

    return NextResponse.json({ settings: updated[0] });
  } catch (error) {
    console.error("Error updating ledger settings:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
