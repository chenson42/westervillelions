import { db } from "@/lib/db";
import { emailQueue } from "@/lib/db/schema";
import { and, eq, lt, or, sql } from "drizzle-orm";

/**
 * How long a row may sit at the transient `retrying` status before it's
 * treated as stranded rather than genuinely in flight.
 *
 * This project has no scheduled/cron infrastructure by design (a hosting-
 * cost constraint — see CLAUDE.md), so a stranded row can only be recovered
 * the next time something that already runs on its own — an admin visiting
 * `/admin/email-queue` or clicking "Retry Failed Emails" — happens to run.
 * The threshold only needs to be comfortably longer than any request that
 * could legitimately still be claiming the row, never longer than an admin
 * would tolerate waiting to recover a truly stuck message.
 *
 * This project sets no `maxDuration` anywhere (grepped — none), and CLAUDE.md
 * records the hosting tier was chosen specifically to avoid Vercel's paid
 * per-seat plans, i.e. the Hobby tier, whose serverless function hard limit
 * is 10 seconds. A single retry request (targeted or bulk) can only ever be
 * "genuinely in flight" for up to that 10-second wall-clock budget before
 * the platform itself kills it — at which point the row is, by definition,
 * stranded, not slow. 5 minutes is a 30x margin over that hard cap: large
 * enough that clock skew, a cold start, or an unusually slow Resend response
 * can never cause a still-live claim to be reset out from under itself (which
 * would reopen the exact duplicate-send race the atomic claim exists to
 * close), while still being short enough that a real crash is recoverable
 * within one admin session rather than requiring a manual SQL fix.
 */
export const RETRY_STALE_MINUTES = 5;

function staleRetryingCutoff(now: Date): Date {
  return new Date(now.getTime() - RETRY_STALE_MINUTES * 60 * 1000);
}

/**
 * Resets any `email_queue` row stuck at the transient `retrying` status for
 * longer than `RETRY_STALE_MINUTES` back to `failed`, clearing its claim
 * timestamp so it becomes retryable again by both retry paths.
 *
 * Exists because `settleClaim()` (src/app/api/admin/email-queue/retry/
 * route.ts) always writes a terminal status in a `try/catch` — but a JS
 * `try/catch` cannot run after a hard process death (a Vercel function
 * timeout, an instance being killed, or a deploy landing mid-request). A row
 * claimed right before that happens is left at `retrying` forever: invisible
 * to both retry paths (each requires `status = 'failed'`), invisible to all
 * three `/admin/email-queue` sections, and invisible to the failed-count
 * badge — recoverable, pre-this-fix, only by a direct SQL `UPDATE`.
 *
 * Deliberately not a cron job — this project has none by design (see
 * RETRY_STALE_MINUTES's comment). Instead this is folded into work that
 * already runs on its own: the admin-triggered bulk retry sweep
 * (`handleBulkRetry()`) and a read of `/admin/email-queue` itself, so a
 * stranded row self-heals the next time an admin does either, with no new
 * scheduled infrastructure.
 *
 * The WHERE clause's own staleness check (`retrying_at < cutoff`) is what
 * keeps this safe to call liberally: a row that is still genuinely being
 * claimed by a live request is, by construction, never older than
 * `RETRY_STALE_MINUTES` (see that constant's reasoning), so this can never
 * race a real in-flight send back to `failed` and cause a duplicate delivery
 * — it only ever touches rows a live request could not still be holding.
 *
 * Returns the number of rows reset, for callers that want to log or assert
 * on it; most callers ignore it.
 */
export async function resetStaleRetryingEmails(now: Date): Promise<number> {
  const cutoff = staleRetryingCutoff(now);
  const reset = await db
    .update(emailQueue)
    .set({ status: "failed", retryingAt: null })
    .where(and(eq(emailQueue.status, "retrying"), lt(emailQueue.retryingAt, cutoff)))
    .returning({ id: emailQueue.id });
  return reset.length;
}

/**
 * Count of email_queue rows an admin needs to know about as "not delivered
 * and needs attention" — `status = 'failed'`, plus any row stuck at the
 * transient `retrying` status past `RETRY_STALE_MINUTES` (see
 * `resetStaleRetryingEmails()`'s doc comment for why that state exists).
 *
 * A stranded `retrying` row is counted here even before something has
 * actually reset it to `failed` — this is a read-only count, not a write, so
 * it can't itself carry the same "the write never lands" risk it exists to
 * detect. The stranding hazard is a genuine risk this project has hit the
 * same shape of before (see docs/work-log/2026-09-25-email-silent-success.md
 * — a signal nobody looks at is not a signal), so this badge counts the
 * stale state directly rather than only counting rows some other code path
 * has already flipped back to `failed`.
 *
 * Backs the failed-email-count badge on the admin nav's Email Queue entry
 * (src/components/admin/admin-sidebar.tsx via src/app/(dashboard)/admin/
 * layout.tsx) — see docs/work-log/2026-09-25-email-silent-success.md Phase 6
 * follow-up #1. Both conditions filter on `status`, which
 * ix_email_queue_status (drizzle/migrations/0105_email_queue_status_index.sql)
 * indexes, so this stays cheap regardless of table growth — it runs once per
 * admin page render (the admin layout, not this page specifically).
 *
 * Deliberately NOT wrapped in React's `cache()`: this codebase has no
 * existing use of it (confirmed by grep), it's untested against this
 * project's Vitest/node test environment, and the query is already cheap
 * post-index — the dedup React.cache would buy isn't worth introducing an
 * unproven runtime dependency for. If this ever needs to be called more
 * than once per request, revisit then.
 *
 * Callers MUST gate on the same permission the /admin/email-queue page
 * itself requires (FEATURES.ADMIN_USERS) before calling this — it does not
 * check permissions itself, the same way any other db.select() in this
 * codebase doesn't.
 */
export async function getFailedEmailCount(now: Date = new Date()): Promise<number> {
  const cutoff = staleRetryingCutoff(now);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailQueue)
    .where(
      or(
        eq(emailQueue.status, "failed"),
        and(eq(emailQueue.status, "retrying"), lt(emailQueue.retryingAt, cutoff))
      )
    );
  return row?.count ?? 0;
}
