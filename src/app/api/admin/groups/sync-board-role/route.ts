import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { groups, groupMemberships, users, roles, userRoles, permissionAuditLog } from "@/lib/db/schema";
import { hasFeature, clearUserPermissionCache } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { and, eq } from "drizzle-orm";

const BOARD_GROUP_NAME = "Board of Directors";
const BOARD_MEMBER_ROLE = "board_member";

/**
 * POST /api/admin/groups/sync-board-role
 * One-time sync: assigns board_member role to all members in the Board of Directors group,
 * and removes it from users who are no longer in the group.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canManage = await hasFeature(session.user.id, FEATURES.ADMIN_USERS);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Find the Board of Directors group
    const boardGroup = await db.query.groups.findFirst({
      where: eq(groups.name, BOARD_GROUP_NAME),
    });
    if (!boardGroup) {
      return NextResponse.json({ error: "Board of Directors group not found" }, { status: 404 });
    }

    // Find the board_member role
    const boardRole = await db.query.roles.findFirst({
      where: eq(roles.name, BOARD_MEMBER_ROLE),
    });
    if (!boardRole) {
      return NextResponse.json({ error: "board_member role not found" }, { status: 404 });
    }

    // Get all current board group members
    const boardMemberships = await db
      .select({ memberId: groupMemberships.memberId })
      .from(groupMemberships)
      .where(eq(groupMemberships.groupId, boardGroup.id));

    const boardMemberIds = new Set(boardMemberships.map((m) => m.memberId));

    // Get all users who have the board_member role
    const currentBoardRoleUsers = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.roleId, boardRole.id));

    const currentBoardRoleUserIds = new Set(currentBoardRoleUsers.map((r) => r.userId));

    let assigned = 0;
    let removed = 0;
    let skipped = 0;

    // Assign board_member role to board group members who don't have it
    for (const memberId of boardMemberIds) {
      const linkedUser = await db.query.users.findFirst({
        where: eq(users.memberId, memberId),
      });

      if (!linkedUser) {
        skipped++;
        continue;
      }

      if (!currentBoardRoleUserIds.has(linkedUser.id)) {
        await db.insert(userRoles).values({
          userId: linkedUser.id,
          roleId: boardRole.id,
        });
        await db.insert(permissionAuditLog).values({
          userId: session.user.id,
          action: "role_assigned",
          targetUserId: linkedUser.id,
          targetRoleId: boardRole.id,
          details: JSON.stringify({ source: "sync_board_role" }),
        });
        clearUserPermissionCache(linkedUser.id);
        assigned++;
      }
    }

    // Remove board_member role from users not in the board group
    for (const userId of currentBoardRoleUserIds) {
      const linkedUser = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      // If user has no member link, skip (not a member-linked account)
      if (!linkedUser?.memberId) continue;

      if (!boardMemberIds.has(linkedUser.memberId)) {
        await db
          .delete(userRoles)
          .where(
            and(
              eq(userRoles.userId, userId),
              eq(userRoles.roleId, boardRole.id)
            )
          );
        await db.insert(permissionAuditLog).values({
          userId: session.user.id,
          action: "role_removed",
          targetUserId: userId,
          targetRoleId: boardRole.id,
          details: JSON.stringify({ source: "sync_board_role" }),
        });
        clearUserPermissionCache(userId);
        removed++;
      }
    }

    return NextResponse.json({ assigned, removed, skipped });
  } catch (error) {
    console.error("Error syncing board member role:", error);
    return NextResponse.json({ error: "Failed to sync board member role" }, { status: 500 });
  }
}
