-- Migration 0015: Add recurring event support to events table
-- All statements are idempotent (safe to re-run on every deploy)

ALTER TABLE events ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence_type TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence_days INTEGER[];
ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence_end_date TIMESTAMP;
