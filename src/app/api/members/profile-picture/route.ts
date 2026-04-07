import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const MAX_DATA_URI_LENGTH = 409_600;

/**
 * POST /api/members/profile-picture
 * Save the authenticated member's own profile picture.
 * Body: { dataUri: string }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const member = session.user.memberId
      ? await db.query.members.findFirst({
          where: eq(members.id, session.user.memberId),
        })
      : null;

    if (!member) {
      return NextResponse.json(
        { error: "No member record linked to your account. Contact an admin." },
        { status: 404 }
      );
    }

    const data = await request.json();
    const { dataUri } = data;

    if (typeof dataUri !== "string" || !dataUri.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "Invalid image. Must be a data URI starting with data:image/" },
        { status: 400 }
      );
    }

    if (dataUri.length > MAX_DATA_URI_LENGTH) {
      return NextResponse.json(
        { error: "Image too large. Maximum size is approximately 300KB." },
        { status: 400 }
      );
    }

    await db
      .update(members)
      .set({ profilePicture: dataUri, updatedAt: new Date() })
      .where(eq(members.id, member.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving profile picture:", error);
    return NextResponse.json(
      { error: "Failed to save profile picture" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/members/profile-picture
 * Remove the authenticated member's own profile picture.
 */
export async function DELETE() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const member = session.user.memberId
      ? await db.query.members.findFirst({
          where: eq(members.id, session.user.memberId),
        })
      : null;

    if (!member) {
      return NextResponse.json(
        { error: "No member record linked to your account. Contact an admin." },
        { status: 404 }
      );
    }

    await db
      .update(members)
      .set({ profilePicture: null, updatedAt: new Date() })
      .where(eq(members.id, member.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing profile picture:", error);
    return NextResponse.json(
      { error: "Failed to remove profile picture" },
      { status: 500 }
    );
  }
}
