-- Event Images — Site Review Fixes Batch 3
-- docs/work-log/2026-09-04-site-review-fixes.md
--
-- New table event_images: bytes for admin-uploaded event banner images,
-- served via GET /api/public/events/[id]/image. A sibling byte store
-- alongside ledger_receipt_files / club_file_blobs (DECISION-094's spirit)
-- — never reuses either. event_id is the primary key since there is at
-- most one image per event; ON DELETE CASCADE removes the row when the
-- parent event is deleted.
--
-- Data migration (idempotent): the admin event image cropper used to store
-- the full JPEG as a base64 data: URI directly in events.image, which
-- shipped the image bytes in both the <img> src and the RSC payload on
-- every page that rendered the event (homepage, /events, /events/[id]).
-- Every events row still holding a data: URI is decoded into event_images
-- and events.image is rewritten to the versioned serve-route URL. Both
-- statements below are scoped to `image LIKE 'data:image/%;base64,%'`, so
-- once a row is converted it no longer matches and replaying this file on
-- a later deploy is a no-op for it.
--
-- All statements are idempotent and safe to run on every deploy.

CREATE TABLE IF NOT EXISTS event_images (
  event_id UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  data BYTEA NOT NULL,
  content_type TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Guarded so this can never fail even if table ordering ever changes —
-- event_images is created immediately above, in this same file, but the
-- guard costs nothing and keeps the migration safe to reorder.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'event_images')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') THEN

    INSERT INTO event_images (event_id, content_type, data, updated_at)
    SELECT
      id,
      COALESCE(substring(image from 'data:(image/[^;]+);base64,'), 'image/jpeg'),
      decode(regexp_replace(image, '^data:image/[^;]+;base64,', ''), 'base64'),
      now()
    FROM events
    WHERE image LIKE 'data:image/%;base64,%'
    ON CONFLICT (event_id) DO NOTHING;

    UPDATE events
    SET image = '/api/public/events/' || id || '/image?v=1'
    WHERE image LIKE 'data:image/%;base64,%';

  END IF;
END $$;
