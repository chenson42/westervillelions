import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { groupMemberships, groups, users, roles, userRoles, permissionAuditLog } from "@/lib/db/schema";
import { hasFeature, clearUserPermissionCache } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { and, eq } from "drizzle-orm";

const BOARD_GROUP_NAME = "Board of Directors";
const BOARD_MEMBER_ROLE = "board_member";

async function syncBoardMemberRole(
  groupId: string,
  memberId: string,
  action: "assign" | "remove",
  actorUserId: string
) {
  // Check if this group is the Board of Directors
  const group = await db.query.groups.findFirst({
    where: eq(groups.id, groupId),
  });
  if (!group || group.name !== BOARD_GROUP_NAME) return;

  // Find the linked user for this member
  const linkedUser = await db.query.users.findFirst({
    where: eq(users.memberId, memberId),
  });
  if (!linkedUser) return;

  // Find the board_member role
  const boardRole = await db.query.roles.findFirst({
    where: eq(roles.name, BOARD_MEMBER_ROLE),
  });
  if (!boardRole) return;

  if (action === "assign") {
    // Insert if not already present
    const existing = await db.query.userRoles.findFirst({
      where: and(
        eq(userRoles.userId, linkedUser.id),
        eq(userRoles.roleId, boardRole.id)
      ),
    });
    if (!existing) {
      await db.insert(userRoles).values({
        userId: linkedUser.id,
        roleId: boardRole.id,
      });
      await db.insert(permissionAuditLog).values({
        userId: actorUserId,
        action: "role_assigned",
        targetUserId: linkedUser.id,
        targetRoleId: boardRole.id,
        details: JSON.stringify({ source: "board_group_membership", groupId }),
      });
      clearUserPermissionCache(linkedUser.id);
    }
  } else {
    // Remove the role
    const deleted = await db
      .delete(userRoles)
      .where(
        and(
          eq(userRoles.userId, linkedUser.id),
          eq(userRoles.roleId, boardRole.id)
        )
      )
      .returning();
    if (deleted.length > 0) {
      await db.insert(permissionAuditLog).values({
        userId: actorUserId,
        action: "role_removed",
        targetUserId: linkedUser.id,
        targetRoleId: boardRole.id,
        details: JSON.stringify({ source: "board_group_membership", groupId }),
      });
      clearUserPermissionCache(linkedUser.id);
    }
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const canManage = await hasFeature(session.user.id, FEATURES.GROUPS_MANAGE);
    if (!canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id: groupId } = await params;
    const { memberId, groupRoleId, position } = await request.json();

    if (!memberId || !groupRoleId) {
      return NextResponse.json({ error: "memberId and groupRoleId are required" }, { status: 400 });
    }

    const [created] = await db
      .insert(groupMemberships)
      .values({ groupId, memberId, groupRoleId, position: position ?? null })
      .returning();

    await syncBoardMemberRole(groupId, memberId, "assign", session.user.id);

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("Error adding member to group:", error);
    return NextResponse.json({ error: "Failed to add member" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const canManage = await hasFeature(session.user.id, FEATURES.GROUPS_MANAGE);
    if (!canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id: groupId } = await params;
    const { membershipId, position } = await request.json();

    if (!membershipId) {
      return NextResponse.json({ error: "membershipId is required" }, { status: 400 });
    }

    await db
      .update(groupMemberships)
      .set({ position: position ?? null })
      .where(
        and(
          eq(groupMemberships.id, membershipId),
          eq(groupMemberships.groupId, groupId)
        )
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating membership:", error);
    return NextResponse.json({ error: "Failed to update membership" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const canManage = await hasFeature(session.user.id, FEATURES.GROUPS_MANAGE);
    if (!canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id: groupId } = await params;
    const { membershipId } = await request.json();

    // Fetch membership before deleting so we have the memberId for role sync
    const membership = await db.query.groupMemberships.findFirst({
      where: and(
        eq(groupMemberships.id, membershipId),
        eq(groupMemberships.groupId, groupId)
      ),
    });

    await db
      .delete(groupMemberships)
      .where(
        and(
          eq(groupMemberships.id, membershipId),
          eq(groupMemberships.groupId, groupId)
        )
      );

    if (membership) {
      await syncBoardMemberRole(groupId, membership.memberId, "remove", session.user.id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing member from group:", error);
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
  }
}
