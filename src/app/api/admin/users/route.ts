import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, members, userRoles, roles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import bcrypt from "bcryptjs";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const canManage = await hasFeature(session.user.id, FEATURES.ADMIN_USERS);
  if (!canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name, email, password, memberId } = await request.json();

  if (!email?.trim()) return NextResponse.json({ error: "Email is required" }, { status: 400 });
  if (!password || password.length < 8)
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });

  const conflict = await db.query.users.findFirst({ where: eq(users.email, email.trim()) });
  if (conflict) return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });

  const hashedPassword = await bcrypt.hash(password, 10);

  let resolvedName = name?.trim() || null;
  if (!resolvedName && memberId) {
    const member = await db.query.members.findFirst({ where: eq(members.id, memberId) });
    if (member) resolvedName = `${member.firstName} ${member.lastName}`.trim();
  }

  const [newUser] = await db
    .insert(users)
    .values({
      email: email.trim(),
      name: resolvedName,
      password: hashedPassword,
      memberId: memberId || null,
    })
    .returning({ id: users.id, email: users.email, name: users.name });

  const memberRole = await db.query.roles.findFirst({ where: eq(roles.name, "member") });
  if (memberRole) {
    await db.insert(userRoles).values({ userId: newUser.id, roleId: memberRole.id });
  }

  return NextResponse.json(newUser, { status: 201 });
}
