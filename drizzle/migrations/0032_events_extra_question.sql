-- One optional custom question per event (e.g. "What dish are you bringing?")
ALTER TABLE events ADD COLUMN IF NOT EXISTS extra_question TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS extra_question_type TEXT NOT NULL DEFAULT 'text';
ALTER TABLE events ADD COLUMN IF NOT EXISTS extra_question_options JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS extra_question_required BOOLEAN NOT NULL DEFAULT false;

-- Per-RSVP answer
ALTER TABLE event_rsvps ADD COLUMN IF NOT EXISTS extra_answer TEXT;
