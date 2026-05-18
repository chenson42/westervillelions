-- 0036_event_occurrence_overrides.sql
-- Idempotent: safe to re-run on every deploy.
-- Adds per-occurrence cancellation overrides for recurring events.
-- See DECISION-001: occurrence_date is a plain DATE column (no time component).

CREATE TABLE IF NOT EXISTS event_occurrence_overrides (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  occurrence_date      DATE NOT NULL,
  cancelled_at         TIMESTAMPTZ NOT NULL,
  cancelled_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  cancellation_reason  TEXT
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_occurrence_overrides_event_id_occurrence_date_key'
      AND conrelid = 'event_occurrence_overrides'::regclass
  ) THEN
    ALTER TABLE event_occurrence_overrides
      ADD CONSTRAINT event_occurrence_overrides_event_id_occurrence_date_key
      UNIQUE (event_id, occurrence_date);
  END IF;
END $$;
