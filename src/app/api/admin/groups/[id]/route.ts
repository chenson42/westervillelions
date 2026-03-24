import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { groups, groupMemberships, groupTypes, groupRoles, members } from "@/lib/db/schema";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { eq } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const canManage = await hasFeature(session.user.id, FEATURES.GROUPS_MANAGE);
    if (!canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const group = await db.query.groups.findFirst({ where: eq(groups.id, id) });
    if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const memberships = await db
      .select({
        id: groupMemberships.id,
        memberId: groupMemberships.memberId,
        firstName: members.firstName,
        lastName: members.lastName,
        groupRoleId: groupMemberships.groupRoleId,
        roleName: groupRoles.name,
        joinedAt: groupMemberships.joinedAt,
      })
      .from(groupMemberships)
      .innerJoin(members, eq(groupMemberships.memberId, members.id))
      .innerJoin(groupRoles, eq(groupMemberships.groupRoleId, groupRoles.id))
      .where(eq(groupMemberships.groupId, id));

    return NextResponse.json({ ...group, memberships });
  } catch (error) {
    console.error("Error fetching group:", error);
    return NextResponse.json({ error: "Failed to fetch group" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const canManage = await hasFeature(session.user.id, FEATURES.GROUPS_MANAGE);
    if (!canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const data = await request.json();

    const [updated] = await db
      .update(groups)
      .set({
        name: data.name,
        description: data.description ?? null,
        groupTypeId: data.groupTypeId,
        color: data.color ?? null,
        availablePositions: data.availablePositions ?? null,
        showInDirectory: data.showInDirectory ?? false,
        showPositionAsTag: data.showPositionAsTag ?? false,
        parentGroupId: data.parentGroupId ?? null,
        isActive: data.isActive ?? true,
        updatedAt: new Date(),
      })
      .where(eq(groups.id, id))
      .returning();

    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating group:", error);
    return NextResponse.json({ error: "Failed to update group" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const canManage = await hasFeature(session.user.id, FEATURES.GROUPS_MANAGE);
    if (!canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    await db.delete(groups).where(eq(groups.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting group:", error);
    return NextResponse.json({ error: "Failed to delete group" }, { status: 500 });
  }
}
