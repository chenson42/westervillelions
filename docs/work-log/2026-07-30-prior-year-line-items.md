# Prior-Year Cause Line Items: Reference + Carry-Forward — Work Log

> **Slug:** `2026-07-30-prior-year-line-items`
> **Surface:** (dashboard) admin — The Ledger budgeting page (`budget-editor.tsx` + `budget-cause-editor.tsx`) and the prior-reference/seed query layer (`ledger.ts` / `ledger-queries.ts`)
> **Permission(s):** existing `ledger.manage` / `budget.edit` (Budget Committee) covers all of this — no new key
> **Estimated complexity:** medium
> **Pipeline mode:** Full — but see the **Bug Finding** below, which is a separate, higher-priority loop-back on an existing, unfinished work-log
> **Backlog:** B-37

---

## Trigger — treasurer report (2026-07-30)

While building the FY2026 **Foundation → Charitable donation out → Vision & Eye Care** budget and
adding cause line items (e.g. "Pilot Dogs"), the treasurer sees **no prior budget and no prior
actuals** for the line item they just added.

## Before Phase 1: what I found reading the code and querying the live data

This needed grounding in both code and the actual database, because the premise in B-37's backlog
text ("prior actuals per line is the hard, unbuilt part, options weighed include waiting on B-30")
turned out to be **stale**. That work already shipped. What's actually happening is more specific
and more useful to know.

### 1. Prior Budget / Prior Actual already exist at the cause-LINE-ITEM grain — this is not new work

`docs/work-log/2026-07-28-causeline-prior-year-reference.md` designed and shipped exactly this, in
commit `5340fcd` (`v1.45.0: budget-balance overview, cause-line prior-year reference, budget-line
soft-delete, Administrative fund first`). Confirmed live in the current tree:

- `causeLineReferenceKey(categoryId, cause, labelOrParty)` (`src/lib/ledger.ts:1658`) builds the key
  `` `${categoryId}::${cause}::${normalizeBudgetLineLabel(labelOrParty)}` ``. `normalizeBudgetLineLabel`
  (`ledger.ts:668`) is **trim-only** — no case-folding, no punctuation stripping.
- `getFundReport` (`src/lib/ledger-queries.ts:530`) computes `causeActualsByKey`: posted, expense-flow
  transactions for that fund+FY grouped by `(categoryId, cause, party)` via `buildCauseActualsByKey`.
- `budgeting/page.tsx` (lines 149–220) fetches `getFundReport` at both `targetFY` and `priorFY`, builds
  `priorCauseBudgetByKey` from the prior FY's own committed `causeLines[]`, reads
  `priorReport.causeActualsByKey` directly, and enriches every current-FY cause line's
  `priorBudgetCents`/`priorActualCents` via `enrichCauseLines()` before handing them to
  `BudgetCauseEditor`.
- `BudgetCauseEditor` renders both as read-only `ReferenceValue` cells per line
  (`budget-cause-editor.tsx:1098-1099, 1145-1146`).

**So "prior actuals per line requires B-30" is not correct today.** The soft-join match
`(categoryId, cause, label≈party)` already computes and renders this, with no dependency on B-30's
explicit transaction→budget-line FK. B-30 would make the match *exact and drift-proof*, but the
current heuristic already works for the common case (see the WARM / Foundation Fighting Blindness /
Ohio Lions Eye Research Fund lines in the FY2025 data, which all carry both figures correctly today).

### 2. Why "Pilot Dogs" specifically shows "—" — confirmed against the live database, not guessed

I queried the dev/prod Neon project (`tiny-fog-13725730`) directly:

- **FY2025 already has a `ledger_budget_lines` row**: `cause='Vision & Eye Care'`, `label='Pilot Dogs'`,
  `amountCents=100000`, under the **same** `fund_id` (`d0e4bade-...`) and **same** `category_id`
  (`91165dec-...`, "Charitable donation out") as the FY2026 line the treasurer just added — an
  **exact key match**. Per the code above, this should populate `priorBudgetCents = $1,000` on a
  correct render.
- **FY2025 and FY2024 both have posted `ledger_transactions`** with `beneficiary_cause='Vision & Eye
  Care'`, `amount_cents=100000`, same `category_id` — but `party = 'Pilot Dogs, Inc.'` (note the
  `", Inc."` suffix). `normalizeBudgetLineLabel` is trim-only, so the key for the transaction
  (`...::Pilot Dogs, Inc.`) does **not** match the key for the budget label (`...::Pilot Dogs`). This
  half is a genuine, confirmed accuracy gap — real payee-name drift, exactly the class of problem
  B-30's backlog text names ("the payee is often a poor description of the budgeted intent and drifts
  year to year").

