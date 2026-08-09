-- Newsletter Subscribers permission — subscriptions.view
-- (docs/work-log/2026-08-09-governance-document-versioning.md, Phase 4
-- loop-back 2 — security fix + admin-page audit)
--
-- /admin/subscriptions previously reused contact.view to gate the newsletter
-- subscriber list (name + email for every subscriber) — a different, and
-- more sensitive, bulk-PII dataset than contact-form submissions, which is
-- what contact.view was actually seeded to describe ("View contact form
-- submissions", migration 0007). This is the same "wrong key, not missing
-- key" pattern DECISION-082 already found and fixed once for
-- /admin/members vs /admin/membership. subscriptions.view is a new,
-- additive key — contact.view is untouched everywhere, including on
-- /admin/contact.
--
-- Bound to exactly the two roles that already held contact.view (and were
-- therefore the only non-admin roles that could legitimately reach
-- /admin/subscriptions before this key existed): admin, board_member. This
-- is a like-for-like swap, not a widening or narrowing of who has access.
--
-- All statements are idempotent and safe to run on every deploy.

DO $$ BEGIN
  -- 1. Insert subscriptions.view feature
  INSERT INTO features (name, category, description)
  SELECT 'subscriptions.view', 'subscriptions', 'View the newsletter subscriber list and export subscribers'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'subscriptions.view');

  -- 2. Bind subscriptions.view -> admin (explicit bind, matches the existing
  --    convention even though admin auto-gets every feature via getUserFeatures())
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'subscriptions.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 3. Bind subscriptions.view -> board_member
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'board_member' AND f.name = 'subscriptions.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;
