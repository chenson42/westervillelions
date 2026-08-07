# Ledger & Budget Search — Work Log

> **Slug:** `2026-08-06-ledger-search`
> **Surface:** (dashboard) admin — new `/admin/ledger/search`
> **Permission(s):** No new key. Existing gates reused per result type — `ledger.view` for transactions, `budget.view` for budget lines (treasurer decision, 2026-08-06)
> **Estimated complexity:** medium–large
> **Pipeline mode:** Full — new route, new query surface, cross-cutting reads

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-06 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-06 |
| 3 — Technical design | tech-lead | Complete | Design complete | 2026-08-06 |
| 4 — Implementation | api-developer → ux-developer | Complete | — | 2026-08-06 |
| 5 — Verification | qa | Complete | PASS | 2026-08-06 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-06 |
| 4 (loop-back) — lump sums + free-text symmetry | full-stack-developer | Complete | — | 2026-08-07 |
| 5 (re-verify) — budget-results flow | qa (stalled) → coordinator | Complete | PASS | 2026-08-07 |
| 6 (re-review) — shipped vs intent, loop-back | analyst | Complete | SHIP IT | 2026-08-07 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> A treasurer wants to type into one box and find every transaction and budget line touching a category, cause, or FY without knowing which of the six ledger pages to open first — but "search," "accounts," and "click into details" all need to be pinned down before this is buildable, and the entry point (quick search on the existing dashboard vs. standalone advanced page) is now explicitly in scope.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`ledger.view` holder — treasurer, board_member, admin, budget_committee) | Type a search term into a quick-search box on the ledger overview (`/admin/ledger`, no `?entity=`) | On demand, several times a session |
| Admin (`ledger.view` holder) | Land on `/admin/ledger/search?q=…` with the query carried in the URL, see results grouped into a Transactions section and a Budget lines section, each with a count | On demand |
| Admin (`ledger.view` holder) | Narrow with advanced filters: fiscal year, category, cause, entity/fund/bank account, amount, date | On demand, after an initial broad search |
| Admin (`ledger.view` holder) | Click a transaction result → land on the existing register/detail surface for that transaction | On demand |
| Admin (`budget.view` holder) | Click a budget-line result → land on the existing budgeting drill-down for that line | On demand |
| Admin (`budget.view`-only, no `ledger.view`) | N/A today — see Permissions section; this case can't currently exist given the `budget_committee` role binding, but is worth naming explicitly since the treasurer's decision #2 raised it | — |

Every verb above belongs to the **Admin** surface exclusively — this is an `/admin/ledger/*` feature, not member-portal or public. Good: the request never blurs that line.

## Flows

