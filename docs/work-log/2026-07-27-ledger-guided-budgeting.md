# Ledger Guided Budgeting (Copy-Forward + Balance Check) — Work Log

> **Slug:** `2026-07-27-ledger-guided-budgeting`
> **Surface:** (dashboard) admin — `/admin/ledger/*`
> **Permission(s):** existing `LEDGER_MANAGE` covers this — no new `FEATURES` key expected
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-27 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-07-27 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementers named | 2026-07-27 |
| 4 — Implementation | api-developer → ux-developer | Complete | — | 2026-07-27 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## Grounding note — what already exists (do not rebuild)

I read the code before writing this review. Confirmed, all present and working today:

- `ledger_budgets` (`src/lib/db/schema.ts:772-797`) — one row per `(fundId, fiscalYear, categoryId, flow)`, `annualAmountCents`. Unique constraint on that 4-tuple; indexed on `(fundId, fiscalYear)`.
- `getFundReport()` (`src/lib/ledger-queries.ts:357`) already builds a full Budget/Actual/Variance table per fund × FY, left-joining actuals against budget rows, including categories that only have actuals (no budget → "—") and deactivated categories that still have posted history.
- `budgetVariance()` (`src/lib/ledger.ts:245`) — unit-tested, handles the `budgetCents === null` and `budgetCents === 0` cases correctly (positive variance = under budget).
- The report page (`src/app/(dashboard)/admin/ledger/[fundSlug]/report/page.tsx`) renders this today, with an inline `BudgetEditor` (`src/components/admin/ledger/budget-editor.tsx`) that PATCHes `/api/admin/ledger/budgets` per category/flow line, gated by `LEDGER_MANAGE` (checked both in the Server Component and again inside the route handler — good defense in depth). Empty amount = delete the row; `0` is a valid explicit budget.
- Fund model confirmed from `drizzle/migrations/0044_ledger_books.sql`: **Club** entity owns `administrative` + `activity` funds; **Foundation** entity owns `charitable` + `scholarship` funds. This is the concrete shape of "two self-balancing budgets" — Administrative is the Club's operating budget, Activity is the Club-side charitable clearing account, and Charitable/Scholarship are the Foundation's program funds.
- Transfers (`src/app/api/admin/ledger/transactions/route.ts:420-448`, DECISION-016/017) are two linked rows with `transferGroupId` set but **no `categoryId`**. `getFundReport`'s actual-aggregation only buckets transactions `if (txn.categoryId)` — so transfers are already excluded from per-category actuals today. **Not a gap**; confirmed by reading the insert path, not assumed.
- `getEntityReport()` (`src/lib/ledger-queries.ts:1666`) hardcodes `budgetCents: null` at lines 1799/1813 — the entity-level rollup genuinely has no budget story. Confirmed, and out of scope per the brief (secondary gap, not this increment).

What's missing, confirmed by reading `budget-editor.tsx` and the route: there is **no copy-forward**, **no cross-fund balance indicator**, and **no adoption/versioning concept anywhere in the codebase** (grepped `docs/decisions.md` and `src` for "adopted"/"board adopt" — zero hits specific to budgets). Today, building next year's budget means typing every line into a blank input, fund by fund, with no signal about whether income and expense targets balance.

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> Let the treasurer seed next year's budget from this year's actuals with one action per fund (or all four at once), then show a live "does income cover expense" balance readout while they adjust — but the request leaves open five decisions (copy source, overwrite policy, what "balanced" numerically means per fund kind, advisory-vs-block, and whether "adopted" status is in scope) that materially change the design and must be settled before Phase 3.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (LEDGER_MANAGE) | Navigate to a budgeting entry point for a target fiscal year | Once per budget season (typically spring, ahead of the Jul 1 FY start) |
| Admin (LEDGER_MANAGE) | Trigger "copy forward" for one fund or all four funds | Once per fund per season (idempotent re-trigger should be safe — see gaps) |
| Admin (LEDGER_MANAGE) | Review the pre-filled category/flow lines seeded from last year | Per fund |
| Admin (LEDGER_MANAGE) | Adjust individual budget line amounts inline (reusing `BudgetEditor`) | Per line, as needed |
| Admin (LEDGER_MANAGE) | Read a per-fund balance indicator (income target vs. expense target) | Continuously, as they edit |
| Admin (LEDGER_MANAGE) | (Open question) Mark a fund's budget "adopted"/final | Once per fund per season — **not confirmed in scope** |

No other surface touches this. Anonymous visitors, access-pending members, and signed-in members never see a budget number — `LEDGER_VIEW`/`LEDGER_RECORD` users can already *see* the existing Budget vs Actual report (read-only), but guided setup itself is `LEDGER_MANAGE`-only, matching the existing `BudgetEditor` gate.

## Flows

**Flow 1 — Seed a fund's budget from last year:**
Entry: a new action on the existing fund report page (or a new `/admin/ledger/budgeting` landing — **Phase 2/3 placement decision, see gaps**) — e.g. "Copy FY2026 actuals forward to FY2027."
→ Treasurer picks the target FY (defaults to next FY after the latest FY with data) and confirms the source (prior actuals vs. prior budget — **open question**).
→ System copies one row per active category+flow into `ledger_budgets` for `(fund, targetFY)`.
→ Treasurer lands on the (now-familiar) `BudgetEditor`, pre-filled instead of blank, and adjusts numbers inline exactly as today.
→ **Success outcome:** budget rows exist for the target FY, editable individually, same save-on-blur UX as today.
→ **Failure path (not addressed by the request):** target FY already has some budget rows for this fund (partial or complete). Today's blank-editor flow never has to answer "overwrite or merge?" — guided setup does. No behavior specified. Needs a `<ConfirmDialog>`-driven choice (merge/skip-existing vs. overwrite-all), not a silent overwrite.
→ **Failure path (empty prior year):** prior FY has zero posted transactions for this fund (brand-new fund, or first budget season) — button should say why it's disabled/no-op ("No FY2026 activity to copy from — enter amounts directly below") rather than silently producing an empty result that looks like the action did nothing.

**Flow 2 — Balance guidance while editing:**
Entry: same page, live as budget lines are entered/edited (post-seed or from-scratch).
→ System sums budgeted income vs. budgeted expense for the fund being edited.
→ **Success outcome:** a visible status readout — e.g. "Income $X vs. Expense $Y — balanced" (green) or "Expense exceeds income by $Z" (amber).
→ **Failure/warning path:** what happens when a fund is *not* balanced is the central undefined behavior in the request. Is it advisory only (readout stays amber, save still succeeds — my recommendation, see gaps) or a hard block on saving further lines? The request says "guide," which reads as advisory, but this needs an explicit answer, not an inferred one.

## Permissions

- **Permission:** existing `LEDGER_MANAGE` ("Manage funds, budgets, entities, and opening balances," `src/lib/permissions.ts:56,123`) covers both copy-forward and the balance readout — same gate the current `BudgetEditor`/`PATCH /api/admin/ledger/budgets` already enforce. No new `FEATURES` key needed.
- **Default roles:** whichever roles are already bound to `LEDGER_MANAGE` (treasurer, admin) — unchanged.
- A new copy-forward endpoint (likely `POST /api/admin/ledger/budgets/seed` or similar) must re-check `hasFeature(..., FEATURES.LEDGER_MANAGE)` server-side, exactly as `budgets/route.ts` does today — do not rely on the page-level gate alone.

## Gaps the Request Didn't Address

- **Copy source — prior actuals or prior budget?** The request says "guide us through budgeting... measure against the budget," and Chuck's ask says "copy prior-year actuals forward as a starting budget." That reads as: default source = prior FY's *actual* spend/income, not prior FY's *budget* (if one existed). But if a category has a prior budget and zero actuals (e.g., a new program that never got funded), copying "actuals" gives $0, silently discarding the prior intent. **Resolution to confirm with user:** default to prior-year actuals; if a category has actuals of $0 AND a nonzero prior budget, surface both and let the treasurer pick, rather than silently picking one.
- **New/removed categories.** A category active this year but not last year has no actual to copy — leave the line blank (treasurer fills manually), same as today's blank editor. A category deactivated since last year should not appear (matches `getFundReport`'s existing `isActive` scoping) even though it may have had a budget or actuals last year. This should be stated explicitly in the design, not left implicit.
- **Round/inflation adjustment.** Raw dollar-for-dollar copy (no automatic inflation bump) is the safer v1 default — treasurers can eyeball and adjust individual lines using the existing editor. Confirm this is acceptable; if the club wants a "+3% across the board" toggle, that's an explicit, separate control, not baked into copy-forward silently.
- **Per-fund vs. all-funds-at-once.** With only 4 funds total (administrative, activity, charitable, scholarship), a single "copy all funds forward" action followed by fund-by-fund review is plausible and lower-friction than four separate button clicks — but each fund's *balance check* is inherently per-fund, so the review step is still per-fund regardless of how copy is triggered. Confirm which UX the user wants; my read of "guide us through budgeting" leans toward a single guided sweep across all four funds with the balance check as the per-fund checkpoint.
- **Overwrite vs. merge on re-trigger.** If a treasurer runs copy-forward, edits some lines, then re-runs it (e.g. wrong source FY picked first), what happens to lines they've already touched? Silently clobbering manual edits is a real footgun. Recommend: copy-forward only fills categories that have **no existing row** for the target FY by default, with an explicit, confirm-dialog-gated "overwrite everything" option for a genuine do-over.
- **What "self-balancing" means numerically, per fund kind — this is the crux of the feature and is not fully specified.** Article VII §3(g) is about *use of publicly-raised funds*, not "every fund must net to zero every year." Concretely, for the two-entity/four-fund shape actually in the schema:
  - **Administrative fund (Club):** operating budget — income target should cover expense target (dues, fundraising-earmarked-for-ops if any, etc. ≥ operating costs), since public donations may never subsidize it. This is the fund where the invariant is sharpest.
  - **Activity fund (Club):** a clearing account for publicly-raised charitable money passing through the Club before disbursement — "balanced" here plausibly means *planned receipts ≈ planned disbursements* (net near zero by design), not "income exceeds expense."
  - **Charitable / Scholarship funds (Foundation):** program funds that may legitimately run a planned deficit funded from an existing reserve or endowment (a scholarship fund spending down an accumulated balance is normal, not a violation). Applying the same "income ≥ expense" rule here could produce false-positive warnings that erode trust in the tool.
  This means a single balance rule cannot mechanically apply to all four funds identically. **I'm flagging this rather than guessing** — the user (Chuck, as treasurer) needs to confirm which fund(s) get which rule before tech-lead can design the check.
