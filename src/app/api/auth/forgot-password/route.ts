import { NextRequest, NextResponse } from "next/server";
import { createPasswordResetToken } from "@/lib/auth/password-reset";

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

    // Always return success to prevent email enumeration
    // (don't reveal whether the email exists in the system)
    return NextResponse.json({
      success: true,
      message: "If that email exists, a password reset link has been sent.",
    });

    // In a real implementation, send email here:
    // await sendPasswordResetEmail(email, token);
    //
    // For now, you can log it for testing:
    // if (token && process.env.NODE_ENV === 'development') {
    //   console.log(`Password reset token for ${email}: ${token}`);
    //   console.log(`Reset link: ${process.env.NEXTAUTH_URL}/reset-password?token=${token}`);
    // }
  } catch (error) {
    console.error("Error in forgot-password:", error);
    return NextResponse.json(
      { error: "An error occurred" },
      { status: 500 }
    );
  }
}
