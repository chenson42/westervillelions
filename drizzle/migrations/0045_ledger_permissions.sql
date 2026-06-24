-- The Ledger — feature keys and role bindings
-- Three new permission keys: ledger.view, ledger.record, ledger.manage
-- All statements are idempotent and safe to run multiple times.
--
-- Role bindings:
--   ledger.view   → admin, treasurer, board_member
--   ledger.record → admin, treasurer
--   ledger.manage → admin

DO $$ BEGIN
  -- 1. Insert ledger.view feature
  INSERT INTO features (name, category, description)
  SELECT 'ledger.view', 'ledger', 'View ledger overview, fund reports, and transaction history'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'ledger.view');

  -- 2. Insert ledger.record feature
  INSERT INTO features (name, category, description)
  SELECT 'ledger.record', 'ledger', 'Record, edit, and delete ledger transactions'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'ledger.record');

  -- 3. Insert ledger.manage feature
  INSERT INTO features (name, category, description)
  SELECT 'ledger.manage', 'ledger', 'Manage funds, budgets, entities, and opening balances'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'ledger.manage');

  -- 4. Bind ledger.view → admin
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'ledger.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 5. Bind ledger.view → treasurer
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'treasurer' AND f.name = 'ledger.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 6. Bind ledger.view → board_member
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'board_member' AND f.name = 'ledger.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 7. Bind ledger.record → admin
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'ledger.record'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 8. Bind ledger.record → treasurer
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'treasurer' AND f.name = 'ledger.record'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 9. Bind ledger.manage → admin
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'ledger.manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;
