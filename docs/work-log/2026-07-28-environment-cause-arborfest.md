# Environment Cause + Arbor Fest Budget Line — Work Log

> **Slug:** `2026-07-28-environment-cause-arborfest`
> **Surface:** The Ledger budget cause taxonomy + FY2026 Foundation Charitable budget
> **Permission(s):** existing `ledger.manage` (no change)
> **Pipeline mode:** Small change (taxonomy value + one data row), documented inline

---

## What & Why

The treasurer wanted to budget **$1,000 for Arbor Fest, paid to the City of
Westerville**, under the Foundation's **Charitable donation out** category, and
to file it as **environmental**. Two blockers surfaced:

1. The budget cause taxonomy (`BUDGET_CAUSES` in `src/lib/ledger.ts`) had **no
   "Environment" value** — the in-app cause dropdown could not offer it, which
   is most likely why "adding a charity to the category" felt broken.
2. `ledger_budgets` is **empty in the local DB** (never seeded locally), so this
   is the first cause line under that category — the parent budget row had to be
   lazy-created.

Treasurer decision (2026-07-28, asked directly): **add a new "Environment"
cause** and file Arbor Fest under it; label = "City of Westerville – Arbor Fest".

## Changes

- `src/lib/ledger.ts` — added `"Environment"` to `BUDGET_CAUSES` (between
  "Community & Civic" and "Bags to Benches (Recycling)"). No DB migration:
  `cause` is a free-text column with no CHECK (DECISION-041); `isValidBudgetCause`,
  the cause dropdown (`ALL_CAUSES`), and cause-group ordering all derive from the
  array automatically. Impact "giving by cause" bucketing keys off raw
  transaction cause strings, not the enum, so it is unaffected.
- `src/lib/ledger.test.ts` — the isValidBudgetCause test iterates `BUDGET_CAUSES`
  (no hardcoded length); renamed "…each of the 8…" → "…each of the…" for accuracy.
- `scripts/add-arborfest-cause-line.ts` — one-off writer. Calls
  `createBudgetCauseLine()` (the exact function `PATCH
  /api/admin/ledger/budgets/cause-lines` uses), so the parent row is
  lazy-created, the parent total rolled up, the cause validated, and the FY lock
  respected — identical to the UI path. Dry-run by default, `--apply` to write.

## Data Written (local DB only)

Applied 2026-07-28 to the `.env.local` DB:
- Parent `ledger_budgets` c02af555-42ef-4bbe-9736-4d829a0cba2e —
  FY2026, Foundation Charitable fund, "Charitable donation out", expense,
  `annual_amount_cents = 100000`.
- Child `ledger_budget_lines` e45278cf-141d-4581-9254-77d35d752e19 —
  cause="Environment", label="City of Westerville – Arbor Fest", amount 100000.

## Verification

- `pnpm exec tsc --noEmit`: PASS. `pnpm test`: 695/695 PASS.
- Script re-read the DB after the write and confirmed parent total = child sum = $1,000.00.

## Follow-ups / Notes

- **Production:** the `"Environment"` cause ships when `main` deploys; the $1,000
  line was written to the LOCAL DB only and would need to be added to production
  separately (re-run the script with `PROD_DATABASE_URL`, or enter it in the UI
  now that the cause exists).
- **Add-line UX:** the treasurer reported the add-line/add-charity control
  "doesn't work." The concrete blocker found was the missing cause (now added).
  No separate functional defect was reproduced in code review; if the control
  still misbehaves with "Environment" available, reproduce live in the dev
  server and open a bug-fix work-log.
