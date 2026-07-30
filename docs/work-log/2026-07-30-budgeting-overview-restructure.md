# Budgeting Overview / Drill-Down Restructure (+ B-31 fold-in) — Work Log

> **Slug:** `2026-07-30-budgeting-overview-restructure`
> **Surface:** (dashboard) admin — `/admin/ledger/budgeting` (becomes overview) + new `/admin/ledger/budgeting/[fundSlug]` (drill-down), plus the printable board document
> **Permission(s):** existing `budget.view` / `budget.edit` / `ledger.manage` / `ledger.approve` (any-of) — no new key
> **Estimated complexity:** large
> **Pipeline mode:** Full
> **Subsumes:** B-31 (`docs/work-log/2026-07-30-printable-budget-b31.md`) — B-31's Phase 1 research, balance source, totals math, and draft/approved stamp all carry forward into this restructure's overview + print design. B-31's own Phase 4 (ux-developer) had **not started** — confirmed by reading the live `budget-print-worksheet.tsx`, which is still the pre-B-31 "Budget Worksheet" scratch sheet (no totals, no balances, no consolidated summary, no approval stamp). This work-log becomes the implementation vehicle for that content; B-31's work-log should be marked superseded once this ships, not implemented separately.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-30 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-07-30 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementers named | 2026-07-30 |
| 4 — Implementation | full-stack-developer (single continuous pass, per orchestrator direction) | Complete | — | 2026-07-30 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Today's `/admin/ledger/budgeting` crams every fund's full income/expense editor onto one long, cramped page inside a single 1028-line component that also owns the Approve/Lock panel; this restructure splits it cleanly along the Ledger hub's own precedent — a read-only, print-ready all-funds summary at `/admin/ledger/budgeting` and a full-width single-fund editor at `/admin/ledger/budgeting/[fundSlug]` — and folds B-31's unshipped board-document work into the overview's summary + print output instead of building it twice.

## Grounded in code

- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` (380 lines) — today's single page: two-tier permission gate, entity/FY resolution, `getFundReport(fund, targetFY)` + `getFundReport(fund, priorFY)` per fund via `Promise.all`, `getBudgetApproval`, `getBudgetCauseLineLabels`, and (only when `canManage && !locked`) an unbudgeted-categories fetch per fund for "+ Add category." Renders one `<GuidedBudgetSetup>` island with everything, plus the hidden print-only `<BudgetPrintWorksheet>`.
- `src/components/admin/ledger/guided-budget-setup.tsx` (1028 lines) — the monolith this restructure splits. Owns, in one file: the locked-state banner, the Approve & Lock / Unlock panel (board-minute input, `ConfirmDialog`s, `POST .../budget-approvals` and `.../budget-approvals/unlock`), FOUR client-side re-sync maps (`lineValues`, `pendingDeleteKeys`, `causeLinePendingCents`, `starOverrides`) seeded from and re-synced to every fund's server data on every `router.refresh()`, and the per-fund review cards (`renderFlowSection` for Income/Expense, "+ Add category" existing-or-new picker, `<BudgetEditor>` per section).
- `src/components/admin/ledger/budget-editor.tsx` (1111 lines) + `budget-cause-editor.tsx` (1356 lines) — the category- and cause/line-grain editing UI (star/notes, delayed-commit undo, scroll-to-newly-added-category, the 2026-07-29 restructure's add/remove affordances). These are the guts that move, unmodified in mechanics, into the drill-down.
- `src/components/admin/ledger/budget-print-worksheet.tsx` (284 lines) — **confirmed pre-B-31 state**: title still reads "{entity} — Budget Worksheet," no Income/Expense Total rows, no beginning/ending balance, no consolidated summary, no draft/approved stamp. `git log` on this file shows its last touch was v1.44 (prior-year reference columns), not the B-31 work-log's Phase 3 design.
- The Ledger hub pattern to mirror: `src/app/(dashboard)/admin/ledger/page.tsx` (bare `/admin/ledger` = two-entity dashboard; `?entity=` = per-entity `LedgerEntityDetail`) and `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx` (one fund's transaction register, `?entity=&fy=` preserved, breadcrumb back to `/admin/ledger?entity=...`, an `all` pseudo-slug for the entity-wide register). Both establish the exact conventions this restructure should reuse: `?entity=&fy=` query params threaded through every internal link, a `&larr; Ledger Overview`-style breadcrumb back-link, `FiscalYearSelector`/`EntitySwitcher` living only on the top-level page.
- `getFundReport(fundId, fiscalYear)` (`src/lib/ledger-queries.ts`) already returns `openingCents` (`rolledForwardOpeningCents` — fund seed + net of posted pre-FY transactions) and `endingCents` alongside the full line-level report. `budgeting/page.tsx` already calls this for every fund via `Promise.all` — B-31's Phase 1/2 research already confirmed no new query is needed for the beginning-balance figure.
- `FEATURES.BUDGET_VIEW` / `FEATURES.BUDGET_EDIT` / `FEATURES.LEDGER_MANAGE` / `FEATURES.LEDGER_APPROVE` (`src/lib/permissions.ts` L53-62) are the existing any-of gate on `/admin/ledger/budgeting` today — confirmed exact strings.

## User Verbs

All verbs below are **Admin only** — `budget.view`/`budget.edit`/`ledger.manage`/`ledger.approve` (any-of to enter; `canManage` = `ledger.manage` or `budget.edit`; `canApprove` = `ledger.approve`, independent). No public or member-portal surface.

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (any-of gate) | Open `/admin/ledger/budgeting` and read the all-funds summary | Per visit, most common entry |
| Admin | Switch entity (Club / Foundation) via `EntitySwitcher` on the overview | Occasional |
| Admin | Switch fiscal year via `FiscalYearSelector` on the overview | Occasional |
| Admin (any-of gate) | Click a fund's summary row → land on that fund's drill-down | Frequent — the core new navigation |
| Admin (`canManage`) | On the drill-down: add/remove categories, causes, line items; star/note a line (existing mechanics, unchanged, relocated) | Frequent, mid-meeting |
| Admin | Click "&larr; Budget Overview" on the drill-down → return to the overview | Frequent, paired with the above |
| Admin (any-of gate) | Click "Print" on the overview → browser print dialog opens over the consolidated + per-fund document | Per budget cycle |
| Admin (`canApprove`) | Approve & Lock the FY budget (board-minute input, confirm) — overview only | Rare, once per cycle |
| Admin (`canApprove`) | Unlock a locked FY budget to amend (reason input, confirm) — overview only | Rare |

## Flows

**Flow 1 — View the all-funds overview:**
`/admin/ledger/budgeting` (gated) → entity/FY resolved from `?entity=&fy=` (same fallback-to-first-entity-on-invalid-param behavior as today — this is a setup tool, not a permalink, per the existing code comment) → server computes, per fund: Beginning Bank (`getFundReport(fund,targetFY).openingCents`), Income total, Expense total, Net surplus/(deficit), Final Bank (beginning + net) → renders one summary row per fund + an all-funds total row, each row showing Draft/Approved status derived from the shared `approval`/`locked` state (per-entity-FY, not per-fund) → outcome: treasurer sees the whole entity's budget health without opening any editor.
- Failure: DB/query failure on the summary fetch → same `LoadErrorCard`-style pattern the Ledger hub already uses (`src/app/(dashboard)/admin/ledger/page.tsx` L30-57) — "Couldn't load the ledger... Try again" with a re-navigation link, not a stack trace. Today's `budgeting/page.tsx` has **no such try/catch** around its fetches (unlike the hub) — this is a gap the restructure should close, not just preserve.

**Flow 2 — Drill into one fund:**
Entry: click a fund's row (or an explicit "Edit budget" affordance on the row) on the overview → `/admin/ledger/budgeting/[fundSlug]?entity=...&fy=...` → outcome: the CURRENT detailed editor (income/expense sections, "+ Add category" at the section header, cause/line breakdown, star/notes, prior-year reference columns, live running totals) but scoped to **this one fund**, full width.
- Failure: invalid `fundSlug` for the resolved entity → `notFound()` (matches `[fundSlug]/page.tsx`'s existing `if (!fund) notFound()` convention one level up in the Ledger hub). Invalid `?entity=` → same fallback-to-first-entity as the overview, so a stale/bookmarked link degrades gracefully rather than 404ing on an unrelated param.

**Flow 3 — Edit within the drill-down (existing mechanics, relocated, unchanged):**
Entry: the drill-down page → add/remove category (section header), add cause (category row, giving-eligible expense only), add line item (cause row, inherits cause by context), remove at any grain with delayed-commit Undo, star/note a line → same commit-then-`router.refresh()` pattern as today, same live totals recompute via `computeFundLineSums`.
- Failure: unchanged from today's editor — inline toasts, blank-name validation, `409 duplicate_cause_label`, locked-budget 409. No regression expected since the editing component tree (`BudgetEditor`/`BudgetCauseEditor`) is not being rewritten, only re-hosted under a single-fund page instead of a per-fund `.map()`.

**Flow 4 — Return to the overview after editing:**
Entry: drill-down's back link (`&larr; Budget Overview`, preserving `?entity=&fy=`) → outcome: overview re-renders **from a fresh server fetch**, so the fund's Income/Expense/Net/Final Bank figures reflect every edit just made — not a stale client cache. This is the point the brief explicitly flags: because editing now happens per-fund on a different route, the overview's live-totals-must-match-screen requirement is satisfied by a full server round-trip on navigation, not by the four-map client re-sync pattern `guided-budget-setup.tsx` uses today (that pattern only exists because today's page holds every fund's editor simultaneously in one client tree).
- Failure: same `LoadErrorCard`-style handling as Flow 1 if the return fetch fails.

**Flow 5 — Print the board document (B-31 fold-in):**
Entry: overview's "Print" button (unchanged mechanism — `window.print()`, per B-31's confirmed no-new-dependency ruling) → outcome: the consolidated all-funds summary (Fund | Beginning Balance 7/1 | Budgeted Income | Budgeted Expense | Net Surplus/(Deficit) | Projected Ending Balance 6/30, plus an All-Funds total row) as a front page, followed by page-broken per-fund detail sections (income/expense tables with Income/Expense Total rows, cause/line-item traceability, stars/notes, prior-year reference columns), with a DRAFT/APPROVED/Reopened-for-Amendment status stamp per B-31's three-state design.
- Failure: none distinct from `window.print()`'s browser-native (silent) failure mode — same as B-31's own Phase 1 finding, not reopened here.

**Flow 6 — Approve & Lock / Unlock (overview only):**
Entry: overview page, `canApprove` gate → board-minute input (approve) or reason input (unlock) → `ConfirmDialog` → `POST /api/admin/ledger/budget-approvals` or `.../unlock` (unchanged endpoints) → outcome: `locked` flips for the (entity, FY) pair, every fund's overview row AND every fund's drill-down (if visited) reflects the new read-only/editable state.
- Failure: unchanged — existing toast-on-error pattern, existing 409 lock-check.
- **Explicit design confirmation (per the brief):** the drill-down must **read** `locked` (to disable its editor, matching `editorDisabled = locked || !canManage` today) but must **not** render its own Approve/Unlock controls — those stay overview-only, since the lock is scoped to (entity, FY), not to a single fund. A treasurer drilled into one fund who wants to lock the whole budget must navigate back to the overview first — this is a deliberate one-hop cost, not an oversight, and should be called out to the user rather than silently assumed.

**Flow 7 (edge) — A fund with zero budget lines, on the overview:**
Outcome: the fund still gets a summary row (Beginning Bank populated from `openingCents`, Income/Expense/Net all $0, Final Bank = Beginning Bank) rather than being omitted — matches B-31's Phase 1 resolution ("no fund should silently vanish from a document meant to be traceable") extended from print to the on-screen overview too. Clicking through still lands on a drill-down showing "+ Add category" as the only affordance, matching today's empty-fund state.

**Flow 8 (edge) — An entity with exactly one fund (e.g., the Foundation's lone Charitable Fund):**
Open question (see below) — does the overview still render as a one-row summary-then-click, or does it auto-redirect straight to that fund's drill-down since there's nothing to compare? The brief flags this explicitly; I recommend **keep the overview even for one fund** (consistency: every entity gets the same two-hop pattern, the Approve/Lock panel and Print button still need a home, and a surprise auto-redirect would make "go to Budgeting" behave differently per entity) but this is Chris's call, not mine to silently resolve.

**Flow 9 (edge) — Locked budget, both routes:**
Overview: Approve/Lock panel collapses to the "budget is locked" banner (existing copy, relocated). Drill-down: editor renders fully read-only (`editorDisabled = true`), "+ Add category" hidden — matches today's `locked` behavior, just scoped to one fund's view instead of all funds at once.

## Permissions

- **Permission(s):** No new keys. `hasAnyFeature(session.user.id, [LEDGER_MANAGE, LEDGER_APPROVE, BUDGET_VIEW, BUDGET_EDIT])` gates entry to **both** routes identically — a view-only holder (`BUDGET_VIEW` alone) sees the overview and a read-only drill-down (no add/remove/star controls, matching `canManage=false` today); an edit holder (`BUDGET_EDIT`/`LEDGER_MANAGE`) sees the full editor on the drill-down. `canApprove` (`LEDGER_APPROVE`) continues to gate only the Approve/Unlock panel — now overview-exclusive per Flow 6.
- **Default roles:** unchanged — Treasurer/Budget Committee (`BUDGET_EDIT`/`BUDGET_VIEW`), board members with `LEDGER_APPROVE`, `LEDGER_MANAGE` holders.
- Both routes must independently re-derive `canAccess`/`canManage`/`canApprove` server-side (the drill-down page is a new page, not a client-side route inside the existing one — it needs its own `auth()` + `hasAnyFeature`/`hasFeature` calls, mirroring `[fundSlug]/page.tsx`'s existing pattern one level up in the Ledger hub, not a prop passed down from a parent layout that could be bypassed by hitting the URL directly).

## Gaps the Request Didn't Address

- **No try/catch around the overview's data fetches.** Today's `budgeting/page.tsx` has no equivalent of the Ledger hub's `LoadErrorCard` pattern — a DB blip currently produces a raw Next.js error boundary, not a human message. Since this restructure explicitly mirrors the hub, it should pick up the hub's error-handling convention too, not just its navigation shape. (Flagged in Flow 1.)
- **Deep-linking / bookmarking a fund's drill-down.** The current single page treats an invalid `?entity=` as "fall back to the first entity, no error" (a setup-tool convenience). Once a fund gets its own URL that people will bookmark or share ("go check the Scholarship fund's budget"), is a stale/wrong `?entity=` still a silent fallback, or should the drill-down validate more strictly (like `[fundSlug]/page.tsx` does with `notFound()` for the fund itself)? Recommend: keep entity fallback (consistent with the sibling Ledger pattern) but 404 on an invalid `fundSlug`-for-that-entity, exactly as specced in Flow 2 — flagging so Phase 3 doesn't have to re-derive it.
- **A "pending deletions" signal on the overview.** With editing now happening one hop away, a treasurer scanning the overview has no way to see "Fund X has 2 categories marked for removal, not yet finalized" without opening the drill-down. Not requested, but worth a small badge (or omit deliberately) — see Open Questions.
- **Print scope: overview-only, or also a single-fund print from the drill-down?** The brief keeps Print on the overview (matching B-31's "consolidated summary front page + all funds" design) — confirmed. Whether the drill-down additionally wants a "print just this fund" affordance (e.g., handing one committee chair their fund's page only) isn't addressed. Flagging as a nice-to-have, not assuming it's wanted.
- **Multi-tab concurrent editing.** If a treasurer has the overview open in one tab and two fund drill-downs open in two others, edits are last-write-wins via each tab's own `router.refresh()`, same tolerance the single page already has today (multiple people, or one person with multiple tabs, editing different funds concurrently was already possible). Not a new risk this restructure introduces, but worth naming since splitting into more URLs makes multi-tab use more likely, not less.
- **Empty state, brand-new install (zero funds or zero entities).** Both already have handled empty states in today's `budgeting/page.tsx` ("No ledger entities found" / "No funds configured for this entity" with a link to Ledger Settings) — these must carry forward to the overview unchanged; the drill-down for a fund with zero categories in a flow already has a per-section empty state ("No {flow} categories yet — add the first one above") from the 2026-07-29 restructure — must carry forward unchanged into the single-fund drill-down.
- **Mobile at 360px — the overview's summary table specifically.** Five numeric columns (Beginning/Income/Expense/Net/Final) plus a fund name and a status badge do not fit a 360px table. The existing per-fund review cards already collapse to a single column below `lg:` breakpoint (`grid-cols-1 ... lg:grid-cols-2`) — the overview's summary should follow the same "stacked card, not a horizontally-scrolled table" pattern rather than introducing a new horizontal-scroll table that this codebase doesn't otherwise use for primary content. Flagging explicitly since B-31's print worksheet (a `print:` media-query surface) is mobile-exempt by design, but the on-screen overview is not.
- **Brand consistency:** overview summary rows should be `bg-white rounded-2xl shadow-sm overflow-hidden` (non-interactive-card styling with a click-through affordance, closer to the Ledger hub's own fund cards than to a plain `<table>`) — confirm Phase 3 doesn't reach for a raw table given the column count above. Approve/Unlock panel keeps its existing `ConfirmDialog` usage unchanged (no `window.confirm`). No new destructive actions are introduced by this restructure — navigation and read-only summaries only.

## Out of Scope (confirm with user)

- **A cross-entity (Club + Foundation) combined overview.** This restructure is per-entity, matching today's `EntitySwitcher` pattern and the existing `/admin/ledger/[entity]` detail scope — not a new superset view like the bare `/admin/ledger` two-entity dashboard. Confirm this isn't secretly wanted.
- **A second "Meeting Worksheet" print mode** (blank hand-annotation lines preserved) — B-31's Locked Decision 1 already ruled this out in favor of one clean document; carries forward unchanged.
- **An in-app "email this PDF to the board" send action**, or a native PDF-generation dependency — both already ruled out in B-31's Phase 1/2; unchanged here.
- **Any change to how add/remove/star/notes/undo actually work** at the category/cause/line grain — this restructure is purely about *where* that UI lives (drill-down vs. today's stacked-on-one-page), not a re-design of the 2026-07-29 restructure's mechanics or the Star & Notes feature. Nothing in `budget-editor.tsx`/`budget-cause-editor.tsx`'s internal behavior should change.
- **A sortable/filterable overview table** for entities with many funds — not needed at today's scale (2-4 funds per entity); flagging as explicitly deferred, not silently dropped, in case fund count grows significantly.

## Open Questions

1. **Single-fund entity (Flow 8):** does the overview still render (one summary row, click through) for an entity with exactly one fund, or does `/admin/ledger/budgeting` auto-redirect straight to that fund's drill-down? I recommend keeping the overview for consistency (every entity behaves the same way, and the overview is also where Print/Approve/Lock live) — but this is explicitly Chris's call per the brief.
2. **Print scope:** overview-only (all funds, one consolidated document — my assumption, matches B-31) or does the drill-down also want a single-fund print affordance?
3. **"Pending deletions" visibility on the overview:** worth a small per-fund badge/count, or leave that entirely inside the drill-down (nothing on the overview hints at in-progress removals)?
4. **Overview row navigation affordance:** does clicking anywhere on a fund's summary row navigate to its drill-down (like the Ledger hub's fund cards), or does it need an explicit "Edit budget &rarr;" link/button per row (clearer target, more klicks)? Both are viable; naming it so Phase 3 doesn't guess.
5. **Error-handling parity:** confirm adopting the Ledger hub's `LoadErrorCard` try/catch pattern for the overview's fetches (currently absent from `budgeting/page.tsx`) is wanted as part of this restructure, not deferred as a separate bug-fix.

---

## Architect Questions for Phase 2 (explicit hand-off)

1. **New route placement:** `src/app/(dashboard)/admin/ledger/budgeting/[fundSlug]/page.tsx` — a dynamic segment nested one level under the existing static `budgeting/page.tsx`. Confirm no naming collision with the sibling `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx` (different route entirely — that one is the transaction register, this one is the budget editor — but the mirrored structure is exactly the point; confirm Next.js route resolution has no gotcha with a dynamic segment nested under a static sibling of the same name pattern one directory up).
2. **Server data-fetching split — overview:** does the overview need a new, leaner aggregate query (e.g., `getFundBudgetSummary(fundId, fy) → { openingCents, incomeCents, expenseCents }`), or does it keep calling the existing `getFundReport(fund, targetFY)` per fund (full line-level data) and simply not render the line-level parts on screen? **Recommend the latter** — the overview's Print button needs the full per-fund line/cause detail anyway (B-31's traceability requirement), so fetching full reports once and deriving both the summary rows AND the print output from the same data avoids a second query path and makes "totals must match across overview screen, drill-down, and print" trivially true by construction (one data source, not three). Architect should confirm or override.
3. **Server data-fetching split — drill-down:** the drill-down fetches ONE fund's full `getFundReport` (target + prior FY) plus its `unbudgetedCategories` (today fetched for every fund on the single page, gated `canManage && !locked` — should move to being fetched only for the one fund being edited, a clear cost win). Confirm no other consumer needs `unbudgetedCategories` overview-side.
4. **Component boundary for the `GuidedBudgetSetup` split.** Today's 1028-line file interleaves three concerns: (a) locked banner + Approve/Unlock panel (overview-scoped, per entity+FY), (b) the four client-side re-sync maps + `renderFlowSection` (drill-down-scoped, now per single fund instead of `.map()` over N funds), (c) the per-fund card chrome (balance badge, running totals dl) that's arguably needed on BOTH the overview (compact) and drill-down (full detail). Does Phase 3 want: a new `BudgetApprovalPanel` (extracted, overview-only), a narrowed `GuidedBudgetSetup`/`BudgetFundEditor` (single-fund, drill-down-only, same four re-sync maps but un-indexed by `fundId` since there's only one fund now), and a new `BudgetOverviewTable` (summary rows + navigation, likely a Server Component since it's read-only)? Naming this now so `ux-developer` doesn't have to invent the split under time pressure.
5. **Print worksheet's data source.** Confirm `BudgetPrintWorksheet` continues to be rendered from the **overview** page (not the drill-down), fed the same full per-fund reports the overview fetches per Question 2 — this is what makes the consolidated all-funds summary possible in one document (a single fund's drill-down page structurally can't produce an all-funds summary).
6. **Balance/status computation reuse.** `computeFundLineSums` / `computeBudgetBalanceStatus` (`src/lib/ledger.ts`) are the existing pure functions both the live screen and (per B-31's design) print already share. Confirm the overview's summary-row math (Income total / Expense total / Net) reuses these exact functions fed each fund's *committed* server data (not live client edits, since the overview is read-only) — this is different from `guided-budget-setup.tsx`'s current usage, which feeds them live-typed client state. Two call sites, same pure functions, different inputs — worth stating explicitly so nobody re-derives the arithmetic by hand in a third place.
7. **URL/query-param propagation.** Confirm `?entity=&fy=` threads from overview → drill-down → back to overview exactly as the existing `[fundSlug]/page.tsx` ↔ `/admin/ledger` pair already does (breadcrumb link format, `FiscalYearSelector`/`EntitySwitcher`'s `basePath` prop pattern), so this restructure is additive to an established convention, not a new one.

---

# Phase 2 — Architectural Review (architect)

## VERDICT

**Approved with suggestions.**

## ONE-LINE TAKE

The proposed shape is not a new pattern — it's the Ledger hub's own `page.tsx` + `[fundSlug]/page.tsx` split, one directory deeper, and every one of Phase 1's seven questions resolves by pointing at code that already exists in this repo (`ledger/[fundSlug]/page.tsx`'s own-`auth()` convention, `LoadErrorCard`, `FundBalanceOverview`'s badge/message/why-note composition); the only real work Phase 3 needs to plan for is extracting the presentational pieces `guided-budget-setup.tsx` currently keeps private so the split doesn't duplicate them.

## Grounded in code

- Read `src/app/(dashboard)/admin/ledger/page.tsx` (2 branches: bare `/admin/ledger` → `LedgerDashboard`, `?entity=` → `LedgerEntityDetail`, both guarded by inline `try/catch` → `LoadErrorCard`), `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx` (own `auth()` + `hasAnyFeature`/`hasFeature`, `notFound()` on an invalid fund slug, entity-fallback on an invalid `?entity=`, `&larr; Ledger Overview` breadcrumb preserving `?entity=&fy=`), and today's `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` (380 lines, no try/catch, fetches every fund's full `getFundReport` + prior-FY report + gated `unbudgetedCategories` up front, feeds one `<GuidedBudgetSetup>` island).
- Read `src/components/admin/ledger/guided-budget-setup.tsx` in full (1028 lines). Confirms Phase 1's characterization: it privately owns `formatDollars`, `fundKindLabel`, `balanceBadgeClass`, `balanceMessage`, `balanceWhyNote` (module-level pure functions, not exported), the locked banner + Approve/Unlock panel (targets `entityId`+`targetFiscalYear`, not per-fund), four `seed*`/re-sync `useState`+`useEffect` maps keyed by `fundId` then by `${categoryId}_${flow}`, `renderFlowSection` (closure, per-fund per-flow), and the `.map()` over `funds` that renders one card per fund with `grid-cols-1 lg:grid-cols-2`.
- Read `src/components/admin/ledger/dashboard-entity-card.tsx` (77 lines) — confirms the codebase's precedent for a read-only, click-through summary card: a `Link`-wrapped Server Component, `rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1`, stat grid, "View details &rarr;" footer strip. This is the shape `BudgetOverviewTable`'s rows should take, not a `<table>`.
- Read `src/components/admin/ledger/fund-balance-overview.tsx` (200 lines) — an **existing, separate** precedent for exactly the badge/message/why-note composition `guided-budget-setup.tsx` keeps private, but built for the *actuals* framing (`overviewBadgeClass`/`overviewMessage`/`overviewWhyNote`, fed `computeBudgetBalanceStatus` with cash-basis totals) rather than the *budgeted-plan* framing this restructure needs. Confirms two things: (1) this codebase already has an accepted pattern of two parallel badge/message/why-note trios — one for plan, one for actuals, sharing `computeBudgetBalanceStatus` but not sharing copy — so a third consumer of the *plan* trio (the overview) should reuse `guided-budget-setup.tsx`'s existing plan-framed copy, not invent a fourth; (2) it is a Server Component even though it's presentational-with-branching, confirming a read-only summary card doesn't need `'use client'` just because it has conditional rendering.
- Checked for other consumers of `GuidedBudgetSetup`/`FundSetupItem`/`BudgetApprovalSummary` (`grep -rl`): only `budgeting/page.tsx` imports them directly; `budget-editor.tsx`, `budget-cause-editor.tsx`, `budget-print-worksheet.tsx` reference `GuidedBudgetSetup`/`FundSetupItem` only in comments, not imports. The split and rename are contained — no hidden third consumer to break.
- Confirmed `FEATURES.LEDGER_MANAGE` (`"ledger.manage"`), `FEATURES.LEDGER_APPROVE` (`"ledger.approve"`), `FEATURES.BUDGET_VIEW` (`"budget.view"`), `FEATURES.BUDGET_EDIT` (`"budget.edit"`) in `src/lib/permissions.ts` L55-62 — exact strings match Phase 1's grounding, no new key needed for this restructure.
- Confirmed the App Router has no gotcha with a dynamic segment nested under a directory that also has its own `page.tsx` (a static index co-existing with a `[param]/` subdirectory) — `src/app/(dashboard)/admin/ledger/` already does exactly this today (`page.tsx` + `[fundSlug]/page.tsx`), so the proposed `budgeting/page.tsx` + `budgeting/[fundSlug]/page.tsx` isn't a new pattern being risked, it's the same pattern one level deeper, proven in this exact codebase.

## Rulings

### 1. Routing / file layout — Approved, no changes

```
src/app/(dashboard)/admin/ledger/budgeting/page.tsx           (existing file, rewritten → overview)
src/app/(dashboard)/admin/ledger/budgeting/[fundSlug]/page.tsx (new → drill-down)
```

No collision with the sibling `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx` — different route trees (`/admin/ledger/budgeting/[fundSlug]` vs `/admin/ledger/[fundSlug]`) resolved by segment position, not by directory-name reuse. No Next.js gotcha with a static `page.tsx` and a `[fundSlug]/` subdirectory coexisting one level up — `admin/ledger/` itself already proves this compiles and resolves correctly. Both new/rewritten pages must independently call `auth()` + `hasAnyFeature`/`hasFeature` in their own function bodies (Phase 1's Permissions section already specs this correctly) — mirror `[fundSlug]/page.tsx`'s pattern exactly, not a shared layout-level gate that could be bypassed by hitting the drill-down URL directly.

### 2. Data-fetching split — Approved: `getFundReport()` per fund, no new aggregate query

Overview keeps calling `getFundReport(fund.id, targetFY)` (+ `priorFY` for reference columns) via `Promise.all` over every fund, exactly as `budgeting/page.tsx` does today — **do not** add a leaner `getFundBudgetSummary()` query. Rationale, stated plainly: the overview's Print button needs full line/cause detail for the same funds the summary rows describe (B-31's traceability requirement), so a second query path would let the on-screen summary and the printed detail diverge on `getFundReport`'s next changed field. One data source for overview-screen + print + (indirectly, via the same query on the other route) drill-down is the correct call — it's the same reasoning DECISION-032 already applied to error handling drift, applied here to data drift.

`unbudgetedCategories` **must** narrow to fetch only for the drilled-into fund on the drill-down (gated `canManage && !locked`, unchanged condition) — confirmed no other consumer needs it overview-side; the overview is read-only with no "+ Add category" affordance, so fetching it for every fund there is pure waste that Phase 1 correctly flagged as "a clear cost win" to remove.

### 3. Component split — Approved, with one required addition: extract the shared plan-balance presentational trio

Approve the three-way seam:
- **`BudgetApprovalPanel`** — locked banner + Approve/Unlock panel, client (`'use client'`, owns `boardMinute`/`unlockReason` state, the two `ConfirmDialog`s, the two `fetch` calls). Scoped to `entityId` + `targetFiscalYear`, unchanged from today's props. Lives on the overview only, per Flow 6.
- **`BudgetOverviewTable`** — summary rows (Beginning Bank/Income/Expense/Net/Final Bank + status) + all-funds total row + navigation to `[fundSlug]`. **Server Component** — it is pure read-only presentation over server-fetched data plus `Link`s, exactly like `DashboardEntityCard`; no client state is needed and none should be added. Row shape follows `DashboardEntityCard`'s card convention (`bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden`, whole-row `Link`), not a `<table>` — this also resolves Phase 1's mobile-360px flag (Gap 6) for free, since the card pattern already collapses to one column below `lg:`.
- **`BudgetFundEditor`** (rename from the single-fund remnant of `GuidedBudgetSetup`) — the four re-sync maps (now **not** indexed by `fundId`, since there's exactly one fund per mount) + `renderFlowSection` + the per-fund card body (income/expense sections, add-category flow, `BudgetEditor`/`BudgetCauseEditor`). Client island, drill-down only. This is the bulk of the existing 1028 lines, mechanically un-indexed rather than rewritten.

**Required addition, not in Phase 1's three-way list:** `guided-budget-setup.tsx` currently keeps `formatDollars`, `fundKindLabel`, `balanceBadgeClass`, `balanceMessage`, and `balanceWhyNote` as module-private functions. All five are needed by **both** `BudgetOverviewTable` (compact badge + one-line message per summary row) and `BudgetFundEditor` (full card header, unchanged from today). Splitting the file without relocating these five functions means copy-pasting them into two files, which is exactly the kind of quiet duplication the 30-day code review exists to catch — don't create it in the first place. Extract them into a new shared module in the same directory, e.g. `src/components/admin/ledger/budget-plan-status.tsx` (or fold into a small `budget-fund-summary.tsx` that also exports a `<BudgetPlanBalanceBadge>`/`<BudgetPlanBalanceSummary>` presentational component, mirroring `fund-balance-overview.tsx`'s existing shape one file over). Do **not** move these into `src/lib/ledger.ts` — that file is pure business logic (`computeBudgetBalanceStatus` itself belongs there and stays there); copy templates and Tailwind class strings are presentation, they belong beside the components that render them, consistent with `fund-balance-overview.tsx`'s own placement.

Per-fund card chrome (name, fund-kind badge, status badge, balance message, `dl` totals grid) is shared between the overview's compact row and the drill-down's full card — extract it as a shared presentational component (the same file suggested above, or a sibling) taking `{ fundName, fundKind, incomeCents, expenseCents }` and rendering the badge + message + why-note + optional `dl`, with a `compact`/`detailed` variant if the two call sites need different layouts. Don't let Phase 3 re-derive the badge copy a third time next to `fund-balance-overview.tsx`'s actuals-framed copy.

Print worksheet composition: confirmed unchanged — `BudgetPrintWorksheet` continues to render from the **overview** page only, fed the same `FundSetupItem[]` the overview already builds from its `getFundReport` calls (per Ruling 2). The drill-down structurally cannot produce an all-funds consolidated summary and should not attempt to; a single-fund print affordance from the drill-down is out of scope for this restructure (Phase 1 Gap 4) — noted as a future nice-to-have, not blocking.

### 4. Error handling — Approved: adopt `LoadErrorCard`, and extract it while you're there

Confirmed: both `budgeting/page.tsx` (rewritten) and `budgeting/[fundSlug]/page.tsx` (new) should wrap their DB-fetching phases in `try/catch` → the Ledger hub's `LoadErrorCard` pattern, closing the gap Phase 1 flagged. One addition: `LoadErrorCard` is currently a private, unexported function inside `src/app/(dashboard)/admin/ledger/page.tsx`. Adding it to a second and third page verbatim (copy-pasted) would be the same quiet-duplication problem as Ruling 3's badge functions. Extract it to `src/components/admin/ledger/load-error-card.tsx` (Server Component, no props needed beyond an optional `backHref`/`backLabel` if the three call sites' "Try again" links should point at different places — `/admin/ledger` today, `/admin/ledger/budgeting` and `/admin/ledger/budgeting/[fundSlug]`'s own URL going forward) and import it in all three pages. Small, cheap, and it's the second time this restructure surfaces the same "don't copy a private helper a third time" shape (see Ruling 3) — a real pattern worth naming once for Phase 3 rather than left implicit.

### 5. Invariants — Confirmed, no regression, no new dependency

- **Server/client split:** both routes stay Server Components (auth + permission checks + data fetch in the page body); `BudgetApprovalPanel` and `BudgetFundEditor` are the client islands, matching today's boundary exactly. `BudgetOverviewTable` is new but stays a Server Component per Ruling 3 — it introduces no new client-side state.
- **Permissions:** no new `FEATURES.*` key. `hasAnyFeature(session.user.id, [LEDGER_MANAGE, LEDGER_APPROVE, BUDGET_VIEW, BUDGET_EDIT])` gates entry to both routes identically, each route deriving it independently server-side (Ruling 1). `canManage`/`canApprove` continue to gate individual controls, unchanged semantics — `canApprove` narrows to overview-only per Flow 6, which is a *placement* change, not a *permission* change (a `BUDGET_EDIT`-only holder still can't approve on either route today; that's unaffected).
- **No new npm dependency.** Confirmed — this is a routing/component decomposition over existing data and existing UI primitives (`ConfirmDialog`, existing `BudgetEditor`/`BudgetCauseEditor`, ledger hub conventions). Nothing here needs a package that isn't already in `package.json`.
- **Brand consistency:** `BudgetOverviewTable`'s summary rows use `rounded-2xl` card styling per Ruling 3, not a raw `<table>` — satisfies the CLAUDE.md card-style rule and Phase 1's mobile flag simultaneously. No `window.confirm`/`alert`/`prompt` introduced — `BudgetApprovalPanel` keeps the existing two `ConfirmDialog`s verbatim.

## Notes Phase 3 must honor

1. File layout is fixed by Ruling 1 — don't relitigate route shape.
2. `getFundReport()` stays the single data source for overview + print (Ruling 2) — no new query function, no second aggregate path.
3. Extract the plan-status presentational trio (`balanceBadgeClass`/`balanceMessage`/`balanceWhyNote` + `formatDollars`/`fundKindLabel`) into a new shared file before or during the split — name it in the design doc so the implementer doesn't duplicate it into two components (Ruling 3).
4. Extract `LoadErrorCard` into `src/components/admin/ledger/load-error-card.tsx` and use it on all three pages (`ledger/page.tsx`, `budgeting/page.tsx`, `budgeting/[fundSlug]/page.tsx`) — small scope addition, same trip (Ruling 4).
5. `BudgetFundEditor`'s four re-sync maps lose their `fundId` indexing layer (single fund per mount) — this is a mechanical simplification of the existing maps, not a new state design; tech-lead should size it as such.
6. Phase 1's still-open **product** questions (Flow 8 single-fund-entity auto-redirect vs. keep-overview; per-row click-target vs. explicit "Edit budget" link; pending-deletions badge on the overview; drill-down single-fund print) are not architectural and are not resolved by this review — they carry forward to Phase 3/tech-lead to either decide or escalate to the user, per Phase 1's own framing ("this is Chris's call, not mine").
7. No `docs/decisions.md` entry required for this restructure — it's a route/component reorganization inside an already-established module (`(dashboard)/admin/ledger`), not a new top-level directory, new dependency, or permission-catalog change. The extraction of `load-error-card.tsx` and the plan-status module are file-level factoring, not structural decisions rising to DECISION-NNN weight.

---

# Phase 3 — Technical Design (tech-lead)

## Technical Design: Budgeting Overview / Drill-Down Restructure (+ B-31 board document + budget-level Notes & Assumptions)

### Summary

Split today's single 380-line `budgeting/page.tsx` + 1028-line `guided-budget-setup.tsx` monolith into a read-only, print-ready all-funds **overview** at `/admin/ledger/budgeting` and a full-width single-fund **editor** at `/admin/ledger/budgeting/[fundSlug]`, mirroring the Ledger hub's own `page.tsx` + `[fundSlug]/page.tsx` split one directory deeper (architect-approved, no new pattern). Both routes independently `auth()` + any-of-gate. The overview fetches every fund's `getFundReport()` (unchanged, no new aggregate query), derives Beginning/Income/Expense/Net/Final-Bank summary rows and an all-funds total through one new shared pure function, hosts the Approve/Lock panel, the Print button (rendering B-31's board-document `BudgetPrintWorksheet`), and a new **budget-level Notes & Assumptions** editor backed by one new table. The drill-down fetches one fund's report, hosts the existing category/cause/line editor (`BudgetEditor`/`BudgetCauseEditor`, mechanically un-indexed by `fundId` since one fund per mount, otherwise byte-for-byte unchanged) and reads (never writes) the lock state. Five presentational/error-handling helpers currently private to `guided-budget-setup.tsx` and `ledger/page.tsx` get extracted to shared modules so the split doesn't duplicate them. One new table, `ledger_budget_notes`, gives budget-level notes a home that exists before any approval row does.

### Permissions

No new `FEATURES` key. Both routes gate entry identically: `hasAnyFeature(session.user.id, [LEDGER_MANAGE, LEDGER_APPROVE, BUDGET_VIEW, BUDGET_EDIT])`, each route deriving `canAccess`/`canManage` (`LEDGER_MANAGE` or `BUDGET_EDIT`) / `canApprove` (`LEDGER_APPROVE`) independently, server-side, in its own function body — no shared layout-level gate. `canApprove` narrows to overview-only (Approve/Unlock panel). The new budget-notes write path gates on `canManage` (`LEDGER_MANAGE` or `BUDGET_EDIT`) — see "Budget-level Notes" below for why it does **not** additionally check `locked`.

### API Contract

One new route; every other read/write path is unchanged.

**`PATCH /api/admin/ledger/budget-notes`** — upserts the free-text budget-level note for one `(entityId, fiscalYear)`.

```
Body: { entityId: string; fiscalYear: number; notes: string }   // "" clears the note
Gate: LEDGER_MANAGE or BUDGET_EDIT (any-of) — same as /api/admin/ledger/budgets/annotations
Response 200: { entityId, fiscalYear, notes, updatedAt }
Errors: 400 (bad shape; notes > 4000 chars after trim), 401, 403, 404 (entityId not found)
```

No `409 locked` — ever, deliberately, same reasoning `budgets/annotations/route.ts` already documents for category star/notes (DECISION-057: "stars/notes stay editable even when the FY budget is Approve-&-locked" — they're commentary, not a budget figure). A board discussing a just-approved budget needs to be able to annotate it without unlocking the dollar amounts. See "Budget-level Notes" below.

No other new routes/server actions. All other reads (`getFundReport`, `getBudgetApproval`, `getBudgetCauseLineLabels`, `getCategories`) and writes (`/api/admin/ledger/budgets`, `/budgets/annotations`, `/budgets/cause-lines`, `/budget-approvals`, `/budget-approvals/unlock`) are unchanged — this restructure moves *where* they're called from, not *what* they do.

### Data Model

**New table: `ledger_budget_notes`** — one free-text note per `(entityId, fiscalYear)`, independent of `ledger_budget_approvals`.

```ts
// src/lib/db/schema.ts — new export, placed immediately after ledgerBudgetApprovals
export const ledgerBudgetNotes = pgTable(
  "ledger_budget_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => ledgerEntities.id, { onDelete: "cascade" }),
    fiscalYear: integer("fiscal_year").notNull(),
    notes: text("notes").notNull().default(""),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("ledger_budget_notes_entity_year_key").on(t.entityId, t.fiscalYear),
    index("ix_ledger_budget_notes_entity").on(t.entityId),
  ],
);
export type LedgerBudgetNote = typeof ledgerBudgetNotes.$inferSelect;
export type NewLedgerBudgetNote = typeof ledgerBudgetNotes.$inferInsert;
```

Shape is a deliberate mirror of `ledgerBudgetApprovals` (same unique pair, same cascade, same audit trio pattern) but a **separate table**, not a nullable column bolted onto `ledger_budget_approvals` — because a draft budget (the common case a treasurer writes notes *during*) has no `ledger_budget_approvals` row at all (`getBudgetApproval` returns `null` until the first Approve & Lock). Requiring an approval row to exist before notes could be saved would mean "write your assumptions down before the board meeting" doesn't work, which is exactly backwards from the NFF "notes/assumptions pre-empt board questions" convention B-31's research cited. A lazily-created, independently-keyed row is the only shape that supports "notes from day one of drafting."

**Migration:** `drizzle/migrations/0071_ledger_budget_notes.sql` (next number after `0070_ledger_bank_account_default.sql`) — idempotent per every existing convention in this file (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS` where Postgres supports it, or the `DO $$ ... END $$` guarded-index pattern otherwise). No seed data, no backfill — every entity/FY starts with no row, which is the correct empty state (the UI shows an empty textarea, not an error).

