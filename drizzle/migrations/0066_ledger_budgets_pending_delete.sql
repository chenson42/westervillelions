-- Soft-delete-until-finalize for ledger_budgets (DECISION-052/053,
-- docs/work-log/2026-07-28-budgeting-page-redesign.md, Increment 2).
-- Nullable, no default: null = normal row; set = marked for removal, purged
-- in the same transaction as Approve & lock.
ALTER TABLE ledger_budgets ADD COLUMN IF NOT EXISTS pending_delete_at TIMESTAMP;
