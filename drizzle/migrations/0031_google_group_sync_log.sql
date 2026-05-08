-- Audit log of every Google Group sync run (manual + auto-triggered)
CREATE TABLE IF NOT EXISTS google_group_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_email TEXT NOT NULL,
  group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  triggered_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  trigger_source TEXT NOT NULL DEFAULT 'manual',
  success BOOLEAN NOT NULL,
  added JSONB NOT NULL DEFAULT '[]'::jsonb,
  removed JSONB NOT NULL DEFAULT '[]'::jsonb,
  failed JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_google_group_sync_log_created_at
  ON google_group_sync_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_google_group_sync_log_group_email
  ON google_group_sync_log (group_email, created_at DESC);
