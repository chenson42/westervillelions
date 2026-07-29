# Budget Live Totals Stale — Work Log (Bug Fix)

> **Slug:** `2026-07-28-budget-live-totals-stale`
> **Surface:** (dashboard) admin — The Ledger budgeting (`/admin/ledger/budgeting`)
> **Permission(s):** existing `ledger.manage` / `ledger.approve` (no change)
> **Pipeline mode:** Bug-Fix Variant

---

## Per-Phase Status

| Phase | Owner | Status | Notes |
|-------|-------|--------|-------|
| 1 — Analyst (confirm bug real) | — | Done (inline) | Bug confirmed real; fix preserves intended behavior. |
| 2 — Architect | — | **Skipped** | No invariant touched — client-state sync only, no schema/API/dep change. |
| 3 — Tech-lead | — | Brief (inline) | Root cause documented below. |
| 4 — Implementation | full-stack | Done | Client-state re-sync in `guided-budget-setup.tsx`. |
| 5 — QA | qa | Typecheck + tests pass | `tsc --noEmit` clean; 695/695 unit tests pass. Dev-server click-through pending. |
| 6 — Analyst | — | Pending | Confirm totals track edits + refresh. |

## Change Applied

`src/components/admin/ledger/guided-budget-setup.tsx`:
- Extracted `seedLineValues(funds)` / `seedPendingDeleteKeys(funds)` module helpers
  so the `useState` initializers and the new re-sync build the maps identically.
- Added a `useEffect` keyed on `funds` that re-seeds both maps on every server
  re-render (`router.refresh()` / page load), fixing the frozen-at-mount totals.
- `computeFundLineSums` (the pure summing helper) is unchanged — no test churn.

---

## Root Cause

The v1.46.0 live Income / Expenses / Banked-used running totals on the budgeting
page are summed (via `computeFundLineSums`) from two React state maps in
`src/components/admin/ledger/guided-budget-setup.tsx`:

- `lineValues` — `${categoryId}_${flow}` → live dollar value in cents
- `pendingDeleteKeys` — `${categoryId}_${flow}` → pending-delete flag

Both are seeded by `useState` **lazy initializers** that run only once, on first
mount. Every successful budget edit calls `router.refresh()`, which re-renders
the Server Component page and passes a new `funds` prop with updated
`budgetCents` / `pendingDeleteAt` — but a `useState` initializer never re-runs,
so the totals state is frozen at its mount-time value.

Per-keystroke typing updates the totals correctly (`BudgetEditor`'s
`onInputChange` optimistically patches the single edited key), but any change
that arrives via a server refresh instead of a keystroke goes stale:

- Adding a category (`+ Add category`, `router.refresh()`)
- Restoring a soft-deleted line (`requestRestore` zeroed the line value on
  removal; restore fixes the pending-delete flag but the value stays 0 until a
  reseed)
- A cause-breakdown commit the server normalized
- The corrected/normalized server value after any ordinary commit

## Fix

Extract the seed logic into two pure helpers and re-seed both `lineValues` and
`pendingDeleteKeys` from the `funds` prop whenever `funds` changes (a
`useEffect` keyed on `funds`). Because `funds` is a prop from the Server
Component, its identity changes only on a server re-render (`router.refresh()` /
navigation) — never on the island's own `setState` — so the reseed fires exactly
on refresh/page-load and does not clobber in-flight typing (which only ever
happens before a commit/refresh).

## Reproduction

1. `/admin/ledger/budgeting`, sign in with `ledger.manage`.
2. Note a fund's Income / Expenses / Banked-used totals.
3. Use `+ Add income category` (or restore a removed line) — a server round-trip
   with `router.refresh()`.
4. **Before fix:** the totals do not reflect the added/restored line.
   **After fix:** the totals reflect server truth on every refresh.

## Phases Skipped

- **Phase 2 (Architect):** skipped — no invariant, schema, API contract, or
  dependency touched. Client state-sync only.
