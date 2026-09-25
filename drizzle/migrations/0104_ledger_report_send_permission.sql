-- Financial Report "Send to Board" — permission (DECISION-100/101)
-- docs/work-log/2026-09-25-financial-report-auto-send.md
--
-- New key, ledger.report_send, gating the "Send to Board" action on the
-- existing /admin/ledger/reports page (already gated ledger.view — no new
-- admin nav entry, DECISION-082 untouched). Deliberately narrower than
-- ledger.record/ledger.manage, mirroring events.announce being narrower
-- than events.edit (0094_events_announce_permission.sql).
--
-- Bound to admin + treasurer only — not board_member. Sending an
-- irreversible email to the whole board is a treasury action, not a
-- read/oversight one; contrast with ledger.view's admin/treasurer/
-- board_member spread (0045_ledger_permissions.sql).
--
-- The description string below is byte-for-byte identical to
-- FEATURE_DESCRIPTIONS[FEATURES.LEDGER_REPORT_SEND] in src/lib/permissions.ts.
--
-- All statements are idempotent and safe to run on every deploy.

DO $$ BEGIN
  -- 1. Insert ledger.report_send feature
  INSERT INTO features (name, category, description)
  SELECT 'ledger.report_send', 'ledger',
    'Send the monthly financial statement to the board'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'ledger.report_send');

  -- 2. Bind ledger.report_send -> admin
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'ledger.report_send'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 3. Bind ledger.report_send -> treasurer
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'treasurer' AND f.name = 'ledger.report_send'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;
