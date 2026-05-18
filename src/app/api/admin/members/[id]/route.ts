import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members, users } from "@/lib/db/schema";
import { eq, sql, and, ne } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { syncClubMembersList } from "@/lib/google-groups";
import { provisionUserForMember } from "@/lib/members";

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

    // Email is required (cannot remove it once set)
    if (!data.email || !data.email.trim()) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const existing = await db.query.members.findFirst({
      where: eq(members.id, id),
    });

    if (!existing) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // Reject case-insensitive duplicate email belonging to a different member
    const emailConflict = await db.query.members.findFirst({
      where: and(
        sql`lower(${members.email}) = ${data.email.trim().toLowerCase()}`,
        ne(members.id, id)
      ),
    });
    if (emailConflict) {
      return NextResponse.json(
        { error: "A member with this email already exists" },
        { status: 409 }
      );
    }

    const newIsActive = typeof data.isActive === "boolean" ? data.isActive : true;

    const [updated] = await db
      .update(members)
      .set({
        memberNumber: data.memberNumber || null,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email.trim(),
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
    const emailChanged = data.email.trim().toLowerCase() !== (existing.email ?? "").toLowerCase();
    const activeChanged = existing.isActive !== newIsActive;

    if (nameChanged || emailChanged || activeChanged) {
      const userUpdate: Record<string, unknown> = { updatedAt: new Date() };
      if (nameChanged) userUpdate.name = `${data.firstName} ${data.lastName}`.trim();
      if (emailChanged && data.email) userUpdate.email = data.email.trim();
      if (activeChanged) userUpdate.isActive = newIsActive;
      await db.update(users).set(userUpdate).where(eq(users.memberId, existing.id));
    }

    // Defensive: if email changed and member has no linked user, provision one now
    if (emailChanged && data.email) {
      const linkedUser = await db.query.users.findFirst({
        where: eq(users.memberId, existing.id),
      });
      if (!linkedUser) {
        try {
          await provisionUserForMember({
            email: data.email.trim(),
            firstName: data.firstName,
            lastName: data.lastName,
            memberId: existing.id,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.startsWith("EMAIL_CONFLICT")) {
            return NextResponse.json(
              { error: "A user account already linked to a different member exists for this email" },
              { status: 409 }
            );
          }
          throw err;
        }
      }
    }

    // Fire-and-forget club list sync
    syncClubMembersList({ triggeredByUserId: session.user.id, triggerSource: "member_updated" })
      .catch((e) => console.error("[sync] club list:", e));

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
    syncClubMembersList({ triggeredByUserId: session.user.id, triggerSource: "member_removed" })
      .catch((e) => console.error("[sync] club list:", e));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting member:", error);
    return NextResponse.json(
      { error: "Failed to delete member" },
      { status: 500 }
    );
  }
}
