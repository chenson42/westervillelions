-- Remove the empty Foundation Scholarship Fund
-- (docs/work-log/2026-07-28-remove-empty-scholarship-fund.md, treasurer-approved 2026-07-28)
--
-- The Foundation's top-level "Scholarship Fund" (ledger_funds.kind='scholarship')
-- shipped in 0044_ledger_books.sql (v1.20.0) as an anticipated segregated fund,
-- but the club has always run scholarships out of the Charitable fund's
-- "Scholarships" category instead, so the fund + its scholarship-kind
-- categories have sat empty (0 transactions, 0 budgets) since inception.
-- Confirmed empty on both prod and local before writing this migration.
--
-- Reversible: a future migration can re-seed the fund/categories if
-- donor-restricted scholarship gifts ever require a segregated fund. The
-- 'scholarship' fund KIND itself is untouched — it remains valid in
-- schema.ts, ledger.ts, and ledger-queries.ts; only the seeded fund ROW and
-- its two scholarship-kind categories are removed.
--
-- GUARDED — every DELETE below only fires when zero rows anywhere reference
-- the target, so this can never destroy real data even if these assumptions
-- ever stop holding on a future replay:
--   - ledger_transactions.category_id / .fund_id (ON DELETE SET NULL / CASCADE)
--   - ledger_budgets.category_id / .fund_id (ON DELETE SET NULL / CASCADE)
--   - ledger_reimbursements.fund_id (ON DELETE SET NULL) — treasurer assigns a
--     fund to a reimbursement at pay time; also confirmed zero rows.
-- ledger_budget_lines cascades from ledger_budgets and ledger_reconciliation_*
-- key off bank_account_id/transaction_id, not fund/category — so once no
-- ledger_transactions or ledger_budgets reference the fund/categories, those
-- tables can't either; no separate guard needed for them.
--
-- Scoped strictly to the Foundation entity's kind='scholarship' fund and
-- fund_kind='scholarship' categories. Never touches club, administrative,
-- activity, or charitable data (including the Charitable fund's own
-- "Scholarships" category, which is a different row and stays untouched).
--
-- Idempotent: the first run deletes the (already-verified-empty) fund and
-- categories; every replay after that finds zero matching rows and is a
-- clean no-op.

-- 1. Delete scholarship-kind categories for the Foundation entity — only the
--    ones with zero referencing ledger_transactions/ledger_budgets rows.
--    (Categories first, since ledger_transactions/ledger_budgets FK to
--    ledger_funds with ON DELETE CASCADE — deleting the fund next would
--    otherwise be free to cascade-delete any still-referencing row instead
--    of the guard blocking it. Checking categories first keeps the guard
--    the thing that decides, not the FK action.)
DELETE FROM ledger_categories c
USING ledger_entities e
WHERE c.entity_id = e.id
  AND e.slug = 'foundation'
  AND c.fund_kind = 'scholarship'
  AND NOT EXISTS (SELECT 1 FROM ledger_transactions t WHERE t.category_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM ledger_budgets b WHERE b.category_id = c.id);

-- 2. Delete the Foundation's scholarship fund — only if zero referencing
--    ledger_transactions, ledger_budgets, or ledger_reimbursements rows.
DELETE FROM ledger_funds f
USING ledger_entities e
WHERE f.entity_id = e.id
  AND e.slug = 'foundation'
  AND f.kind = 'scholarship'
  AND NOT EXISTS (SELECT 1 FROM ledger_transactions t WHERE t.fund_id = f.id)
  AND NOT EXISTS (SELECT 1 FROM ledger_budgets b WHERE b.fund_id = f.id)
  AND NOT EXISTS (SELECT 1 FROM ledger_reimbursements r WHERE r.fund_id = f.id);
