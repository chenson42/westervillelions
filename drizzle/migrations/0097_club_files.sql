-- Club Files — schema
-- docs/work-log/2026-09-04-club-documents.md (Phase 3), DECISION-094/095
--
-- Five new tables: club_files (metadata), club_file_blobs (single-row-per-
-- file bytea, mirrors ledger_receipt_files exactly per DECISION-094 — a
-- sibling storage table, not a reuse of the Ledger's receipt storage),
-- club_file_events (many-to-many junction to events, mirrors
-- group_memberships' shape), and club_file_upload_sessions /
-- club_file_upload_chunks (the chunked-upload transport, DECISION-095 —
-- a session assembles N raw-byte chunks server-side before any durable
-- club_files/club_file_blobs row is written).
--
-- All statements idempotent and safe to run on every deploy.

CREATE TABLE IF NOT EXISTS club_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL,                          -- 'public' | 'members-only' — no CHECK (DECISION-041)
  filename TEXT NOT NULL,                             -- original name, sanitized, for Content-Disposition
  content_type TEXT NOT NULL DEFAULT 'application/pdf',
  byte_size INTEGER NOT NULL,
  storage_key TEXT NOT NULL,                          -- -> club_file_blobs.key, e.g. club-files/<uuid>/<name>
  uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-row-per-file bytea — mirrors ledger_receipt_files exactly.
CREATE TABLE IF NOT EXISTS club_file_blobs (
  key TEXT PRIMARY KEY,                               -- club-files/<uuid>/<sanitized-filename>
  content_type TEXT NOT NULL,
  bytes BYTEA NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Junction table, mirrors group_memberships' shape. Cascades both
-- directions: delete the file -> attachments vanish; delete the event ->
-- attachment vanishes but the file (and any other event's attachment of
-- it) survives.
CREATE TABLE IF NOT EXISTS club_file_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_file_id UUID NOT NULL REFERENCES club_files(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ux_club_file_events_file_event') THEN
    CREATE UNIQUE INDEX ux_club_file_events_file_event ON club_file_events(club_file_id, event_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_club_file_events_event') THEN
    CREATE INDEX ix_club_file_events_event ON club_file_events(event_id);
  END IF;
END $$;

-- One row per in-progress chunked upload. replace_file_id is set only when
-- this session is replacing an existing file's bytes (replace-in-place) —
-- null for a brand-new upload. No cron cleanup: the next init call sweeps
-- any session older than 24h that never reached status = 'complete'
-- (cascades to its chunk rows via FK).
CREATE TABLE IF NOT EXISTS club_file_upload_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  declared_size INTEGER NOT NULL,
  chunk_size INTEGER NOT NULL,
  total_chunks INTEGER NOT NULL,
  replace_file_id UUID REFERENCES club_files(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'uploading',           -- 'uploading' | 'complete' | 'failed' — no CHECK (DECISION-041)
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Composite PK (session_id, chunk_index) gives idempotent chunk upsert for
-- free — a re-PUT of the same chunk is always safe (ON CONFLICT DO UPDATE),
-- no separate unique constraint needed.
CREATE TABLE IF NOT EXISTS club_file_upload_chunks (
  session_id UUID NOT NULL REFERENCES club_file_upload_sessions(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  bytes BYTEA NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, chunk_index)
);
