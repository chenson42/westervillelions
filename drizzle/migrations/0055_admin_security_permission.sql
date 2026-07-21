-- Failed Login Visibility: admin.security_view permission, Admin-only.
-- One new feature key: admin.security_view
-- All statements are idempotent and safe to run multiple times.
--
-- Role bindings:
--   admin.security_view → admin
--
-- Locked user decision: this data includes other members' email addresses
-- and account-security state, so it is NOT bound to treasurer or
-- board_member (unlike impact.view, which extends to those two roles).

-- 1. Insert admin.security_view feature
INSERT INTO features (name, category, description)
SELECT 'admin.security_view', 'admin', 'View failed sign-in attempts and account security events'
WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'admin.security_view');

-- 2. Bind admin.security_view → admin
INSERT INTO role_features (role_id, feature_id)
SELECT r.id, f.id FROM roles r CROSS JOIN features f
WHERE r.name = 'admin' AND f.name = 'admin.security_view'
AND NOT EXISTS (
  SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
);
