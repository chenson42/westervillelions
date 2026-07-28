-- Labeled Cause Budget Lines (docs/work-log/2026-07-28-ledger-labeled-cause-lines.md, DECISION-047/048)
-- Relaxes B-17 Increment A's "one line per cause" rule: a treasurer can now
-- enter multiple distinctly-labeled lines under the same cause (e.g. two
-- "Hunger & Basic Needs" lines: "WARM" and "Westerville Sharing & Caring"),
-- plus at most one blank/generic line per cause.
--
-- This table has live rows in BOTH dev and production (v1.40.0 shipped,
-- seeded 2026-07-20 per docs/work-log/2026-07-27-ledger-cause-budget-lines.md).
-- Every statement below is idempotent and safe to replay on every deploy,
-- including against that populated table.

-- 1. Additive column. Fast-default path (constant DEFAULT '' on a NOT NULL
--    text column) — metadata-only on Postgres, no table rewrite, no lock
--    escalation even against the live populated table. This single statement
--    IS the backfill: every existing row becomes label='' the instant the
--    column exists, with zero explicit UPDATE loop. label='' is what makes
--    "one blank per cause" enforceable by a plain UNIQUE constraint — a
--    nullable label would let Postgres's NULL <> NULL permit unlimited
--    blank-label duplicates per cause, which is exactly what must be blocked.
ALTER TABLE ledger_budget_lines ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '';

-- 2. Drop the old (budget_id, cause) constraint the new, stricter one
--    replaces. Guarded via pg_constraint, mirroring 0063's own guard style,
--    so a replay after the constraint is already gone is a clean no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_budget_lines_budget_cause_key') THEN
    ALTER TABLE ledger_budget_lines DROP CONSTRAINT ledger_budget_lines_budget_cause_key;
  END IF;
END $$;

-- 3. Add the new, wider constraint. Guarded by IF NOT EXISTS so a replay
--    after it's already been added is a clean no-op.
--
--    Why this cannot fail against existing data: the OLD (budget_id, cause)
--    constraint was actively enforced for the entire time v1.40.0 rows were
--    written, so no two existing rows share (budget_id, cause). Statement 1
--    gives every existing row the identical value label=''. A set of rows
--    already unique on (budget_id, cause) is trivially still unique on the
--    strictly more granular (budget_id, cause, label) — adding a column
--    that is constant across the whole set cannot create a collision that
--    didn't already exist. There is no window in this three-step sequence
--    where the new constraint could reject a pre-existing row.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_budget_lines_budget_cause_label_key') THEN
    ALTER TABLE ledger_budget_lines ADD CONSTRAINT ledger_budget_lines_budget_cause_label_key UNIQUE (budget_id, cause, label);
  END IF;
END $$;
