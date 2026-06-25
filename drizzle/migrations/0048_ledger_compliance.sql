-- The Ledger — Increment 3: Compliance
-- Creates ledger_filings table and seeds FY2026 compliance calendar.
--
-- All statements are idempotent and safe to run multiple times.
-- DECISION-021: due dates stored as due_month/due_day integers, not absolute dates.
-- DECISION-022: 5-year recurrence cadence controlled by next_due_year column.
--
-- Seeded fiscal_year = 2026 (FY2026 = Jul 1 2026 – Jun 30 2027).
-- Rationale: computeDueDate(2026, 11, 15) → Nov 15 2026 (month 11 >= 7, same
-- calendar year as FY start). Seeding FY2026 ensures all November deadlines land
-- on Nov 2026 — the first upcoming compliance cycle. FY2025 would produce
-- Nov 2025 deadlines (already past), making them immediately overdue on install.

-- ─── 1. Create table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ledger_filings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid        NOT NULL REFERENCES ledger_entities(id) ON DELETE CASCADE,
  fiscal_year     integer     NOT NULL,
  -- FY start year; e.g. 2026 = Jul 2026 – Jun 2027
  agency          text        NOT NULL,
  -- 'IRS' | 'Ohio Attorney General' | 'Ohio Secretary of State' |
  -- 'Ohio Dept. of Commerce' | 'Internal — Audit Committee'
  title           text        NOT NULL,
  due_month       integer     NOT NULL,
  -- 1–12; month >= 7 → calendar year = fiscal_year; month < 7 → fiscal_year + 1
  due_day         integer     NOT NULL,
  -- 1–31
  recurrence      text        NOT NULL DEFAULT 'annual',
  -- 'annual' | '5_year'
  next_due_year   integer,
  -- Non-null only for recurrence='5_year'. Calendar year in which this row's
  -- due_month/due_day falls (DECISION-022). listFilings includes the row only
  -- when next_due_year = (due_month >= 7 ? fiscal_year : fiscal_year + 1).
  -- On rollover, ensureFilingsForFY sets next_due_year = current + 5.
  status          text        NOT NULL DEFAULT 'not_started',
  -- 'not_started' | 'in_progress' | 'filed' | 'future' | 'na'
  -- No CHECK constraint — consistent with ledger_transactions.status (inc1 precedent).
  confirmation    text,
  -- Agency confirmation/acknowledgment code; max 100 chars at app layer
  filed_on        date,
  -- Wall-clock date filed; required when status → 'filed' (app-layer enforcement)
  note            text,
  -- Max 1000 chars at app layer
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_filings_entity_fy_agency_title_key
    UNIQUE (entity_id, fiscal_year, agency, title)
);

-- ─── 2. Indexes ──────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_filings_entity_fy') THEN
    CREATE INDEX ix_ledger_filings_entity_fy ON ledger_filings(entity_id, fiscal_year);
  END IF;
END $$;

-- ─── 3. Seed: Club filings (FY2026) ──────────────────────────────────────────
-- Five filings for the Club entity (slug='club').
-- All rows use ON CONFLICT (entity_id, fiscal_year, agency, title) DO NOTHING
-- so reruns are no-ops.

-- IRS 990-N (e-Postcard) — due Nov 15 2026
-- computeDueDate(2026, 11, 15): month 11 >= 7 → Nov 15 2026
INSERT INTO ledger_filings (entity_id, fiscal_year, agency, title, due_month, due_day, recurrence, next_due_year, status)
SELECT id, 2026, 'IRS', '990-N', 11, 15, 'annual', NULL, 'not_started'
FROM ledger_entities WHERE slug = 'club'
ON CONFLICT (entity_id, fiscal_year, agency, title) DO NOTHING;

-- Ohio AG Charitable Annual Report — due Nov 15 2026
INSERT INTO ledger_filings (entity_id, fiscal_year, agency, title, due_month, due_day, recurrence, next_due_year, status)
SELECT id, 2026, 'Ohio Attorney General', 'Ohio AG Charitable Annual Report', 11, 15, 'annual', NULL, 'not_started'
FROM ledger_entities WHERE slug = 'club'
ON CONFLICT (entity_id, fiscal_year, agency, title) DO NOTHING;