- **Advisory vs. hard block.** Recommend the balance indicator is advisory only (never blocks saving a line) — a treasurer may legitimately plan a drawdown year. A hard block would fight real, legitimate budgeting decisions. Confirm with user; this is a one-sentence decision but changes the API contract (does the PATCH endpoint need a "confirm anyway" override, or is it purely a UI-side readout with no server enforcement?).
- **Draft vs. adopted budget.** Chuck's framing says "the board formally ADOPTS the budget." Today `ledger_budgets` rows are just upsert-in-place with no draft/final state, no board-minute reference (contrast with `ledgerTransactions.boardMinute`, which *does* exist for approved disbursements). Capturing "adopted" is a real, named requirement in the brief, not a hypothetical — but the brief also frames guided setup as the priority increment and lists adoption capture as open. **Recommend:** v1 guided setup ships as upsert-in-place (no draft/adopted state), and "capture board adoption of the budget (date + board-minute reference, mirroring `ledgerTransactions.boardMinute`)" is logged as an explicit follow-up/backlog item — not silently dropped. This needs the user's explicit sign-off since it's a named ask, not an inferred nice-to-have.
- **Mid-year FY rollover during editing.** Low risk: `ledger_budgets` rows are keyed by an explicit `fiscalYear` integer chosen by the treasurer, not an implicit "current FY," so a session spanning a Jul 1 rollover doesn't corrupt anything — the treasurer is editing whatever FY they picked in the selector. Confirmed safe by reading `currentFiscalYear`/`fyBounds` usage; no special handling needed.
- **Entity-level rollup absence (secondary, per brief).** `getEntityReport` hardcodes `budgetCents: null` — a "does the whole Club balance" or "does the whole Foundation balance" view doesn't exist. The brief explicitly scopes this out of the current increment; I agree that's reasonable, but the guided-setup UI will *feel* incomplete without at least showing the Administrative+Activity pair and Charitable+Scholarship pair side by side during setup, since that pairing is the actual Lions-Way self-balancing unit. Recommend tech-lead scope a small new aggregation (sum of already-fetched fund reports client/server-side), not a rebuild of `getEntityReport`.
- **Mid-year/prorated pacing (secondary, per brief).** Confirmed out of scope — targets stay annual-only for this increment. Noted so it isn't silently forgotten; log to backlog if not already there.

## Out of Scope (confirm with user)

- Consolidated entity-level (Club-wide / Foundation-wide) budget-vs-actual rollup — brief already defers this.
- Mid-year YTD/prorated budget pacing — brief already defers this.
- Formal "adopted" budget status + board-minute capture — recommended as a follow-up, not this increment, pending user confirmation (see gap above; this is the one item where "out of scope" is my recommendation, not an assumption already agreed).
- Automatic inflation/COLA adjustment on copy-forward — raw copy only, unless the user asks otherwise.

## Open Questions

- Copy source: prior-year **actuals**, prior-year **budget**, or "whichever is nonzero, prefer actuals"?
- All-funds-at-once seeding with per-fund review, or one explicit action per fund?
- Overwrite policy on re-trigger: skip-existing (merge) by default, with an explicit destructive "overwrite all" path? Or always overwrite with a single confirm?
- What does "balanced" mean numerically for the Activity fund and for the two Foundation funds (Charitable, Scholarship) — same "income ≥ expense" rule as Administrative, or a different rule (e.g., "planned draw from reserve is fine, flag only if it exceeds available fund balance")?
- Advisory-only balance warning, or does an unbalanced fund block anything (e.g., prevents navigating away, requires an acknowledgment)?
- Is board-adoption capture (date, board-minute reference) in scope for this increment, or logged as a named follow-up?

---

# Phase 2 — Architectural Review (architect) — 2026-07-27

## Verdict

**Approved with suggestions**

Grounded in the actual code before ruling — read `src/app/api/admin/ledger/budgets/route.ts` (PATCH handler in full), `getFundReport()` in `src/lib/ledger-queries.ts:357-`, `budget-editor.tsx`, the `[fundSlug]/report/page.tsx` server page, the `ledgerBudgets`/`ledgerFunds`/`ledgerEntities` schema definitions, and the existing `admin/ledger/*` directory tree (`approvals/`, `compliance/`, `donors/`, `guide/`, `reconciliation/`, `reimbursements/`, `reports/`, `settings/`, plus the entity-level `admin/ledger/page.tsx` landing and per-fund `[fundSlug]/{page,report/page}.tsx`). Phase 1's grounding note checks out against the code as written.

## Rulings

### 1. Reuse vs. new write path (critical) — **new dedicated endpoint, but extract the shared upsert core**

Rule: add `POST /api/admin/ledger/budgets/seed`, a new dedicated endpoint — **not** (a) the seed action calling the existing `PATCH /api/admin/ledger/budgets` in a loop, and **not** (c) overloading the existing route with a batch mode.

- **Against (a) — loop over the existing PATCH:** seeding writes up to ~30-60 lines across all four funds in one action. Looping N individual HTTP round-trips from the seed UI is slow, has no natural transaction boundary (a mid-loop failure leaves a partially-seeded fund with no clean rollback), and the PATCH contract's response (`{action, id}` for one line) can't express what the seed flow needs to show the treasurer: "Administrative: 6 seeded, 2 skipped (already had a budget)."
- **Against (c) — a batch/seed mode bolted onto the existing route:** `PATCH /api/admin/ledger/budgets` has one clean contract today (single fund+FY+category+flow, upsert-or-delete). A seed mode needs a materially different request shape (entityId, targetFY, sourceFY, per-fund overwrite flag) and a different response shape (per-fund/per-line counts). Cramming both into one handler makes the route harder to reason about and is how routes accumulate the kind of hidden branching this project's invariants exist to prevent.
- **The actual risk the analyst is right to flag — two divergent write paths to `ledger_budgets`:** avoid this not by reusing the *route*, but by extracting the existing PATCH handler's validation-and-write core (fund lookup, category-matches-fund-kind-and-flow check, amount bounds check, the `insert().onConflictDoUpdate()` on the `(fundId, fiscalYear, categoryId, flow)` unique constraint) into a small shared internal function — e.g. `upsertBudgetLine()` co-located in `src/lib/ledger-queries.ts` or a new `src/lib/ledger-budgets.ts` if tech-lead wants it isolated. Both `PATCH /budgets` (one line at a time) and `POST /budgets/seed` (looping in-process over lines, inside one DB call sequence — not one call per fetch) call the same function. One source of truth for what a valid budget-line write looks like; two entry points with different ergonomics for their different callers.
- Fill-empty/merge semantics (locked decision 3) belong in the seed endpoint's own logic (skip any `(fund,FY,category,flow)` with an existing row unless the caller explicitly requests overwrite for that fund), not in the shared upsert core — the upsert core doesn't need to know about "seed vs. manual edit," it just needs to write a validated line.

### 2. Where the actuals-copy logic lives — `ledger-queries.ts`, reusing `getFundReport`

`computeSeedFromPriorYear(entityId, fiscalYear)` (or per-fund `computeFundSeedFromPriorYear(fundId, priorFY)`, called once per fund of the entity) belongs in **`src/lib/ledger-queries.ts`**, not `ledger.ts`. `ledger.ts` is this codebase's home for pure, DB-free, unit-tested functions (`budgetVariance()` takes numbers in, returns numbers out). The seed computation is fundamentally a query — it must call `getFundReport(fund.id, priorFY)` per fund and read `actualCents` (and, per locked decision 1, fall back to `budgetCents` when actuals are empty) off the existing per-category lines that function already returns. Confirm explicitly: **no new transaction query** — this is composition on top of `getFundReport`, not a re-aggregation of `ledgerTransactions`. Keep the return shape close to what the UI needs to preview before writing (category, flow, proposed amount, source-was-actual-or-budget-or-neither) so the same helper can back both a "preview" read and the payload the seed endpoint writes.

### 3. UI placement — new sibling page `admin/ledger/budgeting/`, not the per-fund report page

Locked decision 2 (per-entity, all-funds-at-once, reviewed per-fund) rules out putting the entry point on `[fundSlug]/report` — that page is scoped to one fund and has no entity-level concept today. It also doesn't fit as a modal/wizard component tree bolted onto an existing page: every other cross-fund concern in this codebase (`reports/`, `compliance/`, `reconciliation/`, `donors/`) is its own top-level page under `admin/ledger/`, following the same `?entity=&fy=` search-param convention as the existing entity-level `admin/ledger/page.tsx`. Guided budgeting should follow that precedent:

- **New page:** `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` — Server Component. Reads `session`/`hasFeature(LEDGER_MANAGE)` exactly like `[fundSlug]/report/page.tsx` (redirect to `/access-pending` if not `canManage`, since unlike the report page this whole surface is manage-only, not manage-or-view). Fetches entity, its funds, the seed preview per fund (via the Ruling-2 helper), and existing target-FY budget rows to know which lines already exist (for the "already set" vs. "would seed" distinction the fill-empty policy needs to show).
- **Client island:** a new `src/components/admin/ledger/guided-budget-setup.tsx` (`'use client'`), receiving the server-computed seed preview as props. Owns: the per-fund "Seed this fund" action (posts to `/budgets/seed`), the `ConfirmDialog` gating an explicit overwrite when some target rows already exist (never a silent overwrite — matches locked decision 3 and the no-native-dialogs rule), and renders the **existing `BudgetEditor`** per fund for the adjustment step post-seed rather than forking a second editor. Reusing `BudgetEditor` as-is is correct — its props (`fundId`, `fiscalYear`, `lines`) already fit; don't duplicate its save-on-blur logic.
- Optional, non-blocking nicety (not required for this increment): a one-line cross-link from `[fundSlug]/report` ("Set up next year's budget from FY{prior} →" pointing at `/admin/ledger/budgeting`) so treasurers landing on the familiar report page can discover the new flow. Suggestion, not a requirement.

### 4. Advisory balance guidance — pure helper in `ledger.ts`, must stay DB-import-free

