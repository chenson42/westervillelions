-- Add is_active column to users table for account deactivation
-- Idempotent: safe to run multiple times

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
