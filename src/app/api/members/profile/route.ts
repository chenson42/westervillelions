import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/members/profile
 * Get the current user's linked member record
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const member = await db.query.members.findFirst({
      where: eq(members.userId, session.user.id),
    });

    return NextResponse.json(member ?? null);
  } catch (error) {
    console.error("Error fetching profile:", error);
    return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
  }
}

/**
 * PUT /api/members/profile
 * Update the current user's linked member record
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const member = await db.query.members.findFirst({
      where: eq(members.userId, session.user.id),
    });

    if (!member) {
      return NextResponse.json(
        { error: "No member record linked to your account. Contact an admin." },
        { status: 404 }
      );
    }

    const data = await request.json();

    const [updated] = await db
      .update(members)
      .set({
        firstName: data.firstName || member.firstName,
        lastName: data.lastName || member.lastName,
        email: data.email ?? member.email,
        phone: data.phone ?? member.phone,
        address: data.address ?? member.address,
        city: data.city ?? member.city,
        state: data.state ?? member.state,
        zip: data.zip ?? member.zip,
        updatedAt: new Date(),
      })
      .where(eq(members.id, member.id))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating profile:", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
