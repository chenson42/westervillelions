-- Migration 0111: ledger_transactions.rejected_by_user_id / rejected_at (DECISION-116)
-- Who rejected a pending disbursement and when. Nullable; no back-fill (production had 0 rejected rows on 2026-10-10).
-- Idempotent: safe to replay on every deploy.
ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS rejected_by_user_id uuid;
ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS rejected_at timestamp;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ledger_transactions_rejected_by_user_id_users_id_fk'
       AND conrelid = 'ledger_transactions'::regclass
  ) THEN
    ALTER TABLE ledger_transactions
      ADD CONSTRAINT ledger_transactions_rejected_by_user_id_users_id_fk
      FOREIGN KEY (rejected_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;
