-- Failed Login Visibility: failed_login_attempts audit table.
-- Idempotent; safe to re-run on every deploy.

CREATE TABLE IF NOT EXISTS failed_login_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_email VARCHAR(255) NOT NULL,
  provider        TEXT NOT NULL,
  reason          TEXT NOT NULL,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'ix_failed_login_attempts_created_at'
  ) THEN
    CREATE INDEX ix_failed_login_attempts_created_at ON failed_login_attempts (created_at DESC);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'ix_failed_login_attempts_email'
  ) THEN
    CREATE INDEX ix_failed_login_attempts_email ON failed_login_attempts (attempted_email);
  END IF;
END $$;
