-- email_queue gains a nullable attachments column
-- docs/work-log/2026-09-04-event-announcement-emails.md (Phase 3), DECISION-092
--
-- sendEmail()/sendBulkMemberEmail() are being extended to accept a MIME
-- attachments array (first consumer: the Event Announcement Emails feature's
-- .ics calendar invite). This column persists that array on the queued row so
-- the deferred admin-retry path (src/app/api/admin/email-queue/retry/route.ts,
-- which re-sends a queued row directly rather than replaying the original
-- sendEmail() call) doesn't silently drop the attachment on retry.
--
-- Nullable, no default — additive only. The ~18 existing non-attachment
-- callers and every pre-existing row are unaffected.
--
-- Idempotent and safe to run on every deploy.

ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS attachments jsonb;
