-- Club Files — permission
-- docs/work-log/2026-09-04-club-documents.md (Phase 3), User Decision 4
--
-- One new key, club_files.manage, covering create, edit metadata, replace
-- bytes, attach/detach events, and delete. No club_files.view/read key —
-- reading is either fully public (public-tagged files, unauthenticated) or
-- gated only by "any linked member" (members-only files), matching the
-- documents.manage/minutes.manage precedent; the download route enforces
-- visibility itself, per Phase 1's adversarial-pass ruling.
--
-- Bound to `admin` ONLY — deliberately narrower than
-- proposals.review/social_requests.review's admin + board_member default,
-- matching documents.manage/welcome_packet.manage's precedent instead. Do
-- NOT add a board_member (or any other role) bind here without revisiting
-- the User Decision in the work-log.
--
-- The description string below is byte-for-byte identical to
-- FEATURE_DESCRIPTIONS[FEATURES.CLUB_FILES_MANAGE] in src/lib/permissions.ts.
--
-- All statements are idempotent and safe to run on every deploy.

DO $$ BEGIN
  -- 1. Insert club_files.manage feature
  INSERT INTO features (name, category, description)
  SELECT 'club_files.manage', 'club_files',
    'Upload, edit, attach to events, and delete club files'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'club_files.manage');

  -- 2. Bind club_files.manage -> admin ONLY. Do not add a board_member (or
  --    any other role) bind here without revisiting the User Decision in
  --    docs/work-log/2026-09-04-club-documents.md.
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'club_files.manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;