`computeBudgetBalanceStatus(fundKind, budgetedIncomeCents, budgetedExpenseCents): { status: 'ok' | 'warn' | 'info'; message: string }` belongs in **`src/lib/ledger.ts`**, alongside `budgetVariance()` — same shape of function (pure, numbers in/out, unit-testable without a DB). Two placement constraints to hold tech-lead to:

- It must apply the per-fund-kind rule from locked decision 4 (administrative: warn if income < expense; activity: warn if net drifts materially from zero; charitable/scholarship: informational net display only, never a warn state) — the fund `kind` string already on `ledgerFunds`/`ledgerCategories` is the discriminant, no new schema needed.
- Per Phase 1 Flow 2 ("live as budget lines are entered/edited"), this needs to recompute **client-side, before blur/save** — as the treasurer types into `BudgetEditor`'s inputs, not just after each PATCH round-trip completes. That means this helper must have **zero imports from `@/lib/db`** so it can be imported directly into the client island (or into `BudgetEditor` itself) without pulling server-only code into the client bundle. `budgetVariance()` already respects this constraint; hold the new function to the same bar.
- Confirmed presentation-layer only: no schema change, and per locked decision 4 it must never block a write — the `PATCH`/`seed` endpoints stay unaware of balance status entirely.

### 5. Schema impact — confirmed none

