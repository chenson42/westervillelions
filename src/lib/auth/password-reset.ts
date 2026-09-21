import { db } from "@/lib/db";
import { passwordResetTokens, users } from "@/lib/db/schema";
import { eq, lte } from "drizzle-orm";
import crypto from "crypto";
import bcrypt from "bcryptjs";

/**
 * Generate a cryptographically secure password reset token
 */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Single home for the bcrypt cost factor — folded in from three previously
// independent `bcrypt.hash(x, 10)` call sites (src/app/api/auth/register/route.ts,
// src/app/api/admin/users/route.ts, and this file's own resetPassword()) per
// docs/work-log/2026-09-18-admin-account-reset.md Phase 3. Value unchanged (10).
const BCRYPT_COST = 10;

// 32-character alphabet: A-Z minus I/O (look like 1/0 read aloud or on screen),
// digits 2-9 (0/1 excluded for the same reason). 32 = 2^5 is deliberate: masking
// the low 5 bits of a random byte (byte & 0x1f) selects a character with exactly
// uniform probability — no modulo bias, no rejection sampling needed, because
// 256 (the range of a byte) divides evenly by 32.
const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TEMP_PASSWORD_CHAR_COUNT = 12; // 12 * 5 bits = 60 bits of entropy
const TEMP_PASSWORD_GROUP_SIZE = 4; // displayed/typed as XXXX-XXXX-XXXX

/**
 * Generate a random, human-relayable temporary password (e.g. for an
 * admin-initiated in-band reset). Formatted XXXX-XXXX-XXXX so it reads
 * cleanly over the phone; the hyphens are literal characters in the
 * returned string, not display-only formatting.
 */
export function generateTempPassword(): string {
  const bytes = crypto.randomBytes(TEMP_PASSWORD_CHAR_COUNT);
  let chars = "";
  for (let i = 0; i < TEMP_PASSWORD_CHAR_COUNT; i++) {
    chars += TEMP_PASSWORD_ALPHABET[bytes[i] & 0x1f];
  }
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += TEMP_PASSWORD_GROUP_SIZE) {
    groups.push(chars.slice(i, i + TEMP_PASSWORD_GROUP_SIZE));
  }
  return groups.join("-");
}

/**
 * Hash a plaintext password with the project's single named bcrypt cost
 * factor. The only helper that should ever call bcrypt.hash() directly —
 * see BCRYPT_COST above.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
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

  // Opportunistically sweep expired tokens (no scheduled job runs this otherwise)
  await cleanupExpiredTokens();

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
  const hashedPassword = await hashPassword(newPassword);

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
  await db.delete(passwordResetTokens).where(lte(passwordResetTokens.expiresAt, now));
}
