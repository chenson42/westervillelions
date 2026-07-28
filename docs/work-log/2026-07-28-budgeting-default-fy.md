# Budgeting page defaulted to next fiscal year, hiding the current year's budget — Work Log

> **Slug:** `2026-07-28-budgeting-default-fy`
> **Surface:** (dashboard) admin — The Ledger budgeting
> **Estimated complexity:** small (one-line default change)
> **Pipeline mode:** Bug-fix variant — architect/tech-lead skipped (trivial default change, explicit treasurer request)

## Root cause
`/admin/ledger/budgeting` defaulted `targetFY = currentFiscalYear() + 1` ("guided setup is inherently
next year's budget"). But this club budgets the CURRENT year at its start (today 2026-07-28 = start of
FY2026). So the page opened on FY2027 — which had category totals (a carried-forward shell) but no
cause-line breakdowns — making the just-seeded FY2026 cause breakdowns look absent. The treasurer
confirmed they budget the current year.

## Fix
Default `targetFY = currentFiscalYear()` (the current year). Future years remain reachable via the
`?fy=` selector; `fyOptions` already offered [currentFY, +1, +2]. One-line change + comment.

## Reproduction
Open `/admin/ledger/budgeting` on 2026-07-28 with FY2026 seeded → page shows FY2027 (no breakdowns).
After fix → page shows FY2026 (the seeded cause breakdowns render).

## Phases skipped
Analyst/architect/tech-lead skipped — explicit treasurer request, trivial default value change, no new
surface. qa: covered by tsc + build (behavior is a default value; no logic branch added).

## Related
- The stray FY2027 Foundation budget shell (lump sums, no cause lines) is being removed separately at
  the treasurer's request (2026-07-28) — it was created by landing on the next-year default.
