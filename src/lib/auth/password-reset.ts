import { db } from "@/lib/db";
import { passwordResetTokens, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import bcrypt from "bcryptjs";

/**
 * Generate a cryptographically secure password reset token
 */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Create a password reset token for a user
 * @param email User's email address
 * @returns Token string or null if user not found
 */
export async function createPasswordResetToken(
  email: string
): Promise<string | null> {
  // Find user by email
  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (!user) {
    return null;
  }

  // Generate token
  const token = generateResetToken();

  // Hash token for storage (extra security)
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  // Token expires in 24 hours
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  // Delete any existing tokens for this user
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));

  // Create new token
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    token: hashedToken,
    expiresAt,
  });

  // Return unhashed token to send in email
  return token;
}

/**
 * Validate a password reset token
 * @param token Token from email link
 * @returns User ID if valid, null if invalid/expired
 */
export async function validateResetToken(
  token: string
): Promise<string | null> {
  // Hash the token to match database
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  // Find token in database
  const resetToken = await db.query.passwordResetTokens.findFirst({
    where: eq(passwordResetTokens.token, hashedToken),
  });

  if (!resetToken) {
    return null;
  }

  // Check if expired
  if (resetToken.expiresAt < new Date()) {
    // Delete expired token
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.id, resetToken.id));
    return null;
  }

  return resetToken.userId;
}

/**
 * Reset user password with a valid token
 * @param token Token from email link
 * @param newPassword New password (will be hashed)
 * @returns Success boolean
 */
export async function resetPassword(
  token: string,
  newPassword: string
): Promise<boolean> {
  // Validate token and get user ID
  const userId = await validateResetToken(token);

  if (!userId) {
    return false;
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 10);

  // Update user password
  await db.update(users)
    .set({ password: hashedPassword, updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Delete used token
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.token, hashedToken));

  return true;
}

/**
 * Clean up expired password reset tokens (should be run periodically)
 */
export async function cleanupExpiredTokens(): Promise<void> {
  const now = new Date();
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.expiresAt, now));
}
