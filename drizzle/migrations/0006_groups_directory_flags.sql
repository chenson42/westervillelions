-- Add directory display flags to groups
ALTER TABLE groups ADD COLUMN IF NOT EXISTS show_in_directory BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS show_position_as_tag BOOLEAN NOT NULL DEFAULT false;

-- Board of Directors should show in directory, using position as the tag
UPDATE groups SET show_in_directory = true, show_position_as_tag = true
WHERE name = 'Board of Directors';
