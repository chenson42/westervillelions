# Remove the empty Foundation Scholarship Fund — Work Log

> **Slug:** `2026-07-28-remove-empty-scholarship-fund`
> **Surface:** DB / migration (Ledger fund structure)
> **Estimated complexity:** small (guarded removal migration + stop the 0044 seed)
> **Pipeline mode:** Bug-fix/cleanup variant — analyst/architect/tech-lead light; qa verifies migration replay

## Intent (treasurer-directed, 2026-07-28)
Remove the Foundation's top-level **Scholarship Fund** (`ledger_funds.kind='scholarship'`) and its
scholarship-kind categories. It was seeded "per spec" in `0044_ledger_books.sql` (v1.20.0, 2026-06-24)
as an anticipated segregated fund, but the club runs scholarships from the **Charitable fund's
"Scholarships" category** — so the fund has been empty (0 transactions, 0 budgets) since inception.
Treasurer: "remove it for cleanliness, we can always add it back." Reversible — a future migration can
re-seed it if donor-restricted scholarship gifts ever appear.

## Plan
1. READ-ONLY verify (dev + prod): the Foundation scholarship fund + its scholarship-kind categories
   have ZERO `ledger_transactions` and ZERO `ledger_budgets`. If ANY data exists, STOP.
2. Check code for hard dependence on a scholarship fund existing (member-exposed logic is
   `administrative`+`charitable`, so scholarship is already excluded — but audit impact/guardrails/
   fund-report/dashboard). The `'scholarship'` fund-kind may remain in enums/logic; only the fund ROW
   is removed.
3. `0044_ledger_books.sql`: remove/guard the scholarship FUND + scholarship-kind CATEGORY seed blocks
   so re-runs never re-create it (stays idempotent).
4. New `0065_remove_empty_scholarship_fund.sql`: idempotently DELETE the empty scholarship fund + its
   categories, GUARDED (only if no referencing transactions/budgets), safe to replay.
5. Verify locally: `pnpm db:migrate` runs clean, the local scholarship fund/categories are gone, and a
   second replay is a no-op. tsc + tests pass. Prod removal happens automatically via the deploy's
   migrate step when pushed (no separate manual prod op).

## Phase 4 — Implementation (schema) — 2026-07-28

**Owner:** database-admin
**Status:** complete

