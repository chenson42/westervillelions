import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const canManage = await hasFeature(session.user.id, FEATURES.ADMIN_USERS);
  if (!canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { name, email } = await request.json();

  if (!email?.trim()) return NextResponse.json({ error: "Email is required" }, { status: 400 });

  // Check email uniqueness
  const conflict = await db.query.users.findFirst({ where: eq(users.email, email.trim()) });
  if (conflict && conflict.id !== id) {
    return NextResponse.json({ error: "That email is already in use by another account" }, { status: 409 });
  }

  const currentUser = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!currentUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const [updated] = await db
    .update(users)
    .set({ name: name?.trim() || null, email: email.trim(), updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({ id: users.id, name: users.name, email: users.email, memberId: users.memberId });

  // Sync to linked member record
  if (updated.memberId) {
    const memberUpdate: Record<string, unknown> = { updatedAt: new Date() };
    if (email.trim() !== currentUser.email) memberUpdate.email = email.trim();
    if (name?.trim() && name.trim() !== currentUser.name) {
      const parts = name.trim().split(/\s+/);
      memberUpdate.firstName = parts[0];
      memberUpdate.lastName = parts.slice(1).join(" ") || parts[0];
    }
    if (Object.keys(memberUpdate).length > 1) {
      await db.update(members).set(memberUpdate).where(eq(members.id, updated.memberId));
    }
  }

  return NextResponse.json(updated);
}
