-- Generalizes ledger_audit_log into the Ledger surface's one audit sink by
-- adding the target_transaction_id column its origin migration
-- (0074_ledger_category_audit.sql) already earmarked as a planned future
-- addition. Backs DECISION-099's required audit trail for a donor link
-- written through the reconciled-row lock's narrow, allowlisted
-- `donorId`-only carve-out (docs/work-log/
-- 2026-09-21-reconciled-donor-link-carveout.md).
--
-- ON DELETE SET NULL, mirroring target_category_id: if the transaction a row
-- documents is later deleted, the audit row survives (detached, not
-- deleted) with before/after still carrying the donor ids as text — an
-- audit trail that vanished when its subject was deleted would defeat the
-- point of keeping one.
--
-- No existing row is touched. ledger_audit_log has zero readers today (both
-- existing writers already tolerate a null target column), so this is
-- purely additive.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ledger_audit_log' AND column_name = 'target_transaction_id'
  ) THEN
    ALTER TABLE ledger_audit_log
      ADD COLUMN target_transaction_id UUID REFERENCES ledger_transactions(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_audit_log_transaction'
  ) THEN
    CREATE INDEX ix_ledger_audit_log_transaction ON ledger_audit_log (target_transaction_id);
  END IF;
END $$;
