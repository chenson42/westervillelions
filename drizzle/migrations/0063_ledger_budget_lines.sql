-- Cause-Tagged Budget Line Items (docs/work-log/2026-07-27-ledger-cause-budget-lines.md, B-17 Increment A)
-- Child rows under ledger_budgets (DECISION-045). A budget row is either a
-- lump sum (no children) or a cause breakdown (1+ children whose amounts sum
-- to the parent's annual_amount_cents, kept in sync by every write path).
-- No DB CHECK constraint on cause — app-layer validated against the
-- BUDGET_CAUSES taxonomy in src/lib/ledger.ts (DECISION-041 precedent).

CREATE TABLE IF NOT EXISTS ledger_budget_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id UUID NOT NULL REFERENCES ledger_budgets(id) ON DELETE CASCADE,
  cause TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Migrations re-run on every deploy. Migration 0064 supersedes this constraint
-- with the wider (budget_id, cause, label) unique key, after which the table
-- legitimately holds multiple rows per (budget_id, cause) (distinct labels).
-- Re-adding the old (budget_id, cause) constraint on a later replay would then
-- fail with a duplicate-key error (it did, once a real budget was broken down
-- into multiple same-cause labeled lines). So only add the old constraint on a
-- DB that has NOT yet migrated to the labeled model — i.e. when the newer
-- (budget_id, cause, label) constraint does not exist. On a fresh DB, 0063 runs
-- before 0064, the label key is absent, and the old key is added as before;
-- 0064 then drops it and installs the wider one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ledger_budget_lines_budget_cause_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ledger_budget_lines_budget_cause_label_key'
  ) THEN
    ALTER TABLE ledger_budget_lines
      ADD CONSTRAINT ledger_budget_lines_budget_cause_key UNIQUE (budget_id, cause);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_ledger_budget_lines_budget ON ledger_budget_lines (budget_id);
