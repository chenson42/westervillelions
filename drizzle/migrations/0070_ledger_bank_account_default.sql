-- Default/Operating Bank Account (bug fix)
-- docs/work-log/2026-07-29-default-bank-account.md
--
-- Every ledger transaction should carry a bank account by construction.
-- Adds a per-entity default-account flag so dues-sync and the manual
-- transaction form can always resolve a real bank_account_id instead of
-- leaving it NULL (which made the row invisible to reconciliation).
--
-- All statements are idempotent and safe to run multiple times.

-- ─── 1. Column ───────────────────────────────────────────────────────────────

ALTER TABLE ledger_bank_accounts ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- ─── 2. Partial unique index — at most one default per entity ───────────────

CREATE UNIQUE INDEX IF NOT EXISTS ux_ledger_bank_accounts_entity_default
  ON ledger_bank_accounts (entity_id)
  WHERE is_default;

-- ─── 3. Seed: mark each entity's operating checking account as default ───────
--
-- Live data (2026-07-29):
--   Club:       "Administrative Checking" (operating, 131 posted txns) + "Petty
--               Cash" (account_type='cash', 0 posted txns) — Petty Cash must
--               NOT become default.
--   Foundation: "Foundation Checking" (only account, 172 posted txns).
--
-- Idempotent: only sets is_default=true when the entity does not already have
-- a default row, so re-running this migration never creates a second default
-- and never flips a default a human later changed via a different account.

UPDATE ledger_bank_accounts b
SET is_default = true
FROM ledger_entities e
WHERE b.entity_id = e.id
  AND e.slug = 'club'
  AND b.name = 'Administrative Checking'
  AND NOT EXISTS (
    SELECT 1 FROM ledger_bank_accounts x WHERE x.entity_id = e.id AND x.is_default
  );

UPDATE ledger_bank_accounts b
SET is_default = true
FROM ledger_entities e
WHERE b.entity_id = e.id
  AND e.slug = 'foundation'
  AND b.name = 'Foundation Checking'
  AND NOT EXISTS (
    SELECT 1 FROM ledger_bank_accounts x WHERE x.entity_id = e.id AND x.is_default
  );
