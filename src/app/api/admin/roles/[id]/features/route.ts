import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { roleFeatures, permissionAuditLog } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { hasFeature, clearAllPermissionCaches } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

/**
 * POST /api/admin/roles/[id]/features
 * Grant a feature to a role
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canManage = await hasFeature(session.user.id, FEATURES.ADMIN_ROLES);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const { featureId } = await request.json();

    if (!featureId) {
      return NextResponse.json(
        { error: "Feature ID is required" },
        { status: 400 }
      );
    }

    // Check if assignment already exists
    const existing = await db.query.roleFeatures.findFirst({
      where: and(
        eq(roleFeatures.roleId, id),
        eq(roleFeatures.featureId, featureId)
      ),
    });

    if (existing) {
      return NextResponse.json(
        { error: "Role already has this feature" },
        { status: 400 }
      );
    }

    // Grant feature
    const [assignment] = await db
      .insert(roleFeatures)
      .values({
        roleId: id,
        featureId,
      })
      .returning();

    // Log the action
    await db.insert(permissionAuditLog).values({
      userId: session.user.id,
      action: "permission_granted",
      targetRoleId: id,
      targetFeatureId: featureId,
      details: JSON.stringify({ featureId }),
    });

    // Clear all permission caches (affects all users with this role)
    clearAllPermissionCaches();

    return NextResponse.json(assignment, { status: 201 });
  } catch (error) {
    console.error("Error granting feature:", error);
    return NextResponse.json(
      { error: "Failed to grant feature" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/roles/[id]/features
 * Revoke a feature from a role
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

    const canManage = await hasFeature(session.user.id, FEATURES.ADMIN_ROLES);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const { featureId } = await request.json();

    if (!featureId) {
      return NextResponse.json(
        { error: "Feature ID is required" },
        { status: 400 }
      );
    }

    // Remove feature assignment
    const deleted = await db
      .delete(roleFeatures)
      .where(
        and(eq(roleFeatures.roleId, id), eq(roleFeatures.featureId, featureId))
      )
      .returning();

    if (deleted.length === 0) {
      return NextResponse.json(
        { error: "Feature assignment not found" },
        { status: 404 }
      );
    }

    // Log the action
    await db.insert(permissionAuditLog).values({
      userId: session.user.id,
      action: "permission_revoked",
      targetRoleId: id,
      targetFeatureId: featureId,
      details: JSON.stringify({ featureId }),
    });

    // Clear all permission caches (affects all users with this role)
    clearAllPermissionCaches();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error revoking feature:", error);
    return NextResponse.json(
      { error: "Failed to revoke feature" },
      { status: 500 }
    );
  }
}
