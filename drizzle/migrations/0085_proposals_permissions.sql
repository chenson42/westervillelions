-- Project / Activity Proposals — permission
-- docs/work-log/2026-08-09-project-proposal-form.md (Phase 3, DECISION-084)
--
-- New key, proposals.review, covers both viewing submitted proposals and
-- recording the board's decision (matches DOCUMENTS_MANAGE's precedent —
-- one role authors and adopts — rather than the Ledger's view/record/approve
-- split, whose separation-of-duties reasoning is money-specific).
--
-- CORRECTION (Phase 3, verified directly against production): board_member
-- does NOT already hold documents.manage/minutes.manage — those are admin +
-- notetaker only. This migration binds proposals.review explicitly to
-- `admin` and `board_member`. No other role is touched, and no binding is
-- assumed to ride along on any existing grant.
--
-- The description string below is byte-for-byte identical to
-- FEATURE_DESCRIPTIONS[FEATURES.PROPOSALS_REVIEW] in src/lib/permissions.ts.
--
-- All statements are idempotent and safe to run on every deploy.

DO $$ BEGIN
  -- 1. Insert proposals.review feature
  INSERT INTO features (name, category, description)
  SELECT 'proposals.review', 'proposals', 'View and decide project/activity proposals'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'proposals.review');

  -- 2. Bind proposals.review -> admin
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'proposals.review'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 3. Bind proposals.review -> board_member
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'board_member' AND f.name = 'proposals.review'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;
