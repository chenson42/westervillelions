-- Add date_of_birth to members table
ALTER TABLE members ADD COLUMN IF NOT EXISTS date_of_birth text;
