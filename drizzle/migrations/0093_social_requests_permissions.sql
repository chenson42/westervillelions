-- Social Media Post Requests — permission
-- docs/work-log/2026-09-03-social-media-requests.md (Phase 3)
--
-- New key, social_requests.review, covers both viewing submitted requests
-- and recording the board's decision (matches PROPOSALS_REVIEW's precedent —
-- one role authors and decides — rather than the Ledger's
-- view/record/approve split, whose separation-of-duties reasoning is
-- money-specific and doesn't apply to a marketing request).
--
-- Bound explicitly to `admin` and `board_member`, same as
-- 0085_proposals_permissions.sql. Per that migration's own correction
-- (verified directly against production): board_member does NOT already
-- hold documents.manage/minutes.manage, so neither binding here is assumed
-- to ride along on any existing grant — each is inserted and guarded
-- independently.
--
-- The description string below is byte-for-byte identical to
-- FEATURE_DESCRIPTIONS[FEATURES.SOCIAL_REQUESTS_REVIEW] in
-- src/lib/permissions.ts.
--
-- All statements are idempotent and safe to run on every deploy.

DO $$ BEGIN
  -- 1. Insert social_requests.review feature
  INSERT INTO features (name, category, description)
  SELECT 'social_requests.review', 'social_requests', 'View and decide social media post requests'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'social_requests.review');

  -- 2. Bind social_requests.review -> admin
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'social_requests.review'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 3. Bind social_requests.review -> board_member
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'board_member' AND f.name = 'social_requests.review'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;
