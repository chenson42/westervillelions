# FY2026 Foundation Budget Cause+Label Seed (from FY2025 actuals) — Work Log

> **Slug:** `2026-07-28-fy2026-foundation-budget-seed`
> **Surface:** (dashboard) admin — The Ledger budgeting (data only; no UI/API change)
> **Permission(s):** none — this is a one-off `tsx` operational script, not a user-facing feature. Reads/writes are gated by direct DB access (treasurer-approved), not `hasFeature()`.
> **Estimated complexity:** small (single script, no schema/API/UI change)
> **Pipeline mode:** Bug-fix-variant-style / operational-script mode — **Phases 1-3 skipped explicitly.** This is a one-off treasurer-approved data-seeding script in the same family as `scripts/backfill-check-numbers.ts` and `scripts/june-close-correction.ts`, not a new feature going through the 6-phase pipeline. No new schema, no new route, no new UI. Rationale for skip: the labeled-cause-lines schema/API/UI (`docs/work-log/2026-07-28-ledger-labeled-cause-lines.md`) already shipped SHIP IT; this task only *populates* that existing shape with historical detail and was scoped directly to database-admin by the treasurer/user.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | — | Skipped (operational script, not a feature) | — | — |
| 2 — Architectural review | — | Skipped (no schema/dependency/structural change) | — | — |
| 3 — Technical design | — | Skipped (mapping fully specified by treasurer before this task started) | — | — |
| 4 — Implementation | database-admin | Complete (dry-run only) | needs-review (awaiting explicit `--apply` approval) | 2026-07-28 |
| 5 — Verification | — | Not started — no `--apply` has been run | — | — |
| 6 — Shipped vs intent | — | Not started | — | — |

---

# Phase 4 — Implementation (database-admin) — 2026-07-28

**Owner:** database-admin
**Status:** complete (dry-run only) — **apply intentionally NOT run**, per explicit task scope ("Do NOT apply / do NOT write to prod in this task")

## Summary

Wrote `scripts/seed-fy2026-foundation-budget.ts`, a dry-run-first, idempotent, `--apply`-gated script that derives cause+label `ledger_budget_lines` children for the three eligible FY2026 Foundation Charitable-fund budget rows ("Charitable donation out" $XX,XXX.XX, "Grant out" $X,XXX.XX, "Scholarships" $X,XXX.XX) from FY2025 posted actuals, per the treasurer-approved mapping rules. Ran it dry-run against **production** (Neon project `tiny-fog-13725730`, branch `production`, verified via `mcp__Neon__describe_project`/`get_connection_string` before connecting) and confirmed every derived line set sums exactly to its existing budget lump — zero mismatches, zero taxonomy warnings, nothing written.

## What I did

