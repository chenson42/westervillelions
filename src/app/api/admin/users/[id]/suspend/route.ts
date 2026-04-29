import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, permissionAuditLog } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature, clearUserPermissionCache } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

// POST — suspend user (isActive = false)
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return setActive(await params, false);
}

// DELETE — unsuspend user (isActive = true)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return setActive(await params, true);
}

async function setActive({ id }: { id: string }, active: boolean) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const canManage = await hasFeature(session.user.id, FEATURES.ADMIN_USERS);
  if (!canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Prevent self-suspension
  if (id === session.user.id) {
    return NextResponse.json({ error: "You cannot suspend your own account" }, { status: 400 });
  }

  const [updated] = await db
    .update(users)
    .set({ isActive: active, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({ id: users.id, isActive: users.isActive });

  if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });

  await db.insert(permissionAuditLog).values({
    userId: session.user.id,
    action: active ? "user_unsuspended" : "user_suspended",
    targetUserId: id,
    details: JSON.stringify({ isActive: active }),
  });

  clearUserPermissionCache(id);

  return NextResponse.json({ success: true, isActive: active });
}
