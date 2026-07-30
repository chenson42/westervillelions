# Activity Fund Budget Cleanup — Work Log

> **Slug:** `2026-07-30-activity-fund-budget-cleanup`
> **Surface:** (dashboard) admin — budgeting page (`src/app/(dashboard)/admin/ledger/budgeting/page.tsx`, `guided-budget-setup.tsx`) + category catalog (`ledger_categories`) + a new `ledger_funds` flag
> **Permission(s):** existing `ledger.manage` (`FEATURES.LEDGER_MANAGE`) / `budget.edit` (`FEATURES.BUDGET_EDIT`) cover this — no new key
> **Estimated complexity:** medium — schema flag + data re-file, no new UI surface
> **Pipeline mode:** Full

Cross-references: `docs/treasurer-todo.md` **T-25** ("clean up category catalog / full traceability"), **T-26** (Admin check 8002 deferred to this decision), `docs/backlog.md` **B-34** (explicit transfer categories — Zeffy pass-through), shipped Sweep feature `docs/work-log/2026-07-29-ledger-account-transfers.md` (DECISION-058), analysis source `docs/2026-07-29-budget-actuals-mapping-and-category-cleanup.md` §D/§G3/§G6, execution plan `docs/2026-07-29-clean-fy2025-plan.md`.

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

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Stop budgeting a $0-target pass-through fund and shrink its category catalog to the three categories the pass-through actually needs — but the trim can't proceed until two live-transaction rows (a $97.50 Activity "Pancake Breakfast" income row and a $53.98 Activity "Program supplies" expense row) are re-filed, and the expense re-file changes the dollar figure on the already-drafted T-04 board motion.

## Grounding (verified against production branch `br-mute-recipe-amc7uz5o`, project `tiny-fog-13725730`)

Queried `ledger_categories` and `ledger_transactions` directly rather than trusting the request's numbers in isolation:

- **Activity fund (`kind='activity'`) has exactly 4 posted transactions, ever:**
  | Date | Flow | Amount | Category | Party/memo |
  |---|---|---|---|---|
  | 2025-01-25 | income | $1.00 | Public donations | "From Winterfest" |
  | 2025-02-22 | income | $40.00 | Public donations | Jeff Reschke |
  | 2025-03-17 | income | $97.50 | **Pancake Breakfast** | Square — "Online and door ticket sales" |
  | 2025-07-29 | expense | $53.98 | **Program supplies** | Jane Enneking, check 8002, "Supplies-trash bags" |
- Net: $138.50 income − $53.98 expense = **$84.52** — this is exactly the T-04 sweep balance ("Activity Fund $84.52 → Foundation sweep," Motion 1 drafted). **The $84.52 is the fund's net balance across all 4 rows, not just the 2 rows literally tagged "Public donations."** This matters below.
- **14 active Activity-scoped categories confirmed** (7 income, 7 expense), matching the request. All except Pancake Breakfast and Program supplies have **zero** transactions ever, on either fund. `Zeffy Donations` (income) and `Transfer to Foundation` (expense) **already exist** in the catalog with 0 transactions — created by `scripts/fix-ledger-categories.ts` (§1a of `docs/2026-07-29-clean-fy2025-plan.md`), so no new category needs to be created for the trim.
- **Administrative fund already has a `Program supplies` expense category** (4 existing transactions, `countsAsGiving=false`) — an exact-name landing spot already exists for the re-filed Activity row; no new category needed there either.
- No separate `budgeted`/`excludeFromBudget` column exists on `ledger_funds` today — confirmed by reading `schema.ts:544-564`.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| admin (Treasurer/Admin, `ledger.manage`/`budget.edit`) | Opens `/admin/ledger/budgeting` and sees only Administrative + Charitable (no Activity Fund budget card) | Per budgeting session |
| admin (`ledger.manage`) | Opens the Activity fund's category picker (transaction form, "+ add category" in budgeting today) and sees only 3 categories instead of 14 | On demand, when recording an Activity transaction |
| admin (`ledger.manage`) | Records the $53.98 re-file as an edit to an existing transaction (fund + category change), citing the T-25/T-26 decision | One-time, at cleanup execution |
| admin (`ledger.approve`/board) | Approves an updated T-04 board motion figure if the re-file changes the sweep amount | One-time, before the T-04 sweep executes |

