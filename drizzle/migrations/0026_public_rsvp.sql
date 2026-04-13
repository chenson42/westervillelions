-- Allow anonymous RSVPs (no user account required)
ALTER TABLE event_rsvps ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE event_rsvps ADD COLUMN IF NOT EXISTS rsvp_name text;
ALTER TABLE event_rsvps ADD COLUMN IF NOT EXISTS rsvp_email text;

-- Per-event guest count setting
ALTER TABLE events ADD COLUMN IF NOT EXISTS allow_guest_count boolean NOT NULL DEFAULT false;
