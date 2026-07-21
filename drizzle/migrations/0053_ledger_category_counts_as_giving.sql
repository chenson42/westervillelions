-- Migration 0053: True-Gifts predicate for philanthropy/impact reporting
-- Adds ledger_categories.counts_as_giving — false marks categories whose
-- spend is operational/fundraising overhead, excluded from philanthropy
-- reporting (/members/impact) even when the txn's fund kind is otherwise
-- giving-eligible (activity/charitable/scholarship). See DECISION-030.
-- Idempotent: safe to re-run on every deploy.

ALTER TABLE ledger_categories
  ADD COLUMN IF NOT EXISTS counts_as_giving boolean NOT NULL DEFAULT true;

-- Flag known operational/fundraising-overhead categories false, across all
-- entities. Guarded so re-runs are no-ops once applied.
UPDATE ledger_categories
SET counts_as_giving = false
WHERE flow = 'expense'
  AND name IN ('Fundraising event costs', 'Operations', 'Insurance & bonding')
  AND counts_as_giving IS DISTINCT FROM false;
