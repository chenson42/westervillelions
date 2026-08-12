-- email_queue gains nullable cc/bcc — Dues Reminder Emails + treasury CC rule
-- docs/work-log/2026-08-12-dues-reminder-emails.md (Phase 3, DECISION-086)
--
-- Lets a queued message be a faithful record of what was actually sent
-- (sendEmail()'s cc/bcc options, and the new sendBulkMemberEmail() bcc).
-- Both columns are nullable with no backfill needed — every historical row
-- correctly has neither.
--
-- Idempotent: both statements are guarded with IF NOT EXISTS and touch only
-- the existing email_queue table.

ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS cc text;
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS bcc text;