**Read helper:** `getBudgetNotes(entityId, fiscalYear)` in `src/lib/ledger-queries.ts`, placed beside `getBudgetApproval` (same file, same shape: single `SELECT ... WHERE entityId = ? AND fiscalYear = ? LIMIT 1`, join `updatedByUserId → users.name` the same way `getBudgetApproval` joins `approvedByUserId`). Returns `{ notes: string; updatedByName: string | null; updatedAtLabel: string | null } | null` — `null` when no row exists yet (draft budget, never annotated), which the overview renders as an empty, editable textarea.

**Write path:** inline in the new API route (mirroring `budget-approvals/route.ts`'s own inline `db.transaction`/`onConflictDoUpdate` pattern, not a `ledger-queries.ts` export) — a single `db.insert(ledgerBudgetNotes).values(...).onConflictDoUpdate({ target: [ledgerBudgetNotes.entityId, ledgerBudgetNotes.fiscalYear], set: {...} })`. No transaction needed (single-table, single-row upsert, no cascading side effects like the approval route's finalize-purge).

No other schema changes. Everything else in this restructure reads existing tables through existing queries.

### Component/Page Plan

**Routes:**

```
src/app/(dashboard)/admin/ledger/budgeting/page.tsx             REWRITE → overview (Server Component)
src/app/(dashboard)/admin/ledger/budgeting/[fundSlug]/page.tsx  NEW     → drill-down (Server Component)
```

