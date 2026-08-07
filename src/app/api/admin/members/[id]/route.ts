import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members, users } from "@/lib/db/schema";
import { eq, sql, and, ne } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { syncClubMembersList } from "@/lib/google-groups";
import {
  provisionUserForMember,
  isActiveForStatus,
  shouldProvisionOnMemberUpdate,
  resolveJoinDate,
  isValidMembershipType,
  MEMBERSHIP_TYPES,
  type MembershipStatus,
  type MembershipType,
} from "@/lib/members";

const VALID_MEMBERSHIP_STATUSES: MembershipStatus[] = ["prospective", "active", "ended"];

// membershipType — a THIRD, orthogonal axis (LCI membership type) alongside
// membershipStatus (club standing) and duesCategory (billing rate). See
// DECISION-064. Unlike membershipStatus below (which falls back to the
// existing value on an invalid submission because it protects the derived
// isActive invariant), membershipType has no derived sibling to protect —
// an invalid or omitted value is a hard 400, never a silent fallback.
const MEMBERSHIP_TYPE_ERROR = `membershipType must be one of: ${MEMBERSHIP_TYPES.map(
  (t) => t.value
).join(", ")}`;

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

    // Validate membershipType before touching the row — hard 400 on an
    // off-taxonomy (or missing) value, no fallback to the existing value.
    // Keep this check ahead of any db.update so an invalid submission never
    // mutates the row (including membershipStatus/isActive derived above).
    const membershipTypeInput = data.membershipType;
    if (!isValidMembershipType(membershipTypeInput)) {
      return NextResponse.json(
        { error: MEMBERSHIP_TYPE_ERROR },
        { status: 400 }
      );
    }
    const membershipType: MembershipType = membershipTypeInput;

    const existingStatus = existing.membershipStatus as MembershipStatus;

    // membershipStatus is client-submitted; isActive is always server-derived
    // from it (never from client input) — see isActiveForStatus(). Fall back to
    // the existing status if the client omits it or sends an invalid value,
    // rather than silently defaulting to "active".
    const newStatus: MembershipStatus = VALID_MEMBERSHIP_STATUSES.includes(
      data.membershipStatus
    )
      ? data.membershipStatus
      : existingStatus;
    const newIsActive = isActiveForStatus(newStatus);
    const becameActive = existingStatus !== "active" && newStatus === "active";

    const resolvedJoinDate = resolveJoinDate({
      becameActive,
      existingJoinDate: existing.joinDate,
      submittedJoinDate: data.joinDate ? new Date(data.joinDate) : null,
    });

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
        joinDate: resolvedJoinDate,
        membershipEndedDate: data.membershipEndedDate || null,
        isActive: newIsActive,
        membershipStatus: newStatus,
        membershipType,
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

    // Unified provisioning gate — replaces the old "email changed, no linked
    // user" defensive block. Covers both the legacy case (restricted to
    // landing-as-active) and the new induction case (prospective/ended → active
    // with no email change).
    const linkedUser = await db.query.users.findFirst({
      where: eq(users.memberId, existing.id),
    });
    if (
      shouldProvisionOnMemberUpdate({
        previousStatus: existingStatus,
        newStatus,
        hasLinkedUser: Boolean(linkedUser),
        emailChanged,
      })
    ) {
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
