import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { glassesDropoffLocations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canManage = await hasFeature(session.user.id, FEATURES.ANNOUNCEMENTS_MANAGE);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const data = await request.json();

    const existing = await db.query.glassesDropoffLocations.findFirst({
      where: eq(glassesDropoffLocations.id, id),
    });

    if (!existing) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const updateFields: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.name !== undefined) updateFields.name = data.name.trim();
    if (data.address !== undefined) updateFields.address = data.address.trim();
    if (typeof data.isActive === "boolean") updateFields.isActive = data.isActive;
    if (data.sortOrder !== undefined) updateFields.sortOrder = Number(data.sortOrder);

    const [updated] = await db
      .update(glassesDropoffLocations)
      .set(updateFields)
      .where(eq(glassesDropoffLocations.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating glasses drop-off location:", error);
    return NextResponse.json({ error: "Failed to update location" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canManage = await hasFeature(session.user.id, FEATURES.ANNOUNCEMENTS_MANAGE);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await db.query.glassesDropoffLocations.findFirst({
      where: eq(glassesDropoffLocations.id, id),
    });

    if (!existing) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    await db.delete(glassesDropoffLocations).where(eq(glassesDropoffLocations.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting glasses drop-off location:", error);
    return NextResponse.json({ error: "Failed to delete location" }, { status: 500 });
  }
}
