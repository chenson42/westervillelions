/**
 * One-time sync: assign board_member role to all users linked to Board of Directors members,
 * and remove it from users who are no longer in that group.
 *
 * Run with:
 *   source ~/.nvm/nvm.sh && nvm use 20 && export $(grep -E "^DATABASE_URL=" .env.local | xargs) && npx tsx scripts/sync-board-role.ts
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";

const { groups, groupMemberships, users, roles, userRoles, permissionAuditLog } = schema;

const BOARD_GROUP_NAME = "Board of Directors";
const BOARD_MEMBER_ROLE = "board_member";
const SYSTEM_USER_ID = null; // no actor for script-based changes

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const client = postgres(databaseUrl);
  const db = drizzle(client, { schema });

  // Find the Board of Directors group
  const boardGroup = await db.query.groups.findFirst({
    where: eq(groups.name, BOARD_GROUP_NAME),
  });
  if (!boardGroup) {
    console.error(`Group "${BOARD_GROUP_NAME}" not found`);
    process.exit(1);
  }
  console.log(`Found group: ${boardGroup.name} (${boardGroup.id})`);

  // Find the board_member role
  const boardRole = await db.query.roles.findFirst({
    where: eq(roles.name, BOARD_MEMBER_ROLE),
  });
  if (!boardRole) {
    console.error(`Role "${BOARD_MEMBER_ROLE}" not found`);
    process.exit(1);
  }
  console.log(`Found role: ${boardRole.name} (${boardRole.id})`);

  // Get all current board group members
  const boardMemberships = await db
    .select({ memberId: groupMemberships.memberId })
    .from(groupMemberships)
    .where(eq(groupMemberships.groupId, boardGroup.id));

  const boardMemberIds = new Set(boardMemberships.map((m) => m.memberId));
  console.log(`Board of Directors has ${boardMemberIds.size} member(s)`);

  // Get all users who currently have the board_member role
  const currentBoardRoleUsers = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(eq(userRoles.roleId, boardRole.id));

  const currentBoardRoleUserIds = new Set(currentBoardRoleUsers.map((r) => r.userId));
  console.log(`Currently ${currentBoardRoleUserIds.size} user(s) have the board_member role`);

  let assigned = 0;
  let removed = 0;
  let skipped = 0;

  // Assign board_member role to board group members who don't have it
  for (const memberId of boardMemberIds) {
    const linkedUser = await db.query.users.findFirst({
      where: eq(users.memberId, memberId),
    });

    if (!linkedUser) {
      console.log(`  [SKIP] member ${memberId} — no linked user account`);
      skipped++;
      continue;
    }

    if (!currentBoardRoleUserIds.has(linkedUser.id)) {
      await db.insert(userRoles).values({
        userId: linkedUser.id,
        roleId: boardRole.id,
      });
      await db.insert(permissionAuditLog).values({
        userId: SYSTEM_USER_ID,
        action: "role_assigned",
        targetUserId: linkedUser.id,
        targetRoleId: boardRole.id,
        details: JSON.stringify({ source: "sync_board_role_script" }),
      });
      console.log(`  [ASSIGN] user ${linkedUser.email} (${linkedUser.id})`);
      assigned++;
    } else {
      console.log(`  [ALREADY HAS ROLE] user ${linkedUser.email}`);
    }
  }

  // Remove board_member role from users not in the board group
  for (const userId of currentBoardRoleUserIds) {
    const linkedUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    // If user has no member link, skip
    if (!linkedUser?.memberId) {
      console.log(`  [SKIP REMOVE] user ${userId} — no member link`);
      continue;
    }

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
        userId: SYSTEM_USER_ID,
        action: "role_removed",
        targetUserId: userId,
        targetRoleId: boardRole.id,
        details: JSON.stringify({ source: "sync_board_role_script" }),
      });
      console.log(`  [REMOVE] user ${linkedUser.email} (${linkedUser.id})`);
      removed++;
    }
  }

  console.log(`\nSync complete — Assigned: ${assigned}, Removed: ${removed}, Skipped: ${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
