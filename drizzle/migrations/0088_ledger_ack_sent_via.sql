-- Migration 0088: sentVia on ledger acknowledgments — disambiguates "sent" into
-- "mailed a physical letter" vs. "emailed one" (docs/work-log/2026-08-12-
-- acknowledgment-letter-email.md, DECISION-087 item 3).
--
-- Idempotency: ADD COLUMN IF NOT EXISTS is a no-op on re-run. Nullable, no
-- backfill — legacy rows and any row sent before this feature shipped stay
-- NULL, honestly, rather than guessing which channel a historical row went
-- through.

ALTER TABLE ledger_acknowledgments
  ADD COLUMN IF NOT EXISTS sent_via text;
