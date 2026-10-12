-- Santa's Workshop permission (B-167 increment 2, DECISION-121)
-- docs/work-log/2026-10-12-santas-workshop-sessions-and-workers.md
--
-- Adds santas_workshop.manage and binds it to admin and board_member ONLY, using the
-- canonical CROSS JOIN + NOT EXISTS idiom (model: 0093, 0110) that
-- src/lib/default-role-bundles.test.ts parses. Never bind it to treasurer or member, and
-- never to an admin.* key: holders see registrants' names, emails and phone numbers.
--
-- The description is byte-for-byte identical to FEATURE_DESCRIPTIONS in
-- src/lib/permissions.ts (apostrophe-free so no SQL escaping can desync them).
-- A missing role matches zero rows (no-op on a fresh install).
-- Existing board members must sign out and in after deploy (features load at sign-in).
-- All statements are idempotent and safe to run on every deploy.

DO $$ BEGIN
  INSERT INTO features (name, category, description)
  SELECT 'santas_workshop.manage', 'santas_workshop',
    'Manage the Santa Workshop photo event: sessions, Zeffy registrations and parent contacts, worker access, photo review and publishing, frame export, and data purge'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'santas_workshop.manage');

  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'santas_workshop.manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'board_member' AND f.name = 'santas_workshop.manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;

UPDATE features SET description = 'Manage the Santa Workshop photo event: sessions, Zeffy registrations and parent contacts, worker access, photo review and publishing, frame export, and data purge'
WHERE name = 'santas_workshop.manage' AND description IS DISTINCT FROM 'Manage the Santa Workshop photo event: sessions, Zeffy registrations and parent contacts, worker access, photo review and publishing, frame export, and data purge';
