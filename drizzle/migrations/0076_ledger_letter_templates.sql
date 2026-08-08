-- Migration 0076: Acknowledgment letter template (singleton)
-- (docs/work-log/2026-08-08-acknowledgment-letter-generation.md, DECISION-072).
--
-- Creates ledger_letter_templates, a singleton row holding the treasurer-
-- editable "warmth" slots of a Pub. 1771 gift-acknowledgment letter
-- (greeting, body, closing, signature name/title). This table deliberately
-- has NO column for the IRS-required substantiation text (entity name, EIN,
-- amount, date, no-goods-or-services / quid-pro-quo statement) — that text
-- is generated in code by composeAcknowledgmentLetter()
-- (src/lib/ledger-acknowledgment-letter.ts), never stored here. See the
-- table's comment in src/lib/db/schema.ts for the full rationale.
--
-- Idempotency: CREATE TABLE IF NOT EXISTS is a no-op on re-run. The seed
-- INSERT is guarded by WHERE NOT EXISTS (SELECT 1 FROM
-- ledger_letter_templates) — it only ever fires once, the first time this
-- migration runs against a given database. On every subsequent deploy or
-- `pnpm dev` start, the guard is false and the INSERT is skipped, so a
-- treasurer's edited wording (via PATCH .../letter-template) is never
-- overwritten by a later run of this file. This is the exact seed idiom
-- already used for the ledger_settings singleton
-- (drizzle/migrations/0044_ledger_books.sql).

CREATE TABLE IF NOT EXISTS ledger_letter_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  greeting text NOT NULL DEFAULT 'Dear {{donorName}},',
  body_text text NOT NULL DEFAULT 'On behalf of the Westerville Lions Club Foundation, thank you for your generous gift. Your support helps us carry out our mission of serving the Westerville community and beyond — from youth scholarships to hunger relief to disaster response. Gifts like yours make that work possible.',
  closing text NOT NULL DEFAULT 'With gratitude,',
  signature_name text NOT NULL DEFAULT '',
  signature_title text NOT NULL DEFAULT 'Treasurer, Westerville Lions Club Foundation',
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);

-- Seed the single default row. Starter wording matches
-- src/lib/db/schema.ts's own column default for body_text (kept identical
-- here so a fresh DB seeded via this migration and a fresh DB seeded via
-- `drizzle-kit push` from schema.ts alone produce the same starting text).
INSERT INTO ledger_letter_templates (
  greeting,
  body_text,
  closing,
  signature_name,
  signature_title
)
SELECT
  'Dear {{donorName}},',
  'On behalf of the Westerville Lions Club Foundation, thank you for your generous gift. Your support helps us carry out our mission of serving the Westerville community and beyond — from youth scholarships to hunger relief to disaster response. Gifts like yours make that work possible.',
  'With gratitude,',
  '',
  'Treasurer, Westerville Lions Club Foundation'
WHERE NOT EXISTS (SELECT 1 FROM ledger_letter_templates);
