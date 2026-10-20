-- B-172 Increment 2a (DECISION-126/127): itemized sweep batches.
--
-- A sweep batch is one Club expense "leg" plus N Foundation income "copies",
-- one per swept gift. There is no batch table: the leg's id is the batch id.
-- Each copy points at its source gift (swept_from_txn_id) and at its leg
-- (sweep_leg_txn_id). Both pointers are written once, only by the batch
-- creator, and are RESTRICT so a referenced row can never be deleted from
-- under a batch (void deletes copies first, then the leg).
--
-- Every statement is idempotent (this file replays on every deploy).
-- Nothing here references an object created by a later migration.

ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS swept_from_txn_id uuid;
ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS sweep_leg_txn_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_txn_swept_from_fk') THEN
    ALTER TABLE ledger_transactions
      ADD CONSTRAINT ledger_txn_swept_from_fk
      FOREIGN KEY (swept_from_txn_id) REFERENCES ledger_transactions(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_txn_sweep_leg_fk') THEN
    ALTER TABLE ledger_transactions
      ADD CONSTRAINT ledger_txn_sweep_leg_fk
      FOREIGN KEY (sweep_leg_txn_id) REFERENCES ledger_transactions(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- A source gift may have at most one live (non-rejected) copy. A rejected copy
-- keeps its pointers as history and does not block a fresh sweep.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ledger_txn_swept_from_live
  ON ledger_transactions (swept_from_txn_id)
  WHERE swept_from_txn_id IS NOT NULL AND status <> 'rejected';

CREATE INDEX IF NOT EXISTS ix_ledger_txn_sweep_leg
  ON ledger_transactions (sweep_leg_txn_id)
  WHERE sweep_leg_txn_id IS NOT NULL;

-- A treasurer's decision that a Public Funds gift will never be swept
-- (for example, it was deposited straight into the Foundation's account).
CREATE TABLE IF NOT EXISTS ledger_sweep_closeouts (
  txn_id uuid PRIMARY KEY,
  reason text NOT NULL,
  closed_by_user_id uuid,
  closed_at timestamp NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_sweep_closeouts_txn_fk') THEN
    ALTER TABLE ledger_sweep_closeouts
      ADD CONSTRAINT ledger_sweep_closeouts_txn_fk
      FOREIGN KEY (txn_id) REFERENCES ledger_transactions(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_sweep_closeouts_user_fk') THEN
    ALTER TABLE ledger_sweep_closeouts
      ADD CONSTRAINT ledger_sweep_closeouts_user_fk
      FOREIGN KEY (closed_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Club expense category carried by the sweep leg (A1). Seeded INACTIVE so the
-- ordinary expense form (which lists active categories only) cannot key a
-- one-sided "Transfer to Foundation". Matched by (entity, fund kind, flow,
-- name), so it is a no-op wherever that category already exists in any state;
-- it never reactivates, renames or edits an existing row.
INSERT INTO ledger_categories (entity_id, fund_kind, flow, name, counts_as_giving, ack_not_required, is_active, sort_order)
SELECT e.id, 'activity', 'expense', 'Transfer to Foundation', false, false, false,
       COALESCE((SELECT MAX(c2.sort_order) FROM ledger_categories c2
                 WHERE c2.entity_id = e.id AND c2.fund_kind = 'activity' AND c2.flow = 'expense'), 0) + 1
FROM ledger_entities e
WHERE e.slug = 'club'
  AND NOT EXISTS (
    SELECT 1 FROM ledger_categories c
    WHERE c.entity_id = e.id
      AND c.fund_kind = 'activity'
      AND c.flow = 'expense'
      AND c.name = 'Transfer to Foundation'
  );
