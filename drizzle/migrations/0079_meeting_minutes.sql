-- Meeting Minutes — schema (docs/work-log/2026-08-08-meeting-minutes.md)
-- DECISION-074/075 (architect), DECISION-077 (tech-lead), DECISION-079
-- (Phase 4 loop-back — attendance is a single present-count integer, not a
-- per-member roster table), and a further Phase 4 increment (2026-08-09)
-- adding notetaker_member_id / notetaker_name_snapshot — the notetaker OF
-- RECORD, distinct from author_user_id (data-entry attribution only).
--
-- One parent table (minutes) + two child tables (motions, action items).
-- Deliberately NOT part of the ledger_* family — minutes shares no tables,
-- permission keys, or audience boundary with the Ledger. Permission keys
-- (minutes.manage / minutes.delete) and the notetaker ROLE (an admin-
-- assignable permission grant, unrelated to the notetaker_member_id COLUMN
-- added here — same word, two different concepts) are a separate migration:
-- 0080_minutes_permissions.sql.
--
-- This file was amended in place for DECISION-079 and again for the
-- notetaker-of-record addition, not followed up with separate migrations —
-- it had never been committed to git as of either change (confirmed via
-- `git ls-files`/`git log` each time) and therefore never shipped to any
-- deployed database. There is no production state to migrate away from;
-- this IS the first version anyone will ever run. A `minutes_attendance`
-- child table (roster checklist, member_id FK, member_name_snapshot)
-- existed in an earlier draft of this same file — the treasurer clarified
-- the actual requirement was "a single count number for attendance," not a
-- per-member roster fact, so it was removed outright rather than
-- deprecated. See `present_count` below.
--
-- All statements are idempotent and safe to run on every deploy.

-- ─── 1. Tables ───────────────────────────────────────────────────────────────

-- kind: open-ended text, DECISION-041 pattern, no DB CHECK/enum — validated
--   against MINUTES_KINDS in src/lib/minutes.ts. Adding a new kind (e.g. a
--   new ad hoc committee) must never require a migration.
-- meeting_date: `date`, NOT `timestamp` — deliberate. NOT copied from
--   event_rsvps.occurrence_date, which is a naive timestamp column with a
--   known, previously-tripped-over bug (wall-clock time silently read back as
--   UTC). A minutes record belongs to a calendar day, not a wall-clock
--   instant — same reasoning DECISION-001 used for
--   event_occurrence_overrides.occurrence_date. Do NOT change this to
--   timestamp later.
-- present_count: a single headcount of members present, nullable (a record
--   may legitimately not capture a count at all) — DECISION-079. Deliberately
--   NOT a members FK or a child table; "attendance should have nothing to do
--   with members records," the treasurer's own words, taken literally.
-- notetaker_member_id / notetaker_name_snapshot: the notetaker OF RECORD —
--   who took the minutes — distinct from author_user_id below (data-entry
--   attribution only, never displayed). Same nullable-FK + name-snapshot
--   SHAPE as the removed minutes_attendance design got right: member_id is
--   nullable with ON DELETE SET NULL so a hard member-delete degrades
--   gracefully; the snapshot is written once at create/update time from the
--   submitted payload and is NEVER recomputed from, or invalidated by, the
--   current roster — a notetaker who later resigns still shows as the
--   notetaker of that meeting, forever. Both columns are nullable (unlike
--   the old minutes_attendance.member_name_snapshot's NOT NULL) because the
--   notetaker field itself is optional on every row, not just the FK half of
--   an always-populated child row — historical minutes entered later may
--   have no clear record of who took them.
-- pending_delete_at: column SHAPE reused from ledger_budgets.pending_delete_at
--   (nullable timestamp, flag-flip, restorable) — the PURGE-on-finalize
--   behavior is explicitly NOT reused. Minutes are a permanent governance
--   record; nothing in this app ever purges a soft-deleted minutes row.
CREATE TABLE IF NOT EXISTS minutes (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                    text        NOT NULL,
  event_id                uuid        REFERENCES events(id) ON DELETE SET NULL,
  meeting_date            date        NOT NULL,
  status                  text        NOT NULL DEFAULT 'draft',
  title                   text,
  present_count           integer,
  notetaker_member_id     uuid        REFERENCES members(id) ON DELETE SET NULL,
  notetaker_name_snapshot text,
  body_markdown           text,
  author_user_id          uuid        REFERENCES users(id) ON DELETE SET NULL,
  approved_by_user_id     uuid        REFERENCES users(id) ON DELETE SET NULL,
  approved_at             timestamptz,
  pending_delete_at       timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Additive, for any environment that already ran an earlier version of this
-- migration (pre-DECISION-079 / pre-notetaker) where `minutes` existed
-- without these columns — CREATE TABLE IF NOT EXISTS above is a no-op
-- against an existing table.
ALTER TABLE minutes ADD COLUMN IF NOT EXISTS present_count integer;
ALTER TABLE minutes ADD COLUMN IF NOT EXISTS notetaker_member_id uuid REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE minutes ADD COLUMN IF NOT EXISTS notetaker_name_snapshot text;

-- mover_name / seconder_name: free text, NOT a members FK — a mover/seconder
--   can be a guest, and this club has no stated need to query motions by
--   member identity.
CREATE TABLE IF NOT EXISTS minutes_motions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  minutes_id     uuid        NOT NULL REFERENCES minutes(id) ON DELETE CASCADE,
  text           text        NOT NULL,
  mover_name     text        NOT NULL,
  seconder_name  text,
  result         text        NOT NULL DEFAULT 'passed',
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- owner_name: free text — same reasoning as minutes_motions.mover_name above.
CREATE TABLE IF NOT EXISTS minutes_action_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  minutes_id   uuid        NOT NULL REFERENCES minutes(id) ON DELETE CASCADE,
  text         text        NOT NULL,
  owner_name   text        NOT NULL,
  due_date     date,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── 2. Indexes ───────────────────────────────────────────────────────────────
-- No unique(kind, meeting_date) on `minutes` — two sets of minutes for one
-- meeting (a split session, or a re-do) must be representable. DECISION-077 §9.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_minutes_kind') THEN
    CREATE INDEX ix_minutes_kind ON minutes(kind);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_minutes_meeting_date') THEN
    CREATE INDEX ix_minutes_meeting_date ON minutes(meeting_date);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_minutes_event') THEN
    CREATE INDEX ix_minutes_event ON minutes(event_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_minutes_status') THEN
    CREATE INDEX ix_minutes_status ON minutes(status);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_minutes_notetaker') THEN
    CREATE INDEX ix_minutes_notetaker ON minutes(notetaker_member_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_minutes_motions_minutes') THEN
    CREATE INDEX ix_minutes_motions_minutes ON minutes_motions(minutes_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_minutes_action_items_minutes') THEN
    CREATE INDEX ix_minutes_action_items_minutes ON minutes_action_items(minutes_id);
  END IF;
END $$;