- Read `scripts/backfill-check-numbers.ts` and `scripts/june-close-correction.ts` for the established one-off-script conventions: `dotenv`-load `.env.local`, `PROD_DATABASE_URL || DATABASE_URL || DB_URL` target resolution, `--apply` flag gate, idempotent upsert/guarded-write patterns, dry-run-by-default.
- Read `src/lib/db/schema.ts` (`ledgerBudgets` L772-797, `ledgerBudgetLines` L799-831, `ledgerTransactions` L639-719, `ledgerCategories` L565-590, `ledgerFunds` L538-560, `ledgerEntities` L501-517) and `src/lib/ledger.ts` (`BUDGET_CAUSES`/`isValidBudgetCause`/`isCauseEligibleCategory` L544-596) to confirm the exact column shapes, the `(budget_id, cause, label)` unique constraint, and the controlled cause taxonomy.
- Confirmed via `src/lib/ledger-queries.ts` conventions that "actuals" means `status='posted'` transactions only, and that fiscal-year bounds are `txn_date >= '{fy}-07-01' AND txn_date < '{fy+1}-07-01'` (exclusive upper bound), matching this project's `fyBounds()`/`getFiscalYear()` convention.
- Designed the script to be **data-driven, not hardcoded**: it queries live FY2025 actuals for the three named categories on Foundation/Charitable, groups by `(cause, party)`, and applies a small per-category `dropLabel(party)` predicate (Qdoba dropped under "Charitable donation out"; nothing dropped under "Grant out"; everything dropped under "Scholarships") rather than hardcoding each derived line's amount — so the preview always reflects current DB state, not a snapshot.
- Built in a hard-fail safety net: for each category, the derived children's sum is compared against the existing `ledger_budgets.annual_amount_cents` lump; any mismatch prints the discrepancy and `process.exit(1)`s in both dry-run and `--apply` modes, before any write is attempted. Rows with a missing or off-taxonomy `beneficiary_cause` are excluded from the derived lines and reported as warnings — if that exclusion changes a category's sum, the same hard-fail catches it.
- Built in idempotency via `INSERT ... ON CONFLICT (budget_id, cause, label) DO UPDATE SET amount_cents = ...` (the exact unique constraint already on `ledger_budget_lines`), followed by a re-derive-from-DB-then-conditionally-update pass on the parent `annual_amount_cents` (only writes if the persisted child sum differs from the stored value) — a clean re-run after a successful apply is a no-op write.
- Verified the production target before connecting: `mcp__Neon__describe_project` on `tiny-fog-13725730` confirmed branch `production` = `br-mute-recipe-amc7uz5o`; `mcp__Neon__get_connection_string` for that branch returned the same hostname (`ep-rough-smoke-am069viy-pooler...neon.tech`) as the commented production `DATABASE_URL` line in `.env.local`, confirming that value is in fact the production branch before exporting it as `PROD_DATABASE_URL`.
- Ran `pnpm exec tsc --noEmit -p .` (clean, no errors) and then the script dry-run (no `--apply`) with `PROD_DATABASE_URL` set to the confirmed production connection string. **No `--apply` run was made — this task is dry-run/read-only only per explicit instruction.**

## Outputs

- New script: `scripts/seed-fy2026-foundation-budget.ts` (dry-run by default; `--apply` required to write; targets `PROD_DATABASE_URL` per the established convention)
- No `src/lib/db/schema.ts` change — no new tables/columns needed for this task.
- No new migration file — this is a data-only operation against existing tables (`ledger_budget_lines`, `ledger_budgets`), not a schema change.
- Tables touched (on a future `--apply` only): `ledger_budget_lines` (INSERT/UPSERT), `ledger_budgets` (`annual_amount_cents` UPDATE, conditional on drift). No `ledger_transactions` row is ever read for a write or modified.
- No role/permission/seed-row changes — this script has no `FEATURES` gate; it's a treasurer-directed operational script run by a human with prod DB credentials, same trust model as `backfill-check-numbers.ts`/`june-close-correction.ts`.

### Dry-run preview (production, 2026-07-28) — full output

