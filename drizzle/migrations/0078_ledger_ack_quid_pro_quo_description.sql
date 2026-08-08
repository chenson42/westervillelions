-- Migration 0078: Quid-pro-quo description on ledger acknowledgments
-- (docs/work-log/2026-08-08-acknowledgment-letter-generation.md, DECISION-073).
--
-- IRS Pub. 1771's quid-pro-quo disclosure requires a DESCRIPTION of the
-- goods/services provided to the donor, not just their fair-market value —
-- ledger_acknowledgments already had quid_pro_quo_value_cents (a number)
-- but nothing to name WHAT was provided (e.g. "one Rudolph Run 5K entry").
-- Without this column, composeAcknowledgmentLetter() can only say "goods or
-- services" generically for every quid-pro-quo letter.
--
-- 0077 is already claimed by the concurrently-shipped, unrelated
-- ledger_donors multi-email migration — this is 0078, not 0077.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS is a no-op on re-run. Nullable, no
-- backfill needed or attempted — NULL for every existing row (legacy acks
-- and any written_ack_250 ack, which never has goods/services); the
-- composer falls back to the generic phrase "goods or services" when null.

ALTER TABLE ledger_acknowledgments
  ADD COLUMN IF NOT EXISTS quid_pro_quo_description text;