The request is data hygiene + a display filter, not new end-user-facing interaction — verbs are thin by nature. Flagging per Pass 1: this is legitimately description-heavy ("exclude a fund," "trim a catalog"), and I've pushed on it above to find the concrete hands-on-keyboard actions (re-filing two specific transactions, approving a motion figure) that the request's framing didn't surface.

## Flows

**Flow 1 — Treasurer opens the budgeting page for the Club entity:**
Entry: `/admin/ledger/budgeting?entity=club` → step: page loads funds for the entity → step: renders one `GuidedBudgetSetup` card per fund → outcome: **only Administrative Fund** renders as a budgetable card (Activity Fund is filtered out before `GuidedBudgetSetup` ever sees it).
- Failure: none new — if the Club entity ends up with *zero* budgetable funds (not today's case, but a real possibility if Administrative were ever deactivated), the page falls back to the existing "No funds configured for this entity" empty state, which is **misleading** in that scenario (funds exist, they're just excluded) — see Gaps.

**Flow 2 — Treasurer records or edits an Activity-fund transaction (any bank feed entry, e.g. a future Zeffy sweep leg):**
Entry: `/admin/ledger/activity` transaction form → step: category picker for `fund_kind='activity'` → outcome: picker shows exactly `Public donations` (income), `Zeffy Donations` (income), `Transfer to Foundation` (expense) — no other options.
- Failure: none new — this is a straightforward dropdown-contents change (`isActive=false` categories already excluded by `getCategories`'s existing `eq(ledgerCategories.isActive, true)` filter, confirmed in `ledger-queries.ts:379`).

**Flow 3 — The category-trim re-file (the load-bearing flow — a one-time data edit, not a recurring user action):**
Entry: cleanup script/admin edit, post-Chris-sign-off → step A: recategorize the $97.50 Pancake Breakfast row to `Public donations` (same fund, same category flow, **no balance impact**) → step B: **decision required** — re-file the $53.98 Program supplies row (see below) → step C: deactivate (`isActive=false`) the 11 now-empty Activity categories → outcome: catalog trimmed to 3, all 4 historical transactions still traceable to a valid category, zero rows silently orphaned.
- Failure: if step B is skipped or done in the wrong order relative to the T-04 sweep, the sweep's board-approved dollar figure goes stale (see "Sequencing hazard" below) — this is the sharpest failure mode in this whole cleanup and needs to be called out explicitly to Chris, not just handled in code.

**Flow 4 — Board approves and executes the T-04 sweep, post-cleanup:**
Entry: `/admin/ledger/activity` → Sweep to Foundation → step: enters board-minute citation, amount, confirms via `<ConfirmDialog destructive>` → outcome: two linked transactions post (Activity expense leg, Foundation income leg).
- Failure: covered by the shipped Sweep feature's own Phase 1/3 (board-minute required, one-way directional allow-list). Not re-litigated here, except for the categoryless-Club-leg question below, which touches this flow directly.

## Permissions

- **Permission(s):** existing `ledger.manage` (`FEATURES.LEDGER_MANAGE`) and `budget.edit` (`FEATURES.BUDGET_EDIT`) already gate `/admin/ledger/budgeting` (any-of, per the page's current two-tier gate). No new `FEATURES` key. The fund-level `budgeted` flag is a **data attribute, not a permission** — it changes what a fund's card *shows*, not who can see it.
- **Default roles:** unchanged — whoever holds `LEDGER_MANAGE`/`LEDGER_APPROVE`/`BUDGET_VIEW`/`BUDGET_EDIT` today (Treasurer, Admin, Budget Committee, board-level approvers).

## Mechanism Recommendation — Excluding a Fund from Budgeting

**Recommend a fund-level boolean, not a hard-coded `kind==='activity'` check.** Concretely: add `budgeted: boolean("budgeted").notNull().default(true)` to `ledgerFunds` (`schema.ts:544-564`), with an idempotent migration setting it `false` for the Activity fund row(s) (`UPDATE ledger_funds SET budgeted = false WHERE kind = 'activity'`, safe to re-run). Rationale over hard-coding the kind:
- The stated goal is general ("so it generalizes"), and `kind` is otherwise a meaningful, reused discriminator (fund-report messaging, firewall rules, transfer-direction allow-list all switch on `kind` for *behavior* that has nothing to do with budgeting) — overloading it to also mean "don't budget this" conflates two unrelated concerns and would break the day a second pass-through fund kind is ever introduced.
- It's a one-line, low-risk, additive column — no FK, no cascading schema change, `default(true)` means every existing fund (Administrative, Charitable, and any future fund) is budgeted unless explicitly excluded, so this can't silently un-budget something the day it ships.

**Where to filter, checked against the actual code (`getFunds()` in `src/lib/ledger-queries.ts:327-346`):** `getFunds(entityId)` is called from **9 other call sites** beyond the budgeting page — the fund report, the reconciliation session page, both member-facing financial-report pages, the main ledger page, the `[fundSlug]` pages, the reimbursements page, and the categories-management API route. **None of these should be affected by the exclusion** (per the request's explicit "confirm excluding from budget does NOT affect..." ask) — the Activity fund still exists for transactions, the fund report, reconciliation, and the member financial statements.

Recommend: **do not touch `getFunds()` itself.** Filter in the one place that should change — `budgeting/page.tsx:100`, `const funds = await getFunds(entity.id);` becomes `const funds = (await getFunds(entity.id)).filter((f) => f.budgeted);`. Zero risk to the 9 other call sites; a one-line change exactly where the request wants the behavior to live. (Flag to tech-lead: the `budgets/seed` route, `src/app/api/admin/ledger/budgets/seed/route.ts:217`, also calls `getFunds()` to build its seedable-fund list — if left unfiltered, a treasurer could still seed a budget line onto Activity through that API even though the UI hides it. Recommend the same one-line filter there. Everywhere else — fund report, reconciliation, `[fundSlug]` pages, financial statements — should stay unfiltered by design.)

**`guided-budget-setup.tsx` already special-cases `fundKind==='activity'`** for its balance messaging (`balanceMessage`/`balanceWhyNote`, lines 41-45 and 66-68 — "This fund is a pass-through... 'balanced' means net income and expense land within about $100 of each other"). Once Activity never reaches this component, that branch becomes dead code — flag for tech-lead to remove it (or leave it defensively for a future pass-through fund kind; tech-lead's call, not a functional gap either way).

## Category Trim — Exact Keep / Retire List

All 14 rows are `fund_kind='activity'` scoped — verified these are *separate DB rows* from any same-named Foundation/Administrative category (the schema scopes categories by `(entityId, fundKind, flow, name)`), so retiring Activity's copy **does not** touch the Foundation's `Charitable donation out`, `Service projects`, `Vision screening`, `Eyeglass recycling`, etc. — those remain fully active philanthropy-recording categories at `fund_kind='charitable'`. This is a removal from the *Activity fund's* surface only, never a global delete, and never a hard delete (`isActive=false`, preserving history/FK integrity per `onDelete:"set null"` — though after this trim, nothing should reference the retired rows going forward).

**Keep active (3):**
| Flow | Category | Current txns |
|---|---|---|
| income | Public donations | 2 → 3 after Flow-3 step A |
| income | Zeffy Donations | 0 |
| expense | Transfer to Foundation | 0 |

Definitive table, straight from the query results (`Rudolph Run` here is the Activity-scoped copy of the category, 0 txns on this fund — the Foundation-side Rudolph Run income split is separate, already-planned work per `docs/2026-07-29-clean-fy2025-plan.md` §1a/1c, out of scope here):

| # | Flow | Category | Txns | Action |
|---|---|---|---|---|
| 1 | expense | Charitable donation out | 0 | Retire directly |
| 2 | expense | Event costs | 0 | Retire directly |
| 3 | expense | Eyeglass recycling | 0 | Retire directly |
| 4 | expense | Program supplies | **1** | **Re-file first** (see below), then retire |
| 5 | expense | Service projects | 0 | Retire directly |
| 6 | expense | **Transfer to Foundation** | 0 | **KEEP** |
| 7 | expense | Vision screening | 0 | Retire directly |
| 8 | income | Interest | 0 | Retire directly |
| 9 | income | Pancake Breakfast | **1** | **Re-file first** (recategorize to Public donations), then retire |
| 10 | income | **Public donations** | 2 | **KEEP** |
| 11 | income | Rudolph Run | 0 | Retire directly |
| 12 | income | Sponsorships | 0 | Retire directly |
| 13 | income | White Cane | 0 | Retire directly |
| 14 | income | **Zeffy Donations** | 0 | **KEEP** |

3 keep, 9 retire-directly, 2 need a re-file before retiring. 3+9+2 = 14. ✓

## Re-File Plan — the Two Live Rows

**Row A — $97.50 Activity "Pancake Breakfast" income, 2025-03-17, Square, "Online and door ticket sales."**
Recommend: **recategorize only, same fund.** Change `category_id` from `Pancake Breakfast` (activity) to `Public donations` (activity). This is genuinely public/fundraiser money that landed in the club's hands and needs sweeping, per T-04's own framing (T-04 explicitly lists this $97.50 as part of the same $84.52 pass-through balance as the two Public-donations rows). It is **not** the Foundation's own, much larger Pancake Breakfast fundraiser income (that lives at `fund_kind='charitable'`, a separate row entirely, and is out of scope) — this is Activity-fund cash from the same event that happened to be deposited club-side. **No balance impact** — stays in Activity, so it doesn't touch the T-04 sweep math. Low-risk, do this one without further sign-off beyond the general go-ahead.

**Row B — $53.98 Activity "Program supplies" expense, 2025-07-29, check 8002, Jane Enneking, "Bags to Benches / trash bags."**
This is the one that needs Chris's decision, and here's why it's genuinely load-bearing, not a formality:

The trimmed catalog has **exactly one expense category left in Activity: "Transfer to Foundation."** A real vendor purchase cannot be honestly recorded under a transfer category. So keeping this row in the Activity fund at all is incompatible with the trim as specified — the only way to honor "expense = Transfer to Foundation only" is to **move this row out of the Activity fund entirely**, not just recategorize it. Administrative already has a same-named `Program supplies` expense category with 4 existing transactions — an exact, ready-made landing spot. Recommend: change both `fund_id` (activity → administrative) and `category_id` (Activity/Program supplies → Administrative/Program supplies). This is exactly the resolution T-26 already flagged as likely ("Whether to re-file it to Administrative is entangled with T-25... needs an admin-category choice... Deferred to the T-25 Activity-fund decision") and G2 recommended ("Should likely be Administrative — cleared admin acct").

**Sequencing hazard — read before executing:** moving this $53.98 expense out of Activity changes the fund's net balance from **$84.52 to $138.50** (all three income rows, no offsetting expense). T-04's board motion ("Motion 1 drafted") was drafted citing **$84.52**. If Row B's re-file happens *after* the T-04 sweep executes at $84.52, the books end up inconsistent (a retroactive fund reassignment on a transaction whose effect was already baked into a completed sweep). If it happens *before*, the sweep amount should be **$138.50**, and Motion 1's drafted figure needs updating before the board votes on it. **Recommend re-filing Row B before executing the T-04 sweep, and flagging the $84.52 → $138.50 change to whoever is finalizing Motion 1's language.** This is squarely a "confirm with Chris" item, not something to silently resolve in a script — see Open Questions.

**A genuine policy tension worth surfacing, not just the mechanical re-file:** the Activity Fund's own stated policy (`docs/treasurer-todo.md` "Activity Fund policy" reference note) is "money landing in the Activity Fund is promptly **either spent directly on service or swept to the Foundation**" — i.e., direct local service spending is an *intended* branch of the fund's purpose, not an error. Trimming the expense catalog down to *only* "Transfer to Foundation" removes the category-level ability to represent that branch at all going forward — any *future* direct-service Activity expense would have nowhere valid to post. Two ways to resolve, both legitimate, Chris's call: (a) accept that the policy's "spend directly" branch is being retired in practice — Activity becomes a pure 100%-sweep pass-through with no local spending path, which is arguably the cleaner, simpler policy anyway given the fund's near-zero real usage; or (b) keep one minimal expense category alive for the rare direct-service case (e.g. reactivate the existing zero-use `Service projects` row instead of retiring it). I'm not resolving this — it's a real fork in what "trim to essentials" means, and the two options produce different retire lists.

## Sweep Club-Leg Category — Should This Cleanup Wire It Up?

Confirmed in `docs/work-log/2026-07-29-ledger-account-transfers.md` (Phase 3, "Where each leg's fields get set" table): the shipped Sweep sets `categoryId` on the **Foundation (destination/income) leg** (defaults to "Public donations," override picker) but the **Club (source/expense) leg's `categoryId` is always `null`** — explicitly "unchanged from today," same as an ordinary same-entity Transfer. This is exactly the "Transfer to Foundation" category that B-34 originally asked for and that this cleanup keeps active with 0 transactions — it exists in the catalog today but nothing ever assigns it.

**Recommend: yes, this cleanup should make the Sweep tag its Club leg with "Transfer to Foundation"** — it's the natural, minimal completion of B-34's original ask, it's the one category this whole trim is explicitly preserving, and leaving it perpetually at 0 transactions while the Sweep silently posts a categoryless expense leg defeats the point of keeping it. **But flag this explicitly as a change to already-shipped code** (`handleTransfer` in the transactions route, per that work-log's Phase 3 field table), not a pure category-catalog edit — it needs its own small implementation slice (set the source leg's `categoryId` to the entity's `activity`/`expense`/"Transfer to Foundation" category id when `mode==='sweep'`, mirroring exactly how the destination leg already resolves "Public donations") and its own qa click-through of the Sweep flow, not just a data migration. Scope it as an explicit line item in Phase 3, don't bundle it silently into "trim the catalog."

## Gaps the Request Didn't Address

- **Empty-budgetable-funds edge case.** If a Club entity ever ends up with zero budgeted funds (not today's real case — Administrative stays budgeted — but the mechanism should handle it gracefully since it's meant to generalize), the budgeting page falls back to "No funds configured for this entity," which is factually wrong (funds exist, they're excluded). Suggest a distinct empty-state message when `funds.length > 0 && budgetableFunds.length === 0`. Low priority given today's real data, but cheap to get right now while the exclusion logic is being written.
- **`budgets/seed` route not filtered.** Flagged above — the seed API's fund list should mirror the budgeting page's exclusion, or a treasurer can seed a budget line onto Activity through a path the UI no longer shows.
- **Brand consistency:** no new UI surface is introduced (this removes a card and shrinks a dropdown), so `rounded-2xl`/`rounded-lg`/`ConfirmDialog` conventions aren't newly at risk — but the *removal* of the Activity card from `guided-budget-setup.tsx` should be checked to not leave a stray empty grid gap or broken `funds.length` count used elsewhere on the page (e.g., any "X of Y funds budgeted" summary text, if one exists) — tech-lead/ux-developer to check when implementing.
- **Mobile / empty state / failure microcopy:** no new interactive surface, so these largely inherit the existing budgeting page's existing handling. Confirmed no new form, no new destructive action beyond the existing Sweep's `<ConfirmDialog>` (unchanged by this work unless the Club-leg category slice above is adopted, which touches no UI at all — it's a default value change server-side).

## Out of Scope (confirm with user)

- Rudolph Run income 3-way split (registration/sponsorships/day-of) — already a separate, already-planned effort per `docs/2026-07-29-clean-fy2025-plan.md` §1a/1c, unrelated to the Activity fund.
- Any change to the Foundation's own `Pancake Breakfast`, `Service projects`, `Vision screening`, `Eyeglass recycling`, etc. — this cleanup only deactivates the *Activity*-scoped rows of these names; the Foundation's copies are untouched, unretired, unrenamed.
- Broader T-25 items not about the Activity fund (Ohio Lions Foundation cause split, Admin "Miscellaneous" breakup, naming-consistency pass) — separate work, tracked under T-25 generally.
- The "eliminate paired transfer legs from a consolidated org-wide income roll-up" sub-item of B-34 (double-counting risk) — explicitly still open per backlog, not touched by this cleanup.

## Open Questions

1. **Row B ($53.98 Program supplies → Administrative) — approve the re-file, and confirm the sequencing:** does it happen before or after the T-04 sweep executes? If before (recommended), Motion 1's drafted dollar figure needs to change from $84.52 to $138.50 before the board votes.
2. **The "spend directly on service" policy branch** — is Chris intentionally retiring Activity's ability to record local direct-service spending (trim to sweep-only, ever), or should one minimal expense category (e.g., reactivated `Service projects`) stay alive for that case? This changes the retire list by one row.
3. **Sweep Club-leg categorization** — confirmed recommended above; asking Chris to sign off on it being in scope for *this* cleanup (touches shipped Sweep code) versus deferred to its own tiny follow-up.
4. **Row A ($97.50 Pancake Breakfast → Public donations, same fund)** — this one reads as low-risk/no-balance-impact; flagging for a quick yes/no rather than treating it as open the way Row B is.

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

# Phase 4 — Implementation

## Files Created

- `path/to/file` — purpose

## Files Modified

- `path/to/file` — what changed

## Schema Changes

- [Tables / columns added, or "none"]
- Migration file: `drizzle/migrations/NNNN_*.sql` (idempotent)

## Implementer Notes

[Tradeoffs taken, anything that diverged from the design and why.]

---

# Phase 5 — Verification (qa)

**Date:** YYYY-MM-DD
**Verified by:** qa

## Type Check

`pnpm exec tsc --noEmit`: PASS / FAIL

## Production Build

`pnpm build:only`: PASS / FAIL

## Dev-Server Smoke Test

`pnpm dev` against `.env.local` reaches the routes without runtime error: PASS / FAIL
Notes: [...]

## Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| [user flow] | [pass / fail] | [observation] |

## Regression Notes Added (bug fixes)

- [work-log entry name — guards against: brief description]

## Verdict

[PASS | FAIL]

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

[SHIP IT | SHIP WITH NOTES | NEEDS REWORK]

## ONE-LINE TAKE

> [The shipped feature in one honest sentence.]

## What's Working

- [Specific. The flow that works well and why.]

## Intent-vs-Shipped Diff

- Phase 1 said: [X]. Shipped: [Y]. Verdict: [matches | acceptable drift | regression]

## Edge Cases

- Empty state: [pass | fail | not applicable]
- Failure microcopy: [pass | fail]
- Permission gate: [pass | fail]
- Mobile (360px): [pass | fail]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]