```
Mode: DRY RUN (no writes)
Target: PRODUCTION (PROD_DATABASE_URL)
Source: FY2025 Foundation Charitable-fund actuals (2025-07-01 .. 2026-06-30, status='posted')
Target budget: FY2026 Foundation Charitable-fund expense budget rows
Categories in scope: Charitable donation out, Grant out, Scholarships

Resolved FY2026 budget rows (existing lump sums):
  "Grant out"                 $X,XXX.XX
  "Charitable donation out"   $XX,XXX.XX
  "Scholarships"              $X,XXX.XX

Fetched 26 FY2025 posted expense actuals across the 3 target categories.

CATEGORY: "Grant out"
  Hunger & Basic Needs   Westerville Area Resource Ministry   $X,XXX.XX
  Hunger & Basic Needs   Heritage Middle School PTSA            $XXX.XX
  Community & Civic      The City of Westerville                $XXX.XX
  Derived child sum: $X,XXX.XX  |  Existing parent lump: $X,XXX.XX  |  MATCH

CATEGORY: "Charitable donation out"
  Hunger & Basic Needs           Westerville Area Resource Ministry    $X,XXX.XX
  Youth & Education              Gates At Eight (combines 2 rows)      $X,XXX.XX
  Hunger & Basic Needs           Westerville Caring and Sharing        $X,XXX.XX
  Vision & Eye Care              Pilot Dogs, Inc.                      $X,XXX.XX
  Vision & Eye Care              Central Ohio Lions Eye Bank           $X,XXX.XX
  Vision & Eye Care              OLF Eye Care Fund                     $X,XXX.XX
  Vision & Eye Care              Foundation Fighting Blindness         $X,XXX.XX
  Health & Disability            Ohio Lions Pediatric Cancer Foundation $X,XXX.XX
  Lions International Programs   Lions Clubs International Foundation  $X,XXX.XX
  Lions International Programs   Ohio Lions Foundation                 $X,XXX.XX
  Vision & Eye Care              Ohio Lions Eye Research Foundation     $XXX.XX
  Health & Disability            Camp Echoing Hills Campership          $XXX.XX
  Youth & Education              (generic — folds Qdoba)                $XXX.XX
  Hunger & Basic Needs           The Big Bus                            $XXX.XX
  Vision & Eye Care              VOSH/Ohio                               $XXX.XX
  Vision & Eye Care              OSSBPTS Foundation                      $XXX.XX
  Health & Disability            Westerville Special Olympics            $XXX.XX
  Vision & Eye Care              Ohio Lions Foundation (Vision, distinct cause) $XXX.XX
  Health & Disability            Central Ohio Diabetes Association       $XXX.XX
  Derived child sum: $XX,XXX.XX  |  Existing parent lump: $XX,XXX.XX  |  MATCH

CATEGORY: "Scholarships"
  Youth & Education   (generic — combines 3 individual scholarship recipients)   $X,XXX.XX
  Derived child sum: $X,XXX.XX  |  Existing parent lump: $X,XXX.XX  |  MATCH

GRAND TOTAL: existing lumps $XX,XXX.XX  ==  derived children $XX,XXX.XX

No taxonomy or missing-cause warnings — every FY2025 row in scope carried a valid BUDGET_CAUSES value.

DRY RUN COMPLETE — no DB writes.
```

All three categories reconcile exactly; the "Charitable donation out" 20 source rows (18 single rows + Gates At Eight's 2 combined rows) match the treasurer's stated count exactly, and Ohio Lions Foundation correctly produced two distinct lines (Lions International Programs $X,XXX.XX / Vision & Eye Care $XXX.XX) since grouping is by `(cause, party)`, not `party` alone.

### Local apply command (for reference — NOT run this session)

```bash
export PROD_DATABASE_URL=<production connection string>
pnpm exec tsx scripts/seed-fy2026-foundation-budget.ts            # dry run again, re-confirm before applying
pnpm exec tsx scripts/seed-fy2026-foundation-budget.ts --apply    # writes to PRODUCTION — separate explicit approval required
```

## Open questions / handoff notes

- **Waiting on explicit treasurer/user approval to run `--apply`.** This task's instructions were dry-run/preview only; the apply step is a separate, explicit go-ahead. Nothing has been written to production.
- No `api-developer`/`ux-developer` follow-up needed — this seed only populates data behind the already-shipped Ledger budgeting UI (`docs/work-log/2026-07-28-ledger-labeled-cause-lines.md`), which already renders `ledger_budget_lines` rows grouped by cause with per-cause subtotals. Once applied, the treasurer should see the new labeled lines appear automatically on `/admin/ledger/budgeting` and the Charitable fund's `/report` page for FY2026 — no code deploy required.
- After `--apply` is eventually run, recommend a quick manual click-through of `/admin/ledger/budgeting` (FY2026, Foundation, Charitable fund) to visually confirm the grouped display renders as expected with this many labeled lines under a few causes (e.g. 6 "Vision & Eye Care" lines under "Charitable donation out") — this is more lines-per-cause than any existing production data has exercised so far.
- The script is safely re-runnable (dry-run or `--apply`) at any point in the future if the treasurer wants to re-preview or re-apply after further FY2025 corrections — it always re-derives from current DB state, never from a hardcoded snapshot.