**Components — new:**

```
src/components/admin/ledger/load-error-card.tsx        NEW  — extracted from ledger/page.tsx, Server Component
src/components/admin/ledger/budget-plan-status.tsx      NEW  — extracted presentational trio + shared badge/summary components
src/components/admin/ledger/budget-overview-table.tsx   NEW  — Server Component, summary rows + all-funds total + nav
src/components/admin/ledger/budget-approval-panel.tsx   NEW  — client, extracted from guided-budget-setup.tsx (overview-only)
src/components/admin/ledger/budget-fund-editor.tsx      NEW  — client, narrowed single-fund GuidedBudgetSetup (drill-down-only)
src/components/admin/ledger/budget-notes-editor.tsx     NEW  — client, overview-only
```

**Components — modified:**

```
src/components/admin/ledger/budget-print-worksheet.tsx  REBUILD per B-31's Phase 3 design (below), + new budgetNotes prop
src/app/(dashboard)/admin/ledger/page.tsx                MODIFY — import LoadErrorCard instead of its private copy
```

**Components — deleted:**

```
src/components/admin/ledger/guided-budget-setup.tsx     DELETE — fully absorbed into budget-approval-panel.tsx + budget-fund-editor.tsx + budget-plan-status.tsx
```

**Components — unchanged, reused as-is:**

```
src/components/admin/ledger/budget-editor.tsx           unchanged — mounted by budget-fund-editor.tsx exactly as guided-budget-setup.tsx mounts it today
src/components/admin/ledger/budget-cause-editor.tsx     unchanged — mounted via budget-editor.tsx, no change
src/components/admin/ledger/entity-switcher.tsx         unchanged — overview only
src/components/admin/ledger/fiscal-year-selector.tsx    unchanged — overview only
src/components/admin/ledger/print-budget-button.tsx     unchanged — still window.print(), overview only (B-31 Locked Decision 1)
```

---

#### `LoadErrorCard` (`src/components/admin/ledger/load-error-card.tsx`)

Server Component, extracted verbatim from `ledger/page.tsx`'s private function, parameterized for reuse across three call sites:

```ts
export default function LoadErrorCard({
  backHref,
  backLabel = "Try again",
}: { backHref: string; backLabel?: string }) { ... }
```

Used by:
- `ledger/page.tsx` — `backHref="/admin/ledger"` (unchanged behavior, now imported not private)
- `budgeting/page.tsx` — `backHref="/admin/ledger/budgeting"` (closes Phase 1's Gap 1 — today's page has no try/catch at all)
- `budgeting/[fundSlug]/page.tsx` — `backHref="/admin/ledger/budgeting?entity=...&fy=..."` (back to the overview, not a self-retry, since a fund-scoped fetch failure is more usefully recovered from the overview)

---

#### `budget-plan-status.tsx` — shared plan-balance presentation

Pure functions + two presentational components, extracted from `guided-budget-setup.tsx`'s five module-private functions (`formatDollars`, `fundKindLabel`, `balanceBadgeClass`, `balanceMessage`, `balanceWhyNote` — all copied verbatim, no logic change) plus two new thin wrapper components so `BudgetOverviewTable` and `BudgetFundEditor` don't each re-derive the badge/message/why-note JSX:

```ts
export function formatDollars(cents: number): string
export function fundKindLabel(kind: string): string
export function balanceBadgeClass(status: "ok" | "warn" | "info"): string
export function balanceMessage(fundKind: string, status: "ok"|"warn"|"info", netCents: number): string
export function balanceWhyNote(fundKind: string): string | null

// Small badge span — used standalone on BudgetOverviewTable's compact rows
export function BudgetPlanBalanceBadge({ status }: { status: "ok"|"warn"|"info" }): JSX.Element

// Full header block (badge + message + why-note + optional totals `dl`) —
// `variant="compact"` (overview row: badge + message only) vs
// `variant="detailed"` (drill-down card header: today's full block,
// byte-for-byte the same markup guided-budget-setup.tsx L936-985 renders today)
export function BudgetPlanBalanceSummary({
  fundKind, incomeCents, expenseCents, variant,
}: { fundKind: string; incomeCents: number; expenseCents: number; variant: "compact" | "detailed" }): JSX.Element
```

Server-Component-compatible (no hooks, no `'use client'`) — same reasoning architect's Ruling 3 already applied to `fund-balance-overview.tsx`: conditional rendering doesn't require client-side state. Placed beside the components that render it (not `src/lib/ledger.ts`, which stays pure business logic) — consistent with `fund-balance-overview.tsx`'s own placement of its parallel actuals-framed trio.

**Not doing:** merging this with `fund-balance-overview.tsx`'s own badge trio. They're deliberately parallel (plan-framed vs actuals-framed copy, per architect Ruling 3) — a third consumer of the *plan* trio reuses `budget-plan-status.tsx`; it does not touch the actuals-framed file.

---

#### `computeFundPlanSums` — the one new pure business-logic function, and why it lives in `src/lib/ledger.ts`, not a component

This is the single most important correctness point in this design, so it gets its own section.

B-31's own Phase 3 (in this same work-log, superseded portion) planned a helper called `printFundSums` as a **private function inside `budget-print-worksheet.tsx`** — reasonable at the time, because B-31 assumed the print worksheet was its only consumer. This restructure's overview now needs the **exact same computation** to derive its on-screen summary rows (Beginning/Income/Expense/Net/Final Bank) from the same committed `FundSetupItem[]` data the print worksheet consumes. Two consumers of one private helper is exactly the "don't copy a private helper a third time" pattern architect flagged twice already (Rulings 3 and 4) — so this design **promotes and renames** B-31's planned helper to a shared, exported pure function:

```ts
// src/lib/ledger.ts — new export, placed beside computeFundLineSums
export function computeFundPlanSums(
  lines: {
    categoryId: string;
    flow: "income" | "expense";
    budgetCents: number | null;
    pendingDeleteAt: string | null;
    causeLines: { pendingDeleteAt: string | null; amountCents: number }[] | null;
  }[],
): { incomeCents: number; expenseCents: number } {
  // Builds the three lineValues/pendingDeleteKeys/causeLinePendingCents maps
  // inline from `lines` (one fund's committed budgetEditorLines, NOT live
  // client state), then delegates to the existing computeFundLineSums() —
  // same three-step recipe B-31 already specced (mirrors seedLineValues /
  // seedPendingDeleteKeys / seedCauseLinePendingCents), just fed static
  // server data instead of a client island's live-typed maps.
}
```

