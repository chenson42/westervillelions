-- Index email_queue.status (DECISION: Phase 6 follow-up on
-- docs/work-log/2026-09-25-email-silent-success.md).
--
-- The admin nav's new failed-email-count badge runs a
-- `WHERE status = 'failed'` COUNT(*) on every admin page render (see
-- src/lib/email-queue-stats.ts), on top of the three status-filtered
-- queries the /admin/email-queue page already ran. Neither had an index to
-- lean on. Adding one now, before the table grows further, keeps both
-- cheap regardless of total row count.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS is safe to re-run on every deploy.

CREATE INDEX IF NOT EXISTS ix_email_queue_status ON email_queue (status);
