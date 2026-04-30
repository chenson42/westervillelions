import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { syncClubMembersList } from "@/lib/google-groups";

/**
 * PATCH /api/admin/members/[id]
 * Update a member. When isActive changes, the linked user account is synced.
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

    const canEdit = await hasFeature(session.user.id, FEATURES.MEMBERS_EDIT);
    if (!canEdit) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const data = await request.json();

    const existing = await db.query.members.findFirst({
      where: eq(members.id, id),
    });

    if (!existing) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const newIsActive = typeof data.isActive === "boolean" ? data.isActive : true;

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
        dateOfBirth: data.dateOfBirth || null,
        joinDate: data.joinDate ? new Date(data.joinDate) : null,
        membershipEndedDate: data.membershipEndedDate || null,
        isActive: newIsActive,
        updatedAt: new Date(),
      })
      .where(eq(members.id, id))
      .returning();

    // Sync name, email, and isActive to the linked user account
    const nameChanged = data.firstName !== existing.firstName || data.lastName !== existing.lastName;
    const emailChanged = (data.email || null) !== existing.email;
    const activeChanged = existing.isActive !== newIsActive;

    if (nameChanged || emailChanged || activeChanged) {
      const userUpdate: Record<string, unknown> = { updatedAt: new Date() };
      if (nameChanged) userUpdate.name = `${data.firstName} ${data.lastName}`.trim();
      if (emailChanged && data.email) userUpdate.email = data.email;
      if (activeChanged) userUpdate.isActive = newIsActive;
      await db.update(users).set(userUpdate).where(eq(users.memberId, existing.id));
    }

    // Fire-and-forget club list sync
    syncClubMembersList().catch((e) => console.error("[sync] club list:", e));

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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canDelete = await hasFeature(session.user.id, FEATURES.MEMBERS_DELETE);
    if (!canDelete) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await db.query.members.findFirst({
      where: eq(members.id, id),
    });

    if (!existing) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    await db.delete(members).where(eq(members.id, id));

    // Fire-and-forget club list sync
    syncClubMembersList().catch((e) => console.error("[sync] club list:", e));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting member:", error);
    return NextResponse.json(
      { error: "Failed to delete member" },
      { status: 500 }
    );
  }
}
