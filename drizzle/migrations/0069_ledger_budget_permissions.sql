-- Budget Permissions + Budget Committee Role
-- (docs/work-log/2026-07-29-budget-permissions.md)
--
-- Two new permission keys: budget.view, budget.edit. No budget.approve —
-- lock/adopt a budget stays on the existing ledger.approve (board-only),
-- unchanged. All statements are idempotent and safe to run on every deploy.
--
-- Role bindings:
--   admin            -> budget.view, budget.edit (explicit bind, matches the
--                       existing convention even though admin auto-gets-all-
--                       features via getUserFeatures())
--   treasurer        -> budget.view, budget.edit
--   board_member     -> budget.view only (no change to edit — stays
--                       approve/lock-only via ledger.approve, unchanged)
--   budget_committee -> budget.view, budget.edit, ledger.view (NEW role;
--                       seeded with James Shively, jmshively@gmail.com)

DO $$ BEGIN
  -- 1. Insert budget.view feature
  INSERT INTO features (name, category, description)
  SELECT 'budget.view', 'budget', 'View budgets'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'budget.view');

  -- 2. Insert budget.edit feature
  INSERT INTO features (name, category, description)
  SELECT 'budget.edit', 'budget', 'Create and edit budget line items'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'budget.edit');

  -- 3. Create the budget_committee role.
  --    Existing sort_order sequence (0040_dues_tracking.sql): admin=1,
  --    board_member=2, treasurer=3, member=4, volunteer=5. Inserted after
  --    volunteer (6) rather than bumping the existing sequence — this role
  --    is a specialized permissions-only grant, not a role that needs to
  --    outrank member/volunteer in role-listing order.
  INSERT INTO roles (name, description, sort_order)
  SELECT 'budget_committee', 'Budget Committee — builds and proposes the annual budget', 6
  WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'budget_committee');

  -- 4. Bind budget.view -> admin
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'budget.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 5. Bind budget.edit -> admin
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'budget.edit'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 6. Bind budget.view -> treasurer
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'treasurer' AND f.name = 'budget.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 7. Bind budget.edit -> treasurer
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'treasurer' AND f.name = 'budget.edit'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 8. Bind budget.view -> board_member (view only — no budget.edit; board
  --    stays approve/lock-only via ledger.approve, unchanged)
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'board_member' AND f.name = 'budget.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 9. Bind budget.view -> budget_committee
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'budget_committee' AND f.name = 'budget.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 10. Bind budget.edit -> budget_committee
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'budget_committee' AND f.name = 'budget.edit'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 11. Bind ledger.view -> budget_committee (Chris's explicit choice,
  --     2026-07-29 — broader ledger context for the committee)
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'budget_committee' AND f.name = 'ledger.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;

-- 12. Seed James Shively (jmshively@gmail.com) into budget_committee.
--     If the user row doesn't exist in a given environment, the SELECT
--     returns no rows and the INSERT is silently skipped — safe and
--     idempotent (mirrors 0040_dues_tracking.sql's treasurer seed).
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u, roles r
WHERE u.email = 'jmshively@gmail.com'
  AND r.name = 'budget_committee'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = u.id AND ur.role_id = r.id
  );
