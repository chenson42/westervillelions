# Prior-Year Reference on Cause/Beneficiary Budget Lines — Work Log

> **Slug:** `2026-07-28-causeline-prior-year-reference`
> **Surface:** (dashboard) admin — The Ledger budgeting (cause-line editor)
> **Permission(s):** existing `ledger.manage` covers it — confirm Phase 1/3
> **Estimated complexity:** medium (the genuinely new part is prior-year ACTUAL aggregated at (category, cause, beneficiary) grain + the label↔party matching)
> **Pipeline mode:** Full
> **Follow-up to:** budgeting redesign Increment 1 (v1.44.0) — which added prior-year Budget/Actual reference columns at CATEGORY grain only.

## Treasurer's request (2026-07-28)
"I don't see the prior actual and prior budget in the **detailed budget lines** — they're only in the rolled-up by-category entries!" → The v1.44.0 reference columns (Prior Budget / Prior Actual) show on each **category** row (`BudgetEditor`) but NOT on each **cause/beneficiary line** inside a category's breakdown (`BudgetCauseEditor`, the v1.41 labeled lines — e.g. WARM, Caring & Sharing under "Charitable donation out"). The treasurer wants the same prior-year reference on those detailed lines. Flagged **important**.

## The crux (Phase 1/3 must resolve)
Increment 1's Phase 1 deferred this as "cause-line-grain prior-year reference — a new aggregation this codebase doesn't have." The two figures differ in difficulty:
- **Prior-year ACTUAL per cause line (the hard/valuable part):** each cause line is `(cause, label)` where `label` ≈ the beneficiary/payee. Prior-year actual for it = sum of PRIOR-FY `ledger_transactions` in that fund+category where `beneficiary_cause = cause` AND the payee matches `label`. There is PRECEDENT to reuse: `computeCauseSeedForCategory`/`deriveCauseSeedLines` in `ledger-queries.ts`/`ledger.ts` already group prior-year actuals by `(cause, party)` to propose seed lines. The **label↔party matching** is the nuance — seeded labels came FROM `party` (exact), but a manually-typed label may not match any prior party (→ prior actual blank/$0 for that line). Phase 1 must define the match rule + the no-match behavior.
- **Prior-year BUDGET per cause line:** from the PRIOR FY's `ledger_budget_lines` matching `(cause, label)`. Note: **no FY2025 budget exists yet** (see B-25 / the approved-budget entry task), and even once entered, cause-line-grain budget detail is optional — so this column will be blank until prior-FY cause-line budgets exist. Confirm that's acceptable (Prior Actual is the immediately-useful one).

## Existing code to build on (reuse, don't reinvent)
- `getFundReport` (`src/lib/ledger-queries.ts`) — its `FundReportCategoryLine.causeLines[]` already carry `{ id, cause, label, amountCents }`. This feature adds `priorBudgetCents`/`priorActualCents` per cause line (mirroring what v1.44.0 added at category grain).
- The v1.44.0 category-grain reference: `budgeting/page.tsx` fetches `getFundReport` at `priorFY` and threads `priorBudgetCents`/`priorActualCents` into `BudgetEditor`. This feature extends that to the cause-line grain + `BudgetCauseEditor`.
- `computeCauseSeedForCategory`/`deriveCauseSeedLines` — the existing `(cause, party)` prior-actual grouping to reuse for prior-year actual per cause line.
- `BudgetCauseEditor` (`src/components/admin/ledger/budget-cause-editor.tsx`) — the grouped cause/label editor that must render the new reference columns per line, matching `BudgetEditor`'s treatment.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Compressed (accelerated pipeline) | — | 2026-07-28 |
| 2 — Architectural review | architect | Compressed (accelerated pipeline) | — | 2026-07-28 |
| 3 — Technical design | tech-lead | Compressed (accelerated pipeline) | — | 2026-07-28 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-07-28 |
| 4 (loop-back, bug fix) | ux-developer | Complete — see `2026-07-30-prior-year-line-items.md` | — | 2026-07-30 |
| 5 — Verification | qa | Pending — see `2026-07-30-prior-year-line-items.md` | — | — |
| 6 — Shipped vs intent | analyst | Pending — see `2026-07-30-prior-year-line-items.md` | — | — |

## Accelerated-Pipeline Note (Phases 1–3 compressed)