**Flow 0 — Entry point (new, per treasurer's follow-up):**
`/admin/ledger` (bare, no `?entity=`) already renders `LedgerDashboard` — a real two-entity treasurer landing page (entity balances, guardrail flags, uncashed checks, unremitted deposits, sync-stale/unreconciled totals — see `getDashboard()` in `src/lib/ledger-queries.ts`). This is the "treasurer dashboard" the treasurer is picturing; **it already exists**, so this feature does not need to invent one. Recommendation: put a quick-search box on this existing dashboard (`LedgerDashboard` component) as the primary entry point, in addition to (not instead of) a standalone `/admin/ledger/search` for the advanced/filtered view. Submitting the quick-search box navigates to `/admin/ledger/search?q=<term>`, so the query is in the URL from the first keystroke onward — linkable/shareable/bookmarkable, and back-button-safe. `/admin/ledger/budgeting` is a second, narrower "dashboard" (fund-by-fund budget overview) but it is scoped to budgeting only and gates on a different feature set (`LEDGER_MANAGE`/`LEDGER_APPROVE`/`BUDGET_VIEW`/`BUDGET_EDIT`) — it is not a good second home for a cross-cutting search box; one entry point (the main `/admin/ledger` dashboard) avoids duplicating the box in two places that could drift.
- Failure: if `getDashboard()` throws, today's page renders `<LoadErrorCard backHref="/admin/ledger" />` — the search box should degrade the same way (not appear, or appear disabled) rather than crash the whole dashboard.

**Flow 1 — Quick search from the dashboard:** entry `/admin/ledger` → treasurer types a term into the search box (e.g. "WARM") and hits Enter/clicks Search → navigates to `/admin/ledger/search?q=WARM` → outcome: grouped results page, Transactions section and Budget lines section, each with its own count, unfiltered by FY/entity by default (open question below on default FY).
- Failure: no matches in either group → empty state naming the term searched ("No transactions or budget lines match 'WARM'") with a suggestion to broaden (clear filters / try a different field), not a bare "No results."

**Flow 2 — Advanced/filtered search:** entry `/admin/ledger/search` (directly, or arriving from Flow 1) → treasurer sets one or more filters (FY, category, cause, entity/fund/bank account, amount, date range) → results re-query and re-render, filters reflected in the URL query string → outcome: filtered, grouped results.
- Failure: a filter combination that's structurally invalid (e.g. a bank-account filter with no matching account in the selected entity) → results section shows 0 with a message explaining why ("No bank account matches that filter in Westerville Lions Foundation"), not a silent empty state that looks identical to "no data."

**Flow 3 — Click into a transaction result:** entry: a Transactions-section result row → click → outcome: TBD, see gap below — today's register (`/admin/ledger?entity=<slug>&fy=<fy>`) has no mechanism to deep-link to *one* transaction row or auto-open its edit dialog (`transaction-form-dialog.tsx`); clicking currently could only land on the right entity+FY register page, not a highlighted row, unless Phase 3 builds a `?txn=<id>` deep-link.
- Failure: the transaction was deleted between search and click (hard-delete exists pre-approval) → destination should say "This transaction no longer exists" rather than 404 or a blank register.

**Flow 4 — Click into a budget-line result:** entry: a Budget lines-section result row → click → outcome: TBD, same gap — `/admin/ledger/budgeting/[fundSlug]?fy=<fy>` has no existing highlight/anchor mechanism for a single cause line (`causeLineReferenceKey` exists as a lookup key in the page's data-building code, not as a URL anchor).
- Failure: the budget line has `pendingDeleteAt` set (soft-deleted, awaiting Approve & lock) → destination should show it struck through/pending-delete, matching the budgeting page's existing treatment, not error out.

## Permissions

- **Permission(s):** No new key, confirmed correct. `ledger.view` gates Transactions-section results, `budget.view` gates Budget-lines-section results — reusing `FEATURES.LEDGER_VIEW` / `FEATURES.BUDGET_VIEW` from `src/lib/permissions.ts`.
- **Default roles / verified against `drizzle/migrations/0069_ledger_budget_permissions.sql`:** every role that holds `budget.view` also holds `ledger.view` by construction — `admin`, `treasurer`, and `board_member` already had `ledger.view`; the new `budget_committee` role was explicitly seeded with `budget.view, budget.edit, ledger.view` together (migration comment: "NEW role... ledger.view"). So the scenario "sees a budget result but can't open the transactions half of the query, or can't even reach the search entry point" cannot occur through the modeled roles — the entry point (`/admin/ledger` dashboard) gates on `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])`, and every `budget.view` holder passes that.
- **Residual risk:** an admin could hand-grant `budget.view` to a custom role *without* `ledger.view` outside this bundling convention. If that ever happens, that user would 403/redirect at the `/admin/ledger` dashboard entry point and never see the search box at all — not a "sees a result she can't open" bug (which decision #2 worried about) but the inverse: "can't reach search despite being entitled to half its results." Worth a one-line note in Phase 3 (search page's own gate should be `hasAnyFeature([LEDGER_VIEW, BUDGET_VIEW])`, independent of the dashboard's gate, so a hypothetical budget-only-no-ledger-view user could still reach `/admin/ledger/search` directly and see only the Budget lines section) — cheap to build correctly now, awkward to retrofit later.
- Result-level filtering must still be enforced per-row, not just per-section: if a `hasAnyFeature` gate admits the page, the query layer must still only run the Transactions query when `ledger.view` is present and the Budget lines query when `budget.view` is present — never fetch-then-hide.

## Gaps the Request Didn't Address

- **"Search across all the relevant fields" is not one operation.** `party`, `memo`, `beneficiaryCause`, `checkNumber` (transactions) and `note`, `label`, `cause` (budget) are free-text-matchable. `amountCents` is not sensibly free-text-matched — a user typing "50" probably doesn't mean "match the literal string 50 in a cents integer that could be 5000." `txnDate` likewise wants a range picker, not substring match. Recommendation: one query box does an ILIKE/full-text pass across the free-text fields, PLUS the advanced panel adds explicit amount (exact-or-range) and date-range controls that AND with the free-text term. This needs to be said explicitly in the design doc, not left to the implementer's judgment field-by-field.
- **"Filter to just one account" is ambiguous across three real levels.** The schema has `ledgerEntities` (Club vs. Foundation), `ledgerFunds` (administrative/activity/charitable), and `ledgerBankAccounts` (actual bank accounts, nullable on transactions, no equivalent on budget rows at all — budgets don't have a bank account). The treasurer said "accounts" but almost certainly meant "which fund/entity," since that's the level every other ledger page (register, budgeting) filters at today (`?entity=`, `?fy=`). Recommendation: offer entity and fund as first-class filters (parity with existing pages); offer bank account as an additional transaction-only filter, and make explicit in the UI that it does not apply to budget-line results (budgets have no bank account) rather than silently having no effect.
- **"Very organized" needs a definition.** Undefined today: sort order within each group (suggest txn date desc for transactions, category/cause alphabetical for budget lines — matches existing page conventions), whether each group shows a running subtotal (useful for "what have we spent on WARM" — the treasurer's own framing example), pagination vs. a capped result set (the register and budgeting pages don't paginate today; a raw ILIKE across `party`/`memo` with no cap could return hundreds of rows for a common term like "check"), and what a true empty state (brand-new install, or a term matching nothing) says. This needs sizing input from tech-lead but the *dimensions* need to be named now so they aren't improvised in Phase 4.
- **FY-filter asymmetry is real and needs a stated default.** Transactions have no `fiscalYear` column — FY is derived from `txnDate` at query time (DECISION-015); budget rows have a real `fiscalYear` column. A search with an FY filter set is straightforward for both (derive vs. column-match), but a search with NO FY filter set behaves very differently per type: transactions with no FY filter means "search the entire multi-year history," budget rows with no FY filter means "search across every FY's budget, including ones the treasurer wasn't thinking about." Recommend defaulting the FY filter to the current FY for both groups (matches `currentFiscalYear()` default already used on `/admin/ledger` and `/admin/ledger/budgeting`), with an explicit "All years" option — not defaulting to "all years" silently, which would make a common query like "find the WARM budget line" return every year's WARM line stacked together with no visual FY separator.
- **No deep-link/highlight mechanism exists today for a single transaction or budget line.** Confirmed by reading `ledger-entity-detail.tsx` and the `budgeting/[fundSlug]/page.tsx` — neither page currently accepts a param that opens/highlights one specific row; the register's transaction editor (`transaction-form-dialog.tsx`) opens via in-page row click, not a URL. "Click into the details" (treasurer's own phrase) implies landing *on* the row, not just on the right entity+FY page and making the treasurer scroll/scan to find it again. This is new surface area, not reuse — Phase 3 needs to decide whether search ships with a real deep-link (`?entity=&fy=&highlight=<id>` that scrolls-to and highlights the row / auto-opens the edit dialog) in the first increment, or whether increment 1 accepts the coarser "lands on the filtered register/budgeting page, treasurer finds the row" and a follow-up increment adds the precise highlight. Given "click into the details" is explicitly called out in the request, I'd treat the coarse version as a real regression from what was asked for, not a neutral simplification.
- **Reconciliation/posted status and pending-delete budget rows are unaddressed by the request.** Should a `status='pending'` or `status='rejected'` transaction appear in results at all, and if so, does it need a visible status badge in the grouped list so the treasurer doesn't mistake a pending reimbursement for a posted expense? Should a budget line with `pendingDeleteAt` set (marked for removal, awaiting Approve & lock) appear, and if so, styled struck-through the way the budgeting page already treats it, or excluded entirely? Recommendation: include both, badge/style them consistently with their source pages' existing conventions (never invent new status styling for search) — excluding them would make search lie about what's in the books, which is the opposite of what a treasurer wants from a search tool.
- **Empty state on a brand-new install / zero matches.** Needs the standard `bg-gray-50 rounded-2xl p-10 text-center text-gray-500` treatment per CLAUDE.md, with copy naming the actual search term, not a bare "No results" — and should distinguish "no ledger data exists yet at all" (not realistic for this club's live books, but matters for local dev/test) from "your search term matched nothing."
- **Mobile (360px).** Not mentioned. A grouped, filterable, multi-column results table (transactions have ~8 relevant columns: date, amount, party, category, fund, cause, status, check#) will not fit at 360px without a card-based mobile layout, same pattern the register presumably already solves — Phase 3 should confirm the register's existing mobile treatment and reuse it rather than inventing a new one for search specifically.
- **Brand consistency spot-check:** results list/cards should be `rounded-2xl` (informational, non-interactive-card style per CLAUDE.md, since the *row* is the click target, not the whole card); filter controls and the search-submit button `rounded-lg`, never `rounded-full`; no destructive actions live on this page so `<ConfirmDialog>` isn't triggered by search itself, but if a result row surfaces a delete/reject action inline (not yet decided — probably shouldn't, search should be read/navigate-only) that would need to go through `<ConfirmDialog>`, not `window.confirm`. Recommend search stays read-only/navigate-only in increment 1 to avoid this question entirely.

## Out of Scope (confirm with user)

- **A full treasurer-dashboard redesign** (balances, recent activity, unreconciled items, open reimbursements all in one place) is a *larger* want than what's needed here, and it's mostly already built: `/admin/ledger`'s bare dashboard already surfaces entity balances, guardrail flags, uncashed checks, unremitted deposits, and sync-stale/unreconciled totals via `getDashboard()`. The only new thing this feature needs to add to that page is the search box itself. I'm treating "add a search box to the existing dashboard" as in-scope for this work-log, and "redesign/expand the dashboard's other panels" as explicitly out of scope — flag if the treasurer meant something more ambitious than a search box on the page that already exists.
- **Real deep-linking (highlight/auto-open a specific row)** may be out of scope for increment 1 given it's genuinely new surface area on two existing pages that don't support it today — see gap above. Confirm with the treasurer whether "click into the details" landing on the filtered register/budgeting page (current entity+FY, treasurer finds the row manually) is acceptable for a first increment, with precise row-highlighting as a fast-follow.
- **Full-text/fuzzy search (typo tolerance, ranked relevance)** — the request says "search," which could mean anything from `ILIKE '%term%'` to a ranked Postgres `tsvector` search. Recommend `ILIKE`-based substring match for increment 1 (matches the simplicity of every other ledger query in this codebase) and treat ranked/fuzzy search as an explicit non-goal unless the treasurer says otherwise.
- **Saved searches / search history** — not mentioned by the treasurer, not assumed in scope.

## Treasurer Decisions (2026-08-06)

Answers to the Phase 1 open questions, given by the treasurer before Phase 2:

1. **Entry point** — quick search box on the existing `/admin/ledger` dashboard, submitting to
   `/admin/ledger/search?q=…`; the full advanced filter panel lives on the results page, with the
   search box persisted there for re-querying. NOT the full filter panel on the dashboard — the
   homepage stays clean. Query lives in the URL so a search is linkable and shareable.
2. **FY filter default** — current fiscal year, with a one-click "All years" escape. Matches the
   register and budgeting pages.
3. **Increment** — transactions AND budget lines ship together. The headline use case ("what do we
   have on WARM, budgeted and spent") only works when both halves exist, so a transactions-first
   ship would not deliver the request.
4. **Result volume** — paginate at 50 per group with "showing 50 of 214", but compute dollar
   subtotals across EVERY match, not just the visible page. The treasurer's use case is a subtotal
   question, so the totals must not change as you page.

Defaults taken by the coordinator on the remaining Phase 1 questions (treasurer may still override):

5. **Amount** — min/max range; a single value entered means exact match. **Date** — range, no default
   bounds beyond whatever the FY filter implies.
6. **"Accounts"** — entity and fund are the primary filters (parity with existing pages); bank
   account is offered as an additional transaction-only filter, since budgets have no bank account.
7. **Deep-link targets** — no per-row deep link exists today on either the register or the budgeting
   drill-down. Phase 3 must decide whether to add anchor/highlight deep-linking to those existing
   surfaces or introduce a detail view. This is new surface area, not reuse.

## Open Questions

- Confirm the entry-point design: search box on the existing `/admin/ledger` dashboard (recommended) that submits to `/admin/ledger/search?q=…`, plus the same box persisted on the search results page itself for re-querying — does that match what the treasurer pictured, or did they want the *entire* advanced filter panel visible on the dashboard itself (which would be a much busier homepage)?
- Amount: exact-cents match, or a min/max range? Date: single date, or a range with defaults?
- "Filter to just one account" — confirmed as entity/fund (parity with existing pages) plus an additional transaction-only bank-account filter — does that match intent, or did the treasurer specifically want bank-account-level filtering to be the primary axis?
- FY-filter default: current FY (recommended) vs. all years — confirm.
- Is a capped/paginated result set (e.g. "showing first 50 of 214, refine your search") acceptable, or does the treasurer expect every match visible on one page regardless of count?
- Increment boundary: is "transactions only, budget lines in a fast-follow" an acceptable first ship (the treasurer's own words: "while building we should build a search for budget as well" suggests they want both, but doesn't say both must ship simultaneously) — or must both ship together?
- Should search results show running subtotals per group (e.g., total $ across matched transactions), given the treasurer's own example use case ("what do we have on WARM, budgeted and spent") is fundamentally a subtotal question, not just a list question?

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** The shape the analyst sketched is structurally sound; three non-blocking items for Phase 3 are called out below (lump-sum budget note in/out of scope, `fyBounds` relocation, highlight-vs-auto-open behavior). Decision logged as **[DECISION-062](../decisions.md)**.

## Placement

### 1. Where the code lives

- **Route:** `src/app/(dashboard)/admin/ledger/search/page.tsx` — new directory, sibling to the other `/admin/ledger/*` subpages (`budgeting/`, `reconciliation/`, `reimbursements/`, etc.). Confirmed no existing `search/` directory under `admin/ledger/`.
- **Query functions: a new sibling module, `src/lib/ledger-search-queries.ts`.** `ledger-queries.ts` is 5,161 lines / ~199KB — already the largest file in `src/lib` and past the point where adding another cross-cutting read surface to it is defensible. This exact situation has a precedent, twice: `reconciliation-queries.ts` and `financial-report-queries.ts` were both split out of `ledger-queries.ts` under the same reasoning (financial-report-queries.ts's own header cites it explicitly: "mirrors the precedent already set by reconciliation-queries.ts being split... a distinct feature surface built on top of the existing ledger_transactions table, not a rework of it" — see DECISION-049). Search is the same shape: a new read surface composing existing tables, touching nothing about how transactions or budgets are written. Don't break that precedent now.
  - Note for Phase 3/4: `listTransactions()` in `ledger-queries.ts` (line ~462) already has a `search` opt, but it's `ilike` on `party`/`memo` only and scoped to a single `entityId` — not reusable as-is for a cross-entity, all-field search. The new module writes its own queries; it does not extend or wrap `listTransactions()`.
  - The private `fyBounds(fy)` helper (line ~102 of `ledger-queries.ts`, used by every other FY-filtered query in that file) is currently unexported. The new module needs the identical FY→date-range math for transactions. Export it, or — better — relocate it to `src/lib/fiscal-year.ts` next to `getFiscalYear`/`currentFiscalYear`/`fiscalYearLabel`, since it's pure date math with zero DB dependency and structurally belongs there, not in the query file. Either is fine; do not reimplement the two-line date math a third time in the new module.
- **Components under `src/components/admin/ledger/`:**
  - `ledger-search-box.tsx` — the quick-search box embedded on the dashboard.
  - `search-filters.tsx` — the advanced filter panel (FY, entity, fund, bank account, amount range, date range, free-text), on the results page.
  - `search-results-transactions.tsx` and `search-results-budget-lines.tsx` — two separate row renderers, not one generic one; transaction rows and budget-line rows carry different fields (check#, bank account vs. cause, label) and link to different destinations.
  - Naming/shape matches the existing directory's convention (one component per concern — c.f. `fiscal-year-selector.tsx`, `entity-switcher.tsx`, `uncashed-checks-panel.tsx`).

### 2. Server/client split

- **The search results page itself is a Server Component** reading `searchParams` (Next 16 async-promise pattern, matching `sync-log/page.tsx` and `budgeting/[fundSlug]/page.tsx` exactly — both already do `searchParams: Promise<{...}>` + `await searchParams`). All filter state — `q`, `fy`, `entity`, `fund`, `bankAccount`, `amountMin`, `amountMax`, `dateFrom`, `dateTo`, `txnPage`, `budgetPage` — lives in the URL and drives a server-side re-render on navigation. No client state needed to answer "what are the current filters," which is the pattern every other ledger page in this codebase already uses.
- **The dashboard's quick-search box needs no `'use client'` at all.** It can be a plain `<form method="GET" action="/admin/ledger/search"><input name="q">`. A GET form navigates to `?q=...` with zero JavaScript — this is the correct, simplest option per CLAUDE.md's "Server Components by default, `'use client'` needs a reason," and `ledger-dashboard.tsx` (confirmed read) is itself already a Server Component with "no client state needed for v1" as its own stated design.
- **The advanced filter panel is the one genuine `'use client'` in this feature.** Reasoning: ~7 filter axes that should submit together as one navigation, not `fiscal-year-selector.tsx`'s pattern of one auto-navigating `<select>` per control (confirmed: that component is `"use client"`, mutates `URLSearchParams` via `useRouter`/`useSearchParams`, and pushes on every `onChange`). Applying that per-field pattern to 7 filters would fire 7 separate navigations. Instead: one client component holding local form state, building a single `URLSearchParams` and doing one `router.push` on submit (Search button, `rounded-lg`, not `rounded-full`).
- **Pagination controls are plain `<a href>` links, not client code** — `sync-log/page.tsx`'s `pageUrl()` helper (confirmed read) is the exact pattern: build a `URLSearchParams`, render `Previous`/`Next` anchors, no JS.
- **Result rows are Server Components** — plain data + a `<Link>` to the existing register/budgeting page (see Q6 below), no interactivity of their own.

### 3. Query strategy

- **Two independent queries per group (transactions, budget lines), not a UNION.** The rows are structurally different (different columns, different permission gates, different link destinations), and the treasurer's own requirement — per-group subtotals across every match, not just the visible page — needs the groups kept separate for accounting anyway. A UNION would force coercing both into a common shape and immediately splitting them back apart to render and subtotal; pure overhead with no benefit.
- **Per group: one aggregate query (count + sum in the same round trip) + one paginated row query, run together via `Promise.all`.** This matches `sync-log/page.tsx`'s established pattern exactly (`Promise.all([rows, [{count}], distinctGroups])`, `sql<number>`count(*)::int`` inline select). Extend that idiom with `sum(amount_cents)::int` alongside `count(*)::int` in the same `.select({...})` — one query instead of two for the aggregate. Total: 2 queries × 2 groups = 4 queries, in parallel. No N+1.
- **The FY asymmetry, precisely:**
  - **Transactions** have no `fiscalYear` column (DECISION-015) — express the filter as a `txnDate` range using the *already-existing* `fyBounds(fy)` helper (`gte(txnDate, start), lt(txnDate, end)`), the same helper every other FY-filtered transaction query in this codebase already uses. Do not invent a second implementation of FY→date-range math.
  - **Budget lines** (`ledgerBudgetLines`) have no `fiscalYear` column either — I want to correct one part of the analyst's framing here: `fiscalYear` lives on the *parent* `ledgerBudgets` row (`ledger_budgets.fiscal_year`, confirmed in `schema.ts`), not on `ledger_budget_lines` itself. Budget-line search therefore requires a join: `ledgerBudgetLines` → `ledgerBudgets` (via `budgetId`) to reach `fiscalYear`, `fundId`, and `entityId` at all — these aren't optional context, they're required to scope the query and to render "which fund/FY does this line belong to" in the result row. Once joined, FY filtering is a direct `eq(ledgerBudgets.fiscalYear, fy)` — no date math needed on this side.
  - **"All years"** — omit the FY condition entirely for both groups (not a sentinel value), matching how `fiscalYear?: number` already works as an optional param throughout `ledger-queries.ts`.
- **Scope note for Phase 3 (not a blocker):** a `ledgerBudgets` row can be a lump sum with no `ledgerBudgetLines` children at all — its own `note` field is real, searchable text a line-only search would never surface. The treasurer's headline example ("what do we have on WARM") is a `cause` match, which only exists on `ledgerBudgetLines` rows (`cause` is `NOT NULL` there; lump-sum `ledgerBudgets` rows have no `cause`), so increment 1 searching `ledgerBudgetLines.cause/label/note` (joined to `ledgerBudgets` for fy/fund) correctly covers what was asked for. Whether to *also* match a lump-sum `ledgerBudgets.note` with no children is a real but smaller, separate case — cheap to add (same join, `OR` on `ledgerBudgets.note`) but Phase 3 should decide explicitly and say so in the design doc rather than leaving it for the implementer to silently include or omit.
- **No schema changes are implied by any of the above.**

### 4. Indexes

**No new index, no `pg_trgm`.** Confirmed by reading both tables' existing index lists: `ledger_transactions` already carries 7 indexes (entity+fund, fund+date, status, transfer_group, bank_account+check_number, reconciled_session, budget_line) and `ledger_budget_lines` carries 1 (budget_id) — none targets the free-text columns this feature searches (`party`, `memo`, `beneficiary_cause`, `check_number`, `cause`, `label`, `note`), and there is zero existing `pg_trgm`/GIN precedent anywhere in `drizzle/migrations/`. At "a few hundred transactions" (stated data volume), a sequential `ILIKE '%term%'` scan costs low-single-digit milliseconds at worst — this is an on-demand, admin-only search box hit a handful of times per treasurer session, not a hot path. Adding `pg_trgm` now means a new Postgres extension, 4–7 new GIN indexes to maintain, and zero measurable benefit at this row count. Decisive no — this is a database-admin call to revisit later with an actual `EXPLAIN` showing a real slow query, not a Phase 2 precaution today.

### 5. Dependencies

**No new dependency.** `ILIKE` substring match is already the established search pattern in this codebase (`listTransactions()`'s existing `search` opt; the donor search in `ledger-queries.ts` around line 4866) — consistent with it is correct, not a compromise. Ranked/fuzzy search (a `pg_trgm`-similarity ranking, a JS fuzzy-match library, or hosted search like Algolia/Meilisearch) was already ruled out of scope by the analyst and not overridden by the treasurer. Anyone reaching for a search library here would be solving a scale and relevance-ranking problem this club's data volume doesn't have — fails dependency-evaluation criterion #1 (already solved by existing tooling) and #4 (bundle size/complexity not justified for an admin-only page hit by a handful of treasurer/board users).

### 6. Deep-linking

**Search owns `?highlight=<id>`; the existing register and budgeting drill-down pages learn to honor it. No new detail surface.**

- A standalone search-owned detail page would be a *third* rendering path for the same transaction/budget-line data (register, budgeting drill-down, search-detail) — duplicated permission checks, and a page that's either read-only (a dead end — the treasurer still has to re-navigate to actually do anything) or grows its own edit capability (real scope creep, reinventing `TransactionFormDialog`/the cause-line editor a second time). Neither is worth it when the two real destinations already exist and already do the job.
- Concretely: `/admin/ledger?entity=<slug>&fy=<fy>&highlight=<txnId>` and `/admin/ledger/budgeting/[fundSlug]?entity=<slug>&fy=<fy>&highlight=<budgetLineId>`. Both existing pages already read `?entity=&fy=` (confirmed in `budgeting/[fundSlug]/page.tsx`'s own `searchParams` type) — `highlight` is a small, additive, backward-compatible third param, not a redesign.
- This does mean Phase 3/4 has to add highlight-handling (scroll-to + visual highlight, and optionally auto-open `TransactionFormDialog`/the cause-line editor for that row) to two existing components that don't have it today — the analyst is right that this is genuinely new surface area, not reuse. That's expected cost for "click into the details" to mean what it says, not a sign the feature is mis-scoped. Whether the highlight auto-opens the edit dialog or just scrolls-and-styles is a UX call for Phase 3, not an architectural one — either is the same file shape.
- If Phase 3 decides to descope the highlight mechanism for increment 1 (the analyst flagged this as negotiable), the fallback is simply omitting the `highlight` param and landing on the filtered `?entity=&fy=` page — same code shape either way, so this doesn't change the Phase 2 verdict.

### 7. Invariants

- **No native browser dialogs** — search is read-only/navigate-only (no delete/reject/approve action lives on this page), so `<ConfirmDialog>` doesn't come up. Concur with the analyst's recommendation to keep it that way for increment 1; if a future increment adds an inline destructive action to a result row, it goes through `<ConfirmDialog>`, never `window.confirm`.
- **Auth + `hasFeature()` on the route** — the search page needs its *own* gate, independent of the dashboard's `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` gate. Per the analyst's residual-risk note, use `hasAnyFeature(session.user.id, [FEATURES.LEDGER_VIEW, FEATURES.BUDGET_VIEW])` at the page level so a hypothetical budget-only role can reach `/admin/ledger/search` directly even though it can't reach the dashboard. Inside the query layer, gate per-section, not per-page: only run the transactions query when `ledger.view` is present, only run the budget-lines query when `budget.view` is present — never fetch-then-hide.
- **No secrets** — nothing here touches env vars or credentials.
- **Schema is the source of truth** — no schema changes proposed anywhere in this design; confirmed against `schema.ts` directly.
- **UX guidelines** — result-row containers `rounded-2xl` (non-interactive-card style, since the row/link is the click target per the analyst's own spot-check, not the card), filter-submit and quick-search buttons `rounded-lg` (never `rounded-full`), `lions-blue` throughout, no `lions-red`. No conflict with anything above.

## Invariants Touched

- **Directory structure** — new `admin/ledger/search/` route (within existing `/(dashboard)/admin/ledger/*` pattern, no rule change) and a new `src/lib/ledger-search-queries.ts` sibling module (extends, doesn't violate, the existing `reconciliation-queries.ts`/`financial-report-queries.ts` module-splitting precedent).
- **Permissions are the only gating mechanism** — respected; no new `FEATURES` key, per-section reuse of `ledger.view`/`budget.view` as the treasurer decided, with the independent page-level `hasAnyFeature` gate noted above so a partial-permission user isn't stranded.
- **Migrations re-run on every deploy** — not touched; no migration in this feature (no schema change, no index).
- **Server/client boundary** — respected; only one genuine `'use client'` component (the advanced filter form), justified above.

## Notes

Phase 3 must explicitly decide and record, rather than leave implicit:

1. Whether lump-sum `ledgerBudgets.note`-only rows (no `ledgerBudgetLines` children) are in scope for the "budget lines" search group in increment 1, or an explicit fast-follow (Section 3 above).
2. Where `fyBounds()` lives going forward — exported from `ledger-queries.ts` as-is, or relocated to `fiscal-year.ts` (recommended) — and update both the new module and, if relocated, the existing call sites in `ledger-queries.ts` to import from the new home.
3. Whether the `?highlight=<id>` deep-link auto-opens the edit surface (`TransactionFormDialog` / the cause-line editor) or only scrolls-to-and-styles the row, for both destination pages.
4. The exact aggregate-query shape (`count(*)::int, sum(amount_cents)::int` in one `.select()`) per group, and the paginated row query's `ORDER BY` (txn date desc for transactions; the analyst suggested cause/label alphabetical for budget lines — confirm).

Recommended Phase 4 implementer split: **api-developer → ux-developer** (specialist split), not full-stack-developer. This exceeds the "~150 lines across API+UI, tightly coupled" full-stack threshold — a new sibling query module with two heterogeneous grouped/paginated/subtotaled queries, a new page, an advanced filter form, two distinct result-row renderers, and retrofitting highlight support into two existing pages/components. There's a real API contract (the shape of grouped + paginated + subtotaled search results) worth api-developer handing off explicitly rather than co-designing ad hoc with the UI. No schema changes, so database-admin isn't a phase here unless Phase 3 assigns it the `fyBounds()` relocation as a pure refactor (small enough that api-developer can equally do it inline).

---

# Phase 3 — Technical Design (tech-lead)

## Summary

We're building a search surface across The Ledger's two heterogeneous record types — transactions and budget lines — so a treasurer can type "WARM" once and see everything the club has budgeted and spent against that cause, without knowing which of six ledger pages to open. Per Phase 1/2: a zero-JS quick-search box on the existing `/admin/ledger` dashboard submits to `/admin/ledger/search?q=…`, which renders two independently-queried, independently-paginated, independently-subtotaled result groups (Transactions, Budget lines), refined by one client-side advanced filter panel. Clicking a result deep-links (`?highlight=<id>`) into the existing register or budgeting drill-down page, which scroll-to-and-flash the matching row rather than growing a third detail surface. No schema changes; one new query module; five new components; two existing pages gain optional highlight support.

## Permissions

No new `FEATURES` key (confirmed correct by analyst/architect). Reused:

- `FEATURES.LEDGER_VIEW` (`"ledger.view"`) gates the Transactions section — role bindings unchanged (`admin`, `treasurer`, `board_member`, `budget_committee`, per `drizzle/migrations/0069_ledger_budget_permissions.sql`).
- `FEATURES.BUDGET_VIEW` (`"budget.view"`) gates the Budget lines section — same file, same roles.

Gate shape (two layers, per architect Section 7):

1. **Page-level:** `/admin/ledger/search/page.tsx` calls `hasAnyFeature(session.user.id, [FEATURES.LEDGER_VIEW, FEATURES.BUDGET_VIEW])` — independent of the dashboard's own `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` gate, so a hypothetical budget-only role can reach `/admin/ledger/search` directly even though it can't reach the dashboard that link's from.
2. **Section-level:** inside the page body, `const canViewTxns = await hasFeature(session.user.id, FEATURES.LEDGER_VIEW)` and `const canViewBudget = await hasFeature(session.user.id, FEATURES.BUDGET_VIEW)` gate whether `searchTransactions()` / `searchBudgetLines()` are called **at all** — never fetch-then-hide. A user with only one of the two sees only that section's header, rows, and pagination; the other section (header included) does not render — see Edge Cases for why "omit the whole section" is the right call here specifically, in contrast to the filter-inapplicability rule below.

## API Contract — Query Layer (no route handlers; this is a read-only Server Component page, so the "API" is the query module's exported functions, called directly from `page.tsx`)

### New file: `src/lib/ledger-search-queries.ts`

```ts
export const SEARCH_PAGE_SIZE = 50;

export interface LedgerSearchFilters {
  /** Raw, untrimmed. Empty string = no free-text condition ("browse" mode). */
  q: string;
  /** null = "All years" (omit FY condition entirely). */
  fiscalYear: number | null;
  entityId?: string;
  fundId?: string;
  categoryId?: string;
  /** Exact match against BUDGET_CAUSES / OTHER_COMMUNITY_SUPPORT_CAUSE taxonomy value. */
  cause?: string;
  /** Transaction-only. Ignored (not applied) by searchBudgetLines(). */
  bankAccountId?: string;
  /** Dollars-to-cents conversion happens in page.tsx before calling the query layer. */
  amountMinCents?: number;
  amountMaxCents?: number;
  /** Transaction-only. Ignored by searchBudgetLines(). 'YYYY-MM-DD'. */
  dateFrom?: string;
  dateTo?: string;
  /** Transaction-only. Ignored by searchBudgetLines(). Omitted = all statuses. */
  status?: "posted" | "pending" | "rejected";
}

export interface TransactionSearchRow {
  id: string;
  txnDate: string;
  flow: "income" | "expense";
  amountCents: number;
  party: string | null;
  memo: string | null;
  beneficiaryCause: string | null;
  checkNumber: string | null;
  paymentMethod: string | null;
  status: "posted" | "pending" | "rejected";
  reconciled: boolean;
  transferGroupId: string | null;
  entityId: string;
  entityName: string;
  entitySlug: string;
  fundId: string;
  fundName: string;
  fundSlug: string;
  categoryId: string | null;
  categoryName: string | null;
  bankAccountId: string | null;
  bankAccountName: string | null;
}

export interface TransactionSearchResult {
  rows: TransactionSearchRow[];
  totalCount: number;
  /** Sums across EVERY match, not just the visible page (treasurer decision #4). */
  totalIncomeCents: number;
  totalExpenseCents: number;
  page: number;
  pageSize: number;
}

export async function searchTransactions(
  filters: LedgerSearchFilters,
  page: number,
): Promise<TransactionSearchResult>;

export interface BudgetLineSearchRow {
  id: string;
  budgetId: string;
  cause: string;
  label: string;
  amountCents: number;
  flow: "income" | "expense";
  starred: boolean;
  note: string | null;
  pendingDeleteAt: Date | null;
  fiscalYear: number;
  entityId: string;
  entityName: string;
  entitySlug: string;
  fundId: string;
  fundName: string;
  fundSlug: string;
  categoryId: string | null;
  categoryName: string | null;
}

export interface BudgetLineSearchResult {
  rows: BudgetLineSearchRow[];
  totalCount: number;
  totalIncomeCents: number;
  totalExpenseCents: number;
  page: number;
  pageSize: number;
}

export async function searchBudgetLines(
  filters: LedgerSearchFilters,
  page: number,
): Promise<BudgetLineSearchResult>;
```

**Why split subtotals by flow instead of one netted total:** `amountCents` is always positive on both tables (schema comment: "always positive; validated > 0 at app layer") — `flow` carries the sign meaning. A term can match both income and expense rows (e.g. "WARM" grants paid out *and* a WARM-earmarked memorial gift received). Netting them into one number would silently combine opposite-direction dollars into a figure nobody asked for. Every other ledger surface (fund-balance cards' Income/Expenses split in `ledger-entity-detail.tsx` lines 252–263) already keeps income and expense separate rather than netting — match that convention, don't invent a new one.

**Query shape per function** (mirrors `sync-log/page.tsx`'s `Promise.all([rows, [{count}], …])` idiom, extended with a flow-split sum in the same aggregate `.select()` — one round trip, not two):

```ts
// searchTransactions — sketch, not final code
const conditions = [/* AND-ed structured filters, see Filter Semantics */];
if (filters.q.trim()) {
  const term = `%${escapeIlikeTerm(filters.q.trim())}%`;
  conditions.push(or(
    ilike(ledgerTransactions.party, term),
    ilike(ledgerTransactions.memo, term),
    ilike(ledgerTransactions.beneficiaryCause, term),
    ilike(ledgerTransactions.checkNumber, term),
  )!);
}

const [rows, [agg]] = await Promise.all([
  db.select({ /* TransactionSearchRow shape */ })
    .from(ledgerTransactions)
    .innerJoin(ledgerEntities, eq(ledgerTransactions.entityId, ledgerEntities.id))
    .innerJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
    .leftJoin(ledgerCategories, eq(ledgerTransactions.categoryId, ledgerCategories.id))
    .leftJoin(ledgerBankAccounts, eq(ledgerTransactions.bankAccountId, ledgerBankAccounts.id))
    .where(and(...conditions))
    .orderBy(desc(ledgerTransactions.txnDate), desc(ledgerTransactions.createdAt))
    .limit(SEARCH_PAGE_SIZE)
    .offset((page - 1) * SEARCH_PAGE_SIZE),
  db.select({
      count: sql<number>`count(*)::int`,
      totalIncomeCents: sql<number>`coalesce(sum(case when ${ledgerTransactions.flow} = 'income' then ${ledgerTransactions.amountCents} else 0 end), 0)::int`,
      totalExpenseCents: sql<number>`coalesce(sum(case when ${ledgerTransactions.flow} = 'expense' then ${ledgerTransactions.amountCents} else 0 end), 0)::int`,
    })
    .from(ledgerTransactions)
    .innerJoin(ledgerEntities, eq(ledgerTransactions.entityId, ledgerEntities.id)) // joins needed only if a joined column is filtered on; entity/fund conditions are on FK columns directly, so these joins are omittable in the aggregate query — worth the implementer double-checking whether the aggregate even needs the joins (it doesn't, since every filterable column lives on ledgerTransactions itself or is an FK id) and dropping them for a cheaper query if so
    .where(and(...conditions)),
]);
```

Same two-query shape for `searchBudgetLines()`, rooted at `ledgerBudgetLines`, `innerJoin(ledgerBudgets, eq(ledgerBudgetLines.budgetId, ledgerBudgets.id))`, `innerJoin(ledgerFunds, eq(ledgerBudgets.fundId, ledgerFunds.id))`, `innerJoin(ledgerEntities, eq(ledgerBudgets.entityId, ledgerEntities.id))`, `leftJoin(ledgerCategories, eq(ledgerBudgets.categoryId, ledgerCategories.id))` (categoryId is nullable on `ledgerBudgets`). Text OR-group: `ilike(ledgerBudgetLines.cause, term)`, `ilike(ledgerBudgetLines.label, term)`, `ilike(ledgerBudgetLines.note, term)`, `ilike(ledgerCategories.name, term)`, `ilike(ledgerBudgets.note, term)` — five fields, per the settled input's "plus the parent's category name and note."

**ILIKE escaping (new):** add `escapeIlikeTerm(term: string): string` as a named export in `src/lib/ledger.ts` (pure, no DB dependency — same rationale as promoting `computeFundPlanSums` there per DECISION-060, and the reason `fyBounds` is moving to `fiscal-year.ts` below: pure helpers belong in the pure-helper file, not the query file).

```ts
export function escapeIlikeTerm(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
```

Postgres's default `LIKE`/`ILIKE` escape character is already `\`, so no explicit `ESCAPE` clause is needed — escaping the term before wrapping it in `%…%` is sufficient. **No existing ILIKE call site in this codebase escapes today** (`listTransactions`'s `search` opt at `ledger-queries.ts` line ~504, `listDonors` at line ~4866) — this feature is the first ILIKE surface exposed to a treasurer typing an arbitrary term at real volume, so it gets the escaping the others arguably should have too. Retrofitting those is out of scope here (note it as a low-priority follow-up, not a blocker).

**`fyBounds()` relocation (Phase 2 open item, resolved):** move `fyBounds()` from `ledger-queries.ts` (currently private, line 102) to `src/lib/fiscal-year.ts` as a new named export, next to `getFiscalYear`/`currentFiscalYear`/`fiscalYearLabel` — it's pure date math with zero DB dependency and structurally belongs there. Update all six existing call sites in `ledger-queries.ts` (lines ~490, 570, 2739, 2972, 4213, 4434, 4540) to `import { fyBounds } from "@/lib/fiscal-year"` instead of the local function. Pure move, zero behavior change — this is step 1 of Implementation Order below, done before the new module exists, so the new module imports the same relocated helper rather than a third reimplementation.

**Lump-sum `ledgerBudgets` rows (Phase 2 open item, resolved): OUT of scope for increment 1.** `searchBudgetLines()` is rooted at `ledgerBudgetLines` (an inner join up to `ledgerBudgets`), so a lump-sum budget row with zero line children never produces a search result even if its own `note` matches — there is no line to attach the match to. This is deliberate, not an oversight: the treasurer's own headline example ("what do we have on WARM") is a `cause` match, and `cause` is `NOT NULL` only on `ledgerBudgetLines` — lump-sum `ledgerBudgets` rows have no `cause` at all. Searching only lines correctly covers what was asked for. A fast-follow (UNION in a synthetic all-causes/no-label row for parentless lump sums whose own `note` matches) is cheap or a schema change is required — flagging as a named non-goal here rather than leaving it ambiguous, per Phase 2's instruction.

## Filter Semantics

Two different rules apply depending on **why** a filter doesn't affect a section — this distinction is the answer to the analyst's flagged-unresolved question, and the two rules are deliberately different:

1. **A filter with no analog on that result type (transaction-only filters on the Budget lines section: `bankAccountId`, `dateFrom`/`dateTo`, `status`) is silently ignored for scoping — never forces zero rows, never hides the section — but is called out with an inline note under that section's header** (e.g. "Bank account, date range, and status filters don't apply to budget lines — showing matches across all of those."). Rationale, extending the analyst's own recommendation for the bank-account case (Phase 1 Gaps #2) to all three transaction-only filters uniformly: forcing zero would look like "no budget matches WARM" when the true statement is "budget lines have no bank-account/date/status concept to filter on" — a search tool that shows zero *because it can't apply a filter*, rather than because nothing matched, would actively mislead a treasurer scanning subtotals.
2. **A missing permission (no `LEDGER_VIEW` / no `BUDGET_VIEW`) omits the entire section, header included** — the opposite policy, and correctly so: the treasurer isn't scoped out of an *axis*, she's scoped out of the *data*. Showing "0 budget lines" (or any budget-lines header at all) to a `ledger.view`-only user would leak the section's existence for data she has no right to query. This mirrors the existing pattern of conditionally omitting whole UI blocks by permission elsewhere in this codebase (e.g. `ledger-entity-detail.tsx`'s `{canApprove && (<Link .../>)}`).

Filters that apply to **both** sections normally (FY, entity, fund, category, cause, amount range) — each is a direct `AND`-ed condition on both queries:

- **FY:** `fiscalYear: null` → omit the FY condition entirely on both queries (not a sentinel value in the DB query, matches how `fiscalYear?: number` already works as optional throughout `ledger-queries.ts`). Otherwise: transactions get `gte(txnDate, fyBounds(fy).start) AND lt(txnDate, fyBounds(fy).end)`; budget lines get `eq(ledgerBudgets.fiscalYear, fy)` (direct column match via the join, no date math).
- **Entity / Fund:** direct `eq()` on `entityId`/`fundId` — real columns on `ledgerTransactions` and (via the join) resolvable for `ledgerBudgetLines` through `ledgerBudgets.entityId`/`fundId`.
- **Category:** `eq(ledgerTransactions.categoryId, categoryId)` vs. `eq(ledgerBudgets.categoryId, categoryId)` (joined) — both nullable columns, both real.
- **Cause:** `eq(ledgerTransactions.beneficiaryCause, cause)` vs. `eq(ledgerBudgetLines.cause, cause)`. Note the asymmetry is expected, not a bug: `beneficiaryCause` is optional free-text-tag on transactions (many will be null and simply won't match a cause filter — correct, not an edge case), `cause` is `NOT NULL` taxonomy-constrained on budget lines. Both draw their filter dropdown from the same `BUDGET_CAUSES` + `OTHER_COMMUNITY_SUPPORT_CAUSE` list in `src/lib/ledger.ts`.
- **Amount:** `amountMinCents` set, `amountMaxCents` unset → `eq(amountCents, amountMinCents)` (treasurer decision #5: a single value means exact match, not an open-ended `>=`). Both set → `gte(amountCents, min) AND lte(amountCents, max)`. Neither set → no amount condition.

## URL / State Contract

Page: `src/app/(dashboard)/admin/ledger/search/page.tsx`, `export const dynamic = "force-dynamic"` (matches every other ledger admin page). All state lives in `searchParams` — the page is a Server Component with zero of its own client state; the one client component (the filter panel) initializes its local form fields **from these same `searchParams`**, passed down as props, so a shared/bookmarked/back-navigated URL reproduces both the *results* and the *visible filter UI* identically, not just the results.

| Param | Default when absent | Notes |
|---|---|---|
| `q` | `""` | Free text. Absent + no filters = valid "browse current FY" mode, not an error (see Edge Cases). |
| `fy` | current FY (`currentFiscalYear(new Date())`) | Literal `"all"` string → `fiscalYear: null`. Any other non-numeric value falls back to current FY (mirrors the existing `[fundSlug]/page.tsx` `parsedFY`/`isNaN` fallback pattern). |
| `entity` | none | Entity **slug**, resolved server-side against `getEntities()` (mirrors `[fundSlug]/page.tsx`'s `validSlugs` check) — invalid slug is ignored (treated as absent), not an error. |
| `fund` | none | Fund **slug**. Only honored when `entity` also resolves (funds are unique per `(entityId, slug)`, not globally) — `fund` set without a valid `entity` is ignored. Invalid fund-for-that-entity is ignored. |
| `category` | none | Category `id` (UUID) — categories have no slug in this schema; the raw id is fine as an opaque param. |
| `cause` | none | Exact string from `BUDGET_CAUSES`/`OTHER_COMMUNITY_SUPPORT_CAUSE`. |
| `bankAccount` | none | Bank account `id` (UUID). Transaction-only (see Filter Semantics). |
| `amountMin`, `amountMax` | none | Dollar strings (e.g. `"50.00"`), parsed to cents in `page.tsx` before calling the query layer (keeps the query module's units unambiguous — cents in, cents out, no dollars ever cross that boundary). |
| `dateFrom`, `dateTo` | none | `YYYY-MM-DD`. Transaction-only. |
| `status` | none (= all statuses) | `posted` \| `pending` \| `rejected`. Transaction-only. |
| `txnPage` | `1` | Independent of `budgetPage`. |
| `budgetPage` | `1` | Independent of `txnPage`. |
| `highlight` | — | **Not read by the search page itself.** Search only *writes* this param into its outbound result links; the register and budgeting drill-down pages are the ones that read it. |

**Filter panel submit behavior:** one client component (`search-filters.tsx`, the only `'use client'` in this feature), holding local form state seeded from props. On submit, builds a fresh `URLSearchParams` from **every** current field (not a diff) — including the current `q` value, so tweaking a filter never silently drops whatever the treasurer had typed in the box — and does one `router.push('/admin/ledger/search?' + params)`. Changing any filter resets both `txnPage` and `budgetPage` to 1 (omitted from the new URL) since the result set changed; changing only a page number (via the plain `<a href>` pagination links) leaves every filter param untouched.

**Pagination:** plain `<a href>` links, `sync-log/page.tsx`'s `pageUrl()` pattern exactly — a shared `buildSearchUrl(current, overrides)` helper in the page (or a small colocated util) that starts from the full current `URLSearchParams`, applies one override (`txnPage` or `budgetPage`), and serializes. No JS.

**Category/Bank Account/Fund dropdown options** (filter panel): only two entities exist today (Club, Foundation), so the panel is populated by fetching `getCategories()`/`getBankAccounts()`/`getFunds()` for **every** entity from `getEntities()` (cheap — a handful of rows total) and labeling each option with its entity's short name when no `entity` filter is active (e.g. "Club dues (Club)"); once an `entity` filter is set, the page re-renders with that entity's options only, unprefixed. No new query needed — reuses `getEntities`/`getCategories`/`getBankAccounts`/`getFunds`, already exported from `ledger-queries.ts`.

## The `?highlight=<id>` Contract

**Owned by search, honored by the two existing destination pages. No new detail surface** (DECISION-062).

- **Register:** `/admin/ledger/${fundSlug}?entity=<slug>&fy=<fy>&highlight=<txnId>`. Search always resolves `fundSlug` from the matched transaction's own `fundId` (via the `fundSlug` already selected in `TransactionSearchRow`) and `fy` from `getFiscalYear(txnDate)` — so the destination link is always the correct fund+FY for that row, never a guess.
- **Budgeting drill-down:** `/admin/ledger/budgeting/${fundSlug}?entity=<slug>&fy=<fy>&highlight=<budgetLineId>` — `fundSlug`/`fy` similarly resolved from `BudgetLineSearchRow`'s own `fundSlug`/`fiscalYear`.
- **Behavior on arrival — scroll + flash only, NOT auto-open the edit dialog** (this Phase 3's call on the item Phase 2 explicitly left open). Reasoning: `TransactionFormDialog`/`TransactionActions` and `BudgetCauseEditor` are both `'use client'` components already managing their own open/local-editing state independently of the URL; threading a "start already open, and specifically on THIS row" prop through a server-rendered list into two structurally different client components is real, non-trivial surface area for a read/navigate-only feature whose Phase 1 framing ("click into the details") is satisfied by *landing on the exact row, visibly marked* — the treasurer can then click Edit herself in one more click. If this turns out to feel like one click too many, upgrading scroll-and-flash to auto-open is a self-contained fast-follow on either destination component; it does not reshape anything built in increment 1.
- **Register implementation:** add `id={`txn-${txn.id}`}` to the `<tr key={txn.id}>` in `[fundSlug]/page.tsx` (~line 384). Add one new tiny client component, `transaction-row-highlighter.tsx` — renders `null`, and in a `useEffect` on mount: finds `document.getElementById('txn-' + highlightId)`; if found, `scrollIntoView({ behavior: "smooth", block: "center" })` + toggles a temporary highlight class (`ring-2 ring-lions-gold bg-lions-gold/10` — gold accent, per CLAUDE.md's "use `lions-gold` as an accent... not as a card border" guidance for badges/highlights) removed via `setTimeout` after ~2.5s; either way (found or not), calls `router.replace(pathname-without-highlight, { scroll: false })` so a manual page refresh doesn't re-trigger the scroll/flash. Rendered once on the page, reading its own tiny `highlight?: string` prop threaded from `searchParams`.
- **Budgeting drill-down implementation:** add `id={`budget-line-${row.id}`}` to **both** row-rendering branches in `budget-cause-editor.tsx` — the live-row branch (~line 1247) and the pending-delete/"dead" row branch (~line 1200), so a struck-through pending-delete line is still a valid highlight target (satisfies the analyst's Flow 4 failure case automatically — no special-casing needed, since the dead-row branch already renders the struck-through treatment on its own). Thread a `highlightLineId?: string` prop from `budgeting/[fundSlug]/page.tsx` → `BudgetFundEditor` → `BudgetCauseEditor` (every per-category `BudgetCauseEditor` instance receives the same id; only the one instance whose `rows` actually contains it will find a DOM match — harmless no-op for the rest). Same highlighter client component pattern/effect as above (a shared, generic `<RowHighlighter targetId={...} idPrefix="txn-" | "budget-line-" />` component is reasonable to write once and reuse on both pages rather than duplicating the effect twice — implementer's call, not load-bearing).
- **Degrade when the id isn't found** (deleted transaction, stale link, etc.): the highlighter no-ops silently — no scroll, no flash, no error banner. Both destination pages already render correctly with or without the row (register/drill-down show whatever rows currently exist); a hard-deleted transaction simply isn't in the DOM to find, which is an acceptable degrade per the analyst's own Flow 3 note ("destination should say [it] no longer exists rather than 404 or a blank register" — the register isn't blank, it just doesn't have that one row highlighted). No extra messaging needed in increment 1.
- **Cleanup:** the `router.replace(..., { scroll: false })` call above strips `highlight` from the URL immediately after the effect runs, on both pages — a subsequent manual refresh of the (now `highlight`-free) URL is inert, matching CLAUDE.md's back-button-correctness expectation.

## Result Presentation

**Transactions section** — table wrapped in the *exact* existing `overflow-x-auto` pattern from `[fundSlug]/page.tsx` (a `rounded-2xl border border-gray-200 bg-white shadow-sm` container, `overflow-x-auto` inner div, `min-w-full` table) — **not a card-based mobile layout.** Correcting the analyst's own speculative framing here: the register this reuses already solves "8 columns at 360px" today by scrolling the table horizontally inside a bounded container, per CLAUDE.md's "wide content... must scroll inside its own `overflow-x-auto` container" rule — it does not use cards. Reuse that, don't invent a second pattern.

- Columns: Date, Flow (badge + status badge when not `posted`, reusing `flowBadgeClass`/`flowLabel`/`statusBadge` logic from `[fundSlug]/page.tsx` lines 34–59 — duplicate these ~20 lines of pure presentational helpers into `search-results-transactions.tsx` rather than exporting/importing across a page↔component boundary that doesn't otherwise share code; low-stakes either way), Entity (omitted when an `entity` filter is active — redundant once scoped, mirrors the register's own conditional Fund column), Fund, Category, Party, Amount (right-aligned, `tabular-nums`), Check #/Method. No Actions column — every row is itself a `<Link>` to `?highlight=` (read/navigate-only, confirmed out of scope for inline actions).
- Sort: `txnDate DESC, createdAt DESC` (identical secondary sort to `listTransactions()`, for determinism across pages).
- Long `party`/`memo` values: `truncate` class + native `title` attribute for the full value on hover (not a custom tooltip component — browser-native, not a `window.*` dialog, so it's fine).

**Budget lines section** — same `overflow-x-auto` card/table wrapper.

- Columns: Cause, Label, Entity (same conditional-omit rule), Fund, FY (omitted when a specific FY, not "All years", is filtered — redundant once scoped, same logic as Entity), Category, Amount (right-aligned), a small star icon when `starred`, and pending-delete rows rendered strikethrough (`text-gray-400 line-through`, `bg-gray-100` row background) with a "Pending removal" badge — reusing `budget-cause-editor.tsx`'s existing dead-row visual language (informational styling only; no Undo/Restore controls here, this section is read/navigate-only).
- Sort: `cause ASC, label ASC, fiscalYear DESC, fundName ASC`.

**Subtotal line** (both sections, above or below the table, not per-page): "Subtotal across all N matches — Income: $X · Expenses: $Y" using the same green-for-income / plain-for-expense treatment as the fund-balance cards' Income/Expenses split.

**"Showing N of Total" + pagination**: `Showing {(page-1)*50+1}–{min(page*50, total)} of {total}` text + Previous/Next `<a>` links, identical shape to `sync-log/page.tsx` lines 224–246, independently for `txnPage` and `budgetPage`.

**Empty states:**
- **Both sections empty:** one page-level `bg-gray-50 rounded-2xl p-10 text-center text-gray-500` block replacing both sections. Copy: `No transactions or budget lines match "{q}".` when `q` is non-empty (plus a "try broadening your search or clearing filters" hint, per the analyst's Flow 1 spec); `No transactions or budget lines match these filters.` when `q` is empty (filters-only browse mode).
- **One section has matches, the other doesn't:** **both section headers still render, with their counts** (one showing 0) — the empty section gets its own smaller, section-scoped empty block (not the whole page), e.g. `No budget lines match "WARM" in FY2026.` The section never silently disappears just because it has zero matches — only a missing *permission* makes a section disappear (see Filter Semantics rule 2 above); zero matches is a real, informative answer that should stay visible.

## Edge Cases & Risks

- **Landing on `/admin/ledger/search` with zero params.** Not an error/empty state — `fy` defaults to current FY, which already bounds the result set to "this fiscal year's activity," so a bare visit behaves as a legitimate "browse current FY" mode, not a broken search. Worth calling out explicitly since it's easy to mis-build this as "redirect to dashboard if `q` is empty."
- **`fund` param without a valid `entity` param.** Ambiguous (fund slugs aren't globally unique) — ignored, not an error.
- **A user with only one of `LEDGER_VIEW`/`BUDGET_VIEW`.** Only that section renders — see Filter Semantics rule 2 and Permissions above.
- **Pending/rejected transactions.** Included, with the same `statusBadge()` treatment the register already uses — excluding them would make search lie about what's in the books (analyst's own framing, concurred).
- **Pending-delete budget lines (`pendingDeleteAt` set).** Included, struck-through, per the dead-row visual language in `budget-cause-editor.tsx` — see Result Presentation.
- **Lump-sum lines with no children.** Explicitly out of scope for increment 1 — see API Contract section above.
- **A term matching hundreds of rows.** No special handling needed: the aggregate query (`count`/`sum`) runs server-side in Postgres regardless of match count, and the row query is always `LIMIT 50 OFFSET`, so nothing scales with match count except the two numbers displayed. Phase 2 already sized this as a non-issue at this club's actual data volume (a few hundred transactions *total* — "hundreds of matches" is the whole table, not a runaway scan).
- **Very long `party`/`memo` values.** CSS `truncate` + `title` tooltip, no DB truncation.
- **A transaction deleted between search and click-through.** Highlighter silently no-ops — see `?highlight=` Contract above.

## Component / Page Plan

- **Pages to create:** `src/app/(dashboard)/admin/ledger/search/page.tsx`.
- **Components to create:**
  - `src/components/admin/ledger/ledger-search-box.tsx` — plain `<form method="GET" action="/admin/ledger/search">`, zero JS.
  - `src/components/admin/ledger/search-filters.tsx` — the one `'use client'` component (FY, entity, fund, category, cause, bank account, amount, date, status, `q`).
  - `src/components/admin/ledger/search-results-transactions.tsx` — server component, table + subtotal + pagination + empty state.
  - `src/components/admin/ledger/search-results-budget-lines.tsx` — server component, same shape.
  - `src/components/admin/ledger/row-highlighter.tsx` — small client component, scroll+flash+URL-strip effect, reused by both destination pages.
- **Files to modify:**
  - `src/lib/fiscal-year.ts` — add exported `fyBounds()`.
  - `src/lib/ledger-queries.ts` — remove private `fyBounds()`, import the relocated one at all 6 call sites.
  - `src/lib/ledger.ts` — add exported `escapeIlikeTerm()`.
  - `src/components/admin/ledger/ledger-dashboard.tsx` — mount `<LedgerSearchBox>`.
  - `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx` — add `id="txn-<id>"` to each row, mount `<RowHighlighter>`, accept/read `highlight` from `searchParams`.
  - `src/components/admin/ledger/budget-cause-editor.tsx` — add `id="budget-line-<id>"` to both row branches, accept `highlightLineId?` prop.
  - `src/components/admin/ledger/budget-fund-editor.tsx` — thread `highlightLineId?` through to each `BudgetCauseEditor` instance.
  - `src/app/(dashboard)/admin/ledger/budgeting/[fundSlug]/page.tsx` — read `highlight` from `searchParams`, pass down, mount `<RowHighlighter>`.

## Data Model

No schema changes required. No new tables, columns, or indexes (confirmed by architect Section 4 — sequential ILIKE scan is cheap at this row count; revisit only with a real `EXPLAIN` showing a slow query).

## Implementation Order

1. **api-developer — mechanical refactor, do first, zero behavior change:** relocate `fyBounds()` to `src/lib/fiscal-year.ts` (export it), update the six existing call sites in `ledger-queries.ts`. Add `escapeIlikeTerm()` to `src/lib/ledger.ts`. Unit test #1 (below) lands here.
2. **api-developer — new query module:** `src/lib/ledger-search-queries.ts` — `LedgerSearchFilters`, `searchTransactions()`, `searchBudgetLines()`, per the API Contract above. Unit tests #2, #3, #5, #6, #7, #8 land in a colocated `src/lib/ledger-search-queries.test.ts` (matches this codebase's colocated-test convention, e.g. `budget-notes-markdown.test.tsx`).
3. **Handoff point → ux-developer.** api-developer hands off with the query module fully written, tested, and its contract (function signatures + result shapes above) as the spec. ux-developer builds:
   - `src/app/(dashboard)/admin/ledger/search/page.tsx` — page + section-level permission gates (unit test #4 lands here, or as an integration test at the page-body level — implementer's call on harness), `searchParams` parsing per the URL/State Contract, dollars→cents conversion for amount filters, entity/fund slug resolution.
   - `ledger-search-box.tsx`, `search-filters.tsx`, `search-results-transactions.tsx`, `search-results-budget-lines.tsx`.
   - Mount `<LedgerSearchBox>` on `ledger-dashboard.tsx`.
4. **ux-developer — highlight retrofit:** `row-highlighter.tsx`; wire `id`/`highlight` into `[fundSlug]/page.tsx` and `budget-cause-editor.tsx`/`budget-fund-editor.tsx`/`budgeting/[fundSlug]/page.tsx`.
5. **No email notification** — read-only admin feature, nothing to notify.
6. **Release notes entry** — tech-lead, at merge time, per the standard pipeline.

## Unit Tests (Phase 4, written by the implementer per CLAUDE.md — not qa)

1. `escapeIlikeTerm()` — `%` → `\%`, `_` → `\_`, `\` → `\\`; a term containing all three in one string round-trips correctly; a plain alphanumeric term is unchanged.
2. `searchTransactions()` FY-boundary correctness — a transaction dated `2026-06-30` is **excluded** with `fiscalYear: 2026` and **included** with `fiscalYear: 2025`; a transaction dated `2026-07-01` is **included** with `fiscalYear: 2026` and **excluded** with `fiscalYear: 2025` (mirrors the invariant already documented on `fyBounds`/`getFiscalYear`).
3. Subtotals span all matches, not just the visible page — for both `searchTransactions()` and `searchBudgetLines()`, seed/mock more than `SEARCH_PAGE_SIZE` matching rows and assert `totalIncomeCents`/`totalExpenseCents`/`totalCount` are identical when called with `page: 1` vs. `page: 2`.
4. Per-section permission gating — a caller lacking `LEDGER_VIEW` never triggers `searchTransactions()`, a caller lacking `BUDGET_VIEW` never triggers `searchBudgetLines()` (spy/mock on both query functions, assert zero calls for the missing side), across all four permission combinations.
5. Inapplicable-filter policy — `searchBudgetLines()` called with `bankAccountId`/`dateFrom`/`dateTo`/`status` all set returns the **same rows** as calling it with those fields omitted (proves the query layer truly ignores them rather than forcing zero rows).
6. Amount single-value = exact match — `searchTransactions({ amountMinCents: 5000 })` (no `amountMaxCents`) returns only rows where `amountCents === 5000`, not `>= 5000`.
7. Free-text OR-across-fields — a term matching only `beneficiaryCause` (not `party`/`memo`/`checkNumber`) still returns the row.
8. Lump-sum exclusion — a `ledgerBudgets` row whose own `note` matches the term but has zero `ledgerBudgetLines` children produces no row in `searchBudgetLines()` results (regression guard for the documented increment-1 scope decision).

## Implementer

**api-developer** for steps 1–2 (query layer), handing off to **ux-developer** for steps 3–4 (page, components, highlight retrofit) — the specialist split, not full-stack-developer. This exceeds the "~150 lines, tightly coupled" full-stack threshold: a new query module with two heterogeneous grouped/paginated/subtotaled queries, a new page, five new components, and a retrofit into two existing pages/components is real API-surface design worth handing off explicitly, matching the precedent set by every prior Ledger increment (architect's own recommendation, concurred).

---

# Phase 4 — Implementation (API) — 2026-08-06

**Owner:** api-developer
**Status:** complete (steps 1–2 only — the page, components, and highlight retrofit (steps 3–4) are
ux-developer's, not touched here)

### Summary

Built the server/query half of the Ledger & Budget Search feature exactly per the Phase 3 design:
relocated `fyBounds()` from a private helper in `ledger-queries.ts` to an exported function in
`fiscal-year.ts`, added `escapeIlikeTerm()` to `ledger.ts`, and wrote the new `ledger-search-queries.ts`
module with `searchTransactions()`/`searchBudgetLines()` per the exact `LedgerSearchFilters` /
`TransactionSearchResult` / `BudgetLineSearchResult` contract in the design doc. Two independent
queries per group (row query + count/sum aggregate, run via `Promise.all`, no UNION), subtotals split
by flow (never netted), amount single-value = exact match, transaction-only filters silently ignored
(not zero-forced) on the budget-lines side, and the budget-line query rooted at `ledgerBudgetLines`
with an INNER join up to `ledgerBudgets` so lump-sum rows structurally can't appear. No schema change,
no new index, no new dependency, no route handler (this is a read-only Server Component page's data
layer, per the design's own framing — nothing to route-handle). `pnpm exec tsc --noEmit`, `pnpm test`
(917/917), and `pnpm build:only` are all green — see Gate Results below.

### What I did

- Read the full work-log (Phase 1 analyst, Treasurer Decisions, Phase 2 architect, Phase 3 tech-lead
  design) plus DECISION-062 and DECISION-063 before writing any code, per instructions.
- **Step 1 (mechanical refactor, zero behavior change):**
  - Added `fyBounds(fy: number): { start: string; end: string }` as a new named export in
    `src/lib/fiscal-year.ts`, with a doc comment noting the relocation and citing DECISION-063.
  - Removed the private `fyBounds()` from `src/lib/ledger-queries.ts` and added `fyBounds` to its
    existing `import { getFiscalYear, currentFiscalYear, fiscalYearLabel } from "@/lib/fiscal-year"`
    line. All 7 existing call sites (lines ~490, 570, 2739, 2972, 4213, 4434, 4540 — one more than the
    design doc's "six" count, but every one resolved cleanly with zero code change beyond the import
    swap, confirmed by `tsc --noEmit` and the full `getFundReport asOfDate bounding` test block in
    `ledger-queries.test.ts` staying green) now resolve to the relocated function transparently.
  - Added `escapeIlikeTerm(term: string): string` to `src/lib/ledger.ts`, verbatim per the Phase 3
    design's snippet (backslash escaped first, then `%`, then `_` — order matters, documented in the
    function's own doc comment).
- **Step 2 (new query module):** wrote `src/lib/ledger-search-queries.ts` — `SEARCH_PAGE_SIZE = 50`,
  `LedgerSearchFilters`, `TransactionSearchRow`/`TransactionSearchResult`,
  `BudgetLineSearchRow`/`BudgetLineSearchResult`, `searchTransactions()`, `searchBudgetLines()`. Shared
  a `pushAmountConditions()` helper (exact-match-or-range on an `AnyPgColumn`) and separate
  `buildTransactionConditions()`/`buildBudgetLineConditions()` functions between each group's row query
  and its aggregate query, so the two can never drift out of sync with each other.
  - Transactions: root `ledgerTransactions`, inner-join `ledgerEntities`/`ledgerFunds` (non-null FKs),
    left-join `ledgerCategories`/`ledgerBankAccounts` (nullable FKs) for the row query. The aggregate
    query joins nothing — every filterable/text column (`entityId`, `fundId`, `categoryId`,
    `beneficiaryCause`, `bankAccountId`, `party`, `memo`, `checkNumber`) lives directly on
    `ledgerTransactions`, per the design's own note that the joins are droppable there.
  - Budget lines: root `ledgerBudgetLines`, **inner**-join up to `ledgerBudgets` (required for
    `fiscalYear`/`entityId`/`fundId`/`categoryId` and the parent's `note` text-match), inner-join
    `ledgerFunds`/`ledgerEntities` and left-join `ledgerCategories` for the row query's display names.
    The aggregate query joins `ledgerBudgets` (inner) and `ledgerCategories` (left, for the
    category-name text-match) but omits `ledgerEntities`/`ledgerFunds` (display-name-only, never
    filtered/matched on). The inner join to `ledgerBudgetLines` from `ledgerBudgets` (not the reverse)
    is what makes the lump-sum exclusion (DECISION-063 #4) structural rather than a filter — a budget
    row with zero line children has no row to originate from.
  - FY: transactions use `fyBounds(fy)` → `gte(txnDate, start) AND lt(txnDate, end)`; budget lines use
    a direct `eq(ledgerBudgets.fiscalYear, fy)`. `fiscalYear: null` omits the condition on both sides
    entirely (not a sentinel value) — verified via test (`where(undefined)` when no other filters set).
  - Free text: `q.trim()` empty ⇒ no condition (browse mode). Non-empty ⇒
    `escapeIlikeTerm()` + `%…%`, OR-ed across `party`/`memo`/`beneficiaryCause`/`checkNumber`
    (transactions, 4 fields) or `cause`/`label`/`note`/`ledgerCategories.name`/`ledgerBudgets.note`
    (budget lines, 5 fields) — exactly the field lists the design specified.
  - Amount: both set ⇒ `gte`+`lte` range; only `amountMinCents` set ⇒ `eq` (exact match, treasurer
    decision #5, not an open-ended `>=`); only `amountMaxCents` set ⇒ `lte`; neither ⇒ no condition.
  - Transaction-only filters (`bankAccountId`, `dateFrom`, `dateTo`, `status`) are simply never
    referenced by `buildBudgetLineConditions()` — not conditionally skipped, structurally absent —
    which is what makes the "ignored, never forces zero" policy (Filter Semantics rule 1) true by
    construction rather than by a special case.
  - Row-shape casts: `flow`/`status` come back as plain `text` columns from Drizzle (no enum type on
    either table), so both `searchTransactions()` and `searchBudgetLines()` map the raw row array
    through a cast to the narrowed union types before returning — identical pattern to
    `listTransactionsForExport()`'s existing `r.flow as "income" | "expense"` cast in
    `ledger-queries.ts`, not a new convention.
  - Deliberately did **not** touch `listTransactions()`'s existing `search` opt (party/memo only,
    single-entity-scoped) — confirmed per Phase 2's ruling this module writes its own queries rather
    than extending/wrapping it.
- Wrote the Phase 4 unit tests named in the Phase 3 design and assigned to api-developer's half (tests
  1, 2, 3, 5, 6, 7, 8 — test 4, page-level permission gating, is explicitly assigned to ux-developer in
  the design's own Implementation Order, landing in `page.tsx`, not this module):
  - `escapeIlikeTerm()` tests added to `src/lib/ledger.test.ts` (test 1): `%`→`\%`, `_`→`\_`,
    `\`→`\\`, a term with all three round-tripping correctly (verifies escape order), a plain term and
    an empty string both unchanged.
  - `src/lib/ledger-search-queries.test.ts` (new file, tests 2/3/5/6/7/8) — hermetic, mocks `@/lib/db`
    with the same FIFO-queue convention as `reconciliation-queries.test.ts`/`ledger-queries.test.ts`,
    extended to also capture each select's `.from()`/`.innerJoin()`/`.leftJoin()`/`.where()` calls so
    generated SQL/params can be inspected via `PgDialect().sqlToQuery()` — same technique
    `ledger-queries.test.ts`'s "getFundReport asOfDate bounding" block already established.
    - Test 2 (FY boundary): both a pure `fyBounds()` boundary-math check (2026-06-30 excluded from
      FY2026/included in FY2025; 2026-07-01 included in FY2026/excluded from FY2025) and a wiring
      check that `searchTransactions({fiscalYear: 2026})` actually produces
      `txnDate >= '2026-07-01' AND txnDate < '2027-07-01'` (params equality + operator-string
      assertions, confirming `<` not `<=` on the upper bound).
    - Test 3 (subtotals span all matches): pushes a `count: 214` aggregate result behind two
      different 50-row pages and asserts `totalCount`/`totalIncomeCents`/`totalExpenseCents` are
      identical across `page: 1` and `page: 2` even though `rows` differ — for both
      `searchTransactions()` and `searchBudgetLines()`.
    - Test 5 (inapplicable-filter policy): asserts `searchBudgetLines()` with
      `bankAccountId`/`dateFrom`/`dateTo`/`status` all set produces **byte-identical** WHERE SQL and
      params to calling it with those fields entirely omitted — proves they're truly inert, not
      silently forcing zero rows.
    - Test 6 (amount exact match): `amountMinCents` alone renders `=`, never `>=`/`<=`; both bounds
      set render a `>=`/`<=` range — checked on both `searchTransactions()` and `searchBudgetLines()`.
    - Test 7 (free-text OR-across-fields): asserts the transactions WHERE clause contains exactly 4
      `ilike` calls across `party`/`memo`/`beneficiary_cause`/`check_number` (not just
      party/memo — the gap `listTransactions()`'s narrower `search` opt has), and the budget-lines
      WHERE clause contains exactly 5.
    - Test 8 (lump-sum structural exclusion): asserts both the row query and the aggregate query are
      rooted at `ledgerBudgetLines` (`.from()` identity check against the imported schema object) with
      an **inner** (not left) join up to `ledgerBudgets` — the by-construction guarantee that backs
      DECISION-063 #4, made explicit as a regression guard rather than left implicit.
- Ran `pnpm exec tsc --noEmit` (clean), `pnpm test` (917/917 passing across 36 test files — 22 new
  tests added this session: 6 `escapeIlikeTerm` cases in `ledger.test.ts` + 16 across the 8 `describe`
  blocks in the new `ledger-search-queries.test.ts`), and `pnpm build:only` (exit 0, full route
  manifest printed, no errors) after all edits.
  `pnpm lint` was attempted and hit the same pre-existing `minimatch`/`eslintrc` ESM crash CLAUDE.md
  and the 2026-07-30 work-log already document as an environment-level issue unrelated to this change
  — not something introduced here. Grepped both new/modified files for `console.*` — none present.
- Did not build the route (`src/app/(dashboard)/admin/ledger/search/page.tsx`), any component under
  `src/components/admin/ledger/`, or the highlight retrofit into `[fundSlug]/page.tsx` /
  `budget-cause-editor.tsx` / `budget-fund-editor.tsx` / `budgeting/[fundSlug]/page.tsx` — confirmed
  out of scope, ux-developer's steps 3–4. Did not mount `<LedgerSearchBox>` on `ledger-dashboard.tsx`.
  Did not write to any database (read-only query code, no seed/migration script touched). Did not
  commit or push.

### Deviations from the design

None. Every structural decision in the Phase 3 design (join direction, which table owns which filter
column, subtotal-split-by-flow, amount exact-vs-range semantics, transaction-only-filter inertness on
the budget side, `fyBounds`/`escapeIlikeTerm` relocation targets) was buildable exactly as specified —
nothing required a stop-and-flag deviation.

### Gate Results

- `pnpm exec tsc --noEmit`: **PASS** (clean, no output).
- `pnpm test`: **PASS** (917/917, 36 test files).
- `pnpm build:only`: **PASS** (exit code 0; full production route manifest printed; no errors or
  warnings in the log).
- No `console.log`/`console.*` in any new or modified production file.
- No new npm dependency added.
- No schema change, no new migration, no new index.

### Outputs

**New file:** `src/lib/ledger-search-queries.ts`

```ts
export const SEARCH_PAGE_SIZE = 50;

export interface LedgerSearchFilters {
  q: string;                    // raw, untrimmed; "" = no free-text condition
  fiscalYear: number | null;    // null = "All years" (omit FY condition entirely)
  entityId?: string;
  fundId?: string;
  categoryId?: string;
  cause?: string;                // exact match, BUDGET_CAUSES / OTHER_COMMUNITY_SUPPORT_CAUSE
  bankAccountId?: string;        // transaction-only; ignored by searchBudgetLines()
  amountMinCents?: number;
  amountMaxCents?: number;       // single value (min only) = exact match, not >=
  dateFrom?: string;              // transaction-only; ignored by searchBudgetLines()
  dateTo?: string;                // transaction-only; ignored by searchBudgetLines()
  status?: "posted" | "pending" | "rejected"; // transaction-only; ignored by searchBudgetLines()
}

export async function searchTransactions(
  filters: LedgerSearchFilters,
  page: number,
): Promise<TransactionSearchResult>;   // rows, totalCount, totalIncomeCents, totalExpenseCents, page, pageSize

export async function searchBudgetLines(
  filters: LedgerSearchFilters,
  page: number,
): Promise<BudgetLineSearchResult>;    // same shape, budget-line rows
```

Full `TransactionSearchRow`/`BudgetLineSearchRow` field lists match the Phase 3 design's contract
verbatim (see that section above) — not repeated here to avoid drift between two copies.

**No route handler and no server action** — this is a read-only Server Component page's data layer per
the Phase 3 design; `searchTransactions()`/`searchBudgetLines()` are called directly from
`page.tsx`, not through `/api/*`.

**Auth/permission contract for the caller (ux-developer, page.tsx):** neither function checks
`FEATURES` internally — matching every other query module in this codebase (permission checks live at
the route/page layer, not the data-access layer). The page must:
1. Gate the route itself with `hasAnyFeature(session.user.id, [FEATURES.LEDGER_VIEW, FEATURES.BUDGET_VIEW])`.
2. Independently check `hasFeature(session.user.id, FEATURES.LEDGER_VIEW)` before calling
   `searchTransactions()` **at all**, and `hasFeature(session.user.id, FEATURES.BUDGET_VIEW)` before
   calling `searchBudgetLines()` **at all** — never fetch-then-hide. This is Phase 3 design's
   Permissions section, section-level gate, and is also Phase 3's named unit test #4 — write it in
   `page.tsx` (or as an integration test at the page-body level, implementer's call on harness), not in
   this query module, per the design's own Implementation Order.

**Modified files:**
- `src/lib/fiscal-year.ts` — added exported `fyBounds(fy: number): { start: string; end: string }`.
- `src/lib/ledger-queries.ts` — removed the private `fyBounds()`; now imports the relocated one from
  `@/lib/fiscal-year`. Zero behavior change; all 7 existing call sites unaffected.
- `src/lib/ledger.ts` — added exported `escapeIlikeTerm(term: string): string`.
- `src/lib/ledger.test.ts` — added `escapeIlikeTerm` to the import list and a new `describe` block
  (6 tests).

**New test file:** `src/lib/ledger-search-queries.test.ts` (16 tests across 8 `describe` blocks).

**Schema changes:** none. No migration file.

### Open questions / handoff notes

**Next agent: ux-developer**, for Phase 4 steps 3–4 per the Phase 3 Implementation Order:

- Build `src/app/(dashboard)/admin/ledger/search/page.tsx` (page-level + section-level permission
  gates — see the Auth/permission contract above and named unit test #4), `searchParams` parsing per
  the URL/State Contract table, dollars→cents conversion for amount filters before calling
  `searchTransactions()`/`searchBudgetLines()`, entity/fund slug resolution.
- Build the five new components: `ledger-search-box.tsx`, `search-filters.tsx`,
  `search-results-transactions.tsx`, `search-results-budget-lines.tsx`, `row-highlighter.tsx`.
- Mount `<LedgerSearchBox>` on `ledger-dashboard.tsx`.
- Retrofit `?highlight=<id>` into `[fundSlug]/page.tsx` and
  `budget-cause-editor.tsx`/`budget-fund-editor.tsx`/`budgeting/[fundSlug]/page.tsx` per the Phase 3
  design's `?highlight=<id>` Contract section (scroll-and-flash only, no auto-open).
- One thing worth double-checking on your side: I mapped `flow`/`status` off `text` columns with an
  `as` cast rather than a runtime-validated narrowing (matches existing codebase convention at
  `listTransactionsForExport()`) — if a future migration ever adds a new `status` value at the DB
  level without updating the `LedgerSearchFilters`/`TransactionSearchRow` union, the cast will silently
  mistype it rather than throwing. Not a new risk this feature introduces (same pattern exists
  elsewhere already), just flagging since search is a new consumer.
- `SEARCH_PAGE_SIZE` is exported from `ledger-search-queries.ts` — reuse it for the "Showing N of
  Total" copy and pagination math rather than hardcoding `50` a second time in the page/components.
- Release notes entry and the 7-day retrospective/30-day reviews are unaffected by this phase; no
  action needed there yet.

---

# Phase 4 — Implementation (UI) — 2026-08-06

**Owner:** ux-developer
**Status:** complete

### Summary

Built the client/UI half of Ledger & Budget Search on top of api-developer's `ledger-search-queries.ts`
contract, exactly per the Phase 3 design: a new `/admin/ledger/search` Server Component page,
zero-JS quick-search box mounted on the existing `/admin/ledger` dashboard, the one genuine `'use client'`
advanced filter panel, two heterogeneous result-row renderers (never-netted subtotals split by flow, per
DECISION-063), and a shared `RowHighlighter` client component retrofitted into the register
(`[fundSlug]/page.tsx`) and the budgeting drill-down (`budgeting/[fundSlug]/page.tsx`) for the
`?highlight=<id>` scroll-and-flash deep link (no auto-open, per Phase 3's explicit call). Page-level gate
is `hasAnyFeature([LEDGER_VIEW, BUDGET_VIEW])`, independent of the dashboard's own gate; section-level
gates decide whether `searchTransactions()`/`searchBudgetLines()` are ever called at all (never
fetch-then-hide) — covered by the Phase 3-named test 4, written here. `pnpm exec tsc --noEmit`,
`pnpm test` (922/922 — 917 baseline + 5 new), and `pnpm build:only` are all green — see Gate Results.

### What I did

- Read the full work-log (Phase 1 analyst, Treasurer Decisions, Phase 2 architect, Phase 3 tech-lead
  design, Phase 4 API handoff notes) plus DECISION-062 and DECISION-063 before writing any code.
- Read the API contract directly off `src/lib/ledger-search-queries.ts` (not just the design doc's
  sketch) to confirm the shipped `searchTransactions()`/`searchBudgetLines()` signatures, result shapes,
  and the flow-split subtotal fields matched exactly what api-developer's Phase 4 section described —
  they did, no drift.
- Read the reuse targets before building anything: `[fundSlug]/page.tsx` (register table +
  `overflow-x-auto` wrapper convention, `flowBadgeClass`/`flowLabel`/`statusBadge` helpers),
  `sync-log/page.tsx` (`Promise.all([rows, [{count}]])` + `pageUrl()` pagination pattern),
  `budgeting/[fundSlug]/page.tsx` + `budget-fund-editor.tsx` + `budget-cause-editor.tsx` (cause-line
  editor's dead/live row branches and `serverBreakdown` gating), `ledger-dashboard.tsx`,
  `fiscal-year-selector.tsx` (the codebase's one existing client filter-control precedent),
  `load-error-card.tsx`, and `permissions.ts`/`permissions-server.ts`.
- **New components** (`src/components/admin/ledger/`):
  - `ledger-search-box.tsx` — plain `<form method="GET" action="/admin/ledger/search">`, zero JS,
    `defaultValue` prop so it can be reused atop the results page itself (Treasurer Decision 1) as well
    as the dashboard.
  - `search-filters.tsx` — the one `'use client'` component. ~10 filter axes (FY, entity, fund, category,
    cause, bank account, amount min/max, date from/to, status) held in local state seeded from the
    current URL, built into a single fresh `URLSearchParams` on submit (every field, not a diff, so
    tweaking one filter never drops `q`), one `router.push`. Changing entity clears any
    fund/category/bank-account selection scoped to the previous entity. A filter-change submission
    omits `txnPage`/`budgetPage` entirely, resetting both to page 1. "Clear all" is a plain
    `router.push("/admin/ledger/search")`.
  - `search-results-transactions.tsx` / `search-results-budget-lines.tsx` — server components, two
    separate row renderers per the design (different columns, different link destinations). No Actions
    column — every row is one clickable/keyboard-focusable target via a single stretched `<Link
    className="absolute inset-0">` inside the row's first `<td>` (the `<tr>` positioned `relative`) —
    an accessible "clickable row" pattern that keeps one tab stop per row rather than one per cell.
    Reuses the register's exact `overflow-hidden rounded-2xl border ... overflow-x-auto` table wrapper
    (confirmed by reading `[fundSlug]/page.tsx` directly, per the brief's correction — not a card layout).
    Duplicated `flowBadgeClass`/`flowLabel`/`statusBadge`/`formatDollars` (~20 lines) rather than
    cross-importing from the page, per the design's own "low-stakes either way" call. Both sections
    render subtotals ("Income: +$X · Expenses: -$Y", green for income) and "Showing N–M of Total" +
    Previous/Next `<a href>` pagination (zero JS), each independently keyed off `txnPage`/`budgetPage`.
    The budget-lines section renders the "Bank account, date range, and status filters don't apply to
    budget lines" note whenever any of those three params is set (Filter Semantics rule 1, DECISION-063
    item 2) and strikes through `pendingDeleteAt` rows with a "Pending removal" badge, reusing
    `budget-cause-editor.tsx`'s dead-row visual language.
  - `row-highlighter.tsx` — shared client component, renders `null`. On mount, looks up
    `${idPrefix}${targetId}` in the DOM; if found, `scrollIntoView({behavior:"smooth",block:"center"})`
    + a temporary `ring-2 ring-lions-gold bg-lions-gold/10` class removed after 2.5s (gold accent per
    CLAUDE.md's badge/highlight guidance, never a card border); if not found, silent no-op. Either way,
    strips `highlight` from the URL via `router.replace(..., {scroll:false})` so a manual refresh never
    re-triggers it. One component, reused on both destination pages (register + budgeting drill-down)
    via an `idPrefix: "txn-" | "budget-line-"` prop, per the design's own "reasonable to write once"
    suggestion.
- **New route:** `src/app/(dashboard)/admin/ledger/search/page.tsx` — Server Component,
  `export const dynamic = "force-dynamic"`. Page-level gate
  `hasAnyFeature(session.user.id, [LEDGER_VIEW, BUDGET_VIEW])`, independent of the dashboard's own gate
  (a hypothetical budget-only role can reach this page directly). Section-level `canViewTxns`/
  `canViewBudget` booleans gate whether `searchTransactions()`/`searchBudgetLines()` are called AT ALL —
  implemented as `canViewTxns ? searchTransactions(...) : Promise.resolve(null)` inside the `Promise.all`,
  so an ungated caller's query function is never invoked (not merely fetched-then-discarded) — this is
  what named unit test 4 verifies via mock call counts. Parses every `searchParams` field per the URL/
  State Contract table: `fy="all"` → `fiscalYear: null`; entity/fund resolved against `getEntities()`/
  `getFunds()` server-side (fund only honored when entity also resolves, matching the register's own
  `validSlugs` pattern); `cause` validated against `[...BUDGET_CAUSES, OTHER_COMMUNITY_SUPPORT_CAUSE]`;
  `status` validated against the three literal values; amount fields parsed dollars→cents in the page
  (never crossing that boundary as dollars, per the design); `txnPage`/`budgetPage` independent, default
  1. Filter-panel dropdown options (funds/categories/bank accounts/fiscal years) fetched for EVERY entity
  via `Promise.all(entities.map(...))`, labeled with the entity's short name only when no entity filter
  is active yet. Pagination hrefs preserve every raw query param verbatim except the one page number
  being overridden (`buildResultUrl()`, generalizing `sync-log/page.tsx`'s `pageUrl()` to two independent
  page params). "Both sections empty" full-page empty state only fires when BOTH sections are permission-
  viewable AND both report `totalCount === 0`; a single-permission viewer's one section handles its own
  zero-count empty state internally (Filter Semantics rule 2: a missing section never appears at all —
  no header, no zero count — only a *viewable-but-empty* section renders its own inline empty block).
  Wrapped `getEntities()`, the per-entity filter-option fetch, and the two search calls in separate
  try/catch blocks, each falling back to `<LoadErrorCard backHref="/admin/ledger" />`, matching the
  granular error-boundary convention already used by `budgeting/[fundSlug]/page.tsx`.
- **Mounted `<LedgerSearchBox>`** on `ledger-dashboard.tsx`, between the header and the entity cards,
  inside a `bg-white rounded-2xl shadow-sm overflow-hidden p-4` card. Degrades automatically with the
  rest of the dashboard: it only renders inside `LedgerDashboard`'s success branch, so a `getDashboard()`
  throw still falls back to `LoadErrorCard` and the box simply doesn't appear — no separate handling
  needed (Phase 1 Flow 0's stated failure behavior was already satisfied by this placement).
- **Highlight retrofit:**
  - `[fundSlug]/page.tsx` — added `highlight?: string` to the `searchParams` type, destructured it,
    mounted `<RowHighlighter targetId={highlightParam} idPrefix="txn-" />` once near the top of the
    page, added `id={`txn-${txn.id}`}` to every `<tr key={txn.id}>`.
  - `budgeting/[fundSlug]/page.tsx` — same shape: `highlight?: string` param, mounted
    `<RowHighlighter targetId={highlightParam} idPrefix="budget-line-" />` once near the top of the page.
  - `budget-cause-editor.tsx` — added `id={row.id ? `budget-line-${row.id}` : undefined}` to BOTH the
    dead-row branch (~line 1200) and the live-row branch (~line 1247), plus `rounded-lg` on the live
    branch's wrapper (previously bare `space-y-1`) so the gold ring has somewhere sensible to render —
    the dead branch already had `rounded-lg`. A never-saved row (`id === null`) simply gets no `id`
    attribute, which is correct: there's nothing a search result could ever link to for it.
- **Deliberately did NOT thread a `highlightLineId?` prop through `BudgetFundEditor` →
  `BudgetCauseEditor`** — see Deviations below.
- Wrote the Phase 4 unit test named in the Phase 3 design and assigned to ux-developer's half (test 4,
  page-level/section-level permission gating):
  `src/app/(dashboard)/admin/ledger/search/page.test.ts` — calls the page's default export directly
  (same technique this codebase's `route.test.ts` files already use for route handlers), mocking
  `next/navigation`, `@/lib/auth`, `@/lib/permissions-server`, `@/lib/ledger-queries`, and
  `@/lib/ledger-search-queries`. Five tests: both permissions (both search fns called once each),
  `LEDGER_VIEW`-only (`searchBudgetLines` never called), `BUDGET_VIEW`-only (`searchTransactions` never
  called), neither permission (page-level gate redirects to `/access-pending` before either query runs,
  asserted via a `redirect()` mock that throws), and no session (redirects to `/signin` before any
  permission check). All assert via mock call counts, never rendering the returned JSX tree — a
  Server Component's async function body executes fully on invocation; nested `<SearchResultsTransactions
  .../>` elements are only `React.createElement` calls at that point, never actually executed, so the
  test never needs to render them or mock their own imports beyond what static import resolution
  requires (`SEARCH_PAGE_SIZE` included in the `ledger-search-queries` mock for that reason).
- Ran `pnpm exec tsc --noEmit` (clean), `pnpm test` (922/922 across 37 test files — the 5 new page-level
  gating tests, zero regressions against api-developer's 917 baseline), and `pnpm build:only` (exit 0,
  `/admin/ledger/search` present in the route manifest as a dynamic route, no errors/warnings).
  Grepped every new/modified production file for `console.*` — none present. No native browser dialogs
  anywhere in this feature (read/navigate-only, as scoped). No new npm dependency.

### Deviations from the design

- **Did not thread a `highlightLineId?` prop through `BudgetFundEditor` → `BudgetCauseEditor`**, though
  the design's "Files to modify" list names it. Traced why the design wanted it and concluded it isn't
  load-bearing: (1) the DOM `id={`budget-line-${row.id}`}` attribute only needs `row.id`, which
  `BudgetCauseEditor` already has locally — no prop required to attach it; (2) `RowHighlighter` is
  mounted ONCE at the `budgeting/[fundSlug]/page.tsx` level (matching the register's pattern) and finds
  its target via a page-wide `document.getElementById()`, which works regardless of which
  `BudgetCauseEditor` instance rendered the matching row — DOM ids are unique across the whole page, not
  scoped per-component. Threading the id through two extra prop layers just to pass it to a component
  that would do nothing with it beyond what it already does would be a no-op indirection. Documented
  this reasoning inline as a code comment on the page-level `<RowHighlighter>` mount. Functionally
  identical outcome to the design's literal instruction, one file smaller. Confirmed no other Phase 3
  requirement depended on `BudgetCauseEditor` itself knowing the highlight id (Phase 3's own text frames
  the threading as enabling "only the one instance whose rows actually contains it will find a DOM
  match," which is exactly what the page-level `RowHighlighter` + `row.id`-only id attribute already
  achieves without the extra prop).
- Everything else in the Phase 3 design was buildable exactly as specified — component boundaries, the
  clickable-row pattern (my own call, not explicitly specified in the design beyond "every row is itself
  a `<Link>`"), the two-tier empty-state policy, the transaction-only-filter inline note on the
  budget-lines section, and the `?highlight=` scroll-and-flash-only contract.

### Gate Results

- `pnpm exec tsc --noEmit`: **PASS** (clean, no output).
- `pnpm test`: **PASS** (922/922, 37 test files — 917 baseline + 5 new in `page.test.ts`, zero
  regressions).
- `pnpm build:only`: **PASS** (exit code 0; `/admin/ledger/search` present in the production route
  manifest as a dynamic route; no errors or warnings in the log).
- No `console.log`/`console.*` in any new or modified production file.
- No native browser dialogs (`alert`/`confirm`/`prompt`) — this feature is read/navigate-only.
- No new npm dependency added.
- No schema change, no new migration (confirmed — this phase touched zero files under `drizzle/` or
  `src/lib/db/schema.ts`).
- Did not write to any database, did not touch anything under `scripts/`, did not commit or push.

### Outputs

**New files:**
- `src/app/(dashboard)/admin/ledger/search/page.tsx` — the search route.
- `src/app/(dashboard)/admin/ledger/search/page.test.ts` — Phase 3-named test 4 (5 tests).
- `src/components/admin/ledger/ledger-search-box.tsx`
- `src/components/admin/ledger/search-filters.tsx`
- `src/components/admin/ledger/search-results-transactions.tsx`
- `src/components/admin/ledger/search-results-budget-lines.tsx`
- `src/components/admin/ledger/row-highlighter.tsx`

**Modified files:**
- `src/components/admin/ledger/ledger-dashboard.tsx` — mounted `<LedgerSearchBox>`.
- `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx` — `highlight` param, `<RowHighlighter>`,
  `id="txn-<id>"` on each row.
- `src/app/(dashboard)/admin/ledger/budgeting/[fundSlug]/page.tsx` — `highlight` param,
  `<RowHighlighter>`.
- `src/components/admin/ledger/budget-cause-editor.tsx` — `id="budget-line-<id>"` on both row branches,
  `rounded-lg` added to the live-row wrapper.

### Open questions / handoff notes

**Next agent: qa**, for Phase 5. Things worth clicking through in the browser:

- `/admin/ledger` (as a treasurer/board_member/admin/budget_committee user) → the new quick-search box
  renders between the header and the entity cards → typing a term and hitting Enter/Search navigates to
  `/admin/ledger/search?q=<term>` with zero page reload flicker beyond the normal navigation.
- On `/admin/ledger/search`: try a term with matches on both sides (e.g. a cause used in both a
  transaction's `beneficiaryCause` and a budget line's `cause`) → both section headers show correct
  counts and flow-split subtotals that don't change between page 1 and page 2 of a >50-row match set.
- Try a term matching nothing → the single full-page empty state (only when both sections are viewable).
- As a role with only `ledger.view` or only `budget.view` (if one exists/can be simulated) → confirm the
  other section's header is entirely absent, not present-with-zero.
- Advanced filters: change FY/entity/fund/category/cause/amount/date/status, confirm the URL updates and
  results re-scope; confirm switching entity clears fund/category/bank-account; confirm the budget-lines
  section shows the "doesn't apply" note when a bank-account/date/status filter is set.
- Click a transaction result → lands on the register at the correct fund+FY, scrolls to and gold-flashes
  the row, URL loses `?highlight=` after ~instant strip, a manual refresh doesn't re-flash.
- Click a budget-line result → lands on the budgeting drill-down at the correct fund+FY, scrolls to and
  flashes the cause line (including a pending-delete/struck-through line, if one can be found/created).
- Mobile at 360px: confirm both result tables scroll horizontally inside their bounded containers rather
  than overflowing the page, matching the register's existing behavior.
- Pagination: Previous/Next links on both sections independently, confirm `txnPage`/`budgetPage` don't
  interfere with each other and that changing a filter resets both to page 1.

New copy strings the Lions Club may want to refine: "Search transactions and budget lines… e.g. WARM"
(placeholder), "Advanced filters" (panel heading), the two empty-state messages ("No transactions or
budget lines match…" / per-section "No transactions match…" / "No budget lines match…"), "Bank account,
date range, and status filters don't apply to budget lines — showing matches across all of those."

UX decisions/tradeoffs made beyond the letter of the design (flagged for qa/analyst awareness, not
blocking):
- The "every row is itself a `<Link>`" requirement was implemented as a single stretched `<Link
  className="absolute inset-0">` inside each row's first cell (the `<tr>` positioned `relative`) rather
  than wrapping every cell individually — one focusable stop per row, standard accessible "clickable
  table row" pattern, not explicitly specified in the design.
- Did not thread `highlightLineId?` through `BudgetFundEditor`/`BudgetCauseEditor` — see Deviations
  above.

---

# Phase 5 — Verification (qa) — 2026-08-06

**Owner:** qa
**Status:** complete

### Summary

**PASS.** Independently re-verified both Phase 4 halves against the work-log, DECISION-062/063, and
the shipped code (not just the implementers' self-reports). Typecheck, unit tests (933/933 — the
922-baseline plus 11 gap-fill tests I added, zero regressions), and production build are all clean;
`/admin/ledger/search` is present in the route manifest. Drove a real Playwright click-through (12 new
tests in `e2e/ledger-search.spec.ts`) against the running dev server and the actual dev-branch data —
every flow in the implementer's handoff checklist that's reachable with real data passed on the first
run: grouped counts, flow-split subtotals invariant across pages, current-FY default + "All years",
the transaction-only-filter inline note on Budget lines (count unchanged, never zeroed), `%`/`_`
literal-text handling, empty-state copy naming the term, the `?highlight=` scroll-and-flash-and-strip
contract on both the register and the budgeting drill-down (including a real pending-delete line), the
graceful degrade for a missing highlight target, no stale highlight on refresh, and 360px mobile
(table scrolls inside its own container, page body does not). Ran the full e2e suite and confirmed
exactly one *new* failure beyond the five pre-existing failures I was told about
(`admin-security.spec.ts`) — traced it to a real, pre-existing bug on `main` itself (confirmed via
`git stash` + clean-tree re-run), unrelated to this feature, so it does not block this verdict. Feature-gate
audit below confirms the page-level `hasAnyFeature([LEDGER_VIEW, BUDGET_VIEW])` gate, the section-level
never-fetch-then-hide gates, and the correct `FEATURES.*` keys are all present exactly as designed.

### What I did

- Read the full work-log (Phase 1 analyst, Treasurer Decisions, Phase 2 architect, Phase 3 tech-lead
  design, both Phase 4 sections) and DECISION-062/063 before touching anything.
- Read the shipped code directly (not just the implementers' summaries):
  `src/app/(dashboard)/admin/ledger/search/page.tsx`, `src/lib/ledger-search-queries.ts`,
  `search-results-transactions.tsx`, `search-results-budget-lines.tsx`, `row-highlighter.tsx`,
  `ledger-search-box.tsx`, `search-filters.tsx`, and the mount point in `ledger-dashboard.tsx` —
  confirmed each matches the Phase 3 design and the implementers' own Phase 4 descriptions with no
  drift.
- **Type check:** `pnpm exec tsc --noEmit` — clean, no output.
- **Unit tests:** `pnpm test` — 922/922 baseline confirmed first (matching the stated baseline exactly),
  then re-confirmed 933/933 after my own additions below, zero regressions either time.
- **Coverage audit on the new module** (`pnpm exec vitest run --coverage --coverage.include='src/lib/ledger-search-queries.ts'`):
  found the 8 Phase-3-named tests left every *individual* scalar structured filter
  (`entityId`/`fundId`/`categoryId`/`cause`/`bankAccountId`/`dateFrom`/`dateTo`/`status` on
  `searchTransactions`; `fundId`/`categoryId`/`cause` on `searchBudgetLines`; the `amountMaxCents`-only
  branch) at 0% — each is a satisfied-incidentally-but-never-directly-asserted one-line `if` branch. A
  typo swapping which column a filter binds to (e.g. `dateFrom` writing `<=` instead of `>=`, or
  `fundId` accidentally filtering `entityId`) would have shipped silently. **Added 11 regression tests**
  to `src/lib/ledger-search-queries.test.ts` (new describe block "individual structured filters wire the
  correct column + operator (QA gap-fill)") asserting the exact column name and operator each filter
  produces via the file's own established `PgDialect().sqlToQuery()` inspection technique. Statement
  coverage on `ledger-search-queries.ts` went from 81.53% to **100%** (branch coverage 65.38% → 88.46%).
  Re-ran `pnpm exec tsc --noEmit` and `pnpm test` after adding these — both clean.
- **Production build:** `pnpm build:only` — `✓ Compiled successfully`, TypeScript pass inside the build
  clean, `/admin/ledger/search` present in the printed route manifest as a dynamic (`ƒ`) route, no
  warnings, no dropped routes. Re-ran once more after the test additions to confirm no regression —
  identical result.
- **Dev-server smoke test:** started `pnpm dev` myself (`.env.local`, dev Neon branch, confirmed
  `DATABASE_URL` ≠ `PROD_DATABASE_URL` before touching anything) — Next.js came up clean on port 3001
  (port 3000 already held by a long-running unrelated `next-server` process I did not touch).
- **Manual click-through, automated:** wrote `e2e/ledger-search.spec.ts` (12 tests) and ran it against
  the live dev server + real dev-DB data (281 real transactions, 34 real budget lines, plus known dirty
  FY2095-2099 sentinel rows from other suites' interrupted runs — treated as ambient, not created or
  cleaned up by this suite, per the same convention `budgeting-restructure.spec.ts` documents). All 12
  passed on the first run, both standalone and inside the full suite. Queried the dev DB directly
  (read-only `psql` `SELECT`s) first to find real search terms with matches on both sides ("Vision" —
  matches `beneficiary_cause` on transactions and `cause` on budget lines) and to confirm current-FY
  (2026) has zero posted transactions/budget lines yet in the real books, which made the "FY defaults to
  current FY" empty-state check a legitimate live scenario rather than a fabricated one.
  - Confirmed live: quick-search box → `/admin/ledger/search?q=…`; grouped Transactions/Budget lines
    headers with counts; flow-split (never-netted) subtotals; subtotal text byte-identical between page
    1 and page 2 of a 281-row browse-mode result (`Showing 1–50` vs `Showing 51–100`, pagination
    genuinely reachable with real data); FY defaults to current FY (real empty state, not fabricated)
    and "All years" reveals real historical matches; the bank-account (transaction-only) filter is noted
    on the Budget lines section with the count *unchanged*, not zeroed; `q=%` and `q=_` both return zero
    matches (proof they're treated as literal text, not a wildcard — no real row contains those
    characters, so an unescaped bug would have matched most/all of 281+34 rows instead); empty-state
    copy names the actual term; clicking a transaction result lands on the register and the `highlight`
    param disappears from the URL within the effect's window; clicking a real pending-delete budget line
    (a leftover `FY2099`/"E2E QA Env Two" row from `budgeting-restructure.spec.ts`, cause "Environment")
    renders struck-through with a "Pending removal" badge *in the search results themselves*, and lands
    on the budgeting drill-down with `highlight` stripped; a well-formed but nonexistent `highlight` id
    degrades silently (page renders normally, no crash, no error text); a stale `highlight` does not
    re-trigger after a manual refresh of the already-stripped URL; at 360px the document has no
    horizontal overflow while the table's own `.overflow-x-auto` wrapper does (real inner scroll).
  - **Not exercised live: a real single-permission (`ledger.view`-only or `budget.view`-only) account.**
    Every seeded role that holds `budget.view` also holds `ledger.view` by construction (Phase 1's own
    "Permissions" section — `admin`, `treasurer`, `board_member`, `budget_committee` all bundle both),
    so there is no natural account to sign in as without hand-crafting a throwaway role in the dev DB.
    I judged that not worth the setup/cleanup cost given `page.test.ts`'s 5 tests already prove the
    exact mechanism — including "the other query function is never called," not merely "its result is
    hidden" — via mock call-count assertions, which is a strictly stronger guarantee than anything
    observable from the rendered DOM. Read `page.test.ts` directly to confirm this (not just trusted the
    implementer's description): the 5 tests cover both/txns-only/budget-only/neither permission
    combinations plus no-session, and all assert on `searchTransactions`/`searchBudgetLines` call counts.
- **Full e2e suite comparison against the stated baseline:** ran the whole suite
  (`PLAYWRIGHT_BASE_URL=http://localhost:3001 pnpm exec dotenv -e .env.local -- npx playwright test`).
  Result: 6 failed, not the 5 named in my brief. The 5 named (`budget-star-notes`,
  `budgeting-restructure`, `cancel-occurrence`, `prior-year-cause-line-reconcile`,
  `transaction-budget-line-link`) failed as expected (dirty FY2095-2099 data, per the brief). The 6th —
  `admin-security.spec.ts` ("an authenticated admin can view the failed-login list and grouped views")
  — was **not** on the list, so I did not wave it through. Verified it wasn't a parallel-load flake
  (re-ran solo with `--workers=1`, same failure). Queried `failed_login_attempts` directly and confirmed
  the marker row *did* land in the DB (the fire-and-forget recorder worked), but the `/admin/security`
  list page didn't render it within the test's 10s window — a real bug in that page, unrelated to
  anything this feature touches (auth/login recording, not ledger/budget data). To rule out this feature
  as the cause, I `git stash`ed every uncommitted change for this feature (confirmed clean `git status`),
  restarted `pnpm dev` on the stashed (effectively `main`) tree, and re-ran the same test solo — **it
  failed identically on clean `main`.** This is a pre-existing bug, not a regression introduced by
  Ledger & Budget Search, and not one I was told about — flagging it as a new finding, not fixing it
  (out of scope for this verification; QA fixes/extends tests, not feature code). Restored the stash
  (`git stash pop`, confirmed all 10 feature files back), restarted `pnpm dev`, re-confirmed
  `pnpm test` still 933/933 after the round-trip.
- Stopped the dev server (port 3001) when finished. Did not touch the pre-existing, not-mine dev server
  already running on port 3000. Did not commit, did not push, did not touch anything under `scripts/`,
  never queried or wrote to `PROD_DATABASE_URL` (confirmed the env var name differs from `DATABASE_URL`
  before running any `psql` command).

### Outputs

- **New file:** `e2e/ledger-search.spec.ts` (12 Playwright tests) — the manual click-through, made
  reusable/repeatable rather than a one-off session.
- **Modified file:** `src/lib/ledger-search-queries.test.ts` — added the "individual structured filters
  wire the correct column + operator (QA gap-fill)" describe block (11 tests), closing the 0%-coverage
  gap on every previously-unasserted scalar filter branch.
- **New finding (not a work-log entry of its own yet):** `admin-security.spec.ts`'s "an authenticated
  admin can view the failed-login list and grouped views" test fails on clean `main`, independent of
  this feature — the failed-login row lands in `failed_login_attempts` but doesn't render on
  `/admin/security` within a reasonable window. Recommend a follow-up bug-fix work-log entry; not
  investigated further here since it's unrelated to Ledger & Budget Search.

### Type Check

`pnpm exec tsc --noEmit`: **PASS** (clean, no output — both before and after my test additions).

### Unit Tests

`pnpm test`: **PASS**
Total: 933 | Passed: 933 | Failed: 0
Duration: ~1s (vitest transform/import included, ~6-7s wall)
Baseline confirmed at 922/922 first (matches the stated baseline exactly, zero drift from the
implementers' reported numbers), then 933/933 after adding 11 gap-fill tests of my own. No failures at
either checkpoint.

### Production Build

`pnpm build:only`: **PASS**
Notes: `✓ Compiled successfully`, TypeScript check inside the build clean, static generation
`(106/106)`. `/admin/ledger/search` present in the route manifest as a dynamic (`ƒ`) route, sitting
correctly alongside the other `/admin/ledger/*` subpages. No warnings, no routes silently dropped.
Re-ran after my test additions (test files aren't part of the Next.js build, but confirmed no
regression) — identical clean result.

### End-to-End Tests

`pnpm test:e2e` (run manually against a self-started `pnpm dev` on port 3001, `PLAYWRIGHT_BASE_URL`
override — the standard `test:e2e` script assumes port 3000, which was already held by an unrelated
long-running dev server I didn't start and didn't touch): 
Total: 81 | Passed: 44 | Failed: 6 | Skipped/did-not-run: 31 (cascading `test.describe.configure({mode:"serial"})` skips after each suite's first failure, per those suites' own existing convention)
Duration: 58s (full run), 16s (ledger-search.spec.ts alone)

Of the 6 failures:
- **5 are the pre-existing baseline** I was told about: `budget-star-notes.spec.ts`,
  `budgeting-restructure.spec.ts`, `cancel-occurrence.spec.ts`, `prior-year-cause-line-reconcile.spec.ts`,
  `transaction-budget-line-link.spec.ts` — all caused by dirty FY2095-2099 sentinel data left over from
  earlier interrupted runs, none touched by this feature. Not attributed to Ledger & Budget Search.
- **1 is new to me but NOT new to `main`:** `admin-security.spec.ts` — confirmed via `git stash` +
  clean-tree re-run that this fails identically without any of this feature's changes present. A
  real, pre-existing bug, unrelated to ledger/budget code. Not attributed to Ledger & Budget Search.
- **My own new suite, `e2e/ledger-search.spec.ts` (12 tests): all 12 passed**, both standalone and
  inside the full-suite run.

**Net: zero new e2e failures caused by this feature.**

### Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| Quick-search box on `/admin/ledger` → `/admin/ledger/search?q=…` | pass | Zero-JS GET form confirmed; query lands in the URL from the first submit. |
| Results grouped into Transactions / Budget lines, each with its own count | pass | Both headers render with live counts against real data. |
| Subtotals split by flow (never netted), computed across ALL matches | pass | Verified against a 281-row browse-mode result; subtotal text byte-identical page 1 vs page 2. |
| FY filter defaults to current FY; "All years" works | pass | Current FY (2026) genuinely has zero real transactions/budget lines yet — legitimate live empty state, not fabricated. "All years" revealed real historical matches. |
| Transaction-only filters noted (not zeroed) on Budget lines | pass | Bank-account filter applied; inline note appeared; Budget lines count was byte-identical to the unfiltered control. |
| `?highlight=<id>` scroll-and-flash on register | pass | Landed on the register at the correct fund+FY; `highlight` param stripped from the URL within the effect's window. |
| `?highlight=<id>` scroll-and-flash on budgeting drill-down, incl. a pending-delete line | pass | Used a real pending-delete row (FY2099 sentinel data); search itself rendered it struck-through with "Pending removal"; landed on the drill-down with `highlight` stripped. |
| Highlight id not on the current page degrades gracefully | pass | Nonexistent txn id — page rendered normally, no crash, no error banner. |
| Stale highlight does not persist on refresh | pass | Reload of the already-stripped URL did not re-trigger the flash. |
| `%` / `_` treated as literal text, not a wildcard | pass | Both returned zero matches against 281+34 real rows — proves escaping is wired end-to-end, not just unit-tested in isolation. |
| Empty-state wording names the search term | pass | Exact copy match, including the "broaden your search" hint. |
| 360px mobile — table scrolls, page body doesn't | pass | `document.documentElement.scrollWidth` ≤ viewport width; table's `.overflow-x-auto` wrapper `scrollWidth > clientWidth`. |
| Permission gating: `ledger.view`-only / `budget.view`-only sees only its own section | verified via code + `page.test.ts` (5 mock-call-count tests), not live | No natural single-permission seeded account exists (every role bundling `budget.view` also holds `ledger.view`, by design). The unit test proves the query function is never *called*, which is a stronger guarantee than anything observable in a rendered page. |

### Regression Tests Added

- `individual structured filters wire the correct column + operator (QA gap-fill)` — `src/lib/ledger-search-queries.test.ts:~356` (11 tests) — guards against: a filter silently binding to the wrong
  column or operator (e.g. `dateFrom`/`dateTo` swapped, `fundId` filtering `entityId`, `amountMaxCents`
  alone producing `>=` instead of `<=`) — none of the Phase 3-named tests directly asserted these,
  leaving every individual scalar filter branch at 0% coverage.
- `e2e/ledger-search.spec.ts` (12 tests) — not a bug-driven regression suite (no bug was found in the
  feature itself), but a durable, re-runnable version of this Phase 5 manual click-through so the next
  person who touches this page doesn't have to re-derive the checklist by hand.

### Coverage on Critical Modules

- `src/lib/ledger-search-queries.ts` (new this feature): **100% statements, 88.46% branches, 100%
  functions** (was 81.53%/65.38%/100% before my gap-fill tests).
- `src/lib/ledger.ts` (`escapeIlikeTerm` addition): **100% statements, 96.3% branches, 100% functions.**
- `src/app/(dashboard)/admin/ledger/search/page.tsx`: not separately measured by the v8 coverage
  reporter (parenthesized route-group path didn't resolve cleanly through the coverage `--include`
  glob) — its permission-gating logic, the part that matters most, is directly proven by
  `page.test.ts`'s 5 tests (read and confirmed substantive, not stubs) and independently exercised live
  by the e2e suite's every-flow click-through.
- The three modules with standing CLAUDE.md coverage targets (`events.ts`, `permissions.ts`,
  `members.ts`) are untouched by this feature — no drift to report against their targets this cycle.

### Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `GET /admin/ledger/search` (page-level) | yes — `const session = await auth(); if (!session?.user?.id) redirect("/signin")` | yes — `hasAnyFeature(session.user.id, [FEATURES.LEDGER_VIEW, FEATURES.BUDGET_VIEW])`, redirects to `/access-pending` if false | yes — either read key is sufficient to reach the page (read-only feature, correctly scoped to the two read permissions that own the two data types it exposes) |
| `searchTransactions()` invocation (section-level) | n/a (called from the already-`auth()`'d page) | yes — `hasFeature(session.user.id, FEATURES.LEDGER_VIEW)` gates whether the function is called AT ALL (`canViewTxns ? searchTransactions(...) : Promise.resolve(null)`), not fetch-then-hide | yes — `FEATURES.LEDGER_VIEW`, correct for transaction data |
| `searchBudgetLines()` invocation (section-level) | n/a (same page) | yes — `hasFeature(session.user.id, FEATURES.BUDGET_VIEW)` gates whether the function is called AT ALL, same never-fetch-then-hide pattern | yes — `FEATURES.BUDGET_VIEW`, correct for budget data |

Verified by reading `src/app/(dashboard)/admin/ledger/search/page.tsx` directly (lines 81-99, 196-207),
not by inferring it from passing tests — confirmed the page-level gate is independent of the
`/admin/ledger` dashboard's own `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` gate (so a
hypothetical budget-only role can reach the search page directly, per Phase 2's residual-risk note),
and confirmed the section-level gates use a ternary that skips the call entirely rather than calling
and discarding the result. `page.test.ts`'s 5 tests assert this exact behavior via mock call counts.
No route handlers or server actions were added by this feature — it's a read-only Server Component page
calling query functions directly, per the Phase 3 design's own framing; there is nothing under
`/api/admin/*` to audit for this feature.

### Verdict

**PASS**

---

# Phase 6 — Shipped vs Intent (analyst) — 2026-08-06

**Owner:** analyst
**Status:** complete

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> A treasurer can now type "WARM" once and get a genuinely organized, permission-correct, mobile-safe view of every itemized budget line and transaction that matches it, with working FY/category/cause/entity/fund filters — but "click into the details" lands one click short of an actual detail view, and — the one that matters most — a treasurer searching a lump-sum-budgeted cause (e.g. "Rudolph Run," "Scholarships") gets transactions with zero budget-line results and no on-screen explanation that the omission is structural, not "not yet spent."

## What I Did

Read the full work-log top to bottom (Phase 1 through Phase 5, DECISION-062/063), then read the shipped
code directly rather than trusting the implementers'/QA's self-reports: `src/lib/ledger-search-queries.ts`,
`src/app/(dashboard)/admin/ledger/search/page.tsx`, `ledger-search-box.tsx`, `search-filters.tsx`,
`search-results-transactions.tsx`, `search-results-budget-lines.tsx`, `row-highlighter.tsx`, the
`?highlight=` retrofits in `[fundSlug]/page.tsx` and `budgeting/[fundSlug]/page.tsx`, the `id="budget-line-<id>"`
retrofit in `budget-cause-editor.tsx`, the dashboard mount in `ledger-dashboard.tsx`, and the `ledgerBudgets`/
`ledgerBudgetLines` schema shape in `src/lib/db/schema.ts` to independently confirm the lump-sum-exclusion
claim rather than take Phase 2/3's framing on faith. Walked every flow from my own Phase 1 review against
what's actually rendered/queried.

## What's Working

- **The core "one box, two grouped answers" promise is real and well-built.** `/admin/ledger` now has a
  zero-JS quick-search box (`ledger-dashboard.tsx:61-63`) that submits straight to `/admin/ledger/search?q=…`
  — the treasurer's own follow-up ("search from a treasurer dashboard") is satisfied without inventing a
  second dashboard, exactly as I recommended in Phase 1 Flow 0.
- **The advanced filter panel is genuinely usable, not decorative.** FY (with a sane current-FY default and
  a one-click "All years"), entity, fund, category, cause, bank account, amount (exact-or-range), date range,
  and status are all real, DB-backed dropdowns/inputs (`search-filters.tsx`) that round-trip through the URL
  — bookmarkable, back-button-safe, and correctly reset dependent dropdowns when entity changes. This is a
  materially more capable filter set than "the six ledger pages" the treasurer was juggling before.
- **Results are actually organized, not just listed.** Each section has its own count, its own
  income/expense-split subtotal computed across every match (verified in code: `count(*)`/`sum(...)` in the
  same aggregate query, never per-page), its own "Showing N–M of Total" + pagination, and redundant
  columns (Entity, FY) are conditionally hidden once a filter already scopes them — a genuinely more
  organized read than the fund-by-fund register or budgeting pages the treasurer had to open one at a time.
- **Permission gating is correct and non-leaky.** Page-level `hasAnyFeature([LEDGER_VIEW, BUDGET_VIEW])` is
  independent of the dashboard's own gate (confirmed in `page.tsx:89-90`); section-level gates use a ternary
  (`canViewTxns ? searchTransactions(...) : Promise.resolve(null)`) that skips the query call entirely, not
  fetch-then-hide (confirmed `page.tsx:199-202`) — this is exactly the residual-risk fix I flagged in Phase 1
  Permissions, built correctly.
- **Reconciliation-adjacent honesty.** Pending/rejected transactions and pending-delete budget lines are
  included in results with the same status treatment their source pages already use, not hidden — matching
  my Phase 1 recommendation that a search tool that hides what's in the books is worse than useless.
- **`%`/`_` are literal text, not wildcards** — `escapeIlikeTerm()` is real and QA proved it end-to-end
  against live data, not just unit-tested in isolation.

## Intent-vs-Shipped Diff

- **Phase 1 said:** "search across all the relevant fields" needs an explicit field list per record type,
  since amount/date don't belong in a free-text pass. **Shipped:** transactions free-text matches `party`,
  `memo`, `beneficiaryCause`, `checkNumber` (4 fields); budget lines free-text matches `cause`, `label`,
  `note`, the parent budget's category name, and the parent budget's own `note` (5 fields). **Verdict:
  acceptable drift, with one real omission** — the budget-line side text-matches its category name
  (`ledgerCategories.name`) but the transaction side does **not** (confirmed by reading
  `buildTransactionConditions()` — its `or(...)` list is exactly `party`/`memo`/`beneficiaryCause`/
  `checkNumber`, no join to `ledgerCategories.name`). A treasurer typing a category name (e.g. "Dues") as a
  free-text term gets budget-line hits but may get zero transaction hits for spending correctly filed under
  that same category, unless the category name happens to also appear literally in a `party`/`memo` string.
  This is a genuine, if second-order, field-coverage gap the two sides don't share — see Follow-Ups.

- **Phase 1 said:** default the FY filter to current FY with an explicit "All years" escape, not silent
  all-years. **Shipped:** exactly this — `page.tsx` defaults `fiscalYear` to `currentFiscalYear()`, `fy=all`
  maps to `null` (omit condition), non-numeric/out-of-range values fall back to current FY. **Verdict: matches.**

- **Phase 1 said:** "search by category, cause" needs to be a real filter, not vestigial. **Shipped:** both
  are DB-backed dropdowns with exact-match `eq()` conditions on both query sides (category via FK id, cause
  via the shared `BUDGET_CAUSES`/`OTHER_COMMUNITY_SUPPORT_CAUSE` taxonomy). **Verdict: matches.**

- **Phase 1 said:** "filter to just one account" is ambiguous across entity/fund/bank-account, and the
  treasurer's word "accounts" almost certainly means fund/entity given every other ledger page filters at
  that level; bank account should be an additional transaction-only filter since budgets have no bank
  account. **Shipped:** exactly that shape — entity, fund, and a clearly-labeled "(transactions only)"
  bank-account filter, with an inline note on the Budget-lines section whenever a transaction-only filter is
  set ("Bank account, date range, and status filters don't apply to budget lines — showing matches across
  all of those," confirmed in `search-results-budget-lines.tsx:66-71`), never silently zeroing that section.
  **Verdict: matches the analyst's own recommended interpretation — but flag that this specific
  interpretation was never explicitly confirmed back to the treasurer.** The Treasurer Decisions section
  answers 1–4 in the treasurer's own voice; the "accounts" resolution is decision #6, one of three items
  explicitly marked "defaults taken by the coordinator... treasurer may still override," and I don't see
  a later phase closing that loop with an actual treasurer sign-off. The interpretation is sound, but it's
  worth a one-line confirmation with the treasurer now that it's live, not assumed closed.

- **Phase 1 said:** "results should be very organized" needs sort order, subtotals, and a pagination story
  named explicitly, or it'll be improvised. **Shipped:** txn-date-desc / cause-label-alphabetical sort,
  page-spanning subtotals split by flow (never netted — correctly avoids combining opposite-direction
  dollars), 50-per-group pagination with "Showing N–M of Total," and column omission when redundant.
  **Verdict: matches**, and the presentation is genuinely more organized than any single existing ledger
  page — this is the strongest-delivered clause of the whole request.

- **Phase 1 said:** "you should be able to click into the details" — I explicitly flagged in Phase 1 that
  neither destination page had a deep-link/highlight mechanism, and that landing on the right entity+FY page
  with the treasurer scanning for the row herself would be "a real regression from what was asked for, not a
  neutral simplification." Phase 3 then made an explicit, reasoned call to ship scroll-and-flash instead of
  auto-opening the edit dialog, with a fast-follow noted as self-contained. **Shipped:** clicking a result
  navigates to the correct fund+FY on the register or budgeting drill-down, smooth-scrolls to the exact row,
  and flashes it gold for ~2.5s (`row-highlighter.tsx`, confirmed) — genuinely better than "lands on the
  right page, good luck finding it," which was the real alternative if this had been descoped entirely.
  **Verdict: acceptable drift, but only barely, and it's worth being honest about what's actually gained:**
  the highlighted row surfaces the *same* fields the search result row already showed (date, party, amount,
  category, fund, check#/cause, label) — nothing new is revealed until the treasurer clicks a *second* time
  to open `TransactionFormDialog` or the cause-line editor. "Click into the details" as literally promised
  is not fully delivered; what's delivered is "click to jump to context, with one more click required for
  the details." For a read-heavy, single-click "what's this row about" glance this is fine. For the
  treasurer's own framing ("click into the details") it's short by one click. Not a blocker — the fast-follow
  is genuinely cheap per Phase 3's own analysis — but real enough to name as a note, not wave through as
  "matches."

- **Phase 1 said (and Phase 2/3 investigated at length):** lump-sum `ledgerBudgets` rows with no
  `ledgerBudgetLines` children were flagged as a real, separate case, and Phase 3 explicitly ruled them
  **out of scope for increment 1** on the reasoning that the treasurer's own headline example ("what do we
  have on WARM") is a `cause` match that only exists on line rows. **Shipped:** confirmed by reading the
  code directly — `searchBudgetLines()` is rooted at `ledgerBudgetLines` with an **inner** join up to
  `ledgerBudgets` (`ledger-search-queries.ts:366-367`), so a lump-sum budget row can never produce a result
  row even when its own `note` field would match the term, and there is a regression test (test 8) proving
  this is deliberate. `ledgerBudgets` itself (`schema.ts:788-820`) confirms lump-sum rows are real and
  independently addressable: `annualAmountCents`, `note`, `starred` all live directly on the parent row with
  no requirement that any `ledgerBudgetLines` child exist. **Verdict: this is the single most consequential
  gap in the feature, and I am not going to soften it.** A treasurer who types "Rudolph" or "Scholarships" —
  real, plausible searches for real lump-sum-budgeted line items in this club's books — gets Transactions
  results (real spending against that cause, if `beneficiaryCause` was tagged) and **zero** Budget-lines
  results, with a header that reads "Budget lines (0)" and a generic "No budget lines match these filters"
  message. Nothing on screen tells the treasurer *why*: not "this cause isn't budgeted this year" (true,
  discoverable, and a legitimate answer), but "this cause **is** budgeted, as a lump sum, and this search
  structurally cannot see lump-sum budget rows." Those two situations are indistinguishable in the shipped
  UI, and the second one is exactly the treasurer's own stated use case — "what do we have on WARM, budgeted
  and spent" is fundamentally a subtotal question, and for any cause budgeted as a lump sum rather than
  itemized, the "budgeted" half of that subtotal silently reads zero when the true number could be
  thousands of dollars. This was scoped deliberately and documented at every phase, which is meaningfully
  better than a silent bug — but deliberate documentation in a work-log doesn't change what the treasurer
  sees on the page, and what the treasurer sees on the page is wrong for this case. **Verdict: partial
  delivery of "search for budget as well," not a regression (nothing worked before this shipped), but not
  "matches" either** — this needs either a fix or, at minimum, an honest on-screen caveat before I'd call it
  fully resolved.

## Edge Cases

- Empty state: **pass.** Page-level (both sections empty, both viewable) uses the standard
  `bg-gray-50 rounded-2xl p-10 text-center text-gray-500` block with the search term named and a "broaden
  your search" hint (`page.tsx:320-328`); section-level empty (one side has matches, the other doesn't) uses
  a smaller scoped `bg-gray-50 rounded-2xl p-6 text-center text-gray-500 text-sm` block that also names the
  term — matches my Phase 1 Flow 1 spec exactly, and correctly distinguishes "zero matches" (section header
  stays, count shows 0) from "no permission" (section is entirely absent) per Filter Semantics rule 2,
  confirmed in code (`canViewTxns && txnResult && (...)`).
- Failure microcopy: **pass.** `getEntities()`, the per-entity filter-option fetch, and the search calls
  themselves are each wrapped in their own try/catch falling back to `<LoadErrorCard backHref="/admin/ledger" />`
  (confirmed `page.tsx:104-108`, `142-156`, `198-207`) — no stack trace reaches the treasurer, matching the
  granular error-boundary convention `budgeting/[fundSlug]/page.tsx` already uses. A deleted transaction/budget
  line behind a stale `?highlight=` degrades silently (no scroll, no flash, no error) rather than erroring —
  matches my Phase 1 Flow 3/4 failure-path recommendation in spirit, though it's a quieter degrade than the
  literal "This transaction no longer exists" copy I originally suggested; acceptable since the destination
  page itself still renders correctly.
- Permission gate: **pass.** Verified directly in code, not just trusted qa's audit table — page-level
  `hasAnyFeature([LEDGER_VIEW, BUDGET_VIEW])` redirects to `/access-pending`; section-level `hasFeature()`
  checks gate whether each query function is *called*, not just whether its result is *shown* (`page.tsx:199-202`).
  No route handler exists for this feature (read-only Server Component page), so there's nothing under
  `/api/*` to separately audit.
- Mobile (360px): **pass.** Both result tables reuse the register's exact `overflow-hidden rounded-2xl
  border ... overflow-x-auto` wrapper (confirmed in both `search-results-transactions.tsx` and
  `search-results-budget-lines.tsx`) rather than a speculative card layout — correcting my own Phase 1
  guess that a card-based mobile layout might be needed. QA's live 360px measurement (page body has no
  horizontal overflow, the table's own wrapper does) is the right test and it passed.
- Brand consistency: **pass.** Cards `rounded-2xl` throughout (`ledger-search-box.tsx`'s wrapper,
  `search-filters.tsx`'s form, both result-section table wrappers), buttons `rounded-lg` (Search, Apply
  filters, Previous/Next — no `rounded-full` anywhere), `lions-gold` used only as the highlight ring accent
  (`ring-2 ring-lions-gold`), never as a card border, `lions-blue` throughout for focus rings and primary
  actions. No `window.confirm`/`alert`/`prompt` — the feature is read/navigate-only as scoped, so
  `<ConfirmDialog>` correctly never comes up.

## Follow-Ups (SHIP WITH NOTES)

1. **Surface lump-sum budget rows in budget-line search results, or at minimum disclose the gap on-screen.**
   This is the priority item. Either (a) extend `searchBudgetLines()` to also match parentless
   `ledgerBudgets` rows whose own `note`/category name matches the term — via a second query UNIONed in as a
   synthetic no-cause/no-label row, matching the fast-follow Phase 3 itself already sketched as "cheap to
   add" — or, as a fast interim fix if (a) needs its own design pass, (b) add a one-line disclosure to the
   Budget-lines section whenever it renders zero results ("Budget lines search covers itemized cause lines
   only — lump-sum category budgets aren't matched by name; check the Budgeting page directly"), so a
   treasurer doesn't read "0" as "not budgeted" when it may mean "budgeted, but not itemized." (a) is the
   real fix; (b) should ship regardless, even alongside (a), as a permanent caveat near the transaction-only-filter
   note that already exists in that section.
2. **Text-match category name on the transactions side, matching what budget-line search already does.**
   `buildTransactionConditions()`'s free-text OR-list is `party`/`memo`/`beneficiaryCause`/`checkNumber` —
   add a join to `ledgerCategories.name` and include it, so a treasurer typing a category name gets
   consistent results on both sides of the page rather than only on Budget lines.
2b. Consider also joining fund/entity name into the transaction free-text pass for the same reason
    (lower priority than #2 — fund/entity are already dedicated dropdown filters, so this is convenience,
    not a correctness gap).
3. **Confirm with the treasurer that "accounts" = entity/fund + a transaction-only bank-account filter is
   the intended shape**, not assumed-closed. This was a coordinator default (Treasurer Decision item 6),
   not an explicit treasurer answer like items 1–4 were — the interpretation is reasonable and matches every
   other ledger page's filtering convention, but it was never looped back for confirmation now that it's
   live.
4. **Consider auto-opening the edit surface on `?highlight=` arrival** (upgrade scroll-and-flash to
   scroll-and-open), closing the "one click short of the details" gap named above. Phase 3's own analysis
   frames this as a self-contained follow-up on either destination component — not a redesign. Lower
   priority than #1–#3 since the current behavior is a legitimate, working simplification, just not the
   literal "click into the details" the treasurer asked for.
5. **Fix or file separately: `admin-security.spec.ts`'s pre-existing failure on clean `main`**, found by qa
   during this feature's verification but confirmed unrelated to Ledger & Budget Search (the failed-login
   row lands in the DB but doesn't render on `/admin/security` within the test's window). Not a gate on
   this feature's ship decision, but it's a live known bug now that qa found it — worth its own bug-fix
   work-log entry rather than staying an orphaned finding in this one.

## Red Flags (if NEEDS REWORK)

Not applicable — verdict is SHIP WITH NOTES, not NEEDS REWORK. I considered and rejected NEEDS REWORK for
the lump-sum-exclusion gap specifically: the scoping decision was made explicitly and documented at every
phase (analyst → architect → tech-lead), backed by a named regression test proving the exclusion is
deliberate rather than accidental, and the fix Phase 3 itself sketched is small and additive (a UNION, not a
schema change or a redesign) — this is a scoped, well-understood follow-up, not a sign the feature's shape
is wrong. What tips it to SHIP WITH NOTES rather than a clean SHIP IT is that the gap sits directly on the
treasurer's own stated headline use case, and the shipped UI gives no on-screen signal that "0 budget lines"
can mean two very different things — that combination is a tracked-follow-up situation, not a re-open-Phase-3
situation.

---

# Phase 4 — Loop-back (lump sums + free-text symmetry) — 2026-08-07

**Owner:** full-stack-developer
**Status:** complete

### Summary

The treasurer decided both Phase 6 follow-ups get fixed before shipping, not deferred. Fix 1 (priority)
makes lump-sum `ledgerBudgets` rows — a whole budget category with no `ledgerBudgetLines` children, e.g.
"Rudolph Run expenses $10,000" — searchable and correctly displayed, superseding DECISION-063 #4's
increment-1 scope decision. Fix 2 adds category-name matching to the transaction free-text OR-group so
both result sections respond consistently to a category-name search term. Both fixes are confined to the
query layer (`src/lib/ledger-search-queries.ts`) and the budget-lines results component
(`src/components/admin/ledger/search-results-budget-lines.tsx`), plus a small, necessary highlight-anchor
addition to `budget-editor.tsx` so a lump-sum result's `?highlight=` click-through lands correctly on the
budgeting drill-down — exactly the "small, tightly-coupled, spans the query layer and the results
component" scope this was scoped as. `pnpm exec tsc --noEmit` clean, `pnpm test` 942/942 (933 baseline +
9 net, zero regressions), `pnpm build:only` green with `/admin/ledger/search` still in the route manifest.
Verified live against the real dev DB (read-only) — both fixes checked end-to-end with actual data, not
just mocked unit tests.

### What I did

- Read the full work-log (Phase 1 analyst, Treasurer Decisions, Phase 2 architect, Phase 3 design
  including its lump-sum scope note, both original Phase 4 sections, Phase 5 qa, Phase 6 analyst) and
  DECISION-062/063 before touching anything.

**Fix 1 — lump-sum budget rows are now searchable:**

- Restructured `searchBudgetLines()` in `src/lib/ledger-search-queries.ts` from "one row query + one
  aggregate query, rooted at `ledgerBudgetLines` with an INNER join up to `ledgerBudgets`" into two
  independent, unconditionally-issued queries that are merged and paginated in application code:
  - **Cause-line branch** (unchanged query shape from before, still rooted at `ledgerBudgetLines` with
    an INNER join up to `ledgerBudgets` — every row it returns belongs to a budget that HAS at least one
    child, by construction, so it can never double-count a lump sum).
  - **Lump-sum branch** (new) — rooted at `ledgerBudgets`, LEFT JOINed to `ledgerBudgetLines` and filtered
    to `isNull(ledgerBudgetLines.id)` — a real SQL anti-join that makes "has no children" structural, not
    a UI guess. Free-text matching is restricted to exactly the two fields a lump-sum row actually has:
    the parent's own `note` and its category's `name` (`buildLumpSumBudgetConditions()`), per the fix's
    stated requirement. Structured filters (FY/entity/fund/category/amount) apply directly on
    `ledgerBudgets`. A `cause` filter — which has no analog on a lump sum — forces a literal `false`
    condition rather than being "ignored" (Filter Semantics rule 1 doesn't apply here: a lump sum's
    honest answer to "does this carry that cause tag?" is no, the same precedent `beneficiaryCause: null`
    transactions already rely on, not a missing axis).
  - **Deliberate architecture deviation, documented in the module's own doc comment:** both branches are
    now fetched UNPAGINATED (no DB-side `LIMIT`/`OFFSET`) and merged + sorted + paginated in JS, and
    `totalCount`/`totalIncomeCents`/`totalExpenseCents` are computed by reducing over the merged array
    rather than a separate DB aggregate query. This departs from the DB-side-pagination pattern
    `searchTransactions()` still uses (untouched by this fix). Reasoning: once two differently-shaped
    sources must interleave into one sorted, paginated, subtotaled list, a DB-side `LIMIT` on the
    cause-line query alone cannot correctly represent every page of the COMBINED ordering (page 1 happens
    to work out by a lucky property of monotonic orderings; page 2+ does not, in general) — materializing
    both full match sets is the only way to get every page provably right. This club's budget-line match
    volume is small (dozens, not hundreds — confirmed live: 34 real cause lines + a handful of lump sums),
    so the cost is negligible; the architect's Phase 2 "sequential ILIKE scan is cheap at this volume"
    ruling covers this too.
  - Considered a true SQL `UNION`/`unionAll` first (closer to Phase 3's own "cheap to add via a UNION"
    sketch) but rejected it: it would have required re-typing every ternary/conditional branch to satisfy
    Drizzle's matching-shape requirement across two structurally different `.select()` objects, AND —
    more importantly — this codebase's `ledger-search-queries.test.ts` mock harness (a hand-rolled FIFO
    queue standing in for `@/lib/db`) has no support for `.union()`, so testing it would have meant
    rewriting the whole mock's contract, not just this feature's tests. The JS-merge approach tests
    cleanly against the existing mock with zero harness changes.
  - **A real ordering pitfall found and fixed during implementation:** an initial version conditionally
    SKIPPED the lump-sum query entirely when `filters.cause` was set (wrapped in an `async` helper
    function to satisfy TypeScript's `Promise.all` element-type inference against the `Promise.resolve([])`
    fallback). This introduced an extra microtask hop for the lump-sum branch relative to the cause-line
    branch (an `async function`'s internal thenable-adoption step), which changed the ORDER in which the
    two branches' `.then()` fired relative to each other — and since the test mock's FIFO queue is a
    shared side-channel keyed to `.then()` call order, not `Promise.all` array position, two new tests
    failed with rows swapped between branches. Production behavior was never wrong (`Promise.all` always
    returns results in array-position order regardless of resolution order) — only the mock-observable
    ordering was fragile. Fixed by making the `cause`-forces-zero-rows behavior (see above) unconditional
    instead of a skip — both branches are now always plain `db.select()...where()` chains with identical
    resolution shape, restoring deterministic mock ordering and removing the async wrapper entirely. Noting
    this because it's a real, non-obvious hazard for the next person who touches this file: **don't wrap
    one `Promise.all` branch in an `async function` while its siblings are plain thenables** — it changes
    observable ordering in this test harness even though it can't change correctness.
  - `BudgetLineSearchRow` gained `isLumpSum: boolean` (derived in the query/mapping code, never guessed in
    a component) and `cause`/`label` became `string | null` (null only when `isLumpSum` is true).
  - New sort key (`compareBudgetLineSearchRows`) — a lump-sum row sorts by its category name in the same
    "cause" position a cause line's `cause` field would occupy, so it slots in alphabetically alongside
    cause lines rather than clustering at one end; `label` sorts as `""` for a lump sum so it never
    displaces a real cause line at the same position.
- `search-results-budget-lines.tsx`: a lump-sum row now reads as the category-level line it is — Cause
  column shows the category name plus a "Lump sum" badge (reusing the exact `rounded-full ... bg-gray-100
  text-gray-500 border-gray-200` pill classes the existing "Pending removal" badge already uses — a new
  instance of an established convention, not a new one), Label column shows "Not itemized by cause" in the
  same muted `text-gray-400` treatment the existing generic-label case already uses (no empty cell, no
  stray separator). The `?highlight=` target for a lump-sum row is `${categoryId}_${flow}` (not `line.id`,
  since a lump sum has no `ledger_budget_lines` row to point at) — omitted from the link entirely (graceful
  degrade, matching the existing stale-highlight posture) if `categoryId` is null (a deleted category).
- `budget-editor.tsx` (the budgeting drill-down's per-category row renderer): added
  `id={`budget-line-${key}`}` (where `key = `${categoryId}_${flow}`` — already computed locally for every
  row) to both the plain lump-sum row branch and the pending-delete-category branch (the latter covers a
  pending-delete lump sum, and incidentally also fixes highlighting for a pending-delete category that HAS
  cause-line children, which was previously unreachable — a small correctness bonus, not scope creep).
  `RowHighlighter` needed no changes at all — it's already a generic `document.getElementById(idPrefix +
  targetId)` lookup, so a lump-sum result's `?highlight=<categoryId>_<flow>` link is honored automatically
  by the existing mechanism, the same way a cause line's `?highlight=<lineId>` already is.

**Fix 2 — transaction free-text now matches category name:**

- `buildTransactionConditions()`'s free-text OR-group gained a 5th disjunct, `ilike(ledgerCategories.name,
  escaped)`, matching what `buildBudgetLineConditions()` already did.
- `searchTransactions()`'s aggregate (count/sum) query previously joined nothing (every filterable column
  lived directly on `ledgerTransactions`) — it now LEFT JOINs `ledgerCategories` too, since the WHERE
  clause it shares with the row query references that column whenever `q` is non-empty. Verified this
  live (a transaction whose `party`/`memo`/`beneficiary_cause` do NOT contain the category name — "United
  States Postal Service" tagged "Postage" — now surfaces under Transactions for `q=Postage`, which it did
  not before).
- 2b (fund/entity name in the transaction free-text pass) was explicitly out of scope per the loop-back
  instructions (lower priority, not requested) — not touched.

### Unit tests written (CLAUDE.md: implementer's job, not qa's)

All in `src/lib/ledger-search-queries.test.ts` unless noted:

- Fix 1: a lump-sum row (own note/category name matches, zero children) is returned as `isLumpSum: true`
  with `cause`/`label` null.
- Fix 1: the lump-sum query is rooted at `ledgerBudgets` with a LEFT JOIN to `ledgerBudgetLines`, filtered
  to `isNull(ledger_budget_lines.id)` — the anti-join proof.
- Fix 1: a budget WITH children (from the cause-line query) is never also emitted as a lump-sum row in the
  merged result — no double-counting.
- Fix 1: subtotals (`totalIncomeCents`/`totalExpenseCents`/`totalCount`) include lump-sum amounts alongside
  cause-line amounts, split by flow.
- Fix 1: a `cause` filter forces the lump-sum branch's WHERE to a literal `false` condition (not an
  unsatisfiable column reference), and the merged result correctly has zero lump-sum rows when one is set.
- Fix 1: the lump-sum branch's free-text OR-group is restricted to exactly 2 fields (category name, budget
  note) — not cause/label, which don't exist on a lump sum.
- Fix 1: ILIKE escaping (`escapeIlikeTerm`) still holds on the lump-sum branch — a term containing `%`/`_`
  stays literal.
- Fix 1: `fundId`/`categoryId` filter the lump-sum branch on `ledgerBudgets.fund_id`/`category_id` too.
- Fix 1: the pagination/subtotal invariant test (Phase 3 test 3's `searchBudgetLines` case) updated to
  reflect the new JS-merge-and-paginate mechanics while proving the same invariant (totals identical across
  pages, row sets differ).
- Fix 2: `searchTransactions()`'s free-text WHERE now ORs across 5 fields including category name (updated
  existing test + a new isolated "only matches category name" test, mirroring the existing "only matches
  beneficiary_cause" test's structure).
- Fix 2: the aggregate query now joins `ledgerCategories` too (2 LEFT JOINs total — one from the row query,
  one from the aggregate).
- Updated the QA gap-fill block's `fundId`/`categoryId`/`cause` tests for `searchBudgetLines()` to match the
  new two-branch query shape (both branches are now always issued, so both need a queued mock value).
- Removed the old "Phase 3 test 8 — lump-sum rows structurally excluded" describe block entirely — it
  asserted the OPPOSITE of what's now correct behavior; superseded by the Fix 1 tests above.

`escapeIlikeTerm()`'s own unit tests (Phase 3 test 1, in `src/lib/ledger.test.ts`) were untouched —
already covered, no new escape-order edge case introduced by either fix.

### e2e

Added to `e2e/ledger-search.spec.ts` (a flow genuinely changed — Fix 1 introduces new on-screen row shape
and a new highlight-anchor path):

- **New test:** a lump-sum budget category (real FY2025 dev-DB data — "Rudolph Run expenses $10,000" and
  "Rudolph Run – Sponsorships & Donations $11,468", Foundation/Charitable, zero cause-line children,
  confirmed via read-only query that no cause line anywhere matches "Rudolph" either, so the test is
  unambiguous) is searchable, renders with a "Lump sum" badge and "Not itemized by cause" label text, and
  its `?highlight=` click-through lands on the correct fund+FY budgeting drill-down with the param
  stripped — the same contract a cause-line result already has.
- Ran the FULL `ledger-search.spec.ts` suite (13 tests, including the 12 pre-existing ones) against a
  self-started `pnpm dev` on port 3001 (`.env.local`, confirmed `DATABASE_URL` ≠ `PROD_DATABASE_URL` before
  running anything) and the real dev DB. All 13 passed, both the new test alone and the full file together.
  Also independently verified Fix 2 live with a throwaway, not-committed Playwright spec (category "Postage"
  → transaction "United States Postal Service," whose party/memo/cause do not literally contain "Postage")
  before deleting it — confirms Fix 2 end-to-end, not just via the mocked unit tests.
- Did not modify any of the 12 pre-existing tests' assertions (only added the new one and a doc-comment
  update to the file header noting Fix 1's real dev-DB data).

### Gate Results

- `pnpm exec tsc --noEmit`: **PASS** (clean, no output).
- `pnpm test`: **PASS** — 942/942 (933 baseline + 9 net new/restructured, zero regressions).
- `pnpm build:only`: **PASS** — `✓ Compiled successfully`, `/admin/ledger/search` present in the printed
  route manifest as a dynamic (`ƒ`) route.
- `e2e/ledger-search.spec.ts`: **PASS** — 13/13, run live against the dev DB (see above). Not one of the
  three mandated gates for this loop-back, but run anyway given the risk profile of a query-layer
  restructuring, and reported honestly here rather than left unverified.
- No `console.log`/`console.*` added. No new npm dependency. No schema change, no new migration, no new
  index. Did not write to any database (all DB access this session was read-only `psql` queries against
  `DATABASE_URL`, confirmed distinct from `PROD_DATABASE_URL` before running anything). Did not touch
  anything under `scripts/`. Did not commit or push.

### Outputs

**Modified:**
- `src/lib/ledger-search-queries.ts` — `searchBudgetLines()` restructured (two branches, JS merge/paginate/
  aggregate); new `buildLumpSumBudgetConditions()`, `compareBudgetLineSearchRows()`, `budgetSearchSortKey()`;
  `BudgetLineSearchRow` gained `isLumpSum: boolean`, `cause`/`label` now `string | null`;
  `buildTransactionConditions()` gained the category-name OR disjunct; `searchTransactions()`'s aggregate
  query gained a `leftJoin(ledgerCategories, ...)`. Module doc comment documents both fixes and the
  deliberate DB-pagination-to-JS-merge architecture deviation for `searchBudgetLines()`.
- `src/components/admin/ledger/search-results-budget-lines.tsx` — lump-sum row rendering (Cause = category
  name + "Lump sum" badge, Label = "Not itemized by cause", highlight target = `${categoryId}_${flow}`).
- `src/components/admin/ledger/budget-editor.tsx` — `id={`budget-line-${key}`}` added to the plain
  lump-sum row branch and the pending-delete-category branch, so `RowHighlighter` (unchanged) has a real
  anchor to find for a lump-sum search result's `?highlight=` click-through.
- `src/lib/ledger-search-queries.test.ts` — rewritten/extended per "Unit tests written" above.
- `e2e/ledger-search.spec.ts` — one new test + header doc-comment update, per "e2e" above.

**Not modified:** `src/app/(dashboard)/admin/ledger/search/page.tsx`,
`src/components/admin/ledger/search-results-transactions.tsx`, `search-filters.tsx`, `ledger-search-box.tsx`,
`row-highlighter.tsx` — none needed changes for either fix. No schema changes, no new `FEATURES` entry, no
new env var.

### Open questions / handoff notes

**Next agent: qa**, for a Phase 5 re-verify scoped to the budget-results flow specifically (per the
loop-back instructions), on top of a general re-confirmation that nothing else regressed:

- Re-drive the manual click-through for the Budget lines section specifically: a lump-sum search result
  (try "Rudolph" at `fy=2025`, or any category with no cause-line breakdown) shows the "Lump sum" badge and
  "Not itemized by cause" label, its subtotal is included in the section's Income/Expenses figures, and its
  `?highlight=` click lands on the budgeting drill-down at the right fund+FY with the row scrolled-to and
  briefly gold-flashed (same as a cause line).
- Confirm a budget category that DOES have cause-line children still shows only its individual cause lines
  in search results, never also a lump-sum row for the same category (structural guarantee, but worth an
  eyeball check against real multi-line-category data, e.g. search a cause that's itemized under a
  category with several lines).
- Confirm the transaction-side category-name match (Fix 2) doesn't produce surprising results for a common
  short category name — worth trying a few real category names from `/admin/ledger/settings` and eyeballing
  whether the extra Transactions hits make sense.
- Re-run the QA-gap-fill-style coverage check on `ledger-search-queries.ts` (previously 100%
  statements/88.46% branches after the original Phase 5 pass) — this loop-back added new branches (the
  `cause`-forces-false path, the lump-sum query's own filter branches) that may need the same gap-fill
  treatment QA gave the original implementation.
- The Phase 6 analyst review's remaining follow-ups (#3 treasurer confirmation on "accounts" interpretation,
  #4 auto-open on highlight, #5 the unrelated `admin-security.spec.ts` pre-existing failure) were **not**
  in scope for this loop-back per the instructions (only Fix 1 and Fix 2) and remain open/tracked as before
  — do not treat their absence here as newly resolved or newly dropped.
- Nominate **analyst** for Phase 6 after qa's PASS, to confirm the two SHIP-WITH-NOTES gaps are now
  actually closed on screen, not just in the query layer.


---

# Phase 5 — Re-verify (loop-back): Build Verification Report

**Verdict: PASS**

**Who ran this, and why it matters.** The `qa` agent was launched for this re-verify and died twice —
once on an API connection error mid-response, once on a 600s stall — after completing part of the work
(it added one test, taking the suite 942 → 943). Rather than resume a third time, the coordinator
completed the verification directly. This is a deviation from the pipeline, where Phase 5 belongs to
`qa`: recorded here explicitly rather than glossed, per CLAUDE.md's no-silent-skips rule. The
verification below is independent of the implementer's own claims — it re-derives ground truth from
raw SQL rather than trusting the query layer under test.

## Automated gates

| Gate | Result |
|------|--------|
| `pnpm exec tsc --noEmit` | PASS — clean |
| `pnpm test` | PASS — 943/943 across 37 files, no regression from the 942 baseline |
| `pnpm build:only` | PASS — compiled, `/admin/ledger/search` present in the route manifest |
| `pnpm test:e2e e2e/ledger-search.spec.ts` | PASS — 13/13 |

## Independent data verification

A throwaway harness called `searchBudgetLines()` / `searchTransactions()` directly against the DEV
database and compared every answer to ground truth computed in raw SQL (34 cause lines + 33 lump sums
= 67 rows, $57,590.00 expense). All checks passed:

- **Counts and subtotals span BOTH query branches** — `totalCount` 67 = 67 expected; expense subtotal
  $57,590.00 exact; income and expense reported separately, never netted.
- **No double-counting** — zero parents-with-children emitted as lump sums; lump-sum row count (33)
  matches the SQL anti-join exactly; lump-sum rows carry null cause AND null label; cause-line rows
  always carry a cause.
- **Application-side pagination integrity** (the riskiest part of the loop-back, since paging moved
  out of the database) — 67 rows walked across 2 pages, 67 unique: nothing duplicated, nothing
  dropped. The expense subtotal is byte-identical on page 1 and page 2.
- **The Phase 6 gap is closed** — "Rudolph" returns 4 lump-sum budget rows; "Scholarships" returns
  both a $7,500 lump sum and a $500 cause line, correctly distinguished.
- **Wildcards stay literal** — a bare `%` matched 0 of 67 budget rows; a bare `_` matched 0 of 281
  transactions.
- **Fix 2 confirmed** — "Postage" surfaces a transaction that matches ONLY via its category name.

## Two false alarms, both environmental — recorded so they aren't re-diagnosed later

1. A harness check for "Bags to Benches" returned 0 rows. This was a **bad expectation in the
   harness, not a defect**: that category rename was applied to PRODUCTION only (2026-08-06 budget
   review), and the dev branch still calls it "Program supplies" and holds zero FY2026 budget rows.
2. `e2e/ledger-search.spec.ts` first reported 13/13 FAILING, all timing out at sign-in. The cause was
   a **stale dev server** left running by an earlier agent — started during the window when
   `.env.local` had been moved aside for a CLI deploy, so its auth was broken. Killing it and starting
   a fresh `pnpm dev` produced 13/13 passing. Note also that `pnpm exec playwright test` bypasses the
   `dotenv -e .env.local` prefix in the `test:e2e` script and fails on missing E2E credentials — always
   invoke e2e through `pnpm test:e2e`.

## Known-bad e2e baseline (unchanged, not caused by this feature)

Six specs fail on clean `main`: `budget-star-notes`, `budgeting-restructure`, `cancel-occurrence`,
`prior-year-cause-line-reconcile`, `transaction-budget-line-link` (leftover sentinel-FY rows, 2095–2099,
in the dev database from interrupted runs), and `admin-security` (a real pre-existing bug qa found —
a failed-login row reaches the DB but doesn't render on `/admin/security` in time). No NEW e2e failure
was introduced.

**Next:** Phase 6 re-review by `analyst` against the original request.

---

# Phase 6 — Shipped vs Intent, RE-REVIEW (loop-back) — 2026-08-07

**Owner:** analyst
**Status:** complete

This is a re-review, not a replacement. My original Phase 6 section above (SHIP WITH NOTES, 2026-08-06)
stands as written — nothing below erases it. The treasurer chose to fix both of that review's follow-ups
(#1 lump-sum invisibility, #2 free-text asymmetry) before shipping rather than deferring them; the
full-stack-developer's loop-back landed 2026-08-07, and qa's re-verify (completed by the coordinator after
qa died twice) came back PASS. This section re-walks the two fixes against my own original findings and
re-checks the still-open follow-ups.

## VERDICT

**SHIP IT**

## ONE-LINE TAKE

> Both notes from the original SHIP WITH NOTES are genuinely, structurally closed — not papered over with
> a disclosure banner but actually fixed with a real SQL anti-join and a real free-text field addition,
> both independently verified against live data and against the code itself, not just taken on the
> implementer's word — and nothing that remains open rises to a blocker.

## What I Did

Read the Phase 4 loop-back section and the Phase 5 re-verify report in full, then read the actual shipped
code rather than trusting either report:

- `src/lib/ledger-search-queries.ts` in full — confirmed the lump-sum branch is a real anti-join
  (`.from(ledgerBudgets).leftJoin(ledgerBudgetLines, eq(ledgerBudgetLines.budgetId, ledgerBudgets.id))`,
  `.where(and(isNull(ledgerBudgetLines.id), ...))`), not a client-side filter or a guess — the "has no
  children" test is a SQL predicate. Confirmed the two branches (`causeLineRawRows`/`lumpSumRawRows`) are
  both fetched unpaginated and merged/sorted/paginated/aggregated in JS (`merged.slice(start, ...)`,
  `reduce` for both subtotal directions), matching the documented deviation. Confirmed Fix 2:
  `buildTransactionConditions()`'s free-text OR-group now has 5 disjuncts including
  `ilike(ledgerCategories.name, escaped)`, and the transactions aggregate query now `leftJoin`s
  `ledgerCategories` (previously joined nothing) so the shared WHERE clause resolves correctly.
- `src/components/admin/ledger/search-results-budget-lines.tsx` in full — confirmed the "Lump sum" badge
  (reusing the existing pill classes the "Pending removal" badge already used) and "Not itemized by cause"
  label render only when `line.isLumpSum`, confirmed the highlight target is `${categoryId}_${flow}` for a
  lump sum vs. `line.id` for a cause line, with a graceful no-highlight-param fallback when `categoryId` is
  null.
- `src/components/admin/ledger/budget-editor.tsx` — confirmed `id={`budget-line-${key}`}` was added to
  **both** the pending-delete-category branch (line 894) and the plain-lump-sum-row branch (line 1039),
  read the surrounding code to confirm each is the correct branch (the pending-delete branch fires
  regardless of whether the category has cause-line children, per the render-order-fix comment already in
  that file; the plain-lump-sum branch is reached only when `!(line.causeLines && line.causeLines.length >
  0)`) — so a lump-sum search result's `?highlight=` link always has a real anchor to find. Confirmed
  `row-highlighter.tsx` needed no changes — it's a generic `document.getElementById(idPrefix + targetId)`
  lookup, unchanged, and the `idPrefix="budget-line-"` convention already covered both id shapes.
- Ran my own sanity checks rather than only reading the coordinator's report: `pnpm exec vitest run
  src/lib/ledger-search-queries.test.ts src/lib/ledger.test.ts` — 351/351 passing; `pnpm exec tsc --noEmit`
  — clean. Did not re-run the full suite or `pnpm build:only` myself (already green per two independent
  reports — the full-stack-developer's Phase 4 loop-back and the coordinator's Phase 5 re-verify — and
  re-running a 943-test suite a third time in an hour buys little additional confidence for the cost);
  targeted the two files this loop-back actually touched, which is where a regression would most likely
  surface first.
- Checked `git status` — all of this feature's files (`ledger-search-queries.ts`,
  `search-results-budget-lines.tsx`, `budget-editor.tsx`, and the rest of the surface) are still uncommitted
  on the working tree, consistent with "ready to ship, not yet shipped" — nothing here has been pushed to
  main without approval.

## Confirming the Two Notes Are Resolved

**1. Lump-sum budget rows are now findable and clearly distinguishable — CONFIRMED, genuinely closed.**

This is not the "at minimum disclose the gap on-screen" fallback I named as an acceptable interim in my
original Follow-Up #1 — it's the real fix (option (a) from that list), and it's structurally sound, not a
client-side heuristic that could drift out of sync with the data:

- The anti-join means a budget category WITH cause-line children can never also render as a lump sum
  (verified in code: the cause-line branch is `INNER JOIN` rooted at the children, the lump-sum branch is
  `LEFT JOIN ... WHERE isNull(child.id)` — mutually exclusive by construction) — and the Phase 5 re-verify's
  independent SQL ground-truth check confirms this holds against real data (zero parents-with-children
  emitted as lump sums, lump-sum count matches the anti-join exactly: 33 for 33).
- On screen, a lump-sum row is unmistakably not a cause line: category name in the Cause column, a "Lump
  sum" badge next to it, "Not itemized by cause" in the Label column instead of a blank or misleading cell.
  A treasurer scanning results cannot mistake one for the other.
- **"A zero can be trusted to mean zero" — yes, with the scope now correctly reflecting what the query can
  see.** "Rudolph" now returns 4 lump-sum rows instead of a false "Budget lines (0)" — this was the
  headline failure case from my original review and it's fixed. The lump-sum branch's free-text match is
  deliberately narrower than the cause-line branch's (category name + budget note only — 2 fields, not 5,
  since a lump sum has no `cause`/`label`/line-`note` to match against), which is correct and documented,
  not a hidden gap: a lump sum's honest searchable surface really is smaller than a cause line's.
- Subtotals are correct across the merge: the Phase 5 re-verify's independent harness reproduced the exact
  dollar total from raw SQL ($57,590.00 expense across 67 rows) by calling `searchBudgetLines()` directly
  and comparing against ground truth computed separately — not by trusting the function's own arithmetic.
  I read the `reduce()` calls in the code myself and they match what I'd expect: flow-split, never netted,
  summed over the full merged array before pagination, consistent with the pre-existing
  `searchTransactions()` convention.

**2. The free-text asymmetry is closed — CONFIRMED.**

`buildTransactionConditions()`'s OR-group now includes `ilike(ledgerCategories.name, escaped)` as its 5th
disjunct, matching what the budget-line side always had. The transactions aggregate query picked up the
necessary `leftJoin(ledgerCategories, ...)` it previously didn't need. The "Postage" case in the Phase 5
report — a transaction tagged with category "Postage" whose `party`/`memo`/`beneficiaryCause` do not
literally contain the string "Postage" — is exactly the right adversarial case to prove this isn't
accidentally passing via some other field, and I confirmed the underlying WHERE-clause change in the code
that would produce that result. Both sides of the page now respond consistently to a category-name search
term, closing the gap named in my original Follow-Up #2.

## Re-Checking the Remaining Follow-Ups

- **Follow-up #3 — "accounts" = entity/fund interpretation never explicitly confirmed with the
  treasurer.** **Still stands.** This loop-back was explicitly scoped to Fix 1 and Fix 2 only (the
  full-stack-developer's own handoff notes say so), and I see nothing in the work-log since my original
  review that closes this loop. The interpretation shipped is reasonable and matches every other ledger
  page's filtering convention, but it was a coordinator default (Treasurer Decision item 6), not an
  explicit treasurer answer like items 1–4. Non-blocking — this is a "confirm now that it's live" item, not
  a defect — but it should not be quietly dropped from tracking. Recommend a one-line follow-up ticket, not
  a work-log reopen.
- **Follow-up #4 — `?highlight=` scroll-vs-auto-open.** **Still stands, unaddressed by this loop-back**, as
  expected (also out of scope for it). Current behavior (scroll-and-flash, one more click to open the edit
  surface) remains a legitimate, working simplification per Phase 3's own reasoning — not a blocker, and
  it's exactly as I left it in my original review: worth a fast-follow, not worth reopening the pipeline
  for.
- **Follow-up #5 — `admin-security.spec.ts`'s pre-existing failure on clean `main`.** **Still stands, still
  unfixed**, and still confirmed unrelated to this feature (the Phase 5 re-verify's "Known-bad e2e baseline"
  section reconfirms it as one of six specs failing on clean `main`, none newly introduced by this work).
  This needs its own bug-fix work-log entry — it should not keep riding along as an orphaned finding in
  this one. I'm naming it again here rather than letting it quietly disappear because this entry closed.

None of these three are blockers. All three were already correctly scoped as non-blocking in my original
review, and nothing about the loop-back changed that assessment — they're follow-up tickets, not
conditions on this ship.

## On the Phase 5 Re-Verify Being Done by the Coordinator, Not QA

The work-log is honest about this deviation (qa died twice — once on an API error, once on a 600s stall —
and the coordinator completed the verification directly rather than attempting a third resume), and I want
to give my own independent assessment of whether that verification was sufficient, not just accept the
self-report.

**What it actually checked, and how I'd rate it:**

- All four automated gates (`tsc`, `pnpm test` 943/943, `pnpm build:only`, the full `ledger-search.spec.ts`
  e2e suite at 13/13) ran and passed. I independently re-ran the two most relevant unit-test files myself
  (351/351) and `tsc --noEmit` (clean) rather than taking this on faith — no surprises.
- The independent SQL ground-truth check — a throwaway harness calling `searchBudgetLines()`/
  `searchTransactions()` directly against the dev DB and comparing every number to hand-computed raw SQL —
  is genuinely strong verification for **exactly the question that mattered most in this loop-back**:
  "does the new query logic produce the right rows and the right dollar totals, with no double-counting and
  no dropped/duplicated rows across pages." That's the riskiest part of Fix 1 (moving pagination from the
  DB to application code), and it's the part I'd have been most worried about signing off on without
  independent confirmation. It got exactly that.
- The e2e suite includes the new lump-sum-specific Playwright test (real "Rudolph Run" data, asserts the
  "Lump sum" badge and "Not itemized by cause" label actually render in a real browser and that the
  highlight click-through lands correctly) — so the visual/UI claims aren't resting solely on the SQL
  harness or on my own static code read; a browser-driven check exists and passed.

**What it did NOT do, that a full qa Phase 5 normally would:** it did not redo an independent, fresh-eyes
manual click-through of the page in a running browser (mobile 360px re-check, accessibility tab-through,
trying adversarial free-text inputs beyond the specific cases the implementer already tested), and it did
not re-run the statement/branch coverage gap-fill check the implementer's own handoff notes explicitly
asked for ("Re-run the QA-gap-fill-style coverage check on `ledger-search-queries.ts`... this loop-back
added new branches that may need the same gap-fill treatment"). I don't see that coverage re-check anywhere
in the Phase 5 report.

**My assessment: sufficient to ship, not fully equivalent to a standard qa pass.** The verification that
happened was well-targeted at the actual risk this loop-back introduced (query-layer correctness under a
paging-mechanism change) and was independently re-derived rather than trusted, which is the right kind of
rigor for that specific risk. The gaps (coverage re-check, fresh manual click-through) are the kind of thing
that catches a second-order regression elsewhere on the page, not a failure of this fix specifically — I
found no evidence of such a regression in my own code read, and the full unpaginated `searchTransactions()`
path (untouched by this loop-back) wasn't at risk to begin with. I'm treating "run the coverage gap-fill
check" as a cheap, non-blocking follow-up for whoever next touches this file, not a reason to withhold SHIP
IT.

## Edge Cases (re-check, scoped to what changed)

- Empty state: **pass** — a genuine zero-match search still renders the same empty-state copy as before;
  a lump-sum-only search no longer misrepresents as empty.
- Failure microcopy: **not applicable to this loop-back** — no new failure path introduced; original
  assessment (pass) stands.
- Permission gate: **not applicable to this loop-back** — gating logic untouched; original assessment
  (pass) stands.
- Brand consistency: **pass** — the "Lump sum" badge reuses the exact existing "Pending removal" pill
  classes (`rounded-full ... bg-gray-100 text-gray-500 border-gray-200`), not a new visual convention;
  correctly a badge/pill, not a button, so `rounded-full` here does not conflict with CLAUDE.md's
  buttons-never-`rounded-full` rule.
- Mobile (360px): **not re-verified directly by me or, as far as the record shows, by the Phase 5
  re-verify** — no new columns or layout changes were introduced by this loop-back (same table, one more
  badge in an existing cell), so risk is low, but noting this as an honest gap rather than claiming a pass
  I didn't check.

## Follow-Ups (SHIP WITH NOTES-style tracking, non-blocking)

Carried forward from my original review, unchanged in substance:

1. Confirm with the treasurer that "accounts" = entity/fund + a transaction-only bank-account filter is the
   intended shape (Treasurer Decision item 6 was a coordinator default, never explicitly confirmed live).
2. Consider auto-opening the edit surface on `?highlight=` arrival (upgrade scroll-and-flash to
   scroll-and-open) — self-contained fast-follow per Phase 3's own analysis.
3. File `admin-security.spec.ts`'s pre-existing failure as its own bug-fix work-log entry — confirmed
   unrelated to this feature across two independent verification passes now.

New, small, from this re-review:

4. Run the statement/branch coverage gap-fill check on `ledger-search-queries.ts` that the loop-back's own
   handoff notes asked for and that I don't see completed anywhere in the Phase 5 report — cheap, low
   priority, not a reason to hold the ship.

## Closing

Both notes that kept this from a clean SHIP IT on 2026-08-06 are now genuinely resolved — not through a
disclosure banner, which would have been the acceptable-but-lesser fix, but through the real structural fix
(a SQL anti-join with a regression test, and a matching free-text field) — and I verified that independently
by reading the query code, the two touched components, and the DOM-anchor wiring myself, not by relying on
either the implementer's or the coordinator's self-report alone. Nothing that remains open is a defect in
what shipped; all three carried-forward items are legitimate next-steps that were already correctly scoped
as non-blocking before this loop-back and remain so after it. This closes the pipeline.

**SHIP IT.**
