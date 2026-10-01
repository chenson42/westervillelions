-- Migration 0109: ledger_acknowledgments.donee_entity_id (DECISION-112)
-- Records WHICH ENTITY ISSUED a receipt. Nullable, write-once, no index, no cascade.
-- Idempotent: safe to replay on every deploy.

ALTER TABLE ledger_acknowledgments ADD COLUMN IF NOT EXISTS donee_entity_id uuid;

-- Constraint named exactly as drizzle-kit derives it (60 chars) so
-- `drizzle-kit push --force` finds no diff to "fix".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ledger_acknowledgments_donee_entity_id_ledger_entities_id_fk'
       AND conrelid = 'ledger_acknowledgments'::regclass
  ) THEN
    ALTER TABLE ledger_acknowledgments
      ADD CONSTRAINT ledger_acknowledgments_donee_entity_id_ledger_entities_id_fk
      FOREIGN KEY (donee_entity_id) REFERENCES ledger_entities(id);
  END IF;
END $$;

-- Backfill NULL rows only; never touches updated_at (a backfill is not an edit).
-- Replay-safe: the cross-entity move stamps kept acknowledgments, so a replay never restamps.
UPDATE ledger_acknowledgments a
   SET donee_entity_id = t.entity_id
  FROM ledger_transactions t
 WHERE a.donee_entity_id IS NULL
   AND t.id = a.donation_txn_id;