So the two reference cells have two **different** root causes:

| Cell | Root cause | Is it a bug? |
|---|---|---|
| Prior Actual | `label` ("Pilot Dogs") vs. `party` ("Pilot Dogs, Inc.") — punctuation drift breaks the exact-match key | Confirmed accuracy gap (real, not hypothetical — same club, same gift, two spellings) |
| Prior Budget | Data matches exactly (same fund, category, cause, label, both FYs) — should render $1,000 | **This one is a bug, not a data gap — see below.** |

### 3. The Prior Budget bug: newly-added cause lines never pick up their reference values client-side

Traced why a line whose key *does* match still shows "—" for Prior Budget. `BudgetCauseEditor`'s
local `rows` state is seeded once via `useState(() => initialLines.map(...))`
(`budget-cause-editor.tsx:345-357`) — the `priorBudgetCents`/`priorActualCents` on each row are, per
the component's own doc comment, "**Fixed at seed time from `initialLines` — read-only reference,
never recomputed as the treasurer edits label/amount**."

When the treasurer clicks "+ Add cause" / "+ Add line item", `addRowForCause()`
(`budget-cause-editor.tsx:756-767`) creates the new row with **`priorBudgetCents: null,
priorActualCents: null`** hardcoded — correct at that instant, since no label has been typed yet to
look up. The treasurer then types "Pilot Dogs" and blurs; `commitCreate()` (line 605) PATCHes
`/api/admin/ledger/budgets/cause-lines`, and on success calls `setRows(...)` — but that update only
copies back `id`, `cause`, `label`, `value` from the response (lines 648-663). It does **not**
recompute `priorBudgetCents`/`priorActualCents`. `commitCreate` then calls `router.refresh()` (line
671), which re-runs the server component tree with fresh `initialLines` props (now correctly carrying
`priorBudgetCents: 100000` for "Pilot Dogs") — but `BudgetCauseEditor` never remounts (no `key` change
on it) and has no `useEffect` reconciling `rows` state against the new `initialLines` prop. The stale,
`null`-seeded row survives untouched.

**Net effect:** a cause line item added and committed in the current browser session will show "—"
for Prior Budget/Prior Actual for the rest of that session, **even when a matching prior-FY value
exists**, until the treasurer does a hard full-page reload (not just navigating within the app). This
exactly reproduces the treasurer's report — they added "Pilot Dogs," it saved, and the reference cells
never updated in front of them.

**This is a real, previously-unshipped-through-QA bug**, not a design gap. It also explains a process
problem worth naming: `docs/work-log/2026-07-28-causeline-prior-year-reference.md` shows Phase 4
"Complete" but **Phases 5 (qa) and 6 (analyst) were never run** — the file is still template
placeholders for both, despite the code having shipped to `main` in v1.45.0. QA's own handoff notes in
that file only describe checking an *already-committed* line's reference values from a fresh page
load — the "add a line live in this session" interaction was never exercised, which is exactly the
path that has the bug.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-30 |
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

**This work-log covers B-37 (carry-forward) only.** The stale-row-state bug found in Section 3 above
is a **separate loop-back** against `docs/work-log/2026-07-28-causeline-prior-year-reference.md`
(Phase 4, since the defect predates QA) — see "Bug Finding — routing recommendation" below. Do not
let B-37's scope absorb the bug fix; they should ship independently and the bug fix is higher
priority (it's actively misleading the treasurer today).

---

# Bug Finding — routing recommendation (not part of B-37's scope)

**File:** `src/components/admin/ledger/budget-cause-editor.tsx`
**Symptom:** A cause line's Prior Budget / Prior Actual reference cells never populate after the line
is added and committed in the same browser session, even when the server-computed match exists.
**Root cause:** `Row.priorBudgetCents`/`priorActualCents` are seeded once at mount from
`initialLines` and at row-creation time (`addRowForCause`, always `null`); no code path recomputes
them after `commitCreate`'s `setRows` or after the subsequent `router.refresh()`, because the
component doesn't remount and has no reconciling `useEffect`.
**Recommended fix shape (for tech-lead to confirm in Phase 3, not decided here):** either (a) have
`commitCreate`'s PATCH response include the matched `priorBudgetCents`/`priorActualCents` (the server
already has everything needed to compute them at write time — `causeLineReferenceKey` is a pure
function) and thread them into the `setRows` update, or (b) add a `useEffect` keyed on `initialLines`
that reconciles committed rows' reference fields when the prop changes after `router.refresh()`.
Option (a) is probably simpler and avoids a second render pass.
**Routing:** Loop back to **Phase 4** on `docs/work-log/2026-07-28-causeline-prior-year-reference.md`
(append a new Phase 4 increment there, don't fork a new work-log — this is the same feature, still
mid-pipeline), then run **Phase 5 (qa)** for real this time, with an explicit manual-click-through
step for "add a new cause line whose label exactly matches a committed prior-FY line, without
reloading the page, and confirm the reference cells populate" — the exact gap that let this ship
unverified. Then close it with **Phase 6**.
**Priority:** Recommend before B-37, and before widening Prior Actual's matching (Gap 2 below) — a
treasurer can't trust either number until this is fixed, since right now "—" means "no prior data" OR
"you just added this line," indistinguishably.

