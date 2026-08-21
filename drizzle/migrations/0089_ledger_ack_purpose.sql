-- Migration 0089: gift purpose on ledger acknowledgments — an optional,
-- treasurer-typed phrase naming what the gift was FOR, which the generated
-- acknowledgment letter folds into its confirmation sentence
-- ("...received a cash contribution of $500.00 from you in support of the 2026
-- Rudolph Run.").
--
-- See docs/work-log/2026-08-12-gift-purpose-on-acknowledgments.md.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS is a no-op on re-run (every migration
-- in this project replays on every deploy). Nullable with no backfill and no
-- default — NULL means "the treasurer didn't name a purpose", which is the
-- honest state of every acknowledgment written before this column existed, and
-- composes a letter byte-identical to today's.

ALTER TABLE ledger_acknowledgments
  ADD COLUMN IF NOT EXISTS purpose text;
