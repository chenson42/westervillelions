-- Governance Documents — Versioning, Diffing & Adoption
-- (docs/work-log/2026-08-09-governance-document-versioning.md,
--  DECISION-076, DECISION-081)
--
-- Two tables, sibling to minutes (not merged): `documents` (one row per
-- governed document — today, exactly one, the by-laws) and
-- `document_versions` (every save, forever — permanent, immutable rows, no
-- delete path anywhere in this design). Both statements are plain
-- `CREATE TABLE IF NOT EXISTS` — no guarded `ALTER TABLE` step is needed,
-- because `documents.current_version_id` deliberately carries NO database-
-- level FK constraint (DECISION-081): the circular documents <->
-- document_versions table-creation dependency is resolved by leaving that
-- column a plain nullable uuid, enforced only by src/lib/documents-queries.ts
-- (the sole writer, always inside the same transaction as the version row it
-- points to). See src/lib/db/schema.ts for the full rationale comment — do
-- NOT "fix" this by adding the constraint back; a constraint added here by
-- raw SQL but never declared in schema.ts is exactly the kind of drift
-- `drizzle-kit push --force` (which runs immediately after this migration on
-- every deploy, per CLAUDE.md Common Commands) can silently drop.
--
-- Sequencing dependency (DECISION-076 Ruling 7): document_versions.
-- citing_minutes_id references minutes(id), so the `minutes` table must
-- already exist in the target database. It does — minutes shipped in
-- v1.62.0 (0079_meeting_minutes.sql) — verified against the dev database
-- before this migration was written (see Phase 4 work-log entry).
--
-- All statements are idempotent and safe to re-run on every deploy.

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL,
  visibility text NOT NULL DEFAULT 'members',
  current_version_id uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_documents_slug ON documents(slug);

CREATE TABLE IF NOT EXISTS document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  body_markdown text NOT NULL,
  change_type text NOT NULL,
  change_note text NOT NULL,
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  adopted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  adopted_at timestamp,
  citing_minutes_id uuid REFERENCES minutes(id) ON DELETE SET NULL,
  adoption_note text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_document_versions_doc_version ON document_versions(document_id, version_number);
CREATE INDEX IF NOT EXISTS ix_document_versions_document ON document_versions(document_id);
CREATE INDEX IF NOT EXISTS ix_document_versions_change_type ON document_versions(change_type);
CREATE INDEX IF NOT EXISTS ix_document_versions_citing_minutes ON document_versions(citing_minutes_id);

-- documents.current_version_id intentionally has NO FK constraint here —
-- see the schema.ts comment on `documents.currentVersionId` / DECISION-081.
