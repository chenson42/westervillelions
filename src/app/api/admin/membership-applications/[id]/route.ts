import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { membershipApplications, members, users, userRoles, roles } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { generateResetToken } from "@/lib/auth/password-reset";
import { Resend } from "resend";
import crypto from "crypto";
import { passwordResetTokens } from "@/lib/db/schema";

async function sendWelcomeEmail(email: string, name: string, token: string) {
  const appUrl = process.env.NEXTAUTH_URL ?? "https://westervillelions.org";
  const setPasswordUrl = `${appUrl}/reset-password?token=${token}`;

  if (!process.env.RESEND_API_KEY) {
    console.log(`[Membership Approval] Welcome email for ${name} <${email}>: ${setPasswordUrl}`);
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org";

  await resend.emails.send({
    from: `Westerville Lions Club <${fromEmail}>`,
    to: [email],
    subject: "Welcome to the Westerville Lions Club — Set Up Your Account",
    html: `
      <p>Hi ${name},</p>
      <p>Congratulations! Your membership application has been approved. We're excited to have you as part of the Westerville Lions Club.</p>
      <p>Click the button below to set your password and activate your member portal account:</p>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${setPasswordUrl}" style="background-color:#1a56db; color:white; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:bold;">
          Set Your Password
        </a>
      </p>
      <p>This link expires in 24 hours. If you need a new one, use the <a href="${appUrl}/forgot-password">forgot password</a> page.</p>
      <br />
      <p>Yours in service,</p>
      <p><strong>Westerville Lions Club</strong></p>
    `,
  });
}

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
    const fullName = `${application.firstName} ${application.lastName}`;

    // Check if a user account already exists for this email
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, application.email.toLowerCase()),
    });

    let userId = existingUser?.id ?? null;

    if (!existingUser) {
      // Create user account (no password — they'll set it via the welcome email)
      const [newUser] = await db.insert(users).values({
        email: application.email.toLowerCase(),
        name: fullName,
        isActive: true,
      }).returning({ id: users.id });

      userId = newUser.id;

      // Assign the "member" role
      const memberRole = await db.query.roles.findFirst({
        where: eq(roles.name, "member"),
      });
      if (memberRole && userId) {
        await db.insert(userRoles).values({ userId, roleId: memberRole.id });
      }

      // Generate a set-password token and send welcome email
      const token = generateResetToken();
      const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      await db.insert(passwordResetTokens).values({ userId, token: hashedToken, expiresAt });

      await sendWelcomeEmail(application.email, fullName, token);
    }

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

    // Link the user account to the new member record
    if (userId && newMember) {
      await db.update(users).set({ memberId: newMember.id }).where(eq(users.id, userId));
    }
  }

  return NextResponse.json({ success: true });
}
