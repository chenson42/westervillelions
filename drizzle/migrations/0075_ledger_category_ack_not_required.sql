-- Migration 0075: Ack Not Required flag for ledger_categories
-- (docs/work-log/2026-08-08-ack-not-required-flag.md).
--
-- Adds ledger_categories.ack_not_required — true marks INCOME categories
-- whose transactions never need a donor-acknowledgment letter queued
-- (listPendingAcknowledgments(), src/lib/ledger-queries.ts, excludes them
-- regardless of amount): race-entry fees, event receipts, pooled fundraiser
-- deposits, grants, and internal Club<->Foundation transfers. Distinct from
-- counts_as_giving (migration 0053), which governs OUTBOUND spend counted
-- toward philanthropy/impact reporting — this flag governs INBOUND
-- Foundation income never needing an acknowledgment in the first place.
-- Default false preserves every existing category's current behavior
-- (still queued for acknowledgment review, same as before this column
-- existed). Idempotent: safe to re-run on every deploy.

ALTER TABLE ledger_categories
  ADD COLUMN IF NOT EXISTS ack_not_required boolean NOT NULL DEFAULT false;

-- Backfill the five known Foundation income categories that recur every
-- year and will never produce a donor acknowledgment (2026-08-08 treasurer
-- request, from production data: 6 of 55 pending rows were false positives
-- from these categories). Scoped to income categories on donations-
-- deductible entities (Foundation only) — the only place this flag has any
-- effect on listPendingAcknowledgments(). "Pancake Breakfast" and
-- "Rudolph Run" income categories also exist under the Club (activity fund,
-- not donations-deductible) — deliberately NOT touched here; the entity
-- join below excludes them. Guarded so re-runs are no-ops once applied.
UPDATE ledger_categories lc
SET ack_not_required = true
FROM ledger_entities e
WHERE lc.entity_id = e.id
  AND e.donations_deductible = true
  AND lc.flow = 'income'
  AND lc.name IN (
    'Rudolph Run – Registration/Entry Fees',
    'Pancake Breakfast',
    'Fundraising events',
    'Grants received',
    'Transfer from Club'
  )
  AND lc.ack_not_required IS DISTINCT FROM true;
