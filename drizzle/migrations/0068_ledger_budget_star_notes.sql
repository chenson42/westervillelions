-- Star/note annotations for ledger_budgets and ledger_budget_lines
-- (DECISION-057, docs/work-log/2026-07-28-budget-star-notes.md).
-- starred: NOT NULL DEFAULT false. note: nullable, no default (null = no note).
-- App-enforced note length, no DB CHECK (DECISION-041 precedent). No index —
-- neither column participates in a hot filtered read.
ALTER TABLE ledger_budgets ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ledger_budgets ADD COLUMN IF NOT EXISTS note TEXT;

ALTER TABLE ledger_budget_lines ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ledger_budget_lines ADD COLUMN IF NOT EXISTS note TEXT;