---

# Bug Fix — Phase 4 Implementation (ux-developer) — 2026-07-30

**Owner:** ux-developer
**Status:** complete
**Scope note:** This is the Phase 4 loop-back the "Bug Finding" section above called for. Per the
routing recommendation it targets `docs/work-log/2026-07-28-causeline-prior-year-reference.md` (the
originating feature, still mid-pipeline) — the fix itself is recorded here per explicit instruction,
and that file's Phase 5/Phase 6 stubs are updated to point back at this section rather than being
filled in twice. **This section is NOT part of B-37** (see the scope note two sections up) — B-37's
own Phase 1–6 table below is untouched by this fix.

### Summary

`BudgetCauseEditor` (`src/components/admin/ledger/budget-cause-editor.tsx`) seeded its read-only
Prior Budget/Prior Actual reference fields once at mount from `initialLines`, and `addRowForCause`
hardcoded them to `null` for any brand-new row. Nothing ever recomputed either field afterward — not
after `commitCreate`'s `setRows`, and not after its subsequent `router.refresh()` — because the
component never remounts and had no effect reconciling local state against the fresh server props.
Net effect: a cause line added or edited in the current browser session showed "—" for both reference
columns for the rest of that session, even once a matching prior-FY value existed server-side, until a
hard full-page reload re-seeded the component from scratch.

Fixed with a `useEffect` that reconciles each row's `priorBudgetCents`/`priorActualCents` against the
`initialLines` prop whenever that prop's *identity* changes — which, per the prop chain confirmed by
reading `budget-editor.tsx`, only happens after a `router.refresh()` re-runs the server component tree
(`initialLines` there is `line.causeLines` straight off `BudgetEditor`'s own `lines` prop, never locally
copied, so it's stable across every other re-render — e.g. typing in a sibling field never touches it).
The match is by the row's own committed `id` (not by `causeLineReferenceKey`/label), which is exact and
sidesteps re-deriving or re-fetching anything: the server has already done the `(categoryId, cause,
label)` join in `budgeting/page.tsx`'s `enrichCauseLines` by the time the fresh prop lands.

### Why this approach over the alternative (server response carries the match)

The Bug Finding section above named two options: (a) have the PATCH response include the matched
prior values, or (b) reconcile client-side against `initialLines` after `router.refresh()`. Chose (b):
it's a pure client-side change (in scope for ux-developer, no API contract change, no kickback to
api-developer needed), it reuses data the server already computes and sends down on every render (no
new payload), and it naturally covers every write path that already calls `router.refresh()`
(create, update, delete-hold-expiry, restore, group remove/restore) rather than requiring every one of
those API responses to be widened individually.

### What I did

- Added a `useEffect(() => {...}, [initialLines])` in `BudgetCauseEditor` (right after the existing
  hold-timer cleanup effect) that maps over local `rows`, finds each committed row's (`id !== null`)
  counterpart in the fresh `initialLines` by `id`, and copies over `priorBudgetCents`/`priorActualCents`
  only when they've actually changed (bails out to the same array reference otherwise, so React's
  state-update bailout keeps this a no-op re-render on the frequent no-change firings).
- Left every other field (`label`, `value`, `pendingDeleteAt`, `starred`, `note`, dirty refs) completely
  untouched by this effect — it reads and writes only the two read-only reference fields, so it cannot
  clobber an in-progress label/amount edit (no dirty-tracking needed for a field the user never edits).
