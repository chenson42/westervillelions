-- Migration 0077: Donor multiple email addresses
-- (docs/work-log/2026-08-08-donor-multiple-emails.md).
--
-- Treasurer request (first real use, Trucco Construction Co asked for
-- correspondence to go to two addresses): replaces ledger_donors.email
-- (nullable single text) with ledger_donors.emails (text[] NOT NULL DEFAULT
-- '{}') — a flat, unlabeled list, all addresses equal (no primary/alternate).
-- Storage + display only; no emailing is built by this migration or its
-- accompanying feature.
--
-- Array column vs. a child table: this schema already has a precedent array
-- column (events.recurrence_days, integer[], migration for the Events
-- Recurrence feature) for an unordered, unlabeled list with no per-element
-- metadata — exactly this shape. A child table (ledger_donor_emails) would
-- be the right call if emails ever needed labels, ordering, verification
-- state, or per-address audit history, but the treasurer explicitly rejected
-- labeled/primary-alternate semantics in favor of a simple list, so a child
-- table would add a join and a second CRUD surface for no behavioral gain.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS is a no-op on re-run. The backfill
-- UPDATE is guarded by `WHERE email IS NOT NULL` inside a check for the
-- `email` column's existence, so it only ever runs once (before the DROP
-- COLUMN below removes `email` for good) — on every subsequent deploy the
-- guard's EXISTS check is false and the block is skipped entirely. DROP
-- COLUMN IF EXISTS is a no-op once `email` is already gone. Verified by
-- applying this file twice in a row against the dev database (see Phase 4
-- implementer notes in the work-log) — second run produced zero errors and
-- zero row changes.

ALTER TABLE ledger_donors
  ADD COLUMN IF NOT EXISTS emails text[] NOT NULL DEFAULT '{}';

-- One-time backfill: fold the old scalar `email` into the new list before
-- dropping it. Only fires while the `email` column still exists (i.e. the
-- first time this migration runs against a given database).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ledger_donors' AND column_name = 'email'
  ) THEN
    UPDATE ledger_donors
    SET emails = ARRAY[email]
    WHERE email IS NOT NULL
      AND (emails IS NULL OR emails = '{}'::text[]);
  END IF;
END $$;

ALTER TABLE ledger_donors
  DROP COLUMN IF EXISTS email;
