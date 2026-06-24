-- Annual Membership Dues — feature keys and role bindings
-- All statements are idempotent and safe to run multiple times.

DO $$ BEGIN
  -- 1. Insert dues.view feature
  INSERT INTO features (name, category, description)
  SELECT 'dues.view', 'dues', 'View annual membership dues status and payment history'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'dues.view');

  -- 2. Insert dues.manage feature
  INSERT INTO features (name, category, description)
  SELECT 'dues.manage', 'dues', 'Record, edit, and delete dues payments; configure annual dues amounts'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'dues.manage');

  -- 3. Bind dues.view → admin
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'dues.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 4. Bind dues.view → board_member
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'board_member' AND f.name = 'dues.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 5. Bind dues.view → treasurer
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'treasurer' AND f.name = 'dues.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 6. Bind dues.manage → admin
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'dues.manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 7. Bind dues.manage → treasurer
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'treasurer' AND f.name = 'dues.manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;
