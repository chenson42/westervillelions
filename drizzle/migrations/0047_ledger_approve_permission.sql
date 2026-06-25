-- The Ledger — ledger.approve permission (Increment 2: Controls)
-- One new feature key: ledger.approve
-- All statements are idempotent and safe to run multiple times.
--
-- Role bindings:
--   ledger.approve → admin
--   ledger.approve → board_member

DO $$ BEGIN
  -- 1. Insert ledger.approve feature
  INSERT INTO features (name, category, description)
  SELECT 'ledger.approve', 'ledger', 'Approve and reject pending disbursements and reimbursements'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'ledger.approve');

  -- 2. Bind ledger.approve → admin
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'ledger.approve'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 3. Bind ledger.approve → board_member
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'board_member' AND f.name = 'ledger.approve'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;
