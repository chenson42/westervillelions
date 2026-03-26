-- Add profile_picture column to members table
ALTER TABLE members ADD COLUMN IF NOT EXISTS profile_picture TEXT;
