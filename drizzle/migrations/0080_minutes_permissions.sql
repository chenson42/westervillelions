-- Meeting Minutes Permissions + Notetaker Role
-- (docs/work-log/2026-08-08-meeting-minutes.md, DECISION-074/075/077)
--
-- Two new permission keys: minutes.manage, minutes.delete. No minutes.view /
-- read gate exists by design (treasurer's explicit call) — reading any
-- minutes record, any kind, any status, is open to any linked member.
-- All statements are idempotent and safe to run on every deploy.
--
-- Role bindings:
--   admin      -> minutes.manage, minutes.delete (explicit bind, matches the
--                 existing convention even though admin auto-gets every
--                 feature via getUserFeatures())
--   notetaker  -> minutes.manage only (NEW role; minutes.delete stays
--                 admin-only per the treasurer's explicit instruction)

DO $$ BEGIN
  -- 1. Insert minutes.manage feature
  INSERT INTO features (name, category, description)
  SELECT 'minutes.manage', 'minutes', 'Create, edit, approve, and reopen meeting minutes'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'minutes.manage');

  -- 2. Insert minutes.delete feature
  INSERT INTO features (name, category, description)
  SELECT 'minutes.delete', 'minutes', 'Soft-delete and restore meeting minutes'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'minutes.delete');

  -- 3. Create the notetaker role.
  --    Existing sort_order sequence: admin=1, board_member=2, treasurer=3,
  --    member=4, volunteer=5, budget_committee=6 (0069_ledger_budget_permissions.sql).
  --    Inserted after budget_committee (7) rather than bumping the existing
  --    sequence — this role is a specialized permissions-only grant, not a
  --    role that needs to outrank the others in role-listing order.
  INSERT INTO roles (name, description, sort_order)
  SELECT 'notetaker', 'Notetaker — creates, edits, and approves meeting minutes', 7
  WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'notetaker');

  -- 4. Bind minutes.manage -> admin
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'minutes.manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 5. Bind minutes.delete -> admin
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'minutes.delete'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 6. Bind minutes.manage -> notetaker (no minutes.delete bind — deletion
  --    stays admin-only per the treasurer's explicit instruction)
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'notetaker' AND f.name = 'minutes.manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;
