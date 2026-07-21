# True Gifts Only — Philanthropy/Impact Reporting Refinement — Work Log

> **Slug:** `2026-07-20-impact-true-gifts`
> **Surface:** (dashboard) member portal — `/members/impact`
> **Permission(s):** existing `impact.view` / open-to-linked-members gate (unchanged)
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phases 1–3 condensed by user decision; design supplied directly to api-developer. See note below.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | (skipped) | Skipped | — | 2026-07-20 |
| 2 — Architectural review | (skipped) | Skipped | — | 2026-07-20 |
| 3 — Technical design | (skipped — user-supplied) | Skipped | — | 2026-07-20 |
| 4 — Implementation | api-developer | Complete | — | 2026-07-20 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

**Phase skip rationale (user directive):** The user supplied a condensed design directly (schema field, migration, predicate changes at both sync points, test cases, verification steps) and instructed "Condensed Phases 1–3 (document skips in work-log): the design is below; it touches the giving-predicate invariant, so follow it exactly." No analyst/architect/tech-lead docs exist for this change; this work-log is the design's only record. The design explicitly named the schema edit as step 1 of the implementer's own task rather than routing it to database-admin — a deviation from the normal split noted here since the schema surface is a single boolean column tightly coupled to the predicate logic being changed in the same pass.

---

# Design (as supplied)

1. Add `ledgerCategories.countsAsGiving: boolean` (default `true`) — `false` marks categories whose spend is operational/fundraising overhead, excluded from philanthropy reporting.
2. Idempotent migration adding the column and flagging `'Fundraising event costs'`, `'Operations'`, `'Insurance & bonding'` (all entities, expense flow) as `false`.
3. Update the giving predicate at both synced locations (`isGiving()` in `ledger.ts`, SQL predicate in `getPhilanthropy()` in `ledger-queries.ts`) to exclude `countsAsGiving === false`, with **null/undefined staying included** (conservative — uncategorized public-fund expenses keep appearing as "Other community support" rather than vanishing).
4. Audit other giving-predicate consumers; do not change 990/compliance semantics.
5. Extend unit test coverage for the new flag states.
6. Verify: typecheck, tests, build, live SQL before/after totals, dev-server smoke.

---

# Phase 4 — Implementation (API) — 2026-07-20

**Owner:** api-developer
**Status:** complete

### Summary

Added a `counts_as_giving` boolean to `ledger_categories` so philanthropy/impact reporting can exclude operational and fundraising-overhead spend ("Fundraising event costs", "Operations", "Insurance & bonding") from giving totals even though those transactions post through an otherwise giving-eligible fund (activity/charitable/scholarship). The giving predicate was updated at both of its synced locations — `isGiving()` (pure helper, `src/lib/ledger.ts`) and the SQL `WHERE` clause inside `getPhilanthropy()` (`src/lib/ledger-queries.ts`) — with a conservative null-inclusion rule so uncategorized rows are never silently dropped from the report. No other giving-predicate consumers required changes; `determine990()` and the donor-giving-history query use unrelated predicates (see disposition below).

### What I did

- Added `ledgerCategories.countsAsGiving` (`boolean`, `NOT NULL DEFAULT true`) to `src/lib/db/schema.ts` with an inline comment pointing at DECISION-030.
- Wrote idempotent migration `drizzle/migrations/0053_ledger_category_counts_as_giving.sql`:
  - `ALTER TABLE ledger_categories ADD COLUMN IF NOT EXISTS counts_as_giving boolean NOT NULL DEFAULT true;`
  - Guarded `UPDATE ... WHERE flow='expense' AND name IN ('Fundraising event costs','Operations','Insurance & bonding') AND counts_as_giving IS DISTINCT FROM false;`
  - Confirmed against the dev DB before writing the UPDATE that the three names exist exactly as given (4 matching rows across entities/fund kinds — see below).
