-- Budget-level "Notes & Assumptions" (Budgeting Overview/Drill-Down Restructure, DECISION-060)
-- docs/work-log/2026-07-30-budgeting-overview-restructure.md
--
-- One free-text note per (entity_id, fiscal_year), independent of
-- ledger_budget_approvals — a draft budget has no approval row at all, so
-- notes written during drafting need a home that exists before any approval
-- row does. No seed data, no backfill: every entity/FY starts with no row,
-- which is the correct empty state (the UI shows an empty, editable textarea).
--
-- All statements are idempotent and safe to run multiple times.

CREATE TABLE IF NOT EXISTS ledger_budget_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES ledger_entities(id) ON DELETE CASCADE,
  fiscal_year integer NOT NULL,
  notes text NOT NULL DEFAULT '',
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ledger_budget_notes_entity_year_key'
  ) THEN
    ALTER TABLE ledger_budget_notes
      ADD CONSTRAINT ledger_budget_notes_entity_year_key UNIQUE (entity_id, fiscal_year);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_ledger_budget_notes_entity ON ledger_budget_notes (entity_id);
