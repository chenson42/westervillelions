-- The Ledger — Increment 4: Reports & 990-Prep
-- DATA-ONLY migration: populate ledger_categories.form_990_line for every seeded category.
--
-- No DDL — the form_990_line column already exists (nullable text) from 0044_ledger_books.sql.
-- All statements are idempotent: the AND form_990_line IS NULL guard makes re-runs no-ops
-- and also prevents overwriting any admin-set value added after initial seeding.
--
-- Scope: every UPDATE is scoped to a specific entity slug so that categories with the same
-- name across entities (e.g. "Interest", "Public donations", "Grants received",
-- "Charitable donation out") get the correct label for their entity.
--
-- Label set (8 labels per Phase 3 design / DECISION-023):
--   Contributions/gifts/grants
--   Fundraising events (gross)
--   Investment income
--   Grants paid
--   Program service expenses
--   Management/general expenses
--   Fundraising expenses
--   Program service revenue   (reserved — no seeded category maps here)
--
-- Category inventory sourced from 0044_ledger_books.sql seed block (30 rows total).

-- ═══════════════════════════════════════════════════════════════════════════════
-- CLUB (entity slug = 'club')
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Club / Administrative income ──────────────────────────────────────────────

-- Club dues → Contributions/gifts/grants
UPDATE ledger_categories
SET    form_990_line = 'Contributions/gifts/grants'
WHERE  name = 'Club dues'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- Meals (administrative income — member meal revenue) → Contributions/gifts/grants
-- Classified as member-related receipts, not program service revenue, at 990-N/990-EZ scale.
UPDATE ledger_categories
SET    form_990_line = 'Contributions/gifts/grants'
WHERE  name = 'Meals'
  AND  fund_kind = 'administrative'
  AND  flow = 'income'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- Tail-twisting (member fines / fun contributions) → Contributions/gifts/grants
UPDATE ledger_categories
SET    form_990_line = 'Contributions/gifts/grants'
WHERE  name = 'Tail-twisting'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- Misc (miscellaneous income) → Contributions/gifts/grants
UPDATE ledger_categories
SET    form_990_line = 'Contributions/gifts/grants'
WHERE  name = 'Misc'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- ── Club / Administrative expense ─────────────────────────────────────────────

-- Per-capita tax (Lions International dues) → Management/general expenses
UPDATE ledger_categories
SET    form_990_line = 'Management/general expenses'
WHERE  name = 'Per-capita tax'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- Meals (administrative expense — meeting meals) → Management/general expenses
UPDATE ledger_categories
SET    form_990_line = 'Management/general expenses'
WHERE  name = 'Meals'
  AND  fund_kind = 'administrative'
  AND  flow = 'expense'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- Postage → Management/general expenses
UPDATE ledger_categories
SET    form_990_line = 'Management/general expenses'
WHERE  name = 'Postage'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- Printing → Management/general expenses
UPDATE ledger_categories
SET    form_990_line = 'Management/general expenses'
WHERE  name = 'Printing'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- Officer Training → Management/general expenses
UPDATE ledger_categories
SET    form_990_line = 'Management/general expenses'
WHERE  name = 'Officer Training'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- Supplies → Management/general expenses
UPDATE ledger_categories
SET    form_990_line = 'Management/general expenses'
WHERE  name = 'Supplies'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- ── Club / Activity income ─────────────────────────────────────────────────────

