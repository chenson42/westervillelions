# Monthly Statement of Financial Condition (member-visible + PDF) — Work Log

> **Slug:** `2026-07-28-monthly-financial-report`
> **Surface:** mixed — member portal (read view) + admin (generate/gate); print-friendly report page
> **Permission(s):** view = any linked member (confirmed); generate/publish = existing `ledger.manage`/`ledger.approve` expected (confirm Phase 1/3)
> **Estimated complexity:** large (new month + posted-basis actuals computation, fund-balance-at-month-boundary, print report surface, member-portal route, reconciliation gate)
> **Pipeline mode:** Full
> **Reference reports (real, kept OUT of repo):** the previous treasurer's June 2026 statements —
> `scratchpad/WLC_June_2026_Monthly_Report.pdf` (Club/Administrative fund) and
> `scratchpad/WLCF_June_2026_Monthly_Report.pdf` (Foundation/Philanthropic fund).

## Locked user decisions (2026-07-28)

- **PDF approach:** print-friendly report page + browser Save-as-PDF. **No new npm dependency.** The member-portal view IS the report (print CSS).
- **Member visibility:** any linked member sees the report (goal: "expose accountability to the entire club"). No new gate for viewing.
- **Reconciliation gate:** a month's report should not be generated/published until that month has been reconciled (ties to the existing bank-reconciliation workbench).
- **Per-entity:** reproduce the two statements the previous treasurer produced (one per entity: WLC/Administrative, WLCF/Philanthropic).

## Reference report format (from the two June 2026 PDFs)

Three-column budget-vs-actual "Statement of Financial Condition" per entity/fund:
- Columns: **One Month Ended** (actuals posted in the report month) · **Twelve Months Ended** (fiscal-YTD actuals) · **Annual Budget**.
- Sections: **REVENUE** lines → Total Revenue; **EXPENSES** lines → Total Expenses; **Net income (loss)**; **Beginning fund balance** → **Ending fund balance**.
- Right-hand **per-line notes** column ("Last of the three checks", "Fourth Friday space rental", "Used eyeglasses collection boxes").
- **Yellow highlight = "check sent, not deposited"** (maps to the app's uncashed-checks tracking).
- Footer basis note: *"Revenue and expense transactions are not included in this report until posted by the bank in the month of the report."* → **reconciled/bank-posted (cash) basis**, keyed on posted/cleared date, not entry date.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-28 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-07-28 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-07-28 |
| 4 — Implementation | api-developer (query layer) → ux-developer (routes/UI) | Complete | — | 2026-07-28 |
| 5 — Verification | qa | Complete (re-verified after fix) | **PASS** (superseded a prior FAIL — see Phase 5 re-verification note) | 2026-07-28 |
| 6 — Shipped vs intent | analyst | Complete | **SHIP WITH NOTES** | 2026-07-28 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> A treasurer-authored monthly "Statement of Financial Condition" is genuinely ~90% built already (categories, budgets, FYTD actuals, uncashed-check flagging, reconciliation state all exist) — the real new work is a bank-cleared-date "One Month" column and a transaction-level reconciliation gate, and neither the accrual-vs-cash divergence they introduce nor the auto-vs-manual publish question can be sidestepped without treasurer sign-off, because this is club-wide financial data that must never look wrong or leak beyond the two funds people expect to see.

## Reuse vs. New — Ground Truth

| Reference-report piece | Status |
|---|---|
| Category-level income/expense line items | **Reuse** — `ledgerCategories`, exactly `getFundReport()`'s grouping |
| "Twelve Months Ended" (FYTD actuals) + "Annual Budget" columns | **Reuse** — `getFundReport()` already computes this on a posted-transaction basis; only change needed is bounding it to "as of [report month end]" instead of "as of now" |
| Beginning/ending fund balance | **Mostly reuse** — `getFundReport()`'s `openingCents`/`endingCents` rollforward logic (`rolledForwardOpeningCents`), evaluated at a month boundary instead of the live present |
| Yellow "check sent, not deposited" highlight | **Reuse** — identical predicate to the existing Uncashed Checks panel (`getDashboard()`'s `uncashedChecks`: `paymentMethod='check' AND flow='expense' AND status='posted' AND reconciled=false`) |
| "One Month Ended" column (bank-posted-date actuals) | **New** — no existing query buckets actuals by bank-clear date; nearest building block is the reconciliation-match → bank-line join already used in `src/lib/reconciliation-queries.ts` (`ledgerReconciliationMatches` → `ledgerBankLines.postingDate`) |
| Reconciliation gate ("don't show an unreconciled month") | **New surface, reused predicate** — the dashboard's existing `unreconciledPriorMonth` guardrail (`status='posted' AND reconciled=false AND txnDate < cutoff`) is exactly the right shape, just needs to be evaluated at an arbitrary month boundary instead of "before this calendar month" |
| Member-portal visibility pattern | **Reuse** — `/members/impact/page.tsx`'s `memberId`-gated, no-`FEATURES`-check-in-the-"members"-tier pattern is the direct precedent |
| Print-to-PDF | **Reuse** — `print:hidden` Tailwind variant already used in `/admin/ledger/guide/page.tsx`; no new dependency needed |
| Per-line hand-authored notes | **New schema, no precedent** — closest existing field is `ledgerTransactions.publicNote` (member-facing, per-transaction, expense-only) but the reference reports' notes are per (category, month), not per-transaction |

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Signed-in member | Selects an entity (Club/Foundation) and a month, and **views** that month's statement | On demand, likely monthly habit |
| Signed-in member | **Prints / saves as PDF** via the browser's native print dialog | On demand, occasional |
| Admin/treasurer (`ledger.record`) | **Closes a bank reconciliation session** (existing flow, unchanged) — this is the act that makes a month eligible to publish | Monthly, existing cadence |
| Admin/treasurer (`ledger.manage` or `ledger.record` — see Open Questions) | Optionally **previews** a not-yet-fully-published month, or **authors** a footer disclosure/per-line note (if in scope — see recommendation to defer) | Monthly, new if in scope |

The request never named which surface "the user" is on for "generate" — worth noting explicitly: **no one clicks "generate."** The report is a query, not a document a person produces; the only human action in the whole pipeline is the treasurer's existing reconciliation-session close. Naming this precisely matters because it changes the entire shape of Flow 1 below (there is no new admin form to build for the common case).

## Flows

**Flow 1 — Treasurer reconciles a month (existing flow, new side effect):** Treasurer opens `/admin/ledger/reconciliation`, uploads/matches the bank statement (existing), clicks "Close session" (existing, requires `ledger.record`) → **new:** once every posted transaction dated on/before that month's last day is reconciled for that fund's entity, the month becomes eligible and the member-facing report simply starts rendering real numbers the next time anyone requests it. No new button, no new state to persist.
- Failure: session close still fails today's existing validation (unbalanced tie-out) — unaffected by this feature. New failure mode to design for: a treasurer closes June's session but an unrelated May transaction is still sitting unreconciled — June's report must stay unavailable until *that* stale item clears too, since the gate is "no unreconciled posted transaction on/before month-end," not "this specific session closed." The treasurer needs to see *why* a month isn't publishing yet (which transaction is blocking it) — recommend surfacing the blocking transaction(s) inline wherever the admin sees "month not yet available," reusing the existing Uncashed Checks / `unreconciledPriorMonth` panels' data rather than inventing a new blocker-list UI.

**Flow 2 — Member views a monthly statement:** Entry: a link from `/members` (or `/members/impact`, given the transparency theme overlaps) → member lands on a new `/members/financial-reports` (name TBD) page → picks entity (Club/Foundation) via tabs → picks a month from a dropdown/list populated **only with months that have passed the reconciliation gate** → sees the three-column statement, rendered as an actual HTML page (not a PDF preview) → clicks "Print / Save as PDF" → browser print dialog opens → member saves or prints.
- Failure (unreconciled month, reached via direct URL): member types or is linked to `/members/financial-reports/club/2026-07` before July closes. Must **not** 404 (looks broken) and must **not** partially render numbers (looks like a leak/bug). Show: "July's statement isn't ready yet — the treasurer is still reconciling this month. Check back soon." Gate must be re-checked **server-side on every request**, not just omitted from the picker's list (Pass 5 finding, see below).
- Failure (brand-new install, nothing ever reconciled): empty state explaining what will appear, not a blank page or an error.
- Failure ($0-activity month that *is* reconciled — e.g., a quiet August): this is **not** an empty state — render the full table with all-zero lines. Conflating "never reconciled" and "reconciled but no activity" would misinform members about the club's actual (lack of) activity that month.
- Failure (DB/network hiccup): plain-language error, no stack trace, matches the rest of the app's Server Component error handling.

**Flow 3 — (Only if per-line notes/manual publish are pulled into v1) Treasurer authors monthly notes:** Entry from an admin surface listing reconciled-but-unannotated months → treasurer types a short note per category line (or a single footer note) → saves. Recommend deferring this whole flow past v1 (see recommendation below) — if deferred, this flow doesn't exist in v1 and the report ships with only the reference reports' generic footer sentence.

## Permissions

- **View:** No new `FEATURES` key, no `hasFeature()` check at all — gated purely on `session.user.memberId` being non-null, identical to `/members/impact`'s "members"-tier path. This is a deliberate, locked departure from `impact.view`'s two-tier board/members toggle: the user has already decided this is club-wide, no knob.
- **Existing reconciliation-session close** (the de facto "generate" trigger): unchanged, already `ledger.record` (admin, treasurer) per `drizzle/migrations/0045_ledger_permissions.sql`.
- **Admin preview / notes-authoring, if in scope:** recommend `ledger.record` (admin, treasurer) — the same people who already record transactions and close reconciliation sessions are the ones who'd author a monthly note. Do **not** use `ledger.manage` (admin-only) for this piece — that would lock the treasurer out of a task that is squarely theirs.
- **Default roles:** view = any linked member (all roles that carry a `memberId`); the reconciliation trigger and any optional admin authoring = admin, treasurer (existing bindings, no migration needed unless Flow 3 ships).

## Gaps the Request Didn't Address

- **Reconciliation-gate definition is genuinely ambiguous.** Bank reconciliation sessions are keyed to a bank *statement period* (`ledgerReconciliationSessions.statementPeriodStart/End`), which need not align to calendar months. Mapping "is June reconciled?" to "is there a closed session covering June?" breaks if a statement runs, say, 6/5–7/4. **Recommendation:** define the gate at the **transaction** level, not the session level — reuse the existing `unreconciledPriorMonth` guardrail's exact predicate (`status='posted' AND reconciled=false AND txnDate <= [month-end]`), generalized to an arbitrary month boundary. This sidesteps statement-period misalignment entirely and reuses code that's already trusted elsewhere in the admin dashboard. Needs treasurer confirmation since it's the single most load-bearing decision in this feature.
- **The bank-posted date the "One Month" column needs doesn't exist as a column.** `ledgerTransactions` has `txnDate` (entry date) and `reconciledAt` (when the *app* flipped the flag, server clock — not the bank's date). The bank's actual posting date only exists on `ledgerBankLines.postingDate`, reachable via `ledgerReconciliationMatches`. Transactions reconciled through the legacy per-row toggle route (pre-dating the reconciliation workbench) have no matched bank line at all. **Recommendation:** bucket by the matched bank line's `postingDate` when one exists; fall back to `reconciledAt`'s date for legacy-toggled rows, and disclose the fallback in the report footer rather than silently blending two different notions of "date." Needs treasurer confirmation — how much of the club's historical data actually took the legacy path matters to whether this fallback is a footnote or a real problem.
- **Accrual (posted) vs. cash (bank-cleared) basis will diverge, and that's correct, not a bug.** In the reference PDFs, "Ending fund balance" always equals "Beginning + One-Month Net" exactly, because the prior treasurer's manual process only ever entered a transaction once it cleared the bank (entry date ≈ clear date). In this app, transactions are entered before they're reconciled, so at any given month-end there can be real outstanding items (the existing Uncashed Checks list proves this happens today). If "Ending fund balance" stays on the existing accrual/posted basis (matching every other number in the admin Ledger) while the "One Month" column is cash-basis, the two will sometimes **not** foot to each other the way the reference reports always did. **Recommendation:** keep one canonical "book balance" (today's accrual engine, evaluated at the month boundary) so this report never contradicts numbers shown elsewhere in the admin Ledger, and footnote the divergence explicitly when it occurs rather than inventing a second parallel cash-basis balance nobody else in the app uses. This is an accounting-policy call, not an engineering one — it needs the treasurer's sign-off before Phase 3 locks the data model.
- **Per-line notes have no data model and no authoring UI.** The reference reports' hand-typed notes ("Fourth Friday space rental," "Last of the three checks") are per (category, month), not per-transaction — `publicNote` doesn't fit. Building this is a real, separate feature (new table, new admin form, a new monthly chore for the treasurer). **Recommendation:** defer to v2; ship v1 with the reference reports' existing generic footer disclosure sentence plus (if applicable) the reconciliation-date-fallback disclosure. The numbers alone deliver the stated goal ("expose accountability to the entire club").
- **Fund exposure scope is undefined.** "Per-entity, reproducing the two statements" literally names two specific funds (WLC/Administrative, WLCF/Charitable-Philanthropic), but the underlying engine (`getFundReport`) is fund-generic — Activity and Scholarship funds exist too and could trivially get the same report. **Recommendation:** since the stated goal is maximal club-wide transparency, expose every active fund per entity once its months clear the gate, with the member-facing picker defaulting to/highlighting the two funds the treasurer already publishes today. Confirm with treasurer — it's possible Activity/Scholarship were deliberately left out of the historical reports for a reason (e.g., they're small/inactive, or the treasurer doesn't want per-fund noise).
- **Auto-publish vs. manual publish is explicitly unresolved by the user's own wording** ("shouldn't be generated until reconciled" doesn't say who flips the switch). **Recommendation:** auto-appear once the gate is satisfied — no separate publish click, no forgotten-publish-step failure mode, and it matches the literal wording. Trade-off to confirm with the treasurer: this means there is no proofreading window between "session closed" and "every member can see it" — if the treasurer wants a chance to review before it goes live, that's a real manual-publish step to add back in Phase 3.
- **Reference reports' months might not be calendar-clean at the edges.** No stated handling for a fiscal-year boundary month (June, in these two entities' FY-end/FY-start) — does "Twelve Months Ended" reset in July, and does the June report still show a full 12-month column while July's report starts a fresh FYTD at 1 month? `getFundReport()` already handles FY-bounded actuals correctly for this via `fyBounds()`; flagging only so the "One Month" and "Twelve Months" columns are confirmed to use *consistent* fiscal-year framing at the boundary month, not because this needs new logic.

## Out of Scope (confirm with user)

