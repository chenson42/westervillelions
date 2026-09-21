/**
 * POST /api/admin/users/[id]/reset-password — admin-initiated, in-band
 * password reset. No request body: the server generates the temporary
 * password, the admin never types one. See
 * docs/work-log/2026-09-18-admin-account-reset.md Phase 3 "API Contract"
 * for the full design this implements.
 *
 * Gate: FEATURES.ADMIN_USERS (existing key, reused per DECISION-096 — no
 * new permission key, no migration, no ADMIN_NAVIGATION change).
 *
 * Responses:
 *   401 { error } — no session.
 *   403 { error } — session lacks ADMIN_USERS.
 *   400 { error } — id === session.user.id (self-target; also hidden
 *     client-side, but never trust the UI hiding an action).
 *   404 { error } — no user row matches id.
 *   200 { success: true, password } — the plaintext, returned exactly
 *     once. This is the only response shape in this feature that ever
 *     carries it.
 *
 * The plaintext password is NEVER logged, NEVER persisted anywhere
 * (including permissionAuditLog.details, which records only
 * hadExistingPassword), and NEVER echoed back a second time.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, permissionAuditLog } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature, clearUserPermissionCache } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { generateTempPassword, hashPassword } from "@/lib/auth/password-reset";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const canManage = await hasFeature(session.user.id, FEATURES.ADMIN_USERS);
  if (!canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  if (id === session.user.id) {
    return NextResponse.json(
      { error: "You can't reset your own password here — use Forgot password from the sign-in page." },
      { status: 400 }
    );
  }

  try {
    const target = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const password = generateTempPassword();
    const hash = await hashPassword(password);

    await db
      .update(users)
      .set({ password: hash, updatedAt: new Date() })
      .where(eq(users.id, id));

    await db.insert(permissionAuditLog).values({
      userId: session.user.id,
      action: "user_password_reset",
      targetUserId: id,
      details: JSON.stringify({ hadExistingPassword: target.password !== null }),
    });

    clearUserPermissionCache(id);

    return NextResponse.json({ success: true, password });
  } catch (error) {
    // Never log `error` alongside the generated password — it isn't part of
    // the error object, but keep this handler's only console call scoped to
    // the caught error to make that invariant obvious at a glance.
    console.error("Error resetting user password:", error);
    return NextResponse.json(
      { error: "Couldn't reset the password. Try again." },
      { status: 500 }
    );
  }
}