- No change to any route handler, server action, or the `FundReport`/`enrichCauseLines` computation —
  those already had correct data; the client just wasn't picking it up.

### Outputs

- `src/components/admin/ledger/budget-cause-editor.tsx` — added the reconciliation `useEffect` (with
  inline doc comment explaining the prop-identity mechanism and why it's safe against unrelated
  re-renders and in-progress edits).
- `e2e/prior-year-cause-line-reconcile.spec.ts` (new) — Playwright regression test. Seeds a committed
  cause line ("E2E QA Prior-Ref Pilot Dogs" under Vision & Eye Care / Charitable donation out) at a
  dedicated FY2097 ("prior"), then on a dedicated FY2098 ("current") adds a NEW cause line with the same
  category/cause/label and asserts Prior Budget updates to the seeded $1000.00 value **without ever
  calling `page.reload()`** — the exact gap that let this bug ship unverified originally. Also asserts
  Prior Budget correctly reads "—" before the label is typed (not a false-positive pass). Uses its own
  dedicated FY pair (2097/2098), distinct from `budgeting-restructure.spec.ts`'s FY2099 fixture, so the
  two suites never collide.
- No schema change, no new route, no new `FEATURES` key, no `console.log`, no native dialogs touched.

### Verification run

- `pnpm exec tsc --noEmit`: PASS (exit 0, no errors).
- `unset DATABASE_URL DB_URL; pnpm test`: PASS — 833/833 (no regressions; this fix has no Vitest-testable
  surface on its own — it's a client-state timing fix — so the new coverage is the e2e test above, per
  the project's documented gap: no RTL/jsdom stack, `vitest environment: "node"`).
- `pnpm lint`: not run for a verdict — confirmed the known pre-existing unrelated ESM failure
  (`minimatch` / `@eslint/eslintrc` `SyntaxError` on `import minimatch from "minimatch"`) reproduces
  identically on a clean scoped run of just the two changed files, unrelated to this change.
- `pnpm build:only`: intentionally NOT run per this task's explicit instruction.
- Did not commit or push, per instruction.

### Open questions / handoff notes

- **e2e test not executed in this session** — no `pnpm dev` server was running against a live DB in
  this session, and the fix's client-only nature means the meaningful verification is the browser
  click-through the e2e test encodes. **qa should run `pnpm test:e2e -- prior-year-cause-line-reconcile`
  (with `pnpm dev` up) as part of closing this out**, and additionally click through manually once:
  open `/admin/ledger/budgeting?entity=foundation&fy=2098` (after the e2e test has seeded FY2097 once,
  or seed it manually via the UI first), add a cause line under Vision & Eye Care matching an FY2097
  label, and confirm Prior Budget populates on blur with no reload.
- **Prior Actual will still correctly show "—"** for a freshly-added line whose label doesn't exactly
  match a prior-FY transaction `party` string (e.g. "Pilot Dogs" vs "Pilot Dogs, Inc.") — that's the
  separate, out-of-scope accuracy gap named in Section 2 above, not something this fix touches or
  should touch.
- **Nominate qa for Phase 5** on this fix (see routing note at the top of this section — tracked as a
  loop-back on `docs/work-log/2026-07-28-causeline-prior-year-reference.md`, which now points back
  here). Once qa passes, **nominate analyst for Phase 6** to close both work-logs' outstanding
  Phase 5/6 status.
- This fix does **not** touch or resolve B-37 (carry-forward) — that remains fully Pending per its own
  Per-Phase Status table below, untouched by this session's work.

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Let the treasurer start a new fiscal year's budget with last year's causes and labeled line items
> already sitting there as editable rows, instead of retyping every beneficiary from memory —
> everything else the original B-37 brief worried about (prior-budget-per-line, prior-actuals-per-line)
> is already built and shipped; it's carry-forward, and only carry-forward, that's missing.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| admin (treasurer / Budget Committee, `budget.edit`) | Opens a fund's budget for a new FY and sees last year's cause breakdown (causes + labeled line items + amounts) pre-populated as editable starting rows | Once per fund per FY, at the start of budgeting season |
| admin | Accepts a carried-forward line as-is (no action) | Per line, implicit |
| admin | Edits a carried-forward line's amount before committing it for the new FY | Per line, on demand |
| admin | Edits a carried-forward line's label (e.g. a beneficiary's name changed) before committing | Per line, on demand |
| admin | Removes a carried-forward line that doesn't apply this year (existing soft-delete/Undo flow, unchanged) | Per line, on demand |
| admin | Adds a brand-new line this year with no prior counterpart (existing "+ Add line item" flow, unchanged) | Per line, on demand |

