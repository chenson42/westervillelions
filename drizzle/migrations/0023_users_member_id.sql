-- Migration 0023: Move member link from members.user_id to users.member_id
-- This allows multiple user accounts to link to the same member record.
-- Fully idempotent.

-- Step 1: Add member_id to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES members(id) ON DELETE SET NULL;

-- Step 2: Migrate existing links (members.user_id → users.member_id)
UPDATE users u
SET member_id = m.id
FROM members m
WHERE m.user_id = u.id
  AND u.member_id IS NULL;

-- Step 3: Drop user_id from members
ALTER TABLE members DROP COLUMN IF EXISTS user_id;