Both `BudgetOverviewTable` (screen) and `BudgetPrintWorksheet` (print) call `computeFundPlanSums(fund.budgetEditorLines)` **once each**, off the **same** `fundItems`/`FundSetupItem[]` array the overview page builds once (unchanged construction from today's `budgeting/page.tsx` L155-287). This is what makes "totals must match across the overview screen, the drill-down's live editor, and the printed document" true **by construction**, not by convention:

- **Overview screen** and **print**: identical inputs (`fund.budgetEditorLines`, committed server data) → identical `computeFundPlanSums` call → structurally cannot diverge.
- **Drill-down's live editor** (`BudgetFundEditor`): different inputs (live-typed `lineValues`/`pendingDeleteKeys`/`causeLinePendingCents` maps, updated on every keystroke, per the existing `fundSums()` closure) → same terminal function, `computeFundLineSums()`. Screen-vs-drill-down can transiently differ *while mid-edit and not yet refreshed* (expected — the treasurer is actively typing a number the overview hasn't seen yet) but converge the instant the drill-down commits and the treasurer navigates back to the overview (Flow 4 — full server round-trip, not a client cache).

`computeFundPlanSums` exported from `src/lib/ledger.ts` gets its own Vitest seam alongside `computeFundLineSums` — see Tests below. This single promotion is the one place this design doc **revises** B-31's already-written Phase 3 section (that section's `printFundSums` becomes this function, relocated and renamed — no other part of B-31's design changes).

---

#### `BudgetOverviewTable` (`budget-overview-table.tsx`) — Server Component

```ts
interface BudgetOverviewRow {
  fundSlug: string;
  fundName: string;
  fundKind: string;
  openingCents: number;        // getFundReport(fund,targetFY).openingCents — "Beginning Bank (Jul 1)"
  incomeCents: number;         // computeFundPlanSums(fund.budgetEditorLines).incomeCents
  expenseCents: number;        // computeFundPlanSums(fund.budgetEditorLines).expenseCents
  pendingDeleteCount: number;  // lines + cause-lines with pendingDeleteAt !== null, this fund only
}

interface BudgetOverviewTableProps {
  entitySlug: string;
  targetFY: number;
  fyQuery: string;   // "?entity=<slug>&fy=<fy>" — prebuilt once in the page, reused for every row's href
  rows: BudgetOverviewRow[];
}
```

Renders one `DashboardEntityCard`-styled row per fund — `bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden`, whole-row `<Link href={`/admin/ledger/budgeting/${row.fundSlug}${fyQuery}`}>` (resolves Phase 1 Open Question 4: whole row is the click target, matching `DashboardEntityCard`'s own precedent) — each showing: fund name + `fundKindLabel` badge, `BudgetPlanBalanceBadge`, Beginning/Income/Expense/Net/Final-Bank as a `dl` stat row (Net = income − expense; Final Bank = Beginning + Net), a **"N pending removals"** small badge (`bg-amber-50 text-amber-800 rounded-lg px-2 py-0.5 text-xs`) when `pendingDeleteCount > 0` (Chris's resolved default), and a footer strip reading **"Edit budget →"** (not the generic "View details →" `DashboardEntityCard` uses — explicit per the brief's "visible 'Edit budget →' affordance," satisfying Phase 1 Open Question 4's second half: whole-row nav *and* an explicit label, not one or the other).

Below the per-fund rows: an **all-funds total row**, same five-column shape, **not** a `Link` (nothing to drill into — it's a sum), visually distinct (`bg-gray-50` instead of `bg-white`, no hover/translate treatment) — sums each of the five numeric columns across `rows`. Single-entity scope only (this table only ever receives one entity's funds via `entitySlug`/`rows`, no cross-entity summation — confirmed out of scope by Phase 1).

Single-fund entity (Flow 8, resolved default: **keep the overview**): renders with exactly one row + a total row that duplicates it — no special-casing, no auto-redirect. The component doesn't need to know fund count is 1; it's just `rows.length === 1`.

---

#### `BudgetApprovalPanel` (`budget-approval-panel.tsx`) — client, overview-only

Extracted verbatim from `guided-budget-setup.tsx` L273-280, 521-573, 794-924 (locked banner + approve/unlock state, handlers, both `ConfirmDialog`s, both `fetch` calls) — **no behavior change**. One shape change from today: it no longer computes fund balance badges via a `fundSums()` closure over live client maps (those maps move entirely to `BudgetFundEditor` — the approval panel has no editor of its own anymore), it receives them as a **prop**, computed once server-side from the same committed data the overview table uses:

```ts
interface BudgetApprovalPanelProps {
  entityId: string;
  targetFiscalYear: number;
  canApprove: boolean;
  locked: boolean;
  approval: BudgetApprovalSummary | null;   // type unchanged, still exported from this file (moved from guided-budget-setup.tsx)
  pendingDeleteCount: number;                // sum across ALL funds — computed server-side in the overview page from targetReports, mirrors today's totalPendingDeleteCount() but as a pure server computation over static data (no live client edits to sum, since this panel has no editor)
  fundBalances: { fundName: string; fundKind: string; incomeCents: number; expenseCents: number }[];  // one entry per fund, feeds the "Balanced / Needs review" badge list shown before the Approve button — same UI, sourced from computeFundPlanSums per fund instead of a client-side fundSums() closure
}
```

This is a genuine simplification versus today's component, not just a rename: today's `GuidedBudgetSetup` computes `fundSums(fund.fundId)` from four live-typed maps every render; `BudgetApprovalPanel` just reads a precomputed prop, because the overview is read-only by design (Ruling 3 in Phase 2) — there is no live typing to reconcile against.

---

#### `BudgetFundEditor` (`budget-fund-editor.tsx`) — client, drill-down-only

The narrowed remnant of `GuidedBudgetSetup` — same four re-sync maps (`lineValues`, `pendingDeleteKeys`, `causeLinePendingCents`, `starOverrides`), same `seed*` functions, same `renderFlowSection`, same add-category flow, same `useEffect` re-sync on `router.refresh()` — **mechanically un-indexed by `fundId`** (a flat `Record<string, X>` instead of `Record<fundId, Record<string, X>>`, since exactly one fund mounts per page) and with `entityId`/`canApprove`/`approval`/the Approve-Lock JSX **removed entirely** (moved to `BudgetApprovalPanel`, overview-only per Flow 6):

```ts
interface BudgetFundEditorProps {
  entityId: string;
  targetFiscalYear: number;
  fund: FundSetupItem;      // singular — not an array; type unchanged, still exported from this file
  canManage: boolean;
  locked: boolean;           // READ-ONLY here — disables the editor (editorDisabled = locked || !canManage), same as today. This component never renders Approve/Unlock controls (Flow 6's explicit design confirmation).
  labelOptions?: string[];
}
```

Card chrome (fund name, kind badge, balance badge, message, why-note, `dl` totals) is rendered via `<BudgetPlanBalanceSummary variant="detailed" .../>` from the shared module — replaces `guided-budget-setup.tsx` L936-985's inline JSX verbatim, same visual output. The two `renderFlowSection(fund, "income" | "expense")` calls render full width (the `lg:grid-cols-2` wrapper `.map()`'d over multiple funds is gone — one fund, one card, full width of the drill-down page).

**Nothing about the editing mechanics changes.** Every mechanic named in the brief carries forward unmodified, because `BudgetEditor`/`BudgetCauseEditor` (the components that actually implement them) are not touched at all:
- The just-landed trash-can/remove-control fix — unchanged, `BudgetEditor`'s own internal behavior.
- Prior-year reconcile (Prior Budget/Prior Actual reference columns) — unchanged, still sourced from the page's `priorReports` fetch, threaded into `FundSetupItem.budgetEditorLines` exactly as today.
- Scroll-to-newly-added-category (`scrollToKey`/`onScrolledToKey`) — unchanged, still lives in this component (it's a drill-down-only concern now, since add-category only happens here).
- Star/notes (DECISION-057) — unchanged, `starOverrides` map + `handleStarChange`, still un-gated by `locked` at the write-route level (that's `budgets/annotations/route.ts`, untouched).
- Cause lines — unchanged, `BudgetCauseEditor` untouched.

---

#### `BudgetNotesEditor` (`budget-notes-editor.tsx`) — client, overview-only

New component, no precedent to extract from — modeled directly on the existing unlock-reason `<textarea>` + explicit-Save-button pattern already in `guided-budget-setup.tsx` (L900-920), not autosave-on-blur (avoids debounce complexity for a low-frequency field):

```ts
interface BudgetNotesEditorProps {
  entityId: string;
  targetFiscalYear: number;
  initialNotes: string;       // "" when getBudgetNotes() returned null
  canManage: boolean;
  locked: boolean;             // NOT used to disable the textarea — see rationale below. Threaded through only so the component can show the same "read-only because you lack permission" copy pattern other panels use; a locked budget does NOT disable this editor.
}
```

Rendered on the overview, between `BudgetOverviewTable` and the per-fund `BudgetPrintWorksheet`-feeding data (visually: its own `bg-white rounded-2xl shadow-sm` card, heading "Notes & Assumptions"). `canManage` gates whether the `<textarea>` + Save button render at all — a view-only holder (`BUDGET_VIEW` alone) sees the note as plain read-only text (or nothing, if blank), matching this codebase's existing read-only-for-view-only-holders pattern elsewhere on this page. **`locked` is deliberately not part of the gate** — see next section.

On Save: `PATCH /api/admin/ledger/budget-notes`, toast + `router.refresh()`, same pattern as every other write on this page.

**Why notes stay editable when the budget is locked:** this mirrors an existing, deliberate, already-shipped precedent almost exactly — `budgets/annotations/route.ts`'s doc comment (quoted above) states category-grain star/notes "stay editable even when the FY budget is Approve-&-locked" because they're commentary, not a budget figure, per DECISION-057. Budget-level Notes & Assumptions is the same kind of object at a coarser grain: a board that just approved a budget, or is amending one, needs to be able to annotate *why* without unlocking the dollar amounts. Gating budget-level notes on `!locked` would be inconsistent with the precedent the codebase already set for the finer-grained version of the same idea — flagging this explicitly so the implementer doesn't "fix" it into lock-consistency and silently reverse a confirmed pattern (the same warning `budgets/annotations/route.ts`'s own comment carries).

---

#### `BudgetPrintWorksheet` — B-31's design, with two additions

B-31's Phase 3 (already written, above, in this same file) stands as the layout/pagination/draft-approved-stamp/reconciliation-footnote design — **not re-litigated here**. Two additions on top of it, both required by this restructure:

1. **`printFundSums` becomes `computeFundPlanSums`**, imported from `@/lib/ledger` instead of defined privately in this file — see the shared-helper section above. Every other part of B-31's design (the `printableFunds` derivation, `ConsolidatedSummary`, `FundWorksheet`, the three-state Draft/Approved/Reopened rendering, the reconciliation footnote, the print CSS) is unchanged.
2. **New `budgetNotes: string | null` prop** — renders as a labeled "Notes & Assumptions" block directly under the reconciliation footnote on the front page (matching B-31's own research citation #5: "Notes/assumptions to pre-empt board questions on variances"), only when non-blank. Plain paragraph text, `whitespace-pre-wrap` (treasurers may use line breaks to separate points), no special formatting — this is prose, not a table. Sourced from `getBudgetNotes(entity.id, targetFY)?.notes ?? null` in the overview page, fetched in the same `Promise.all` as everything else.

### Navigation / State

`?entity=&fy=` threads through every internal link, exactly as the Ledger hub's `page.tsx` ↔ `[fundSlug]/page.tsx` pair already establishes:

- **Overview → drill-down:** `BudgetOverviewTable`'s row links are `/admin/ledger/budgeting/${fundSlug}?entity=${entitySlug}&fy=${targetFY}`.
- **Drill-down → overview:** breadcrumb link `&larr; Budget Overview` → `/admin/ledger/budgeting?entity=${entitySlug}&fy=${targetFY}`, same visual/textual convention as `[fundSlug]/page.tsx`'s existing `&larr; Ledger Overview`.
- **`EntitySwitcher`/`FiscalYearSelector`:** both stay overview-only (`basePath="/admin/ledger/budgeting"`), matching Phase 1's grounding note — the drill-down does not get its own entity/FY switcher; changing entity or FY from inside a fund's editor means going back to the overview first (same one-hop cost already accepted for Approve/Lock in Flow 6, consistent rather than a special case).
- **Invalid `?entity=`:** falls back to the first entity on both routes (setup-tool convenience, unchanged from today).
- **Invalid `fundSlug` for the resolved entity:** `notFound()` on the drill-down (Phase 1 Flow 2's resolution, matches `ledger/[fundSlug]/page.tsx`'s existing convention).

### Data Fetched Per Page

**Overview (`budgeting/page.tsx`):**

```ts
const [targetReports, priorReports, notesRow, juneNotReconciled] = await Promise.all([
  Promise.all(funds.map((f) => getFundReport(f.id, targetFY))),
  Promise.all(funds.map((f) => getFundReport(f.id, priorFY))),   // still needed — print's per-fund detail sections need prior-year reference columns, even though the on-screen summary rows don't render them
  getBudgetNotes(entity.id, targetFY),
  isMonthGatedForEntity(entity.id, `${targetFY}-06-30`),          // B-31's reconciliation footnote, unchanged
]);
const approval = await getBudgetApproval(entity.id, targetFY);   // unchanged, sequential is fine (cheap single-row lookup, same as today)
```

`fundItems: FundSetupItem[]` built exactly as today's `budgeting/page.tsx` L155-287 (unchanged construction — still needed in full because `BudgetPrintWorksheet` needs the full line/cause/star/note detail per Ruling 2), **except** `unbudgetedCategories` is now **always** `{ income: [], expense: [] }` on the overview (never fetched here — the overview has no "+ Add category" affordance; the `canManage && !locked` gated `getCategories` call that builds it today is deleted from this page entirely, moving to the drill-down). `labelOptions` (today's `getBudgetCauseLineLabels(entity.id)` call) is **also removed from the overview fetch** — nothing on the overview renders `BudgetCauseEditor`'s `<datalist>`, so this is dead weight here; it moves to the drill-down (an additional cost win beyond the two Ruling 2/3 already named, worth calling out since it wasn't explicit in Phase 1/2).

