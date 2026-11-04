-- Migration 0117: Santa's Workshop group-photo scenes (storyline titles and captions)
-- docs/work-log/2026-11-04-group-photo-scenes.md (Phase 3, Data Model; Phase 2 R10)
--
-- One session-scoped table plus a nullable pointer on sw_photos. Additive only: no data
-- backfill, no seed, no role binding, no CHECK constraints (drizzle-kit push --force drops
-- anything not declared in schema.ts; the text policy lives in scene-input.ts).
--
-- Foreign keys are added inside pg_constraint-guarded DO blocks with the exact names
-- drizzle derives ({table}_{column}_{reftable}_{refcolumn}_fk), so `drizzle-kit push`
-- finds no diff. Idempotent: safe to replay on every deploy.

CREATE TABLE IF NOT EXISTS sw_scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  title text NOT NULL,
  caption text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sw_photos ADD COLUMN IF NOT EXISTS scene_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sw_scenes_session_id_sw_sessions_id_fk') THEN
    ALTER TABLE sw_scenes
      ADD CONSTRAINT sw_scenes_session_id_sw_sessions_id_fk
      FOREIGN KEY (session_id) REFERENCES sw_sessions(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sw_photos_scene_id_sw_scenes_id_fk') THEN
    ALTER TABLE sw_photos
      ADD CONSTRAINT sw_photos_scene_id_sw_scenes_id_fk
      FOREIGN KEY (scene_id) REFERENCES sw_scenes(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_sw_scenes_session_position ON sw_scenes (session_id, position);
