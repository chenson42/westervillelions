import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
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

  // Check email uniqueness if changing it
  const existing = await db.query.users.findFirst({ where: eq(users.email, email.trim()) });
  if (existing && existing.id !== id) {
    return NextResponse.json({ error: "That email is already in use by another account" }, { status: 409 });
  }

  const [updated] = await db
    .update(users)
    .set({ name: name?.trim() || null, email: email.trim(), updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({ id: users.id, name: users.name, email: users.email });

  if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json(updated);
}