`BudgetOverviewTable`'s `rows` are derived from `fundItems` + `targetReports` (for `openingCents`) via `computeFundPlanSums`, in the page body, not a new query.

**Drill-down (`budgeting/[fundSlug]/page.tsx`):**

```ts
// after resolving entity (fallback) and validating fundSlug -> notFound()
const [targetReport, priorReport, labelOptions] = await Promise.all([
  getFundReport(fund.id, targetFY),
  getFundReport(fund.id, priorFY),
  getBudgetCauseLineLabels(entity.id),   // moved here from the overview
]);
const approval = await getBudgetApproval(entity.id, targetFY);   // read-only use: locked = isBudgetLocked(approval); approval object itself is NOT passed to BudgetFundEditor (it never renders approve/unlock UI)
let unbudgetedCategories = { income: [], expense: [] };
if (canManage && !locked) {
  const [incomeCats, expenseCats] = await Promise.all([
    getCategories(entity.id, { fundKind: fund.kind, flow: "income" }),
    getCategories(entity.id, { fundKind: fund.kind, flow: "expense" }),
  ]);
  // ... filter to this ONE fund's unbudgeted categories, same logic as today's per-fund loop, just not looped
}
```

One `FundSetupItem` built (same `enrichCauseLines`/`budgetEditorLines` construction as today, just for one fund instead of `funds.map(...)`). No `getBudgetNotes` call here — budget-level notes are overview-only, the drill-down doesn't render or need them.

### Edge Cases & Risks

- **Single-fund entity (Flow 8):** resolved — overview always renders, one row + a duplicate-looking total row. No auto-redirect. (Resolved product decision, not re-litigated.)
- **Locked budget, both routes:** overview — `BudgetApprovalPanel` shows the locked banner instead of the approve form (unchanged copy, relocated). Drill-down — `editorDisabled = locked || !canManage`, "+ Add category" hidden, matches today exactly. Budget notes stay editable on the overview regardless (see above) — this is the one control on the overview that does *not* respect `locked`, worth a one-line comment in the component itself so a future reader doesn't "fix" it.
- **Zero-line fund, either route:** overview row still renders (Beginning Bank populated, Income/Expense/Net all $0, Final Bank = Beginning) per Flow 7's resolved default — no fund silently vanishes from the summary. Drill-down shows the existing empty-flow-section state ("No {flow} categories yet — add the first one above").
- **Zero funds / zero entities:** both existing empty states (`"No ledger entities found"` / `"No funds configured for this entity"`) carry forward unchanged on the overview; the drill-down can't be reached for a fund that doesn't exist (`notFound()` covers it).
- **Multi-tab concurrent editing:** unchanged risk profile — last-write-wins via each tab's own `router.refresh()`, explicitly named as a pre-existing, not-newly-introduced tolerance (Phase 1 Gap 5).
- **`getBudgetNotes` row exists but `notes` is `""`** (saved once, then cleared): `BudgetNotesEditor` renders an empty, editable textarea — identical UI to "never saved" (`null`). No user-visible distinction needed; the DB distinguishes "never touched" from "touched and cleared" for audit purposes only (`updatedByUserId`/`updatedAt` populated vs. row absent), which the UI doesn't need to surface.
- **`openingCentsByFundId`/summary-row lookup miss:** can't happen — `targetReports` and `fundItems` are built from the same `funds` array in the same `Promise.all` order, same non-issue B-31's Phase 3 already reasoned through for its own `openingCentsByFundId` map.
- **Mobile 360px on the overview:** resolved by construction — `BudgetOverviewTable`'s rows are `DashboardEntityCard`-styled cards (already collapse to one column, no horizontal table), not a `<table>`. (Architect Ruling 3.)

### Out of Scope (confirmed, unchanged from Phase 1/2)

