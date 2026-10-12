-- Migration 0113: Santa's Workshop sessions, Zeffy ingestion, worker screens, photos
-- (B-167 increment 2; DECISION-121 to 125)
-- docs/work-log/2026-10-12-santas-workshop-sessions-and-workers.md (Phase 3, Data Model)
--
-- Seven sw_ tables plus the generic zeffy_events inbound log. No seed data, no role
-- binding (0114), no personal data. No bytea: photo bytes live in the PhotoStore, these
-- tables hold opaque keys only. No CHECK constraints and no enum types (text + TypeScript
-- tuples; integrity is partial unique indexes).
--
-- Foreign keys are added inside pg_constraint-guarded DO blocks with the exact name
-- drizzle derives ({table}_{column}_{reftable}_{refcolumn}_fk), so `drizzle-kit push`
-- finds no diff. Index names and definitions match src/lib/db/schema.ts.
-- Idempotent: safe to replay on every deploy.

CREATE TABLE IF NOT EXISTS sw_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  dropoff_date date NOT NULL,
  photo_date date NOT NULL,
  pickup_date date NOT NULL,
  windows jsonb NOT NULL DEFAULT '[]'::jsonb,
  crew_closes_on date NOT NULL,
  zeffy_campaign_id text,
  zeffy_campaign_title text,
  zeffy_ticket_rate_ids text[] NOT NULL DEFAULT '{}',
  question_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  crew_code_enc text,
  crew_code_version integer NOT NULL DEFAULT 1,
  crew_paused boolean NOT NULL DEFAULT false,
  collage_token text NOT NULL,
  collage_published_at timestamptz,
  storage_folder_key text,
  storage_quota_bytes bigint NOT NULL,
  frame_art_key text NOT NULL DEFAULT 'plain',
  frame_file_prefix text NOT NULL DEFAULT '',
  frame_part_size integer NOT NULL DEFAULT 100,
  purge_personal_on date NOT NULL,
  purge_public_on date NOT NULL,
  personal_purged_at timestamptz,
  public_purged_at timestamptz,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sw_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  zeffy_payment_id text,
  source text NOT NULL,
  payment_status text,
  buyer_first_name text,
  buyer_last_name text,
  buyer_email text,
  buyer_phone text,
  amount_cents integer,
  refund_status text NOT NULL DEFAULT 'none',
  refunded_cents integer NOT NULL DEFAULT 0,
  payment_deleted boolean NOT NULL DEFAULT false,
  refund_resolution_cents integer,
  refund_resolved_at timestamptz,
  refund_resolved_by_user_id uuid,
  window_id text,
  window_label_raw text,
  buyer_answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  acknowledged boolean,
  snapshot_at timestamptz,
  manual_reason text,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sw_stuffies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  order_id uuid NOT NULL,
  zeffy_item_key text,
  name text,
  description text,
  child_first_name text,
  snack text,
  note_to_santa text,
  care_note text,
  photo_consent boolean NOT NULL DEFAULT false,
  raw_answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  attention_codes text[] NOT NULL DEFAULT '{}',
  needs_attention boolean NOT NULL DEFAULT false,
  attention_dismissed_at timestamptz,
  state text NOT NULL DEFAULT 'registered',
  tagged_at timestamptz,
  checked_in_at timestamptz,
  portrait_at timestamptz,
  picked_up_at timestamptz,
  tag_code text,
  family_token text NOT NULL,
  frame_number integer,
  frame_exported_photo_id uuid,
  withdrawn_at timestamptz,
  withdrawn_by_user_id uuid,
  withdrawn_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sw_stuffy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  stuffy_id uuid NOT NULL,
  kind text NOT NULL,
  from_state text,
  to_state text,
  tag_code text,
  prev_tag_code text,
  actor_kind text NOT NULL,
  device_id text,
  code_version integer,
  user_id uuid,
  idempotency_key uuid,
  client_taken_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sw_photos (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL,
  stuffy_id uuid,
  kind text NOT NULL,
  storage_kind text NOT NULL DEFAULT 'drive',
  storage_key text,
  thumb_storage_key text,
  content_type text,
  byte_size integer,
  thumb_byte_size integer,
  width integer,
  height integer,
  sha256 text,
  taken_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  device_id text,
  recorded_by_user_id uuid,
  superseded_at timestamptz,
  superseded_by_photo_id uuid,
  hidden_at timestamptz,
  hidden_by_user_id uuid,
  published_at timestamptz,
  purged_at timestamptz
);

