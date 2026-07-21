-- Bank Reconciliation inc1 (T-18) — structured check_number column on
-- ledger_transactions, plus a composite non-unique index scoped to the
-- bank account whose check series it belongs to. See DECISION-034.

ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS check_number text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'ix_ledger_txns_check_number'
  ) THEN
    CREATE INDEX ix_ledger_txns_check_number
      ON ledger_transactions (bank_account_id, check_number);
  END IF;
END $$;