- Per-line, hand-authored monthly notes (recommend v2 — see Gaps).
- A manual "publish" review/approval step distinct from reconciliation close (recommend v2 unless the treasurer objects to auto-publish — see Gaps).
- Any email notification when a new month's statement goes live (not mentioned in the request; `sendEmail()`/Resend exist and would be a small add-on if wanted, but nothing in the locked decisions asks for it).
- Cause/label-level line-item detail (the parallel cause-tagged `ledger_budget_lines` increment) — category-level matches the reference PDFs exactly; cause detail is a natural v2 enrichment that shouldn't block this feature.
- An admin "draft preview" of an in-progress (not-yet-reconciled) month's numbers before members see them — plausibly cheap to add in Phase 3 as a `ledger.view`-gated preview route, but not asked for.
- Historical months predating the reconciliation workbench (v1.32) or predating the Ledger's Quicken-export seed — those transactions may have `reconciled=true` with no session/bank-line provenance at all; whether the gate should treat them as "reconciled" (pass) or require a fresh look is worth a one-time confirmation from the treasurer, not new ongoing logic.

## Open Questions

1. **Gate granularity/basis:** confirm transaction-level (`status='posted' AND reconciled=false AND txnDate <= month-end`, reusing `unreconciledPriorMonth`'s predicate) rather than session/statement-period-level. Also confirm it's evaluated per-entity (all of an entity's funds gate together) vs. independently per-fund.
2. **Accrual-vs-cash divergence:** OK for "Ending fund balance" to occasionally not equal "Beginning + One-Month Net" in a given month (footnoted), rather than forcing a second cash-only balance path?
3. **Legacy-reconciled transactions with no matched bank line:** fall back to `reconciledAt`'s date (footnoted), or exclude such transactions from the One-Month column entirely until they're re-matched?
4. **Auto-publish vs. manual publish:** does the treasurer want a review/proofread window before a freshly-reconciled month goes live to every member, or is immediate auto-appear fine?
5. **Fund exposure:** all active funds per entity once reconciled, or only the two funds historically published (Administrative for WLC, Charitable for WLCF), with Activity/Scholarship staying admin-only?
6. **Per-line notes:** confirm OK to ship v1 numbers-only (generic footer disclosure) and defer hand-authored notes to a follow-up?
7. **Pre-reconciliation-workbench historical data:** treat existing `reconciled=true` rows with no session provenance as satisfying the gate as-is, or require a one-time treasurer review pass over old months before they can publish?

## Human Answers (Chris, 2026-07-28)

Binding inputs for Phase 2/3. Three treasurer-policy calls answered; the technical defaults accepted as recommended.

- **Q2 — Ending balance basis: BOOK BALANCE + footnote when it diverges.** Show the Ledger's one canonical book balance (single source of truth, matches the admin books), footnoting any gap vs. the cash-basis one-month net (typically outstanding uncashed checks). Do NOT build a second cash-only balance path.
- **Q4 — Publishing: AUTO-APPEAR once reconciled.** No manual publish/proofread step; a month goes club-wide the moment its reconciliation gate clears. (Flow 3's manual-notes/publish path stays out of v1.)
- **Q5 — Fund exposure: ONLY the historically-published funds.** Member reports show the Club Administrative statement and the Foundation Philanthropic/Charitable statement — the same scope the prior treasurer published. Activity (pass-through) and Scholarship funds stay admin-only, not member-exposed.

**Accepted as recommended (analyst defaults — not separately debated):**
- **Q1** — transaction-level gate (`status='posted' AND reconciled=false AND txnDate <= month-end`, reusing `unreconciledPriorMonth`'s predicate), evaluated **per-entity** (all of an entity's member-exposed funds gate together).
- **Q3** — legacy reconciled rows with no matched bank line fall back to `reconciledAt`'s date, footnoted (not excluded).
- **Q6** — v1 ships numbers-only with the generic footer disclosure; hand-authored per-line notes deferred to a follow-up (v2).
- **Q7** — pre-workbench `reconciled=true` rows satisfy the gate as-is (no one-time review pass required to publish old months).

**v1 scope line (locked):** category-level, per-entity, two historically-published funds, three-column (One-Month cash-cleared basis · Twelve-Month FYTD · Annual Budget), book-balance beginning/ending with divergence footnote, uncashed-check yellow flag reused, auto-publish on reconciliation, notes deferred. Cause/label line detail (from the parallel `ledger_budget_lines` work) is an explicit v2 enrichment — v1 must NOT block on it.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** Shape is right; nothing loops back to Phase 1. The rulings below on the query-layer split (§3) are binding — Phase 3 should treat them as the load-bearing decision of this review, not an optional suggestion — logged as **DECISION-049**. The remaining items are lower-stakes naming/structure suggestions for tech-lead to finalize.

## Placement

**Routes** — `src/app/members/financial-reports/`, following the existing flat `/members/<feature>` convention (`/members/impact`, `/members/dues`, `/members/reimbursements`, `/members/groups`). Two pages, not one:
- `src/app/members/financial-reports/page.tsx` — entity picker / landing (mirrors `/members/impact`'s auth + memberId-gate pattern).
- `src/app/members/financial-reports/[entitySlug]/[month]/page.tsx` — the actual statement, as a real deep-linkable URL (not query params). This is required, not stylistic: Phase 1's Flow 2 failure case is explicitly "member types or is linked to `/members/financial-reports/club/2026-07` before July closes" — the gate must re-check on a direct URL hit, which only works cleanly if the month is a route segment the page can validate server-side before rendering, the same shape as `/admin/ledger/[fundSlug]/report/page.tsx` validates `fundSlug` today.

**Components** — `src/components/members/` (the existing surface-specific bucket, alongside `impact-by-cause.tsx`):
- A print-friendly statement component, entirely server-rendered (no `'use client'`) — the three-column table itself has no interactivity.
- One tiny client leaf for the entity/month picker (`<select>` + `router.push`, same shape as the admin `FiscalYearSelector`).
- One tiny client leaf for the "Print / Save as PDF" button (`onClick={() => window.print()}`) — this is the only reason any client JS exists on this feature.
- Breadcrumbs/picker/print-button wrapped in `print:hidden` (precedent: `/admin/ledger/guide/page.tsx` lines 113 and 136) so the printed/saved page shows only the statement itself.

**Query layer** — see DECISION-049 in `docs/decisions.md` for the full ruling. Summary: `getFundReport()` gets an additive `opts?: { asOfDate?: string }` parameter (bounds its existing FYTD/rollforward/budget computation at a month-end instead of "now" — same function, same numbers, no fork). A **new sibling file**, `src/lib/financial-report-queries.ts`, holds everything genuinely new: the bank-cleared-date One-Month column (join through `ledgerReconciliationMatches` → `ledgerBankLines.postingDate`, `reconciledAt`-fallback for legacy-toggled rows per the locked Q3 answer), the month-boundary reconciliation gate, the book-balance-vs-cash divergence footnote, and the member-exposed-fund allowlist. This is the same split already established between `ledger-queries.ts` and `reconciliation-queries.ts` — a distinct read surface composing the existing engine, not a rework of it.

**Server vs client split** — both pages are Server Components (`auth()` + data fetch inline, matching `/members/impact`'s pattern exactly — no redirect on missing `memberId`, an inline "Account Not Linked" state instead). Only the picker and the print button need `'use client'`; everything else, including the entire statement table, is server-rendered HTML.

**Dependencies** — **none.** Confirmed against the Dependency Evaluation Criteria: browser Save-as-PDF via `window.print()` + print CSS needs no library. No PDF-generation package (`puppeteer`, `pdfkit`, `react-pdf`, etc.) enters `package.json`. The whole feature is server-rendered HTML plus the `print:hidden` Tailwind variant already in production use at `/admin/ledger/guide`.

## The Load-Bearing Computation Call

Ruled in full in DECISION-049. The short version, restated for this section per the review template: **extend `getFundReport()`** for every figure that must match the admin Ledger exactly (Twelve-Month FYTD, Annual Budget, book-balance beginning/ending) — a new sibling function here would be a second, independently-maintained path to numbers members and the treasurer both look at, and any future edit to the rollforward/budget logic would have to remember to update two places or the two views would silently disagree. **New sibling module** (`financial-report-queries.ts`) only for what has no existing home: the cash-cleared-date bucketing, which nothing in `ledger-queries.ts` does today. That new module's entry point should compose `getFundReport(fundId, fiscalYear, { asOfDate: monthEnd })` internally rather than re-deriving FYTD/book-balance figures from raw transactions itself.

## Invariants Touched

- **Permissions (view = member-linked, no new `FEATURES` key).** Confirmed correct and matches the `/members/impact` precedent — gated on `session.user.memberId` being non-null, nothing else. This is a deliberate, narrower case than `impact.view`'s two-tier board/members toggle: `impact.view` only gets checked when `philanthropyVisibility='board'` (an admin-configurable knob); this feature has no such knob per the locked Q5 answer — viewing is unconditionally open to every linked member, by design ("expose accountability to the entire club"). That's not a bypass of the FEATURES model — the model still gates every *write* path here (reconciliation-session close stays `ledger.record`, unchanged) — it's the same "view" carve-out the codebase already has one precedent for, applied a second time with an even simpler (single-tier) shape. No migration, no new permission-catalog entry.
- **Server/client boundary.** Respected — see Placement above. Two narrow client leaves (picker, print button); the statement itself, including its auth check, lives in a Server Component.
- **Member-facing data exposure — the important one.** The projection boundary must be enforced **inside `financial-report-queries.ts`**, not at the page or component layer, for two reasons: (1) a page-level filter is one omitted line away from leaking a raw transaction row into a client-visible prop; (2) a future second caller of the same query function (another admin page, an API route) must not have to remember to re-apply the filter. Concretely:
  - The query function's return type carries only aggregated fields (category name, actual/budget cents, book balances, footnote text) — never `party`, `memo`, `checkNumber`, `publicNote`, `donorId`, or any transaction `id`. This is the exact same shape of guarantee `getPhilanthropy()` already gives `/members/impact` (aggregated `PhilanthropySummary`, zero raw rows reaching the client) — same pattern, new function.
  - The fund-exposure allowlist (only `fund.kind IN ('administrative', 'charitable')` — Activity and Scholarship stay admin-only per the locked Q5 answer) must be checked **inside** the query function against the resolved fund row, not trusted from the caller's `fundSlug`/`entitySlug` route params. A route param is user-controlled input; the fund's `kind` is the ground truth. If a request resolves to a fund whose `kind` isn't in the allowlist, the function returns null/not-found — it must not be reachable by URL-guessing a valid-but-unexposed fund slug.

## The Reconciliation Gate As An Architectural Seam

Confirmed: the gate predicate (`status='posted' AND reconciled=false AND txnDate <= month-end`, generalizing `getOverview()`'s `unreconciledPriorMonth`) must be computed **inside `financial-report-queries.ts`**, re-evaluated on every call — not filtered out of a picker's list and otherwise trusted. This is what makes the direct-URL failure case in Phase 1's Flow 2 actually safe: whether the request came from the picker or a bookmarked/guessed URL, the same function re-checks the same predicate every time.

The return shape must be a **discriminated union with (at least) two live states**, not a boolean plus a maybe-null statement:
- `{ status: 'gated' }` — an unreconciled posted transaction exists on/before month-end. Page renders Phase 1's "still reconciling this month" copy.
- `{ status: 'ready', statement: MonthlyStatement }` — gate cleared. The statement itself renders in full even when every line is zero (a real, reconciled, quiet month) — this must not collapse into the same UI as `gated`. Phase 1 named this distinction explicitly (a quiet August is not an empty state); the architecture should make it structurally impossible to confuse the two rather than relying on a page-level `if (transactions.length === 0)` check that can't tell "no transactions because not reconciled yet" from "no transactions because nothing happened."

## CLAUDE.md Drift (note only — not edited now)

Two updates will be needed at release, not before: a new `/members/financial-reports/` line under Project Structure's members bullet list, and a new Key Features bullet under Member Portal describing the monthly statement. Flagging here so whoever ships v1 remembers; the 30-day documentation review would also catch it, but no reason to wait that long for a two-line addition.

## Notes for Phase 3

- Treat `getFundReport()`'s new `asOfDate` param and the new `financial-report-queries.ts` module as fixed (DECISION-049) — Phase 3's job is the exact function signature, the discriminated-union type name, and the route/component file list, not re-litigating where the logic lives.
- Naming (`getMonthlyStatement` vs. something else, exact discriminated-union tag names, exact component filenames) is left to tech-lead — these are the "suggestions" half of this verdict, not binding.
- Reuse `unreconciledPriorMonth`'s predicate verbatim (just generalize the boundary date) rather than writing a new one from scratch — it's already trusted elsewhere in the admin dashboard.
- The yellow "check sent, not deposited" highlight reuses the existing uncashed-checks predicate (`paymentMethod='check' AND flow='expense' AND status='posted' AND reconciled=false`) exactly as `getDashboard()` already computes it — no new predicate needed there either.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

We're building a read-only, member-visible "Statement of Financial Condition" that reproduces the two monthly reports the prior treasurer hand-produced in the club's books software — one for the Club's Administrative fund, one for the Foundation's Charitable fund — as a print-friendly page under `/members/financial-reports`. It composes almost entirely existing engines: `getFundReport()` (extended with an additive `asOfDate` bound so FYTD/budget/book-balance figures are computed once, in one place, and can never silently drift from what the admin Ledger shows) plus one new module, `src/lib/financial-report-queries.ts`, for the two genuinely new pieces — a bank-cleared-date "One Month" column and a transaction-level reconciliation gate — both scoped to only the two historically-published funds (Administrative, Charitable) per entity. No schema changes, no new permission key, no mutations: a month's report simply starts rendering the moment its entity's exposed-fund transactions clear reconciliation. The most consequential finding below (not previously surfaced) is that the Quicken-import script stamped every historical `reconciled=true` row's `reconciledAt` with the *import run's* timestamp, not a real bank-clear date — naively falling back to it for the One-Month column would silently corrupt every historical month's cash-basis figures. §7 designs around this.

## Permissions

- **View:** no new `FEATURES` key. Both pages check `session.user.memberId` inline — identical to `/members/impact/page.tsx`'s pattern: `const memberId = session.user.memberId ?? null;` then an inline "Account Not Linked" empty state (not a redirect) when null. Every linked member sees every available month for both entities, unconditionally — this is a deliberate single-tier carve-out, narrower than `impact.view`'s board/members toggle, per the locked Q5 answer.
- **No new admin action.** Auto-publish means there is nothing to gate on the write side beyond what's already gated: the reconciliation-session close that indirectly makes a month eligible is unchanged, still `ledger.record` (`FEATURES.LEDGER_RECORD`), already bound to Admin/Treasurer via `drizzle/migrations/0045_ledger_permissions.sql`. No migration, no role binding, no new `FEATURES.*` entry anywhere in this feature.

## API/Query Contract

No API routes. Both member pages are Server Components calling query functions directly, matching `/members/impact` and `/admin/ledger/[fundSlug]/report/page.tsx` (per DECISION-044's no-internal-API-round-trip convention). Everything below is read-only — no `POST`/`PATCH`, no `db.transaction()`.

### 1. `getFundReport()` extension — `src/lib/ledger-queries.ts`

```ts
export async function getFundReport(
  fundId: string,
  fiscalYear: number,
  opts?: { asOfDate?: string },   // 'YYYY-MM-DD', inclusive
): Promise<FundReport | null>
```

- Additive third parameter, optional. **Every existing call site is unaffected** — the admin fund-report page and `BudgetEditor` never pass it, so `opts?.asOfDate` is `undefined` there and behavior is byte-for-byte identical to today.
- When `asOfDate` is provided: the step-2 transactions query's exclusive upper bound (currently `lt(ledgerTransactions.txnDate, end)` where `end` = FY-end-exclusive) becomes `lt(ledgerTransactions.txnDate, min(end, dayAfter(asOfDate)))`. Nothing else in the function changes — the same rolled-forward `openingCents`, the same posted-only actuals grouping, the same `budgetVariance()` calls, the same `endingCents = openingCents + income - expense` arithmetic. This is the whole point of the extension: the monthly statement's FYTD actuals, budget-variance, and book-balance figures are *this function's output*, not a re-derivation.
- The step 4b pre-FY rollforward query is untouched (it's already bounded to `< start`, i.e. strictly before FY start, which is always `<= asOfDate` in every call this feature makes).
- Return type `FundReport` is unchanged.

### 2. New file — `src/lib/financial-report-queries.ts`

```ts
export const MEMBER_EXPOSED_FUND_KINDS = ["administrative", "charitable"] as const;

export type MonthlyStatementCategoryLine = {
  categoryId: string;
  categoryName: string;
  oneMonthCents: number;         // bank-cleared-date net, this report month only
  twelveMonthCents: number;      // = FundReportCategoryLine.actualCents (FYTD, posted-basis)
  annualBudgetCents: number | null;
  hasUncashedCheck: boolean;     // yellow-highlight flag, evaluated as-of month-end
};

export type MonthlyStatement = {
  month: string;                       // 'YYYY-MM'
  monthEndLabel: string;                // "June 30, 2026" — display only
  income: MonthlyStatementCategoryLine[];
  expense: MonthlyStatementCategoryLine[];
  totalRevenue: { oneMonthCents: number; twelveMonthCents: number; budgetCents: number };
  totalExpense: { oneMonthCents: number; twelveMonthCents: number; budgetCents: number };
  net: { oneMonthCents: number; twelveMonthCents: number; budgetCents: number };
  beginningBookBalanceCents: number;    // book balance at report-month start (= prior month-end)
  endingBookBalanceCents: number;       // book balance at report-month end — SAME value for
                                         // both the One-Month and Twelve-Month columns (locked Q2)
  bookVsCashDivergenceCents: number;    // endingBookBalanceCents - (beginningBookBalanceCents + net.oneMonthCents); 0 = no footnote
  usedLegacyReconciledAtFallback: boolean;  // footnote: some One-Month figures used reconciledAt, not a bank-line date
  hasUndatedHistoricalRows: boolean;         // footnote: some reconciled rows have NO trustworthy clear date and are excluded from One-Month (see §7)
};

export type MonthlyStatementResult =
  | { status: "gated" }
  | { status: "ready"; statement: MonthlyStatement };

/**
 * Whole-statement builder. `fund` must already be resolved by the caller
 * (getFunds(entity.id) + slug/kind lookup — same shape as the admin fund-report
 * page). Returns `null` when `fund.kind` is not in MEMBER_EXPOSED_FUND_KINDS —
 * this is NOT part of the gated/ready union; it means "this fund is not a
 * member-facing surface at all," checked against the resolved DB row, never
 * trusted from a route param. Callers (the [entitySlug]/[month] page) treat
 * null as notFound().
 */
export async function getMonthlyStatement(
  fund: LedgerFund,
  month: string,        // 'YYYY-MM', validated by the route segment
): Promise<MonthlyStatementResult | null>;

/** Per-entity gate, scoped to member-exposed funds only (Q1's accepted answer):
 *  true iff a posted, unreconciled transaction exists, dated on/before
 *  monthEnd, in a fund whose kind is in MEMBER_EXPOSED_FUND_KINDS for this
 *  entity. Reuses getOverview()'s unreconciledPriorMonth predicate verbatim
 *  (status='posted' AND reconciled=false AND txnDate <= monthEnd), generalized
 *  to an arbitrary boundary and joined to ledger_funds to exclude Activity/
 *  Scholarship — a stale unreconciled Activity-fund transaction must never
 *  block the Administrative statement from publishing. */
export async function isMonthGatedForEntity(
  entityId: string,
  monthEnd: string,      // 'YYYY-MM-DD'
): Promise<boolean>;

/** 'YYYY-MM' of the most recent month whose gate clears for this entity, or
 *  null if none has ever cleared. Drives the landing page's month list.
 *  getMonthlyStatement() re-checks isMonthGatedForEntity() itself on every
 *  call — this is a picker convenience, never trusted as the sole gate. */
export async function getLatestOpenMonthForEntity(entityId: string): Promise<string | null>;
```

Internal (unexported, or exported `/** @internal */` purely for direct unit testing — implementer's call):

```ts
/** Pure. 'YYYY-MM' -> calendar-string bounds. No Date-object math on the
 *  calendar side — integer y/m arithmetic only, mirroring fyBounds()'s own
 *  plain-string style, so there is no timezone-shift surface here at all. */
function monthBounds(month: string): {
  monthStart: string;            // 'YYYY-MM-01'
  monthEnd: string;               // last calendar day of month
  nextMonthStartExclusive: string;
};

/** Bank-cleared-date bucketing for one fund + one report month, by
 *  (categoryId, flow). Join chain: ledgerTransactions
 *  LEFT JOIN ledgerReconciliationMatches ON matches.transactionId = txn.id
 *  LEFT JOIN ledgerBankLines ON bankLines.id = matches.bankLineId.
 *  WHERE txn.fundId = fundId AND txn.status='posted' AND txn.reconciled=true.
 *  Effective clear date, in priority order:
 *    1. bankLines.postingDate — when a match exists (accurate).
 *    2. txn.reconciledAt's date — ONLY when txn.memo does NOT carry the
 *       Quicken-import marker (see §7) — legacy per-row-toggle rows, where
 *       reconciledAt is a real human action's timestamp, a reasonable proxy.
 *    3. Neither — Quicken-imported rows with no bank-line match. EXCLUDED from
 *       this bucketing entirely (never attributed to any month's One-Month
 *       column); flagged via the returned hasUndatedHistoricalRows. These
 *       rows are NOT excluded from twelveMonthCents (that's txnDate/posted-
 *       basis via getFundReport(), unaffected by this problem).
 *  Rows whose effective clear date falls in [monthStart, nextMonthStartExclusive)
 *  are summed by (categoryId, flow) into amountCents. */
async function computeOneMonthCashActuals(
  fundId: string,
  monthStart: string,
  nextMonthStartExclusive: string,
): Promise<{
  byCategory: Map<string, number>;   // key = `${categoryId}_${flow}`
  usedLegacyReconciledAtFallback: boolean;
  hasUndatedHistoricalRows: boolean;
}>;

/** Reuses getDashboard()'s uncashedChecks predicate exactly
 *  (paymentMethod='check' AND flow='expense' AND status='posted' AND
 *  reconciled=false), scoped to fundId and txnDate <= monthEnd (a check
 *  written in an earlier month and still outstanding stays flagged in every
 *  later month's report — matches both reference PDFs, where the flagged
 *  line's dollar figure sits in the Twelve-Month column, not One-Month). */
async function computeUncashedCheckCategoryIds(
  fundId: string,
  monthEnd: string,
): Promise<Set<string>>;   // categoryIds with >= 1 outstanding check
```

`getMonthlyStatement()`'s body, in order: (1) allowlist check on `fund.kind` → `null` if not exposed; (2) `isMonthGatedForEntity(fund.entityId, monthEnd)` → `{status:'gated'}` if true; (3) `reportFY = getFiscalYear(monthEnd)`; `currentReport = await getFundReport(fund.id, reportFY, { asOfDate: monthEnd })`; (4) `priorMonthEnd` = last day of the prior calendar month; `priorReport = await getFundReport(fund.id, getFiscalYear(priorMonthEnd), { asOfDate: priorMonthEnd })` (only `.endingCents` is used — the prior month's book-balance-at-close); (5) `computeOneMonthCashActuals` + `computeUncashedCheckCategoryIds`; (6) merge into `MonthlyStatementCategoryLine[]` keyed off `currentReport.income`/`.expense` (which already include every active, zero-actual category — no line is ever silently dropped); (7) assemble totals/net/balances/divergence; return `{status:'ready', statement}`.

### Data-exposure boundary (enforced inside this module, not the page)

`MonthlyStatementCategoryLine` carries only `categoryId`, `categoryName`, three `*Cents` numbers, and a boolean. **Never** `party`, `memo`, `checkNumber`, `publicNote`, `donorId`, a transaction `id`, or a bank-line/match id — mirrors `getPhilanthropy()`'s guarantee to `/members/impact` exactly (aggregated summary type, zero raw rows reach the client). The fund allowlist check happens against `fund.kind` (the resolved DB row) inside `getMonthlyStatement()`, never against a caller-supplied slug — a route param guessing a valid-but-unexposed fund slug (Activity, Scholarship) cannot reach real data.

## Data Model

**No schema changes required.** Every figure derives from `ledger_transactions`, `ledger_categories`, `ledger_budgets`, `ledger_reconciliation_matches`, and `ledger_bank_lines` — all already modeled. I looked specifically for a place this might force a new column (a persisted "published" flag, a per-line note, a stored "as of" cutoff) and found none: publish state is computed live from the gate predicate every request (no flag to persist), and per-line notes are explicitly deferred to v2. The one place I found real data with no home — the reference reports' Annual-Budget-column Beginning/Ending Fund Balance figures — is **not** a schema gap; it's a scope cut, addressed in §7 rather than looped back to Phase 2.

## Component / Page Plan

**Pages to create:**
- `src/app/members/financial-reports/page.tsx` — landing/picker. Server Component: `auth()` + inline `memberId` gate (no redirect on missing link, matching `/members/impact`). For each entity, calls `getEntities()` + `getLatestOpenMonthForEntity(entity.id)` to build the available-months list (only months <= the latest open boundary are offered — future/gated months never appear as options). Empty state ("nothing published yet") when an entity has never cleared its gate.
- `src/app/members/financial-reports/[entitySlug]/[month]/page.tsx` — the statement. Server Component: `auth()` + inline `memberId` gate; resolves `entitySlug` via `getEntity()` (→ `notFound()` if invalid, same as the admin report page); resolves the entity's single member-exposed fund via `getFunds(entity.id).filter(f => MEMBER_EXPOSED_FUND_KINDS.includes(f.kind))[0]` (→ `notFound()` if none — defense-in-depth, shouldn't happen given the seeded fund set); validates `month` matches `/^\d{4}-\d{2}$/` (→ `notFound()` on garbage); calls `getMonthlyStatement(fund, month)`; renders one of three states — `null` → `notFound()`, `{status:'gated'}` → "this month isn't ready yet" copy, `{status:'ready', statement}` → the table, including the **all-zero-but-ready** case (never collapsed into the gated copy).

**Components to create** (`src/components/members/`):
- `monthly-statement-table.tsx` — server-rendered (no `'use client'`), the three-column REVENUE/EXPENSES/Net/Beginning→Ending table, yellow-highlighted rows for `hasUncashedCheck`, footer disclosure block (basis note + conditional legacy-fallback/undated-rows/divergence footnotes).
- `financial-report-picker.tsx` — `'use client'`, entity tabs + month `<select>` + `router.push`, same shape as `FiscalYearSelector`. Wrapped in `print:hidden`.
- `print-statement-button.tsx` — `'use client'`, `onClick={() => window.print()}`. Wrapped in `print:hidden`.

**Files to modify:**
- `src/lib/ledger-queries.ts` — `getFundReport()` gains `opts?: { asOfDate?: string }` (§ above).
- `src/app/members/page.tsx` — add a nav card linking to `/members/financial-reports`, alongside the existing `/members/impact` card (line ~171).
- `CLAUDE.md` — add the `/members/financial-reports/` line under Project Structure's members bullet, and a Key Features bullet under Member Portal (architect flagged this at Phase 2; do it as part of this feature's own release, not deferred to the 30-day doc review).

**Mobile + print CSS:** table wrapped in `overflow-x-auto` (narrower than the 5-column admin report — 4 visible columns here — but keep the wrapper per UX Guidelines convention regardless). Breadcrumbs, picker, and print button all `print:hidden` (precedent: `/admin/ledger/guide/page.tsx` lines 113, 136); the printed/saved page shows only the statement + its own header + footer disclosure.

## Implementation Order

1. **Query layer** (api-developer): `getFundReport()` `asOfDate` extension in `ledger-queries.ts` → new `financial-report-queries.ts` (allowlist, gate, `monthBounds`, `computeOneMonthCashActuals` incl. the Quicken-marker exclusion, `computeUncashedCheckCategoryIds`, `getMonthlyStatement`, `getLatestOpenMonthForEntity`).
2. **Member routes/pages** (ux-developer): `financial-reports/page.tsx`, `[entitySlug]/[month]/page.tsx`.
3. **Components** (ux-developer): `monthly-statement-table.tsx`, `financial-report-picker.tsx`, `print-statement-button.tsx`.
4. **Unit tests** (§8 below) — written by the implementer whose layer they cover, not qa.
5. **CLAUDE.md** structure + Key Features update (last UI step, per §Component/Page Plan above).
6. **Release notes** — written by tech-lead at Phase 6 SHIP IT (not an implementer deliverable), per this repo's ownership convention.

No schema step, no `FEATURES` step, no email step — none apply to this feature.

## Edge Cases & Risks

- **Quicken-import `reconciledAt` is not a real clear date — the sharpest risk in this design.** `scripts/import-quicken-ledger.ts` (line ~966) sets `reconciledAt: t.reconciled ? new Date() : null` — i.e., every historical reconciled row's `reconciledAt` is the *2026-07-20 import run's* timestamp, not when the bank actually cleared it. Phase 1/2's "fall back to `reconciledAt` for legacy rows" language conflates two different populations: rows reconciled via the **old per-row toggle** (a human's real-time click — `reconciledAt` is a reasonable proxy) vs. **Quicken-imported** rows (`reconciledAt` is a single bulk backfill timestamp shared by ~276 transactions spanning a whole fiscal year — using it would either zero out every historical month's One-Month column or dump a year's transactions into whichever single month the import happened to land in). The importer tags every row it writes with a `[quicken-import]` marker in `memo` (`buildMemo()`, `IMPORT_MARKER` constant) — `computeOneMonthCashActuals` must check for that marker (as a literal string constant colocated in `financial-report-queries.ts`, not an import from `scripts/` — scripts aren't meant to be imported by the app) and **exclude** such rows from One-Month bucketing entirely rather than mis-bucket them, surfacing `hasUndatedHistoricalRows` in the footer. Logged as DECISION-050.
- **`reconciledAt` is a naive (`timestamp`, no timezone) column** — this codebase has hit the naive-timestamp-as-UTC bug before on event/RSVP timestamps. Before wiring the fallback in step 2 above, the implementer must find the existing display convention for `reconciledAt`/session-close timestamps elsewhere in the admin Ledger (reconciliation session detail page) and match it exactly — do not introduce a second, different UTC-slicing convention for this one column. Write a unit test with a `reconciledAt` near a month boundary (e.g., 11:30 PM Jun 30 local) to pin the behavior.
- **Fiscal-year boundary months (June/July).** No special-casing needed — `reportFY = getFiscalYear(monthEnd)` naturally gives June a full-FY Twelve-Month column and July a fresh 1-month FYTD, since `getFiscalYear()` already treats June as the prior FY's last month. Covered by a named test in §8 regardless, since it's exactly the kind of boundary this codebase has gotten subtly wrong before.
- **A reconciled, zero-activity month.** Must render the full table with all-zero lines — the `{status:'ready', statement}` branch, never collapsed into `{status:'gated'}`. This is why the union is structural, not a `transactions.length === 0` check.
- **Direct-URL hit on an unreconciled month or a non-exposed fund** (Activity/Scholarship guessed via `entitySlug`, or a month before the gate clears). Must not 404 for "not reconciled yet" (looks broken) and must not leak partial numbers. The gate is re-evaluated inside `getMonthlyStatement()` on every call — never trusted from the picker's list — and the fund-exposure check happens the same way. A guessed non-exposed fund is actually unreachable via this route today (there's only one member-exposed fund per entity and the route has no fund segment), but the allowlist check stays in the query layer as defense-in-depth per the architect's ruling, in case a second exposed-fund-kind is ever added.
- **The book-vs-cash footnote's wording is real, user-facing financial language** — it must read as normal accounting practice ("a check written but not yet cashed by the bank"), not as an error or a discrepancy alert. Draft copy: *"Book balance and one-month cash totals differ by $X this month — see the highlighted line(s) above for outstanding checks not yet cleared by the bank."* Recommend the treasurer (the user) sign off on this exact sentence before Phase 6, the same way Q2/Q4/Q5 needed sign-off — flagging explicitly rather than shipping wording no one but me has reviewed.
- **The hard invariant — member numbers == admin numbers — is structurally enforced**, not just tested: `endingBookBalanceCents`/FYTD/budget figures are literally `getFundReport()`'s own return values (same function, same code path the admin fund-report page calls), differing only in the `asOfDate` bound. The only way these could ever disagree is a future edit to `getFundReport()` that doesn't consider the `asOfDate` path — the extension's own doc comment should say so.
- **Annual-Budget-column Beginning/Ending Fund Balance rows have no data source and are cut from v1** (shown as "—"). I checked this against both reference PDFs' actual numbers: the Budget column's "Beginning fund balance" (e.g., Foundation: $XX,XXX.XX) does **not** equal the Twelve-Month column's beginning ($XX,XXX.XX) or any value `getFundReport()` can produce — it was a separate, hand-estimated figure the prior treasurer tracked outside this system. Building it would mean inventing a new persisted "budgeted beginning balance" input with no authoring UI in scope (the same category of problem Phase 1 already deferred for per-line notes). This is a reversible scope cut, not a technical wall — flagging for the user's sign-off alongside the footnote wording, not blocking Phase 4.
- **`getLatestOpenMonthForEntity()` must scope its underlying `MIN(unreconciled txnDate)` query to member-exposed funds only** (join to `ledger_funds`, filter `kind IN ('administrative','charitable')`) — otherwise a stale unreconciled Activity-fund transaction would silently freeze the Administrative statement's picker, contradicting the per-entity/member-exposed-funds-only gate scope this design (and the task's own Q1 answer) specifies.

## Unit Tests to Write in Phase 4

All in `src/lib/financial-report-queries.test.ts` (new) unless noted, mocking `@/lib/db` per the established pattern in `src/lib/ledger-queries.test.ts`/`src/lib/dues-ledger-sync.test.ts` (canned `.select()` responses keyed to call order, no real DB).

1. **`getFundReport` asOfDate bounding** (in `src/lib/ledger-queries.test.ts`, alongside existing coverage) — a transaction dated after `asOfDate` is excluded from actuals/ending balance; a transaction on `asOfDate` is included (inclusive bound); omitting `opts` entirely reproduces today's behavior byte-for-byte (regression guard for every existing call site).
2. **One-Month cleared-date bucketing** — a bank-line-matched transaction buckets by `postingDate`; a legacy per-row-toggle transaction (no match, no import marker) buckets by `reconciledAt`'s date; a Quicken-imported transaction (no match, import marker present in memo) is **excluded** from the One-Month total and sets `hasUndatedHistoricalRows: true`; a transaction whose clear date falls in an adjacent month is excluded from this month's bucket.
3. **Gate predicate** — an unreconciled posted transaction dated on/before month-end in a member-exposed fund gates the month; the same transaction in the Activity/Scholarship fund does **not** gate it; a transaction dated after month-end does not gate it.
4. **Discriminated-union states** — gated (unreconciled txn present) vs. ready-zero-activity (gate clears, no transactions at all) vs. ready-with-data — assert the three never collapse into the same shape.
5. **Exposure projection** — construct a statement from mock rows carrying `party`/`memo`/`checkNumber`/an id, and assert the returned `MonthlyStatementCategoryLine` object has none of those keys (a type-level guarantee plus a runtime `Object.keys()` assertion, since a stray spread could reintroduce a leak silently).
6. **Fund allowlist** — a fund with `kind: 'activity'` or `'scholarship'` passed to `getMonthlyStatement()` returns `null`, never `{status:'gated'}`.
7. **Fiscal-year boundary** — a June report month uses the FY that's about to close (full 12-month FYTD); a July report month uses the newly-started FY (1-month FYTD) — both derived from the same `getFiscalYear()` call, no special-casing.
8. **`monthBounds()` pure helper** — 'YYYY-MM' → correct start/end/next-month-start strings, including December → January year rollover.

## Implementer

**Two-stage specialist split**, matching how every Ledger increment (bank reconciliation, cause-tagged budget lines) has shipped cleanly:

1. **api-developer** — the query layer: `getFundReport()`'s `asOfDate` extension, all of `financial-report-queries.ts`, and the tests in §8. This is the load-bearing, correctness-critical half (money, PII boundary, the Quicken-date landmine) and has no UI dependency.
2. **ux-developer** — once the query layer lands: the two pages, the three components, the `/members` nav link, and the CLAUDE.md touch-up.

Not full-stack-developer: this is larger than the ~150-line/small-and-tightly-coupled bar (two new pages, three new components, a multi-function query module with a genuinely tricky correctness problem), and the query layer's risk profile (get it right once, reuse everywhere) is exactly the case DECISION-049 already argued for a clean split.

---

# Phase 4 — Implementation

## Phase 4 — Implementation (Query Layer) — 2026-07-28

**Owner:** api-developer
**Status:** complete

### Summary

Implemented the read-only query layer exactly per the Phase 3 design and DECISION-049/050: an additive, backward-compatible `asOfDate` bound on `getFundReport()`, and a new sibling module `src/lib/financial-report-queries.ts` holding everything genuinely new (bank-cleared-date bucketing with the Quicken-import exclusion, the transaction-level reconciliation gate, the fund allowlist, the book-vs-cash divergence footnote). No schema changes, no migration, no mutations, no routes/UI — that's ux-developer's half. All 8 Phase-3-named unit tests are written and passing, plus several additional cases for robustness.

### What I did

- Extended `getFundReport()` with `opts?: { asOfDate?: string }`, changing only the actuals query's exclusive upper bound (`min(fyEnd, asOfDate + 1 day)` instead of `fyEnd`); every other step (categories, budgets, pre-FY rollforward, cause-line batching, variance) is untouched, and omitting `opts` reproduces the exact prior query (proven in tests via `PgDialect().sqlToQuery()` parameter inspection, not just downstream arithmetic).
- Added a pure, Date-object-free `addOneDayToYMD()` helper next to `fyBounds()` in `ledger-queries.ts` for the day-after-asOfDate math (integer y/m/d arithmetic only — `date` columns in this schema are already plain strings, so there's no naive-timestamp-as-UTC surface here at all).
- Built `src/lib/financial-report-queries.ts` with: `MEMBER_EXPOSED_FUND_KINDS`, `monthBounds()` (pure, no `Date` object — integer calendar arithmetic mirroring `fyBounds()`'s own style), `isMonthGatedForEntity()`, `computeOneMonthCashActuals()` (with the three-tier clear-date fallback and Quicken-marker exclusion), `computeUncashedCheckCategoryIds()`, `getLatestOpenMonthForEntity()`, and `getMonthlyStatement()` composing all of the above plus the real `getFundReport()` (current month + prior month, for the beginning book balance).
- Wrote all 8 Phase-3-named unit tests (plus several extras) across `src/lib/ledger-queries.test.ts` (asOfDate bounding, 4 tests) and the new `src/lib/financial-report-queries.test.ts` (the other 7 named tests, 20 tests total) — 602 tests passing overall (578 pre-existing + 24 new), hermetic (`unset DATABASE_URL DB_URL && pnpm test` passes with no real DB).
- Confirmed `pnpm exec tsc --noEmit` passes clean.
- Confirmed `pnpm lint` fails identically on unmodified `main` (ESLint 9 / `minimatch` ESM-CJS interop error in the toolchain, unrelated to this change — verified via `git stash`) — not introduced by this work, flagging for deployment-engineer/whoever owns the dependency review rather than silently working around it.

### Outputs

**`getFundReport()` extension** — `src/lib/ledger-queries.ts`:
```ts
export async function getFundReport(
  fundId: string,
  fiscalYear: number,
  opts?: { asOfDate?: string },   // 'YYYY-MM-DD', inclusive
): Promise<FundReport | null>
```
Additive, backward-compatible. `FundReport` return shape unchanged.

**New module** — `src/lib/financial-report-queries.ts`:
```ts
export const MEMBER_EXPOSED_FUND_KINDS = ["administrative", "charitable"] as const;

export type MonthlyStatementCategoryLine = {
  categoryId: string;
  categoryName: string;
  oneMonthCents: number;
  twelveMonthCents: number;
  annualBudgetCents: number | null;
  hasUncashedCheck: boolean;
};
export type MonthlyStatementTotals = { oneMonthCents: number; twelveMonthCents: number; budgetCents: number };
export type MonthlyStatement = {
  month: string;                 // 'YYYY-MM'
  monthEndLabel: string;          // "June 30, 2026" — display only
  income: MonthlyStatementCategoryLine[];
  expense: MonthlyStatementCategoryLine[];
  totalRevenue: MonthlyStatementTotals;
  totalExpense: MonthlyStatementTotals;
  net: MonthlyStatementTotals;
  beginningBookBalanceCents: number;
  endingBookBalanceCents: number;
  bookVsCashDivergenceCents: number;
  usedLegacyReconciledAtFallback: boolean;
  hasUndatedHistoricalRows: boolean;
};
export type MonthlyStatementResult =
  | { status: "gated" }
  | { status: "ready"; statement: MonthlyStatement };

export function monthBounds(month: string): { monthStart: string; monthEnd: string; nextMonthStartExclusive: string };
export async function isMonthGatedForEntity(entityId: string, monthEnd: string): Promise<boolean>;
export async function computeOneMonthCashActuals(fundId: string, monthStart: string, nextMonthStartExclusive: string): Promise<{ byCategory: Map<string, number>; usedLegacyReconciledAtFallback: boolean; hasUndatedHistoricalRows: boolean }>;
export async function computeUncashedCheckCategoryIds(fundId: string, monthEnd: string): Promise<Set<string>>;
export async function getLatestOpenMonthForEntity(entityId: string): Promise<string | null>;
export async function getMonthlyStatement(fund: LedgerFund, month: string): Promise<MonthlyStatementResult | null>;
```

**Schema changes:** none. No migration.

**Auth/feature gates:** none in this module by design (view is `session.user.memberId`-gated at the page layer per Phase 3, not `hasFeature()` — no new `FEATURES.*` key). This is a read-only query layer with no route/action of its own.

### Implementer Notes

- **How `asOfDate` bounds the rollup without reimplementing it:** `getFundReport()`'s only change is the actuals query's exclusive upper bound — `const upperBound = asOfUpperBound < end ? asOfUpperBound : end` where `asOfUpperBound = opts?.asOfDate ? addOneDayToYMD(opts.asOfDate) : end`. When `opts` is omitted, `upperBound === end` identically, so the generated WHERE condition is byte-for-byte what existed before (proven in tests by decoding the captured Drizzle condition via `new PgDialect().sqlToQuery(condition)` and asserting on `params`, not just trusting arithmetic on canned rows — this is the most rigorous test in the suite and the one most worth reading if reviewing this later). Every other line in `getFundReport()` is untouched.
- **The Quicken-import One-Month exclusion (DECISION-050):** `computeOneMonthCashActuals()` checks `memo.endsWith("[quicken-import]")` (the literal marker, colocated as a constant — not imported from `scripts/`) as the SECOND priority only when no bank-line match exists. A matched row always uses `postingDate` regardless of memo. An unmatched, marker-tagged row is excluded outright (never falls back to `reconciledAt`, which is the 2026-07-20 bulk-import timestamp for ~276 rows, not a real clear date) and sets `hasUndatedHistoricalRows`. An unmatched, unmarked row (true legacy per-row-toggle) falls back to `reconciledAt`'s date and sets `usedLegacyReconciledAtFallback`.
- **`reconciledAt` UTC-getter handling:** `reconciledAt` is a naive (`timestamp`, no timezone) column — Postgres/node-postgres round-trips it into a JS `Date` by treating the literal wall-clock digits as UTC (the same mechanism behind the project's known naive-timestamp-as-UTC bug class, fixed for events in v1.14.0 by switching to string-mode columns instead). `ledgerTransactions` predates that fix and keeps a Date-typed column, so `reconciledAtToYMD()` deliberately uses `getUTCFullYear/getUTCMonth/getUTCDate` — NOT local getters — to recover the original wall-clock date without compounding the shift. Tested explicitly with an 11:30 PM Jun 30 UTC-encoded timestamp to pin this behavior at the exact boundary the design flagged as highest-risk.
- **Exposure boundary enforcement:** `MonthlyStatementCategoryLine` objects are built field-by-field in `buildLines()` (`{ categoryId: line.categoryId, categoryName: line.categoryName, oneMonthCents: ..., twelveMonthCents: line.actualCents, annualBudgetCents: line.budgetCents, hasUncashedCheck: ... }`) — never a rest/object-spread of a raw row. `computeOneMonthCashActuals()` similarly only ever writes summed `amountCents` into a `Map<string, number>`; `party`/`memo`/`checkNumber`/`id`/`donorId` are read internally (memo for the marker check) but never placed on any returned value. The exposure-projection test constructs canned transaction AND category rows carrying decoy `party`/`memo`/`checkNumber`/`id`/`donorId`/`publicNote` fields and asserts (via `Object.keys()`) that none of them survive into the returned statement — this is a genuine regression guard against a future careless spread, not just a type-level claim.
- **Fund allowlist checked against the resolved DB row:** `getMonthlyStatement()`'s very first line is `if (!isMemberExposedKind(fund.kind)) return null;`, before any `db` call — confirmed in tests that this returns `null` (not `{status:'gated'}`) for `kind: 'activity'`/`'scholarship'` fund objects.
- **`isMonthGatedForEntity()` design choice:** narrows by `entityId`/`status='posted'`/`reconciled=false` in SQL, then filters by fund-kind allowlist AND the `txnDate <= monthEnd` threshold in JS over the fetched row set — deliberately mirroring `getOverview()`'s own `unreconciledPriorMonth`, which already does its date-threshold filtering in JS rather than in the WHERE clause. This keeps the predicate directly unit-testable against canned rows (no SQL-condition introspection needed for this one) while staying semantically identical to a SQL-bound equivalent.
- **`getLatestOpenMonthForEntity()`'s ceiling:** deliberately never offers the current calendar month as "open" (it can't have been reconciled — it isn't over yet), capping at last month even when there are zero unreconciled member-exposed transactions at all. This function is explicitly a "picker convenience" per the Phase 3 design (not part of the 8 named tests) — `getMonthlyStatement()` re-checks the real gate on every call regardless of what this returns, so an edge case here can't leak ungated data.
- **Divergence footnote sign convention:** `bookVsCashDivergenceCents = endingBookBalanceCents - (beginningBookBalanceCents + net.oneMonthCents)`. Zero means no footnote needed; the UI should treat any non-zero value as "explain, don't alarm" per Phase 3's Edge Cases note — the exact footnote sentence still needs the treasurer's sign-off (flagged there, not resolved here).
- **Annual-Budget-column Beginning/Ending Fund Balance rows** are out of scope per DECISION-050 item 3 — `MonthlyStatement` has no field for them at all; the UI renders "—" for those two cells (ux-developer's job, not a gap in this module).
- **`pnpm lint` fails identically on unmodified `main`** (ESLint 9 + `minimatch` ESM/CJS interop error, verified via `git stash`) — pre-existing toolchain issue, not caused by this change. Flagging rather than silently working around it; someone should pick this up in the next dependencies review.

### Open questions / handoff notes

- **Next agent: ux-developer.** Consume these exact exports from `src/lib/financial-report-queries.ts`: `getMonthlyStatement(fund: LedgerFund, month: string): Promise<MonthlyStatementResult | null>`, `getLatestOpenMonthForEntity(entityId: string): Promise<string | null>`, `MEMBER_EXPOSED_FUND_KINDS`, and the `MonthlyStatement`/`MonthlyStatementCategoryLine`/`MonthlyStatementTotals`/`MonthlyStatementResult` types. Resolve the fund the same way the admin fund-report page does (`getFunds(entity.id)` then filter to `MEMBER_EXPOSED_FUND_KINDS.includes(f.kind)`), per DECISION-050 item 2 (no fund route segment).
- **Three render states to handle distinctly, per Phase 3:** `null` → `notFound()` (invalid entity/month or a non-exposed fund reached defensively); `{status:'gated'}` → the "still reconciling this month" copy (must not look like an error or a 404); `{status:'ready', statement}` → render in full even when every line is zero (a real, reconciled, quiet month — must never collapse into the gated copy).
- **Footer disclosures to wire up from the statement object:** `usedLegacyReconciledAtFallback`, `hasUndatedHistoricalRows`, and `bookVsCashDivergenceCents !== 0` each need their own conditional footnote sentence per Phase 3's Edge Cases section — the exact wording for the divergence footnote and the Quicken-import-marker/undated-rows disclosure still needs the treasurer's (Chris's) sign-off before Phase 6, same as Q2/Q4/Q5 needed sign-off in Phase 1.
- **`annualBudgetCents` on `MonthlyStatementTotals`/`MonthlyStatementCategoryLine` can be `null`** (category with no budget row) — render "—", matching the existing admin fund-report page's convention.
- **No Annual-Budget-column Beginning/Ending Fund Balance figures exist in this data model at all** (DECISION-050 item 3) — render "—" for those two cells; do not attempt to derive them from `beginningBookBalanceCents`/`endingBookBalanceCents` (those are the book-balance column's figures, not the budget column's, and the reference PDFs' budget-column balance was confirmed to be a separate hand-tracked figure with no source in this schema).
- **CLAUDE.md structure/Key Features touch-up** is still pending (Phase 3 explicitly assigned this as ux-developer's last step, alongside the UI work, not a query-layer task).

### Fix note — qa Phase 5 loop-back, 2026-07-28

**Status:** complete (re-verification is qa's to re-run)

qa drove the deployed app and found two real bugs in `src/lib/financial-report-queries.ts`, pinned with 3 failing regression tests in `financial-report-queries.test.ts` (611 total, 3 failing). Both fixed here without touching the test file (tests pass unmodified — not weakened).

**Bug 1 root cause — the gate had no "has this month actually happened yet" concept.** `isMonthGatedForEntity()` only asked "does an unreconciled posted transaction exist on/before month-end" — a fund with ZERO outstanding unreconciled backlog (i.e. a well-run set of books, which is the Administrative fund's real state) had nothing to gate a future or still-in-progress month on, so a direct URL to e.g. next January rendered a full `{status:'ready'}` statement. Fixed by adding `hasMonthElapsed(monthEnd, now = new Date())` — true iff `monthEnd` is strictly before the first day of the current calendar month — and short-circuiting `isMonthGatedForEntity()` to `return true` whenever a month hasn't elapsed, before it ever queries the unreconciled-backlog predicate. The gate rule is now: **a month is `ready` only if it has fully elapsed AND no unreconciled posted transaction exists on/before its month-end** (both conditions required; either one failing gates it). `now` uses local `getFullYear()`/`getMonth()` getters deliberately — this is computing "what calendar month is real-world 'now'," the same thing `getOverview()`'s own `firstOfCurrentMonth` already computes the same way; it is NOT the `reconciledAt` naive-timestamp-as-UTC bug class (that's about recovering a DB-stored value's original wall-clock date, a different problem, still handled correctly by `reconciledAtToYMD()`'s UTC getters, unchanged).
- Same-root-cause fix (qa-flagged, low severity): `getLatestOpenMonthForEntity()` previously always returned a string, never `null`, contradicting its own doc comment — its ceiling/candidate month was derived from duplicated date math instead of being checked against the real (now-corrected) gate. It now re-validates its candidate month via `isMonthGatedForEntity()` itself before returning, so `null` is reachable again. This does not, on its own, make a genuinely brand-new/zero-transaction-ever fund show the "nothing published yet" empty state instead of an offered (all-zero, correctly `ready`) month — that's a different, deeper question ("has this fund ever recorded anything") this function was never scoped to answer, and no test pins that behavior; flagging as a possible future follow-up, not fixing it here since it wasn't part of the pinned regressions and risks conflating "reconciled-but-quiet" with "never-reconciled" (a distinction Phase 1 explicitly protected).

**Bug 2 root cause — `monthBounds()` validated shape, not range.** The route's `MONTH_PATTERN` (`/^\d{4}-\d{2}$/`) and `monthBounds()` itself both accepted "13" as a valid two-digit month group; `monthBounds("2026-13")` then silently rolled into `NaN`/`undefined`-poisoned date strings that reached a raw Drizzle date parameter and crashed Postgres with an uncaught 500. Fixed at the single source of truth: `monthBounds()` now validates the month component is 01-12 and the year is within a defensive `[1900, 2999]` sane range, throwing `Error` on either violation instead of producing poisoned output. `getMonthlyStatement()` wraps its `monthBounds(month)` call in try/catch and returns `null` on throw — the exact same "nothing to show here" signal already used for a non-member-exposed fund kind, so no new return shape was introduced.
- **No page change needed.** Read `src/app/members/financial-reports/[entitySlug]/[month]/page.tsx` end to end: it already does `if (result === null) notFound();` (line 92) immediately after calling `getMonthlyStatement()`, before any other code touches `month` again. With the query-layer fix, `getMonthlyStatement(fund, "2026-13")` now returns `null` instead of throwing, so that existing check already 404s cleanly — confirmed by reading every other call site of `month`/`monthBounds` on that page and on the landing page (`ensureMonthOption()`/`buildRecentMonthOptions()` in `src/lib/financial-report-ui.ts` never call `monthBounds()` and are only reached after the null-check has already passed). The page's loose `MONTH_PATTERN` regex is harmless as-is (defense-in-depth only, redundant with the query layer's own validation) — no ux-developer follow-up required.

**Gates:** `pnpm exec tsc --noEmit` clean. `unset DATABASE_URL DB_URL && pnpm test` → 611/611 passing (all 3 previously-failing regressions now pass, test file untouched). `pnpm build:only` → exit 0, both financial-reports routes present in the manifest.

**Files modified:** `src/lib/financial-report-queries.ts` only (`monthBounds()` validation, new `hasMonthElapsed()` helper, `isMonthGatedForEntity()`'s elapsed short-circuit, `getLatestOpenMonthForEntity()`'s re-validated candidate, `getMonthlyStatement()`'s try/catch around `monthBounds()`).

**Next:** qa to re-run Phase 5 against this diff before Phase 6.

---

## Phase 4 — Implementation (UI) — 2026-07-28

**Owner:** ux-developer
**Status:** Complete

### Summary

Built the member-facing routes and components on top of the completed query layer, consuming `getMonthlyStatement()`, `getLatestOpenMonthForEntity()`, and `MEMBER_EXPOSED_FUND_KINDS` exactly as handed off — no changes to `financial-report-queries.ts` or `ledger-queries.ts`. Two Server Component pages, one server-rendered statement table, two `'use client'` leaves (picker, print button), and one new pure UI helper module (with its own hermetic test) round out the feature. Read both reference PDFs (`WLC_June_2026_Monthly_Report.pdf`, `WLCF_June_2026_Monthly_Report.pdf`) to match the three-column layout, section order, and uncashed-check flagging line-for-line.

### What I did

- `src/app/members/financial-reports/page.tsx` — landing/picker. Server Component, `auth()` + inline `memberId` gate (no redirect, matching `/members/impact` byte-for-byte). For each entity, resolves its member-exposed fund via `getFunds(entity.id)` + `MEMBER_EXPOSED_FUND_KINDS` filter, then `getLatestOpenMonthForEntity(entity.id)`. Renders two cards (Club / Foundation) each with a prominent "View [Month] Statement" link to the latest available month, plus a shared `FinancialReportPicker` below for jumping to an older month. Empty state ("Monthly statements will appear here once the treasurer reconciles a month") when no entity has any available month.
- `src/app/members/financial-reports/[entitySlug]/[month]/page.tsx` — statement detail. Server Component, same auth pattern. Validates `month` against `/^\d{4}-\d{2}$/`, resolves `entity` via `getEntity(entitySlug)`, resolves the entity's single member-exposed `fund`, calls `getMonthlyStatement(fund, month)`, and renders exactly the three states named in the Phase 3 design (see Implementer Notes).
- `src/components/members/monthly-statement-table.tsx` — server-rendered (no `'use client'`) three-column REVENUE/EXPENSES/Net/Beginning→Ending table, reproducing the reference PDFs' layout and section order.
- `src/components/members/financial-report-picker.tsx` — `'use client'` entity + month `<select>` pair, immediate-navigate on change (mirrors the admin `FiscalYearSelector` convention), reused identically on both pages.
- `src/components/members/print-statement-button.tsx` — `'use client'`, `onClick={() => window.print()}`.
- `src/lib/financial-report-ui.ts` (+ `src/lib/financial-report-ui.test.ts`) — new pure, DB-free UI helper module: `buildRecentMonthOptions()` (generates a picker's month list backward from a boundary month) and `ensureMonthOption()` (guarantees the currently-viewed month is selectable even on a direct-URL hit outside the generated window). Kept separate from `financial-report-queries.ts` deliberately — no new DB query, so it doesn't belong in the api-developer-owned query-layer file.
- `src/app/members/page.tsx` — added a "Financial Statements" nav card to the existing 8-card grid, matching the 7 sibling cards' exact classes (`rounded-xl`, not the CLAUDE.md-mandated `rounded-2xl`) — a deliberate visual-consistency call for a single new card slotting into an already-`rounded-xl` grid, not a new violation of the convention elsewhere.
- `CLAUDE.md` — added the `financial-reports/` line to Project Structure's members bullet list and a new Key Features bullet under Member Portal.
- Verified `pnpm exec tsc --noEmit` passes, `unset DATABASE_URL DB_URL && pnpm test` passes (607 = 602 prior + 5 new, hermetic), and `pnpm build:only` passes with both new routes appearing in the route manifest (`/members/financial-reports`, `/members/financial-reports/[entitySlug]/[month]`).
- Confirmed `pnpm lint` still fails identically to the pre-existing, already-flagged ESLint 9 / `minimatch` ESM-CJS interop error (unrelated to this work, same issue api-developer flagged at the query-layer handoff).

### Implementer Notes

**The three render states, exactly per Phase 3's discriminated union:**
1. `null` (invalid entity slug, garbage month format, or a resolved fund whose `kind` isn't member-exposed) → `notFound()`. Never leaks that Activity/Scholarship funds exist — a guessed non-exposed fund slug is unreachable via this route today anyway (DECISION-050 item 2: no fund route segment), so this branch is defense-in-depth.
2. `{status: 'gated'}` → a plain, non-error-styled `bg-gray-50 rounded-2xl` panel: "This month's statement isn't ready yet — the treasurer is still reconciling it. Check back soon." Deliberately NOT a 404 and NOT rendered inside any error-red styling — this is an expected, ordinary state, not a failure.
3. `{status: 'ready', statement}` → the full `MonthlyStatementTable`, unconditionally, even when every line is zero. There is no `if (transactions.length === 0)` branch anywhere in this code path — the union type itself makes "reconciled-but-quiet-month" structurally impossible to confuse with "not reconciled yet."

**The Twelve-Month column's "Beginning fund balance" is derived, not passed through.** `MonthlyStatement` only carries one `beginningBookBalanceCents` (the report month's own start — correct for the One-Month column) and one canonical `endingBookBalanceCents` (same value in both columns, per the locked Q2 answer) — there is no separate FY-start balance field. I derived the Twelve-Month column's beginning balance via the accounting identity `endingBookBalanceCents - net.twelveMonthCents`, and verified it byte-for-byte against both reference PDFs' real numbers before trusting it:
- Administrative: `16,547.84 − (−3,613.81) = 20,161.65` — matches the reference exactly.
- Charitable: `6,036.57 − (−13,963.71) = 20,000.28` — matches the reference exactly.
This identity holds exactly for the Twelve-Month column specifically because `getFundReport()`'s FYTD net is posted/book basis throughout (no cash-basis mixing) — unlike the One-Month column, which mixes cash-basis actuals with the book balance and can genuinely diverge (`bookVsCashDivergenceCents`), so the One-Month column instead uses the real `beginningBookBalanceCents` field rather than back-deriving it. This is a load-bearing UI-side computation of real financial data worth a second pair of eyes — flagged here explicitly for qa/analyst rather than buried in a code comment alone (it IS also documented at length in the component's own header comment).
- **Annual-Budget-column Beginning/Ending Fund Balance cells render "—"** (DECISION-050 item 3) — there is no field for them anywhere in `MonthlyStatement`, so nothing is derived; the "—" is hardcoded in `BalanceRow`, not a fallback for a null value.

**Uncashed-check marker treatment:** a small badge (`bg-lions-gold/25 text-lions-blue-dark`, text "check outstanding") next to the category name, plus one footer legend line, instead of the reference PDFs' full-row yellow highlight — a jarring full-row yellow read as an error/warning color in this app's palette (yellow isn't used anywhere else in the UI for anything but a caution state), whereas a small gold-tinted badge matches the brand accent and reads as "note," not "alarm." `aria-label` on the badge spells out the meaning for screen readers beyond the two-word visible text.

**Money formatting:** reused the app's own established convention (the admin fund-report page's `formatDollars`: "$" prefix, "-" sign for negatives, always 2 decimals) rather than the reference PDFs' spreadsheet-export styling (no "$", parens for negatives, "-" placeholder for exact zero) — CLAUDE.md's Invariants section is explicit about reusing the existing formatter, and consistency with the admin fund-report page (which a treasurer may open side-by-side) mattered more than pixel-matching a legacy spreadsheet export. I added `toLocaleString` thousands separators on top of the copied convention (the admin version's plain `toFixed(2)` never comma-formats, which reads badly on this statement's regularly five-figure FYTD numbers) — a strict readability fix, not a new divergent convention. **Flagged for the treasurer's/analyst's sign-off** alongside the divergence-footnote wording per Phase 3's own note, since "$X,XXX.XX with a minus sign" vs. the reference's "X,XXX.XX with parens" is a legitimate open bikeshed, not a technical constraint.

**Print CSS:** every piece of chrome (hero banner, back link, `FinancialReportPicker`, `PrintStatementButton`) carries `print:hidden` — the picker hides it internally (one place, guaranteed correct regardless of which page renders it) rather than requiring each call site to remember the wrapper, following the `/admin/ledger/guide` precedent's spirit but centralizing it. `MonthlyStatementTable`'s outer card adds `print:shadow-none print:rounded-none print:border print:border-gray-300` so the printed page shows a clean bordered statement instead of a floating card shadow, and the table's `overflow-x-auto` wrapper adds `print:overflow-visible` so the 4-column table (Category, One Month, Twelve Months, Annual Budget) never clips in the print/Save-as-PDF output — verified only visually via the code path, not with a live print preview (that's part of qa's manual click-through list below).

**360px mobile:** the table lives inside `overflow-x-auto` per UX Guidelines (a 4-column money table is still wide relative to a 360px viewport even though it's narrower than the 5-column admin report) — the page body itself never scrolls horizontally; only the table's own container does.

**Picker month-list bound (`RECENT_MONTHS_WINDOW = 24`):** the query layer's gate is monotonic — if no unreconciled posted transaction exists on/before month-end X, none exists on/before any earlier month-end either — so every month at or before `latestOpenMonth` is guaranteed to render `'ready'`. There is, however, no query for "the earliest month this fund ever had activity," so the picker can't know exactly how far back to offer without an unbounded scan. I bounded it at 24 trailing months (2 fiscal years) — comfortably past this club's entire digitized history (the 2026-07-20 Quicken import seeded roughly one FY) — as a pragmatic, documented UI-only choice, not a new query-layer concern. `ensureMonthOption()` guarantees the currently-viewed month is always selectable even when a direct-URL hit falls outside this window (e.g. a future month reached via a stale bookmark).

**A latent query-layer note, not fixed here (out of my scope):** `getLatestOpenMonthForEntity()`'s doc comment says it returns `null` "if none has ever cleared," but its actual implementation only ever inspects *unreconciled* rows — a fund with literally zero transactions ever has zero unreconciled rows, so the function returns the prior-calendar-month ceiling, never `null`. In practice this is harmless for the "nothing ever reconciled" empty state (a fund with zero transactions gates open only vacuously, and `getMonthlyStatement()` would correctly render a real, if all-zero, statement for it — which is itself a legitimate state per Phase 1, not a bug) — but it means the landing page's empty-state branch (`latestOpen === null`) is reachable only in a scenario this function's current code can't actually produce. Flagging for whoever next touches `financial-report-queries.ts` rather than silently patching the query-layer file myself.

### Open questions / handoff notes

- **Next agent: qa.** Manual click-through list:
  1. As a linked member, visit `/members` → click "Financial Statements" → land on the picker with both entity cards, each showing its most recent available month.
  2. Click a card's "View [Month] Statement" link → confirm the full three-column table renders with REVENUE → Total Revenue → EXPENSES → Total Expenses → Net income (loss) → Beginning/Ending fund balance, footer disclosure sentence always present, plus any conditional footnotes.
  3. Use the "Or view an earlier month" picker to switch both entity and month; confirm the URL and rendered statement update together.
  4. Direct-URL a month you know is unreconciled/future (e.g. next calendar month) → confirm the "still reconciling this month" copy, NOT a 404 and NOT partial numbers.
  5. Direct-URL a nonsense entity slug (e.g. `/members/financial-reports/activity/2026-06`) or a malformed month (`/members/financial-reports/club/2026-13`) → confirm a clean 404, no leak of fund names that don't exist on this route.
  6. If a reconciled-but-zero-activity month exists (or can be constructed), confirm it renders the full zero-filled table, not an empty state.
  7. Click "Print / Save as PDF" and check the browser print preview — only the statement (title, table, footer) should show; hero/nav/picker/print-button must all be hidden, and all 4 columns must be visible (no clipping).
  8. Resize to 360px width — confirm the table scrolls within its own container and the page body never scrolls horizontally.
  9. As a signed-in user with no linked member record, confirm the "Account Not Linked" inline state (not a redirect) on both the landing and detail pages.
- **Copy needing the treasurer's (Chris's) sign-off**, per Phase 3's own flag (still open, not resolved by either implementer): the exact divergence-footnote wording, and now also the money-formatting convention (this implementer chose to reuse the app's "$"+minus-sign+comma style over the reference PDFs' parens/no-$/dash-for-zero style — a legitimate, reversible UI choice, not load-bearing).
- **Query-layer note for a future pass** (not blocking, not in my scope): `getLatestOpenMonthForEntity()`'s doc comment ("or null if none has ever cleared") doesn't match its current implementation (see Implementer Notes above) — harmless today, worth a look next time that file is touched.
- **UI decision, not binding:** "entity tabs" from the Phase 3 wording became two link-cards (landing page) plus a `<select>`-based picker (both pages), rather than literal tab controls — functionally equivalent for exactly two entities, flagged since naming/exact UI was explicitly left to the implementer's judgment (architect's Phase 2 verdict).

---

# Phase 5 — Verification (qa)

**Owner:** qa
**Status:** blocked (loop-back to Phase 4) — **fix applied 2026-07-28, see "Phase 4 — Implementation (Query Layer)" fix note above; re-verification pending, verdict below is pre-fix**
**Date:** 2026-07-28
**Verified by:** qa

## Summary

Two real defects found by driving the deployed app (not just reading code): (1) the reconciliation gate has no concept of "this month hasn't happened yet" — a direct URL to the current or a future month renders the full `{status:'ready'}` statement, book balance and all, whenever the fund has zero unreconciled rows sitting against it, which is exactly the state a well-run set of books is in; and (2) `/members/financial-reports/club/2026-13` (an out-of-range but shape-valid month) 500s with a raw Postgres date-parse error instead of 404ing. Both are reproduced against the real dev server and pinned with new failing unit tests (left in the suite, failing, per regression discipline) rather than fixed here. Everything else checked out: typecheck, build, hermeticity, the exposure-projection boundary, the fund allowlist, the `asOfDate` backward-compat proof, the Quicken-import exclusion, and the derived Twelve-Month beginning-balance arithmetic are all correct and well-tested.

## Type Check

`pnpm exec tsc --noEmit`: **PASS** (clean, no output)

## Unit Tests (Hermetic)

`unset DATABASE_URL DB_URL && pnpm test`: **FAIL** (by design — see Regression Tests below)
Total: 611 | Passed: 608 | Failed: 3
Duration: ~0.8s
Hermeticity confirmed: full suite runs and fails/passes identically with `DATABASE_URL`/`DB_URL` unset — no real DB connection is made. Prior to my additions the suite was 607/607 green (602 pre-existing + 5 UI-layer, matching both implementers' handoff claims exactly).

Failures (all 3 are new regression tests I added, reproducing bugs found in manual driving — see below, not flaky/pre-existing failures):
- `isMonthGatedForEntity > gates the CURRENT calendar month even with zero unreconciled rows anywhere` — `src/lib/financial-report-queries.test.ts:201`
- `isMonthGatedForEntity > gates a FUTURE month even with zero unreconciled rows anywhere` — `src/lib/financial-report-queries.test.ts:212`
- `monthBounds > rejects an out-of-range month number instead of returning NaN-poisoned strings` — `src/lib/financial-report-queries.test.ts:142`

## Production Build

`pnpm build:only`: **PASS** — exit 0, no warnings/errors. Both new routes confirmed in the manifest: `/members/financial-reports` and `/members/financial-reports/[entitySlug]/[month]` (both `ƒ` dynamic, as expected for `auth()`-gated Server Components).

## Dev-Server Smoke Test

`pnpm dev` against `.env.local`: **FAIL** (one of the two bugs above surfaces here directly — see Finding 2)

- `.env.local`'s `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` account is **not member-linked** (`users.member_id IS NULL`), so it cannot pass the `memberId` gate on its own. Signed in via the NextAuth credentials callback (curl, CSRF-token flow) and confirmed both routes render the "Account Not Linked" inline state (not a redirect, matching `/members/impact`'s pattern) with HTTP 200 and no server-side error for a range of entity/month combinations — this alone satisfies "reach the routes without runtime error" for the unlinked case.
- To verify the actual `gated`/`ready`/`notFound` states live rather than only at the unit-test layer, I temporarily set `users.member_id` on the e2e test account to an existing active member's id (`55d967c9-b4c0-4594-9b27-a8220c12da46`, no unique constraint on that column, verified before changing it), re-authenticated so the JWT picked up the new `memberId`, drove the flows below, then **reverted `member_id` back to `NULL`** on the same row immediately after — confirmed via a follow-up `SELECT`. No new rows were created or left behind; only a two-way flip of one existing column on the seeded e2e test account.
- The DB has real, useful asymmetry for this: the Club/Administrative fund has zero unreconciled posted transactions (fully open) and no transactions at all since 2026-06-10; the Foundation/Charitable fund has one unreconciled posted transaction dated 2026-03-07 (blocking every month from March 2026 onward).

## Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| Unlinked user reaches landing + detail page | pass | "Account Not Linked" inline state, HTTP 200, no redirect, matches `/members/impact` precedent |
| Landing page renders both entity cards | pass | Confirmed HTML (RSC payload) contains both entities' card markup and the picker |
| Club/Administrative, 2026-06 (expect `ready`, real reconciled data) | pass | Full table rendered: title, "One Month Ended 6/30/26" / "Twelve Months Ended 6/30/26" / "Annual Budget" headers, Total Revenue/Expenses, Net income, Beginning/Ending fund balance |
| Foundation/Charitable, 2026-06 (expect `gated` — March's unreconciled txn blocks it) | pass | "Statement Not Ready Yet... still reconciling" panel rendered, no table, no numbers |
| Foundation/Charitable, 2026-02 (expect `ready` — before the blocking transaction's month) | pass | Full table rendered, confirming the gate is genuinely per-month, not "anything ever unreconciled blocks everything forever" |
| Direct URL, garbage entity slug (`/financial-reports/activity/2026-06`) | pass | Clean 404 — no entity named "activity" exists, so this doesn't independently prove the fund-allowlist defense-in-depth, but confirms `getEntity()` 404s cleanly |
| **Direct URL, current calendar month** (`/financial-reports/club/2026-07`, today is 2026-07-28, month not over) | **FAIL** | Renders `{status:'ready'}` with a real (if zero-activity) table instead of the `gated` "still reconciling" copy — see Finding 1 |
| **Direct URL, far-future month** (`/financial-reports/club/2027-01`) | **FAIL** | Same as above — renders `ready`, not `gated` — see Finding 1 |
| **Direct URL, out-of-range month** (`/financial-reports/club/2026-13`) | **FAIL** | HTTP 500, uncaught Postgres error, stack trace in server logs — see Finding 2 |
| Reconciled-but-zero-activity month vs. never-reconciled month, structurally distinct | pass (via code + unit tests) | Confirmed the discriminated union — `{status:'gated'}` vs. `{status:'ready', statement}` with all-zero lines — never collapses; visually exercised via the Foundation Feb-2026 (real data) and implicitly via Club's post-June zero-activity months (see Finding 1 for why those specific cases are actually a *different* problem) |
| Print/Save-as-PDF, 360px scroll, picker's live immediate-navigate click | **not reachable in this harness** | No browser available to this agent — code inspection confirms `print:hidden` wrapping, `print:overflow-visible` on the table wrapper, and `overflow-x-auto` on the table container, but the actual print-preview layout and a real click-driven `<select>` navigation were not visually observed. **Needs the user's manual pass before Phase 6.** |

## Verify the Substance

- **Exposure boundary:** **PASS.** Read `financial-report-queries.ts` end to end — `MonthlyStatementCategoryLine` is built field-by-field in `buildLines()`, never a rest/spread of a raw row; `computeOneMonthCashActuals()` only ever writes summed `amountCents` into a `Map<string, number>`. The exposure-projection unit test (`financial-report-queries.test.ts:377-458`) constructs canned rows carrying decoy `party`/`memo`/`checkNumber`/`id`/`donorId`/`publicNote` fields on both the transaction and category rows and asserts via `Object.keys()` that none survive — a genuine regression guard, not just a type claim. The fund allowlist (`MEMBER_EXPOSED_FUND_KINDS`) is checked against `fund.kind` — the resolved DB row — as the very first line of `getMonthlyStatement()`, before any DB call; confirmed both by unit test (`kind: 'activity'`/`'scholarship'` → `null`, never `{status:'gated'}`) and structurally by the page's route shape (no fund segment exists — Activity/Scholarship can't be reached by URL-guessing on this route at all, so the allowlist is defense-in-depth, exactly as designed).
- **Three render states distinct:** **PARTIAL PASS.** `null → notFound()`, `{status:'gated'} → "still reconciling"` panel, and `{status:'ready'} → full table (including all-zero)` are structurally distinct in the code and each renders correctly for the cases the *design* anticipated (confirmed live: Foundation Feb-2026 real ready data, Foundation June-2026 gated). The gap is that a fourth, unanticipated case exists — a current/future month with zero transactions recorded — and it silently falls into `ready` instead of `gated` (Finding 1).
- **Gate is server-side on every request:** **FAIL.** The gate (`isMonthGatedForEntity`) is genuinely re-evaluated on every call, never trusted from the picker's list — confirmed by code and by hitting gated/ready URLs directly. But the gate's *predicate* is incomplete: it only asks "does an unreconciled posted transaction exist on/before month-end," never "has month-end actually happened yet." A fund with no outstanding unreconciled backlog (the Administrative fund, right now, in this DB) has **nothing** to gate a future month on, so `/financial-reports/club/2027-01` — a month that has not occurred — renders a full, real statement. This is precisely the failure case Phase 1's Flow 2 and Phase 3's design named ("a direct URL to an unreconciled/future month must render the gated state, not leak numbers") and it does not hold for this input. See Finding 1 below.
- **Date correctness:** **PASS on everything named except the month-validation gap (Finding 2).** The `asOfDate` bounding test in `ledger-queries.test.ts:987-1037` inspects the actual Drizzle-generated SQL parameters via `PgDialect().sqlToQuery()` — not just downstream arithmetic — and proves inclusive-of-asOfDate / exclusive-after / byte-identical-when-omitted, all three. The FY-boundary tests (`financial-report-queries.test.ts:148-158`) correctly compose `getFiscalYear()` for June (closing FY) vs. July (fresh FY). The `reconciledAt` UTC-getter handling is correct and pinned with an 11:30 PM boundary test. Separately, `monthBounds()` has no validation on the month-number range (Finding 2) — this is a date-correctness bug, just not one of the ones explicitly named to check, caught only by exercising a malformed URL.
- **Quicken-import One-Month exclusion:** **PASS.** `computeOneMonthCashActuals()` checks `memo.endsWith("[quicken-import]")` before falling back to `reconciledAt`, excludes marker-tagged unmatched rows entirely (never uses the 2026-07-20 bulk-import timestamp as a clear date), and sets `hasUndatedHistoricalRows`. Test at `financial-report-queries.test.ts:195-244` exercises all three tiers (matched, legacy-fallback, excluded) plus the adjacent-month exclusion in one scenario.
- **`getFundReport(asOfDate)` backward-compat:** **PASS, and rigorously proven.** `ledger-queries.test.ts:1006-1013` decodes the actual generated WHERE-clause parameters when `opts` is omitted and asserts they're byte-identical to the FY-end bound — this is the strongest test in the suite and the right one to trust for "every existing admin caller is unaffected."
- **Fund exposure / not-found boundary for non-exposed funds:** **PASS.** Confirmed structurally: the `[entitySlug]/[month]` route has no fund segment at all — it resolves the entity's single member-exposed fund internally and 404s if none exists — so Activity/Scholarship funds are categorically unreachable via this route, and the allowlist check inside `getMonthlyStatement()` is verified defense-in-depth on top of that.

## Two Flagged Items From the Implementers

- **Derived Twelve-Month beginning balance (`endingBookBalanceCents - net.twelveMonthCents`):** **Sound, confirmed exactly.** Traced the identity through `getFundReport()`'s own arithmetic (`ledger-queries.ts:664-666`): `totalIncomeCents`/`totalExpenseCents` are sums of every category's `actualCents`, and `endingCents = rolledForwardOpening + totalIncomeCents - totalExpenseCents`. Since `MonthlyStatement.net.twelveMonthCents` is built from the same per-category `actualCents` values (via `buildLines()`), the identity `endingBookBalanceCents - net.twelveMonthCents` reduces exactly to `rolledForwardOpening` — the FY-start book balance, which is precisely what the "Twelve Months Ended" column's beginning balance should show. This holds exactly (not approximately) because the FYTD net is posted/book-basis throughout, with no cash-basis mixing — unlike the One-Month column, which correctly uses the real `beginningBookBalanceCents` field instead of a derived value, since it *can* diverge. Not misleading; not a bug.
- **`getLatestOpenMonthForEntity()`'s doc/impl mismatch ("or null if none has ever cleared"):** **Real mismatch, confirmed by reading — low severity on its own, but adjacent to Finding 1.** The function's return type is `Promise<string | null>` but the implementation has no code path that returns `null` — it always returns either `ceilingMonth` (last calendar month, when `blockingDates` is empty) or `priorMonthKey(blockingMonth)`, both strings. Consequence: the landing page's "nothing ever reconciled" empty state (`anyAvailable === false`, gated on `latestOpen === null`) is dead code for any entity whose exposed fund exists — a brand-new fund with zero transactions ever gets offered a full 24-month picker window, each month resolving to a real (all-zero) `ready` statement rather than the "statements will appear here once reconciled" empty-state copy. On its own this doesn't leak anything wrong (the numbers would be genuinely zero/accurate), but it's the same root cause as Finding 1: nothing in this feature's gate has a concept of "this month/this fund's whole timeline hasn't started yet," only "is there an outstanding unreconciled item." Recommend fixing this alongside Finding 1, not as a separate patch — the correct fix for both is very likely the same date-awareness addition to the gate.

## Regression Tests Added

All in `src/lib/financial-report-queries.test.ts`, currently **failing** against the shipped code (left failing, per regression discipline — not fixed by qa):

- `isMonthGatedForEntity > gates the CURRENT calendar month even with zero unreconciled rows anywhere` — `src/lib/financial-report-queries.test.ts:196-205` — guards against: a member viewing the club's current, still-in-progress month's "reconciled" balance before the month has even ended, whenever the fund has no unrelated unreconciled backlog to accidentally gate on.
- `isMonthGatedForEntity > gates a FUTURE month even with zero unreconciled rows anywhere` — `src/lib/financial-report-queries.test.ts:207-215` — guards against: the same leak for an arbitrarily-far future month (reproduced live against `2027-01`).
- `monthBounds > rejects an out-of-range month number instead of returning NaN-poisoned strings` — `src/lib/financial-report-queries.test.ts:141-145` — guards against: the exact reproduction of the live `/members/financial-reports/club/2026-13` 500 (`MONTH_PATTERN`'s `/^\d{4}-\d{2}$/` accepts "13" as a shape match; `monthBounds()` then silently produces `NaN`/`undefined`-poisoned date strings that reach a raw SQL parameter and crash with an uncaught Postgres `invalid input syntax for type date` error instead of a clean 404).

## Coverage on Critical Modules

Not separately re-run with `--coverage` this pass — the exact-8-named-tests-plus-exposure/allowlist/gate coverage in `financial-report-queries.test.ts` and the 4 `asOfDate` tests in `ledger-queries.test.ts` are read line-by-line above and are substantively adequate for every code path *except* the two gaps found (which is exactly why they weren't caught by the existing suite — no test exercised "future month, zero rows" or "out-of-range month number" until this pass).

## Feature-Gate Audit (mandatory before PASS)

No protected admin routes or server actions were added or changed by this feature — it is read-only and view-side only. `hasFeature()`/`FEATURES.*` do not apply per the locked Phase 1/2/3 decision (view = `session.user.memberId` non-null, no new `FEATURES` key). Confirmed both new pages check `auth()` + inline `memberId` gate and nothing else gates viewing, matching the design exactly.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `GET /members/financial-reports` | yes | no (by design) | n/a — memberId gate only |
| `GET /members/financial-reports/[entitySlug]/[month]` | yes | no (by design) | n/a — memberId gate only |

No write-side routes/actions exist in this feature (auto-publish, no admin action). Write-side gating (`ledger.record` on reconciliation-session close) is unchanged and out of scope for this feature's diff.

## Cleanup

- Reverted `users.member_id` back to `NULL` for the e2e test account (`lions-e2e-test@westervillelions.org`) immediately after the manual click-through — confirmed via follow-up query. No rows created or left behind.
- Stopped the `pnpm dev` background process (confirmed no listener on :3000 afterward).
- Removed all scratch response files (`/tmp/*.html`, cookie jar, build log).
- Left the 3 new regression tests in `financial-report-queries.test.ts` in their **failing** state, as required by regression discipline — do not mark this suite green by deleting or skipping them.

## Verdict

**FAIL**

Two real defects, both found by driving the actual app against real seeded data, not just reading code or unit tests:

1. **(Must-fix, primary) The reconciliation gate has no "this month hasn't happened yet" check.** `isMonthGatedForEntity()`/`getMonthlyStatement()` gate purely on the *existence* of an unreconciled posted transaction on/before month-end. A fund with zero outstanding unreconciled backlog — i.e., a well-run set of books, which is the Administrative fund's actual current state in this DB — has nothing to gate a future or still-in-progress month on, so `/members/financial-reports/club/2027-01` (a month 6 months from now) renders a complete, real `{status:'ready'}` statement instead of the required "still reconciling" copy. This is the exact scenario Phase 1's Flow 2 and Phase 3's design both named as a must-not-leak case, and it fails for it. Fix belongs in `financial-report-queries.ts` (api-developer) — likely adding a "monthEnd must not be on/after the current calendar month" check to the gate, consistent with `getLatestOpenMonthForEntity()`'s already-correct "never offer the current month" rule (which currently only protects the *picker*, not the actual per-request gate).
2. **(Must-fix) `monthBounds()`/the route's month-format validation accepts out-of-range month numbers.** `MONTH_PATTERN = /^\d{4}-\d{2}$/` matches "13" as a valid two-digit group without checking it's 01-12. `monthBounds("2026-13")` then produces NaN/undefined-poisoned date strings that reach a raw Drizzle-generated SQL parameter, crashing with an uncaught Postgres `invalid input syntax for type date` 500 — reproduced live, full stack trace captured in the smoke-test log. Must resolve to a clean `notFound()`, not a 500. Fix likely belongs in both the page's `MONTH_PATTERN` (ux-developer, e.g. `/^\d{4}-(0[1-9]|1[0-2])$/`) and/or `monthBounds()` itself validating and being made to fail safely (api-developer) — recommend the query-layer fix regardless, since `monthBounds()` is exported and a second future caller shouldn't have to remember to pre-validate.

Everything else checked — typecheck, build, hermetic tests, the exposure-projection boundary, the fund allowlist, the `asOfDate` backward-compat proof, the Quicken-import exclusion, FY-boundary framing, and the derived Twelve-Month beginning-balance arithmetic — is correct, well-tested, and matches the Phase 3 design faithfully. This is not a design flaw (Phase 3's discriminated-union architecture is sound) but an incomplete predicate inside the query layer Phase 4 shipped, plus a missing input-range check — both squarely Phase 4 implementation gaps. No loop-back to Phase 2 or Phase 3 needed.

## Open Questions / Handoff Notes

- **Next agent: api-developer** (primary — owns `financial-report-queries.ts`), with a small **ux-developer** follow-up on `MONTH_PATTERN` in `src/app/members/financial-reports/[entitySlug]/[month]/page.tsx`.
- Two failing regression tests in `isMonthGatedForEntity`'s `describe` block (`financial-report-queries.test.ts:196-215`) pin Finding 1 — the fix should make both pass without touching their assertions. Consider whether the fix belongs in `isMonthGatedForEntity()` itself (gate whenever `monthEnd` is on/after the current calendar month, regardless of row data) or in `getMonthlyStatement()` as an earlier short-circuit — either satisfies the tests as written.
- One failing regression test (`financial-report-queries.test.ts:141-145`) pins Finding 2 — recommend `monthBounds()` throw or `getMonthlyStatement()`/the page validate the month is `01`-`12` before any DB call, so a malformed URL resolves to `notFound()` rather than a raw SQL error. Tighten `MONTH_PATTERN` too (defense in depth, cheap).
- Also still open from Phase 4 (unresolved by either implementer, not blocking this FAIL on their own, but should not ship silently): the exact divergence-footnote wording and the money-formatting convention ("$"+minus+comma vs. the reference PDFs' parens style) both still need the treasurer's (Chris's) sign-off before Phase 6, per both implementers' own flags.
- The `getLatestOpenMonthForEntity()` doc/impl mismatch (never actually returns `null`) is low-severity on its own but shares Finding 1's root cause — recommend fixing it in the same pass rather than as a separate follow-up.
- Once Finding 1 and Finding 2 are fixed and the 3 regression tests (plus the full suite) are green, re-run Phase 5 before advancing to Phase 6 — do not send this straight to analyst off the current diff.

---

## Phase 5 — Re-Verification (qa) — 2026-07-28

**Owner:** qa
**Status:** complete

### Summary

api-developer's fix to `src/lib/financial-report-queries.ts` (a new `hasMonthElapsed()` short-circuit inside `isMonthGatedForEntity()`, plus a validating `monthBounds()` that `getMonthlyStatement()` now try/catches into a clean `null`) resolves both Findings from the first pass. Re-ran all four gates from scratch and re-drove both live reproductions against the real dev server and the same seeded DB rows that exposed the bugs originally (Administrative fund still has zero unreconciled backlog — the exact condition that broke it before). Both reproductions now behave correctly, no regressions found in the previously-passing checks. **Verdict: PASS.**

### Gate Re-Run

1. `pnpm exec tsc --noEmit` — **PASS** (clean, no output).
2. `pnpm test` (hermetic, `DATABASE_URL`/`DB_URL` unset) — **PASS.** 611/611, including the 3 regression tests I pinned last pass (`financial-report-queries.test.ts:141-145`, `:196-205`, `:207-215`) — all 3 now pass unmodified, exactly as reported.
3. `pnpm build:only` — **PASS.** Exit 0, no warnings. Both routes confirmed still in the manifest (`/members/financial-reports`, `/members/financial-reports/[entitySlug]/[month]`).
4. Dev-server smoke — **PASS.** Same procedure as the first pass: `.env.local`'s e2e admin account is still not member-linked (confirmed `member_id IS NULL` before starting, matching my Phase 5 cleanup); temporarily re-linked it to the same member (`55d967c9-b4c0-4594-9b27-a8220c12da46`), re-authenticated so the JWT picked up `memberId`, drove every check below, then reverted `member_id` back to `NULL` and confirmed via a follow-up query. No rows created or left behind.

### The Two Reproductions, Re-Driven Live

- **`/members/financial-reports/club/2027-01` (far-future month, Administrative fund — zero unreconciled backlog, the exact condition that broke it):** now renders **"Statement Not Ready Yet... still reconciling"** — the gated state. HTTP 200, no table, no numbers. **Fixed, confirmed live.**
- **`/members/financial-reports/club/2026-07` (current, still-in-progress calendar month — today is 2026-07-28):** also now renders the **gated** state, not a real statement. This is the sharper of the two checks, since it's the case where a naive "is monthEnd in the past" off-by-one would still fail — confirmed `hasMonthElapsed()`'s `monthEnd < currentMonthStart` bound correctly treats the current month as not-yet-elapsed.
- **`/members/financial-reports/club/2026-13` (out-of-range month):** now returns a clean **HTTP 404** (`This page could not be found`, confirmed via response headers, not just body text) — no stack trace, no 500. Confirmed against the dev server log: previously this request logged a full Postgres `invalid input syntax for type date` exception and a `500` status line; this run logs `GET .../2026-13 404 in 236ms` with nothing in the error stream. **Fixed, confirmed live.**

### Regression Spot-Checks (did the fix over-gate anything?)

| Check | Result |
|---|---|
| Club/Administrative, 2026-06 (real reconciled past month, no backlog) | **still renders `ready`** — full table, Total Revenue/Expenses/Net/Beginning-Ending balance all present. Fix did not over-gate a genuinely-open past month. |
| Foundation/Charitable, 2026-06 (real unreconciled txn dated 2026-03-07 still blocks it) | **still renders `gated`** — the backlog-based half of the predicate is untouched and still fires correctly. |
| Foundation/Charitable, 2026-02 (before the blocking transaction's month) | **still renders `ready`** with real data — confirms the gate is still genuinely per-month, not "anything ever unreconciled blocks everything forever." |

### No Regression to Previously-Verified Substance

Re-confirmed via the full hermetic test run (611/611) that the exposure-projection test, the fund-allowlist test, the `asOfDate` byte-level backward-compat test (`ledger-queries.test.ts:1006-1013`), the Quicken-import-exclusion tests, and the FY-boundary tests are unchanged and still passing — `hasMonthElapsed()` and the `monthBounds()` validation are additive; nothing else in `financial-report-queries.ts` or `ledger-queries.ts` was touched. The `getLatestOpenMonthForEntity()` doc/impl mismatch I flagged is also resolved: it now re-validates its candidate month against `isMonthGatedForEntity()` (which carries the `hasMonthElapsed()` fix) before returning, so `null` is reachable again — read the new code directly to confirm this, not inferred from tests alone.

### Cleanup (this pass)

- Reverted `users.member_id` back to `NULL` for the e2e test account a second time — confirmed via follow-up query.
- Stopped the `pnpm dev` background process (confirmed no listener on :3000 afterward).
- Removed all scratch response/header files and the second cookie jar.

### Verdict

**PASS.** Both must-fix findings from the first Phase 5 pass are resolved and confirmed live against the real dev server and the same DB rows that originally exposed them, with no regressions to anything previously verified. Phase 6 (analyst) may open.

### Open Questions / Handoff Notes

- **Next agent: analyst**, for Phase 6 (shipped-vs-intent).
- Still open, not blocking PASS, carried forward from the implementers' own flags: the exact divergence-footnote wording and the money-formatting convention ("$"+minus+comma vs. the reference PDFs' parens style) still need the treasurer's (Chris's) sign-off — worth Phase 6 explicitly noting this as a follow-up rather than silently shipping unreviewed copy.
- Client-only flows still not reachable in this harness (unchanged from the first pass): print/PDF preview appearance, 360px live table-scroll behavior, and a real click-driven picker navigation. Code inspection (`print:hidden`, `print:overflow-visible`, `overflow-x-auto`) supports that these work, but no browser was available to this agent to visually confirm. Recommend the user's own manual pass before or shortly after Phase 6 closes.

---

# Phase 6 — Shipped vs Intent (analyst)

**Owner:** analyst
**Status:** complete
**Date:** 2026-07-28

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> Every locked decision from Phase 1 (Q2/Q4/Q5) landed exactly as specified, the qa-found gate leak is fixed and reverified live against real data, and the PII/fund-exposure boundary is enforced and tested rigorously — what's left is copy sign-off and a manual visual pass on client-only surfaces neither qa nor I could exercise in-harness, neither of which is a reason to hold a read-only, no-new-dependency, no-schema-change feature off a member portal that already has a real, well-run reconciliation gate to publish against.

## What's Working

- **The book-vs-cash design decision is validated by real production data, not just by argument.** This session's separate read-only forensic reconciliation of production against the treasurer's source Quicken registers and bank statements found the club's books are essentially correct, and that the apparent discrepancy against the previous treasurer's reference PDF is precisely an outstanding-checks book-vs-cash timing difference — the exact class of divergence this feature's `bookVsCashDivergenceCents` field and footnote exist to surface, in the treasurer's own plain language rather than as an unexplained gap. Q2's locked call (one canonical book balance, footnote the divergence, no second cash-only ledger) is the right call, confirmed against real numbers rather than a hypothetical.
- **The gate is now genuinely leakproof against the case Phase 1 named as must-not-happen.** Phase 1's Flow 2 explicitly named "member types or is linked to a not-yet-reconciled month" as the scenario that must never render real numbers. qa's first pass found a real hole (a fund with zero unreconciled backlog — which is the Administrative fund's actual current state — had nothing to gate a future/current month on), and the re-verification pass drove the fix live against the same seeded DB rows that broke it: `/members/financial-reports/club/2027-01` and `/members/financial-reports/club/2026-07` (the current, still-open calendar month) both now render the gated "still reconciling" copy, while `2026-06` (a real reconciled past month on the same fund) still renders `ready`. That's the harder of the two directions to get right (an under-gate that leaks data is worse than an over-gate that hides it), and it's confirmed live, not just by unit test.
- **The exposure boundary is tested the way a PII boundary should be tested.** qa's decoy-field test constructs canned rows carrying `party`/`memo`/`checkNumber`/`id`/`donorId`/`publicNote` and asserts via `Object.keys()` that none survive into the returned `MonthlyStatementCategoryLine` — a regression guard against a future careless object-spread, not a type-level promise that a refactor could silently break. I read `buildLines()` in `src/lib/financial-report-queries.ts` directly and confirmed every field is assigned individually; there is no spread anywhere in the construction path.
- **The Activity/Scholarship funds are unreachable two different ways, not one.** The route itself carries no fund segment (a URL cannot name a fund at all, only an entity + month), and `getMonthlyStatement()`'s allowlist check runs against the resolved `fund.kind` DB row before any other logic. Guessing a non-exposed fund can't even be attempted today, and the allowlist stands as defense-in-depth if a second exposed-fund-kind is ever added later — exactly the belt-and-suspenders shape Phase 2 demanded.

## Intent-vs-Shipped Diff

- Phase 1 said: any linked member sees the report, no new `FEATURES` key, gated on `memberId` alone, following `/members/impact`'s precedent. Shipped: both pages check `session.user.memberId` inline with an "Account Not Linked" state (no redirect) and no `hasFeature()` call anywhere in the feature — confirmed by reading both page files. **Matches.**
- Phase 1 said: print-friendly page + browser Save-as-PDF, no new dependency. Shipped: `print-statement-button.tsx` calls `window.print()`; `print:hidden`/`print:overflow-visible`/`print:shadow-none` classes are applied throughout; `package.json`'s working tree has zero new dependencies for this feature. **Matches**, with one caveat — the actual print-preview layout (column clipping, chrome hidden) was verified by qa only via code inspection, not a live print dialog. See Edge Cases.
- Phase 1 said: auto-publish on reconciliation, no manual publish state. Shipped: no `published` column, no admin action, no new schema at all — the statement is computed live from the gate predicate on every request. **Matches.**
- Phase 1 said: category-level, per-entity, only the two historically-published funds; Activity/Scholarship never exposed, including not revealing they exist. Shipped: `MEMBER_EXPOSED_FUND_KINDS = ["administrative", "charitable"]` checked against the resolved DB row; the route has no fund segment; a direct hit resolving to a non-exposed fund returns `null` → `notFound()`, identical to any other 404 on this route (a garbage entity slug 404s the same way) — it does not distinguish "wrong slug" from "fund exists but isn't exposed." **Matches.**
- Phase 1 said (Q2, locked): book-balance beginning/ending with a divergence footnote when it occurs; `getFundReport()` extended, not forked. Shipped: `getFundReport(fundId, fiscalYear, opts?: { asOfDate? })` — additive optional param; the backward-compatibility claim is proven at the SQL-parameter level (`ledger-queries.test.ts:1006-1013` decodes the generated WHERE clause and asserts it's byte-identical to the pre-existing FY-end bound when `opts` is omitted), not just asserted from downstream arithmetic. The divergence footnote renders in plain, non-alarming language ("Book balance and one-month cash totals differ by $X this month — see the highlighted line(s) above..."). **Matches**, wording still pending the treasurer's sign-off (see Follow-Ups — this is a copy note, not a functional gap).
- Phase 1 said: reconciliation gate re-checked server-side on every request, three distinct states, a future/not-yet-elapsed month must gate. Shipped: `isMonthGatedForEntity()` is called fresh inside `getMonthlyStatement()` on every call (never trusted from a picker list); the discriminated union (`{status:'gated'}` / `{status:'ready', statement}`) is structural, not an `if (length === 0)` check; the qa-found leak (a low-backlog fund gating nothing on a future month) is fixed via `hasMonthElapsed()` and reverified live against the exact DB rows that broke it originally. **Matches** — this item shipped as a loop-back-and-fix within Phase 4/5, exactly as the pipeline is designed to handle, not a silent gap.
- Phase 1 said: import-stamped historical rows (Quicken bulk-import `reconciledAt`) must not corrupt the One-Month column; footnote when excluded. Shipped: `computeOneMonthCashActuals()` checks the `[quicken-import]` memo marker before falling back to `reconciledAt`, excludes marker-tagged unmatched rows entirely, sets `hasUndatedHistoricalRows`. This was flagged by tech-lead (DECISION-050) as a landmine Phase 1/2 hadn't fully named, and it was caught and designed around before Phase 4 shipped, not discovered in QA. **Matches, with the review process working as intended** — a real gap in the original request that got caught two phases upstream of where it would have silently corrupted every historical month.
- Phase 1 said: statement carries only aggregated fields, never party/memo/checkNumber/publicNote/donor identity/transaction IDs. Shipped: confirmed by direct code read of `buildLines()` and by qa's decoy-field regression test. **Matches.**

## Edge Cases

- **Empty state:** pass. Landing page: "Monthly statements will appear here once the treasurer reconciles a month" when no entity has ever cleared its gate — matches CLAUDE.md's Empty States pattern (`bg-gray-50 rounded-2xl p-10 text-center text-gray-500`) verbatim. Per-card empty state ("No statements published yet.") when one entity has data and the other doesn't.
- **Failure microcopy:** pass. The gated state ("This month's statement isn't ready yet — the treasurer is still reconciling it. Check back soon.") reads as an ordinary in-progress state, not an error — rendered in the same `bg-gray-50 rounded-2xl` panel as the empty state, not in error-red styling, exactly as Phase 3 specified. Garbage entity slugs and out-of-range months (`2026-13`) both resolve to a clean Next.js `notFound()` — confirmed live by qa (HTTP 404, no stack trace) after the Finding-2 fix, replacing what was a raw Postgres 500 in the first Phase 5 pass.
- **Permission gate:** pass. Both pages check `session.user.memberId` inline with no `hasFeature()` call, matching the locked Q5 "no knob" decision; qa's Feature-Gate Audit confirms no protected write path was touched (reconciliation-session close remains `ledger.record`, unchanged). Verified live with a real unlinked account (`memberId IS NULL`) rendering the "Account Not Linked" state at HTTP 200, and a real linked account rendering both `gated` and `ready` correctly depending on the fund/month.
- **Mobile (360px):** pass on code inspection, not independently confirmed by a live viewport resize. `overflow-x-auto` wraps the table (matching the UX Guidelines convention even though this is a 4-column table, narrower than the 5-column admin report); the page body itself has no horizontal-scroll surface. qa could not resize a live browser in its harness — this is one of the three items in the manual pass below.

## Follow-Ups (SHIP WITH NOTES)

1. **Treasurer copy sign-off — divergence-footnote wording and money-format convention.** Both implementers explicitly flagged this at handoff and it was never closed. Current shipped copy ("Book balance and one-month cash totals differ by $X this month — see the highlighted line(s) above for outstanding checks not yet cleared by the bank.") and money format (`$1,234.56` / `-$45.00`, matching the admin fund-report page) are sound defaults, not wrong, but were never explicitly reviewed by Chris the way Q2/Q4/Q5 were. File as a tracked backlog item — Chris reviews the exact footnote sentence and the `$`+minus+comma vs. the reference PDFs' parens-for-negative/no-`$` convention, and either signs off as-is or requests a copy tweak (cheap, UI-only, no query-layer change).
2. **`getLatestOpenMonthForEntity()`'s doc/impl mismatch, now resolved but worth a note for the next person to touch the file.** qa confirmed in the re-verification pass that this is fixed (the function now re-validates its candidate against the corrected gate, so `null` is reachable again) — no action needed, but flagging so a future editor doesn't reintroduce the same doc/impl drift without re-reading the current code.
3. **Manual browser click-through, before or shortly after this closes** — the specific things neither implementer's code-reading nor qa's harness could exercise:
   - Open `/members/financial-reports` signed in as a linked member, click through to a `ready` month, and open the browser's print dialog (Cmd/Ctrl+P) or "Save as PDF" — confirm the hero banner, back link, entity/month picker, and Print button are all hidden, and all 4 table columns (Category, One Month, Twelve Months, Annual Budget) are visible with no clipping.
   - Resize the browser (or use device emulation) to 360px width on the statement detail page — confirm the table scrolls within its own bordered container and the page body never scrolls horizontally.
   - Click through the entity/month `<select>` picker on both the landing page and a statement detail page — confirm each selection change navigates immediately (no separate "Go" button) to the correct `/members/financial-reports/[entitySlug]/[month]` URL and the page updates.

## Red Flags (if NEEDS REWORK)

None. No item above requires a return to Phase 3 or 4.