Treasurer time-pressed; ran the compressed pipeline mode. Rationale: this is a
straight additive extension of v1.44.0's already-shipped, already-reviewed
category-grain reference pattern — same permission (`ledger.manage`/
`ledger.approve`, unchanged), same page, same visual treatment, no schema
change, no new route. The "crux" the brief called out for Phase 1/3 to
resolve was: (a) how to match a cause line's `(cause, label)` to a prior-FY
`(cause, party)` actual, and (b) what a missing prior-FY budget looks like.
Both are resolved directly in Phase 4 below rather than in a separate design
doc — see "The matching approach." No architectural review was warranted: no
new directory, no new dependency, no new server/client boundary (the existing
`getFundReport` / `budgeting/page.tsx` / `BudgetCauseEditor` split is reused
as-is).

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

[READY FOR DESIGN | READY WITH NOTES | NEEDS REWORK | NOT YET]

## ONE-LINE TAKE

> [The feature in one honest sentence.]

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| [anonymous public visitor / signed-in member / admin] | [verb] | [on demand / per session / one-time] |

## Flows

**Flow 1 — [name]:** [entry → step → step → outcome]
- Failure: [what the user sees if a step goes wrong]

**Flow 2 — [name]:** [...]

## Permissions

- **Permission(s):** [new `FEATURES.KEY`, or existing key reused]
- **Default roles:** [list]

## Gaps the Request Didn't Address

- [Gap, why it matters, suggested resolution]

## Out of Scope (confirm with user)

