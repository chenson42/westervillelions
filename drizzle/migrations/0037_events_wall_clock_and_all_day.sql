-- Migration 0037: Add is_all_day column to events table.
-- The mode: "string" annotation on startDate, endDate, recurrenceEndDate, and
-- eventRsvps.occurrenceDate is TypeScript-only (Drizzle returns the raw Postgres
-- string instead of constructing a Date object). It emits no DDL — no SQL is
-- needed for those changes. Only the new is_all_day column requires DDL.
-- See DECISION-005 in docs/decisions.md.

ALTER TABLE events ADD COLUMN IF NOT EXISTS is_all_day boolean NOT NULL DEFAULT false;
