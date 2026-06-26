-- Ledger inc5: Impact Dashboard — impact.view permission
-- One new feature key: impact.view
-- All statements are idempotent and safe to run multiple times.
--
-- Role bindings:
--   impact.view → admin
--   impact.view → treasurer
--   impact.view → board_member
--
-- NOTE: member and volunteer do NOT receive this key.
-- The ledger_settings.philanthropyVisibility toggle ('board'|'members') is what
-- opens the dashboard to all signed-in members — not this permission key.

-- 1. Insert impact.view feature
INSERT INTO features (name, category, description)
SELECT 'impact.view', 'ledger', 'View the member philanthropy and community impact dashboard'
WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'impact.view');

-- 2. Bind impact.view → admin
INSERT INTO role_features (role_id, feature_id)
SELECT r.id, f.id FROM roles r CROSS JOIN features f
WHERE r.name = 'admin' AND f.name = 'impact.view'
AND NOT EXISTS (
  SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
);

-- 3. Bind impact.view → treasurer
INSERT INTO role_features (role_id, feature_id)
SELECT r.id, f.id FROM roles r CROSS JOIN features f
WHERE r.name = 'treasurer' AND f.name = 'impact.view'
AND NOT EXISTS (
  SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
);

-- 4. Bind impact.view → board_member
INSERT INTO role_features (role_id, feature_id)
SELECT r.id, f.id FROM roles r CROSS JOIN features f
WHERE r.name = 'board_member' AND f.name = 'impact.view'
AND NOT EXISTS (
  SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
);
