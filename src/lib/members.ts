/**
 * Member provisioning helpers.
 *
 * provisionUserForMember — the single authoritative path for creating or linking
 * a users row to a members row. Called from:
 *   - POST /api/admin/members (direct admin create)
 *   - PATCH /api/admin/members/[id] (legacy orphan side-effect)
 *   - PATCH /api/admin/membership-applications/[id] (application approval)
 */

import { db } from "@/lib/db";
import { users, roles, userRoles, passwordResetTokens } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { generateResetToken } from "@/lib/auth/password-reset";
import { sendEmail } from "@/lib/email";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Welcome email
// ---------------------------------------------------------------------------

async function sendWelcomeEmail(
  email: string,
  name: string,
  token: string
): Promise<void> {
  const appUrl = process.env.NEXTAUTH_URL ?? "https://westervillelions.org";
  const setPasswordUrl = `${appUrl}/reset-password?token=${token}`;
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org";

  await sendEmail({
    from: `Westerville Lions Club <${fromEmail}>`,
    to: email,
    subject: "Welcome to the Westerville Lions Club — Set Up Your Account",
    html: `
      <p>Hi ${name},</p>
      <p>Welcome to the Westerville Lions Club! Your member portal account has been created.</p>
      <p>Click the button below to set your password and activate your account:</p>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${setPasswordUrl}" style="background-color:#1a56db; color:white; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:bold;">
          Set Your Password
        </a>
      </p>
      <p>This link expires in 24 hours. If you need a new one, use the <a href="${appUrl}/forgot-password">forgot password</a> page.</p>
      <p>Alternatively, if your Google account uses this email address, you can sign in directly with Google — no password needed.</p>
      <br />
      <p>Yours in service,</p>
      <p><strong>Westerville Lions Club</strong></p>
    `,
  });
}

// ---------------------------------------------------------------------------
// provisionUserForMember
// ---------------------------------------------------------------------------

export async function provisionUserForMember(input: {
  email: string;
  firstName: string;
  lastName: string;
  memberId: string;
}): Promise<{ userId: string; wasExisting: boolean }> {
  const lowerEmail = input.email.toLowerCase();
  const fullName = `${input.firstName} ${input.lastName}`.trim();

  // 1. Case-insensitive lookup for an existing user with this email
  const existingUser = await db.query.users.findFirst({
    where: sql`lower(${users.email}) = ${lowerEmail}`,
  });

  if (existingUser) {
    // 2a. Guard: existing user already linked to a different member
    if (
      existingUser.memberId !== null &&
      existingUser.memberId !== input.memberId
    ) {
      throw new Error(
        "EMAIL_CONFLICT: user already linked to another member"
      );
    }

    // 2b. Link (or re-affirm link) to this member — no welcome email
    await db
      .update(users)
      .set({ memberId: input.memberId, updatedAt: new Date() })
      .where(eq(users.id, existingUser.id));

    return { userId: existingUser.id, wasExisting: true };
  }

  // 3. No existing user — create one (no password; they set it via token)
  const [newUser] = await db
    .insert(users)
    .values({
      email: lowerEmail,
      name: fullName,
      isActive: true,
    })
    .returning({ id: users.id });

  // 4. Assign "member" role (soft failure if seed row is missing)
  const memberRole = await db.query.roles.findFirst({
    where: eq(roles.name, "member"),
  });
  if (memberRole) {
    await db.insert(userRoles).values({
      userId: newUser.id,
      roleId: memberRole.id,
    });
  } else {
    console.warn(
      "[provisionUserForMember] 'member' role row not found — skipping role assignment"
    );
  }

  // 5. Generate 24-hour password-set token
  const token = generateResetToken();
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  await db
    .insert(passwordResetTokens)
    .values({ userId: newUser.id, token: hashedToken, expiresAt });

  // 6. Send welcome email (failure does not throw — lands in email_queue as 'failed')
  await sendWelcomeEmail(input.email, fullName, token);

  // 7. Link user → member
  await db
    .update(users)
    .set({ memberId: input.memberId, updatedAt: new Date() })
    .where(eq(users.id, newUser.id));

  return { userId: newUser.id, wasExisting: false };
}
