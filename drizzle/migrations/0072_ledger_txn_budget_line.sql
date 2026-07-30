-- Explicit transaction -> budget-line link (B-30, DECISION-061)
-- docs/work-log/2026-07-30-transaction-budget-line-link.md
--
-- Nullable FK from ledger_transactions to ledger_budget_lines. ON DELETE SET
-- NULL: collapsing a budget breakdown deletes its ledger_budget_lines rows;
-- a linked transaction survives as simply un-linked, never orphaned/crashing
-- (the UI warns before that happens via a ConfirmDialog, but the FK itself
-- is the safety net). No seed data, no backfill in this migration — the
-- backfill is a separate, reviewed script (scripts/backfill-budget-line-links.ts),
-- never folded into a migration that re-runs unattended on every deploy.
--
-- All statements are idempotent and safe to run multiple times.

ALTER TABLE ledger_transactions
  ADD COLUMN IF NOT EXISTS budget_line_id uuid REFERENCES ledger_budget_lines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_ledger_txns_budget_line ON ledger_transactions (budget_line_id);
