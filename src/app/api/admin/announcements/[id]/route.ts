import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { homepageAnnouncements } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

/**
 * PATCH /api/admin/announcements/[id]
 * Partially update a homepage announcement
 */
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

    const existing = await db.query.homepageAnnouncements.findFirst({
      where: eq(homepageAnnouncements.id, id),
    });

    if (!existing) {
      return NextResponse.json({ error: "Announcement not found" }, { status: 404 });
    }

    const updateFields: Record<string, unknown> = { updatedAt: new Date() };

    if (data.title !== undefined) updateFields.title = data.title;
    if (data.body !== undefined) updateFields.body = data.body || null;
    if (data.linkUrl !== undefined) updateFields.linkUrl = data.linkUrl || null;
    if (data.linkLabel !== undefined) updateFields.linkLabel = data.linkLabel || null;
    if (typeof data.isActive === "boolean") updateFields.isActive = data.isActive;
    if (data.startsAt !== undefined) {
      updateFields.startsAt = data.startsAt ? new Date(data.startsAt) : null;
    }
    if (data.endsAt !== undefined) {
      updateFields.endsAt = data.endsAt ? new Date(data.endsAt) : null;
    }
    if (data.sortOrder !== undefined) updateFields.sortOrder = data.sortOrder;

    const [updated] = await db
      .update(homepageAnnouncements)
      .set(updateFields)
      .where(eq(homepageAnnouncements.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating announcement:", error);
    return NextResponse.json(
      { error: "Failed to update announcement" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/announcements/[id]
 * Delete a homepage announcement
 */
export async function DELETE(
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

    const existing = await db.query.homepageAnnouncements.findFirst({
      where: eq(homepageAnnouncements.id, id),
    });

    if (!existing) {
      return NextResponse.json({ error: "Announcement not found" }, { status: 404 });
    }

    await db.delete(homepageAnnouncements).where(eq(homepageAnnouncements.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting announcement:", error);
    return NextResponse.json(
      { error: "Failed to delete announcement" },
      { status: 500 }
    );
  }
}
