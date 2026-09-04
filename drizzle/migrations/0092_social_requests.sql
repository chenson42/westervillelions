-- Social Media Post Requests — schema
-- docs/work-log/2026-09-03-social-media-requests.md (Phase 3)
--
-- Two tables: `social_requests` (one row per request, mutable while status is
-- 'draft'/'submitted') + append-only `social_request_decisions` (one row per
-- status transition — 'deferred' is a routine, repeatable transition, so a
-- single mutable decision-column set would silently overwrite an earlier
-- deferral's decided_at/decided_by_user_id). Mirrors the
-- proposals/proposal_decisions shape (0084_proposals.sql) with three
-- deliberate deviations: 'posted' replaces 'approved' as the terminal
-- success state, decisions carry no meeting_date/citing_minutes_id trio (an
-- operational routing decision, not a formal club commitment recorded in
-- minutes), and a new `platforms` text[] column with no Proposals analog.
--
-- No FK between this feature and proposals/proposal_decisions — no ordering
-- dependency on either; sequenced after 0091 simply by being the next free
-- migration number.
--
-- All statements are idempotent and safe to run on every deploy.

CREATE TABLE IF NOT EXISTS social_requests (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_member_id         uuid        REFERENCES members(id) ON DELETE SET NULL,
  requester_user_id           uuid        REFERENCES users(id) ON DELETE SET NULL,
  requester_name_snapshot     text,
  requester_email_snapshot    text,
  requester_phone_snapshot    text,
  status                      text        NOT NULL DEFAULT 'draft',
  platforms                   text[]      NOT NULL DEFAULT '{}',
  post_copy                   text,
  image_data_uri              text,
  link_url                    text,
  desired_post_date           date,
  notes                       text,
  submitted_at                timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS social_request_decisions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  social_request_id   uuid        NOT NULL REFERENCES social_requests(id) ON DELETE CASCADE,
  status               text        NOT NULL,
  decided_by_user_id  uuid        REFERENCES users(id) ON DELETE SET NULL,
  decided_at          timestamptz NOT NULL DEFAULT now(),
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_social_requests_requester_member') THEN
    CREATE INDEX ix_social_requests_requester_member ON social_requests(requester_member_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_social_requests_requester_user') THEN
    CREATE INDEX ix_social_requests_requester_user ON social_requests(requester_user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_social_requests_status') THEN
    CREATE INDEX ix_social_requests_status ON social_requests(status);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_social_request_decisions_request') THEN
    CREATE INDEX ix_social_request_decisions_request ON social_request_decisions(social_request_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_social_request_decisions_status') THEN
    CREATE INDEX ix_social_request_decisions_status ON social_request_decisions(status);
  END IF;
END $$;
