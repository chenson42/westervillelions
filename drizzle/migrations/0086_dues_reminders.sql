-- Dues Reminder Emails — dues_reminders table
-- docs/work-log/2026-08-12-dues-reminder-emails.md (Phase 3, DECISION-085/086)
--
-- One row per member per send attempt of a dues reminder email. Answers
-- "when was THIS member last reminded for THIS fiscal year" without a
-- fragile join against email_queue's free-text `to` column (email_queue has
-- no memberId/fiscalYear of its own — it's a delivery log, not a domain
-- record). `cohort`/`success`/`error`/`note` are deliberate additions beyond
-- Phase 2's minimum column list, settled in Phase 3 — see the schema.ts
-- comment above the `duesReminders` table for the full rationale.
--
-- sent_at is timestamptz — the current, deliberate convention for new
-- tables (matches 0084_proposals.sql / 0085's proposals + proposal_decisions
-- tables, confirmed live on DEV as `timestamp with time zone`). Not
-- reproducing the older minutes-table drift where schema.ts declares a
-- naive timestamp but the live column is actually timestamptz.
--
-- All statements are idempotent and safe to run on every deploy.

CREATE TABLE IF NOT EXISTS dues_reminders (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id             uuid        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  fiscal_year           integer     NOT NULL,
  cohort                text        NOT NULL, -- 'unpaid' | 'partial' — which template variant was actually sent
  sent_by_user_id       uuid        REFERENCES users(id) ON DELETE SET NULL,   -- who clicked Send
  signed_as_member_id   uuid        REFERENCES members(id) ON DELETE SET NULL, -- resolved Treasurer at send time
  email_queue_id        uuid        REFERENCES email_queue(id) ON DELETE SET NULL,
  success               boolean     NOT NULL,
  error                 text,
  note                  text,       -- the treasurer's optional per-send free-text note, verbatim
  sent_at               timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_dues_reminders_member_fy') THEN
    CREATE INDEX ix_dues_reminders_member_fy ON dues_reminders(member_id, fiscal_year);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_dues_reminders_fy_sent') THEN
    CREATE INDEX ix_dues_reminders_fy_sent ON dues_reminders(fiscal_year, sent_at);
  END IF;
END $$;
