-- Budget Line Add/Remove + Approve/Lock (docs/work-log/2026-07-27-ledger-budget-approve.md)
-- Budget approve/lock state (DECISION-043). One row per (entity_id, fiscal_year).
-- Single status-flip row, NOT an append-only event log: locking sets the
-- approval trio + status='locked'; unlocking sets the unlock trio +
-- status='unlocked'. Neither clears the other. No DB CHECK constraint on
-- status — consistent with ledger_transactions.status / ledger_reimbursements.status
-- (DECISION-041 precedent).

CREATE TABLE IF NOT EXISTS ledger_budget_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES ledger_entities(id) ON DELETE CASCADE,
  fiscal_year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'unlocked',
  approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMP,
  board_minute TEXT,
  unlocked_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  unlocked_at TIMESTAMP,
  unlock_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ledger_budget_approvals_entity_year_key'
  ) THEN
    ALTER TABLE ledger_budget_approvals
      ADD CONSTRAINT ledger_budget_approvals_entity_year_key UNIQUE (entity_id, fiscal_year);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_ledger_budget_approvals_entity ON ledger_budget_approvals (entity_id);
