-- Event Announcement Emails — schema
-- docs/work-log/2026-09-04-event-announcement-emails.md (Phase 3), DECISION-093
--
-- One row per member per attempted send, mirroring dues_reminders. Unlike
-- dues_reminders (whose only read pattern is per-member-latest), the
-- send-history panel for this feature wants a per-SEND aggregate view
-- ("sent to 39 of 41 on Sep 10 by J. Smith" as one line) — hence the explicit
-- batch_id column rather than grouping by sent_at equality.
--
-- Only attempted (has-email, selected) recipients get a row; skipped members
-- (no_longer_active / no_email_on_file / not_selected) appear only in the
-- POST response, never persisted — matches dues_reminders precedent.
--
-- All statements are idempotent and safe to run on every deploy.

CREATE TABLE IF NOT EXISTS event_announcements (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id         uuid        NOT NULL,
  event_id         uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  scope            text        NOT NULL, -- 'occurrence' | 'series' — never 'series' for a non-recurring event
  occurrence_date  date, -- null iff scope = 'series'
  member_id        uuid        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  sent_by_user_id  uuid        REFERENCES users(id) ON DELETE SET NULL,
  email_queue_id   uuid        REFERENCES email_queue(id) ON DELETE SET NULL,
  success          boolean     NOT NULL,
  error            text,
  note             text,
  sent_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_event_announcements_event_sent') THEN
    CREATE INDEX ix_event_announcements_event_sent ON event_announcements(event_id, sent_at);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_event_announcements_batch') THEN
    CREATE INDEX ix_event_announcements_batch ON event_announcements(batch_id);
  END IF;
END $$;
