import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { membershipApplications, members } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { provisionUserForMember } from "@/lib/members";

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

  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const [application] = await db
    .select()
    .from(membershipApplications)
    .where(eq(membershipApplications.id, id));

  if (!application) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  await db
    .update(membershipApplications)
    .set({
      status: action === "approve" ? "approved" : "rejected",
      adminNotes: adminNotes || null,
      reviewedBy: session.user.id,
      reviewedAt: new Date(),
    })
    .where(eq(membershipApplications.id, id));

  if (action === "approve") {
    // Create the member record
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
    }).returning({ id: members.id });

    // Provision user account, assign member role, send welcome email
    await provisionUserForMember({
      email: application.email,
      firstName: application.firstName,
      lastName: application.lastName,
      memberId: newMember.id,
    });
  }

  return NextResponse.json({ success: true });
}
