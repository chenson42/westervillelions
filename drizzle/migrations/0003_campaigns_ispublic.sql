-- Add is_public column to campaigns table
-- Idempotent: safe to run multiple times

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true;
