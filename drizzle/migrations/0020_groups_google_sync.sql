-- Add Google Groups sync fields to groups table
ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS email_prefix text,
  ADD COLUMN IF NOT EXISTS google_group_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS google_group_sync_error text;
