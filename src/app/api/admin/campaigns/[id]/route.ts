import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

/**
 * PATCH /api/admin/campaigns/[id]
 * Update a campaign
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check permission
    const canManage = await hasFeature(session.user.id, FEATURES.CAMPAIGNS_MANAGE);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const data = await request.json();

    // Check if campaign exists
    const existing = await db.query.campaigns.findFirst({
      where: eq(campaigns.id, params.id),
    });

    if (!existing) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    // Update campaign
    const [updated] = await db
      .update(campaigns)
      .set({
        title: data.title,
        description: data.description || null,
        zeffyLink: data.zeffyLink,
        image: data.image || null,
        displayOrder: data.displayOrder || 0,
        isActive: data.isActive ?? true,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, params.id))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating campaign:", error);
    return NextResponse.json(
      { error: "Failed to update campaign" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/campaigns/[id]
 * Delete a campaign
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check permission
    const canManage = await hasFeature(session.user.id, FEATURES.CAMPAIGNS_MANAGE);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check if campaign exists
    const existing = await db.query.campaigns.findFirst({
      where: eq(campaigns.id, params.id),
    });

    if (!existing) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    // Delete campaign
    await db.delete(campaigns).where(eq(campaigns.id, params.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting campaign:", error);
    return NextResponse.json(
      { error: "Failed to delete campaign" },
      { status: 500 }
    );
  }
}
