-- Welcome Packet — schema + permission
-- (docs/work-log/2026-08-21-welcome-packet-live-page.md, DECISION-090)
--
-- Two new tables (welcome_packets, welcome_packet_current — the latter a
-- singleton-pointer table, seeded with its one row here) and one new
-- permission, welcome_packet.manage, bound to admin only. All statements
-- idempotent and safe to run on every deploy.
--
-- Raw-HTML admin authoring (welcome_packets.raw_html) is a documented,
-- narrow, admin-only exception to DECISION-076 Ruling 3 (governance
-- documents' markdown-only policy) — see DECISION-090. The safety argument
-- rests entirely on welcome_packet.manage staying bound to admin only; do
-- not add a role bind here without revisiting that decision.

CREATE TABLE IF NOT EXISTS welcome_packets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lions_year TEXT NOT NULL,
  raw_html TEXT NOT NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_welcome_packets_lions_year ON welcome_packets (lions_year);

CREATE TABLE IF NOT EXISTS welcome_packet_current (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id UUID REFERENCES welcome_packets(id) ON DELETE SET NULL,
  set_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  set_at TIMESTAMP
);

-- Seed the singleton row exactly once (Phase 2 Revised, Suggestion 2) — every
-- query site depends on exactly one row existing, with a possibly-null
-- packet_id, rather than needing its own "row doesn't exist yet" branch.
INSERT INTO welcome_packet_current (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM welcome_packet_current);

DO $$ BEGIN
  -- 1. Insert welcome_packet.manage feature
  INSERT INTO features (name, category, description)
  SELECT 'welcome_packet.manage', 'welcome_packet',
    'Author and publish the member welcome packet'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'welcome_packet.manage');

  -- 2. Bind welcome_packet.manage -> admin ONLY. Do not add a notetaker (or
  --    any other role) bind here without revisiting DECISION-090 — the raw-
  --    HTML exception's entire safety argument depends on this staying
  --    admin-only.
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'welcome_packet.manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;
