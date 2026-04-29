-- Migration 0028: Add occurrence_date to event_rsvps for per-occurrence signup support

ALTER TABLE event_rsvps ADD COLUMN IF NOT EXISTS occurrence_date TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_rsvps_recurring
  ON event_rsvps (event_id, user_id, occurrence_date)
  WHERE occurrence_date IS NOT NULL AND user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_rsvps_non_recurring
  ON event_rsvps (event_id, user_id)
  WHERE occurrence_date IS NULL AND user_id IS NOT NULL;
