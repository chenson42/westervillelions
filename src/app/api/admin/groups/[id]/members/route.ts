import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { groupMemberships } from "@/lib/db/schema";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { and, eq } from "drizzle-orm";

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

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("Error adding member to group:", error);
    return NextResponse.json({ error: "Failed to add member" }, { status: 500 });
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

    await db
      .delete(groupMemberships)
      .where(
        and(
          eq(groupMemberships.id, membershipId),
          eq(groupMemberships.groupId, groupId)
        )
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing member from group:", error);
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
  }
}
