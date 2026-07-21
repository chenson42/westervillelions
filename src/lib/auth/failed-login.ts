/**
 * Failed Login Visibility — recorder, shared enums, and pure helpers.
 *
 * Single source of truth for the `provider`/`reason` string literals used by
 * both the recorder (this file, called from src/lib/auth/index.ts) and the
 * admin page (src/app/(dashboard)/admin/security/page.tsx) — do not let a
 * second, independent set of literal strings exist anywhere else.
 *
 * See docs/work-log/2026-07-21-failed-login-visibility.md (Phase 3 design
 * doc) and docs/decisions.md DECISION-033 for the full rationale.
 */

import { db } from "@/lib/db";
import { failedLoginAttempts } from "@/lib/db/schema";
import { lt } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const FAILED_LOGIN_PROVIDERS = ["credentials", "google"] as const;
export type FailedLoginProvider = (typeof FAILED_LOGIN_PROVIDERS)[number];

export const FAILED_LOGIN_REASONS = [
  "missing_credentials",
  "unknown_email",
  "no_password_set",
  "deactivated",
  "bad_password",
  "oauth_deactivated",
] as const;
export type FailedLoginReason = (typeof FAILED_LOGIN_REASONS)[number];

export const FAILED_LOGIN_REASON_LABELS: Record<FailedLoginReason, string> = {
  missing_credentials: "Missing email or password",
  unknown_email: "Unknown email address",
  no_password_set: "No password set (Google-only account)",
  deactivated: "Deactivated account (password sign-in)",
  bad_password: "Incorrect password",
  oauth_deactivated: "Deactivated account (Google sign-in)",
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_EMAIL_LENGTH = 255;
const PRUNE_WINDOW_DAYS = 90;
const PRUNE_WINDOW_MS = PRUNE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const EMPTY_EMAIL_PLACEHOLDER = "(none provided)";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Trims, caps at 255 characters, and falls back to a placeholder for
 * null/undefined/empty/whitespace-only input.
 *
 * Does NOT escape or strip HTML/script-like characters — storage is plain
 * text. The admin page must render this value as plain text (default JSX
 * interpolation), never via `dangerouslySetInnerHTML`, to avoid a
 * stored-XSS-via-audit-log risk on this unauthenticated, attacker-controlled
 * input.
 */
export function normalizeAttemptedEmail(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) return EMPTY_EMAIL_PLACEHOLDER;
  return trimmed.slice(0, MAX_EMAIL_LENGTH);
}

/**
 * Pure — the cutoff instant before which rows should be pruned. Exported and
 * unit-tested standalone so prune correctness doesn't depend on a DB
 * connection or Postgres interval-syntax behavior.
 */
export function pruneCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - PRUNE_WINDOW_MS);
}

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget. MUST NEVER throw into the caller — authorize()/signIn
 * must see zero effect from this call succeeding or failing, regardless of
 * DB availability. Independent of the existing lastLoginAt/auto-link/
 * admin-notify IIFE in src/lib/auth/index.ts's jwt callback — a bug in one
 * must never touch the other.
 *
 * Also opportunistically prunes rows older than the 90-day retention window
 * on every call, so the table never grows unbounded even if the admin never
 * opens /admin/security. No cron/worker infra exists in this project; this
 * is the agreed piggyback-on-insert pattern (Architect Ruling 3 / DECISION-033).
 */
export function recordFailedLogin(params: {
  attemptedEmail: string | null | undefined;
  provider: FailedLoginProvider;
  reason: FailedLoginReason;
  userId?: string | null;
}): void {
  (async () => {
    try {
      await db.insert(failedLoginAttempts).values({
        attemptedEmail: normalizeAttemptedEmail(params.attemptedEmail),
        provider: params.provider,
        reason: params.reason,
        userId: params.userId ?? null,
      });
      await db
        .delete(failedLoginAttempts)
        .where(lt(failedLoginAttempts.createdAt, pruneCutoff()));
    } catch {
      // Swallow — recording must never affect the sign-in response.
    }
  })();
}
