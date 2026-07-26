import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { membershipApplications, members } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { eq, sql } from "drizzle-orm";
import { provisionUserForMember } from "@/lib/members";
import { syncClubMembersList } from "@/lib/google-groups";

const VALID_ACTIONS = ["approve", "approve_prospective", "reject"] as const;
type Action = (typeof VALID_ACTIONS)[number];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canManage = await hasFeature(session.user.id, FEATURES.MEMBERSHIP_MANAGE);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { action, adminNotes } = await request.json();

  if (!VALID_ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  const typedAction = action as Action;

  const [application] = await db
    .select()
    .from(membershipApplications)
    .where(eq(membershipApplications.id, id));

  if (!application) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  // Duplicate-email guard — applies to both approval branches. This route had
  // no case-insensitive email-conflict check at all before this feature.
  if (typedAction === "approve" || typedAction === "approve_prospective") {
    const emailConflict = await db.query.members.findFirst({
      where: sql`lower(${members.email}) = ${application.email.trim().toLowerCase()}`,
    });
    if (emailConflict) {
      return NextResponse.json(
        { error: "A member with this email already exists" },
        { status: 409 }
      );
    }
  }

  await db
    .update(membershipApplications)
    .set({
      status: typedAction === "reject" ? "rejected" : "approved",
      adminNotes: adminNotes || null,
      reviewedBy: session.user.id,
      reviewedAt: new Date(),
    })
    .where(eq(membershipApplications.id, id));

  if (typedAction === "approve") {
    // Create the member record as a full, active member.
    const [newMember] = await db.insert(members).values({
      firstName: application.firstName,
      lastName: application.lastName,
      email: application.email,
      phone: application.phone,
      address: application.address,
      city: application.city,
      state: application.state,
      zip: application.zip,
      joinDate: new Date(),
      isActive: true,
      membershipStatus: "active",
    }).returning({ id: members.id });

    // Provision user account, assign member role, send welcome email
    await provisionUserForMember({
      email: application.email,
      firstName: application.firstName,
      lastName: application.lastName,
      memberId: newMember.id,
    });

    // Bug fix: this call was previously missing entirely — a newly approved
    // member would not land on club@ until the next unrelated member edit or
    // manual "Sync Club List" click. Fire-and-forget, matches POST /api/admin/members.
    syncClubMembersList({ triggeredByUserId: session.user.id, triggerSource: "member_added" })
      .catch((e) => console.error("[sync] club list:", e));
  } else if (typedAction === "approve_prospective") {
    // Create the member record as prospective — rides club@ but is not a
    // dues-liable, directory-listed, or portal-eligible member yet.
    await db.insert(members).values({
      firstName: application.firstName,
      lastName: application.lastName,
      email: application.email,
      phone: application.phone,
      address: application.address,
      city: application.city,
      state: application.state,
      zip: application.zip,
      joinDate: null,
      isActive: false,
      membershipStatus: "prospective",
    }).returning({ id: members.id });

    // Does NOT call provisionUserForMember — prospects get no portal login.

    syncClubMembersList({ triggeredByUserId: session.user.id, triggerSource: "member_added" })
      .catch((e) => console.error("[sync] club list:", e));
  }

  return NextResponse.json({ success: true });
}
