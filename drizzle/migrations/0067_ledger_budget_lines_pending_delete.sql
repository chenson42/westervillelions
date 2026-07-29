-- Soft-delete-until-finalize for ledger_budget_lines (DECISION-056). Mirrors
-- 0066_ledger_budgets_pending_delete.sql at the cause-line grain.
ALTER TABLE ledger_budget_lines ADD COLUMN IF NOT EXISTS pending_delete_at TIMESTAMP;
