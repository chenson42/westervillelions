-- The Ledger — Increment 1: Books
-- Creates six new tables and seeds entities, bank accounts, funds, categories,
-- and the settings singleton.
--
-- All statements are idempotent and safe to run multiple times.
-- DECISIONS: 015 (fiscal year start-year), 016 (two-row transfers), 017 (flow = income|expense only)
-- NOTE: Update opening balances with real treasurer's report values via the
--       admin UI under LEDGER_MANAGE (PATCH /api/admin/ledger/funds/[id]).

-- ─── 1. Tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ledger_entities (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text        NOT NULL UNIQUE,
  name                text        NOT NULL,
  short_name          text,
  tax_classification  text        NOT NULL,
  charity_status      text,
  ein                 text,
  ohio_entity_number  text,
  fiscal_year_end     text        NOT NULL DEFAULT '06-30',
  donations_deductible boolean    NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_bank_accounts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid        NOT NULL REFERENCES ledger_entities(id) ON DELETE CASCADE,
  name             text        NOT NULL,
  institution      text,
  last4            text,
  account_type     text        NOT NULL DEFAULT 'checking',
  required_signers integer     NOT NULL DEFAULT 2,
  is_active        boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_funds (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id             uuid        NOT NULL REFERENCES ledger_entities(id) ON DELETE CASCADE,
  slug                  text        NOT NULL,
  name                  text        NOT NULL,
  kind                  text        NOT NULL,
  opening_balance_cents integer     NOT NULL DEFAULT 0,
  is_active             boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_funds_entity_slug_key UNIQUE (entity_id, slug)
);

CREATE TABLE IF NOT EXISTS ledger_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid        NOT NULL REFERENCES ledger_entities(id) ON DELETE CASCADE,
  fund_kind   text        NOT NULL,
  flow        text        NOT NULL,
  name        text        NOT NULL,
  form_990_line text,
  sort_order  integer     NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Core transaction table.
-- flow is 'income' | 'expense' ONLY (DECISION-017).
-- transfer_group_id links debit+credit rows of a transfer pair — no FK (self-join key).
-- No fiscal_year column — derived at query time from txn_date (DECISION-015).
CREATE TABLE IF NOT EXISTS ledger_transactions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id           uuid        NOT NULL REFERENCES ledger_entities(id) ON DELETE CASCADE,
  fund_id             uuid        NOT NULL REFERENCES ledger_funds(id) ON DELETE CASCADE,
  bank_account_id     uuid        REFERENCES ledger_bank_accounts(id) ON DELETE SET NULL,
  txn_date            date        NOT NULL,
  flow                text        NOT NULL,
  category_id         uuid        REFERENCES ledger_categories(id) ON DELETE SET NULL,
  amount_cents        integer     NOT NULL,
  party               text,
  memo                text,
  beneficiary_cause   text,
  payment_method      text,
  receipt_url         text,
  transfer_group_id   uuid,
  status              text        NOT NULL DEFAULT 'posted',
  approved_by_user_id uuid        REFERENCES users(id) ON DELETE SET NULL,
  approved_at         timestamptz,
  reconciled          boolean     NOT NULL DEFAULT false,
  reconciled_at       timestamptz,
  recorded_by_user_id uuid        NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_budgets (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id            uuid        NOT NULL REFERENCES ledger_entities(id) ON DELETE CASCADE,
  fund_id              uuid        NOT NULL REFERENCES ledger_funds(id) ON DELETE CASCADE,
  fiscal_year          integer     NOT NULL,
  category_id          uuid        REFERENCES ledger_categories(id) ON DELETE SET NULL,
  flow                 text        NOT NULL,
  annual_amount_cents  integer     NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_budgets_fund_year_cat_flow_key
    UNIQUE (fund_id, fiscal_year, category_id, flow)
);

CREATE TABLE IF NOT EXISTS ledger_settings (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  philanthropy_visibility       text        NOT NULL DEFAULT 'board',
  treasurer_bonded              boolean     NOT NULL DEFAULT false,
  reserve_warn_threshold_cents  integer     NOT NULL DEFAULT 2500000,
  disb_approval_threshold_cents integer     NOT NULL DEFAULT 25000,
  retention_years               integer     NOT NULL DEFAULT 7,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

-- ─── 2. Indexes ───────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_funds_entity') THEN
    CREATE INDEX ix_ledger_funds_entity ON ledger_funds(entity_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_categories_entity_kind_flow') THEN
    CREATE INDEX ix_ledger_categories_entity_kind_flow ON ledger_categories(entity_id, fund_kind, flow);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_txns_entity_fund') THEN
    CREATE INDEX ix_ledger_txns_entity_fund ON ledger_transactions(entity_id, fund_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_txns_fund_date') THEN
    CREATE INDEX ix_ledger_txns_fund_date ON ledger_transactions(fund_id, txn_date);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_txns_status') THEN
    CREATE INDEX ix_ledger_txns_status ON ledger_transactions(status);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_txns_transfer_group') THEN
    CREATE INDEX ix_ledger_txns_transfer_group ON ledger_transactions(transfer_group_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_budgets_fund_year') THEN
    CREATE INDEX ix_ledger_budgets_fund_year ON ledger_budgets(fund_id, fiscal_year);
  END IF;
END $$;

-- ─── 3. Seed: entities ───────────────────────────────────────────────────────

INSERT INTO ledger_entities (slug, name, short_name, tax_classification, charity_status, ein, ohio_entity_number, fiscal_year_end, donations_deductible)
SELECT 'club', 'Westerville Lions Club', 'Club', '501c4', NULL, '31-XXXXXXX', '', '06-30', false
WHERE NOT EXISTS (SELECT 1 FROM ledger_entities WHERE slug = 'club');

INSERT INTO ledger_entities (slug, name, short_name, tax_classification, charity_status, ein, ohio_entity_number, fiscal_year_end, donations_deductible)
SELECT 'foundation', 'Westerville Lions Foundation', 'Foundation', '501c3', 'public_charity', '81-XXXXXXX', '', '06-30', true
WHERE NOT EXISTS (SELECT 1 FROM ledger_entities WHERE slug = 'foundation');

-- ─── 4. Seed: bank accounts (one placeholder per entity) ─────────────────────

INSERT INTO ledger_bank_accounts (entity_id, name, institution, last4, account_type, required_signers)
SELECT e.id, 'Primary Checking', 'Bank — placeholder', '', 'checking', 2
FROM ledger_entities e
WHERE e.slug = 'club'
  AND NOT EXISTS (SELECT 1 FROM ledger_bank_accounts b WHERE b.entity_id = e.id);

INSERT INTO ledger_bank_accounts (entity_id, name, institution, last4, account_type, required_signers)
SELECT e.id, 'Primary Checking', 'Bank — placeholder', '', 'checking', 2
FROM ledger_entities e
WHERE e.slug = 'foundation'
  AND NOT EXISTS (SELECT 1 FROM ledger_bank_accounts b WHERE b.entity_id = e.id);

-- ─── 5. Seed: funds ──────────────────────────────────────────────────────────

-- Club funds
INSERT INTO ledger_funds (entity_id, slug, name, kind, opening_balance_cents)
SELECT e.id, 'administrative', 'Administrative Fund', 'administrative', 0
FROM ledger_entities e
WHERE e.slug = 'club'
  AND NOT EXISTS (
    SELECT 1 FROM ledger_funds f WHERE f.entity_id = e.id AND f.slug = 'administrative'
  );

INSERT INTO ledger_funds (entity_id, slug, name, kind, opening_balance_cents)
SELECT e.id, 'activity', 'Activity Fund', 'activity', 0
FROM ledger_entities e
WHERE e.slug = 'club'
  AND NOT EXISTS (
    SELECT 1 FROM ledger_funds f WHERE f.entity_id = e.id AND f.slug = 'activity'
  );

-- Foundation funds
INSERT INTO ledger_funds (entity_id, slug, name, kind, opening_balance_cents)
SELECT e.id, 'charitable', 'Charitable Fund', 'charitable', 0
FROM ledger_entities e
WHERE e.slug = 'foundation'
  AND NOT EXISTS (
    SELECT 1 FROM ledger_funds f WHERE f.entity_id = e.id AND f.slug = 'charitable'
  );

INSERT INTO ledger_funds (entity_id, slug, name, kind, opening_balance_cents)
SELECT e.id, 'scholarship', 'Scholarship Fund', 'scholarship', 0
FROM ledger_entities e
WHERE e.slug = 'foundation'
  AND NOT EXISTS (
    SELECT 1 FROM ledger_funds f WHERE f.entity_id = e.id AND f.slug = 'scholarship'
  );

-- ─── 6. Seed: categories (from transparency doc §8) ──────────────────────────
-- Categories are scoped per entity.  Club gets administrative + activity categories.
-- Foundation gets charitable + scholarship categories.
-- Scholarship fund reuses charitable category names (per spec).

-- ── Club: Administrative income
INSERT INTO ledger_categories (entity_id, fund_kind, flow, name, sort_order)
SELECT e.id, 'administrative', 'income', cat.name, cat.sort_order
FROM ledger_entities e
CROSS JOIN (VALUES
  ('Club dues',     10),
  ('Meals',         20),
  ('Tail-twisting', 30),
  ('Misc',          40)
) AS cat(name, sort_order)
WHERE e.slug = 'club'
  AND NOT EXISTS (
    SELECT 1 FROM ledger_categories c
    WHERE c.entity_id = e.id AND c.fund_kind = 'administrative' AND c.flow = 'income' AND c.name = cat.name
  );

-- ── Club: Administrative expense
INSERT INTO ledger_categories (entity_id, fund_kind, flow, name, sort_order)
SELECT e.id, 'administrative', 'expense', cat.name, cat.sort_order
FROM ledger_entities e
CROSS JOIN (VALUES
  ('Per-capita tax',    10),
  ('Meals',             20),
  ('Postage',           30),
  ('Printing',          40),
  ('Officer Training',  50),
  ('Supplies',          60)
) AS cat(name, sort_order)
WHERE e.slug = 'club'
  AND NOT EXISTS (
    SELECT 1 FROM ledger_categories c
    WHERE c.entity_id = e.id AND c.fund_kind = 'administrative' AND c.flow = 'expense' AND c.name = cat.name
  );

-- ── Club: Activity income
INSERT INTO ledger_categories (entity_id, fund_kind, flow, name, sort_order)
SELECT e.id, 'activity', 'income', cat.name, cat.sort_order
FROM ledger_entities e
CROSS JOIN (VALUES
  ('Rudolph Run',       10),
  ('White Cane',        20),
  ('Pancake Breakfast', 30),
  ('Public donations',  40),
  ('Sponsorships',      50),
  ('Interest',          60)
) AS cat(name, sort_order)
WHERE e.slug = 'club'
  AND NOT EXISTS (
    SELECT 1 FROM ledger_categories c
    WHERE c.entity_id = e.id AND c.fund_kind = 'activity' AND c.flow = 'income' AND c.name = cat.name
  );

-- ── Club: Activity expense
INSERT INTO ledger_categories (entity_id, fund_kind, flow, name, sort_order)
SELECT e.id, 'activity', 'expense', cat.name, cat.sort_order
FROM ledger_entities e
CROSS JOIN (VALUES
  ('Event costs',            10),
  ('Charitable donation out', 20),
  ('Eyeglass recycling',      30),
  ('Vision screening',        40)
) AS cat(name, sort_order)
WHERE e.slug = 'club'
  AND NOT EXISTS (
    SELECT 1 FROM ledger_categories c
    WHERE c.entity_id = e.id AND c.fund_kind = 'activity' AND c.flow = 'expense' AND c.name = cat.name
  );

-- ── Foundation: Charitable income
INSERT INTO ledger_categories (entity_id, fund_kind, flow, name, sort_order)
SELECT e.id, 'charitable', 'income', cat.name, cat.sort_order
FROM ledger_entities e
CROSS JOIN (VALUES
  ('Public donations', 10),
  ('Grants received',  20),
  ('Memorials',        30),
  ('Interest',         40)
) AS cat(name, sort_order)
WHERE e.slug = 'foundation'
  AND NOT EXISTS (
    SELECT 1 FROM ledger_categories c
    WHERE c.entity_id = e.id AND c.fund_kind = 'charitable' AND c.flow = 'income' AND c.name = cat.name
  );

-- ── Foundation: Charitable expense
INSERT INTO ledger_categories (entity_id, fund_kind, flow, name, sort_order)
SELECT e.id, 'charitable', 'expense', cat.name, cat.sort_order
FROM ledger_entities e
CROSS JOIN (VALUES
  ('Grant out',              10),
  ('Charitable donation out', 20),
  ('Disaster relief',         30)
) AS cat(name, sort_order)
WHERE e.slug = 'foundation'
  AND NOT EXISTS (
    SELECT 1 FROM ledger_categories c
    WHERE c.entity_id = e.id AND c.fund_kind = 'charitable' AND c.flow = 'expense' AND c.name = cat.name
  );

-- ── Foundation: Scholarship income
INSERT INTO ledger_categories (entity_id, fund_kind, flow, name, sort_order)
SELECT e.id, 'scholarship', 'income', cat.name, cat.sort_order
FROM ledger_entities e
CROSS JOIN (VALUES
  ('Public donations', 10),
  ('Grants received',  20)
) AS cat(name, sort_order)
WHERE e.slug = 'foundation'
  AND NOT EXISTS (
    SELECT 1 FROM ledger_categories c
    WHERE c.entity_id = e.id AND c.fund_kind = 'scholarship' AND c.flow = 'income' AND c.name = cat.name
  );

-- ── Foundation: Scholarship expense
INSERT INTO ledger_categories (entity_id, fund_kind, flow, name, sort_order)
SELECT e.id, 'scholarship', 'expense', cat.name, cat.sort_order
FROM ledger_entities e
CROSS JOIN (VALUES
  ('Scholarship award', 10)
) AS cat(name, sort_order)
WHERE e.slug = 'foundation'
  AND NOT EXISTS (
    SELECT 1 FROM ledger_categories c
    WHERE c.entity_id = e.id AND c.fund_kind = 'scholarship' AND c.flow = 'expense' AND c.name = cat.name
  );

-- ─── 7. Seed: settings singleton ─────────────────────────────────────────────

INSERT INTO ledger_settings (
  philanthropy_visibility,
  treasurer_bonded,
  reserve_warn_threshold_cents,
  disb_approval_threshold_cents,
  retention_years
)
SELECT 'board', false, 2500000, 25000, 7
WHERE NOT EXISTS (SELECT 1 FROM ledger_settings);
