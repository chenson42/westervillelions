-- Governance Documents Permissions
-- (docs/work-log/2026-08-09-governance-document-versioning.md, DECISION-076/081)
--
-- One new permission key: documents.manage. No documents.view/read key
-- exists by design (matches minutes' precedent) — reading the current text
-- and its adopted history is open to any linked member, gated only by
-- documents.visibility (app-level, not a FEATURES key). No documents.delete
-- key: every version is a permanent, immutable row with no delete path
-- anywhere in this design.
--
-- Role bindings — no new role, both already exist as of
-- 0080_minutes_permissions.sql:
--   admin      -> documents.manage (explicit bind, matches the existing
--                 convention even though admin auto-gets every feature via
--                 getUserFeatures())
--   notetaker  -> documents.manage
--
-- All statements are idempotent and safe to run on every deploy.

DO $$ BEGIN
  -- 1. Insert documents.manage feature
  INSERT INTO features (name, category, description)
  SELECT 'documents.manage', 'documents',
    'Create document versions, review pending amendments, adopt substantive changes, and link citing minutes'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'documents.manage');

  -- 2. Bind documents.manage -> admin
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'documents.manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 3. Bind documents.manage -> notetaker
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'notetaker' AND f.name = 'documents.manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;
