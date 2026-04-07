import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { testimonials } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

/**
 * PATCH /api/admin/testimonials/[id]
 * Update an existing testimonial
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

    const existing = await db.query.testimonials.findFirst({
      where: eq(testimonials.id, id),
    });

    if (!existing) {
      return NextResponse.json({ error: "Testimonial not found" }, { status: 404 });
    }

    const updateFields: Record<string, unknown> = {};

    if (data.quote !== undefined) updateFields.quote = data.quote;
    if (data.authorName !== undefined) updateFields.authorName = data.authorName;
    if (data.authorTitle !== undefined) updateFields.authorTitle = data.authorTitle || null;
    if (typeof data.isActive === "boolean") updateFields.isActive = data.isActive;
    if (data.sortOrder !== undefined) updateFields.sortOrder = data.sortOrder;

    const [updated] = await db
      .update(testimonials)
      .set(updateFields)
      .where(eq(testimonials.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating testimonial:", error);
    return NextResponse.json(
      { error: "Failed to update testimonial" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/testimonials/[id]
 * Delete a testimonial
 */
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

    const existing = await db.query.testimonials.findFirst({
      where: eq(testimonials.id, id),
    });

    if (!existing) {
      return NextResponse.json({ error: "Testimonial not found" }, { status: 404 });
    }

    await db.delete(testimonials).where(eq(testimonials.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting testimonial:", error);
    return NextResponse.json(
      { error: "Failed to delete testimonial" },
      { status: 500 }
    );
  }
}
