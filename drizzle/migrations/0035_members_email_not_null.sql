-- Migration 0035: Enforce email NOT NULL and case-insensitive uniqueness on members
-- Pre-flight survey confirmed 0 rows with null email and 0 case-insensitive duplicates.

ALTER TABLE members ALTER COLUMN email SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS members_email_unique_ci
  ON members (lower(email));
