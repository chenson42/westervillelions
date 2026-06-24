import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

const VALID_CATEGORIES = ["individual", "family"] as const;

/**
 * PATCH /api/admin/dues/[memberId]/category
 *
 * Update a member's dues category (individual | family).
 * Gate: dues.manage
 *
 * Body: { duesCategory: "individual" | "family" }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canManage = await hasFeature(session.user.id, FEATURES.DUES_MANAGE);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { memberId } = await params;

    const existing = await db.query.members.findFirst({
      where: eq(members.id, memberId),
      columns: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const body = await request.json();
    const { duesCategory } = body;

    if (
      !duesCategory ||
      !(VALID_CATEGORIES as readonly string[]).includes(duesCategory)
    ) {
      return NextResponse.json(
        { error: "duesCategory must be 'individual' or 'family'" },
        { status: 400 },
      );
    }

    await db
      .update(members)
      .set({ duesCategory, updatedAt: new Date() })
      .where(eq(members.id, memberId));

    return NextResponse.json({ memberId, duesCategory });
  } catch (error) {
    console.error("Error updating dues category:", error);
    return NextResponse.json(
      { error: "Failed to update dues category" },
      { status: 500 },
    );
  }
}