## Flows

**Flow 1 — First open of a new FY's budget for a fund that had cause breakdowns last year:**
entry: treasurer navigates to `/admin/ledger/budgeting?entity=foundation&fy=2027` (or advances the FY
picker) for a fund that has zero budget rows yet for that FY → step: page loads and, for every
category that had a cause breakdown in FY-1, shows the prior year's causes and labeled line items
(label + amount) as pre-filled, uncommitted rows, visually distinct from committed rows (mirrors the
"+ Add cause" pending-row treatment already in the codebase — muted, an explicit "confirm"/accept
affordance, not silently identical to a saved row) → step: treasurer reviews, edits amounts/labels
inline, removes what doesn't apply, leaves the rest → step: each row commits the same way the
existing per-line commit-on-blur already works → outcome: the new FY's budget for that category
starts populated, not blank.
- Failure: if the carry-forward fetch fails (network/DB error), the category falls back to today's
  behavior — blank, with the existing "+ Add cause" control still available. The treasurer is not
  blocked; nothing silently loses data (no partial writes — carry-forward proposals are never
  auto-committed).

**Flow 2 — Opening a new FY's budget for a fund/category with no prior cause breakdown at all
(brand-new breakdown, or the fund is new):** entry: same page → step: no prior lines to propose →
outcome: identical to today's blank state, "+ Add cause" as the only path forward. No regression.

**Flow 3 — Treasurer has already started manually entering some lines for the new FY, then wants
carry-forward for the rest:** entry: FY has SOME committed lines already (partial manual entry) →
step: carry-forward proposes only lines that don't collide with an already-committed
`(cause, label)` for that FY (mirrors `deriveSeedLinesForFund`'s existing `collision` field
convention) → outcome: no duplicate/overwritten rows; the treasurer's existing entries are untouched.
- Failure: if a collision is detected, the proposed line is either suppressed or shown
  disabled/flagged "already entered" — needs a product decision (see Open Questions).

## Permissions

- **Permission(s):** existing `budget.edit` (Budget Committee) / `ledger.manage` — same gate as every
  other write on this page. No new `FEATURES` key.
- **Default roles:** unchanged — whoever already has `budget.edit`/`ledger.manage`.

## Gaps the Request Didn't Address

- **Source of the carried-forward amount: prior BUDGET or prior ACTUAL?** The existing category-grain
  seed (`deriveSeedLinesForFund`) has a fund-wide fallback: actuals if the fund had any last year,
  else prior budget. The existing single-line cause seed (`computeCauseSeedForCategory`/
  `deriveCauseSeedLines`) instead sources purely from actuals, most-recent-FY-wins, over a 2-year
  lookback, and completely ignores the `label` dimension — it only ever proposes ONE row per cause and
  only checks collision against the existing **blank-label** line. Neither of these seeds the
  **labeled-line-item** grain B-37 wants ("WARM" + "Pilot Dogs" + "Foundation Fighting Blindness" as
  three separate rows). This needs a **new** seed function operating at `(cause, label)` grain. I
  recommend sourcing it from **prior BUDGET lines** (`ledger_budget_lines` at FY-1), not actuals — the
  cause-line-item model is planning-first ("what do we intend to give WARM this year"), and prior
  actuals per exact label are exactly the figure that's already fragile to name drift (see the Pilot
  Dogs / Pilot Dogs, Inc. finding above) — seeding from a shaky match would propagate that fragility
  into new budget rows. Confirm with Chris.
- **What happens when FY-1 has no budget lines but does have cause-tagged actuals for that category
  (this is exactly today's FY2025→FY2026 transition — no FY2025 budget existed at cause-line grain
  until very recently)?** If carry-forward only reads prior BUDGET lines, a fund whose FY2025 budget
  was entered late or incompletely gets nothing to carry forward, even though real per-cause actuals
  exist. Needs a documented fallback, or an explicit "propose from actuals instead" secondary action
  — not a silent double-fallback that produces unpredictable results.
- **Collision policy when the treasurer has partially entered the new FY already** (Flow 3) — suppress
  the colliding proposal, or show it as a disabled/informational row? Not specified by the request.
