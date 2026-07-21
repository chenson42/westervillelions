-- Impact Gift Public Note: treasurer-curated, member-facing annotation on
-- ledger_transactions, distinct from the fully-internal memo field.
-- Single nullable text column, no backfill, no FK. Idempotent.
ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS public_note text;
