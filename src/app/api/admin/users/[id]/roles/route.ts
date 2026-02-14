import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userRoles, permissionAuditLog } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { hasFeature, clearUserPermissionCache } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

/**
 * POST /api/admin/users/[id]/roles
 * Assign a role to a user
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check permission
    const canManage = await hasFeature(session.user.id, FEATURES.ADMIN_USERS);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { roleId } = await request.json();

    if (!roleId) {
      return NextResponse.json(
        { error: "Role ID is required" },
        { status: 400 }
      );
    }

    // Check if role assignment already exists
    const existing = await db.query.userRoles.findFirst({
      where: and(
        eq(userRoles.userId, params.id),
        eq(userRoles.roleId, roleId)
      ),
    });

    if (existing) {
      return NextResponse.json(
        { error: "User already has this role" },
        { status: 400 }
      );
    }

    // Assign role
    const [assignment] = await db
      .insert(userRoles)
      .values({
        userId: params.id,
        roleId,
      })
      .returning();

    // Log the action
    await db.insert(permissionAuditLog).values({
      userId: session.user.id,
      action: "role_assigned",
      targetUserId: params.id,
      targetRoleId: roleId,
      details: JSON.stringify({ roleId }),
    });

    // Clear permission cache for the user
    clearUserPermissionCache(params.id);

    return NextResponse.json(assignment, { status: 201 });
  } catch (error) {
    console.error("Error assigning role:", error);
    return NextResponse.json(
      { error: "Failed to assign role" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/users/[id]/roles
 * Remove a role from a user
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
    const canManage = await hasFeature(session.user.id, FEATURES.ADMIN_USERS);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { roleId } = await request.json();

    if (!roleId) {
      return NextResponse.json(
        { error: "Role ID is required" },
        { status: 400 }
      );
    }

    // Remove role assignment
    const deleted = await db
      .delete(userRoles)
      .where(
        and(eq(userRoles.userId, params.id), eq(userRoles.roleId, roleId))
      )
      .returning();

    if (deleted.length === 0) {
      return NextResponse.json(
        { error: "Role assignment not found" },
        { status: 404 }
      );
    }

    // Log the action
    await db.insert(permissionAuditLog).values({
      userId: session.user.id,
      action: "role_removed",
      targetUserId: params.id,
      targetRoleId: roleId,
      details: JSON.stringify({ roleId }),
    });

    // Clear permission cache for the user
    clearUserPermissionCache(params.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing role:", error);
    return NextResponse.json(
      { error: "Failed to remove role" },
      { status: 500 }
    );
  }
}