CREATE TABLE IF NOT EXISTS zeffy_events (
  id text PRIMARY KEY,
  type text,
  version text,
  payment_id text,
  campaign_id text,
  session_id uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  processed_at timestamptz,
  outcome text NOT NULL DEFAULT 'received',
  error_code text,
  attempts integer NOT NULL DEFAULT 1,
  payload jsonb
);

CREATE TABLE IF NOT EXISTS sw_session_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  user_id uuid,
  kind text NOT NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sw_crew_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes (partial ones carry the same WHERE as schema.ts)
CREATE UNIQUE INDEX IF NOT EXISTS ux_sw_sessions_slug ON sw_sessions (slug);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sw_sessions_collage_token ON sw_sessions (collage_token);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sw_sessions_zeffy_campaign ON sw_sessions (zeffy_campaign_id) WHERE zeffy_campaign_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_sw_orders_payment ON sw_orders (zeffy_payment_id) WHERE zeffy_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_sw_orders_session ON sw_orders (session_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_sw_stuffies_item ON sw_stuffies (session_id, zeffy_item_key) WHERE zeffy_item_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_sw_stuffies_tag ON sw_stuffies (session_id, tag_code) WHERE tag_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_sw_stuffies_family_token ON sw_stuffies (family_token);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sw_stuffies_frame ON sw_stuffies (session_id, frame_number) WHERE frame_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_sw_stuffies_session_state ON sw_stuffies (session_id, state);
CREATE INDEX IF NOT EXISTS ix_sw_stuffies_order ON sw_stuffies (order_id);

CREATE INDEX IF NOT EXISTS ix_sw_stuffy_events_stuffy ON sw_stuffy_events (stuffy_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sw_stuffy_events_idem ON sw_stuffy_events (session_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_sw_stuffy_events_prev_tag ON sw_stuffy_events (session_id, prev_tag_code) WHERE prev_tag_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_sw_stuffy_events_device ON sw_stuffy_events (session_id, created_at);

-- One current portrait and one current check-in photo per stuffy, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sw_photos_current ON sw_photos (stuffy_id, kind) WHERE kind IN ('check_in', 'portrait') AND superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_sw_photos_session_kind ON sw_photos (session_id, kind);
CREATE INDEX IF NOT EXISTS ix_sw_photos_device ON sw_photos (session_id, device_id, created_at);
CREATE INDEX IF NOT EXISTS ix_sw_photos_stuffy ON sw_photos (stuffy_id);

CREATE INDEX IF NOT EXISTS ix_zeffy_events_campaign_received ON zeffy_events (campaign_id, received_at DESC);
CREATE INDEX IF NOT EXISTS ix_zeffy_events_payment ON zeffy_events (payment_id);
CREATE INDEX IF NOT EXISTS ix_zeffy_events_received ON zeffy_events (received_at);

CREATE INDEX IF NOT EXISTS ix_sw_session_log_session ON sw_session_log (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_sw_crew_attempts_scope ON sw_crew_attempts (scope_key, created_at);

-- Foreign keys (guarded; names equal what drizzle derives)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sw_sessions_created_by_user_id_users_id_fk' AND conrelid = 'sw_sessions'::regclass) THEN
    ALTER TABLE sw_sessions ADD CONSTRAINT sw_sessions_created_by_user_id_users_id_fk
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sw_orders_session_id_sw_sessions_id_fk' AND conrelid = 'sw_orders'::regclass) THEN
    ALTER TABLE sw_orders ADD CONSTRAINT sw_orders_session_id_sw_sessions_id_fk
      FOREIGN KEY (session_id) REFERENCES sw_sessions(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sw_orders_refund_resolved_by_user_id_users_id_fk' AND conrelid = 'sw_orders'::regclass) THEN
    ALTER TABLE sw_orders ADD CONSTRAINT sw_orders_refund_resolved_by_user_id_users_id_fk
      FOREIGN KEY (refund_resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sw_orders_created_by_user_id_users_id_fk' AND conrelid = 'sw_orders'::regclass) THEN
    ALTER TABLE sw_orders ADD CONSTRAINT sw_orders_created_by_user_id_users_id_fk
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sw_stuffies_session_id_sw_sessions_id_fk' AND conrelid = 'sw_stuffies'::regclass) THEN
    ALTER TABLE sw_stuffies ADD CONSTRAINT sw_stuffies_session_id_sw_sessions_id_fk
      FOREIGN KEY (session_id) REFERENCES sw_sessions(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sw_stuffies_order_id_sw_orders_id_fk' AND conrelid = 'sw_stuffies'::regclass) THEN
    ALTER TABLE sw_stuffies ADD CONSTRAINT sw_stuffies_order_id_sw_orders_id_fk
      FOREIGN KEY (order_id) REFERENCES sw_orders(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sw_stuffies_withdrawn_by_user_id_users_id_fk' AND conrelid = 'sw_stuffies'::regclass) THEN
    ALTER TABLE sw_stuffies ADD CONSTRAINT sw_stuffies_withdrawn_by_user_id_users_id_fk
      FOREIGN KEY (withdrawn_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sw_stuffy_events_session_id_sw_sessions_id_fk' AND conrelid = 'sw_stuffy_events'::regclass) THEN
    ALTER TABLE sw_stuffy_events ADD CONSTRAINT sw_stuffy_events_session_id_sw_sessions_id_fk
      FOREIGN KEY (session_id) REFERENCES sw_sessions(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sw_stuffy_events_stuffy_id_sw_stuffies_id_fk' AND conrelid = 'sw_stuffy_events'::regclass) THEN
    ALTER TABLE sw_stuffy_events ADD CONSTRAINT sw_stuffy_events_stuffy_id_sw_stuffies_id_fk
      FOREIGN KEY (stuffy_id) REFERENCES sw_stuffies(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sw_stuffy_events_user_id_users_id_fk' AND conrelid = 'sw_stuffy_events'::regclass) THEN
    ALTER TABLE sw_stuffy_events ADD CONSTRAINT sw_stuffy_events_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sw_photos_session_id_sw_sessions_id_fk' AND conrelid = 'sw_photos'::regclass) THEN
    ALTER TABLE sw_photos ADD CONSTRAINT sw_photos_session_id_sw_sessions_id_fk
      FOREIGN KEY (session_id) REFERENCES sw_sessions(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sw_photos_stuffy_id_sw_stuffies_id_fk' AND conrelid = 'sw_photos'::regclass) THEN
    ALTER TABLE sw_photos ADD CONSTRAINT sw_photos_stuffy_id_sw_stuffies_id_fk
      FOREIGN KEY (stuffy_id) REFERENCES sw_stuffies(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sw_photos_recorded_by_user_id_users_id_fk' AND conrelid = 'sw_photos'::regclass) THEN
    ALTER TABLE sw_photos ADD CONSTRAINT sw_photos_recorded_by_user_id_users_id_fk
      FOREIGN KEY (recorded_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sw_photos_hidden_by_user_id_users_id_fk' AND conrelid = 'sw_photos'::regclass) THEN
    ALTER TABLE sw_photos ADD CONSTRAINT sw_photos_hidden_by_user_id_users_id_fk
      FOREIGN KEY (hidden_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zeffy_events_session_id_sw_sessions_id_fk' AND conrelid = 'zeffy_events'::regclass) THEN
    ALTER TABLE zeffy_events ADD CONSTRAINT zeffy_events_session_id_sw_sessions_id_fk
      FOREIGN KEY (session_id) REFERENCES sw_sessions(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sw_session_log_session_id_sw_sessions_id_fk' AND conrelid = 'sw_session_log'::regclass) THEN
    ALTER TABLE sw_session_log ADD CONSTRAINT sw_session_log_session_id_sw_sessions_id_fk
      FOREIGN KEY (session_id) REFERENCES sw_sessions(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sw_session_log_user_id_users_id_fk' AND conrelid = 'sw_session_log'::regclass) THEN
    ALTER TABLE sw_session_log ADD CONSTRAINT sw_session_log_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;
