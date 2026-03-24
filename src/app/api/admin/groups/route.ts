import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { groups, groupTypes } from "@/lib/db/schema";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { asc, eq } from "drizzle-orm";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const canManage = await hasFeature(session.user.id, FEATURES.GROUPS_MANAGE);
    if (!canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const groupList = await db
      .select({
        id: groups.id,
        name: groups.name,
        description: groups.description,
        isActive: groups.isActive,
        groupTypeId: groups.groupTypeId,
        typeName: groupTypes.name,
        createdAt: groups.createdAt,
      })
      .from(groups)
      .innerJoin(groupTypes, eq(groups.groupTypeId, groupTypes.id))
      .orderBy(asc(groupTypes.name), asc(groups.name));

    return NextResponse.json(groupList);
  } catch (error) {
    console.error("Error fetching groups:", error);
    return NextResponse.json({ error: "Failed to fetch groups" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const canManage = await hasFeature(session.user.id, FEATURES.GROUPS_MANAGE);
    if (!canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const data = await request.json();

    if (!data.name || !data.groupTypeId) {
      return NextResponse.json({ error: "Name and group type are required" }, { status: 400 });
    }

    const [created] = await db
      .insert(groups)
      .values({
        name: data.name,
        description: data.description || null,
        groupTypeId: data.groupTypeId,
        parentGroupId: data.parentGroupId || null,
        isActive: data.isActive ?? true,
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("Error creating group:", error);
    return NextResponse.json({ error: "Failed to create group" }, { status: 500 });
  }
}
