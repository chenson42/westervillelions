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
// Membership status — pure helpers (no DB calls; unit-testable)
//
// Invariant (DECISION-041 / Phase 3 design, docs/work-log/2026-07-26-prospective-members.md):
// isActive is a fully derived value: isActive === (membershipStatus === 'active').
// No route may accept a client-submitted isActive — it is always computed here.
// ---------------------------------------------------------------------------

export type MembershipStatus = "prospective" | "active" | "ended";

/** The single source of truth for the isActive/membershipStatus invariant. */
export function isActiveForStatus(status: MembershipStatus): boolean {
  return status === "active";
}

/** POST /api/admin/members gate: provision only when creating an active member. */
export function shouldProvisionOnMemberCreate(status: MembershipStatus): boolean {
  return status === "active";
}

/**
 * PATCH /api/admin/members/[id] gate — unifies two previously-separate concerns
 * into one condition:
 *   (a) the pre-existing "defensive: email changed, no linked user" case, now
 *       correctly restricted to landing-as-active only (closes the bug where
 *       editing a prospect's email would silently provision them a login), and
 *   (b) the new induction case: status transitions to 'active' with no linked
 *       user, regardless of whether the email changed in the same request.
 * Never provisions on a transition INTO 'active' if a user is already linked
 * (re-affirm the link instead — provisionUserForMember already does that).
 */
export function shouldProvisionOnMemberUpdate(input: {
  previousStatus: MembershipStatus;
  newStatus: MembershipStatus;
  hasLinkedUser: boolean;
  emailChanged: boolean;
}): boolean {
  if (input.newStatus !== "active" || input.hasLinkedUser) return false;
  const becameActive = input.previousStatus !== "active" && input.newStatus === "active";
  return input.emailChanged || becameActive;
}

// ---------------------------------------------------------------------------
// Membership type — pure helpers (no DB calls; unit-testable)
//
// Invariant (DECISION-064 / Phase 3 design, docs/work-log/2026-08-07-membership-categories.md):
// membershipType is a THIRD, orthogonal axis alongside membershipStatus (club standing) and
// duesCategory (billing rate). It is NEVER derived from either — an admin sets it directly, and no
// status/dues transition may reset or infer it. Values are lowercase snake_case tokens (not the
// literal LCI display label) — see DECISION-064 item 1 for why this diverges from the
// BUDGET_CAUSES precedent in src/lib/ledger.ts.
// ---------------------------------------------------------------------------

export type MembershipType =
  | "active"
  | "member_at_large"
  | "honorary"
  | "privileged"
  | "life_member"
  | "associate_member"
  | "affiliate_member";

export const MEMBERSHIP_TYPES: { value: MembershipType; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "member_at_large", label: "Member at Large" },
  { value: "honorary", label: "Honorary" },
  { value: "privileged", label: "Privileged" },
  { value: "life_member", label: "Life Member" },
  { value: "associate_member", label: "Associate Member" },
  { value: "affiliate_member", label: "Affiliate Member" },
];

/** Server-side gate for any membershipType value written to members.membership_type. */
export function isValidMembershipType(value: string): value is MembershipType {
  return (MEMBERSHIP_TYPES as { value: string }[]).some((t) => t.value === value);
}

/**
 * joinDate rule (decision #8): set at transition-to-active if still null.
 * An explicit admin-submitted joinDate always wins. `now` is injectable for tests.
 */
export function resolveJoinDate(input: {
  becameActive: boolean;
  existingJoinDate: Date | null;
  submittedJoinDate: Date | null;
  now?: Date;
}): Date | null {
  if (input.submittedJoinDate) return input.submittedJoinDate;
  if (input.becameActive && !input.existingJoinDate) return input.now ?? new Date();
  return input.existingJoinDate;
}

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
