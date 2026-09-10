import { NextRequest, NextResponse } from "next/server";
import { createPasswordResetToken } from "@/lib/auth/password-reset";
import { sendEmail } from "@/lib/email";

/**
 * POST /api/auth/forgot-password
 * Request a password reset email
 */
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    // Generate reset token (returns null if user not found)
    const token = await createPasswordResetToken(email);

    // Send reset email if token was created (user exists)
    if (token) {
      // NEXTAUTH_URL is interpolated with a real fallback, not bare. This was the
      // only one of the ~19 app-URL sites in the codebase with NO fallback at all:
      // if the env var were ever unset, the reset email would carry a literal
      // "undefined/reset-password?token=…" link and the recipient would be locked
      // out with no way to tell why. Same shape as siteUrl() in
      // api/admin/events/[id]/announce/route.ts, which is the safest existing
      // variant (trailing-slash trimmed, absolute fallback — a `?? ""` fallback
      // would yield a relative URL, which is broken inside an email).
      // Consolidating all ~19 sites is backlog item B-46.
      const appUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "https://westervillelions.org";
      const resetUrl = `${appUrl}/reset-password?token=${token}`;

      await sendEmail({
        from: "Westerville Lions <noreply@westervillelions.org>",
        to: email,
        subject: "Reset your password",
        html: `
          <h2>Password Reset Request</h2>
          <p>You requested a password reset for your Westerville Lions Club account.</p>
          <p><a href="${resetUrl}" style="background:#1a56db;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin:16px 0;">Reset Password</a></p>
          <p>This link expires in 24 hours. If you did not request a reset, you can ignore this email.</p>
        `,
      });
    }

    // Always return success to prevent email enumeration
    return NextResponse.json({
      success: true,
      message: "If that email exists, a password reset link has been sent.",
    });
  } catch (error) {
    console.error("Error in forgot-password:", error);
    return NextResponse.json(
      { error: "An error occurred" },
      { status: 500 }
    );
  }
}
