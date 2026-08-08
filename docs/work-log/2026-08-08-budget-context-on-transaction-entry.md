# Budget Context When Entering a Transaction — Work Log

> **Slug:** `2026-08-08-budget-context-on-transaction-entry`
> **Surface:** (dashboard) admin — the transaction entry dialog
> **Permission(s):** No new `FEATURES` key. Existing `LEDGER_RECORD`/`LEDGER_MANAGE` already gates reaching the form; the new budget-context read must ALSO check `BUDGET_VIEW`/`LEDGER_MANAGE` server-side — see Permissions section below, this is not automatic.
> **Estimated complexity:** small–medium
> **Pipeline mode:** Full — recommend Phase 2 (architect) is not skipped. This needs a query-module placement ruling (new sibling module vs. extending `getFundReport()`, following the DECISION-049/061/062 split precedent) and a fetch-strategy ruling (preload-on-fund/date-change vs. fetch-per-selection) before Phase 3 can lock a design. See Gaps.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-08 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-08 |
| 3 — Technical design | tech-lead | Complete | Design complete | 2026-08-08 |
| 4 — Implementation | api-developer (query+route) → ux-developer (panel+form) | Complete (both halves) | — | 2026-08-08 |
| 5 — Verification | qa | Complete | PASS | 2026-08-08 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-08 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Showing budgeted/spent/remaining next to the category picker is a genuinely useful nudge for a treasurer mid-entry, but the request is silent on exactly the handful of decisions that determine whether the number shown is trustworthy — fiscal year resolution, which transaction statuses count as "used," and lump-sum-vs-cause-line scope — and this codebase already has one hard-won lesson (DECISION-063, the monthly-statement `reconciledAt` bug) about what happens when that kind of ambiguity is resolved by improvisation instead of by design.

## Ground Truth Established

- **Entry surface:** `TransactionFormDialog` (`src/components/admin/ledger/transaction-form-dialog.tsx`) wraps `TransactionForm` (`src/components/admin/ledger/transaction-form.tsx`), used both for "Record Transaction" (create) and "Edit Transaction." Category is a plain `<select>` (line ~646) filtered from a `categories` prop already passed in server-side (filtered by fund kind + flow) — not fetched on selection. The "Applies to budget line" picker, `BudgetLinePicker` (`src/components/admin/ledger/budget-line-picker.tsx`), works the same way: `budgetLines` (typed `BudgetLineOption[]`, from `getBudgetLineOptions()` in `src/lib/ledger-queries.ts:911`) is preloaded server-side for the **whole entity across every fiscal year**, and the picker filters to `fundId` + `getFiscalYear(txnDate)` entirely client-side. **This is the load-bearing precedent for how this feature should fetch its data** — see Gaps.
- **Fiscal year resolution confirmed:** `getFiscalYear()`/`fyBounds()` live in `src/lib/fiscal-year.ts` (DECISION-015, relocated per DECISION-063). `TransactionForm` already imports `getFiscalYear` and re-derives FY from `txnDate` client-side (line 11, used at line 284 to auto-clear a stale `budgetLineId` when the date crosses a fiscal-year boundary). The request's stated concern is correct and already has a working precedent in this exact file: **budget context must key off `getFiscalYear(txnDate)`, never `currentFiscalYear(new Date())`.** A treasurer back-dating a June 2026 expense in August 2026 must see FY2025's budget.
- **Schema confirmed:** `ledgerBudgets` (`src/lib/db/schema.ts:849`) is one row per `(fundId, fiscalYear, categoryId, flow)` carrying `annualAmountCents`. `ledgerBudgetLines` (line 894) are optional cause/label children under a budget row, summing to the parent. `ledgerTransactions.budgetLineId` (line 780, B-30/DECISION-061) is a nullable FK to a specific line, `onDelete: 'set null'`. `ledgerTransactions.status` is `'posted' | 'pending' | 'rejected'` (line 745) — pending covers over-threshold disbursements awaiting board approval (confirmed in `transaction-form.tsx`'s own submit-success toast: `"Submitted — awaiting board approval"`).
- **Existing budget-vs-actual arithmetic:** `getFundReport()` (`ledger-queries.ts:544`) is the one function in this codebase that computes budget-vs-actual today — it fetches an entire fund's entire fiscal year (all transactions, all categories, all budget rows, all budget lines) and, per its own comments, restricts actuals to **`status = 'posted'` only**. Per-cause-line actuals are resolved by `resolveCauseLineActual()` (imported from `src/lib/ledger.ts`, referenced at `ledger-queries.ts:77` and `:181-196`) — a pure function that already implements exact-link vs. fuzzy-payee-match resolution for a single cause line's `linkedActualCents`/`actualCents`/`isFuzzyFallback`. **This is the arithmetic to reuse or extract, not reinvent** — but its current only call site is embedded inside `getFundReport()`'s whole-fund-report pass, which is the wrong shape (too heavy, posted-only, whole-FY) to call once per modal open. Confirms the DECISION-049/061/062 sibling-module precedent applies again: this needs either a new lightweight sibling query (mirroring `ledger-search-queries.ts`) or a new opts-style narrowing on an existing function, decided in Phase 2/3 — not a fourth independent reimplementation of "budgeted minus actual."
- **No existing lightweight per-category/per-line query exists.** `searchBudgetLines()` in `src/lib/ledger-search-queries.ts` returns budget *metadata* (`amountCents`, `cause`, `label`, `flow`, `fiscalYear`) with **no actuals column at all** (confirmed reading `BudgetLineSearchRow`, `ledger-search-queries.ts:129-161`) — it cannot be reused as-is.
- **Permissions confirmed via `drizzle/migrations/0045_ledger_permissions.sql` and `0069_ledger_budget_permissions.sql`:** `ledger.record` is bound only to `admin` and `treasurer`. `budget.view`/`budget.edit` are bound to `admin`, `treasurer`, `board_member` (view-only), and `budget_committee`. Today every role holding `ledger.record` also holds `budget.view` — but that's a binding coincidence, not a structural guarantee (see Permissions/Adversarial Pass below).

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`ledger.record` or `ledger.manage`) | Opens "Record Transaction" / "Edit Transaction" dialog from an admin Ledger page | Per transaction entry |
| Admin | Selects a Fund (new-transaction only; fixed on edit) | Once per entry |
| Admin | Selects a Category from the flow-filtered dropdown | Once or more per entry (may change their mind) |
| Admin | Optionally selects a specific budget line via `BudgetLinePicker` | 0–1 per entry |
| Admin | Enters/changes the transaction Date, including back-dating into a prior FY | 0+ per entry |
| Admin | **(new)** Reads budgeted/spent/remaining context that appears once a category (and/or budget line) is selected | Passive, reactive to category/line/date/fund |

The request itself is a "the system supports X" statement ("it would be nice to see..."), not a described interaction — the verbs above are inferred from the existing form's mechanics, not stated in the request. That's expected for a small enhancement request, not itself a blocker, but it means the "what exactly is shown" and "does it update live" questions below have no textual anchor and must be decided explicitly.

## Flows

**Flow 1 — Record a new expense with budget context, category has a budget:** Admin opens "Record Transaction" from an admin Ledger page (e.g. `/admin/ledger/[fundSlug]`) → picks Fund → picks Type=Expense → enters Amount and Date → picks a Category → **(new)** a budget-context block renders near the Category/budget-line fields showing that category's FY-derived budgeted amount, amount used, and remaining → admin optionally narrows to a specific cause line via `BudgetLinePicker`, which (per the open question below) either updates or replaces that block → admin fills remaining fields and clicks "Record Transaction."
- Outcome: transaction saves (posted, or `pending` if over the board-approval disbursement threshold), toast confirms, dialog closes, `router.refresh()`.
- Failure: not addressed by the request. If the budget-context fetch itself fails (network/DB blip), what renders — nothing, a spinner forever, an error string? Needs explicit microcopy, distinct from "no budget set" (see Gaps).

**Flow 2 — Category has no budget row for the derived fiscal year:** Same entry as Flow 1, but the selected category has zero `ledgerBudgets` rows for `(fundId, getFiscalYear(txnDate), categoryId, flow)` — true for roughly half the Foundation's categories in a given year per the brief.
- Outcome: context block must read something like "No budget set for FY2026" — explicitly not "$0 budgeted" paired with a spent figure, which would misread as "you are over an empty budget."
- Failure: same as Flow 1's undefined network-failure case, compounded — a failed fetch and "no budget exists" must never render identically, or a treasurer can't tell "the number isn't there" from "I don't have a number for you right now."

