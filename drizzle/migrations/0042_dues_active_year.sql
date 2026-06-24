-- Migration 0042: Add is_active column to dues_settings for the "active fiscal year" feature.
--
-- The active fiscal year is the default shown on all dues surfaces when no explicit
-- ?fy= param is present. Only one row may be active at a time, enforced by the
-- partial unique index below.
--
-- All statements are idempotent — safe to re-run on every deploy.

-- 1. Add column
ALTER TABLE dues_settings ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false;

-- 2. Partial unique index: at most one row can have is_active = true.
--    The WHERE clause restricts the index to rows where is_active is true,
--    so the uniqueness constraint only fires when two rows try to be active.
CREATE UNIQUE INDEX IF NOT EXISTS ux_dues_settings_active
  ON dues_settings (is_active)
  WHERE is_active = true;

-- 3. Seed FY2026 as active ONLY if no row is currently active.
--    CRITICAL: must NOT override a later user choice on re-run.
--    Uses an UPDATE (not INSERT) because the FY2026 row was already seeded in 0040.
UPDATE dues_settings
SET is_active = true
WHERE fiscal_year = 2026
  AND NOT EXISTS (SELECT 1 FROM dues_settings WHERE is_active = true);
