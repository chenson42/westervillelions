-- B-172 Increment 1 (DECISION-126/127): a Club Public Funds income category may
-- declare the Foundation charitable income category its gifts become when swept.
--
-- Every statement is idempotent (this file replays on every deploy).
-- No index: ledger_categories holds about 100 rows.

ALTER TABLE ledger_categories ADD COLUMN IF NOT EXISTS mirrors_category_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ledger_categories_mirror_fk'
  ) THEN
    ALTER TABLE ledger_categories
      ADD CONSTRAINT ledger_categories_mirror_fk
      FOREIGN KEY (mirrors_category_id) REFERENCES ledger_categories(id) ON DELETE SET NULL;
  END IF;
END $$;

-- One-shot mirror seed. A plain by-name UPDATE would re-link on every deploy a
-- pair the treasurer later cleared, so the whole seed runs once, guarded by a
-- marker row in ledger_audit_log (both targets null). The marker is written
-- even when a pair is missing: a category created later is linked by the
-- treasurer on the category screen. Pairs are matched by lower-cased name:
-- Public donations and White Cane only; contested pairs are left unlinked.
-- When several active Foundation categories share a name, the lowest
-- sort_order (then id) wins.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ledger_audit_log WHERE action = 'category_mirrors_seeded') THEN
    UPDATE ledger_categories c
    SET mirrors_category_id = (
      SELECT f.id
      FROM ledger_categories f
      JOIN ledger_entities fe ON fe.id = f.entity_id
      WHERE fe.slug = 'foundation'
        AND f.fund_kind = 'charitable'
        AND f.flow = 'income'
        AND f.is_active = true
        AND lower(f.name) = lower(c.name)
      ORDER BY f.sort_order, f.id
      LIMIT 1
    )
    FROM ledger_entities ce
    WHERE ce.id = c.entity_id
      AND ce.slug = 'club'
      AND c.fund_kind = 'activity'
      AND c.flow = 'income'
      AND lower(c.name) IN ('public donations', 'white cane')
      AND c.mirrors_category_id IS NULL;

    INSERT INTO ledger_audit_log (action, details)
    VALUES ('category_mirrors_seeded', 'Migration 0115: one-shot by-name seed of Public Funds category mirrors.');
  END IF;
END $$;
