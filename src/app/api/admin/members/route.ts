import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { syncClubMembersList } from "@/lib/google-groups";
import { provisionUserForMember } from "@/lib/members";
import { sql } from "drizzle-orm";

/**
 * GET /api/admin/members
 * List all members
 */
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check permission
    const canView = await hasFeature(session.user.id, FEATURES.MEMBERS_VIEW);
    if (!canView) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const memberList = await db.select().from(members).orderBy(members.lastName);

    return NextResponse.json(memberList);
  } catch (error) {
    console.error("Error fetching members:", error);
    return NextResponse.json(
      { error: "Failed to fetch members" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/members
 * Create a new member
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check permission
    const canEdit = await hasFeature(session.user.id, FEATURES.MEMBERS_EDIT);
    if (!canEdit) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const data = await request.json();

    // Validate required fields
    if (!data.firstName || !data.lastName) {
      return NextResponse.json(
        { error: "First name and last name are required" },
        { status: 400 }
      );
    }

    // Email is required for user provisioning
    if (!data.email || !data.email.trim()) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    // Reject case-insensitive duplicate email across existing members
    const emailConflict = await db.query.members.findFirst({
      where: sql`lower(${members.email}) = ${data.email.trim().toLowerCase()}`,
    });
    if (emailConflict) {
      return NextResponse.json(
        { error: "A member with this email already exists" },
        { status: 409 }
      );
    }

    // Create member
    const [newMember] = await db
      .insert(members)
      .values({
        memberNumber: data.memberNumber || null,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email.trim(),
        phone: data.phone || null,
        address: data.address || null,
        city: data.city || null,
        state: data.state || null,
        zip: data.zip || null,
        branch: data.branch || null,
        boardPosition: data.boardPosition || null,
        joinDate: data.joinDate ? new Date(data.joinDate) : null,
        isActive: data.isActive ?? true,
      })
      .returning();

    // Provision user account, assign member role, send welcome email
    let userLinked: "created" | "existing" = "created";
    try {
      const { wasExisting } = await provisionUserForMember({
        email: data.email.trim(),
        firstName: data.firstName,
        lastName: data.lastName,
        memberId: newMember.id,
      });
      userLinked = wasExisting ? "existing" : "created";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("EMAIL_CONFLICT")) {
        return NextResponse.json(
          { error: "A user account already linked to a different member exists for this email" },
          { status: 409 }
        );
      }
      throw err;
    }

    // Fire-and-forget club list sync
    syncClubMembersList({ triggeredByUserId: session.user.id, triggerSource: "member_added" })
      .catch((e) => console.error("[sync] club list:", e));

    return NextResponse.json({ ...newMember, userLinked }, { status: 201 });
  } catch (error) {
    console.error("Error creating member:", error);
    return NextResponse.json(
      { error: "Failed to create member" },
      { status: 500 }
    );
  }
}
