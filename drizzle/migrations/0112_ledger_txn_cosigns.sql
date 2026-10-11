-- Migration 0112: ledger_txn_cosigns (DECISION-117)
-- Informational, append-only co-approvals on a board-approved disbursement, keyed on the expense leg.
-- No seed data, no back-fill, no role binding.
-- Idempotent: safe to replay on every deploy.
CREATE TABLE IF NOT EXISTS ledger_txn_cosigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_id uuid NOT NULL,
  user_id uuid,
  cosigned_at timestamp NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ledger_txn_cosigns_txn_id_ledger_transactions_id_fk'
       AND conrelid = 'ledger_txn_cosigns'::regclass
  ) THEN
    ALTER TABLE ledger_txn_cosigns
      ADD CONSTRAINT ledger_txn_cosigns_txn_id_ledger_transactions_id_fk
      FOREIGN KEY (txn_id) REFERENCES ledger_transactions(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ledger_txn_cosigns_user_id_users_id_fk'
       AND conrelid = 'ledger_txn_cosigns'::regclass
  ) THEN
    ALTER TABLE ledger_txn_cosigns
      ADD CONSTRAINT ledger_txn_cosigns_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ledger_txn_cosigns_txn_user_key'
       AND conrelid = 'ledger_txn_cosigns'::regclass
  ) THEN
    ALTER TABLE ledger_txn_cosigns
      ADD CONSTRAINT ledger_txn_cosigns_txn_user_key UNIQUE (txn_id, user_id);
  END IF;
END $$;
