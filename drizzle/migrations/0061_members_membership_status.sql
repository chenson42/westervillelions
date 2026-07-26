-- Prospective Members (docs/work-log/2026-07-26-prospective-members.md)
-- Adds a 3-state membership_status column. is_active remains a stored column;
-- it is maintained as a derived value (is_active = (membership_status = 'active'))
-- by every application write path — see isActiveForStatus() in src/lib/members.ts.
-- No DB-level CHECK constraint — see DECISION-041 in docs/decisions.md for why.

ALTER TABLE members ADD COLUMN IF NOT EXISTS membership_status text NOT NULL DEFAULT 'active';

-- Backfill: existing is_active=true rows are already correctly 'active' via the
-- column default. Existing is_active=false rows were "ended" under today's
-- semantics -- there is no historical signal that any of them were prospective.
UPDATE members SET membership_status = 'ended' WHERE is_active = false AND membership_status <> 'ended';