### Summary
Confirmed the Foundation's Scholarship Fund and its scholarship-kind categories are empty on both
prod and local (zero transactions, budgets, budget lines, reconciliation matches, and — an FK the
plan didn't enumerate but I checked — zero `ledger_reimbursements` rows too). Stopped the 0044 seed
from creating the fund/categories on fresh installs, and added a guarded, idempotent migration 0065
that removes them from existing installs only when still unreferenced. No `schema.ts` change needed.

### What I did
- **Step 0 (read-only verify, prod + local):** Queried both databases for the Foundation entity's
  `kind='scholarship'` fund, its `fund_kind='scholarship'` categories, and every table with a real FK
  to `ledger_funds`/`ledger_categories` (`ledger_transactions` via both `fund_id` and `category_id`,
  `ledger_budgets` via both, `ledger_budget_lines` via its parent budget, `ledger_reconciliation_matches`
  via its transaction, and `ledger_reimbursements.fund_id`). All counts were 0 on both databases — safe
  to proceed.
  - **Prod** (Neon `tiny-fog-13725730`, branch `production`): fund_id `85812432-4e2b-438a-a097-e43bd1148b61`
    (entity_id `1665dde0-6635-4967-bea1-7f207d261e5e`); categories: `5330fb6c-5b33-4a52-b366-2621eebb744c`
    (Public donations, income), `498697f9-5c93-4778-ba35-d1ad3194ae24` (Grants received, income),
    `0e14428c-d1d2-4678-89c1-342a6f391a11` (Scholarship award, expense).
  - **Local**: fund_id `5148a9f7-b539-47cc-852f-71ee3c65b87e` (entity_id `8a27091d-ae9b-4c58-bff3-a633c418ee21`);
    categories `ba8dc8fe-56d0-4a72-b2c9-3d1b9c1c4537`, `a54ac38a-4729-491f-8adf-41593fe8c1fb`,
    `747a9279-9819-4421-9a84-5c85cf0941c5` (same three names).
- **Step 1 (code audit):** Grepped `src/lib/ledger.ts`, `src/lib/ledger-queries.ts`, the impact/dashboard
  queries, the admin categories route, and `guided-budget-setup.tsx` for `scholarship`. Every reference
  is either (a) the `'scholarship'` string kept as a member of a fund-kind array/enum
  (`["activity", "charitable", "scholarship"]`) used in `inArray()`/`filter()`/`includes()` — dynamically
  joins/filters against whatever fund rows actually exist, so removing the row just means it never
  matches, no crash — or (b) a pure function (`isAgedPublicFund`, `computeBudgetBalanceStatus`, etc.)
  operating on whatever fund list is passed in, with no assumption of a fixed count. Checked for
  hardcoded indexing/count assumptions (`funds[0]`, `funds.length === N`) — every hit is either an
  empty-list guard (`.length === 0`) or "default the picker to the first fund in the list," neither of
  which breaks when the Foundation goes from 2 funds to 1. **Also found** `ledger_reimbursements.fund_id`
  (nullable, `ON DELETE SET NULL`) as a real FK to `ledger_funds` not named in the plan's enumerated
  list — checked it directly (0 rows on both DBs) and added it to migration 0065's guard for
  defense-in-depth. Conclusion: safe to remove the fund row; the `'scholarship'` kind stays alive
  everywhere else in code, exactly as intended.
- **Step 2:** Edited `drizzle/migrations/0044_ledger_books.sql` — removed the Foundation scholarship
  fund `INSERT` (was ~L223) and both scholarship-kind category `INSERT` blocks (income ~L344, expense
  ~L358), replacing each with a dated comment explaining why and pointing at 0065. Left the Charitable
  fund seed, its categories, and the (separately, non-seed, admin-UI-added) Charitable "Scholarships"
  category completely untouched.
- **Step 3:** Wrote `drizzle/migrations/0065_remove_empty_scholarship_fund.sql` (see Outputs for content
  and idempotency reasoning).
- **Step 4:** Confirmed no `schema.ts` change is needed — `ledger_funds.kind` / `ledger_categories.fund_kind`
  are plain `text` columns with no DB-level enum/CHECK constraint; `'scholarship'` only appears as a
  documentation comment. This is a pure data-row removal.
- **Step 5:** Ran local verification per the plan (see Outputs).

### Outputs
- `drizzle/migrations/0044_ledger_books.sql` — removed the scholarship fund seed and both
  scholarship-kind category seed blocks; added dated comments so a future reader knows why they're
  gone and won't re-add them. No other seed blocks touched.
- `drizzle/migrations/0065_remove_empty_scholarship_fund.sql` (new) — two guarded `DELETE`s:
  1. `DELETE FROM ledger_categories ... WHERE fund_kind = 'scholarship' AND entity slug = 'foundation' AND NOT EXISTS (referencing ledger_transactions) AND NOT EXISTS (referencing ledger_budgets)` — categories first.
  2. `DELETE FROM ledger_funds ... WHERE kind = 'scholarship' AND entity slug = 'foundation' AND NOT EXISTS (referencing ledger_transactions) AND NOT EXISTS (referencing ledger_budgets) AND NOT EXISTS (referencing ledger_reimbursements)`.
  Idempotent because both are per-row `NOT EXISTS` guards scoped by `WHERE` clause, not blanket
  deletes: the first run matches and deletes the (verified-empty) rows; every subsequent run finds
  zero rows matching `fund_kind='scholarship'` / `kind='scholarship'` for the Foundation (they're
  already gone) and is a clean no-op — it can never touch club/administrative/activity/charitable
  data, and it can never delete a fund/category that has real transactions, budgets, or (for the fund)
  reimbursements pointed at it, even on a hypothetical future replay where that stopped being true.
- No `src/lib/db/schema.ts` change (data-row removal only, confirmed above).
- Tables affected: `ledger_funds`, `ledger_categories` (existing installs); `ledger_transactions`,
  `ledger_budgets`, `ledger_reimbursements` consulted read-only as guard conditions, not modified.
- No new role bindings/permissions — this isn't a `FEATURES` change.
- Local apply command: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`
  (no `pnpm db:push` needed — `schema.ts` unchanged).
- **Local verification:**
  - `pnpm db:migrate` (1st run): completed with `✅ Migrations completed successfully`, no errors.
  - Confirmed gone: `SELECT count(*) FROM ledger_funds WHERE kind='scholarship'` → 0;
    `SELECT count(*) FROM ledger_categories WHERE fund_kind='scholarship'` → 0.
  - `pnpm db:migrate` (2nd run): completed clean again, `0065` fired with no errors and 0044's stopped
    seed did not recreate anything — re-queried both counts, still 0.
  - `pnpm exec tsc --noEmit` (with `DATABASE_URL`/`DB_URL` unset): clean, no output.
  - `pnpm test` (with `DATABASE_URL`/`DB_URL` unset): 22 test files, **644 passed**, 0 failed.

### Open questions / handoff notes
- Nothing further required — this is a self-contained schema/migration change with no API or UI
  surface to build. No next agent is needed unless the treasurer later wants a UI affordance (e.g. a
  "re-seed a fund" admin action), which isn't in scope here.
- Prod removal happens automatically the next time this branch's migrations run against production
  (the deploy's `pnpm db:migrate` step) — no manual prod SQL was run or is needed; Step 0's prod query
  already confirmed the prod fund is empty and eligible.
- If a future donor-restricted scholarship gift ever needs a segregated fund again, re-adding it is a
  new forward migration (INSERT with the same guard-idempotent `WHERE NOT EXISTS` pattern) — do not
  revert 0065 or resurrect the removed 0044 blocks, since 0065 already ran against prod history by
  then.
