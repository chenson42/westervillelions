-- Add audit column: who (admin) created this RSVP row.
-- NULL = member self-signup. Non-null = admin-created write-in or admin-added member.
-- Idempotent: IF NOT EXISTS is safe to replay on every deploy.
ALTER TABLE event_rsvps ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
