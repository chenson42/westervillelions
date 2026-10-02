import { NextRequest, NextResponse } from "next/server";
import { createPasswordResetToken } from "@/lib/auth/password-reset";
import { sendEmail } from "@/lib/email";
import { getFromEmail, getAppUrl, buildPasswordResetEmailHtml } from "@/lib/email-compose";

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
      // getAppUrl() (src/lib/email-compose.ts, B-46): trailing-slash trimmed,
      // absolute fallback. This site used to be the one of ~19 app-URL call
      // sites with NO fallback at all — a bare `${process.env.NEXTAUTH_URL}`
      // — so an unset env var would have carried a literal
      // "undefined/reset-password?token=…" link. Fixed 2026-09-10; now
      // consolidated onto the shared helper along with the rest.
      const appUrl = getAppUrl();
      const resetUrl = `${appUrl}/reset-password?token=${token}`;

      await sendEmail({
        from: getFromEmail("Westerville Lions"),
        to: email,
        subject: "Reset your password",
        html: buildPasswordResetEmailHtml(resetUrl),
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
