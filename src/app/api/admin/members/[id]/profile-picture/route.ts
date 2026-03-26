import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

const MAX_DATA_URI_LENGTH = 409_600;

/**
 * POST /api/admin/members/[id]/profile-picture
 * Admin saves a profile picture for any member.
 * Body: { dataUri: string }
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

    const canEdit = await hasFeature(session.user.id, FEATURES.MEMBERS_EDIT);
    if (!canEdit) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const member = await db.query.members.findFirst({
      where: eq(members.id, id),
    });

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
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
      .where(eq(members.id, id));

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
 * DELETE /api/admin/members/[id]/profile-picture
 * Admin removes a profile picture for any member.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canEdit = await hasFeature(session.user.id, FEATURES.MEMBERS_EDIT);
    if (!canEdit) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const member = await db.query.members.findFirst({
      where: eq(members.id, id),
    });

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    await db
      .update(members)
      .set({ profilePicture: null, updatedAt: new Date() })
      .where(eq(members.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing profile picture:", error);
    return NextResponse.json(
      { error: "Failed to remove profile picture" },
      { status: 500 }
    );
  }
}
