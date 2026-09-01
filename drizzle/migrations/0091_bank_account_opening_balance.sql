-- DECISION-091: bank accounts get their own opening balance, mirroring
-- ledger_funds.opening_balance_cents. Without it, a per-account running
-- balance can only be derived by summing that account's own transactions,
-- silently omitting whatever balance it started with before tracking began.

ALTER TABLE ledger_bank_accounts
  ADD COLUMN IF NOT EXISTS opening_balance_cents integer NOT NULL DEFAULT 0;
