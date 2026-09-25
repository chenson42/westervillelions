import { db } from "@/lib/db";
import { emailQueue } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Count of email_queue rows currently `status = 'failed'`.
 *
 * Backs the failed-email-count badge on the admin nav's Email Queue entry
 * (src/components/admin/admin-sidebar.tsx via src/app/(dashboard)/admin/
 * layout.tsx) — see docs/work-log/2026-09-25-email-silent-success.md Phase 6
 * follow-up #1. A single `COUNT(*)` on the `status` column, which
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
export async function getFailedEmailCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailQueue)
    .where(eq(emailQueue.status, "failed"));
  return row?.count ?? 0;
}
