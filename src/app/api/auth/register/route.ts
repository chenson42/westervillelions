import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, members, userRoles, roles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

/**
 * POST /api/auth/register
 * Register a new user with member auto-linking
 */
export async function POST(request: NextRequest) {
  try {
    const { name, email, password } = await request.json();

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Name, email, and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Check if there's a member with this email
    const matchingMember = await db.query.members.findFirst({
      where: eq(members.email, email),
    });

    // Create user account
    const [newUser] = await db
      .insert(users)
      .values({
        email,
        name,
        password: hashedPassword,
        emailVerified: null, // Could implement email verification later
      })
      .returning();

    // Determine which role to assign
    let roleName = "volunteer"; // Default for non-members
    let linkedMember = false;

    if (matchingMember) {
      // Link user to member record
      await db
        .update(members)
        .set({ userId: newUser.id })
        .where(eq(members.id, matchingMember.id));

      roleName = "member"; // Members get member role
      linkedMember = true;
    }

    // Get the role ID
    const role = await db.query.roles.findFirst({
      where: eq(roles.name, roleName),
    });

    if (role) {
      // Assign role to user
      await db.insert(userRoles).values({
        userId: newUser.id,
        roleId: role.id,
      });
    }

    // In a real implementation, send welcome email here:
    // await sendWelcomeEmail(email, name, linkedMember);

    return NextResponse.json({
      success: true,
      linkedMember,
      message: linkedMember
        ? "Account created and linked to your member profile"
        : "Account created successfully",
    });
  } catch (error) {
    console.error("Error in register:", error);
    return NextResponse.json(
      { error: "An error occurred during registration" },
      { status: 500 }
    );
  }
}
