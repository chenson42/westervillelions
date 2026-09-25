-- Adds email_queue.retrying_at, the claim timestamp needed to recover a row
-- stranded at the transient 'retrying' status if the process that claimed it
-- dies mid-request (Vercel function timeout, instance kill, mid-request
-- deploy) before its try/catch can write a terminal status.
--
-- See docs/work-log/2026-09-25-retry-stranding.md (B-66) — the follow-up
-- flagged by qa in docs/work-log/2026-09-25-email-silent-success.md's Phase 5
-- re-verification ("retrying-row stranding").
--
-- TIMESTAMPTZ, not TIMESTAMP: this is a genuine instant used for a staleness
-- comparison against `now()`, and the 2026-09-03 security review found this
-- project's live database already stores its other `timestamp` columns as
-- `timestamptz` — matching that here avoids the exact drift the review
-- flagged, even though the pre-existing columns on this table (created_at,
-- sent_at, next_retry_at) are not being touched by this migration.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is safe to re-run on every deploy.

ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS retrying_at TIMESTAMPTZ;
