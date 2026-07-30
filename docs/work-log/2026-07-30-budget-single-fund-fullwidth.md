# Budgeting single-fund full-width — Work Log (bug-fix stub)

> **Slug:** `2026-07-30-budget-single-fund-fullwidth`
> **Surface:** (dashboard) admin — budgeting page (`src/components/admin/ledger/guided-budget-setup.tsx`)
> **Pipeline mode:** Bug-fix variant (trivial CSS)

## Root cause
The per-fund review cards were wrapped in `grid grid-cols-1 lg:grid-cols-2`, so on wide screens a
single-fund entity (the Foundation, which has only the Charitable Fund) filled one column and left the
right half of the screen empty.

## Fix
`guided-budget-setup.tsx` (~line 904): grid is now
`grid grid-cols-1 gap-4 ${funds.length > 1 ? "lg:grid-cols-2" : ""}` — two columns only when there is
more than one fund; a single fund spans full width. (Also correctly handles the Club once the Activity
Fund is excluded from budgeting and it drops to one budgeted fund.)

## Reproduction / verification
- Repro: open the budgeting page for the Foundation → Charitable Fund card rendered at half width.
- Verify: `pnpm exec tsc --noEmit` clean. Manual: Foundation fund card now full width; Club (2 funds)
  still two columns on large screens; both stack on small screens.

## Phases
Phases 1–3 skipped (trivial layout fix, no logic/schema/permission change). Ships with the next release.