-- Rudolph Run (annual fundraiser) → Fundraising events (gross)
UPDATE ledger_categories
SET    form_990_line = 'Fundraising events (gross)'
WHERE  name = 'Rudolph Run'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- White Cane (street collection fundraiser) → Fundraising events (gross)
UPDATE ledger_categories
SET    form_990_line = 'Fundraising events (gross)'
WHERE  name = 'White Cane'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- Pancake Breakfast (fundraiser event) → Fundraising events (gross)
UPDATE ledger_categories
SET    form_990_line = 'Fundraising events (gross)'
WHERE  name = 'Pancake Breakfast'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- Public donations (activity fund — unsolicited donations) → Contributions/gifts/grants
UPDATE ledger_categories
SET    form_990_line = 'Contributions/gifts/grants'
WHERE  name = 'Public donations'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- Sponsorships (event sponsorship revenue) → Fundraising events (gross)
UPDATE ledger_categories
SET    form_990_line = 'Fundraising events (gross)'
WHERE  name = 'Sponsorships'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- Interest (club interest income) → Investment income
UPDATE ledger_categories
SET    form_990_line = 'Investment income'
WHERE  name = 'Interest'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- ── Club / Activity expense ────────────────────────────────────────────────────

-- Event costs (direct costs of fundraising events) → Fundraising expenses
UPDATE ledger_categories
SET    form_990_line = 'Fundraising expenses'
WHERE  name = 'Event costs'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- Charitable donation out (club charitable giving) → Program service expenses
UPDATE ledger_categories
SET    form_990_line = 'Program service expenses'
WHERE  name = 'Charitable donation out'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- Eyeglass recycling (Lions vision service program) → Program service expenses
UPDATE ledger_categories
SET    form_990_line = 'Program service expenses'
WHERE  name = 'Eyeglass recycling'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- Vision screening (Lions vision service program) → Program service expenses
UPDATE ledger_categories
SET    form_990_line = 'Program service expenses'
WHERE  name = 'Vision screening'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');

-- ═══════════════════════════════════════════════════════════════════════════════
-- FOUNDATION (entity slug = 'foundation')
-- ═══════════════════════════════════════════════════════════════════════════════
-- Foundation has two fund kinds: 'charitable' and 'scholarship'.
-- 'Public donations' and 'Grants received' appear in both fund kinds; both map to
-- Contributions/gifts/grants so a single UPDATE per name (scoped to foundation entity)
-- correctly updates both rows.

-- ── Foundation / Charitable + Scholarship income ───────────────────────────────

-- Public donations (charitable fund + scholarship fund) → Contributions/gifts/grants
UPDATE ledger_categories
SET    form_990_line = 'Contributions/gifts/grants'
WHERE  name = 'Public donations'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'foundation');

-- Grants received (charitable fund + scholarship fund) → Contributions/gifts/grants
UPDATE ledger_categories
SET    form_990_line = 'Contributions/gifts/grants'
WHERE  name = 'Grants received'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'foundation');

-- Memorials (charitable donations in memory of someone) → Contributions/gifts/grants
UPDATE ledger_categories
SET    form_990_line = 'Contributions/gifts/grants'
WHERE  name = 'Memorials'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'foundation');

-- Interest (foundation investment income) → Investment income
UPDATE ledger_categories
SET    form_990_line = 'Investment income'
WHERE  name = 'Interest'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'foundation');

-- ── Foundation / Charitable expense ───────────────────────────────────────────

-- Grant out (grants disbursed to organizations) → Grants paid
UPDATE ledger_categories
SET    form_990_line = 'Grants paid'
WHERE  name = 'Grant out'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'foundation');

-- Charitable donation out (direct charitable giving) → Program service expenses
-- Classified as program service (direct benefit delivery) rather than grants paid
-- because these are direct program disbursements, not formal grant awards.
UPDATE ledger_categories
SET    form_990_line = 'Program service expenses'
WHERE  name = 'Charitable donation out'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'foundation');

-- Disaster relief (emergency humanitarian assistance) → Program service expenses
UPDATE ledger_categories
SET    form_990_line = 'Program service expenses'
WHERE  name = 'Disaster relief'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'foundation');

-- ── Foundation / Scholarship expense ──────────────────────────────────────────

-- Scholarship award (student scholarship disbursements) → Grants paid
UPDATE ledger_categories
SET    form_990_line = 'Grants paid'
WHERE  name = 'Scholarship award'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'foundation');