- Ran the migration locally (`pnpm db:migrate`) and verified via `psql`: column exists, `NOT NULL DEFAULT true`; exactly 4 rows now `counts_as_giving = false`.
- Extended `isGiving(row, fundKind, categoryCountsAsGiving?)` in `src/lib/ledger.ts` with a new optional 3rd parameter. `categoryCountsAsGiving !== false` is the added clause — `false` excludes, `true`/`null`/`undefined` (i.e. omitted) all still pass. Backward compatible: all pre-existing call sites (there were none outside tests) are unaffected by the new optional param.
- Updated `getPhilanthropy()` in `src/lib/ledger-queries.ts`: added a `leftJoin(ledgerCategories, eq(ledgerTransactions.categoryId, ledgerCategories.id))` to **both** of its queries (the aggregate-fold query and the recent-named-gifts query), and added `or(isNull(ledgerCategories.countsAsGiving), eq(ledgerCategories.countsAsGiving, true))` to both `WHERE` clauses. With a LEFT JOIN, a transaction with no `categoryId` (or whose category was hard-deleted, `onDelete: 'set null'`) produces a null joined `countsAsGiving`, which the `isNull(...)` branch keeps included — matching the conservative rule.
- Updated both doc comments ("must stay in sync") on `isGiving()` and `getPhilanthropy()` to describe the new clause and cite DECISION-030.
- Extended `src/lib/ledger-impact.test.ts` (the actual home of `isGiving()` unit tests — see note below) with 5 new cases (9–13) covering: explicit `false` excludes; explicit `true` behaves as default; `null` stays included; omitted/`undefined` stays included (regression-safety for the pre-existing call shape); `false` + administrative fund kind (still false, both reasons hold).
- Ran `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm build:only` — all green.
- Ran live SQL before/after totals against the dev DB (below).
- Confirmed `/members/impact` still responds (307 redirect to sign-in for the unauthenticated `curl` request — expected `auth()` behavior, not a server error) and the dev server log shows no new errors.

### Test-file location note

The design doc named `src/lib/ledger.test.ts` as the test file to extend. The actual, pre-existing home of `isGiving()`'s unit tests is `src/lib/ledger-impact.test.ts` (created in the inc5 Philanthropy Dashboard work and explicitly documented as `isGiving()`'s test file in its own header comment). I extended `ledger-impact.test.ts` rather than duplicating coverage into `ledger.test.ts`, to keep a single source of truth for this function's tests. `ledger.test.ts` was untouched by this change (its diff, if any, in the working tree belongs to concurrent work on `rolledForwardOpeningCents` / DECISION-028, not this task).

### Call-site disposition (giving-predicate audit)

