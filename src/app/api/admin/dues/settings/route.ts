import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { duesSettings } from "@/lib/db/schema";
import { eq, ne } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

/**
 * PATCH /api/admin/dues/settings
 *
 * Upsert the dues_settings row for a fiscal year (individual + family amounts).
 * Gate: dues.manage
 *
 * Body: { fiscalYear, individualAmountCents, familyAmountCents, notes?, isActive? }
 *
 * When isActive is true the handler runs a transaction that clears is_active on
 * all other rows before setting it on this fiscal year's row.
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canManage = await hasFeature(session.user.id, FEATURES.DUES_MANAGE);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { fiscalYear, individualAmountCents, familyAmountCents, notes, isActive } = body;

    // --- Validate fiscalYear ---
    if (
      fiscalYear === undefined ||
      typeof fiscalYear !== "number" ||
      !Number.isInteger(fiscalYear) ||
      fiscalYear < 2000 ||
      fiscalYear > 2100
    ) {
      return NextResponse.json(
        { error: "fiscalYear must be an integer between 2000 and 2100" },
        { status: 400 },
      );
    }

    // --- Validate individualAmountCents ---
    if (
      individualAmountCents === undefined ||
      typeof individualAmountCents !== "number" ||
      !Number.isInteger(individualAmountCents) ||
      individualAmountCents <= 0
    ) {
      return NextResponse.json(
        { error: "individualAmountCents must be a positive integer" },
        { status: 400 },
      );
    }

    // --- Validate familyAmountCents ---
    if (
      familyAmountCents === undefined ||
      typeof familyAmountCents !== "number" ||
      !Number.isInteger(familyAmountCents) ||
      familyAmountCents <= 0
    ) {
      return NextResponse.json(
        { error: "familyAmountCents must be a positive integer" },
        { status: 400 },
      );
    }

    // --- Validate notes ---
    if (notes !== undefined && notes !== null) {
      if (typeof notes !== "string") {
        return NextResponse.json({ error: "notes must be a string" }, { status: 400 });
      }
      if (notes.length > 1000) {
        return NextResponse.json(
          { error: "notes must be 1000 characters or fewer" },
          { status: 400 },
        );
      }
    }

    // --- Validate isActive (optional boolean) ---
    if (isActive !== undefined && typeof isActive !== "boolean") {
      return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 });
    }

    // --- Upsert (with optional active-year promotion) ---
    let row;

    if (isActive === true) {
      // Run inside a transaction: clear active on all other rows, then upsert this one as active.
      row = await db.transaction(async (tx) => {
        // Clear active from all other fiscal years
        await tx
          .update(duesSettings)
          .set({ isActive: false, updatedAt: new Date() })
          .where(ne(duesSettings.fiscalYear, fiscalYear));

        // Upsert this fiscal year's row
        const existing = await tx.query.duesSettings.findFirst({
          where: eq(duesSettings.fiscalYear, fiscalYear),
        });

        if (existing) {
          const [updated] = await tx
            .update(duesSettings)
            .set({
              individualAmountCents,
              familyAmountCents,
              notes: notes ?? null,
              isActive: true,
              updatedAt: new Date(),
            })
            .where(eq(duesSettings.fiscalYear, fiscalYear))
            .returning();
          return updated;
        } else {
          const [inserted] = await tx
            .insert(duesSettings)
            .values({
              fiscalYear,
              individualAmountCents,
              familyAmountCents,
              notes: notes ?? null,
              isActive: true,
            })
            .returning();
          return inserted;
        }
      });
    } else {
      // Standard upsert — do not touch is_active
      const existing = await db.query.duesSettings.findFirst({
        where: eq(duesSettings.fiscalYear, fiscalYear),
      });

      if (existing) {
        const [updated] = await db
          .update(duesSettings)
          .set({
            individualAmountCents,
            familyAmountCents,
            notes: notes ?? null,
            updatedAt: new Date(),
          })
          .where(eq(duesSettings.fiscalYear, fiscalYear))
          .returning();
        row = updated;
      } else {
        const [inserted] = await db
          .insert(duesSettings)
          .values({
            fiscalYear,
            individualAmountCents,
            familyAmountCents,
            notes: notes ?? null,
          })
          .returning();
        row = inserted;
      }
    }

    return NextResponse.json(row);
  } catch (error) {
    console.error("Error upserting dues settings:", error);
    return NextResponse.json(
      { error: "Failed to save dues settings" },
      { status: 500 },
    );
  }
}