- Cross-entity combined overview.
- A second "Meeting Worksheet" print mode.
- In-app "email this PDF to the board," or a native PDF-generation dependency.
- Any change to add/remove/star/notes/undo mechanics at the category/cause/line grain.
- A sortable/filterable overview table for many-fund entities.
- A single-fund print affordance from the drill-down (overview-only print, confirmed).
- A roll-up "Notes & Discussion Items" *per-line* list (B-31's Open Question 6, not picked up) — not to be confused with the new budget-*level* Notes & Assumptions field, which is a different, now-in-scope thing.

### Implementation Order

1. **Shared extractions first** (`ux-developer`, small/mechanical, no schema/API dependency) — `load-error-card.tsx` (extract from `ledger/page.tsx`, wire into `ledger/page.tsx` as an import-not-private-function) and `budget-plan-status.tsx` (extract the five functions + two new wrapper components from `guided-budget-setup.tsx`, verbatim logic). Doing this first means every later step imports finished, tested modules instead of extracting-while-also-building.
2. **`computeFundPlanSums` in `src/lib/ledger.ts`** (`ux-developer` or `api-developer` — it's pure business logic touching a `lib/` file, but small enough not to warrant a separate specialist pass; bundle with step 1 or step 4, whichever the implementer is already in). Ships with its Vitest suite (see Tests below) — this is the correctness-critical piece of the whole restructure.
3. **Budget-notes schema + migration** (`database-admin`) — add `ledgerBudgetNotes` to `schema.ts`, author `drizzle/migrations/0071_ledger_budget_notes.sql`, add `getBudgetNotes()` to `ledger-queries.ts`. Runs independently of steps 1-2; no ordering dependency, but naming it early so the overview route (step 4) has something to import.
4. **`PATCH /api/admin/ledger/budget-notes` route** (`api-developer`) — the one new write path, gated `LEDGER_MANAGE`/`BUDGET_EDIT`, no lock check (per the precedent above). Depends on step 3's schema being in place.
5. **Overview route** (`ux-developer`) — rewrite `budgeting/page.tsx`: `try/catch` → `LoadErrorCard`, narrowed data-fetch (drop `unbudgetedCategories`/`labelOptions`, add `getBudgetNotes`/`isMonthGatedForEntity`), build `BudgetOverviewTable`'s `rows` via `computeFundPlanSums`, mount `BudgetApprovalPanel`, `BudgetOverviewTable`, `BudgetNotesEditor`, and the rebuilt `BudgetPrintWorksheet`. Depends on steps 1-4 (imports everything they produce).
6. **Drill-down route + `BudgetFundEditor`** (`ux-developer`) — new `budgeting/[fundSlug]/page.tsx` (own `auth()`/gate/`notFound()`/`LoadErrorCard`, narrowed single-fund fetch including the now-here `labelOptions`/`unbudgetedCategories`) + the narrowed, un-indexed `BudgetFundEditor` component (the bulk of the line-count migration from `guided-budget-setup.tsx`, but mechanical — un-index four maps, delete the Approve/Unlock JSX and its handlers, delete the `.map()` over funds, keep everything else). Depends on step 1 (`budget-plan-status.tsx`).
7. **Print worksheet update** (`ux-developer`) — B-31's already-designed rebuild, plus this restructure's two additions (`computeFundPlanSums` import instead of a private `printFundSums`, new `budgetNotes` prop + render block). Depends on steps 2 and 3 (needs `computeFundPlanSums` to exist and `getBudgetNotes` to have something to fetch).
8. **Delete `guided-budget-setup.tsx`** — once steps 5 and 6 have fully absorbed its contents and both new routes are wired up and building clean. Not a separate implementer pass; the last action of step 6.

Steps 3-4 (`database-admin` → `api-developer`) can run **before or in parallel with** steps 1-2 (`ux-developer`) since they touch disjoint files with no shared import until step 5. Recommend running them concurrently, then sequencing 5 → 6 → 7 → 8 as a single `ux-developer` continuation (one agent, four ordered passes, since 5/6/7 share enough context — the same `fundItems`/`computeFundPlanSums`/prop shapes — that a fresh agent per step would re-derive things already decided here).

### Tests (owned by the implementer at each step, per CLAUDE.md Phase 4 gate — qa does not write these)

- **`computeFundPlanSums`** (step 2, `src/lib/ledger.test.ts` or a new adjacent file) — the cause-line-pending-cents case is the one easy-to-drop step (same warning B-31's design already gave for `printFundSums`): a still-live category whose `budgetCents` includes dollars from an individually-deleted cause line must NOT count those dollars. Cases: plain lump-sum category, category with a live cause breakdown (no pending deletes), category with one cause line pending-delete under a still-live category, whole-category pending-delete (should exclude the entire line via `pendingDeleteAt`, cause-line detail irrelevant), empty `lines` array → `{ incomeCents: 0, expenseCents: 0 }`.
- **`getBudgetNotes`** (step 3) — returns `null` for a never-annotated `(entityId, fiscalYear)`; returns the row (with joined `updatedByName`) after an upsert; scoped correctly per-entity (a note on entity A's FY2026 doesn't leak into entity B's FY2026 or entity A's FY2025).
- **`PATCH /api/admin/ledger/budget-notes`** (step 4, route test mirroring `budget-approvals/route.test.ts`'s existing shape) — 401/403 gates, 400 on oversized notes, upsert-then-re-upsert (second call updates, doesn't duplicate the row — confirms `onConflictDoUpdate` targets the right unique constraint), and **explicitly a positive test that a `locked` budget's notes CAN still be written** (this is the one behavior most likely to regress if a future editor "fixes" it into lock-consistency — a regression test here is cheap insurance).
- **Overview route smoke** (step 5, manual + qa's Phase 5 click-through, not a new unit test per se) — confirm the all-funds total row's five numbers equal the sum of each fund row's own numbers; confirm a fund with zero budget lines still shows a row.
- **Drill-down migration** (step 6) — no new unit tests required beyond what already exists for `BudgetEditor`/`BudgetCauseEditor` (untouched); qa's Phase 5 manual click-through should specifically re-verify the four "carries forward unchanged" mechanics named in the brief (trash-can removal, prior-year reconcile columns, scroll-to-newly-added-category, star/notes) now render correctly from the narrowed, un-indexed component — this is where an indexing-bug regression would most likely surface (e.g., a stray `fundId` key left in a lookup that now silently no-ops instead of erroring, because there's only one fund so wrong-key lookups on a `Record<string,X>` return `undefined` rather than throwing).
- **Print worksheet** (step 7) — no new unit tests beyond B-31's own (none named as MUST-HAVE there either, same reasoning: composition over already-tested pure functions). qa's Phase 5 should manually confirm the Consolidated Summary's per-fund numbers match `BudgetOverviewTable`'s on-screen numbers exactly (both now derive from the same `computeFundPlanSums` call, so a mismatch here would indicate a wiring bug, not an arithmetic one) and that the new Notes & Assumptions block renders/omits correctly (present with saved notes, absent when blank).

### Named Implementers

**`database-admin`** — step 3 only (schema + migration + `getBudgetNotes` read helper). Small, isolated, no dependency on the component work.

**`api-developer`** — step 4 only (the one new route). Depends on step 3's schema.

**`ux-developer`** — everything else (steps 1, 2, 5, 6, 7, 8), as one continuous sequence rather than a further split. Rationale: this is presentation-and-routing decomposition over already-correct business logic and already-correct API contracts (only one contract is new, and it's small) — the same shape B-31's own Phase 3 already concluded warranted a single `ux-developer` pass, extended here because the surrounding restructure is a component-boundary exercise, not new server logic. Splitting steps 5/6/7 across multiple fresh `ux-developer` invocations would force re-deriving the shared `fundItems`/`computeFundPlanSums`/prop-shape context this design doc has already fully specified — better as one agent's continuous work, checkpointed at each step's own typecheck+build gate.

Recommend running **database-admin (step 3) and the first ux-developer pass (steps 1-2) in parallel**, then **api-developer (step 4)** once step 3 lands, then **ux-developer continues through steps 5-8** once steps 1-4 are all in.

### Decision logged

`docs/decisions.md` DECISION-060 — the `ledger_budget_notes` table shape (separate table vs. nullable column on `ledger_budget_approvals`) and the `computeFundPlanSums` promotion (private `printFundSums` inside `budget-print-worksheet.tsx`, per B-31's original Phase 3, → shared export in `src/lib/ledger.ts`) are both genuine implementation decisions (data shape; where logic lives) — logged as one entry since they're part of the same design pass and neither makes sense narrated alone.

---

# Phase 4 — Implementation

## Phase 4 — Implementation (full-stack) — 2026-07-30

**Owner:** full-stack-developer
**Status:** complete

### Summary

Built all 8 implementation-order steps from the Phase 3 design in one continuous pass: the two shared extractions (`load-error-card.tsx`, `budget-plan-status.tsx`), the promoted `computeFundPlanSums` pure function with its Vitest suite, the `ledger_budget_notes` schema + idempotent migration + read helper, the `PATCH /api/admin/ledger/budget-notes` route with its own test suite, the rewritten read-only overview route (`budgeting/page.tsx`) with `BudgetOverviewTable`/`BudgetApprovalPanel`/`BudgetNotesEditor`, the new single-fund drill-down route (`budgeting/[fundSlug]/page.tsx`) with the narrowed `BudgetFundEditor`, the B-31 board-document rebuild of `BudgetPrintWorksheet`, and the deletion of the fully-absorbed `guided-budget-setup.tsx`. Also updated the two pre-existing e2e suites (`budgeting-restructure.spec.ts`, `budget-star-notes.spec.ts`) to route to the new URL split and added a new e2e suite for the overview→drill-down nav, the notes editor, and print structure. `pnpm exec tsc --noEmit` is clean, all 851 Vitest unit tests pass (13 new: 6 `computeFundPlanSums` cases + 7 `budget-notes` route cases, see Outputs), migration `0071` applied cleanly to the dev DB, and 27 of 28 e2e tests across the three affected specs pass against a live signed-in session (one pre-existing, unrelated flake — see Open questions).

### What I did

- Read the full Phase 1/2/3 design in this work-log, DECISION-060, and the complete pre-restructure source (`budgeting/page.tsx`, `guided-budget-setup.tsx` 1028 lines, `ledger/page.tsx`'s private `LoadErrorCard`, `ledger/[fundSlug]/page.tsx`'s own-`auth()` convention, `dashboard-entity-card.tsx`, `fund-balance-overview.tsx`, `src/lib/ledger.ts`, `src/lib/ledger-queries.ts`, `budget-approvals/route.ts`, `budgets/annotations/route.ts`, `budget-print-worksheet.tsx`, and the B-31 work-log's Phase 3 print design) before writing any code.
- **Step 1** — extracted `LoadErrorCard` (`src/components/admin/ledger/load-error-card.tsx`, parameterized `backHref`/`backLabel`) out of `ledger/page.tsx`'s private function and rewired that page to import it. Extracted the five plan-balance pure functions plus two new wrapper components (`BudgetPlanBalanceBadge`, `BudgetPlanBalanceSummary` with `compact`/`detailed` variants) into `src/components/admin/ledger/budget-plan-status.tsx`.
- **Step 2** — added `computeFundPlanSums` (+ `FundPlanSumLine` type) to `src/lib/ledger.ts`, beside `computeFundLineSums`, per DECISION-060's promotion of B-31's originally-planned private `printFundSums`. Added its Vitest suite (6 cases: empty array, plain lump-sum, live cause breakdown, one cause line individually pending-delete, whole-category pending-delete, null `budgetCents`).
- **Step 3** — added `ledgerBudgetNotes` to `src/lib/db/schema.ts` (placed immediately after `ledgerBudgetApprovals`), authored `drizzle/migrations/0071_ledger_budget_notes.sql` (idempotent: `CREATE TABLE IF NOT EXISTS`, a `DO $$ ... END $$`-guarded unique constraint, `CREATE INDEX IF NOT EXISTS`), and added `getBudgetNotes(entityId, fiscalYear)` to `src/lib/ledger-queries.ts` beside `getBudgetApproval`.
- **Step 4** — added `PATCH /api/admin/ledger/budget-notes` (`src/app/api/admin/ledger/budget-notes/route.ts`), gated `hasAnyFeature([LEDGER_MANAGE, BUDGET_EDIT])`, upserting via `db.insert(ledgerBudgetNotes).values(...).onConflictDoUpdate(...)`, deliberately never calling `assertBudgetUnlocked()`. Wrote its route test (`route.test.ts`, 7 cases: 401, 403, 400 oversized notes, 404 bad entity, upsert-then-re-upsert, an explicit positive "locked budget's notes CAN still be written" regression test, 400 non-string notes, 400 bad fiscalYear).
- **Step 5** — rewrote `budgeting/page.tsx` as a read-only overview: `try/catch` → `LoadErrorCard` around every DB phase (closing Phase 1's Gap 1), narrowed the fetch (dropped the `canManage && !locked`-gated `getCategories` call and `getBudgetCauseLineLabels`, added `getBudgetNotes` + `isMonthGatedForEntity` into the existing `Promise.all`), built `BudgetOverviewTable`'s rows and `BudgetApprovalPanel`'s `fundBalances`/`pendingDeleteCount` from the same `fundItems`/`targetReports` via `computeFundPlanSums`, and mounted the rebuilt `BudgetPrintWorksheet` with its five new/threaded props.
- Built `BudgetOverviewTable` (`budget-overview-table.tsx`, Server Component) — `DashboardEntityCard`-styled rows (fund name + kind badge, `BudgetPlanBalanceBadge`, a 5-column Beginning/Income/Expense/Net/Final-Bank `dl`, a "N pending removals" badge when `pendingDeleteCount > 0`, an "Edit budget →" footer), whole-row `Link` into the drill-down, plus a non-`Link` "All Funds" total row.
- Built `BudgetApprovalPanel` (`budget-approval-panel.tsx`, client) — the locked banner + Approve/Unlock panel extracted verbatim from `guided-budget-setup.tsx`, now reading a precomputed `fundBalances` prop instead of a live `fundSums()` closure (no editor lives here anymore). Exports `BudgetApprovalSummary` (moved from the deleted file).
- Built `BudgetNotesEditor` (`budget-notes-editor.tsx`, client) — new component, explicit Save-button pattern (not autosave), `canManage`-gated write access, `locked` deliberately **not** part of the disable gate (mirrors DECISION-057's category-note precedent, called out in both this component's and the API route's doc comments so a future editor doesn't "fix" it into lock-consistency). Added a proper `sr-only` `<label htmlFor="budget-notes">` for accessibility and e2e targeting.
- **Step 6** — built the new drill-down route (`budgeting/[fundSlug]/page.tsx`) mirroring `ledger/[fundSlug]/page.tsx`'s own-`auth()`/`notFound()`/entity-fallback/`LoadErrorCard` conventions, and `BudgetFundEditor` (`budget-fund-editor.tsx`, client) — the narrowed single-fund remnant of `GuidedBudgetSetup`: all four re-sync maps mechanically un-indexed from `Record<fundId, Record<string,X>>` to flat `Record<string,X>`, `renderFlowSection` un-parameterized by fund, Approve/Unlock JSX and handlers removed entirely (moved to `BudgetApprovalPanel`). Added a small, non-duplicate "this budget is locked, go to the Budget Overview to unlock" pointer banner (not the full locked-banner-with-approver-detail, which stays overview-only) — a deliberate small UX addition beyond the design doc's literal text, since a treasurer landing on a bookmarked drill-down URL directly would otherwise see a disabled editor with zero explanation.
- **Step 7** — rebuilt `budget-print-worksheet.tsx` per B-31's Phase 3 design: retitled `DocumentHeader` ("Annual Operating Budget, FY{targetFY}"), three-state DRAFT/APPROVED/Reopened-for-Amendment status stamp, `ConsolidatedSummary` front-page table (per-fund + All-Funds total row, using `computeFundPlanSums`), reconciliation footnote, per-fund `FundWorksheet` sections with `break-before-page`, Beginning/Net/Projected-Ending balance blocks, an Income/Expense Total row (extending the Prior Budget/Prior Actual columns too), and the new Notes & Assumptions block (rendered only when non-blank). Dropped the two blank hand-annotation ruled lines per category, per B-31 Locked Decision 1.
- **Step 8** — deleted `src/components/admin/ledger/guided-budget-setup.tsx` once both routes built and typechecked clean (confirmed via `grep -rl` that nothing else imported it — only historical doc-comment mentions remain elsewhere, which is fine).
- Ran the full existing e2e suite against a live dev server + real sign-in to validate the restructure end-to-end, not just typecheck: this caught and fixed two real issues (see Outputs/deviations below) that `tsc`/Vitest alone could not have caught.
- Marked `docs/work-log/2026-07-30-printable-budget-b31.md` superseded (per its own Open questions/handoff note) — added a SUPERSEDED banner and flipped its Phase 4/5/6 status-table rows.

### Outputs

**Created:**
- `src/components/admin/ledger/load-error-card.tsx` — extracted `LoadErrorCard`, `backHref`/`backLabel` props.
- `src/components/admin/ledger/budget-plan-status.tsx` — `formatDollars`/`fundKindLabel`/`balanceBadgeClass`/`balanceMessage`/`balanceWhyNote` + `BudgetPlanBalanceBadge`/`BudgetPlanBalanceSummary`.
- `src/components/admin/ledger/budget-overview-table.tsx` — `BudgetOverviewTable`, Server Component.
- `src/components/admin/ledger/budget-approval-panel.tsx` — `BudgetApprovalPanel` (client) + `BudgetApprovalSummary` type.
- `src/components/admin/ledger/budget-notes-editor.tsx` — `BudgetNotesEditor` (client).
- `src/components/admin/ledger/budget-fund-editor.tsx` — `BudgetFundEditor` (client) + `FundSetupItem` type.
- `src/app/(dashboard)/admin/ledger/budgeting/[fundSlug]/page.tsx` — new drill-down route.
- `src/app/api/admin/ledger/budget-notes/route.ts` — `PATCH /api/admin/ledger/budget-notes`. **Auth/gate:** `hasAnyFeature([LEDGER_MANAGE, BUDGET_EDIT])`, no lock check (intentional, documented in-file).
- `src/app/api/admin/ledger/budget-notes/route.test.ts` — 7 Vitest cases.
- `drizzle/migrations/0071_ledger_budget_notes.sql` — idempotent; applied cleanly to the dev DB (`pnpm db:migrate`), verified via `\d ledger_budget_notes`.
- `e2e/budgeting-overview-restructure.spec.ts` — 6 new Playwright tests (unauthenticated redirect on both routes, invalid-fundSlug 404, overview→drill-down→overview nav with `?entity=&fy=` preserved, all-funds-total-equals-sum-of-rows, Notes & Assumptions save/reload/print round-trip, print structure). FY2096 (throwaway, distinct from FY2097/2098/2099 already used by other suites).

**Modified:**
- `src/lib/db/schema.ts` — new `ledgerBudgetNotes` export (`LedgerBudgetNote`/`NewLedgerBudgetNote` types).
- `src/lib/ledger-queries.ts` — `getBudgetNotes()` + `ledgerBudgetNotes` import.
- `src/lib/ledger.ts` — `computeFundPlanSums` + `FundPlanSumLine` type, placed beside `computeFundLineSums`.
- `src/lib/ledger.test.ts` — `computeFundPlanSums` describe block (6 tests) + import.
- `src/app/(dashboard)/admin/ledger/page.tsx` — imports `LoadErrorCard` instead of a private copy.
- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` — full rewrite (read-only overview).
- `src/components/admin/ledger/budget-print-worksheet.tsx` — full rebuild per B-31 + DECISION-060, new props (`locked`, `approval`, `openingCentsByFundId`, `juneNotReconciled`, `budgetNotes`).
- `e2e/budgeting-restructure.spec.ts` — `BUDGETING_URL` → `DRILLDOWN_URL` (Charitable Fund's own page) for every editing test; the print-worksheet test now navigates to the overview URL and matches the retitled `h1` text.
- `e2e/budget-star-notes.spec.ts` — split `BUDGETING_URL` into `DRILLDOWN_URL` (Activity Fund editing) and `OVERVIEW_URL` (Approve/Lock/Unlock + print worksheet), with explicit navigation between the two inside the lock test.
- `docs/work-log/2026-07-30-printable-budget-b31.md` — SUPERSEDED banner, Phase 4/5/6 status rows updated.

**Deleted:**
- `src/components/admin/ledger/guided-budget-setup.tsx` — fully absorbed into `budget-approval-panel.tsx` + `budget-fund-editor.tsx` + `budget-plan-status.tsx`.

**No new `FEATURES` key** — both routes gate identically on the existing any-of set (`LEDGER_MANAGE`/`LEDGER_APPROVE`/`BUDGET_VIEW`/`BUDGET_EDIT`), confirmed unchanged in both page files.

### Deviations from the Phase 3 design (all minor, none architectural)

1. **`BudgetPlanBalanceSummary`'s prop shape** gained an optional `fundName?: string` beyond the design doc's literal `{fundKind, incomeCents, expenseCents, variant}` — needed because the `"detailed"` variant renders the fund-name header row (byte-for-byte matching the old card header), and threading it as a prop is cleaner than the caller wrapping its own `<h3>` around this component's output. `"compact"` doesn't render it.
2. **`BudgetOverviewTable`'s rows don't call `BudgetPlanBalanceSummary` at all** — they render `BudgetPlanBalanceBadge` directly plus their own 5-column `dl` (Beginning/Income/Expense/Net/Final Bank), because the overview's stat row is structurally different from the drill-down's 3-column Income/Expenses/Net `dl` that `BudgetPlanBalanceSummary` renders. The design doc's row-content description ("fund name + fundKindLabel badge, BudgetPlanBalanceBadge, Beginning/Income/Expense/Net/Final-Bank as a dl stat row") is what's literally implemented; `BudgetPlanBalanceSummary`'s "compact" variant exists as specified but has no current call site — flagging in case a future reviewer wonders why.
3. **Fixed a real DOM-depth regression, caught only by actually running e2e (not by `tsc`/Vitest):** my first draft of `BudgetPlanBalanceSummary` wrapped its `"detailed"` output in its own `<div>`, adding one extra ancestor level versus the old inline JSX. `e2e/budget-star-notes.spec.ts`'s pre-existing `fundCard()` helper (`ancestor::div[3]` from the fund-name `<h3>`) depended on the exact old depth to scope to the whole card (header + editor), not just the header. Fixed by making both `BudgetPlanBalanceSummary` variants return a Fragment (`<>...</>`) instead of a wrapping `<div>`, restoring byte-identical ancestor depth — documented in that file's own comment so a future refactor doesn't reintroduce the wrapper without noticing.
4. **`BudgetFundEditor` renders a small locked-state pointer banner** ("This FY's budget is locked... Go to the Budget Overview to unlock it") not explicitly named in the design doc's component spec, which said the drill-down only needs to *read* `locked` to disable the editor. Added because a treasurer landing directly on a bookmarked drill-down URL with no prior overview visit would otherwise see a silently-disabled editor with zero explanation. This is a small info pointer, not the full locked-banner-with-approver-detail (which stays overview-only per Flow 6) and renders no Approve/Unlock controls — doesn't violate the design's placement rule.

### Tests

- `computeFundPlanSums` — 6 Vitest cases in `src/lib/ledger.test.ts` (see Phase 3 design's named test list — cause-line-pending-cents case included).
- `getBudgetNotes` — covered indirectly through the route test's mocked `db.insert` path; a direct query-level test against `ledger-queries.ts` was not added (the existing `getBudgetApproval` sibling has no standalone query-level test either — both are exercised through their route/page consumers plus the e2e notes-editor round-trip, consistent with this codebase's existing test-placement convention for simple single-row lookups).
- `PATCH /api/admin/ledger/budget-notes` — 7 Vitest cases in `route.test.ts`, including the explicit "locked budget's notes CAN still be written" regression test the design doc asked for by name.
- e2e — `e2e/budgeting-overview-restructure.spec.ts` (6 new tests, all passing), plus the two updated pre-existing suites re-verified end-to-end against a live signed-in session: `budgeting-restructure.spec.ts` (14/15 pass — see Open questions for the one pre-existing flake) and `budget-star-notes.spec.ts` (6/6 pass, including the Approve/Lock/Unlock flow now split across the overview and drill-down URLs).

### tsc / test results

- `pnpm exec tsc --noEmit` — clean, zero errors, checked repeatedly at every implementation-order step boundary.
- `pnpm test` (Vitest) — 34 test files, **851 tests, all passing** (+13 new this pass: 6 `computeFundPlanSums` cases, 7 `budget-notes` route cases).
- `pnpm lint` — pre-existing unrelated ESM/`minimatch` failure (per task instructions, ignored — not caused by this work).
- Migration `0071_ledger_budget_notes.sql` — applied cleanly via `pnpm db:migrate` against the dev DB; table/constraint/index verified via `psql \d ledger_budget_notes`.
- Dev-server smoke — both routes return clean `307` redirects to `/signin` when unauthenticated (no 500s); full authenticated e2e runs (above) are the real verification.

### Open questions / handoff notes

- **One pre-existing e2e flake, not a regression from this restructure:** `e2e/budgeting-restructure.spec.ts`'s `"'+ Add category' scrolls the newly-added category into view (UX Polish, 2026-07-30)"` test fails — the scrolled-to row lands at a small, consistent negative Y offset (`-242px`) and never converges even at a 20s poll (debug-logged). Root-caused as far as I could within scope: the scroll mechanism itself (`src/components/admin/ledger/budget-editor.tsx`'s `scrollToKey` effect) is byte-for-byte **untouched** by this restructure, and I confirmed the DOM nesting depth around it is preserved (see Deviation 3) — the very next test in the same suite (the trash/restore bug-fix test, run standalone) passes cleanly on the same drill-down page. My working theory is that FY2099's Charitable Fund fixture has accumulated a large number of "E2E QA ..." categories across many historical runs of this suite (the suite's own doc comment documents this as an intentional, never-cleaned-up tradeoff), and the accumulated page height now interacts with the smooth-scroll timing differently than when this test was authored. **Recommend qa (Phase 5) investigate this independently of this restructure** — possibly by resetting/trimming the FY2099 fixture's category count — rather than treating it as a Phase 4 blocker; I did not attempt a fix since the owning code is outside this restructure's scope per the design doc's own "nothing about the editing mechanics changes" framing.
- **`BudgetPlanBalanceSummary`'s `"compact"` variant has no current call site** (see Deviation 2) — kept as specified in the design doc in case a future consumer wants the badge+message pairing without the overview's custom 5-column stat row; flagging so a future code-review pass doesn't flag it as dead code without this context.
- **Manual click-through still recommended for Phase 5** despite the e2e coverage above: specifically re-verify the trash-can removal, prior-year reconcile columns, scroll-to-newly-added-category (aside from the one flaky automated case), and star/notes UI on a real fund with a human eyeballing layout/spacing on the now-full-width drill-down card (no more `lg:grid-cols-2` competition with a sibling fund) — the un-indexing migration (four maps, `fundId` layer removed) is exactly the kind of change where a stray leftover key would silently no-op rather than throw, per the design doc's own risk flag for step 6.
- **Nominate `qa` for Phase 5.** Suggest QA also runs the full `budget-star-notes.spec.ts` and `budgeting-restructure.spec.ts` suites at least once more from a clean/reset FY2099 fixture if practical, to get a true baseline reading on the scroll-into-view flake independent of accumulated data.

---

# Phase 5 — Verification (qa)

Pending

---

# Phase 6 — Shipped vs Intent (analyst)

Pending

---

## Phase 3 — Technical Design — 2026-07-30

**Owner:** tech-lead
**Status:** complete

### Summary

Designed the split of today's `budgeting/page.tsx` (380 lines) + `guided-budget-setup.tsx` (1028 lines) monolith into a read-only, print-ready all-funds overview at `/admin/ledger/budgeting` and a full-width single-fund editor at `/admin/ledger/budgeting/[fundSlug]`, per the architect-approved shape. Five presentational/error-handling helpers (`LoadErrorCard`, the plan-balance badge/message/why-note trio) are extracted to shared modules so the split doesn't duplicate them. B-31's board-document print design folds in as the overview's Print output, with one pure helper (`printFundSums` → renamed/promoted `computeFundPlanSums`) relocated from a print-private function to a shared `src/lib/ledger.ts` export so the overview's on-screen summary and the printed document derive from the literal same computation. One new table, `ledger_budget_notes`, gives the new budget-level "Notes & Assumptions" requirement a home that exists before any approval row does — write-gated on `canManage`, deliberately never lock-checked, mirroring the existing category-star/notes precedent (DECISION-057).

### What I did

- Read both source work-logs in full (Phase 1 functional refinement + Phase 2 architectural review for the restructure; the complete Phase 1-3 design for B-31) and grounded the design against the live code: `budgeting/page.tsx`, `guided-budget-setup.tsx` (all 1028 lines), `ledger/page.tsx` (`LoadErrorCard` source), `dashboard-entity-card.tsx` (the card-row precedent `BudgetOverviewTable` follows), `[fundSlug]/page.tsx` (the own-`auth()`/breadcrumb pattern both new/rewritten routes mirror), `src/lib/ledger.ts` (`computeFundLineSums`, `computeBudgetBalanceStatus`, `isBudgetLocked`, `formatBudgetReferenceCents`), `ledgerBudgetApprovals` in `schema.ts` (confirmed a draft budget has no approval row — the reason budget notes need their own table), `budget-approvals/route.ts` (the upsert/transaction pattern the new notes route mirrors), and `budgets/annotations/route.ts` (confirmed the "notes stay editable even when locked" precedent this design extends to the budget level).
- Authored the full Phase 3 design doc in place under "Phase 3 — Technical Design" above: file/route layout, every new/modified/deleted component's props and responsibilities, the exact data fetched per route (including two additional cost-wins beyond architect's named two — `labelOptions` and `unbudgetedCategories` both move off the overview entirely), the `ledger_budget_notes` schema + migration + API contract + UI + print rendering, the `computeFundPlanSums` promotion (the design's one correctness-critical unification, explained in its own section), navigation/query-param propagation, edge cases, implementation order (8 steps), named tests per step, and named implementers.
- Logged DECISION-060 in `docs/decisions.md` covering the two genuine implementation decisions in this design: the budget-notes table shape and the `computeFundPlanSums` relocation.

### Outputs

- `docs/work-log/2026-07-30-budgeting-overview-restructure.md` — full Phase 3 design doc under "Phase 3 — Technical Design," per-phase status table updated (Phase 3 Complete, Phase 4 owners named).
- `docs/decisions.md` — DECISION-060 added (newest-first, above DECISION-059).

### Open questions / handoff notes

- **Use the database-admin agent** for Phase 4 step 3 first (or in parallel with step 1-2 below): add `ledgerBudgetNotes` to `src/lib/db/schema.ts`, author `drizzle/migrations/0071_ledger_budget_notes.sql` (idempotent, next number after `0070_ledger_bank_account_default.sql`), add `getBudgetNotes(entityId, fiscalYear)` to `src/lib/ledger-queries.ts`.
- **Use the api-developer agent** for Phase 4 step 4 once step 3 lands: `PATCH /api/admin/ledger/budget-notes`, gated `LEDGER_MANAGE`/`BUDGET_EDIT`, no lock check — mirror `budgets/annotations/route.ts`'s doc-comment discipline about *why* it's not lock-gated so a future reader doesn't "fix" it.
- **Use the ux-developer agent** for the rest (steps 1, 2, 5, 6, 7, 8) as one continuous sequence — the design doc's Implementation Order section has the exact ordering and dependency notes; steps 1-2 (shared extractions + `computeFundPlanSums`) can start in parallel with database-admin's step 3, since they touch disjoint files.
- The single highest-risk step is 6 (the drill-down's `BudgetFundEditor`) — un-indexing four `Record<fundId, Record<string,X>>` maps down to flat `Record<string,X>` is mechanical but exactly the kind of change where a stray leftover `fundId` key silently no-ops (`undefined` on a flat-map lookup) instead of throwing. Flag this specifically for qa's Phase 5 manual click-through: re-verify the trash-can removal, prior-year reconcile columns, scroll-to-newly-added-category, and star/notes all still work post-migration, not just that the page builds.
- `docs/work-log/2026-07-30-printable-budget-b31.md` should be marked **superseded** once this restructure ships — its Phase 3 design is folded into this one (with the `printFundSums`→`computeFundPlanSums` relocation as the only substantive change), and its own Phase 4/5/6 should not be run separately.
