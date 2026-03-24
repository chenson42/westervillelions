import { NextRequest, NextResponse } from "next/server";
import { createPasswordResetToken } from "@/lib/auth/password-reset";
import { Resend } from "resend";

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
      const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password?token=${token}`;

      if (process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: "Westerville Lions <noreply@westervillelions.org>",
          to: [email],
          subject: "Reset your password",
          html: `
            <h2>Password Reset Request</h2>
            <p>You requested a password reset for your Westerville Lions Club account.</p>
            <p><a href="${resetUrl}" style="background:#1a56db;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin:16px 0;">Reset Password</a></p>
            <p>This link expires in 24 hours. If you did not request a reset, you can ignore this email.</p>
          `,
        });
      } else {
        console.log(`[Password Reset] Reset link for ${email}: ${resetUrl}`);
      }
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
