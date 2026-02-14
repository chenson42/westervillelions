import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

/**
 * PATCH /api/admin/members/[id]
 * Update a member
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
    const canEdit = await hasFeature(session.user.id, FEATURES.MEMBERS_EDIT);
    if (!canEdit) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const data = await request.json();

    // Check if member exists
    const existing = await db.query.members.findFirst({
      where: eq(members.id, params.id),
    });

    if (!existing) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // Update member
    const [updated] = await db
      .update(members)
      .set({
        memberNumber: data.memberNumber || null,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email || null,
        phone: data.phone || null,
        address: data.address || null,
        city: data.city || null,
        state: data.state || null,
        zip: data.zip || null,
        branch: data.branch || null,
        boardPosition: data.boardPosition || null,
        joinDate: data.joinDate ? new Date(data.joinDate) : null,
        isActive: data.isActive ?? true,
        updatedAt: new Date(),
      })
      .where(eq(members.id, params.id))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating member:", error);
    return NextResponse.json(
      { error: "Failed to update member" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/members/[id]
 * Delete a member
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
    const canDelete = await hasFeature(session.user.id, FEATURES.MEMBERS_DELETE);
    if (!canDelete) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check if member exists
    const existing = await db.query.members.findFirst({
      where: eq(members.id, params.id),
    });

    if (!existing) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // Delete member
    await db.delete(members).where(eq(members.id, params.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting member:", error);
    return NextResponse.json(
      { error: "Failed to delete member" },
      { status: 500 }
    );
  }
}