**Flow 3 — Back-dating into a different fiscal year mid-entry:** Admin has already picked a Category (context is showing FY2026 figures, today's default date) → changes Date to a date before 2026-07-01, e.g. entering a June 2026 (FY2025) expense in August 2026.
- Outcome: context must re-resolve to FY2025's budget/actuals for the same category, without requiring the admin to re-pick the category. `TransactionForm` already does exactly this re-derivation for `budgetLineId`'s auto-clear (lines 269-288) — the budget-context effect should follow the identical `[fundId, txnDate]` dependency shape.
- Failure: if the underlying data is preloaded only for "the FY the modal opened in" rather than keyed by FY, the admin sees stale FY2026 numbers under an FY2025 date with no visual signal anything is wrong. This is the single highest-consequence failure mode in the whole feature — a confidently wrong number, exactly what the brief warns against — and it must be an explicit QA click-through case in Phase 5, not assumed correct because the code "looks right."

**Flow 4 — Editing an existing transaction:** Admin clicks Edit on a transaction row → dialog opens in edit mode with `initialValues` (including existing `categoryId`, `txnDate`, `budgetLineId`) already populated.
- Outcome: budget context should be visible on dialog open, using the transaction's already-set category+date — not require the admin to touch the category dropdown once to trigger a first render.
- Failure: not addressed by the request. If the context effect only fires on `onChange`, edit mode shows nothing until the admin re-selects a category they didn't mean to change — a real risk given `TransactionForm`'s effects are already wired off `[fundId, txnDate]`/`[fundId, flowMode]` dependency arrays that fire on mount in React, so this is likely fine by construction, but must be verified, not assumed.

**Flow 5 — Income category:** Admin selects Type=Income and a category with an existing income-flow `ledgerBudgets` row.
- Outcome: "budget used" framing is backwards for income (per the brief) — should read progress-toward-expected ("$3,200 of $5,000 received"), not spent/remaining.
- Failure: not addressed by the request at all — flagged as an open question below, since shipping the expense framing verbatim for income ("$3,200 spent of $5,000 budgeted") would be actively confusing, arguably worse than showing nothing.

## Permissions

- **Permission(s):** No new `FEATURES` key required to *reach* this feature — the transaction-entry dialog is already behind `FEATURES.LEDGER_RECORD` (or `LEDGER_MANAGE`) per `src/lib/permissions.ts`. But the *data* this feature surfaces (budget figures) is a distinct capability from recording a transaction, and today it is gated separately: the Budgeting nav item requires `LEDGER_MANAGE`, `LEDGER_APPROVE`, `BUDGET_VIEW`, or `BUDGET_EDIT` (`permissions.ts:249-254`), not `LEDGER_RECORD`. Recommend the new budget-context API route additionally check `hasFeature(session.user.features, FEATURES.BUDGET_VIEW) || hasFeature(..., FEATURES.LEDGER_MANAGE)` server-side (mirroring the nav's "any of" pattern) before returning figures — return "no context available" rather than the numbers when that check fails. This is currently a no-op in practice (every role bound to `ledger.record` today — `admin`, `treasurer` — already holds `budget.view` too, per `drizzle/migrations/0045_ledger_permissions.sql` and `0069_ledger_budget_permissions.sql`), but it's not a structural guarantee, and it's the kind of check that's cheap to add now and easy to forget later once a `ledger.record`-only role (e.g. a future "bookkeeper" assistant role) exists.
- **Default roles:** No new role bindings needed if the above reuses `BUDGET_VIEW`/`LEDGER_MANAGE`.

## Gaps the Request Didn't Address

- **Fetch strategy vs. "fires on every category selection."** Both existing pickers in this exact form (`categories`, `budgetLines`) are preloaded server-side once per dialog and filtered entirely client-side — there is zero precedent in this file for a fetch-per-selection inside this modal. Recommend the same shape: fetch a budget-context payload once when the dialog opens (or when `fundId`/derived-FY changes, which is rare — date/fund changes far less often than category changes), then look up by category/line client-side with no further network round-trip. A per-keystroke or per-select-change fetch would be a new pattern this codebase doesn't use anywhere in the ledger UI and should be treated as a red flag if proposed in Phase 3.
- **Which query owns the arithmetic.** `getFundReport()` is the only existing budget-vs-actual computation, and it's fund+FY-wide, posted-only, and heavy (whole-fund transaction fetch). This feature needs a per-`(fundId, fiscalYear, categoryId)` (and optionally per-`budgetLineId`) slice, ideally across every FY the entity has ever budgeted (to support back-dating) without repeating `getFundReport()`'s full-fund cost. Phase 2/3 needs to decide: a new sibling module (`ledger-budget-context-queries.ts`?), or a narrower `opts`-style addition to an existing function. Do not let Phase 4 improvise this — DECISION-063's `reconciledAt` near-miss on the Monthly Financial Statement is the exact precedent for what happens when a "should be obvious" aggregation question is left to implementation.
- **Posted vs. pending in "spent."** Not addressed by the request at all, and it changes the number shown. `ledgerTransactions.status` has three values; `getFundReport()`'s actuals are posted-only. A treasurer mid-entry deciding whether they're about to overspend probably wants to know about pending (over-threshold, awaiting-approval) amounts too; a reconciliation-style "what's actually cleared" view wants posted-only. Recommend showing both, distinguished (e.g. "$2,400 posted + $600 pending"), rather than picking one and hiding the other — but this is a real product call, not an implementation detail, and belongs in front of the treasurer (see Open Questions).
- **Does the projected total include the transaction being typed right now?** Not addressed. A "$3,000 of $5,000 used" figure that doesn't move as the admin types "$450" in the Amount field is materially less useful than one that shows "$3,000 of $5,000 used → $3,450 after this transaction" — but the latter requires client-side arithmetic on top of the fetched baseline, not just displaying server data. Needs an explicit decision, not an assumption either way.
- **Lump-sum category vs. selected cause line.** When the admin has picked a specific line via `BudgetLinePicker`, is the context that line's own budget/actual (via `resolveCauseLineActual()`'s existing logic), the parent category's full `annualAmountCents` roll-up, or both? The request never distinguishes these, and they can tell very different stories (a line might be exhausted while its parent category still has headroom from other lines, or vice versa).
- **Income framing.** Flagged in Flow 5 — the request's own "spent"/"budget used" language doesn't fit income categories, and the fix (received/expected framing) isn't stated. Needs one component that can render both framings correctly, not a copy-paste with search-replaced words that quietly gets one of them wrong.
- **Empty state.** A brand-new install (or a category that has simply never been budgeted) must render "No budget set for FY20XX" — not "$0 budgeted, $340 spent" (reads as already over budget) and not a blank space (reads as broken). Must be visually distinct from the network-failure case below.
- **Failure microcopy.** Not addressed. If the budget-context fetch fails, the admin needs a message that reads as "we couldn't load this — try again," not a blank block, an infinite spinner, or (worst) a stale/wrong number left on screen from before the failed refetch.
- **Mobile at 360px.** `TransactionFormDialog`'s content is `max-w-lg` and already renders inside a scrollable dialog on phones. A new budget-context block (numbers, and/or a bar) needs to stack vertically at 360px, not force horizontal scroll inside the dialog — untested by the request.
- **Brand consistency.** This form already has two precedents for an inline informational (non-interactive) block worth following: the Transfer note (`rounded-lg bg-gray-50 border border-gray-200`, lines 556-561) and the Sweep note (`rounded-lg bg-blue-50 border border-blue-200`, lines 565-578). The new budget-context block should match one of these rather than inventing new styling. No destructive action is introduced, so `<ConfirmDialog>` doesn't apply here.
- **Reimbursement mark-paid dialog.** `BudgetLinePicker`'s own doc comment states it's shared by `transaction-form.tsx` **and** `pay-reimbursement-dialog.tsx`. The request only mentions "entering a transaction" — confirm whether the reimbursement-approval flow is in scope for the same context, or explicitly out of scope for this increment (see below).

## Out of Scope (confirm with user)

- Editing or adjusting the budget itself from inside the transaction dialog — this is read-only context, not a shortcut into `/admin/ledger/budgeting`.
- A submission-blocking warning ("you are about to exceed budget — continue?") — the request asks to *see* budget context, not to gate saving on it. Recommend pure display, no new confirm step, unless the treasurer wants otherwise.
- Historical trend / burn-rate charts (e.g. month-over-month pace toward the annual figure) — the request asks for a snapshot (budgeted / used), not a trend line.
- Extending the same context into `pay-reimbursement-dialog.tsx`, even though it shares `BudgetLinePicker` with this form and would benefit identically.

## Open Questions

- Should "used" include `pending` (over-threshold, awaiting board approval) transactions, or `posted` only? Recommend showing both, distinguished — but this changes the number shown and should be the treasurer's call, not a default we pick silently.
- Should the figure update live to include the transaction currently being typed (a projected after-this-transaction total), or only reflect what's already saved? Recommend showing both a current and a projected figure.
- When a specific budget line is selected via "Applies to budget line," should context reflect that line alone, the parent category's full budget, or both stacked?
- Confirm the received/expected framing for income categories, and that a single UI component should serve both framings.
- Confirm the preload-once-per-fund/date-change fetch strategy (not fetch-per-category-selection) is acceptable.
- Is the reimbursement mark-paid dialog in scope for this increment, or a deliberate follow-up?

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** The feature shape is right and Phase 1's five open structural questions all have clean answers within existing precedent — nothing here requires a loop-back to Phase 1. Suggestions below are for Phase 3 to lock down explicitly, not open architectural risk.

Full ruling logged as **[DECISION-069](/Users/cshenso/git/westervillelions/docs/decisions.md)** (search `DECISION-069`). Summary of the five rulings:

1. **Fetch strategy:** scope to `(fundId, fiscalYear-derived-from-txnDate)`, not per-category-selection and not whole-entity-across-every-FY-ever-budgeted. One request per fund+FY pair returns every category's/line's figures; the category and budget-line pickers keep filtering client-side exactly as they do today. Effect dependency is `[fundId, derivedFiscalYear]` — the *derived* FY, not raw `txnDate` — so editing the day-of-month inside the same fiscal year never refetches. This mirrors the exact dependency shape `transaction-form.tsx`'s existing `budgetLineId` auto-clear effect already uses (line 284) and, applied at mount, satisfies Flow 4 (edit mode shows context immediately) for free.
2. **Query placement:** new sibling module `src/lib/ledger-budget-context-queries.ts`, not an extension of `getFundReport()` and not a new call site inside the already-5,000+-line `ledger-queries.ts`. This is the fourth module in the same lineage as `financial-report-queries.ts` (DECISION-049), `ledger-search-queries.ts` (DECISION-062), and `ledger-category-queries.ts` (DECISION-065) — same rationale each time: a narrower read surface composing the existing pure-arithmetic engine, not a rework of the heavy whole-fund-report function. `getFundReport()` specifically isn't reusable as the data source here: it's posted-only with no per-category pending breakdown (only a single fund-wide `pendingExpenseCents`), and it computes several things this feature doesn't need (rollforward, a second categories query, the full cause-actuals pool).
3. **Avoiding a fourth arithmetic implementation:** the new query reuses `resolveCauseLineActual`, `causeLineReferenceKey`, `isEligibleForFuzzyCauseMatch`, and `buildCauseActualsByKey` from `src/lib/ledger.ts` for cause-line actuals (becoming a third consumer of `resolveCauseLineActual`, exactly what its own doc comment anticipates), and `budgetVariance()` for the category-grain figure. `lib/ledger.ts` has no DB import and is already client-safe — confirmed by reading its header comment ("pure functions, no DB access") and import list (only `getFiscalYear`) — so the client-side "projected after this transaction" figure reuses the identical `budgetVariance()` call rather than reimplementing subtraction in the component. The posted-only half of this feature's number and `getFundReport()`'s number are required to share the identical `status === 'posted'` predicate and the identical helper functions — that shared-helper requirement, not merely "similar logic," is what stops the two from drifting apart.
4. **Posted vs. pending divergence:** express it as two explicitly labeled fields (`postedCents`, `pendingCents`) on every returned row, not a boolean `opts` parameter and not two call sites. There is exactly one consumer of this new query today, so a mode flag would be speculative; a labeled dual-figure return is self-documenting at the type level (a future posted-only caller reads one field and ignores the other, no need to know a flag ever existed) and gives the UI component both numbers it needs to satisfy the treasurer's "label what it counts" requirement directly.
5. **Server/client split:** new route handler `GET /api/admin/ledger/budget-context` (Node runtime; `auth()` + `hasFeature(BUDGET_VIEW) || hasFeature(LEDGER_MANAGE)`, per the treasurer's explicit gating call — this is a distinct capability check from `LEDGER_RECORD`/`LEDGER_MANAGE` reaching the dialog). New client component `src/components/admin/ledger/budget-context-panel.tsx` owns its own fetch effect and the current/projected arithmetic; `transaction-form.tsx` passes it `fundId`/`categoryId`/`budgetLineId`/`flow`/`txnDate`/`amount` as props. This is the first client-side `fetch()` inside `transaction-form.tsx` itself, but not a new pattern for the directory — `category-merge-dialog.tsx`, `budget-cause-editor.tsx`, and several sibling client components under `src/components/admin/ledger/` already fetch their own route handlers on demand.
6. **Dependencies:** none needed. Confirmed against the five-point evaluation criteria — this is arithmetic on existing Drizzle-queried data rendered with existing Tailwind/shadcn primitives.

## Placement

- **Directory placement:**
  - `src/lib/ledger-budget-context-queries.ts` (new sibling query module)
  - `src/app/api/admin/ledger/budget-context/route.ts` (new route handler)
  - `src/components/admin/ledger/budget-context-panel.tsx` (new client component)
  - `src/components/admin/ledger/transaction-form.tsx` (modified — renders the new panel; no change to its existing preloaded-props pattern for `categories`/`budgetLines`)
- **Server vs Client split:** query module and route handler are server-only (import `@/lib/db`, never imported by a client component). `budget-context-panel.tsx` needs `'use client'` — it owns a `fetch()` effect and reactive state keyed on form inputs. `transaction-form.tsx` is already `'use client'`; no boundary change there, just a new child. The current/projected arithmetic (adding the in-progress `amount` field's parsed cents to the fetched baseline) is pure client-side computation via the shared `budgetVariance()` helper — no extra network round trip per keystroke.
- **Dependencies:** none. No new npm package required.

## Invariants Touched

- **Server/Client boundary** — respected. New DB-touching code stays server-only; the one new client-side data dependency goes through a route handler, matching existing precedent elsewhere in this same component directory (not a new pattern for the codebase, just new to this one file).
- **Permissions are the only gating mechanism** — respected, and reinforced: the new route handler must check `hasFeature(BUDGET_VIEW) || hasFeature(LEDGER_MANAGE)` explicitly, distinct from the `LEDGER_RECORD`/`LEDGER_MANAGE` check that gates reaching the dialog at all. No new `FEATURES` key, no new role binding — this is a second explicit check on an existing key, per the treasurer's decision. Phase 3/4 must not skip this check on the theory that "you can't reach the dialog without `ledger.record` anyway" — Phase 1 already flagged that as coincidence, not structure.
- **Schema is the source of truth** — untouched. No schema changes; this feature reads existing `ledgerBudgets`/`ledgerBudgetLines`/`ledgerTransactions` rows only.
- **Migrations re-run on every deploy** — not applicable; no migration in this feature.
- **No native browser dialogs** — not applicable; this is a read-only informational panel, no confirm step (Phase 1's Out of Scope list already excludes a submission-blocking warning).

## Notes

Phase 3 must additionally decide, within the ruling above (none of these reopen a Phase 2 question, but Phase 3 must not improvise them either):

- **Whether the fuzzy cause-line-match pool (`isEligibleForFuzzyCauseMatch`/`buildCauseActualsByKey`) includes pending transactions or stays posted-only for this feature.** `getFundReport()` builds that pool from `postedTxns` only, by explicit design. This feature's linked-actual side (`budgetLineId`-keyed) will naturally include pending transactions once the query stops filtering by status — but the *fuzzy fallback* side (payee-name matching, used when there's no explicit link) was never designed against pending data. Recommend: fuzzy fallback stays posted-only in both `postedCents` and `pendingCents` derivations (mirrors today's only precedent exactly); a pending transaction only ever contributes via its own `postedCents`/`pendingCents` split at the category or explicit-link grain. Name this explicitly in the Phase 3 design doc rather than leaving it to Phase 4 to infer from reading `getFundReport()`.
- **Response payload shape for the "no budget row exists" vs. "budget row exists but is zero" cases** (Flow 2 / Phase 1's empty-state gap) should reuse the same `budgetCents: number | null` convention `FundReportCategoryLine` already uses (null = no row, matching `resolveDisplayBudgetCents`'s existing annotation-only discriminator) — do not invent a second null-vs-zero convention for this one payload.
- **Component styling:** the brand-consistency precedent Phase 1 already named (the Transfer/Sweep inline notes at `transaction-form.tsx:556-578`, `rounded-lg bg-gray-50 border border-gray-200` / `rounded-lg bg-blue-50 border border-blue-200`) is the right template for `budget-context-panel.tsx` — informational, non-interactive, `rounded-lg` (not `rounded-2xl`, since this isn't a card in the UX-guideline sense, it's inline form context, same category as the existing Transfer/Sweep notes). No `<ConfirmDialog>` needed (no destructive action). Must stack vertically without horizontal scroll at 360px per the existing dialog's mobile behavior.
- **Named unit tests for Phase 3 to enumerate** (Phase 4 gate requires these be written, not qa): FY-boundary re-derivation on back-date (Flow 3), posted+pending sum vs. posted-only-report divergence stays a labeled pair not a silent merge, category-with-no-budget-row returns `null` not `0`, line-selected-shows-line-and-parent (treasurer decision #3), income framing renders "received/expected" not "budgeted/spent" for income-flow categories.

Nothing here warrants a loop-back. Phase 3 can proceed directly to design.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

We're adding a read-only "budget context" panel to `TransactionForm` (`src/components/admin/ledger/transaction-form.tsx`)
so a treasurer entering an income or expense transaction sees, right next to the category/budget-line pickers, how much
of that category's (or cause line's) fiscal-year budget has already been used — counting both posted and pending
transactions, labeled separately — and what the figure becomes if the transaction being typed right now is saved. This
closes the gap where the only place to check "am I about to overspend?" today is a completely separate page
(`/admin/ledger/budgeting`), forcing the treasurer to abandon the entry they're mid-typing to go look. No schema
changes; this is a new read path over data that already exists (`ledgerBudgets`, `ledgerBudgetLines`,
`ledgerTransactions`), reusing the pure arithmetic already proven in `src/lib/ledger.ts`. This design executes
DECISION-069's five architectural rulings; nothing here reopens them.

## Permissions

- No new `FEATURES` key. The new route handler gates on the existing keys: `hasAnyFeature(session.user.id, [FEATURES.BUDGET_VIEW, FEATURES.LEDGER_MANAGE])` — `hasAnyFeature` (`src/lib/permissions-server.ts:86-92`) is the established helper for this exact "any of" shape, already used identically in `PATCH /api/admin/ledger/budgets` and `PATCH /api/admin/ledger/budget-notes`. This is deliberately a *second*, independent check from the `LEDGER_RECORD`/`LEDGER_MANAGE` check that already gates reaching the dialog — per the treasurer's decision and Phase 1's finding that today's "every `ledger.record` role also holds `budget.view`" is coincidence, not structure.
- Default role bindings: none to add — reuses `budget.view` (bound to `admin`, `treasurer`, `board_member`, `budget_committee` per `drizzle/migrations/0069_ledger_budget_permissions.sql`) and `ledger.manage` (bound to `admin`, `treasurer` per `drizzle/migrations/0045_ledger_permissions.sql`).

## Query Contract — `src/lib/ledger-budget-context-queries.ts` (new sibling module)

```ts
export type BudgetContextCategoryRow = {
  categoryId: string;
  categoryName: string;
  flow: "income" | "expense";
  /** null = no ledgerBudgets row for (fundId, fiscalYear, categoryId, flow),
   *  OR an annotation-only row (resolveDisplayBudgetCents convention below).
   *  Never a fabricated 0 — see Panel States, "No budget set." */
  budgetCents: number | null;
  postedCents: number;
  pendingCents: number;
};

export type BudgetContextLineRow = {
  budgetLineId: string;
  categoryId: string;   // the line's OWN parent category — see Edge Cases
  categoryName: string;
  cause: string;
  label: string;
  budgetCents: number;  // ledgerBudgetLines.amountCents — NOT NULL at the schema level, always a number
  postedCents: number;
  pendingCents: number;
};

export type BudgetContext = {
  fiscalYear: number;
  categories: BudgetContextCategoryRow[]; // every active category for this fund's kind, budgeted or not
  lines: BudgetContextLineRow[];          // every budget line under a ledgerBudgets row for this fund+FY
};

export async function getBudgetContext(
  fundId: string,
  fiscalYear: number,
): Promise<BudgetContext | null>  // null = fund not found, mirrors getFundReport's contract
```

**Which transactions are counted.** One transaction fetch, scoped to `(fundId, fyBounds(fiscalYear))` (`gte(txnDate, start)`,
`lt(txnDate, end)` — same bounds helper `getFundReport` uses at `ledger-queries.ts:558`) and additionally filtered in SQL to
`status IN ('posted', 'pending')` — i.e. `rejected` rows are never fetched at all, not merely ignored after the fact. This is
the mechanism that makes "rejected never counts" true by construction rather than by a filter someone could accidentally
drop. Split the result into `postedTxns` / `pendingTxns` by `status`, mirroring `getFundReport`'s existing `postedTxns` split
(`ledger-queries.ts:705`).

**Category grain, single pass over both transaction sets:**
- `postedByKey` / `pendingByKey`: two `Map<string, number>` keyed by `` `${categoryId}_${flow}` ``, built exactly like
  `getFundReport`'s `actualMap` (`ledger-queries.ts:710-716`) — one loop over `postedTxns`, one over `pendingTxns`.
- For every active category for this fund's `(entityId, kind)` (same `ledgerCategories` query as `getFundReport` step 3,
  `ledger-queries.ts:576-586` — **no "extra categories" pass**, unlike `getFundReport`: this query only serves live
  picker lookups against the `categories` prop the form already preloaded, so a category that's been deactivated and
  no longer appears in any picker doesn't need a row here. This is an intentional trim, not an oversight — name it in
  code as such.), look up `budgetRows` for `(fundId, fiscalYear)` (`ledger-queries.ts:589-597`) to get `rawBudgetCents`,
  `starred`, `note`, and whether the row has cause lines (`causeLinesByBudgetId`, same batched fetch as
  `ledger-queries.ts:630-646`). Apply `resolveDisplayBudgetCents(rawBudgetCents, hasCauseLines, starred, note)` from
  `lib/ledger.ts:2077` — the exact same annotation-only-zero-row discriminator `getFundReport` uses — so a starred/noted
  $0 row reads as "no budget set" here too, not as a fabricated $0-with-spend. This was flagged explicitly in Phase 2's
  Notes as the convention to reuse rather than invent a second one.

**Cause-line grain**, reusing `lib/ledger.ts`'s helpers exactly as DECISION-069 ruling 3 requires:
- `linkedPostedByLineId` / `linkedPendingByLineId`: two maps built from `postedTxns` / `pendingTxns` respectively, filtered
  to `flow === 'expense' && txn.budgetLineId`, same shape as `getFundReport`'s `actualByBudgetLineId` (`ledger-queries.ts:722-735`).
- The fuzzy `causeActualsByKey` pool is built **from `postedTxns` only**, via `isEligibleForFuzzyCauseMatch` +
  `buildCauseActualsByKey` (`ledger-queries.ts:746-756`, unchanged) — **pending transactions never enter the fuzzy pool**,
  per Phase 2's explicit note. A pending transaction's dollars only ever reach a specific line through an explicit
  `budgetLineId` link; an un-linked pending expense still counts at the *category* grain (it's in `pendingByKey`) but
  isn't attributed to any one cause line.
- For each budget line: `resolveCauseLineActual(linkedPostedByLineId.get(line.id) ?? 0, causeActualsByKey[fallbackKey] ?? null)`
  gives `postedCents` (`.cents`) exactly as `getFundReport` computes it today — same predicate, same helper, cannot drift.
  `pendingCents` is simply `linkedPendingByLineId.get(line.id) ?? 0` — direct link only, no fallback branch (there is no
  pending-eligible fuzzy pool to fall back to).

**Response.** `categories` includes every active category for the fund's kind (budgeted or not — bounded to tens of rows,
same bound `BudgetLinePicker`'s candidate list already assumes). `lines` includes every `ledgerBudgetLines` row under this
fund+FY's `ledgerBudgets` rows, each carrying its own `categoryId`/`categoryName` so the panel never has to cross-reference
back into `categories` to find a line's parent (see Edge Cases, "line whose parent differs from the chosen category"). No
`asOfDate` parameter — unlike `getFundReport`, this feature always wants "as of right now," never a historical report date.

## API Contract

`GET /api/admin/ledger/budget-context?fundId=<uuid>&fiscalYear=<int>`

- Query params: `fundId` (required, UUID), `fiscalYear` (required, integer; reuse the `budget-approvals` route's existing
  2000–2100 sanity bound).
- Response 200: `{ fiscalYear: number, categories: BudgetContextCategoryRow[], lines: BudgetContextLineRow[] }`
- 400: `fundId` missing/not a UUID, or `fiscalYear` missing/non-integer/out of range.
- 401: no session (`!session?.user?.id`).
- 403: `!(await hasAnyFeature(session.user.id, [FEATURES.BUDGET_VIEW, FEATURES.LEDGER_MANAGE]))` — generic
  `{ error: "Forbidden" }`, no data leaked in the body.
- 404: `getBudgetContext` returns `null` (fund not found) — mirrors every other fund-scoped GET in this directory.
- 500: unhandled error, generic `{ error: "..." }`, matching the try/catch shape every route in
  `src/app/api/admin/ledger/**` already uses (see `donors/route.ts`, `reimbursements/route.ts`).

## Data Model

No schema changes required. Reads existing `ledgerBudgets`, `ledgerBudgetLines`, `ledgerTransactions`, `ledgerCategories` only.

## Component / Page Plan

- Files to create:
  - `src/lib/ledger-budget-context-queries.ts` — query module above (server-only, imports `@/lib/db`).
  - `src/app/api/admin/ledger/budget-context/route.ts` — route handler above.
  - `src/components/admin/ledger/budget-context-panel.tsx` — client panel (below).
- Files to modify:
  - `src/components/admin/ledger/transaction-form.tsx` — renders the new panel, derives `parsedAmountCents` once via
    the file's existing `parseDollars(amount)` (line 101-105, already used at submit time) and threads it down as a prop
    rather than duplicating or exporting that parser for the panel to re-implement.

### `budget-context-panel.tsx` props

```ts
interface BudgetContextPanelProps {
  fundId: string;
  txnDate: string;             // 'YYYY-MM-DD'
  flow: "income" | "expense";  // resolveApiFlow(flowMode) — never called for transfer/sweep, see render gate below
  categoryId: string;          // "" = none chosen yet
  budgetLineId: string;        // "" = none chosen
  amountCents: number | null;  // parseDollars(amount) result — null while empty/zero/invalid
}
```

The panel owns its own `fetch()` effect, keyed on `[fundId, derivedFiscalYear]` where `derivedFiscalYear =
getFiscalYear(new Date(txnDate + "T00:00:00"))` — the identical 4-line inline parse `BudgetLinePicker` already does at
`budget-line-picker.tsx:42-48` and `transaction-form.tsx`'s own effect does at lines 282-284. Not extracted into a new
shared helper: it's already duplicated twice in this codebase without complaint, and a third inline copy is more honest
than introducing a one-line-saving abstraction three call sites deep. All lookups (`categories.find(...)`,
`lines.find(...)`) and the current/projected arithmetic happen client-side against the fetched `BudgetContext` payload —
zero additional network round-trips per keystroke or per category/line selection, per DECISION-069 ruling 1.

### Render placement in `transaction-form.tsx`

Renders immediately after the Category `<select>` block (after line 660, before the "Party" field at line 662), gated on
the **same condition as the Category select itself** — `!isTransferOrSweep && !isEditingTransfer` — **not**
`showBudgetLineSection` (which is expense-only, line 240). This is what makes the panel visible for income transactions
too (Flow 5), where there is no `BudgetLinePicker` at all. Placement relative to the later `BudgetLinePicker` block
(lines 745-774, which can rewrite `categoryId` via its `onSelect` handler at line 767) doesn't create a staleness risk:
`categoryId`/`budgetLineId` are React state on the parent, and picking a line updates both `categoryId` and `budgetLineId`
in the same event handler, so the panel — wherever it sits in the JSX tree — re-renders with the already-consistent pair
on the very next paint. No effect ordering to get wrong.

Styling matches the existing inline informational-note precedent in this same file (Transfer note, `rounded-lg bg-gray-50
border border-gray-200`, lines 556-561; Sweep note, `rounded-lg bg-blue-50 border border-blue-200`, lines 565-578) —
`rounded-lg`, not `rounded-2xl` (this is inline form context, not a card). No `<ConfirmDialog>` — no destructive action.
Text stacks vertically by default (block-level `<p>`s, no forced side-by-side layout), so 360px is satisfied without a
separate mobile treatment.

## Fiscal-Year Rule

FY is derived from `txnDate`, never from today's date — `getFiscalYear(new Date(txnDate + "T00:00:00"))`, same parse as
`transaction-form.tsx:282-284`'s existing `budgetLineId` auto-clear effect. The panel's fetch effect depends on
`[fundId, derivedFiscalYear]` (the *derived* FY, per DECISION-069 ruling 1) — editing the day-of-month within the same
fiscal year never refetches; crossing a FY boundary (e.g. back-dating a June 2026 expense while today is August 2026)
does.

**What renders while a FY-crossing refetch is in flight — the single highest-consequence case Phase 1 flagged (Flow 3).**
The panel does not gate on "is a fetch in flight"; it gates on `payload.fiscalYear !== derivedFiscalYear`. Track the last
*requested* FY alongside the last *loaded* FY:

- The moment `derivedFiscalYear` changes, the panel enters the Loading state **synchronously**, before the new
  `fetch()` even resolves — it never continues showing the previous FY's numbers under a new-FY date, because the
  render condition checks the derived FY against the loaded payload's `fiscalYear`, not a boolean "loading" flag that
  could lag one render behind.
- A resolved response is only committed to state if its request's FY still matches the *current* `derivedFiscalYear` at
  resolution time (a standard "ignore stale response" guard) — this covers the case where a treasurer flips the date
  back and forth quickly and a slow first request resolves after a faster second one.
- This is exactly the case Phase 1 called "a confidently wrong number is worse than no number" about — it must be an
  explicit QA click-through in Phase 5 (back-date across a FY boundary with the network throttled), not assumed correct
  because the dependency array "looks right."

## Panel States

Rendered whenever `!isTransferOrSweep && !isEditingTransfer` (same gate as the Category select), independent of whether
a category is chosen — the panel itself decides what to show:

1. **No category chosen** (`categoryId === ""`): render nothing — no empty box, no skeleton. The existing Transfer/Sweep
   notes in this same form already appear/disappear conditionally (lines 556, 565), so a panel that pops in once a
   category is picked is consistent with this form's existing behavior, not a new pattern.
2. **Loading** (`derivedFiscalYear !== loadedFiscalYear`, including the very first mount): a muted `rounded-lg bg-gray-50
   border border-gray-200` block, "Loading budget context…" — never numbers, never the previous FY's figures.
3. **Fetch failed**: a *visually distinct* block — `rounded-lg bg-amber-50 border border-amber-200 text-amber-800`,
   "Couldn't load budget context." with a plain-text "Try again" retry action (re-triggers the effect; not a
   `<ConfirmDialog>`, nothing destructive). Amber, not gray — so this state can never be mistaken for "no budget set,"
   which is Phase 1's explicit failure mode to avoid.
4. **No budget set for this category/FY** (`budgetCents === null` after `resolveDisplayBudgetCents`): "No budget set
   for FY{fiscalYear}." in neutral gray — **no "$X of $Y" framing at all**, since there is no Y. If posted+pending
   activity exists anyway (a category spent against with no budget row), append a plain factual aside with no
   progress framing: "No budget set for FY{fiscalYear} — $340 recorded so far." Never a percentage, never a bar,
   never the word "over."
5. **Expense, category grain, budget present, no line selected**: "$570 of $700 used ($420 posted + $150 pending)."
   If `amountCents` is a valid positive parse (see Projected Figure below), append "→ $700 after this one." Negative
   variance (projected > budget) renders the whole figure in `text-amber-700` — the exact precedent `budget-overview-table.tsx`'s `StatCell` already uses for a negative `Net` figure (`warn` prop, line 139) — never `text-red-*` (forbidden brand color) and never a blocking UI element.
6. **Expense, line selected** (per treasurer decision #3 — line first, parent underneath): the line's own figure
   ("[Cause] — [Label]: $A of $B used → $C after this one"), then a visually subordinate second line for the parent
   category's full rollup ("[Category name] overall: $D of $E used → $F after this one"). Both computed via the same
   `budgetVariance()` call, once per grain — never two different arithmetic paths.
7. **Income, category grain**: "received"/"expected" framing per treasurer decision #4 — "$3,200 of $5,000 received,"
   projected "→ $3,650 after this gift." Never amber/warning styling when projected exceeds expected — exceeding an
   income budget is good news, not a risk signal, so the over-100% case renders in the same neutral/positive tone as
   under-100%, explicitly never reusing state 5's amber treatment.
8. **Loading/failed/no-budget states apply identically to income** — same visual treatment, only the verb framing
   (state 7 vs. 5/6) differs. One component renders both framings from a `flow` prop, not two components or a
   search-replaced copy (per Phase 1's explicit requirement that this not be a copy-paste risk).

## Projected Figure

Computed entirely client-side, reusing `budgetVariance()` from `lib/ledger.ts` — the same function the category/line
grain already uses for the "current" figure, called a second time with `actualCents` replaced by
`(postedCents + pendingCents + amountCents)`. No separate addition/subtraction reimplemented in the component; one
function computes this arithmetic everywhere it's computed (DECISION-069 ruling 3).

- `amountCents === null` (empty field, "0"/"0.00" — `parseDollars` already returns `null` for both, `transaction-form.tsx:101-105` — or non-numeric input mid-typing): suppress the "→ $Z after this one" clause entirely. Show only the current figure. Showing a projected total that silently assumes "+$0" would misrepresent an amount the treasurer just hasn't finished typing yet — this is the same "confidently wrong is worse than no number" principle applied to the projection specifically.
- `amountCents` a valid positive integer: show the projected clause, recomputed via `budgetVariance()` as above.
- **Update cadence: every keystroke, no debounce.** This is pure client-side arithmetic against an already-fetched
  payload — no network call is triggered by typing in the Amount field, so there is no cost a debounce would be
  protecting against. `amount`'s existing `onChange` (`transaction-form.tsx:617`) already re-renders the form on every
  keystroke; the panel simply reads the freshly parsed `amountCents` prop on that same render.

## Edge Cases & Risks

- **Lump-sum category, no cause lines.** `lines.filter(l => l.categoryId === categoryId)` is simply `[]` — the panel
  renders category grain only (state 5/7), no line-grain block. No special-casing needed; falls out of an empty filter.
- **Selected line's parent differs from the chosen category.** Cannot actually happen in the running form:
  `BudgetLinePicker`'s `onSelect` handler (`transaction-form.tsx:753-768`) unconditionally overwrites `categoryId` to
  the picked line's own `categoryId` in the same event handler that sets `budgetLineId`, so the two are never out of
  sync by the time the panel re-renders. The panel is still built defensively — it derives "parent category" for the
  line-selected state from the *line row's own* `categoryId`/`categoryName` fields (returned directly on
  `BudgetContextLineRow`), never from the form's separate `categoryId` prop — so it stays correct even if a future code
  path decouples them.
- **Fund changed after a category was chosen.** Already handled upstream: the existing effect at
  `transaction-form.tsx:262-267` clears `categoryId` when it no longer belongs to the newly-filtered category list, so
  the panel falls back to state 1 (no category chosen) on the very next render. The fund change also changes
  `derivedFiscalYear`'s companion `fundId` dependency, triggering a fresh fetch — no cross-fund staleness risk. The
  budget-line auto-clear effect (`transaction-form.tsx:275-288`) does the same for `budgetLineId`.
- **A category with a budget in a different fund.** The query is scoped to `(fundId, fiscalYear)` — a same-named
  category's budget row under a *different* `fundId` is a genuinely different `ledgerBudgets` row (the unique
  constraint is `(fundId, fiscalYear, categoryId, flow)`) and is simply never fetched. The panel correctly shows "No
  budget set for FY{fiscalYear}" for that fund even though the category has budget history elsewhere — this is
  correct behavior, not a bug, and should be named as such in code comments so a future reader doesn't "fix" it.
- **Editing an existing transaction.** `initialValues` already populates `fundId`/`txnDate`/`categoryId`/`budgetLineId`
  before first render (`transaction-form.tsx:166-207`), so the panel's mount-time effect fires with real values
  immediately — context is visible on dialog open, matching Flow 4, with no special-casing in the panel itself (it only
  ever reacts to its current props, blind to create-vs-edit mode).
- **Reimbursement mark-paid dialog (`pay-reimbursement-dialog.tsx`) — OUT OF SCOPE for this increment.** Phase 1 listed
  this explicitly under "Out of Scope (confirm with user)," and the treasurer's 2026-08-08 decisions didn't override
  it. `BudgetContextPanel`'s props (`fundId`/`txnDate`/`flow`/`categoryId`/`budgetLineId`/`amountCents`) are generic
  enough that wiring it into the reimbursement dialog later is a small follow-up (its `amount` prop is currently a
  fixed, non-editable string — the projected-figure UX would need a small adjustment there), not a redesign. Track as a
  backlog candidate rather than doing it now.

## Named Unit Tests for Phase 4

**`src/lib/ledger-budget-context-queries.test.ts`** (mocked Drizzle client, same call-order-canned-response pattern as
`ledger-queries.test.ts`):
1. A `rejected` transaction is never fetched/counted in either `postedCents` or `pendingCents` — assert the query's
   WHERE clause and/or that a seeded rejected row contributes to neither figure.
2. A `posted` and a `pending` transaction in the same category both land in the correct, separately-labeled field
   (`postedCents` vs. `pendingCents`) — never silently summed into one number.
3. A category with no `ledgerBudgets` row for `(fundId, fiscalYear)` returns `budgetCents: null`, not `0`.
4. A starred/noted annotation-only budget row (`annualAmountCents: 0`, no cause lines) also returns `budgetCents: null`
   via `resolveDisplayBudgetCents` — not a fabricated `$0` figure.
5. A cause line's `postedCents` resolves via the exact-link-wins-over-fuzzy-fallback rule (`resolveCauseLineActual`),
   and its `pendingCents` is direct-link-only with no fuzzy fallback applied.
6. A pending transaction with a non-blank `beneficiaryCause` but no explicit `budgetLineId` does **not** appear in any
   line's `pendingCents` (fuzzy pool is posted-only) but does count at the category grain.
7. `fiscalYear`/`fundId` scoping: a budget row for the same category in a different fund, or the same fund in a
   different fiscal year, never leaks into the response.

**`src/components/admin/ledger/budget-context-panel.test.tsx`** (or colocated with the component, per this repo's
existing UI-test convention — see `ledger-category-ui.test.ts`, `financial-report-ui.test.ts` for the pure-logic-out-of-
component pattern to follow if the arithmetic/framing logic is factored into small testable functions):
8. Projected = current (`postedCents + pendingCents`) + in-progress `amountCents`, via `budgetVariance()` — asserted
   against a fixed baseline and a range of `amountCents` inputs.
9. `amountCents === null` (empty, "0", non-numeric) suppresses the projected clause entirely rather than showing
   "+$0."
10. Income flow renders "received"/"expected" copy, never "used"/"budgeted."
11. FY-derivation: a `txnDate` before July 1 resolves to the prior calendar year's FY (mirrors `getFiscalYear`'s own
    existing test coverage, exercised here at the prop-to-fetch-key boundary) — and changing `txnDate` within the same
    derived FY does not change the fetch key.
12. Stale-response guard: a response whose `fiscalYear` no longer matches the current `derivedFiscalYear` prop at
    resolution time is never committed to displayed state.

**Route-level** (folded into whichever of the above two files is more natural, or a light `route.test.ts` if this
directory's convention has one for sibling routes — check `budget-notes`/`budgets` for precedent before adding a new
pattern):
13. Missing/insufficient permission (`BUDGET_VIEW` and `LEDGER_MANAGE` both absent) returns 403, not 200 with an empty
    payload — the failure mode must be visibly different from "no budget set."

## Out of Scope

- Editing the budget from inside the transaction dialog — read-only context only (Phase 1).
- A submission-blocking "you're about to exceed budget" confirmation — pure display, no new confirm step (Phase 1).
- Historical trend/burn-rate visualization — a snapshot only (Phase 1).
- Wiring the same panel into `pay-reimbursement-dialog.tsx` — explicitly deferred (see Edge Cases above).

## Implementation Order

1. **api-developer**: `src/lib/ledger-budget-context-queries.ts` (query module) → `src/app/api/admin/ledger/budget-context/route.ts`
   (route handler) → unit tests 1-7 and 13 above. Handoff point: route returns real data behind the permission gate,
   verified by curl/Postman or a route test, before any client code is written.
2. **ux-developer**: `src/components/admin/ledger/budget-context-panel.tsx` (new component, all 8 panel states, the
   projected-figure logic) → modify `src/components/admin/ledger/transaction-form.tsx` to render it and thread
   `parsedAmountCents` → unit tests 8-12 above.
3. Release notes entry via `/release-notes` when this is ready to merge to `main` (tech-lead, Phase 6 SHIP IT).

## Edge Cases & Risks (summary — see full Edge Cases section above for detail)

- FY-boundary refetch race (see Fiscal-Year Rule) is the single highest-consequence risk; must be an explicit QA
  click-through in Phase 5, not assumed correct from reading the effect's dependency array.
- Reused `resolveDisplayBudgetCents`/`resolveCauseLineActual`/`budgetVariance`/`isEligibleForFuzzyCauseMatch`/
  `buildCauseActualsByKey` must stay byte-for-byte the same functions `getFundReport` calls — if either module's import
  ever forks (a local copy "for convenience"), the transaction-entry number and the fiscal report's number can drift
  apart silently. Nothing structural prevents this except code review noticing a new local reimplementation — flag it
  explicitly if Phase 4 or a future PR introduces one.

## Implementer

**api-developer** for the query module + route handler (Phase 4a), then **ux-developer** for the panel + form
integration (Phase 4b). This is the specialist split, not full-stack-developer — the query/arithmetic surface alone
(seven named unit tests, three helper functions reused, a posted/pending split that must exactly mirror
`getFundReport`'s predicate) is substantial enough on its own, and the panel has eight distinct render states plus a
race condition to get right — splitting keeps each half reviewable against its own named test list rather than one
large diff spanning both.

## Phase 3 — Technical Design — 2026-08-08

**Owner:** tech-lead
**Status:** complete

### Summary

Designed a read-only budget-context panel for `TransactionForm`, executing DECISION-069's five rulings: a new
`ledger-budget-context-queries.ts` sibling module scoped to `(fundId, derived fiscal year)`, a `GET
/api/admin/ledger/budget-context` route gated on `BUDGET_VIEW`/`LEDGER_MANAGE`, and a new
`budget-context-panel.tsx` client component with eight distinct render states (before-category, loading, fetch-failed,
no-budget, expense/category, expense/line-selected, income, and the shared loading/failed states applied to income
too). Posted and pending transactions are both counted (rejected never is), always as two separately labeled fields;
income reads "received/expected," expense reads "used/budgeted"; a selected budget line shows its own figure with the
parent category's rollup underneath. The projected ("after this one") figure is computed client-side via the same
`budgetVariance()` helper `getFundReport()` already uses, updating on every keystroke with no debounce since it's pure
arithmetic against an already-fetched payload.

### What I did

- Read the Phase 1 analyst review and Phase 2 architect ruling (DECISION-069) in full, plus the treasurer's four
  2026-08-08 decisions and the "Carried from Phase 1" section.
- Traced the real code the design depends on: `getFundReport()`'s full structure (`ledger-queries.ts:544-883`) as the
  pattern to mirror; `resolveCauseLineActual`/`causeLineReferenceKey`/`isEligibleForFuzzyCauseMatch`/
  `buildCauseActualsByKey`/`budgetVariance`/`resolveDisplayBudgetCents` in `lib/ledger.ts`; `transaction-form.tsx`'s
  state, effects (the FY-derived `budgetLineId` auto-clear at lines 275-288, the fund/category reset at 262-267), and
  render structure (Category select at 640-660, Transfer/Sweep note styling precedent at 556-578, BudgetLinePicker
  wiring at 745-774); `budget-line-picker.tsx` and `pay-reimbursement-dialog.tsx` for the shared-picker/out-of-scope
  question; `permissions-server.ts`'s `hasAnyFeature` and its existing call sites in `budgets/route.ts` and
  `budget-notes/route.ts`; the `ledgerBudgets`/`ledgerBudgetLines`/`ledgerTransactions` schema; and
  `budget-overview-table.tsx`'s `StatCell` for the existing amber "warn" styling precedent.
- Wrote the full Query Contract, API Contract, Component/Page Plan, Fiscal-Year Rule (including the FY-switch race
  guard), Panel States (all 8), Projected Figure behavior, Edge Cases (7 named), and 13 named unit tests for Phase 4.
- Logged DECISION-070 for the five implementation-level calls this design makes beyond DECISION-069's architecture
  (null-vs-zero convention reuse, FY-race guard shape, amber styling reuse, no new shared FY-parse helper, reimbursement
  dialog confirmed out of scope).

### Outputs

- `docs/work-log/2026-08-08-budget-context-on-transaction-entry.md` — full Phase 3 design doc (this file, Phase 3
  section above).
- `docs/decisions.md` — DECISION-070 (implementation-level calls for this feature).

### Open questions / handoff notes

- Use the **api-developer** agent first for `src/lib/ledger-budget-context-queries.ts` and
  `src/app/api/admin/ledger/budget-context/route.ts`, plus unit tests 1-7 and 13 from the Named Unit Tests section.
  Hand off to ux-developer only once the route returns real, permission-gated data.
- Then use the **ux-developer** agent for `src/components/admin/ledger/budget-context-panel.tsx` and the
  `transaction-form.tsx` integration (render placement after the Category select, `parsedAmountCents` threading), plus
  unit tests 8-12.
- Flag for qa (Phase 5): the FY-boundary refetch race (Fiscal-Year Rule section) needs an explicit manual click-through
  with the network throttled, not just a code read — this is the single highest-consequence failure mode Phase 1
  identified.
- Reimbursement mark-paid dialog is explicitly out of scope for this increment (see Edge Cases) — worth a backlog entry
  if the treasurer wants it later, since it's a small follow-up given the panel's generic prop shape.

---

# Phase 4 — Implementation

## Phase 4a — Implementation (API) — 2026-08-08

**Owner:** api-developer
**Status:** complete

### Summary

Built the server half of the feature exactly per the Phase 3 contract: a new sibling query module
scoped to `(fundId, fiscalYear)` that fetches only `posted`/`pending` transactions (rejected is never
fetched, not merely filtered), reuses `lib/ledger.ts`'s existing pure helpers for every piece of
budget-vs-actual arithmetic, and a permission-gated route handler that serves it. Wrote and passed all
8 named unit tests assigned to this half (Phase 3 tests 1-7, plus extra positive-path coverage) and the
route-level test 13, with zero regressions against the 1067-test baseline.

### What I did

- Read the full work-log (Phase 1 analyst review, DECISION-069 architect ruling, DECISION-070 Phase 3
  implementation calls, the Phase 3 design doc's Query Contract/API Contract/Named Unit Tests, and the
  Treasurer Decisions) before writing any code.
- Read `getFundReport()` (`src/lib/ledger-queries.ts:544-883`) as the pattern to mirror, and the six
  reused pure helpers in `src/lib/ledger.ts` (`resolveCauseLineActual`, `causeLineReferenceKey`,
  `isEligibleForFuzzyCauseMatch`, `buildCauseActualsByKey`, `budgetVariance`,
  `resolveDisplayBudgetCents`) to confirm their exact signatures before calling them.
- Read `getBudgetLineOptions()` (`ledger-queries.ts:911`) and used its
  `ledgerBudgetLines → ledgerBudgets → ledgerCategories` inner-join shape as the precedent for resolving
  a cause line's own parent `categoryId`/`categoryName` in one query, rather than cross-referencing back
  into the separately-fetched `categories` array (per the design doc's Edge Cases section).
- Read `budget-notes/route.ts` and `budget-approvals/route.ts` for the `hasAnyFeature` gate pattern and
  the 2000-2100 `fiscalYear` sanity-bound precedent.
- Wrote `src/lib/ledger-budget-context-queries.ts` — `getBudgetContext(fundId, fiscalYear)`. Five
  sequential queries (fund lookup, txns restricted to `status IN ('posted','pending')` in SQL, active
  categories, budget rows, and a joined cause-line query), then two in-memory passes (category grain,
  cause-line grain) built the same way `getFundReport` builds its maps, reusing the six helpers named
  above with no local reimplementation.
- Wrote `src/app/api/admin/ledger/budget-context/route.ts` — `GET`, gated on
  `hasAnyFeature(session.user.id, [FEATURES.BUDGET_VIEW, FEATURES.LEDGER_MANAGE])`, with `fundId`
  UUID validation and the same `fiscalYear` 2000-2100 integer bound `budget-approvals` uses.
- Wrote `src/lib/ledger-budget-context-queries.test.ts` (14 tests covering Phase 3 named tests 1-7, plus
  a null-fund-lookup case, a genuine-$0-budget-row contrast case for test 4, a fuzzy-fallback-with-no-
  exact-link case for test 5, and an orphaned-line-with-null-categoryId defensive case) and
  `src/app/api/admin/ledger/budget-context/route.test.ts` (9 tests covering named test 13 plus the
  route's 400/401/404/200 contract) — 21 tests total, all against the mocked-Drizzle FIFO-select-queue
  pattern already established in `ledger-category-queries.test.ts`.
- Ran `pnpm exec tsc --noEmit` (clean), `pnpm test` (1088 passed, up from the 1067 baseline — 21 new,
  zero regressions), and `pnpm build:only` (passed; `/api/admin/ledger/budget-context` appears in the
  build's route list).

### Outputs

- **New file:** `src/lib/ledger-budget-context-queries.ts` — exports `getBudgetContext(fundId: string,
  fiscalYear: number): Promise<BudgetContext | null>` and the `BudgetContext` /
  `BudgetContextCategoryRow` / `BudgetContextLineRow` types, exactly as specified in the Phase 3 Query
  Contract (byte-for-byte field names: `budgetCents: number | null` on category rows, `budgetCents:
  number` — non-null — on line rows, `postedCents`/`pendingCents` on every row). Server-only (imports
  `@/lib/db`); never import this from a client component.
- **New file:** `src/app/api/admin/ledger/budget-context/route.ts` —
  `GET /api/admin/ledger/budget-context?fundId=<uuid>&fiscalYear=<int>`.
  - Auth/gate: `auth()` for session, then `hasAnyFeature(session.user.id, [FEATURES.BUDGET_VIEW,
    FEATURES.LEDGER_MANAGE])` — a second, independent check from whatever gates the calling page/dialog.
  - Request: query params `fundId` (required, UUID) and `fiscalYear` (required, integer, 2000-2100).
  - Response 200: `{ fiscalYear: number, categories: BudgetContextCategoryRow[], lines:
    BudgetContextLineRow[] }`.
  - 400: `fundId` missing/not a UUID, or `fiscalYear` missing/non-integer/out of range.
  - 401: no session. 403: `{ error: "Forbidden" }`, gate failed. 404: `{ error: "Fund not found" }`.
    500: `{ error: "Failed to load budget context" }`.
- **New file:** `src/lib/ledger-budget-context-queries.test.ts` (14 tests).
- **New file:** `src/app/api/admin/ledger/budget-context/route.test.ts` (9 tests).
- No schema changes — reads existing `ledgerFunds`, `ledgerCategories`, `ledgerTransactions`,
  `ledgerBudgets`, `ledgerBudgetLines` only. No migration.
- No new `FEATURES` key, no new role binding — reuses `BUDGET_VIEW`/`LEDGER_MANAGE` exactly as
  DECISION-069/070 specified.

### Implementer notes / divergence from the design doc

- One small, deliberate deviation from the Phase 3 sketch, noted per the "say so, don't fork" instruction:
  the design doc's prose describes fetching `budgetLineRows` unjoined and building `causeLinesByBudgetId`
  keyed by `budgetId` (mirroring `getFundReport`'s internal shape), then separately resolving each line's
  parent category. I instead used `getBudgetLineOptions()`'s existing inner-join shape
  (`ledgerBudgetLines → ledgerBudgets → ledgerCategories`, filtered to this fund+FY) to fetch
  `categoryId`/`categoryName` directly alongside each line in one query. This is a real precedent already
  in this codebase (not a new pattern), it satisfies the same requirement the design doc names in Edge
  Cases ("the panel derives 'parent category' from the line row's own `categoryId`/`categoryName`
  fields... never from the form's separate `categoryId` prop"), and it avoids a second local map-building
  pass the whole-fund `getFundReport` needs but this narrower query doesn't. No arithmetic helper was
  forked — `resolveCauseLineActual`/`causeLineReferenceKey`/`isEligibleForFuzzyCauseMatch`/
  `buildCauseActualsByKey` are called exactly as `getFundReport` calls them, just against this smaller
  fetch. Flagging this explicitly rather than silently diverging, per the design doc's own instruction.
- `ledgerBudgets.categoryId` is nullable at the schema level (`onDelete: 'set null'`). A budget-line row
  whose parent budget row's `categoryId` has gone null is excluded from the `lines` array rather than
  crashing or fabricating a categoryId — covered by its own test ("a budget line whose parent budget row
  has a null categoryId is excluded, not crashed on"). This can't happen through any live UI path today
  (categories aren't hard-deleted), but the type system's `BudgetContextLineRow.categoryId: string`
  (non-nullable) needed a defined behavior for the theoretical case, so I picked "exclude" over "throw."
- All 5 DB queries run unconditionally (fund, txns, categories, budgets, lines) rather than the
  `budgetIds.length > 0 ? ... : []` short-circuit `getFundReport` uses for its budget-line fetch — this
  query joins `ledgerBudgetLines → ledgerBudgets` directly on `(fundId, fiscalYear)` rather than an
  intermediate `budgetIds` array, so there's no empty-array case to short-circuit, and it keeps the
  query's call order fixed/predictable for both the mock tests and future readers.

### Open questions / handoff notes

- **Next agent: ux-developer.** Build `src/components/admin/ledger/budget-context-panel.tsx` (all 8
  panel states, the FY-switch race guard, the projected-figure arithmetic via `budgetVariance()`) and
  wire it into `src/components/admin/ledger/transaction-form.tsx` per the Phase 3 Component/Page Plan —
  the route above is live, gated, and returns real data in the exact shape the design doc's props
  (`BudgetContextPanelProps`) expect. Also write Phase 3's named tests 8-12
  (`budget-context-panel.test.tsx`).
- The route has NOT been manually curled/clicked through against a real dev DB — only unit-tested against
  a mocked Drizzle client and confirmed to type-check/build. Recommend qa's Phase 5 click-through include
  at least one direct `GET` against a real fund/FY to confirm the live query shape matches the mocked
  test shape (the mocked tests prove the module's *logic*, not that the real schema's column names/types
  line up with what Drizzle returns at runtime — `pnpm build:only`'s type-check is the strongest signal
  available pre-QA that they do, since Drizzle's inferred row types are structurally checked against the
  code that consumes them).
- Flagging again for qa per the design doc: the FY-boundary refetch race is UI-side (ux-developer's
  panel), not something this half's tests can exercise — it needs the explicit network-throttled manual
  click-through Phase 3 called for.
- Did not touch `transaction-form.tsx` or build any client component — confirmed out of scope for this
  half per the task's explicit instruction.

## Phase 4b — Implementation (UI) — 2026-08-08

**Owner:** ux-developer
**Status:** complete

### Summary

Built the client half exactly per the Phase 3 contract's 8 named panel states: a new pure-logic
sibling module (`src/lib/budget-context-panel-ui.ts`) holding the FY-derivation, the FY-boundary
race guard, the current/projected arithmetic (via the shared `budgetVariance()` helper — no local
reimplementation), and the income/expense copy framing; a `'use client'` panel component
(`budget-context-panel.tsx`) that owns the fetch effect and renders off that pure module; and the
`transaction-form.tsx` integration, rendered right after the Category select on the same
`!isTransferOrSweep && !isEditingTransfer` gate the select itself uses (not the expense-only
`showBudgetLineSection`), so income transactions get context too. Wrote and passed all 5 named unit
tests assigned to this half (Phase 3 tests 8-12) against the pure module — no RTL/jsdom added, per
this project's `environment: "node"` Vitest config.

### What I did

- Read the full work-log (Phase 1 analyst review, DECISION-069 architect ruling, DECISION-070 Phase 3
  implementation calls, the Phase 3 design doc's Query/API Contracts, Panel States, Fiscal-Year Rule,
  and Named Unit Tests) and DECISION-069/070 in `docs/decisions.md` before writing any code.
- Read the already-built server half: `src/lib/ledger-budget-context-queries.ts` (`getBudgetContext`
  and its `BudgetContext`/`BudgetContextCategoryRow`/`BudgetContextLineRow` types) and
  `src/app/api/admin/ledger/budget-context/route.ts` — confirmed the response shape and the
  `budgetCents: number | null` no-budget convention before consuming it.
- Read `transaction-form.tsx` in full (the Category select at lines 640-660, the
  `BudgetLinePicker` wiring at 745-774 including its `onSelect` handler that keeps `categoryId` and
  `budgetLineId` in sync, the FY-derived `budgetLineId` auto-clear effect at 275-288, and the
  Transfer/Sweep inline-note styling precedent at 556-578), `budget-line-picker.tsx` (the txnDate→FY
  inline-parse precedent this feature's third copy mirrors), `lib/ledger.ts`'s `budgetVariance()` and
  `BudgetVarianceResult` type, and `budget-overview-table.tsx`'s `StatCell` (`text-amber-700` "warn"
  precedent — confirmed no `text-red-*` anywhere in the reused pattern).
- Read `financial-report-ui.ts`/`ledger-category-ui.ts` and their `.test.ts` siblings as the
  established "pure-logic-out-of-component" pattern for this codebase, and followed it: all
  FY-derivation, race-guard, arithmetic, and copy-framing logic lives in
  `src/lib/budget-context-panel-ui.ts` (no DB import, no async), leaving the component itself thin —
  a fetch effect plus a render switch over that module's outputs.
- Wrote `src/lib/budget-context-panel-ui.ts`:
  - `deriveFiscalYearFromTxnDate(txnDate)` — the same 4-line inline parse duplicated a third time,
    per the design doc's explicit instruction not to extract a fourth shared helper.
  - `isResponseCurrent(responseFiscalYear, currentDerivedFiscalYear)` — the stale-response half of
    the FY-race guard.
  - `computeBudgetFigures(budgetCents, postedCents, pendingCents, amountCents)` — calls
    `budgetVariance()` twice (current, then projected against `postedCents + pendingCents +
    amountCents`); `projected` is `null` when `amountCents` is `null` or `<= 0`.
  - `isOverBudgetWarn(flow, figures)` — `false` unconditionally for income; for expense, true only
    when the most-advanced known figure (projected if present, else current) is negative.
  - `formatGrainCopy(flow, fiscalYear, budgetCents, postedCents, pendingCents, amountCents)` — the
    ONE function that renders both the expense ("used"/"budgeted") and income ("received"/"expected")
    framings from the `flow` parameter (Panel States 4, 5, 6-per-grain, 7). Renders "No budget set for
    FY{year}[ — $X recorded so far.]" when `budgetCents === null` — never "$0 of $0." Only appends the
    "(X posted + Y pending)" breakdown when `pendingCents > 0` — an implementation call beyond what
    Phase 3's prose examples show verbatim (see divergence note below).
  - `formatCauseLineLabel(cause, label)` — matches `BudgetLinePicker`'s own `"{cause} — {label}"` /
    `"{cause}"` option-label convention exactly, so a selected line reads identically in the picker
    and in the context panel underneath it.
- Wrote `src/components/admin/ledger/budget-context-panel.tsx`:
  - Fetch effect keyed on `[fundId, derivedFiscalYear, reloadToken]` (NOT raw `txnDate` — editing the
    day-of-month within the same FY never refetches, per DECISION-069 ruling 1).
  - `currentFiscalYearRef` (a `useRef`, updated in the render body every render) is what the
    `.then()`/`.catch()` closures check against at resolution time — NOT the closure-captured
    `requestedFiscalYear` compared against itself, which would trivially always pass. This is the
    actual race-guard mechanism; `isResponseCurrent()` is the pure comparison, the ref is what makes
    the comparison meaningful across a stale closure.
  - `AbortController` cancels the in-flight request on cleanup as a second, belt-and-suspenders guard
    on top of the ref check (covers the case where React batches a fast double-fire).
  - Render gate (`effective`) is computed fresh every render by comparing `loadState`'s carried
    `fiscalYear` against `derivedFiscalYear` — never a separate `isLoading` boolean that could lag a
    render behind, exactly as the Fiscal-Year Rule section specifies.
  - Panel State 1 (no category chosen): returns `null` before any of the loading/error/ready branches
    — no empty box ever flashes while a category is unselected, even though the fetch itself runs
    unconditionally (context data is fund+FY-scoped, not category-scoped).
  - Panel State 3 (fetch failed): `rounded-lg bg-amber-50 border border-amber-200 text-amber-800`
    with a plain-text "Try again" button (`onClick` bumps `reloadToken`) — not a `<ConfirmDialog>`,
    nothing destructive.
  - Panel States 4/5/6/7: category-only vs. line-selected-with-parent-rollup, built from two
    `formatGrainCopy()` calls in the line-selected case (line first, category "overall" second,
    visually subordinate via `text-xs`) — matches Treasurer Decision 3.
  - Amber-for-over-budget is applied to the FIGURE TEXT ONLY (`text-amber-700 font-medium`), not the
    surrounding block, which always stays `bg-gray-50 border-gray-200` for states 4-7 — this is what
    keeps an over-budget warning visually distinct from the fully-amber fetch-FAILED block (Phase 1's
    explicit "must never render identically" requirement, extended to also distinguish "over budget"
    from "couldn't load").
- Modified `src/components/admin/ledger/transaction-form.tsx`:
  - Added `parsedAmountCents = parseDollars(amount)` (reusing the file's existing parser, not a
    duplicate), computed once alongside the other derived values.
  - Rendered `<BudgetContextPanel>` immediately after the Category `<select>` block, gated on
    `!isTransferOrSweep && !isEditingTransfer` — the same condition as the Category select itself,
    NOT `showBudgetLineSection` — so income transactions render the panel too (there is no
    `BudgetLinePicker` for income at all).
- Wrote `src/lib/budget-context-panel-ui.test.ts` — 24 tests covering Phase 3 named tests 8-12 (plus
  supporting cases: no-budget-set current/projected shape, `amountCents <= 0` treated defensively like
  `null`, income never warns even when exceeding its budget, expense warns only when the most-advanced
  figure is negative, and `formatCauseLineLabel`'s blank-label fallback).
- Ran `pnpm exec tsc --noEmit` (clean), `pnpm test` (1113 passed, up from the 1088 baseline handed off
  by api-developer — 25 new, zero regressions), and `pnpm build:only` (compiled successfully;
  `/api/admin/ledger/budget-context` still present in the route list, unchanged from Phase 4a).

### Outputs

- **New file:** `src/lib/budget-context-panel-ui.ts` — pure logic (FY derivation, race guard,
  current/projected arithmetic via `budgetVariance()`, income/expense copy framing). No `@/lib/db`
  import, no async.
- **New file:** `src/lib/budget-context-panel-ui.test.ts` (24 tests — Phase 3 named tests 8-12).
- **New file:** `src/components/admin/ledger/budget-context-panel.tsx` — `'use client'` panel,
  `BudgetContextPanelProps` exactly as the Phase 3 design doc specifies
  (`fundId`/`txnDate`/`flow`/`categoryId`/`budgetLineId`/`amountCents`).
- **Modified:** `src/components/admin/ledger/transaction-form.tsx` — new `parsedAmountCents` const,
  new `<BudgetContextPanel>` render block after the Category select, new import.
- No schema changes, no new route, no new `FEATURES` key — this half is pure client consumption of
  the already-shipped, already-gated Phase 4a route.

### Divergence from the design doc (say-so, not silent)

- The Phase 3 prose examples always show the "(X posted + Y pending)" breakdown inline (e.g. "$570 of
  $700 used ($420 posted + $150 pending)."), including in the income example's prose description
  elsewhere in the doc. I made `formatGrainCopy` show that parenthetical ONLY when `pendingCents > 0`,
  for both flows — "$570.00 of $700.00 used ($420.00 posted + $0.00 pending)." reads as noise in the
  common all-posted case, and Treasurer Decision 1's actual requirement is "label what it counts,"
  which only bites when there IS a pending figure to disambiguate. This is a copy-polish call, not an
  arithmetic one — the underlying `postedCents`/`pendingCents` split is still computed and available
  every time; only the display omits the zero half. Flagging for qa/analyst to confirm this reads
  right to the treasurer, since it's a legible but unrequested deviation from the doc's literal
  example strings.

### Open questions / handoff notes

- **Next agent: qa (Phase 5).** Suggested click-through:
  1. Open "Record Transaction" on a fund/category with NO budget row for the current FY — confirm it
     reads "No budget set for FY20XX." in neutral gray, never "$0 of $0," and never amber.
  2. Same category, but one with existing posted/pending activity and still no budget row — confirm
     the "— $X recorded so far." aside appears, still neutral gray, never a percentage/bar/the word
     "over."
  3. Pick a category WITH a budget and some spend — confirm "$X of $Y used" with a "(posted + pending)"
     breakdown that appears only when pending is nonzero, and that typing an amount live-updates a
     "→ $Z after this one." clause on every keystroke, with NO network request firing per keystroke
     (watch the Network tab — only fund/FY changes should trigger a new `GET
     /api/admin/ledger/budget-context`).
  4. Push the projected figure over budget (type a large amount) — confirm the figure's TEXT turns
     amber (`text-amber-700`), the surrounding block stays gray (not a full amber card), and the word
     "over" never appears.
  5. Switch Type to Income on a budgeted income category — confirm "received"/"expected" framing
     (literally: contains "received", never "used" or "budgeted") and that pushing the projected total
     past the budgeted figure does NOT turn anything amber (exceeding income is good news).
  6. Pick a specific line via "Applies to budget line" — confirm the panel shows the line's own figure
     first (bold), the parent category's rollup underneath in smaller/lighter text, both independently
     colored by their own over-budget state.
  7. **THE HIGH-CONSEQUENCE CASE — flagged explicitly per Phase 3's Fiscal-Year Rule section: with the
     Network tab throttled (Slow 3G or similar), pick a category with today's default date (FY2026),
     then quickly change the Date field to a date before 2026-07-01 (FY2025) before the FY2026 request
     resolves.** Confirm the panel shows "Loading budget context…" throughout, and when the (now-stale)
     FY2026 response and the FY2025 response both eventually land, the panel settles on FY2025's real
     figures — never a flash of FY2026 numbers under an FY2025 date. This needs the actual
     network-throttled click-through, not a code read — Phase 1 called this the single
     highest-consequence failure mode in the whole feature.
  8. Open "Edit Transaction" on an existing expense row — confirm budget context is visible
     immediately on dialog open (mount-time effect fires with `initialValues`' real category/date),
     not only after touching the Category dropdown.
  9. At 360px width, confirm the panel's text stacks/wraps without introducing horizontal scroll
     inside the dialog.
  10. Trigger the fetch-failed state (e.g. by revoking `BUDGET_VIEW`/`LEDGER_MANAGE` from the signed-in
      test role, or simulating a 500) — confirm the amber "Couldn't load budget context." block with a
      working "Try again" button, visually distinct from both the loading and no-budget states.
- New copy strings the Lions Club may want to refine: "Loading budget context…", "Couldn't load budget
  context." / "Try again", "No budget set for FY{year}.", "No budget set for FY{year} — $X.XX recorded
  so far.", "{cause}: $X.XX of $Y.XX used/received (…) → $Z.XX after this one/gift.", "{category}
  overall: …".
- UX decision/tradeoff logged above (posted/pending breakdown shown only when `pendingCents > 0`) —
  worth a quick treasurer confirmation alongside qa's click-through, not a blocker.
- The route itself (Phase 4a's handoff note) still hasn't been curled against a real dev DB — this
  half's fetch effect has only been exercised via `pnpm build:only`'s type-check and the pure-logic
  unit tests, never against a running `pnpm dev` + real Postgres. Recommend qa's click-through (above)
  serves as that first live exercise.
- Did not touch `src/lib/ledger-budget-context-queries.ts` or
  `src/app/api/admin/ledger/budget-context/route.ts` (Phase 4a, already complete/green) — no changes.
- Did not wire this panel into `pay-reimbursement-dialog.tsx` — confirmed out of scope for this
  increment per the Phase 3 design doc's Edge Cases section; worth a `docs/backlog.md` entry if the
  treasurer wants it later, since `BudgetContextPanel`'s prop shape is already generic enough to reuse.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-08
**Verified by:** qa

## Summary

**Verdict: PASS.** All three automated gates are green with zero regressions against the 1113-test
baseline (1113/1113 still passing — the two Phase 4 halves added 21 + 25 tests without net growth
beyond what they reported, confirmed by direct count). All 13 Phase-3-named unit tests exist and pass,
verified by name, not inferred. I read both new server files end-to-end and confirmed the permission
gate is correctly ordered (`auth()` → `hasAnyFeature()` → param validation → `getBudgetContext()`,
nothing fetched before the check). I then drove the actual feature in a real browser (Playwright,
scripted — not `pnpm test:e2e`, since no e2e spec exists for this feature and none was requested) against
the real dev Postgres, with SQL-computed ground truth for the posted/pending/rejected arithmetic and a
genuine network-throttled CDP session for the fiscal-year race. All three of the flagged
highest-risk items — the back-date FY race, the no-budget state, and posted+pending-with-rejected-excluded
— check out. One deliberate implementer divergence (posted/pending breakdown suppressed when
pending is $0) reads correctly in the browser and is recommended to stand as shipped.

## Type Check

`pnpm exec tsc --noEmit`: **PASS** — zero errors, zero output.

## Unit Tests

`pnpm test`: **PASS**
Total: 1113 | Passed: 1113 | Failed: 0
Duration: 1.21s
Failures: none. Baseline before this feature was 1113 per the Phase 4b handoff (api-developer's 1067 → 1088,
ux-developer's 1088 → 1113) — the count I measured independently matches the reported final number exactly,
confirming no regression and no silent test deletion.

All 13 Phase-3-named tests confirmed present by name (not inferred from a pass/fail count):
- Query module (`src/lib/ledger-budget-context-queries.test.ts`): tests 1–7 all present, plus positive-path
  extras (null-fund lookup, genuine-vs-annotation $0 budget contrast, fuzzy-fallback-with-no-exact-link,
  cross-FY/cross-fund non-leak, null-parent-category defensive exclude).
- Route (`src/app/api/admin/ledger/budget-context/route.test.ts`): test 13 (403, not 200-with-empty-payload)
  present, plus the full 400/401/404/200 contract.
- Panel logic (`src/lib/budget-context-panel-ui.test.ts`): tests 8–12 all present (projected arithmetic via
  `budgetVariance()`, null/zero-amount suppression, income copy framing, FY-derivation at the July-1
  boundary, and the stale-response race guard), plus extras (income never warns, expense warns only on the
  most-advanced negative figure, blank cause-line label fallback).

## Production Build

`pnpm build:only`: **PASS**
Notes: Compiled successfully. `/api/admin/ledger/budget-context` present in the route list as a dynamic
(`ƒ`) route, consistent with every other `/api/admin/ledger/*` handler. No new warnings in the build output.

## Code Read — Permission Gate (mandatory before PASS)

Read `src/app/api/admin/ledger/budget-context/route.ts` directly (not inferred from passing tests, per the
QA mandate — a route that wrongly 200s to an under-privileged caller still passes happy-path tests).
Confirmed order of operations: `auth()` for session → `hasAnyFeature(session.user.id, [FEATURES.BUDGET_VIEW,
FEATURES.LEDGER_MANAGE])` → **only then** query-param validation and `getBudgetContext()`. No data is
fetched before the permission check. Generic `{ error: "Forbidden" }` body on 403, nothing leaked.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `GET /api/admin/ledger/budget-context` | yes | yes (`hasAnyFeature`, any-of) | `FEATURES.BUDGET_VIEW` \| `FEATURES.LEDGER_MANAGE` — correct: this is a read-only endpoint returning budget figures, gated on the `*_VIEW` capability (plus the broader `LEDGER_MANAGE` override), deliberately independent of the `LEDGER_RECORD` check that gates reaching the dialog at all, exactly as DECISION-069/070 specify. |

No other protected route or server action was added or changed by this feature (confirmed via
`git diff --stat` against `main` — the only modified existing file is `transaction-form.tsx`, a client
component with no new server action).

## Manual Click-Through (browser, scripted via Playwright against real dev Postgres)

No Playwright spec exists for this feature (none was requested, and this is additive UI inside an existing
form, not a new page). I drove the actual feature in a real Chromium browser via a throwaway Playwright
script (signed in as the seeded e2e admin, real `pnpm dev` server, real Neon dev DB) rather than reading the
code and assuming it's correct — per the task's explicit instruction to exercise the three highest-risk
items live. Two rows (one `pending`, one `rejected`, both memo-tagged `QA-PHASE5-TEST... — DELETE ME`) were
inserted into the `Marketing` / Administrative Fund / FY2025 category to get non-zero pending and rejected
ground truth to test against (that category had zero pending/rejected transactions anywhere in the dev DB
before this). **Both rows were deleted after testing; the dev DB was independently re-verified back to its
pre-test state (281 posted / 0 pending / 0 rejected, matching the pre-test baseline exactly).**

| Flow | Result | Notes |
|------|--------|-------|
| **No-budget state** (Marketing category, FY2026 — Administrative Fund has zero FY2026 budget rows at all) | PASS | Rendered exactly `"No budget set for FY2026."` — neutral gray, no `$0 of $0`, no amber. |
| **Posted+pending sum, rejected excluded** — ground truth via direct SQL: posted=$842.51 (6 rows), pending=$150.00 (1 seeded row), rejected=$999.99 (1 seeded row, must not appear) | PASS | Panel showed `"$992.51 of $5000.00 used ($842.51 posted + $150.00 pending)."` — exact match to SQL ground truth; `$999.99` (the rejected amount) does not appear anywhere in the rendered text. |
| **Projected figure updates live on keystroke** | PASS | Typing `100` into Amount produced `"→ $1092.51 after this one."` (=$992.51+$100) on the same render, no debounce lag. |
| **No extra network request while typing** | PASS | Request count to `/api/admin/ledger/budget-context` unchanged (3 before, 3 after) across the whole keystroke sequence — confirms the projected figure is pure client arithmetic, not a per-keystroke fetch. |
| **Empty amount suppresses the projected clause** | PASS | Clearing the Amount field removed the `→ ...` clause entirely rather than showing `+$0`. |
| **Over-budget renders amber, never red, never the word "over"** | PASS | Typing a large amount turned the figure text `text-amber-700`; no `text-red-*` class anywhere in the dialog's HTML; the word "over" never appears in the rendered copy. |
| **THE HIGH-CONSEQUENCE CASE — FY-boundary race under network throttling** (CDP `Network.emulateNetworkConditions`, 1500ms latency / ~50KB/s, applied mid-flow) | PASS | Started on today's date (FY2026, confirmed no-budget state settled). Throttled the network, then immediately flipped the date field to 2025-11-15 (FY2025) before the slow FY2026 fetch could resolve. Sampled the DOM 150ms after the date flip: no stale "No budget set for FY2026" text was visible (either already showing "Loading budget context…" or had moved past it — the render gate compares payload FY to derived FY on every render, never a lagging boolean). Once the slow response(s) landed, the panel settled on `"$992.51 of $5000.00 used..."` — FY2025's real figures — never a flash of FY2026 numbers under an FY2025 date. |
| **Income framing** (New Member Fee category, FY2025, Administrative Fund) | PASS | Rendered `"$0.00 of $175.00 received."` — contains "received", never "used"/"budgeted". Typing a very large gift amount ($9,999.99) did **not** trigger amber styling — confirmed exceeding an income budget stays neutral, per Treasurer Decision 4. |
| **Budget-line selected: line first, parent underneath** (Charitable Fund, "Charitable donation out" category, FY2025, line = "Youth & Education — Buckeye Girls State") | PASS | Line's own figure rendered first/bold: `"Youth & Education — Buckeye Girls State: $0.00 of $350.00 used."` Parent rollup rendered underneath, visually subordinate: `"Charitable donation out overall: $15325.00 of $15475.00 used."` Independently re-verified the parent figure against SQL (`SELECT SUM(amount_cents) WHERE status='posted' AND fund_id=... AND category_id=... AND txn_date >= '2025-07-01' AND txn_date < '2026-07-01'` → 1,532,500 cents = $15,325.00, budget row `annual_amount_cents` = 1,547,500 cents = $15,475.00) — exact match. (My first pass at this SQL check used the wrong FY date bounds — `2024-07-01..2025-07-01` instead of `2025-07-01..2026-07-01` — and produced a false alarm; re-derived from `fyBounds()`'s own definition in `src/lib/fiscal-year.ts`, the second query matched the UI exactly. Noting this so a future reader trusts the *corrected* figure, not the panic in between.) |
| **Edit mode shows context immediately on dialog open** | PASS | Opened "Edit" on an existing income row; budget context (`"$944.00 of $1150.00 received. → $991.00 after this gift."`) was visible on the very first render, no category re-selection needed. |
| **360px viewport — no horizontal scroll inside the dialog** | PASS | `dialog.scrollWidth <= dialog.clientWidth` at 360px; screenshot confirms the panel text wraps and stacks cleanly under the Category select, matching the Transfer/Sweep note precedent. |

All 19 scripted browser assertions passed (19/19). Screenshots captured at desktop (1280px, showing the
panel inline in the real admin Ledger page) and 360px (showing clean vertical stacking, no dialog overflow).

**Not separately reproduced live:** the 403 permission-gate response. The e2e admin account holds both
`BUDGET_VIEW` and `LEDGER_MANAGE` (as does every role holding `LEDGER_RECORD` today, per Phase 1's own
finding), so there's no existing role to reproduce a live 403 against without mutating role-permission
bindings. Verified instead by direct code read (above) and by the route's own passing unit test 13
(`403s ... when the caller holds neither BUDGET_VIEW nor LEDGER_MANAGE`) — consistent with the QA mandate
that a route audit is satisfied by reading the route file, which I did.

## Divergence Judgment Call

The ux-developer's Phase 4b note flagged one deliberate deviation from the Phase 3 doc's literal example
strings: the `"(X posted + Y pending)"` breakdown is shown only when `pendingCents > 0`, not unconditionally.
Confirmed live: in the common all-posted case (e.g. the income example above, `pendingCents: 0`), the
breakdown is correctly omitted — `"$0.00 of $175.00 received."` reads cleanly with no `"($0.00 posted +
$0.00 pending)"` noise. This matches Treasurer Decision 1's actual requirement ("label what it counts")
without over-literally reproducing the design doc's example prose. **Judgment: this reads right and should
ship as implemented** — worth a one-line confirmation from the treasurer per the implementer's own note, but
not a blocker.

## Regression Tests Added

This is new-feature work, not a bug fix — there is no pre-existing bug being guarded against, so no
`— regression for X` tests apply here. The 13 Phase-3-named tests (listed above under Unit Tests) serve the
equivalent purpose for this feature going forward: any future change that reintroduces the FY-boundary race,
double-counts rejected transactions, or drops the posted/pending label will fail one of these by name.

## Coverage on Critical Modules

- `src/lib/ledger-budget-context-queries.ts`: exercised by 14 targeted unit tests covering every branch
  named in the Phase 3 design doc (rejected exclusion, posted/pending split, null-vs-zero budget, cause-line
  exact-link-vs-fuzzy resolution, FY/fund scoping, null-parent-category defensive path) — not run through
  `--coverage` numerically as part of this pass, but branch coverage by inspection is complete against the
  named contract.
- `src/lib/budget-context-panel-ui.ts`: 24 unit tests, all branches of `computeBudgetFigures`,
  `isOverBudgetWarn`, `formatGrainCopy` (both flows, no-budget state, breakdown suppression),
  `deriveFiscalYearFromTxnDate`, and `isResponseCurrent` covered by name.
- `src/lib/events.ts` / `src/lib/permissions.ts` / `src/lib/members.ts`: unchanged by this feature; not
  re-audited in this pass (last swept per the 7-day test-coverage review cadence — see `docs/reviews/log.md`).

## Verdict

**PASS.**

All three automated gates green (tsc clean, 1113/1113 unit tests, production build succeeds with the new
route present). The permission gate is correctly implemented and correctly ordered, confirmed by direct
code read. All 13 Phase-3-named unit tests exist and pass. All three flagged highest-risk items — the
FY-boundary race under real network throttling, the no-budget empty state, and posted+pending-with-rejected-
excluded against SQL-computed ground truth — were exercised live in a real browser against the real dev
database and behave exactly as designed. No `lions-red` or `text-red-*` anywhere in the new components. No
regressions. Dev DB restored to its exact pre-test state.

---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-08-08
**Owner:** analyst
**Status:** complete

## VERDICT

SHIP WITH NOTES

## ONE-LINE TAKE

> A treasurer entering a transaction now sees a trustworthy, correctly-labeled budget-vs-actual figure right where they're already looking — all four of the treasurer's explicit decisions are genuinely delivered, the arithmetic is reused byte-for-byte from the one function that's already proven against the fiscal report, and QA closed the loop with live SQL-verified numbers, not just a green test suite — but one implementer copy decision (hiding the posted/pending breakdown when pending is $0) answers a question the treasurer never actually got asked, and it should get his one-line yes/no before this is called fully closed.

## What's Working

- **Placement and timing.** `BudgetContextPanel` renders immediately after the Category `<select>` in `transaction-form.tsx` (lines 649-683), before Party/Check#/Amount context further down the form — this is exactly "at the moment he asked," not a collapsed accordion or a separate tab the treasurer has to remember to open. It appears the instant a category is picked and disappears cleanly when none is selected (Panel State 1) — no empty box flash.
- **The projected figure is real, not decorative.** QA confirmed live in a browser that typing an amount updates "→ $Z after this one." on every keystroke with zero additional network requests (request count held at 3 across the whole typing sequence) — this is client-side arithmetic against an already-fetched payload, reusing `budgetVariance()` from `lib/ledger.ts`, not a re-implementation. This is the single most decision-relevant number in the panel (Treasurer Decision 2) and it's live-correct.
- **Numbers generalize, not just the one SQL-checked case.** The query module (`getBudgetContext`) reuses `resolveCauseLineActual`, `causeLineReferenceKey`, `isEligibleForFuzzyCauseMatch`, `buildCauseActualsByKey`, `budgetVariance`, and `resolveDisplayBudgetCents` — the exact same functions `getFundReport()` calls for the fiscal report — rather than a parallel implementation. That's what makes "trustworthy" a structural property here, not a QA spot-check: a lump-sum category with no cause lines falls out of an empty `lines.filter(...)`, a category with cause lines resolves exact-link-then-fuzzy-fallback identically to the fiscal report, and a fund with zero budget rows for the FY renders every category as `budgetCents: null` ("No budget set"), never a fabricated `$0`. QA independently verified this against live SQL for three different shapes (no-budget, posted+pending-with-rejected-excluded, a cause-line rollup) and caught its own first-pass SQL error before trusting the UI number — a real independent check, not a rubber stamp.
- **The single highest-consequence risk Phase 1 flagged — a confidently wrong number across a fiscal-year back-date — was closed for real.** The panel gates on comparing the fetched payload's own `fiscalYear` to the current derived FY on every render (never a lagging `isLoading` boolean), plus a ref-based stale-response guard. QA reproduced this live with actual network throttling (CDP, 1500ms/50KB/s), not a code read, and confirmed no flash of the wrong FY's numbers.
- **Failure and empty states are visually distinct from each other**, which was Phase 1's explicit requirement: "No budget set" renders neutral gray with no percentage/bar/the word "over"; a fetch failure renders amber with a working retry, and can never be mistaken for either "no budget" or "over budget" (over-budget is amber text only, inside an unchanged gray block).

## Intent-vs-Shipped Diff

- **Phase 1 said** the request is silent on FY resolution, posted-vs-pending, and lump-sum-vs-cause-line scope, and that these needed explicit decisions before Phase 3. **Shipped:** all three were resolved in DECISION-069/070 and implemented exactly as decided (FY derived from `txnDate` via the existing `getFiscalYear` precedent; posted+pending both counted and separately labeled at the data layer; line-grain and category-grain both computed and both shown when a line is selected). **Verdict: matches.**
- **Treasurer Decision 1** ("used" includes posted AND pending; label what it counts). **Shipped:** `computeBudgetFigures` sums `postedCents + pendingCents` for the "used"/"received" total; the API always returns both fields separately, never pre-collapsed. **Verdict: matches** at the data contract level. The *display* labeling is conditional (see Edge Cases / Follow-Ups below) — this is the one place letter and spirit could be read to diverge, addressed as a note, not a regression, because the display never asserts a total that includes pending without saying so where it actually matters (see below).
- **Treasurer Decision 2** (show current AND projected). **Shipped:** exactly as decided, live on every keystroke, no debounce, confirmed in a real browser. **Verdict: matches.**
- **Treasurer Decision 3** (selected line shows with parent category underneath). **Shipped:** line's own figure first (bold), parent category's rollup second (visually subordinate, `text-xs`), independently colored by their own over-budget state, using the line's own `categoryId`/`categoryName` fields rather than the form's separate `categoryId` prop (so it stays correct even if a future code path decouples them). QA verified the parent rollup against direct SQL. **Verdict: matches.**
- **Treasurer Decision 4** (income reads "received"/"expected," never amber for exceeding). **Shipped:** `formatGrainCopy` swaps `usedVerb`/`afterClause` off the `flow` param in one shared function (not a second copy-pasted component — Phase 1's explicit anti-drift requirement), and `isOverBudgetWarn` is hard-coded `false` for income regardless of variance. QA confirmed live: a $9,999.99 gift against a $175 income budget rendered "received," no amber. **Verdict: matches.**
- **Phase 1's gap:** "does the projected figure include the transaction being typed right now?" **Shipped:** yes, exactly — and `amountCents === null` (empty/zero/invalid) suppresses the projected clause entirely rather than silently showing "+$0," which is the same "confidently wrong is worse than no number" standard applied to the projection specifically. **Verdict: matches.**
- **Phase 1's gap:** reimbursement mark-paid dialog scope. **Shipped:** Phase 3 scoped it out, Phase 4 didn't touch `pay-reimbursement-dialog.tsx`, and nothing in the treasurer's four decisions asked for it. Still the right call — the panel's props are already generic enough to wire in later as a small follow-up. **Verdict: matches** (confirmed correctly out of scope, not silently dropped).

## The Divergence — Judged

The Phase 3 doc's prose examples always show "(X posted + Y pending)" inline; the shipped `formatGrainCopy` only renders that parenthetical when `pendingCents > 0`. I traced whether this still satisfies "label what it counts": when `pendingCents === 0`, the displayed total is arithmetically identical to a posted-only figure (0 contribution from pending), so there's no case where the panel asserts a total that quietly includes unlabeled pending money — the breakdown appears exactly when there's something to disambiguate, i.e., exactly when the figure diverges from what the fiscal report would show for the same category. Judged on "does the number mislead," it doesn't: nothing is hidden that changes the total.

But that's a narrower question than the one that actually needs answering, and it's not mine to answer unilaterally: the treasurer's decision said "the UI must label what it counts," full stop — he didn't say "only when it's nonzero." A treasurer who never happens to see the parenthetical (most categories, most days) has no persistent signal that this specific panel — unlike every other budget-vs-actual number in The Ledger — is capable of counting pending money at all, so on the one day it matters, he's relying on the parenthetical appearing correctly rather than already knowing to look for it. Both the implementer and QA independently flagged this as "reads right, not a blocker, worth a treasurer confirmation" — and that confirmation never actually happened; it's still an open loop with the person whose decision is being interpreted. That's a real gap between "the code does what the design doc's author decided was reasonable" and "the treasurer signed off on this specific interpretation of his own words." Not a red flag, but not nothing either — it's exactly the kind of thing that becomes a tracked follow-up rather than something I approve on his behalf.

## Edge Cases

- Empty state: **pass** — "No budget set for FY{year}." (plus a factual "— $X recorded so far." aside when there's unbudgeted spend), neutral gray, no percentage/bar/"over," verified live and distinct from the fetch-failure state.
- Failure microcopy: **pass**, with one minor note — "Couldn't load budget context." with "Try again" is human and correctly distinct (amber) from every other state. It does not distinguish a genuine 403 (permission revoked) from a transient network/500 failure — "Try again" is a dead-end affordance for the former, since retrying a 403 just produces the same 403. Not currently reachable (every role holding `LEDGER_RECORD` today also holds `BUDGET_VIEW`/`LEDGER_MANAGE`), so this is a latent rather than live problem — see Follow-Ups.
- Permission gate: **pass** — `auth()` → `hasAnyFeature([BUDGET_VIEW, LEDGER_MANAGE])` → only then param validation/query, confirmed by direct code read and by a passing named unit test (403, not 200-with-empty-payload). Not reproduced live end-to-end (no existing role lacks the permission to test against without mutating role bindings) — acceptable given the code-read + unit-test coverage, per the QA mandate's own stated bar.
- Mobile (360px): **pass** — QA confirmed `scrollWidth <= clientWidth` at 360px with a screenshot; text stacks vertically under the Category select, matching the Transfer/Sweep note precedent this component deliberately followed for styling (`rounded-lg`, not `rounded-2xl`, correct for inline form context per brand guidelines).

## Follow-Ups (SHIP WITH NOTES)

- **Get the treasurer's explicit one-line confirmation on the conditional posted/pending breakdown** ("only show the parenthetical when pending > 0" vs. "always show it, even as ($X posted + $0.00 pending)"). This is a one-line change in `formatGrainCopy` (`src/lib/budget-context-panel-ui.ts`) if he wants it unconditional — low implementation cost, but it's his call to make, not the implementer's or QA's, since it's a direct interpretation of his own stated decision. Track as its own tiny work-log entry (or a decisions.md addendum) once he answers.
- **Distinguish "couldn't load — try again" from "you don't have permission to see this"** in the fetch-failed panel state, so a future permission-scoped role (e.g. a `ledger.record`-only "bookkeeper" role, which Phase 1 flagged as a real possibility even though it doesn't exist today) doesn't get a dead-end retry button. Low priority — not reachable under current role bindings — but cheap to fix now (the route already returns a distinguishable 403 vs. 500/network error; the panel just needs to branch on it) versus rediscovering the gap later when that role actually gets created.

## Red Flags (if NEEDS REWORK)

None. Nothing here blocks shipping.


---

## Treasurer Decisions (2026-08-08)

1. **"Used" includes posted AND pending transactions.** If money is committed but not yet reconciled it
   has still been spent for the purpose of deciding whether to spend more. Note this deliberately
   differs from every other budget-vs-actual figure in the app (`getFundReport()` is posted-only), so
   the UI must label what it counts — an unlabelled figure that disagrees with the fiscal report would
   erode trust in both.
2. **Show current AND projected**: "$570 of $700 used — $700 after this one." The treasurer is mid-
   decision while entering; the projection is the number that decision turns on.
3. **When a specific budget line is selected, show that line with its parent category underneath.**
   Both grains, line first. Preserves the value of the finer-grained cause-line budgeting while still
   showing whether the category overall is on track.
4. **Income reads "received vs expected"**, not "budget used" — you progress toward income rather than
   consuming it, and exceeding an income budget is good news. Same component, different framing.

## Carried from Phase 1 — must be honoured in design

- **Fiscal year follows the transaction's date, not today's.** The form already re-derives FY from
  `txnDate` via `getFiscalYear` (`transaction-form.tsx:284`, used to clear a stale `budgetLineId` on a
  back-date). Back-dating a June 2026 expense in August 2026 must show FY2025's budget. A confidently
  wrong figure here is worse than no figure.
- **Permission:** gate the budget-context data on `BUDGET_VIEW` / `LEDGER_MANAGE` explicitly, not on
  `ledger.record` alone. Every role holding `ledger.record` today also holds `budget.view`, but that is
  coincidence rather than structure, and a future record-only role should not see budget figures.
- **No reusable query exists** — `getFundReport()` is whole-fund/whole-FY/posted-only,
  `resolveCauseLineActual()` is only called inside it, and `searchBudgetLines()` has no actuals column.
  A new lightweight sibling query is warranted (DECISION-049/061/062 precedent), not a fourth
  reimplementation of the same arithmetic.
