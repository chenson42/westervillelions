-- Google Group Sync Log — permission
-- docs/backlog.md B-41 (carried forward from DECISION-083's 22-area audit)
--
-- New key, sync_log.view, gating /admin/sync-log. The sync log's rows
-- include real member email addresses (added/removed/failed lists from
-- every Google Group sync run) — the same bulk-PII shape DECISION-083 fixed
-- for the newsletter subscriber list with SUBSCRIPTIONS_VIEW. The page
-- previously had only an auth() check and was a deliberately-documented
-- exception in src/lib/admin-page-feature-gates.test.ts's
-- NO_PAGE_GATE_ALLOWLIST, reachable by any admin.dashboard holder.
--
-- View-only — no separate manage/export verb, matching the "read-only
-- history" shape of the page itself.
--
-- Bound to `admin` and `board_member`, matching SUBSCRIPTIONS_VIEW's
-- precedent (0083_subscriptions_view_permission.sql) — the same two roles
-- that already hold every other PII-adjacent admin view (contact.view,
-- subscriptions.view).
--
-- The description string below is byte-for-byte identical to
-- FEATURE_DESCRIPTIONS[FEATURES.SYNC_LOG_VIEW] in src/lib/permissions.ts.
--
-- All statements are idempotent and safe to run on every deploy.

DO $$ BEGIN
  -- 1. Insert sync_log.view feature
  INSERT INTO features (name, category, description)
  SELECT 'sync_log.view', 'sync_log',
    'View Google Group sync history, including member email addresses'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'sync_log.view');

  -- 2. Bind sync_log.view -> admin
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'sync_log.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 3. Bind sync_log.view -> board_member
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'board_member' AND f.name = 'sync_log.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;
