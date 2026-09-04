-- Event Announcement Emails — permission
-- docs/work-log/2026-09-04-event-announcement-emails.md (Phase 3)
--
-- New key, events.announce, gates sending bulk event-announcement emails to
-- active members — deliberately narrower than events.edit (editing an
-- event's fields is a materially different trust level than blasting every
-- active member's inbox). Per the User Decision in the work-log, this must
-- NOT be assumed to ride along on either role's existing events.edit grant.
--
-- Bound explicitly to `admin` and `board_member`, mirroring
-- 0093_social_requests_permissions.sql exactly.
--
-- The description string below is byte-for-byte identical to
-- FEATURE_DESCRIPTIONS[FEATURES.EVENTS_ANNOUNCE] in src/lib/permissions.ts.
--
-- All statements are idempotent and safe to run on every deploy.

DO $$ BEGIN
  -- 1. Insert events.announce feature
  INSERT INTO features (name, category, description)
  SELECT 'events.announce', 'events', 'Send event announcement emails to active members'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'events.announce');

  -- 2. Bind events.announce -> admin
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'events.announce'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- 3. Bind events.announce -> board_member
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'board_member' AND f.name = 'events.announce'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;