| Call site | File | Uses narrowed (true-gifts) predicate? | Disposition |
|---|---|---|---|
| `isGiving()` | `src/lib/ledger.ts` | Yes | Extended with `categoryCountsAsGiving` param, default-safe (omitted → included). |
| `getPhilanthropy()` — aggregate query | `src/lib/ledger-queries.ts` | Yes | LEFT JOIN + `IS NOT FALSE`-equivalent added. |
| `getPhilanthropy()` — recent-gifts query | `src/lib/ledger-queries.ts` | Yes | Same LEFT JOIN + filter added (was previously un-synced with the aggregate query's category awareness — now both match). |
| `determine990()` | `src/lib/ledger.ts` | No — untouched | Computes IRS gross-receipts/assets figures from actual income/expense totals, not a "giving" concept. Narrowing would corrupt compliance math. Confirmed no call to `isGiving()` or the fund-kind `IN (...)` predicate anywhere in its call graph. |
| `get990Prep()` | `src/lib/ledger-queries.ts` | No — untouched | 990 prep needs real expense totals (operations, insurance, fundraising costs all belong on the 990) — the opposite of what this refinement excludes. Grepped: no use of the giving fund-kind `IN (...)` predicate or `isGiving()`. |
| `getDonor()` — `givingHistory` | `src/lib/ledger-queries.ts` | No — untouched, different concept | Filters `flow='income' AND donorId=X` — this is money **received from** a donor (Foundation income), not money the club/Foundation gives out. Unrelated to `isGiving()`'s `flow='expense'` predicate; renaming risk noted only, no code change needed. |
| UI components | `src/app/`, `src/components/` | N/A | Grepped — no component calls `isGiving()` directly; `/members/impact` consumes `getPhilanthropy()`'s already-computed totals. |

### Outputs

- **Schema:** `src/lib/db/schema.ts` — `ledgerCategories.countsAsGiving: boolean("counts_as_giving").notNull().default(true)`.
- **Migration:** `drizzle/migrations/0053_ledger_category_counts_as_giving.sql` (idempotent; applied locally).
- **Files modified:**
  - `src/lib/db/schema.ts` — new column
  - `src/lib/ledger.ts` — `isGiving()` signature extended (3rd optional param `categoryCountsAsGiving?: boolean | null`); doc comment updated
  - `src/lib/ledger-queries.ts` — `getPhilanthropy()`: both queries LEFT JOIN `ledgerCategories` and filter on `countsAsGiving`; doc comment updated
  - `src/lib/ledger-impact.test.ts` — 5 new test cases (9–13)
- **`getPhilanthropy()` contract:** unchanged shape (`PhilanthropySummary` — `allTimeCents`, `currentFyCents`, `byCause`, `byFiscalYear`, `recentGifts`); only the underlying row set narrows.
- **`isGiving(row: IsGivingRow, fundKind: string, categoryCountsAsGiving?: boolean | null): boolean`** — new optional 3rd param, fully backward compatible.

### Before / after giving totals (dev DB, live SQL)

```
old_total_cents (pre-DECISION-030 predicate): 8,668,264  →  $86,682.64
new_total_cents (post-DECISION-030 predicate): 6,199,954  →  $61,999.54
difference: 2,468,310 cents = $24,683.10 excluded
```

Excluded breakdown (all `charitable` fund, matches the difference exactly):

| Category | n txns | Excluded |
|---|---|---|
| Fundraising event costs | 33 | $21,689.17 |
| Operations | 8 | $2,619.93 |
| Insurance & bonding | 2 | $374.00 |

The user's task description referenced "~$86.6k" as the old total — matches the measured $86,682.64.

### Verification

- `pnpm exec tsc --noEmit`: PASS (no output)
- `pnpm test`: PASS — 332/332 tests, 9 test files (up from the 327-passing baseline noted in the task; +5 new `isGiving()` cases)
- `pnpm build:only`: PASS — production build completed, all routes including `/members/impact` compiled
- Live SQL sanity check: see totals above; excluded-row breakdown reconciles exactly to the difference
- Dev server: `curl -sI http://localhost:3000/members/impact` → `307` (redirect to sign-in, expected `auth()` behavior for an unauthenticated request) — no 500, no new errors in dev-server output. Dev server left running per instructions.

### Open questions / handoff notes

- **Next agent: qa** (Phase 5) — verify `/members/impact` renders correctly for an authenticated, linked member and that the displayed totals match the "new" SQL total above ($61,999.54 all-time, as of this run). Also worth spot-checking that a fundraising-event-cost transaction no longer appears in "Recent gifts" if one was previously showing there.
- **Then analyst** (Phase 6) — since Phases 1–3 were condensed/skipped by user directive, Phase 6 should confirm the shipped behavior matches this work-log's design section rather than a separate Phase 1 functional-refinement doc (none exists for this change).
- The concurrent Quicken re-import mentioned in the task instructions (stamping `beneficiary_cause` values) may still be running or may have already completed by the time qa verifies — if `byCause`/totals look different from the numbers captured here, re-run the SQL check in this work-log rather than assuming a regression; `scripts/import-quicken-ledger.ts` was not touched by this task.
- If a future category needs to flip `counts_as_giving`, there is currently no admin UI for it — it's a DB-level flag only, set via migration. Worth a follow-up if the treasurer needs to toggle this without a deploy (not in scope here).
