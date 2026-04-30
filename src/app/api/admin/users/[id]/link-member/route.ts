import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

/**
 * POST /api/admin/users/[id]/link-member
 * Link a user to a member record
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

    const canManage = await hasFeature(session.user.id, FEATURES.ADMIN_USERS);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const { memberId } = await request.json();

    if (!memberId) {
      return NextResponse.json(
        { error: "Member ID is required" },
        { status: 400 }
      );
    }

    // Check if another user is already linked to this member
    const existing = await db.query.users.findFirst({
      where: eq(users.memberId, memberId),
    });

    if (existing && existing.id !== id) {
      return NextResponse.json(
        { error: "Another user is already linked to this member" },
        { status: 409 }
      );
    }

    // Update the user
    const [updated] = await db
      .update(users)
      .set({
        memberId,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error linking member:", error);
    return NextResponse.json(
      { error: "Failed to link member" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/users/[id]/link-member
 * Unlink a user from their member record
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canManage = await hasFeature(session.user.id, FEATURES.ADMIN_USERS);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const [updated] = await db
      .update(users)
      .set({
        memberId: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error unlinking member:", error);
    return NextResponse.json(
      { error: "Failed to unlink member" },
      { status: 500 }
    );
  }
}
