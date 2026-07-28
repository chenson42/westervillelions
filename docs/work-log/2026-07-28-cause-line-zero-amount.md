# Work Log — Cause-line $0 amount

- **Slug:** cause-line-zero-amount
- **Title:** Allow a detailed (cause) budget line to be set to $0 by clearing the amount
- **Surface:** Admin — The Ledger, budgeting page (cause/beneficiary editor)
- **Permission(s):** existing `ledger.manage` (no new key)
- **Type:** Bug fix
- **Version:** v1.45.1

## Root cause

`BudgetCauseEditor` (`src/components/admin/ledger/budget-cause-editor.tsx`) treated an
empty amount field as a hard error on both the create (`commitCreate`) and update
(`commitUpdate`) paths — toast "Enter an amount … or remove this line" — even though
$0 is accepted everywhere below the component: the API route, `createBudgetCauseLine` /
`updateBudgetCauseLine` (reject only `< 0`), and the DB (no positive CHECK constraint;
the `// validated > 0 at app layer` schema comment was stale). Only a literally typed
`0` reached the server; the natural gesture of clearing the box was refused.

## Fix

- `commitCreate` / `commitUpdate`: a blank amount now resolves to `amountCents = 0`
  (deliberate $0) instead of erroring. Negative / NaN / over-max still rejected.
- On successful save the row's amount field normalizes to `"0.00"` so a zeroed line
  reads as $0, not an empty (unset-looking) box.
- Removal is unchanged — still the per-row trash button (`requestRemove`), which for a
  $0 committed line deletes without a confirm as before.

## Reproduction

1. Break a giving category into cause lines; on an existing line, select the amount and
   delete it (empty box), then blur → **before:** error toast, no save. **after:** saves
   as $0, box shows `0.00`, line stays.
2. "+ Add line", type a label, leave amount blank, blur → **before:** error. **after:**
   saves as a $0 line.

## Pipeline

Bug-fix variant. Phase 2 skipped (no invariant/structural change — client-only
validation loosening; API/query/DB already accepted $0). Phase 3 skipped (root cause
documented above; one-file change). Phase 4 done. Phase 5: tsc clean + 695 unit tests
pass + production build; manual click-through pending (listed in release notes).

## Confirmed reference (unchanged)

Category total is still `sum(cause lines)`; a category whose lines all read $0 has a $0
budget (valid). Approve/lock and the member-facing report figures are untouched.
