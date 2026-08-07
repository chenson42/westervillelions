-- Membership Type (docs/work-log/2026-08-07-membership-categories.md)
-- Adds membership_type: the LCI membership TYPE (Active, Member at Large, Honorary, Privileged,
-- Life Member, Associate Member, Affiliate Member) — orthogonal to membership_status (club
-- standing) and dues_category (billing rate). See src/lib/members.ts MEMBERSHIP_TYPES for the
-- closed taxonomy. No DB CHECK constraint — app-layer enforcement only (DECISION-041 precedent).

ALTER TABLE members ADD COLUMN IF NOT EXISTS membership_type text NOT NULL DEFAULT 'active';

-- One-time backfill: every existing row that has never been touched by this migration gets
-- 'active'. The guard is NOT "membership_type IS NULL" (the column is NOT NULL with a DEFAULT, so
-- ADD COLUMN already back-fills every existing row to 'active' in the same statement above — there
-- is never a null to find). Instead this UPDATE is a documented no-op after its first successful
-- run: on a fresh column, every row is already 'active' (from the column default), so
-- "WHERE membership_type IS NULL" matches zero rows; a re-run after a treasurer has since
-- hand-corrected some rows to 'life_member'/'honorary'/etc. also matches zero of THOSE rows,
-- because a hand-corrected row is by definition not null. This mirrors
-- 0061_members_membership_status.sql's own backfill shape (an UPDATE guarded by a condition, run
-- unconditionally on every deploy, safe because it can only ever act on rows still in their
-- just-defaulted state).
UPDATE members SET membership_type = 'active' WHERE membership_type IS NULL;