- **Explicit action vs. automatic on first open** — B-37's own text raises this and doesn't resolve
  it. I recommend **explicit**, gated behind a visible "Copy last year's lines" affordance per category
  (or per fund, mirroring the existing entity-level guided-budgeting seed flow), not automatic —
  automatic pre-fill on first page load risks the treasurer not noticing which rows are "real" vs.
  proposed, especially since this page already renders three visual line-states (committed,
  pending-delete, and now a fourth: proposed-but-not-yet-accepted).
- **Interaction with the "+ Add cause" single-line seed that already exists.** If a category has no
  breakdown yet this year and the treasurer clicks "+ Add cause" today, `computeCauseSeedForCategory`
  already proposes one aggregate line from actuals. If carry-forward is added, does it supersede that
  flow, run alongside it, or does "+ Add cause" become carry-forward's per-cause entry point? These
  need to be reconciled into one mental model, not two competing seed mechanisms on the same page.
- **Label collision risk across FYs (B-37's own text flags this).** Confirmed real in the live data:
  distinct beneficiaries under the same cause with distinct labels don't collide (good), but the same
  beneficiary spelled two ways ("Pilot Dogs" vs "Pilot Dogs, Inc.") is exactly the failure mode that
  makes exact-match carry-forward propose a *new* line instead of recognizing "this is the same
  beneficiary as last year." Carry-forward from BUDGET lines (not actuals/party) sidesteps this
  specific case since budget labels are treasurer-typed and more consistent than Quicken-imported
  party strings — but only if the treasurer doesn't retype the label slightly differently between
  FYs. No perfect fix here short of B-30; note it and move on.
- **Mobile at 360px.** Not mentioned in the request. The existing pending-row / breakdown UI already
  has proven 360px stacking patterns (per the causeline-prior-year-reference and budgeting-page-
  redesign work-logs) — carry-forward rows should reuse the identical treatment, not invent a new one.
- **Brand consistency.** Carry-forward proposal rows should use the same muted/pending visual language
  already established for "+ Add cause" pre-fill rows and soft-deleted rows (`rounded-lg`, no
  `window.confirm`, `ConfirmDialog` only if a bulk "accept all" or "dismiss all" action is added).
  Not addressed by the request; flagging so Phase 3 doesn't invent a fifth visual state.

## Out of Scope (confirm with user)

- **Fixing the Prior Actual label↔party matching fragility** (Gap: "Pilot Dogs" vs "Pilot Dogs,
  Inc."). This is a real, confirmed accuracy issue but is not what B-37 asked for — B-37 is about
  carry-forward, not about improving the existing reference match. Recommend tracking separately
  (a lightweight normalization pass — case-fold + strip trailing corporate suffixes/punctuation before
  matching — could meaningfully improve today's exact-match without waiting on full B-30). Flagging so
  it doesn't get silently bundled into B-37's implementation.
- **B-30 (explicit transaction→budget-line link).** Confirmed NOT a prerequisite for anything in this
  work-log — prior-actuals-per-line already works today via the soft join, and carry-forward as
  scoped above sources from prior BUDGET lines, not transactions. B-30 remains valuable for making
  *future* budget-vs-actual variance reporting exact, but nothing here blocks on it.
- **The stale-row-state bug (Section 3 above).** Explicitly out of scope for B-37 — it's a loop-back
  on the 2026-07-28 work-log, not new work.

## Open Questions

- Carry-forward amounts: seed from **prior budget lines**, or give the treasurer a per-line toggle
  between "last year's budget" and "last year's actual" (mirroring the category-grain seed's own
  actual-vs-budget duality)? My default recommendation is prior-budget-only for v1, with actual-vs-
  budget toggle as a possible follow-up if treasurers ask for it.
- Should carry-forward propose lines whose FY-1 budget was $0 (a real "we planned to give $0" signal,
  same precedent as `deriveSeedLinesForFund`'s explicit-zero handling), or only lines with a positive
  amount?
- Is carry-forward scoped to the CURRENT fund's causes only, or should it also flag causes/labels used
  elsewhere in the entity (cross-fund) as available to add? Assuming current-fund-only for v1 unless
  told otherwise.
- Should the fix for the Section 3 bug and the B-37 carry-forward feature be sequenced (bug first, per
  my recommendation above), or does Chris want them designed together since tech-lead will be touching
  the same files either way?
