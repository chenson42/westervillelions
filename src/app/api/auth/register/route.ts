import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, members, userRoles, roles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

/**
 * POST /api/auth/register
 * Register a new user. Email must match an existing active member record.
 */
export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Must match an existing active member record
    const matchingMember = await db.query.members.findFirst({
      where: eq(members.email, email),
    });

    if (!matchingMember || !matchingMember.isActive) {
      return NextResponse.json(
        { error: "No active member record found for this email address. Please contact an administrator." },
        { status: 403 }
      );
    }

    // Check if an account already exists for this email
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user, pulling name from the member record
    const [newUser] = await db
      .insert(users)
      .values({
        email,
        name: `${matchingMember.firstName} ${matchingMember.lastName}`,
        password: hashedPassword,
        emailVerified: null,
      })
      .returning();

    // Link user to member record
    await db
      .update(members)
      .set({ userId: newUser.id })
      .where(eq(members.id, matchingMember.id));

    // Assign member role
    const memberRole = await db.query.roles.findFirst({
      where: eq(roles.name, "member"),
    });

    if (memberRole) {
      await db.insert(userRoles).values({
        userId: newUser.id,
        roleId: memberRole.id,
      });
    }

    return NextResponse.json({
      success: true,
      message: "Account created and linked to your member profile",
    });
  } catch (error) {
    console.error("Error in register:", error);
    return NextResponse.json(
      { error: "An error occurred during registration" },
      { status: 500 }
    );
  }
}
