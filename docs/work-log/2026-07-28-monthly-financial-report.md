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
| 4 — Implementation | api-developer (query layer) → ux-developer (routes/UI) | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

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
- **Annual-Budget-column Beginning/Ending Fund Balance rows have no data source and are cut from v1** (shown as "—"). I checked this against both reference PDFs' actual numbers: the Budget column's "Beginning fund balance" (e.g., Foundation: $29,569.30) does **not** equal the Twelve-Month column's beginning ($20,000.28) or any value `getFundReport()` can produce — it was a separate, hand-estimated figure the prior treasurer tracked outside this system. Building it would mean inventing a new persisted "budgeted beginning balance" input with no authoring UI in scope (the same category of problem Phase 1 already deferred for per-line notes). This is a reversible scope cut, not a technical wall — flagging for the user's sign-off alongside the footnote wording, not blocking Phase 4.
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
