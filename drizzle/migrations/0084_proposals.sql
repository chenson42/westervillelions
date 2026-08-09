-- Project / Activity Proposals — schema
-- docs/work-log/2026-08-09-project-proposal-form.md (Phase 3, DECISION-084)
--
-- Two tables: `proposals` (one row per proposal, mutable while status is
-- 'draft'/'submitted') + append-only `proposal_decisions` (one row per
-- status transition — Deferred is a routine, repeatable transition, so a
-- single mutable decision-column set would silently overwrite an earlier
-- deferral's decided_at/decided_by_user_id). Generalizes the
-- document_versions adoption-trio shape (decided_by_user_id/decided_at/
-- citing_minutes_id) rather than inventing a new one.
--
-- Sequenced after `minutes` (0079) since proposal_decisions.citing_minutes_id
-- references it — same ordering constraint document_versions had.
--
-- All statements are idempotent and safe to run on every deploy.

CREATE TABLE IF NOT EXISTS proposals (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  proposer_member_id          uuid        REFERENCES members(id) ON DELETE SET NULL,
  proposer_user_id            uuid        REFERENCES users(id) ON DELETE SET NULL,
  proposer_name_snapshot      text,
  proposer_email_snapshot     text,
  proposer_phone_snapshot     text,
  status                      text        NOT NULL DEFAULT 'draft',
  project_name                text,
  type                        text,
  need_description            text,
  chair_name                  text,
  money_needed                text,
  estimated_cost_cents        integer,
  estimated_cost_unknown      boolean     NOT NULL DEFAULT false,
  estimated_income_cents      integer,
  estimated_income_unknown    boolean     NOT NULL DEFAULT false,
  proposed_date                date,
  proposed_date_unknown       boolean     NOT NULL DEFAULT false,
  volunteers_needed           integer,
  volunteers_needed_unknown   boolean     NOT NULL DEFAULT false,
  club_resources_needed       text,
  publicity_plan               text,
  additional_notes            text,
  submitted_at                timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proposal_decisions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id         uuid        NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  status              text        NOT NULL,
  decided_by_user_id  uuid        REFERENCES users(id) ON DELETE SET NULL,
  decided_at          timestamptz NOT NULL DEFAULT now(),
  -- Post-Phase-3 ruling: the calendar day of the board meeting that decided
  -- this, distinct from decided_at (the instant the decision was recorded).
  -- Nullable + backfillable, same reasoning as citing_minutes_id.
  meeting_date        date,
  citing_minutes_id   uuid        REFERENCES minutes(id) ON DELETE SET NULL,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_proposals_proposer_member') THEN
    CREATE INDEX ix_proposals_proposer_member ON proposals(proposer_member_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_proposals_proposer_user') THEN
    CREATE INDEX ix_proposals_proposer_user ON proposals(proposer_user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_proposals_status') THEN
    CREATE INDEX ix_proposals_status ON proposals(status);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_proposal_decisions_proposal') THEN
    CREATE INDEX ix_proposal_decisions_proposal ON proposal_decisions(proposal_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_proposal_decisions_status') THEN
    CREATE INDEX ix_proposal_decisions_status ON proposal_decisions(status);
  END IF;
END $$;