`ledger_budgets` (`schema.ts:772-797`) is reused as-is; no migration required for this increment. If board-adoption capture is picked up later (Phase 1's flagged follow-up, correctly deferred), that's a new column or table — a per-`(fund,FY)` or per-`(entity,FY)` adoption record (date + board-minute reference, mirroring `ledgerTransactions.boardMinute`) is the shape to reach for then, not now. Flagging for the future work-log, not deciding it here.

### 6. Invariants

- **No migration** — confirmed above.
- **`LEDGER_MANAGE` gate** required on both the new page (`admin/ledger/budgeting/page.tsx`) and the new endpoint (`POST /api/admin/ledger/budgets/seed`), checked server-side in each (session + `hasFeature`), exactly mirroring the existing PATCH route's pattern (page-level gate is not sufficient alone — the existing code already gets this right and the new endpoint must match it, not relax it).
- **Server/client boundary:** page.tsx does all data fetching server-side; the one client island (`guided-budget-setup.tsx`) owns interactivity (seed button, confirm dialog, fetch calls) and wraps the already-client `BudgetEditor`. No new client-side data fetching beyond what the seed action itself triggers.
- **No native dialogs:** the overwrite confirmation is a `<ConfirmDialog>` (`destructive` prop, since overwriting can clobber a treasurer's prior manual edits), not `window.confirm()`.
- **Two-fund/self-balancing invariant respected:** balance guidance is advisory-only per locked decision 4 — it must never auto-move money between funds or block a save. Nothing in this design introduces write-time enforcement; confirm tech-lead's design doc states this explicitly so it isn't silently tightened during implementation.

### 7. Implementer split — specialist split, not full-stack

**api-developer** first: the `computeSeedFromPriorYear` query helper (Ruling 2), the `computeBudgetBalanceStatus` pure helper (Ruling 4), the extracted shared `upsertBudgetLine` core, and the new `POST /budgets/seed` endpoint with its request/response contract (entity, targetFY, sourceFY, per-fund overwrite flags, per-fund seeded/skipped counts). **ux-developer** second: the new `admin/ledger/budgeting/page.tsx` and the `guided-budget-setup.tsx` client island wiring seed → confirm → `BudgetEditor` reuse.

This is small enough per-file but touches enough surface (a new route with real contract design, a new page, a new client component, two new lib helpers) that the API contract benefits from being nailed down before UI work starts — matching the standing precedent that every other Ledger increment ran the specialist split cleanly. Not a full-stack candidate; this is comfortably over the ~150-line small/coupled threshold once the seed endpoint's batch logic and the per-fund review UI are both accounted for.

## Decisions logged

None required — this increment introduces no new dependency, no new top-level directory pattern (it follows the existing `admin/ledger/<feature>/page.tsx` sibling convention), and no change to the permission catalog (`LEDGER_MANAGE` already covers it, confirmed by Phase 1). Nothing rises to a `docs/decisions.md` entry. If board-adoption capture is picked up in a later increment and needs new schema, log it then.

## Handoff to Phase 3 (tech-lead)

- Design doc should nail down the exact request/response contract for `POST /api/admin/ledger/budgets/seed`, including how a "preview" (no-write, show-what-would-seed) is distinguished from the actual seed call — Phase 1's Flow 1 implies the treasurer sees pre-filled lines before anything is necessarily committed, so confirm whether seeding writes immediately (fill-empty rows go straight into `ledger_budgets`, editable after) or requires a separate "apply" step. My read of locked decision 3 (fill-empty/merge, not a staged draft) is that seeding writes immediately — tech-lead should make this explicit rather than leave it implied.
- Confirm the exact shape of the "already has a value" check per fund before the overwrite `ConfirmDialog` fires — per-line (any line already set) vs. per-fund (any line in the fund already set) changes the confirm-dialog UX meaningfully; Phase 1's overwrite policy is at the row level (`(fund,FY,category,flow)`), so the dialog copy needs to communicate that clearly (e.g., "3 of 8 categories already have a budget for FY2027 — seed the other 5, or overwrite all 8?").
- All five Phase 1 open questions are now locked per the brief this review was given; no outstanding functional gaps block Phase 3.

---

# Phase 3 — Technical Design (tech-lead) — 2026-07-27

Grounded in the actual code before designing: `src/app/api/admin/ledger/budgets/route.ts` (full PATCH handler), `getFundReport()` and `getFunds()`/`getEntity()`/`getEntities()` in `src/lib/ledger-queries.ts`, `budgetVariance()` in `src/lib/ledger.ts`, `budget-editor.tsx`, `[fundSlug]/report/page.tsx` (how `BudgetEditor` is invoked and gated), `admin/ledger/page.tsx` (entity/FY search-param convention), `fiscal-year-selector.tsx`, the `ledgerBudgets`/`ledgerFunds`/`ledgerEntities`/`ledgerCategories` schema, `admin-sidebar.tsx` (Treasury nav group), and the existing test-suite conventions (`ledger.test.ts`, `ledger-impact.test.ts`, `permissions-server.test.ts`, `members.test.ts` — confirmed the repo's actual pattern: DB-touching functions in `*-queries.ts` are **never** directly unit-tested with a mocked query builder; every existing unit-tested function is a pure, DB-import-free sibling in `ledger.ts` that the DB-touching function calls, exactly like `getFundReport()` already calls `budgetVariance()`).

## Summary

Ship a "seed next year's budget from prior-year actuals, then review each fund's balance" flow layered on top of the existing `ledger_budgets` primitive — no schema change. A new `admin/ledger/budgeting` page lets the treasurer pick an entity (Club/Foundation) and a target fiscal year, click one action to propose seed lines for every active fund of that entity (computed live from `getFundReport(fund, targetFY − 1)`), review a per-fund preview with an advisory balance indicator, and either accept (fill-empty write) or explicitly overwrite (confirm-gated). The existing `BudgetEditor` is reused unchanged for line-level adjustment after seeding. All amount math is recomputed server-side at write time — the client never gets to dictate what gets written, only which mode (`fill-empty` | `overwrite`) and which funds are in scope.

## Permissions

No new permission key. `FEATURES.LEDGER_MANAGE` (`ledger.manage`) gates the new page and the new endpoint, exactly matching today's `BudgetEditor`/`PATCH /budgets` gate — checked in the page's Server Component (redirect to `/access-pending`) **and** again inside the route handler (defense in depth, matching the existing PATCH route's pattern).

## API Contract

### `POST /api/admin/ledger/budgets/seed`

Gate: `auth()` + `hasFeature(session.user.id, FEATURES.LEDGER_MANAGE)` → 401/403, identical to the PATCH route.

**Request body:**
```ts
{
  entityId: string;             // must resolve to an existing ledgerEntities row
  targetFiscalYear: number;     // integer, 2000–2100 (same bounds as PATCH's fiscalYear check)
  mode: "fill-empty" | "overwrite";  // required — no default; forces explicit client intent
  fundIds?: string[];           // optional subset of this entity's ACTIVE fund IDs.
                                // Omitted/empty → all active funds of entityId.
                                // Lets the same endpoint back both "seed all funds"
                                // (decision 2's primary action) and a per-fund
                                // "re-seed just this fund" affordance (edge case:
                                // re-running after partial manual entry on one fund).
}
```

**Validation (in the route, before calling any shared logic):**
- `entityId` — string, must resolve via `getEntity`-style lookup (404 `"Entity not found"` if not — actually a direct `db.select().from(ledgerEntities).where(eq(id, entityId))` since `getEntity` takes a slug, not an id; add a small `entityId` lookup inline in the route, or extend `ledger-queries.ts` with a one-line `getEntityById(id)` next to `getEntity(slug)` — pick the latter for symmetry).
- `targetFiscalYear` — integer, 2000–2100 (400 otherwise, same message shape as PATCH).
- `mode` — must be exactly `"fill-empty"` or `"overwrite"` (400 otherwise).
- `fundIds`, if present — array of strings; each must belong to `entityId` and be active (400 `"Fund {id} does not belong to this entity"` otherwise). Empty array is treated as "omitted" (all funds), not "zero funds" — avoids a confusing 200-with-nothing-seeded response from an accidental `[]`.

**Server-side flow (never trusts client-supplied amounts):**
1. Look up entity, then resolve the fund scope (`getFunds(entityId)` filtered to `fundIds` if given).
2. For **each fund in scope**, call `computeSeedFromPriorYear`'s per-fund logic (see below) to get the authoritative, freshly-computed proposed lines **and** current collision state — recomputed now, inside this request, not reused from whatever the page rendered a moment ago (closes the race: someone else could have added a budget row between page load and this click).
3. Wrap the whole entity-scoped write in a single `db.transaction(...)` — one atomic unit per seed action, matching locked decision 2's framing of "one action seeds all funds of an entity." A mid-loop failure rolls back every fund's writes for this call, not just the one that failed.
4. For each proposed line (`source !== "none"`, i.e. there's something to seed): call `decideSeedWriteAction(mode, line.collision)` → `"seed" | "skip" | "overwrite"`.
   - `"skip"` → no DB call at all; count it, don't touch the row.
   - `"seed"` or `"overwrite"` → call the shared `upsertBudgetLine({ fundId, fiscalYear: targetFiscalYear, categoryId, flow, annualAmountCents: proposedAmountCents, conflictMode: "update" })` (overwrite and first-time-seed both resolve to the same DB upsert; the *label* in the response comes from `decideSeedWriteAction`'s pre-write collision check, not from inspecting what the upsert returned).
5. Build and return the response.

**Response 200:**
```ts
{
  priorFiscalYear: number;      // targetFiscalYear - 1, echoed for the UI
  targetFiscalYear: number;
  funds: Array<{
    fundId: string;
    fundSlug: string;
    fundName: string;
    seededCount: number;        // lines written for the first time
    skippedCount: number;       // fill-empty mode only — existing rows left untouched
    overwrittenCount: number;   // overwrite mode only — existing rows replaced
    lines: Array<{
      categoryId: string;
      categoryName: string;
      flow: "income" | "expense";
      amountCents: number;
      source: "actual" | "prior_budget";
      action: "seeded" | "skipped_existing" | "overwritten";
    }>;
  }>;
}
```

**Errors:** 401 (no session), 403 (no `LEDGER_MANAGE`), 400 (bad `entityId`/`targetFiscalYear`/`mode`/`fundIds`), 404 (`entityId` doesn't resolve), 500 (unexpected — same `console.error` + generic-message pattern as the PATCH route).

### `PATCH /api/admin/ledger/budgets` (unchanged contract, refactored internals)

Request/response shape is **unchanged** — this is a pure internal refactor. The handler becomes: auth + feature check → parse body → shape checks (`fundId`/`categoryId`/`flow`/`fiscalYear` presence and type, same as today) → call the shared `upsertBudgetLine({ ...params, conflictMode: "update" })` → map its result to the existing `{ action: "upserted"|"deleted", id? }` / error responses. No behavior change for existing callers (`BudgetEditor`).

### Shared upsert core — `upsertBudgetLine()` in `src/lib/ledger-queries.ts`

```ts
export type UpsertBudgetLineParams = {
  fundId: string;
  fiscalYear: number;
  categoryId: string;
  flow: "income" | "expense";
  annualAmountCents: number | null;   // null = delete the row
  conflictMode: "update" | "skip";    // "update" = today's PATCH behavior (onConflictDoUpdate);
                                       // "skip" = onConflictDoNothing (only reached via the
                                       // seed endpoint's "seed"/"overwrite" dispatch — see note below)
};

export type UpsertBudgetLineResult =
  | { ok: true; action: "upserted" | "deleted"; id?: string }
  | { ok: false; error: string; status: 400 | 404 };

export async function upsertBudgetLine(params: UpsertBudgetLineParams): Promise<UpsertBudgetLineResult>
```

Body: fetch the fund row (id, entityId, kind), fetch the category row (id, fundKind, flow), call the **pure** `validateBudgetLineInput()` (see below) with those two plain objects plus the request fields, and if invalid return its error verbatim. If valid: `annualAmountCents === null` → delete (matching today's PATCH delete branch exactly); otherwise `insert(...).onConflictDoUpdate(...)` when `conflictMode === "update"`, or `insert(...).onConflictDoNothing({ target: [...] })` when `conflictMode === "skip"`.

Note on `conflictMode: "skip"`: in practice the seed endpoint never calls `upsertBudgetLine` with `conflictMode: "skip"` for a line it already knows is a collision — `decideSeedWriteAction` filters those out before the call (step 4 above), so no DB round-trip is wasted on a line we already know will no-op. `conflictMode: "skip"` exists on the shared function for correctness/defense-in-depth (a genuine collision that appeared between the fresh recompute and the write, inside the same transaction, still gets skipped rather than silently overwritten) — this is the belt to `decideSeedWriteAction`'s suspenders, not redundant with it.

### Pure validator — `validateBudgetLineInput()` in `src/lib/ledger.ts`

```ts
export type BudgetLineValidationInput = {
  fund: { id: string; kind: string } | null;       // null = fund not found
  category: { id: string; fundKind: string; flow: string } | null; // null = category not found
  flow: "income" | "expense";
  fiscalYear: number;
  annualAmountCents: number | null;
};

export type BudgetLineValidationResult =
  | { ok: true }
  | { ok: false; error: string; status: 400 | 404 };

export function validateBudgetLineInput(input: BudgetLineValidationInput): BudgetLineValidationResult
```

This is the **one validation source of truth** the architect's Ruling 1 asks for — it carries every check the current PATCH route inlines (fiscalYear bounds, fund exists, category exists, `category.fundKind === fund.kind`, `category.flow === flow`, amount is a non-negative integer ≤ `INT4_MAX` when not null). Because it takes plain pre-fetched objects instead of doing its own DB reads, it's fully unit-testable — matching this repo's established pattern (`budgetVariance`, `isGiving`, etc.) instead of introducing this codebase's first mocked-query-builder test.

### Small addition — `decideSeedWriteAction()` in `src/lib/ledger.ts`

```ts
export function decideSeedWriteAction(
  mode: "fill-empty" | "overwrite",
  collision: boolean,
): "seed" | "skip" | "overwrite"
```
`fill-empty` + no collision → `"seed"`. `fill-empty` + collision → `"skip"`. `overwrite` + no collision → `"seed"`. `overwrite` + collision → `"overwrite"`. Trivial, but it's the one piece of "fill-empty vs. overwrite" branching logic and belongs isolated and named so it's tested directly rather than inlined into the route handler.

## `computeSeedFromPriorYear` — exact shape

Lives in `src/lib/ledger-queries.ts` per architect Ruling 2 (it's a query — composes `getFundReport`, does one extra plain `ledgerBudgets` select for collision state, does **no** transaction re-aggregation of its own). It delegates the actual mapping algorithm to the pure `deriveSeedLinesForFund()` sibling in `ledger.ts`, exactly the way `getFundReport` already delegates its per-line variance math to `budgetVariance()` — same established split, not a new pattern.

```ts
export type SeedProposedLine = {
  categoryId: string;
  categoryName: string;
  flow: "income" | "expense";
  proposedAmountCents: number;
  source: "actual" | "prior_budget";
  existingTargetAmountCents: number | null;  // current target-FY value, or null
  collision: boolean;                         // existingTargetAmountCents !== null
};

export type FundSeedPreview = {
  fund: LedgerFund;
  seedableLines: SeedProposedLine[];   // "none"-source categories are excluded entirely (see below)
  seedableCount: number;
  collisionCount: number;
};

export type EntitySeedPreview = {
  entityId: string;
  priorFiscalYear: number;
  targetFiscalYear: number;
  funds: FundSeedPreview[];
};

export async function computeSeedFromPriorYear(
  entityId: string,
  targetFiscalYear: number,
  fundIds?: string[],   // optional scope, mirrors the seed endpoint's param
): Promise<EntitySeedPreview>
```

**Prior FY derivation:** `priorFiscalYear = targetFiscalYear - 1`. Always. No separate "source FY" picker in v1 — the brief locks copy source to *the immediately preceding* year's actuals; a source-FY picker is out of scope (see Edge Cases).

**Per fund:**
1. `report = await getFundReport(fund.id, priorFiscalYear)`.
2. `fundHadPriorActuals = report.totalIncomeCents + report.totalExpenseCents > 0`. **This is the fund-level fallback trigger from locked decision 1** — it is fund-wide, not per-category: if the fund had *any* posted activity last year, every category in that fund is seeded from its own `actualCents` (even a specific category's own actual of `$0`, which still gets seeded — "you spent nothing on this last year" is real information). Only when the **whole fund** shows zero actuals does the fallback flip to prior-year budgets, category by category.
3. `existingTargetBudgetMap` — one plain `db.select().from(ledgerBudgets).where(and(eq(fundId), eq(fiscalYear, targetFiscalYear)))`, reduced to a `Map<string, number>` keyed `` `${categoryId}_${flow}` ``.
4. `priorLines = [...report.income, ...report.expense]` mapped to the pure function's plain input shape (`categoryId`, `categoryName`, `flow`, `actualCents`, `budgetCents`).
5. `seedableLines = deriveSeedLinesForFund(priorLines, fundHadPriorActuals, existingTargetBudgetMap)`.

**The pure mapping (`deriveSeedLinesForFund` in `ledger.ts`):**
```ts
export type SeedSourceLine = {
  categoryId: string;
  categoryName: string;
  flow: "income" | "expense";
  actualCents: number;
  budgetCents: number | null;   // prior-year budget, for the fund-level fallback
};

export function deriveSeedLinesForFund(
  priorLines: SeedSourceLine[],
  fundHadPriorActuals: boolean,
  existingTargetBudgetMap: Map<string, number>,
): SeedProposedLine[]
```
For each `priorLines` entry:
- `key = \`${categoryId}_${flow}\``; `existing = existingTargetBudgetMap.get(key) ?? null`; `collision = existing !== null`.
- If `fundHadPriorActuals`: `proposedAmountCents = line.actualCents`; `source = "actual"`. **Always emitted**, even when `actualCents === 0`.
- Else (fund-wide fallback): if `line.budgetCents === null` → **emit nothing** for this category+flow (matches Phase 1's gap note: a category with no prior actuals and no prior budget is a genuinely new line — leave it blank for the treasurer to fill manually, don't invent a seed value). If `line.budgetCents` is a number (including `0`): `proposedAmountCents = line.budgetCents`; `source = "prior_budget"` — an explicit `$0` budget from last year is still a real prior decision, worth carrying forward.

**Collision detection** is exactly the `existingTargetBudgetMap` lookup above — a row already exists for `(fund, targetFY, category, flow)` iff the map has that key, which mirrors the exact unique constraint (`ledger_budgets_fund_year_cat_flow_key`) the write path upserts against.

## `computeBudgetBalanceStatus` spec

Pure, `src/lib/ledger.ts`, zero `@/lib/db` imports (architect Ruling 4) — must be importable directly by the client island so it recomputes **as the treasurer types**, before any blur/save round-trip.

```ts
export type BudgetBalanceStatus = {
  status: "ok" | "warn" | "info";
  netCents: number;   // budgetedIncomeCents - budgetedExpenseCents, always returned regardless of fund kind
};

export function computeBudgetBalanceStatus(
  fundKind: "administrative" | "activity" | "charitable" | "scholarship",
  budgetedIncomeCents: number,
  budgetedExpenseCents: number,
): BudgetBalanceStatus
```

Returns `{ status, netCents }` only — no baked-in message string, matching this codebase's existing precedent (`budgetVariance` returns raw numbers; the *caller* formats dollars and composes sentences, same as the report page already does with `formatDollars()`). The client island owns four fixed message templates keyed by `(fundKind, status)` — named in the UI plan below.

**Per-fund-kind rules:**
- **`administrative`:** `warn` if `budgetedIncomeCents < budgetedExpenseCents` (a strict `<` — equal is `ok`, this is the sharpest invariant per Phase 1: the Club's operating fund should not plan a deficit). Else `ok`.
- **`activity`:** near-zero tolerance. `warn` if `Math.abs(netCents) > 10_000` (**$100**); else `ok`. **Tolerance justification (tech-lead judgment call, not a locked product number):** the Activity fund is a pass-through clearing account for publicly-raised charitable money — Phase 1 read "balanced" here as *planned receipts ≈ planned disbursements*, not an exact-zero requirement. A treasurer building an annual budget is estimating a dozen-ish hand-entered category lines, each realistically rounded to the nearest $25–$50; a $100 band absorbs that rounding noise across the whole fund without masking a genuine planning gap of hundreds or thousands of dollars. This is a numeric default the treasurer can push back on once they see it in practice — **logging as an implementation decision** (below) rather than folding it in silently, since it's a concrete threshold with real UI behavior and wasn't in the locked decisions.
- **`charitable` / `scholarship`:** always `info`, never `warn` — a planned drawdown from an existing reserve/endowment is legitimate (Phase 1's explicit point). `netCents` is still returned so the UI can say "planned draw of $X" or "planned addition of $X" or "net $0 planned."
- **Unknown/unexpected `fundKind`** (defensive — shouldn't happen given the schema's `kind` values, but the parameter is a plain string, not a literal union enforced at the DB layer): falls through to `info`, never throws, never `warn`. Never let an unrecognized kind silently produce a false "shortfall" warning.

**Presentation-only, confirmed explicitly:** neither `PATCH /budgets` nor `POST /budgets/seed` calls this function or is aware of its output. It runs only in the client island (recomputed on every keystroke from the in-progress `BudgetEditor` input state) and, redundantly, in the server page at initial render (for the pre-interaction summary). No write path is gated by it, now or via any implicit future tightening — this design doc states that explicitly so a later change can't quietly turn it into a block without a new design pass.

## UI/UX — `admin/ledger/budgeting`

### Page: `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` (Server Component)

- `auth()` → redirect `/signin` if no session (outside try, matching `admin/ledger/page.tsx`'s pattern).
- `hasFeature(session.user.id, FEATURES.LEDGER_MANAGE)` → redirect `/access-pending` if false. **Manage-only, no `LEDGER_VIEW`/`LEDGER_RECORD` fallback** — unlike the per-fund report page (view-or-manage), this whole surface only makes sense for someone who can write budgets, per architect Ruling 3.
- Reads `?entity=` and `?fy=` search params, same convention as `admin/ledger/page.tsx` and `[fundSlug]/report/page.tsx`.
  - `entity` defaults to the first entity (alphabetical, i.e. `getEntities()[0]`) if missing/invalid.
  - `fy` (target FY) defaults to `currentFiscalYear(new Date()) + 1` — guided setup is inherently *next* year's budget, not the current one. Selector options: `[currentFY, currentFY + 1, currentFY + 2]` (a synthetic list passed to the existing `FiscalYearSelector` component — that component only needs `number[]` + a `currentFY`, no DB dependency, so this reuses it as-is without modification).
- Fetches `entities = getEntities()`, the target entity's `funds = getFunds(entity.id)`, and `preview = computeSeedFromPriorYear(entity.id, targetFY)`.
- Renders:
  - Page hero: `bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12` (member-portal-style secondary hero, matching other `admin/ledger/*` sub-pages), gold eyebrow label "Treasury · Guided Budgeting".
  - Entity switcher (Club / Foundation) — two links, same tab-style pattern as the existing entity dashboard's entity cards/links, preserving `?fy=` when switching `?entity=`.
  - `FiscalYearSelector` for the target FY, `basePath="/admin/ledger/budgeting"`, preserving `?entity=`.
  - One top-level "Seed all funds from FY{priorFY}" primary button (`bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition`) — disabled with explanatory copy ("No FY{priorFY} activity or budget found — enter amounts directly below") when `preview.funds.every(f => f.seedableCount === 0)` (first-year-entity edge case, Phase 1 Flow 1's failure path, handled without a wasted network round-trip).
  - Per-fund review cards (`bg-white rounded-2xl shadow-sm overflow-hidden`, non-interactive-card style since these are informational panels, not navigational), one per fund:
    - Fund name + kind badge.
    - `seedableCount` / `collisionCount` summary line ("8 categories would be seeded from FY{priorFY} actuals — 3 already have a value for FY{targetFY}.") — when a fund's lines are sourced from `prior_budget` rather than `actual` (i.e. `fundHadPriorActuals` was false), an explicit note: "FY{priorFY} had no posted activity for this fund — seeding from last year's *budget* instead."
    - Balance indicator: `computeBudgetBalanceStatus(fund.kind, sum of budgeted income, sum of budgeted expense)` computed **from whatever is currently in `ledger_budgets` for this fund+targetFY right now** (i.e. reflects live edits, not the seed preview) — colored badge, gold/green for `ok`/`info` (never a red state anywhere per brand guidelines — `warn` renders in amber, e.g. `bg-amber-50 text-amber-800`, not `lions-red`), with the fund-kind-specific message text.
    - "Seed this fund" secondary button (per-fund scope via `fundIds: [fund.id]`) alongside the entity-wide primary action, covering the "re-run for one fund after partial manual entry" edge case.
    - The existing `BudgetEditor` rendered inline per fund (unchanged component, unchanged props — `fundId`, `fiscalYear`, `lines` built the same way `[fundSlug]/report/page.tsx` already builds `budgetEditorLines`) for line-level adjustment, exactly like today's report page.

### Client island: `src/components/admin/ledger/guided-budget-setup.tsx` (`'use client'`)

Receives the server-computed `preview` (per fund) as props. Owns:
- The "Seed all funds" / "Seed this fund" click handlers — `POST /budgets/seed` with `{ entityId, targetFiscalYear, mode: "fill-empty", fundIds? }` by default.
- **Overwrite path:** if the click would touch any fund with `collisionCount > 0`, show `<ConfirmDialog>` (`destructive` prop — this can clobber a treasurer's prior manual edits) **before** firing — copy states the exact count: *"3 of 8 categories already have a budget for FY{targetFY}. Seed only the other 5, or overwrite all 8 with FY{priorFY} figures?"* with two explicit actions ("Seed the 5 empty ones" → `mode: "fill-empty"`, "Overwrite all 8" → `mode: "overwrite"`, destructive). **Never `window.confirm()`** — this is exactly the destructive-confirm case CLAUDE.md calls out `<ConfirmDialog>` for.
- On response: `router.refresh()` (Server Component re-fetches `computeSeedFromPriorYear` + the funds' current budget rows, same pattern `BudgetEditor` already uses after its own PATCH) plus a `toast.success`/`toast.error` summarizing counts ("Administrative: 6 seeded, 2 already set.").
- Live balance readout while editing: since `BudgetEditor` already owns its own input state and posts on blur (not on every keystroke), and this design doesn't want to fork `BudgetEditor`, the pragmatic per-Phase-1-Flow-2 approach is: the client island tracks the *displayed* per-fund income/expense totals via a lightweight local reducer that mirrors `BudgetEditor`'s `inputs` state shape at the same key convention (`` `${categoryId}_${flow}` ``) — recomputed on every keystroke by summing the current input values, feeding `computeBudgetBalanceStatus` live, no additional network round-trip per keystroke. This requires threading an `onInputChange` callback into `BudgetEditor` (one new optional prop, backward compatible — existing callers on `[fundSlug]/report/page.tsx` that don't pass it are unaffected) rather than duplicating `BudgetEditor`'s save-on-blur logic. **Named as a small, explicit `BudgetEditor` prop addition** so ux-developer doesn't feel license to fork the component instead.

### Navigation

Add to `admin-sidebar.tsx`'s `"Treasury"` group (`src/components/admin/admin-sidebar.tsx`, alongside `Reports`/`Compliance`), positioned right after "Ledger" and before "Reconciliation" since it's a seasonal-but-`LEDGER_MANAGE`-only entry point, not a monthly-review one:
```ts
{
  name: "Budgeting",
  href: "/admin/ledger/budgeting",
  icon: "🧮",
  requiredFeature: FEATURES.LEDGER_MANAGE,
},
```
Optional, non-blocking (per architect's suggestion): a one-line cross-link from `[fundSlug]/report/page.tsx` ("Set up next year's budget from FY{priorFY} →" → `/admin/ledger/budgeting?entity=...`) for discoverability. Nice-to-have, not required for Phase 4 completion.

### Brand/UX compliance checklist for ux-developer
- Cards: `rounded-2xl` only (never mix with `rounded-xl`), non-interactive style since fund review panels aren't clickable.
- Buttons: `rounded-lg`, primary/secondary classes exactly as documented in CLAUDE.md — no `rounded-full`.
- `lions-gold` for the eyebrow label and any "info" accents; **no `lions-red`** anywhere — `warn` state uses amber (`amber-50`/`amber-800`), matching the existing over-budget variance styling pattern already in `[fundSlug]/report/page.tsx`.
- `<ConfirmDialog>` for the overwrite path — never `window.confirm()`.
- All links/buttons carry `focus:outline-none focus:ring-2 focus:ring-lions-blue rounded` (or `rounded-lg` where already the button radius).

## Edge Cases & Risks

- **First-year entity, no prior actuals at all:** `getFundReport(fund, priorFY)` returns a report with `totalIncomeCents + totalExpenseCents === 0` and (typically) no budget rows either → every category resolves to `source` omitted entirely (`deriveSeedLinesForFund` emits nothing when both actual and prior budget are absent). `seedableCount === 0` for that fund; the page pre-disables the seed button with explanatory copy instead of allowing a no-op POST that would look like a silent failure.
- **A fund whose prior actuals are all zero, but a prior budget existed:** `fundHadPriorActuals = false` triggers the fund-wide fallback to `budgetCents` per category — UI shows the "seeded from last year's budget, not actuals" note per fund so the treasurer isn't confused when the numbers don't match a report they might separately pull up.
- **Re-running seed after partial manual entry:** `fill-empty` mode is idempotent by construction — every rerun only ever fills categories that are *still* empty; anything the treasurer already touched (or a prior seed already wrote) is untouched, forever, unless they explicitly choose `overwrite` through the `ConfirmDialog`. No silent clobbering, matching locked decision 3.
- **Activity Fund "$0-target" policy:** there is no special-cased default for the Activity fund anywhere in seeding or upserting — it's an ordinary `ledger_budgets` row like any other fund/category/flow. The "what does balanced mean for Activity" question is fully answered by `computeBudgetBalanceStatus`'s ±$100 near-zero tolerance, not by a schema or write-path special case.
- **FY rollover mid-edit:** confirmed safe, unchanged from Phase 1's finding — `fiscalYear` is an explicit integer chosen via the selector, never an implicit "current FY," so a session spanning a July 1 rollover doesn't corrupt anything.
- **Transfers excluded from actuals:** confirmed — `computeSeedFromPriorYear` composes on `getFundReport`, whose `actualMap` only buckets `if (txn.categoryId)`, and transfers are written with `categoryId = null` (DECISION-016/017). No additional exclusion logic needed; this holds automatically because nothing here re-touches `ledgerTransactions` directly.
- **No source-FY picker in v1:** target FY − 1 is hardcoded as the source; if a treasurer wants to copy from two years back (skipping an anomalous year), that's not supported and not requested — noted so it isn't assumed later.
- **Concurrent seed calls / stale preview:** the seed endpoint recomputes `computeSeedFromPriorYear` fresh, inside its own transaction, rather than trusting whatever the page rendered — closes the race between page load and button click without needing optimistic-locking machinery.

## Unit Tests To Write (Phase 4, delivered by the implementer — api-developer)

All in `src/lib/ledger.test.ts` (extend the existing file; do not create a new pure-logic test file — this project's existing pure-logic pure tests all live in `ledger.test.ts`/`ledger-impact.test.ts` and don't need a new home for four more functions in the same source file).

**`describe("computeBudgetBalanceStatus")`**
1. `administrative`, income > expense → `ok`
2. `administrative`, income === expense → `ok` (boundary — equal is not a shortfall)
3. `administrative`, income one cent less than expense → `warn` (boundary just over)
4. `administrative`, income = 0, expense = 0 → `ok`
5. `activity`, net = 0 → `ok`
6. `activity`, net = +10,000 cents ($100 exactly — tolerance boundary, inclusive) → `ok`
7. `activity`, net = +10,001 cents (one cent past tolerance) → `warn`
8. `activity`, net = −10,000 cents (symmetric boundary on the deficit side) → `ok`
9. `activity`, net = −50,000 cents → `warn`
10. `charitable`, expense > income (planned drawdown) → `info` (never `warn`)
11. `charitable`, income > expense → `info`
12. `scholarship`, expense > income → `info`
13. Unrecognized `fundKind` string → `info`, does not throw

**`describe("deriveSeedLinesForFund")`**
14. Fund had prior actuals; category actual=$500, differing prior budget=$400 → proposed=$500, `source: "actual"` (actuals win over a differing prior budget)
15. Fund had prior actuals; a specific category's own actual is $0 → still emitted, proposed=$0, `source: "actual"` (zero is seeded, not dropped, once the fund-level fallback isn't triggered)
16. Fund had **zero** actuals fund-wide; category prior budget=$300 → fallback triggers, proposed=$300, `source: "prior_budget"`
17. Fund had zero actuals fund-wide; category prior budget=`null` → no line emitted for that category (new-category case)
18. Fund had zero actuals fund-wide; category prior budget=$0 (explicit) → emitted, proposed=$0, `source: "prior_budget"`
19. Collision: `existingTargetBudgetMap` has an entry for the category/flow key → `collision: true`, `existingTargetAmountCents` equals that value
20. No collision: key absent from map → `collision: false`, `existingTargetAmountCents: null`
21. Empty `priorLines` input → returns `[]`

**`describe("validateBudgetLineInput")`**
22. `fund: null` → `{ ok: false, status: 404 }`
23. `category: null` → `{ ok: false, status: 404 }`
24. `category.fundKind !== fund.kind` → `{ ok: false, status: 400 }` ("does not match fund type")
25. `category.flow !== requested flow` → `{ ok: false, status: 400 }`
26. `fiscalYear` out of bounds (e.g. 1999 and 2101) → `{ ok: false, status: 400 }`
27. `annualAmountCents: null` (delete path) with valid fund/category/flow → `{ ok: true }`
28. `annualAmountCents: 0` → `{ ok: true }` (explicit $0 valid)
29. `annualAmountCents` negative → `{ ok: false, status: 400 }`
30. `annualAmountCents` non-integer (e.g. `100.5`) → `{ ok: false, status: 400 }`
31. `annualAmountCents` exceeds `INT4_MAX` → `{ ok: false, status: 400 }`
32. All valid → `{ ok: true }`

**`describe("decideSeedWriteAction")`**
33. `("fill-empty", collision: false)` → `"seed"`
34. `("fill-empty", collision: true)` → `"skip"`
35. `("overwrite", collision: false)` → `"seed"`
36. `("overwrite", collision: true)` → `"overwrite"`

**Explicitly not unit-tested, and why:** `computeSeedFromPriorYear()` and `upsertBudgetLine()` themselves (the DB-touching wrappers in `ledger-queries.ts`) are **not** given mocked-query-builder unit tests — this matches the repo's existing, consistent convention (verified: no function in `ledger-queries.ts` has a unit test today; every tested Ledger function is a pure sibling in `ledger.ts`). Their correctness is covered by (a) the pure-mapping/validation tests above, which exercise every branch of the actual decision logic, and (b) qa's Phase 5 manual click-through — seed a real fund/FY through the running app and confirm the written rows match the preview and the report page. Naming this explicitly per CLAUDE.md's no-silent-skip standard, not leaving it implied.

## Implementation Order

1. **api-developer:**
   - `src/lib/ledger.ts`: add `computeBudgetBalanceStatus`, `deriveSeedLinesForFund` (+ `SeedSourceLine`/`SeedProposedLine` types), `validateBudgetLineInput` (+ `BudgetLineValidationInput`/`Result` types), `decideSeedWriteAction`. Write all 36 named tests in `src/lib/ledger.test.ts`.
   - `src/lib/ledger-queries.ts`: add `getEntityById(id)` (small sibling to existing `getEntity(slug)`), `upsertBudgetLine()`, `computeSeedFromPriorYear()`.
   - Refactor `src/app/api/admin/ledger/budgets/route.ts`'s `PATCH` to call `upsertBudgetLine()` — contract unchanged, confirm no regression by hand against the current manual test steps for that route (no existing automated test to extend).
   - New `src/app/api/admin/ledger/budgets/seed/route.ts` — `POST` handler per the contract above.
   - Typecheck + `pnpm build:only` must pass before handoff.
2. **ux-developer:**
   - Add the optional `onInputChange` prop to `src/components/admin/ledger/budget-editor.tsx` (backward-compatible — existing callers unaffected).
   - New `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` (Server Component).
   - New `src/components/admin/ledger/guided-budget-setup.tsx` (client island).
   - `src/components/admin/admin-sidebar.tsx` — add the "Budgeting" nav entry to the Treasury group.
   - Optional cross-link from `[fundSlug]/report/page.tsx` if time allows (non-blocking).

## Design calls made beyond the locked decisions (logging per CLAUDE.md)

1. **Activity fund near-zero tolerance = ±$100 (10,000 cents).** Not specified in locked decisions or Phase 1/2 — a concrete numeric threshold with real UI behavior. Logged as `DECISION-XXX` in `docs/decisions.md` below (implementation decision, tech-lead-owned).
2. **Per-fund `fundIds` scoping on the seed endpoint**, enabling a "re-seed just this fund" secondary action alongside the entity-wide primary action. Fills a Phase 1 edge case (partial manual entry) without a second endpoint. Minor API-surface choice, not logged separately — covered by this design doc.
3. **`validateBudgetLineInput` / `deriveSeedLinesForFund` extracted as pure siblings** rather than testing the DB-touching wrappers directly. Matches existing repo convention (`budgetVariance` next to `getFundReport`); not a new pattern, not logged separately.

Item 1 gets a `docs/decisions.md` entry since it's a concrete, debatable numeric constant that changes what the UI tells the treasurer — worth being able to find and revisit later without re-reading this whole work-log.

## Open questions / handoff notes for Phase 4

- **Implementer:** **api-developer** first (lib helpers, both routes, all 36 unit tests, typecheck + build green) — then **ux-developer** (page, client island, `BudgetEditor` prop addition, nav entry). Specialist split per architect Ruling 7; not a full-stack candidate (comfortably over the ~150-line small/coupled threshold once the seed endpoint's transaction logic and the per-fund review UI are both counted).
- Confirm during implementation: `getEntityById()` is a one-line addition next to `getEntity(slug)` — don't let it grow scope; it exists purely because the seed endpoint receives an `entityId`, not a `slug`.
- The $100 Activity tolerance is a starting default, not a number Chuck has seen in practice yet — flag to the user after ship that it's adjustable if the first real budgeting season shows it's too tight or too loose.
- qa (Phase 5): in addition to the standard typecheck/build/click-through, specifically exercise the `overwrite` `ConfirmDialog` path (collision count is accurate, cancel truly leaves rows untouched) and the first-year/no-prior-data disabled-button state, since neither has an automated test per the "not unit-tested" note above.

---

---

# Phase 4 — Implementation (API) — 2026-07-27

**Owner:** api-developer
**Status:** complete

### Summary

Implemented the full server layer for guided budgeting exactly per the Phase 3 design: the four pure helpers in `ledger.ts`, the `getEntityById`/`upsertBudgetLine`/`computeSeedFromPriorYear` query layer in `ledger-queries.ts`, refactored `PATCH /api/admin/ledger/budgets` to call the shared `upsertBudgetLine` core (contract unchanged), and added the new `POST /api/admin/ledger/budgets/seed` endpoint. All 36 named unit tests were written and pass, and the full existing suite stays green. No schema change, no migration — `ledger_budgets` reused as-is.

### What I did

- Added `computeBudgetBalanceStatus`, `deriveSeedLinesForFund` (+ `SeedSourceLine`/`SeedProposedLine`), `validateBudgetLineInput` (+ `BudgetLineValidationInput`/`Result`), and `decideSeedWriteAction` to `src/lib/ledger.ts` — pure, zero `@/lib/db` imports, per architect Ruling 4 and tech-lead's spec.
- Added `getEntityById(id)` (one-line sibling to `getEntity(slug)`), `upsertBudgetLine()` (the shared validation+upsert core, accepting an optional Drizzle transaction client so it can run standalone from PATCH or inside the seed route's `db.transaction()`), and `computeSeedFromPriorYear(entityId, targetFiscalYear, fundIds?)` (composes on `getFundReport()`, no new transaction re-aggregation) to `src/lib/ledger-queries.ts`.
- Refactored `PATCH /api/admin/ledger/budgets` to do only shape checks inline, then delegate fund/category/amount/fiscalYear validation and the upsert-or-delete write to the shared `upsertBudgetLine()` core. Response shape (`{ action: 'upserted'|'deleted', id? }`) and all error messages are unchanged from the original handler — verified by reading the pre-refactor handler in full before touching it.
- Added `POST /api/admin/ledger/budgets/seed`: validates `entityId`/`targetFiscalYear`/`mode`/`fundIds` (empty `fundIds` array treated as "omitted", matching the design's stated avoidance of a confusing no-op 200), recomputes the seed fresh via `computeSeedFromPriorYear` (never trusts any client-supplied amount), then writes every proposed line inside a single `db.transaction()` using `decideSeedWriteAction` to dispatch seed/skip/overwrite and `upsertBudgetLine(..., conflictMode: "update", tx)` for the actual write (per the design's explicit step 4 — both "seed" and "overwrite" actions use `conflictMode: "update"`; the response's per-line `action` label comes from the pre-write collision check, not from inspecting the upsert's return value).
- Added all 36 named unit tests to `src/lib/ledger.test.ts` (13 `computeBudgetBalanceStatus`, 8 `deriveSeedLinesForFund`, 11 `validateBudgetLineInput`, 4 `decideSeedWriteAction`), matching the design doc's exact case list including the ±$100 Activity tolerance boundary (DECISION-042).
- Did **not** add unit tests for `computeSeedFromPriorYear()` or `upsertBudgetLine()` themselves — matches the repo's existing convention (no function in `ledger-queries.ts` has ever had a mocked-query-builder unit test; every tested Ledger function is a pure sibling in `ledger.ts`), and matches the design doc's explicit "not unit-tested, and why" note.

### Outputs

**`PATCH /api/admin/ledger/budgets`** (contract unchanged, internals refactored)
- Gate: `auth()` + `hasFeature(session.user.id, FEATURES.LEDGER_MANAGE)` → 401/403.
- Request: `{ fundId: string; fiscalYear: number; categoryId: string; flow: 'income'|'expense'; annualAmountCents: number|null }`.
- Response 200: `{ action: 'upserted', id: string }` or `{ action: 'deleted' }`. Errors: 400 (bad shape/validation), 404 (fund/category not found), 500.
- File: `src/app/api/admin/ledger/budgets/route.ts`.

**`POST /api/admin/ledger/budgets/seed`** (new)
- Gate: `auth()` + `hasFeature(session.user.id, FEATURES.LEDGER_MANAGE)` → 401/403, identical pattern to PATCH.
- Request: `{ entityId: string; targetFiscalYear: number; mode: 'fill-empty'|'overwrite'; fundIds?: string[] }`.
- Response 200: `{ priorFiscalYear: number; targetFiscalYear: number; funds: Array<{ fundId, fundSlug, fundName, seededCount, skippedCount, overwrittenCount, lines: Array<{ categoryId, categoryName, flow, amountCents, source: 'actual'|'prior_budget', action: 'seeded'|'skipped_existing'|'overwritten' }> }> }`.
- Errors: 400 (bad `entityId`/`targetFiscalYear`/`mode`/`fundIds`, or a `fundIds` entry not belonging to the entity), 404 (entity not found), 500.
- File: `src/app/api/admin/ledger/budgets/seed/route.ts`.

**Server-side lib additions (no new client-facing surface, but the contract the next agent builds on):**
- `src/lib/ledger.ts`: `computeBudgetBalanceStatus(fundKind, budgetedIncomeCents, budgetedExpenseCents): { status: 'ok'|'warn'|'info', netCents: number }` — pure, importable client-side. `deriveSeedLinesForFund(priorLines, fundHadPriorActuals, existingTargetBudgetMap): SeedProposedLine[]`. `validateBudgetLineInput(input): { ok: true } | { ok: false, error, status: 400|404 }`. `decideSeedWriteAction(mode, collision): 'seed'|'skip'|'overwrite'`.
- `src/lib/ledger-queries.ts`: `getEntityById(id): Promise<LedgerEntity|null>`. `upsertBudgetLine(params, tx?): Promise<UpsertBudgetLineResult>`. `computeSeedFromPriorYear(entityId, targetFiscalYear, fundIds?): Promise<EntitySeedPreview>` — return shape has `funds: Array<{ fund: LedgerFund, seedableLines: SeedProposedLine[], seedableCount, collisionCount }>`, `priorFiscalYear`, `targetFiscalYear`.
- Schema changes: **none**. No migration filename to report — `ledger_budgets` reused as-is per architect Ruling 5.

### Verification results

- `pnpm exec tsc --noEmit` — clean, no errors.
- `pnpm test` — **516 tests passed (17 test files)**, including all 36 newly-added guided-budgeting tests (verified count: 13 + 8 + 11 + 4 = 36) and the full pre-existing suite with zero regressions.
- Did not run `pnpm db:push`/`db:migrate` (no schema change; no live `DATABASE_URL` in this sandbox) or `pnpm build:only` (known sandbox limitation — "Collecting page data" fails without `DATABASE_URL`, not a regression introduced here).

### Open questions / handoff notes

- **Next agent: ux-developer.** Build `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` (Server Component) and `src/components/admin/ledger/guided-budget-setup.tsx` (client island) per the Phase 3 UI/UX section, consuming `computeSeedFromPriorYear()` for the initial render and `POST /budgets/seed` for the seed action. Also: add the optional `onInputChange` prop to `budget-editor.tsx` (backward-compatible) for the live balance readout, and the "Budgeting" nav entry to `admin-sidebar.tsx`'s Treasury group.
- The seed endpoint's `mode`/`fundIds` contract is locked as specified above — no changes needed on the server side to support the confirm-dialog overwrite flow described in Phase 3 (the client just chooses `mode` based on the user's dialog choice).
- The $100 Activity tolerance (DECISION-042) is a starting default per the design doc — flag to the user after ship that it's adjustable if the first real budgeting season shows it's too tight or too loose.
- qa (Phase 5): per the design doc, specifically exercise the `overwrite` `ConfirmDialog` path (collision count accurate, cancel truly leaves rows untouched) and the first-year/no-prior-data disabled-button state — neither has an automated test, by design (see "Explicitly not unit-tested" note in Phase 3).

---

# Phase 4 — Implementation (UI) — 2026-07-27

**Owner:** ux-developer
**Status:** complete

### Summary

Built the client-facing guided-budgeting surface on top of api-developer's contract exactly per the Phase 3 design: a new `admin/ledger/budgeting` page (entity + target-FY selection, per-fund seed preview, live balance readout, reused `BudgetEditor` for line adjustment), the `guided-budget-setup.tsx` client island that drives the seed action and the overwrite `ConfirmDialog`, a backward-compatible `onInputChange` prop on `BudgetEditor`, and the "Budgeting" nav entry. No server code, schema, or tests were touched. Typecheck and the full test suite (516 tests) stay green.

### What I did

- Added an optional `onInputChange?: (key: string, value: string) => void` prop to `BudgetEditor` — called from the existing `handleChange` alongside the existing `setInputs`/`dirtyRef` bookkeeping, with no change to any other behavior. Verified the only other caller (`[fundSlug]/report/page.tsx`) doesn't pass it, so it's unaffected.
- Built `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` (Server Component): `auth()` + `hasFeature(LEDGER_MANAGE)` gate with redirect to `/access-pending` (manage-only, no view-or-manage fallback, per architect Ruling 3 — this page has no read-only mode). Resolves `?entity=` (defaults to the first entity on a missing/invalid slug, per the design doc — deliberately *not* `notFound()` like `reports/page.tsx`, since this is a setup tool, not a permalink) and `?fy=` (defaults to `currentFiscalYear + 1`, since guided setup is inherently next year's budget). Fetches `getFunds`, `computeSeedFromPriorYear` (the entity-wide preview), and per-fund `getFundReport(fund.id, targetFY)` (for `BudgetEditor`'s pre-fill and the pre-interaction balance numbers — same source `[fundSlug]/report/page.tsx` already uses). Builds a `FundSetupItem[]` view-model per fund and hands it to the client island. Empty states: zero entities, zero funds for the entity, and (inside the island) zero seedable lines entity-wide.
- Built `src/components/admin/ledger/guided-budget-setup.tsx` (new client island): entity-wide "Seed all funds from FY{prior}" primary action (`mode: "fill-empty"`, no `fundIds` — omitted means all active funds per the API contract) and, only when any collision exists, an "Overwrite all funds…" secondary action; per-fund "Seed this fund" / "Overwrite this fund…" actions (`fundIds: [fund.id]`); a per-fund scrollable read-only preview list of every proposed line (category, flow, proposed amount, and — when it collides — the current FY{target} value it would replace); a live balance badge + fund-kind-specific message computed via `computeBudgetBalanceStatus` (imported directly from `@/lib/ledger`, zero DB imports, so it recomputes on every keystroke); and the reused `BudgetEditor` per fund wired through the new `onInputChange` prop into a local `lineValues` reducer (keyed `${categoryId}_${flow}`, summed by trailing `_income`/`_expense` suffix) that feeds the balance readout.
- **Overwrite-confirm design adaptation (logging since it deviates slightly from the design doc's literal wording):** `ConfirmDialog` (`src/components/ui/confirm-dialog.tsx`) has exactly one Cancel + one Confirm action, not the two-choice "seed the empty ones / overwrite all" dialog the design doc sketched. Since `fill-empty` is non-destructive by construction (it only ever fills categories with no existing row — Phase 3's own framing), it doesn't need a confirm at all; only `overwrite` is destructive and needs gating. So: the plain "Seed" buttons (entity-wide and per-fund) call `fill-empty` directly, no dialog. A separate, explicitly-labeled "Overwrite…" action (entity-wide, shown only when `totalCollisions > 0`; per-fund, shown only when that fund's `collisionCount > 0`) opens the single `ConfirmDialog` with `destructive`, naming the exact collision count and total (e.g. "3 of 8 categories already have a budget for FY2027…"). Cancel leaves every row untouched, same guarantee the design doc asked for, without forking or extending the shared `ConfirmDialog` primitive.
- Added the "Budgeting" nav entry to `admin-sidebar.tsx`'s Treasury group, positioned directly after "Ledger" and before "Reconciliation" per the design doc, gated on `FEATURES.LEDGER_MANAGE`, icon `🧮`.
- **Hero banner deviation from the Phase 3 UI sketch (logging, not silent):** the design doc suggested a `py-12` blue-gradient hero. I checked every sibling `admin/ledger/*` page (`reports/page.tsx`, `compliance/page.tsx`, `[fundSlug]/report/page.tsx`, the top-level `admin/ledger/page.tsx`) and none of them use the gradient hero — they all use the plain gold-eyebrow + `<h1>` + gray subtitle header block, and grepping the whole `(dashboard)` tree found only one unrelated page (`admin/dues/[memberId]`) using the gradient. My explicit brief said to match the look of `reports`/`compliance`, which takes precedence over the design doc's hero suggestion — I used the same eyebrow/h1/subtitle header as those pages instead, for visual consistency with every other ledger sub-page. Flagging this so qa and the next reviewer aren't surprised it's not a gradient banner.
- Did **not** add the optional cross-link from `[fundSlug]/report/page.tsx` (explicitly non-blocking/optional per both the architect and tech-lead) — left for a follow-up if the Lions Club wants it.

### Outputs

- `src/components/admin/ledger/budget-editor.tsx` — added optional `onInputChange` prop (backward-compatible).
- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` — new Server Component page.
- `src/components/admin/ledger/guided-budget-setup.tsx` — new client island (`'use client'`).
- `src/components/admin/admin-sidebar.tsx` — added "Budgeting" nav entry to the Treasury group.
- No schema, route, or lib changes — server layer untouched per the brief.

### UX-gate confirmations (for qa)

- Cards: `rounded-2xl` throughout — entity-wide action panel and per-fund review cards use the non-interactive style (`shadow-sm`, no hover/translate) since they aren't navigational. No `rounded-xl` anywhere in the new files.
- Buttons: all `rounded-lg`, never `rounded-full`. Primary ("Seed all funds", "Seed this fund") = `bg-lions-blue text-white ... hover:bg-lions-blue-dark`. Secondary/overwrite ("Overwrite all funds…", "Overwrite this fund…" is a text-link style per CLAUDE.md's "inline see-all link" pattern since it's a secondary, less-prominent action) both use `text-lions-blue` variants. All interactive elements are `min-h-[44px]` or otherwise meet the 44px touch-target minimum.
- Empty states: `bg-gray-50 rounded-2xl p-10 text-center text-gray-500` for zero-entities/zero-funds; a lighter-weight `bg-gray-50 rounded-2xl p-4` inline variant for a single fund with nothing to seed (same background/radius, smaller padding to fit inside the per-fund card without dominating it).
- Colors: `lions-gold` used for the eyebrow label and as the "info" balance badge's accent background (`bg-lions-gold/10`); **no `lions-red` anywhere**. `warn` uses `bg-amber-50 text-amber-800` (matches the existing over-budget variance styling in `[fundSlug]/report/page.tsx`), never a red brand color.
- No native dialogs: the overwrite confirm uses `<ConfirmDialog destructive>` exclusively; `fill-empty` needs no dialog since it's non-destructive by construction (see adaptation note above). No `window.confirm()`/`alert()`/`prompt()` anywhere in the new files.
- Focus rings: every button/link in the new files carries `focus:outline-none focus:ring-2 focus:ring-lions-blue` (or `rounded-lg` variants of the same).
- Mobile-first: per-fund cards are a `grid-cols-1 lg:grid-cols-2` layout (matches `reports/page.tsx`'s `FundCard` grid); the proposed-lines list is independently scrollable (`max-h-56 overflow-y-auto`) so it never forces the page to scroll horizontally; action buttons wrap (`flex-wrap`) on narrow screens.
- Money formatting: reused the exact `formatDollars(cents)` local-helper pattern already duplicated across ~15 ledger components (`dashboard-entity-card.tsx`, `reports/page.tsx`, etc. — confirmed this codebase's real convention is a repeated local helper, not a shared import) rather than inventing a new one. Tabular alignment (`tabular-nums`) on every dollar figure.
- Server/client boundary: `page.tsx` is a plain Server Component doing all data fetching; `guided-budget-setup.tsx` is the one `'use client'` island, matching architect Ruling 3.
- No `console.log` in any new/edited file.

### Verification results

- `pnpm exec tsc --noEmit` — clean, no errors.
- `pnpm test` — 516 tests passed (17 test files), unchanged from api-developer's handoff — ux-developer added no new tests (none were assigned; all 36 named tests are api-developer's pure-logic tests, already written and passing).
- `pnpm build:only` — compiled successfully, and the build's own TypeScript pass (`Finished TypeScript in 40s`) also came back clean across the whole app including the new files. The build then fails at "Collecting page data" with `DATABASE_URL or DB_URL environment variable is not set` — this is the same pre-existing sandbox limitation api-developer already flagged (no live `DATABASE_URL` in this environment); it fails on an unrelated route (`/api/admin/announcements/reorder`) before ever reaching anything in this feature, so it is not a regression introduced here.
- `pnpm lint` — could not run; ESLint 9.39.2 fails to load in this sandbox with `SyntaxError: The requested module 'minimatch' does not provide an export named 'default'`, a pre-existing tooling/dependency issue unrelated to this change (reproduces on a clean tree with no edits). Flagging for deployment-engineer's dependency review rather than attempting to fix a broken lint toolchain as part of this UI task.

### Manual click-through list for qa

1. Sign in as a user with `LEDGER_MANAGE` (treasurer/admin role) and visit `/admin/ledger/budgeting` — confirm the page loads, entity switcher shows Club/Foundation, FY selector defaults to next FY.
2. Sign in as a user with only `LEDGER_VIEW`/`LEDGER_RECORD` (no `LEDGER_MANAGE`) and visit `/admin/ledger/budgeting` directly — confirm redirect to `/access-pending` (this page has no view-only mode, unlike the fund report page).
3. With a fund that has prior-FY posted actuals and no existing target-FY budget rows: click "Seed this fund" — confirm the toast summary, `BudgetEditor` pre-fills with the copied amounts, and re-visiting the page shows `collisionCount` now equal to the seeded count (so the button is now disabled or shows 0 remaining seedable, per idempotency).
4. Manually edit one budget line via `BudgetEditor`, then click "Seed this fund" again — confirm the manually-edited line is **not** clobbered (fill-empty only fills genuinely-empty rows) and the toast reflects the skip.
5. **Overwrite path (flagged by tech-lead as untested by automation):** with at least one collision present, click "Overwrite this fund…" — confirm the `ConfirmDialog` names the exact collision count (e.g. "3 of 8 categories…"), Cancel leaves all rows untouched (re-check via reload), and Confirm actually replaces the previously-set values with the FY{prior} figures.
6. **First-year/no-prior-data path (also flagged as untested by automation):** pick a fund/FY combination with zero prior-FY actuals and zero prior-FY budget rows — confirm the entity-wide button and the per-fund button both show the "No FY{prior} activity or budget found" disabled/explanatory state rather than a silent no-op POST.
7. Type into a budget input without blurring — confirm the balance badge/message on that fund's card updates live (before any network round-trip), and confirms it never blocks saving (advisory only) even when it reads "warn".
8. Confirm the "Budgeting" entry appears in the sidebar's Treasury group between "Ledger" and "Reconciliation", and is hidden entirely for a user without `LEDGER_MANAGE`.
9. Resize to a narrow mobile viewport — confirm the per-fund cards stack to one column, the proposed-lines list scrolls internally instead of widening the page, and all buttons remain tappable (44px min height).

### Open questions / handoff notes

- New copy strings the Lions Club may want to refine: "Seed all funds from FY{prior}", the fund-kind balance messages (administrative/activity/charitable/scholarship phrasing in `balanceMessage()` in `guided-budget-setup.tsx`), and the overwrite confirm copy. None are load-bearing — pure microcopy, easy to tweak later without touching logic.
- UX decision logged above: the design doc's two-choice ("seed empty / overwrite all") single dialog was adapted into "plain non-destructive seed button + separate destructive overwrite button gated by `ConfirmDialog`" because the shared `ConfirmDialog` primitive only supports one Cancel + one Confirm action. This preserves every guarantee in the design doc (exact collision count named, cancel-is-truly-inert) without forking a shared UI primitive.
- UX decision logged above: no gradient hero banner, matching the actual sibling `admin/ledger/*` pages (none of which use one) rather than the design doc's suggestion — flagged in case the Lions Club wants the gradient treatment introduced site-wide later.
- Did not add the optional `[fundSlug]/report/page.tsx` cross-link (explicitly non-blocking in both Phase 2 and Phase 3) — a clean follow-up if wanted.
- **Next agent: qa (Phase 5).** In addition to the standard typecheck/build/click-through, please specifically exercise items 4–6 in the click-through list above (idempotent re-seed, overwrite-confirm accuracy/cancel-is-inert, and the first-year disabled-state) — none of these have automated coverage by design (see Phase 3's "Explicitly not unit-tested" note), so they rely on qa's manual pass. Also please confirm `pnpm lint`'s failure in this sandbox is pre-existing and not something my changes introduced (I reproduced it and believe it is, but a second pass is warranted before assuming it away).

---

# Phase 5 — Verification (qa)

Pending

---

# Phase 6 — Shipped vs Intent (analyst)

Pending