- [Thing the request implies but isn't in scope]

## Open Questions

- [Question for the user]

---

# Phase 2 — Architectural Review (architect)

## Verdict

[Approved | Approved with suggestions | Needs revision]

## Placement

- Directory placement: [src/...]
- Server vs Client split: [where 'use client' is needed and why]
- Dependencies: [new dep needed (yes/no), evaluation against criteria]

## Invariants Touched

- [Invariant, how this change respects it (or how it changes it — requires CLAUDE.md update)]

## Notes

[Anything Phase 3 must honor.]

---

# Phase 3 — Technical Design (tech-lead)

## Summary

[One paragraph: what we're building and why.]

## Permissions

- Permission key(s): `area.action`
- Default role bindings: [list]

## API Contract

- `POST /api/...` — purpose, request body, response shape
- `GET /api/...` — purpose, query params, response shape
- Or server-action signatures: `async function actionName(input): Promise<Result>`

## Data Model

[New tables / columns / indexes, or "No schema changes required."]

## Component / Page Plan

- Pages to create: [list]
- Components to create: [list]
- Files to modify: [list]

## Implementation Order

1. Schema (if any) → add migration in `drizzle/migrations/` and update `src/lib/db/schema.ts`
2. `FEATURES` entry in `src/lib/permissions.ts` + role binding migration
3. Route handlers / server actions
4. UI
5. Email notification (if applicable) — enqueue via `sendEmail` in `src/lib/email.ts`
6. Release notes entry

## Edge Cases & Risks

- [Thing that could fail or that needs special handling]

## Implementer

[database-admin | api-developer | ux-developer | full-stack-developer]

---

# Phase 4 — Implementation (full-stack) — 2026-07-28

**Owner:** full-stack-developer
**Status:** complete

### Summary

Extended v1.44.0's category-grain "Prior Budget / Prior Actual" reference
columns down to the cause/beneficiary lines inside a category's breakdown
(`BudgetCauseEditor`). `getFundReport` now also returns a
`causeActualsByKey` map (posted expense actuals grouped by
`(categoryId, cause, party)`) computed from data it already fetches — no
extra query. `budgeting/page.tsx` matches each current cause line's
`(categoryId, cause, label)` against the prior-FY report's own cause lines
(for Prior Budget) and against that same `causeActualsByKey` map (for Prior
Actual), threading both into `BudgetCauseEditor`, which renders them
read-only exactly like `BudgetEditor`'s existing columns.

### What I did

- Added two pure helpers to `src/lib/ledger.ts`: `causeLineReferenceKey(categoryId, cause, labelOrParty)` (the shared normalization/keying function) and `buildCauseActualsByKey(rows)` (groups posted expense actuals into a lookup by that key).
- Extended `getFundReport` (`src/lib/ledger-queries.ts`) to compute `causeActualsByKey` from `postedTxns` it already fetches (expense-flow only, non-blank `beneficiaryCause`) and added it to the `FundReport` type as a new top-level, additive field. Updated the other `FundReport`-shaped builder (`getEntityReport`) to supply `causeActualsByKey: {}` (that report never surfaces cause lines, so nothing to compute).
- Wired `budgeting/page.tsx` to build `priorCauseBudgetByKey` (from the prior-FY report's own `causeLines`, keyed the same way) and read `priorReport.causeActualsByKey` directly, then enrich each current cause line with `priorBudgetCents`/`priorActualCents` before handing it to `BudgetCauseEditor`.
- Extended `BudgetCauseLine` (`src/components/admin/ledger/budget-cause-editor.tsx`) with optional `priorBudgetCents`/`priorActualCents`, seeded them into the component's local `Row` state at mount (fixed, read-only — never recomputed as the treasurer edits label/amount), and rendered them via a new local `ReferenceValue` component (identical markup/formatter to `BudgetEditor`'s) in a `grid grid-cols-2 gap-2 max-w-xs` block above each line's controls — same stacking pattern already proven at 360px for the category grain.
- Left `budget-print-worksheet.tsx` untouched — it's category-level only, out of scope per the brief.
- Wrote hermetic Vitest coverage for the matching logic and the regression guard (see Tests below).

### The matching approach

- **Prior Actual (the hard part):** `getFundReport` groups this FY's own posted, expense-flow transactions by `(categoryId, cause, party)` — the same shape `computeCauseSeedForCategory` conceptually needs but that function only ever grouped by bare `cause` (no party dimension existed in the codebase before this change; the brief's premise that a `(cause, party)` grouping already existed was checked against the actual code and found not to — `deriveCauseSeedLines`/`computeCauseSeedForCategory` group by `cause` alone). The caller (`budgeting/page.tsx`) already fetches `getFundReport(fund.id, priorFY)` for the category-grain reference — its `causeActualsByKey` is read directly, no new query.
- **Key/normalization:** `causeLineReferenceKey(categoryId, cause, labelOrParty)` builds `` `${categoryId}::${cause}::${normalizeBudgetLineLabel(labelOrParty)}` `` — trim-only normalization (reusing `normalizeBudgetLineLabel`, DECISION-047's existing label semantics), so `" WARM "` and `"WARM"` collide but `"WARM"` and `"Warm"` remain distinct. `categoryId` is folded in because a cause name is only unique within one category's budget row.
- **No-match behavior:** a cause line whose label doesn't match any prior-FY party (or any prior-FY cause line, for the budget half) gets `null` for that field, which `formatBudgetReferenceCents` renders as "—". The generic/unlabeled line (`label === ""`) matches only prior-FY transactions with a blank/null party — it is deliberately NOT a catch-all for every party under that cause.
- **Prior Budget:** matched from the prior-FY report's own `causeLines` (already fetched) by the same key. `null` when FY2025 has no budget line for that `(cause, label)` yet (expected today — no FY2025 budget entered), or when FY2025 has a budget but no line for that specific label.

### Outputs

- `src/lib/ledger.ts` — added `causeLineReferenceKey`, `buildCauseActualsByKey`, `type CauseActualSourceRow`.
- `src/lib/ledger-queries.ts` — `FundReport` type gained `causeActualsByKey: Record<string, number>`; `getFundReport` computes it; `getEntityReport`'s `FundReport` construction supplies `causeActualsByKey: {}`.
- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` — builds `priorCauseBudgetByKey`/`priorCauseActualsByKey` and enriches each cause line via a new `enrichCauseLines` helper before passing to `GuidedBudgetSetup`/`BudgetEditor`/`BudgetCauseEditor`.
- `src/components/admin/ledger/budget-cause-editor.tsx` — `BudgetCauseLine` type, `Row` type, `ReferenceValue` component, seed logic, `addRow`, and the per-line render block.
- `src/lib/ledger.test.ts` — new `describe` blocks: `causeLineReferenceKey` (4 tests), `buildCauseActualsByKey` (6 tests).
- `src/lib/ledger-queries.test.ts` — new `describe("getFundReport — causeActualsByKey")` block (3 tests): grouping/filtering, the budget-vs-actual independence regression, and the empty-fund case.
- No schema change. No new `FEATURES` entry (existing `ledger.manage`/`ledger.approve` gates the page, unchanged). No env var.
- Decision: none logged to `docs/decisions.md` — this doesn't introduce a new pattern, it extends an already-decided one (v1.44.0's reference-column pattern) to a second grain.

### Tests

- `causeLineReferenceKey`: trim collision, case-sensitivity (no fold), null/undefined → generic `""` slot, categoryId folded into the key (no cross-category collision).
- `buildCauseActualsByKey`: label matches prior party → summed actual; label with no matching party → no entry (caller reads `undefined` as `null`); trim normalization matches the key's; generic (`""`) label matches only null/blank-party rows, not every party under that cause; different categories with the same `(cause, party)` never collide; empty input → `{}`.
- `getFundReport — causeActualsByKey`: (1) groups posted expense actuals by `(categoryId, cause, party)` while excluding pending rows, income-flow rows, and blank/whitespace-only-cause rows — and confirms the pre-existing `actualCents`/`totalExpenseCents` figures still include every posted expense row regardless of cause tag; (2) regression — with both a budget breakdown (`causeLines[].amountCents`) and cause-tagged actuals present, asserts the budget figures and the new `causeActualsByKey` actual figures are computed independently (deliberately different numbers, proving no conflation) and that `causeLines[].amountCents`/`budgetCents` are exactly what the budget lines say; (3) empty fund → `causeActualsByKey` is `{}`, not a throw.

### Verification run

- `pnpm exec tsc --noEmit`: PASS (exit 0).
- `unset DATABASE_URL DB_URL; pnpm test`: PASS — 686/686 (673 baseline + 13 new: 10 in `ledger.test.ts`, 3 in `ledger-queries.test.ts`).
- `pnpm build:only`: PASS (exit 0), full route manifest printed, no errors.
- No `console.log` added. No native browser dialogs touched. Existing `getFundReport` committed figures (`budgetCents`, `causeLines[].amountCents`, `actualCents`, `totalIncomeCents`/`totalExpenseCents`/`endingCents`) verified byte-identical — confirmed both by the new regression test above and by the pre-existing "pending-delete regression guard" byte-for-byte test in `ledger-queries.test.ts`, which still passes untouched.

### Open questions / handoff notes

- **Manual/browser check for qa (Phase 5):** On `/admin/ledger/budgeting`, open a fund's expense category that's broken down by cause (e.g. "Charitable donation out"). Each cause/beneficiary line should now show its own "Prior Budget" / "Prior Actual" reference pair above the label/amount controls:
  - **Prior Budget** should read "—" for every line today (no FY2025 budget has been entered yet at any grain) — this is expected, not a bug.
  - **Prior Actual** should be populated (a real dollar figure, not "—") for any line whose label matches a party/payee that had posted expense transactions tagged with that cause in FY2025 — e.g. a line labeled "WARM" under "Hunger & Basic Needs" should show FY2025's actual WARM disbursements if any were tagged that way.
  - A freshly-typed label with no FY2025 match should show "—" for Prior Actual — correct, not a bug.
  - Check at 360px width (mobile) that the two reference cells stack/shrink cleanly next to the label/amount row, matching the category-grain rows above them.
  - Confirm the category-grain "Prior Budget"/"Prior Actual" columns (v1.44.0, unaffected by this change) still render correctly alongside the new cause-line columns.
- Nominate **qa** for Phase 5.
- Once QA passes, nominate **analyst** for Phase 6 (shipped-vs-intent).
- Per the brief: no version bump, no release-notes entry, no commit — left for the user's explicit approval.

---

# Phase 5 — Verification (qa)

**Status as of 2026-07-30:** Not run in this form. This feature shipped to `main` in v1.45.0 with
Phases 5 and 6 left as template placeholders (never executed) — flagged as a process gap by the
2026-07-30 analyst pass in `docs/work-log/2026-07-30-prior-year-line-items.md` ("Bug Finding" section).
That same pass found and diagnosed a real bug this skipped QA step would have caught: a cause line
added/edited in the current browser session never picked up its Prior Budget/Prior Actual reference
values without a hard page reload (see that file's Section 3 for the full root-cause writeup).

**The bug is now fixed** — see `docs/work-log/2026-07-30-prior-year-line-items.md`, section
"Bug Fix — Phase 4 Implementation (ux-developer) — 2026-07-30" for the fix itself (a reconciliation
`useEffect` in `BudgetCauseEditor`), its rationale, and the new e2e regression coverage
(`e2e/prior-year-cause-line-reconcile.spec.ts`).

**Next step:** qa should run Phase 5 for real against the fix — `pnpm exec tsc --noEmit`,
`pnpm build:only`, `pnpm test:e2e -- prior-year-cause-line-reconcile`, and the manual click-through
named in that section's "Open questions / handoff notes" (add a cause line whose label matches a
committed prior-FY line, confirm Prior Budget populates on blur with **no reload**) — the exact
interaction the original Phase 5 never exercised. Do not re-fill this section separately; qa's
verdict belongs in the 2026-07-30 file's Phase 5 alongside the fix it's verifying.

## Verdict

Deferred to `docs/work-log/2026-07-30-prior-year-line-items.md` Phase 5 (qa, pending).

---

# Phase 6 — Shipped vs Intent (analyst)

**Status as of 2026-07-30:** Deferred to `docs/work-log/2026-07-30-prior-year-line-items.md` Phase 6
(analyst), pending that file's Phase 5 (qa) passing. Once qa signs off on the bug fix, analyst should
close out BOTH this file's and the 2026-07-30 file's Phase 6 in one pass — the shipped-vs-intent
question here is now inseparable from "did the loop-back fix actually resolve it," which only that
file's context (Section 3's root-cause writeup + the Phase 4 fix section) fully carries.

## VERDICT

Deferred — see above.
