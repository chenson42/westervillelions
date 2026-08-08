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
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

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
