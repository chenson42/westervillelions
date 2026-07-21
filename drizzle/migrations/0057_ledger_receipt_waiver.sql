-- Transaction Receipt Upload + Waiver (DECISION-035)
-- Rename receipt_url -> receipt_storage_key (data-free: 0/147 expense rows had a
-- non-null value as of Phase 2's read-only verification) and add the three-column
-- waiver mechanism (mirrors approved_at/approved_by_user_id/rejection_reason's
-- shape already on this table).
--
-- Idempotency: the rename is guarded for both states (old name present / new name
-- already present) so this is safe whether this migration has run 0 or N times.
-- All ADD COLUMN statements use IF NOT EXISTS.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ledger_transactions' AND column_name = 'receipt_url'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ledger_transactions' AND column_name = 'receipt_storage_key'
  ) THEN
    ALTER TABLE ledger_transactions RENAME COLUMN receipt_url TO receipt_storage_key;
  END IF;
END $$;

-- Belt-and-suspenders: if neither column exists yet (fresh environment seeded
-- straight from schema.ts), make sure receipt_storage_key still gets created.
ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS receipt_storage_key text;

ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS receipt_waived_at timestamp;

ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS receipt_waived_by_user_id uuid
  REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS receipt_waiver_reason text;