-- Ohio Unclaimed Funds Report — due Nov 1 2026
-- computeDueDate(2026, 11, 1): month 11 >= 7 → Nov 1 2026
INSERT INTO ledger_filings (entity_id, fiscal_year, agency, title, due_month, due_day, recurrence, next_due_year, status)
SELECT id, 2026, 'Ohio Dept. of Commerce', 'Ohio Unclaimed Funds Report', 11, 1, 'annual', NULL, 'not_started'
FROM ledger_entities WHERE slug = 'club'
ON CONFLICT (entity_id, fiscal_year, agency, title) DO NOTHING;

-- Statement of Continued Existence — Ohio SOS, every 5 years — due Nov 15
-- next_due_year=2030: the filing is due Nov 15 2030, which falls inside FY2030
-- (Jul 2030–Jun 2031). month 11 >= 7, so listFilings(2030) check: next_due_year(2030) === fiscalYear(2030) → included.
-- listFilings(2026) check: 2030 === 2026 → false → excluded (correct; not due this year).
-- NOTE: 2030 is a placeholder — confirm actual Ohio SOS renewal year with the treasurer.
INSERT INTO ledger_filings (entity_id, fiscal_year, agency, title, due_month, due_day, recurrence, next_due_year, status)
SELECT id, 2026, 'Ohio Secretary of State', 'Statement of Continued Existence', 11, 15, '5_year', 2030, 'not_started'
FROM ledger_entities WHERE slug = 'club'
ON CONFLICT (entity_id, fiscal_year, agency, title) DO NOTHING;

-- Annual Treasurer's Audit — internal, due Jun 30
-- computeDueDate(2026, 6, 30): month 6 < 7 → Jun 30 2027
INSERT INTO ledger_filings (entity_id, fiscal_year, agency, title, due_month, due_day, recurrence, next_due_year, status)
SELECT id, 2026, 'Internal — Audit Committee', 'Annual Treasurer''s Audit', 6, 30, 'annual', NULL, 'not_started'
FROM ledger_entities WHERE slug = 'club'
ON CONFLICT (entity_id, fiscal_year, agency, title) DO NOTHING;

-- ─── 4. Seed: Foundation filings (FY2026) ────────────────────────────────────
-- Four filings for the Foundation entity (slug='foundation').
-- The Foundation does NOT get a Statement of Continued Existence — the Club
-- is the Ohio SOS-registered entity. The Foundation's Ohio SOS equivalent
-- (Biennial Report) is out of scope for inc3.

-- IRS 990-N (e-Postcard) — due Nov 15 2026
INSERT INTO ledger_filings (entity_id, fiscal_year, agency, title, due_month, due_day, recurrence, next_due_year, status)
SELECT id, 2026, 'IRS', '990-N', 11, 15, 'annual', NULL, 'not_started'
FROM ledger_entities WHERE slug = 'foundation'
ON CONFLICT (entity_id, fiscal_year, agency, title) DO NOTHING;

-- Ohio AG Charitable Annual Report — due Nov 15 2026
INSERT INTO ledger_filings (entity_id, fiscal_year, agency, title, due_month, due_day, recurrence, next_due_year, status)
SELECT id, 2026, 'Ohio Attorney General', 'Ohio AG Charitable Annual Report', 11, 15, 'annual', NULL, 'not_started'
FROM ledger_entities WHERE slug = 'foundation'
ON CONFLICT (entity_id, fiscal_year, agency, title) DO NOTHING;

-- Ohio Unclaimed Funds Report — due Nov 1 2026
INSERT INTO ledger_filings (entity_id, fiscal_year, agency, title, due_month, due_day, recurrence, next_due_year, status)
SELECT id, 2026, 'Ohio Dept. of Commerce', 'Ohio Unclaimed Funds Report', 11, 1, 'annual', NULL, 'not_started'
FROM ledger_entities WHERE slug = 'foundation'
ON CONFLICT (entity_id, fiscal_year, agency, title) DO NOTHING;

-- Annual Treasurer's Audit — internal, due Jun 30 2027
INSERT INTO ledger_filings (entity_id, fiscal_year, agency, title, due_month, due_day, recurrence, next_due_year, status)
SELECT id, 2026, 'Internal — Audit Committee', 'Annual Treasurer''s Audit', 6, 30, 'annual', NULL, 'not_started'
FROM ledger_entities WHERE slug = 'foundation'
ON CONFLICT (entity_id, fiscal_year, agency, title) DO NOTHING;
