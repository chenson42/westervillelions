-- Treasurer permission baseline (B-111, DECISION-115)
-- docs/work-log/2026-10-02-treasurer-permission-baseline.md
--
-- 1. Binds ledger.manage to the treasurer role (it was admin-only), so a
--    non-admin treasurer can do the whole job: reopen/discard reconciliations,
--    categories, settings, receipt waivers, filings, fund edits, donor delete.
-- 2. Adds the narrow key email_queue.manage (view and retry the outbound mail
--    queue), bound to admin and treasurer only. This release the Email Queue
--    consumers accept email_queue.manage OR admin.users, so existing
--    admin.users holders keep access without an inherit statement here.
-- 3. Refreshes the ledger.manage description to match what it now guards.
--
-- Description strings are byte-for-byte identical to FEATURE_DESCRIPTIONS in
-- src/lib/permissions.ts (apostrophe-free so no SQL escaping can desync them).
--
-- Narrowing treasurer later needs an explicit-DELETE migration: a runtime
-- revoke of a seeded binding is re-created on the next deploy. Never bind
-- admin.* keys to treasurer.
--
-- A missing treasurer role matches zero rows (no-op on a fresh install).
-- All statements are idempotent and safe to run on every deploy.

DO $$ BEGIN
  -- 1. Insert email_queue.manage feature
  INSERT INTO features (name, category, description)
  SELECT 'email_queue.manage', 'email_queue',
    'View the outbound email queue and retry failed messages. Password-reset links and temporary passwords are hidden'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'email_queue.manage');

  -- 2. Bind ledger.manage -> treasurer
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'treasurer' AND f.name = 'ledger.manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 3. Bind email_queue.manage -> admin
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'email_queue.manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 4. Bind email_queue.manage -> treasurer
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'treasurer' AND f.name = 'email_queue.manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;

-- 5. Descriptions (guarded so a replay changes zero rows)
UPDATE features SET description = 'Manage ledger structure and corrections: reopen or discard reconciliations, move or delete settled entries, categories, settings, receipt waivers, compliance filings, fund names and opening balances, donor deletion, and acknowledgment letter templates'
WHERE name = 'ledger.manage' AND description IS DISTINCT FROM 'Manage ledger structure and corrections: reopen or discard reconciliations, move or delete settled entries, categories, settings, receipt waivers, compliance filings, fund names and opening balances, donor deletion, and acknowledgment letter templates';

UPDATE features SET description = 'View the outbound email queue and retry failed messages. Password-reset links and temporary passwords are hidden'
WHERE name = 'email_queue.manage' AND description IS DISTINCT FROM 'View the outbound email queue and retry failed messages. Password-reset links and temporary passwords are hidden';
