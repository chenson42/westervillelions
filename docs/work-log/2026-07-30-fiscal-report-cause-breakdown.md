# Fiscal Report Cause/Line-Item Breakdown + Zero-Row Omission — Work Log

> **Slug:** `2026-07-30-fiscal-report-cause-breakdown`
> **Surface:** `(dashboard)` member portal (`/members/financial-reports`) — primary; `(dashboard)` admin (`/admin/ledger/[fundSlug]/report`) — candidate secondary, needs confirmation. Query layer: `src/lib/financial-report-queries.ts`, composing `src/lib/ledger-queries.ts`'s `getFundReport()`.
> **Permission(s):** existing — no new key. Member surface stays ungated (any linked member); admin surface stays gated on existing `FEATURES.LEDGER_VIEW` / `LEDGER_RECORD` / `LEDGER_MANAGE`.
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-30 |
| 2 — Architectural review | — | **SUBSUMED** | see below | 2026-07-30 |
| 3 — Technical design | — | **SUBSUMED** | see below | 2026-07-30 |
| 4 — Implementation | — | **SUBSUMED** | see below | — |
| 5 — Verification | — | **SUBSUMED** | see below | — |
| 6 — Shipped vs intent | — | **SUBSUMED** | see below | — |

> **SUBSUMED by B-30 (2026-07-30).** B-30's own Phase 1 (`docs/work-log/2026-07-30-transaction-budget-line-link.md`)
> explicitly subsumed this work-log's Phase 1 findings rather than re-deriving them (its
> Resolve #5). B-30's Phase 3 ("Fiscal-Report Breakdown (folded in)" section) is this
> feature's design — both the member Statement AND the admin Fund Report get the cause/
> line-item breakdown, always-rendered, zero-omitted, with an "Other" catch-all row and a
> footnoted fuzzy-fallback marker, reading B-30's exact `budgetLineId` link instead of a
> universally-fuzzy match. This file's Phase 1 stays as the historical record of the
> original scope call, the accuracy-caveat discovery (Pilot Dogs vs. Pilot Dogs, Inc.), and
> Gaps 1–8 — every one of which Phase 3 in the B-30 work-log carries forward by reference
> rather than re-deriving. No further phases run in THIS file; all remaining pipeline
> tracking (Phase 2 onward) lives in the B-30 work-log.

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Let a board-facing statement reader (and possibly an admin viewing the fund report) see budget-vs-actual at the same cause/line-item grain the treasurer already tracks in the budgeting page, using data the report queries already fetch — but the actuals-matching is a fuzzy string join with a *confirmed* real mismatch (Pilot Dogs vs. Pilot Dogs, Inc.), so shipping this without a caveat risks a member-facing document showing a plausible-looking wrong number, not just a blank one.

## Scope — which report(s)

**Primary, recommended: the member Monthly Statement of Financial Condition**, `/members/financial-reports` + `/members/financial-reports/[entitySlug]/[month]`, backed by `src/lib/financial-report-queries.ts` (`getMonthlyStatement`, `computeOneMonthCashActuals`) and rendered by `src/components/members/monthly-statement-table.tsx`. This is the surface CLAUDE.md and the trigger prompt both call "financial reports"/"fiscal reports," and it's the one Chris is distinguishing from "the budgeting-page restructure" — the budgeting page (`BudgetEditor`/`BudgetCauseEditor`) already has full cause/line-item editing on the *budget* side; this request is about the *report/actuals* side.

**Secondary candidate, needs Chris's confirmation: the admin Fund Report**, `/admin/ledger/[fundSlug]/report` ("Budget vs. Actual"). Confirmed by reading `src/app/(dashboard)/admin/ledger/[fundSlug]/report/page.tsx`: it renders `report.income`/`report.expense` at category grain only (Actual YTD / Budget / Variance $ / Variance %), even though the exact same `getFundReport()` call it already makes returns `causeLines` and `causeActualsByKey` per category — those fields already flow into `BudgetEditor` below the table (for budget *editing*), but never into the report *table* itself. Same underlying data, same low-risk reuse, admin-only. Recommend as a fast-follow using the identical mechanism, but treat as a separate Phase 3 component increment, not blocking the member surface.

**Confirmed NOT in scope:**
- `src/app/(dashboard)/admin/ledger/reports/page.tsx` (the per-entity `FundCard` compliance/990 overview) — coarser-grained by design (opening/income/expense/ending balance per fund), already has its own category-grain zero-omission convention (`hasIncomeLines = report.income.some(l => l.actualCents > 0)`) that's a different surface with a different job. Not touched here.
- The Budgeting page (`BudgetEditor`/`BudgetCauseEditor`) itself — Chris explicitly separated this from the budgeting-page restructure; that page already has cause/line-item detail on the budget-entry side.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Signed-in member (any linked member, no `FEATURES` gate) | Opens a monthly statement and sees category rows that have a cause/line-item breakdown expand into labeled sub-rows (e.g. "Charitable donation out" → "WARM," "Pilot Dogs," "Foundation Fighting Blindness") with One Month / Twelve Months / Annual Budget per line | Per statement view |
| Signed-in member | Does NOT see a category or cause-line row where every column (One Month, Twelve Months, Annual Budget) is zero/blank | Per statement view, passive |
| Admin (`LEDGER_VIEW`/`RECORD`/`MANAGE`), if secondary scope confirmed | Opens a fund report and sees the same cause/line-item expansion under Actual YTD / Budget | Per report view |

## Flows

**Flow 1 — Member views a statement with cause/line-item detail:** entry: `/members/financial-reports/[entitySlug]/[month]` (from the landing page's card or the entity/month picker) → step: category rows render as today (unchanged for categories with no cause breakdown) → step (NEW): a category whose budget row has live `causeLines` (per `isCauseLineLive`) renders its cause/line-item rows beneath it, each showing One Month / Twelve Months / Annual Budget → step: any row (category or cause-line) with $0 across all three columns is omitted → outcome: the reader sees the same planning-vs-actual granularity the treasurer already works with, without a wall of "$0.00 $0.00 —" filler rows.
- Failure: no new crash path — this composes data `getMonthlyStatement()`/`getFundReport()` already fetch; if that call fails today, the page already errors the same way. The *silent* failure mode is data-accuracy, not a thrown error — see Gap 1 below.

**Flow 2 — Category with no cause breakdown (the majority — dues income, storage, most operating expense categories):** entry: same page → step: no cause detail to show, `causeLinesFor()`/`FundReportCategoryLine.causeLines` is `null` → outcome: renders exactly as it does today, one row per category. No regression.

**Flow 3 — All-zero row omitted:** entry: same page → step: a category or cause line with $0 One Month, $0 Twelve Months, and no/zero Annual Budget does not render → outcome: shorter statement. See "Resolve #2" below for the exact rule and why a row that's zero in only *one* column must still render.

## Permissions

- **Permission(s):** none new. Member surface: unchanged — no `FEATURES` gate, any linked member (confirmed reading `src/app/members/financial-reports/page.tsx` / `[entitySlug]/[month]/page.tsx` — inline `memberId` check only, matching `/members/impact`'s pattern). Admin surface (if in scope): unchanged — existing `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` gate on `AdminFundReportPage`.
- **Default roles:** unchanged.

## Resolve

### 1. Where per-line actuals come from, and the accuracy caveat

`getFundReport()` (`src/lib/ledger-queries.ts:530`) already computes everything needed for the **Twelve-Month** and **Annual Budget** cause-line columns, for free, on every call it already makes:

- **Annual Budget per line** — `FundReportCategoryLine.causeLines[].amountCents`, keyed to each category's budget row. Already fetched, already flows into `BudgetEditor` today; just never rendered in a report table.
- **Twelve-Month actual per line** — `FundReport.causeActualsByKey: Record<string, number>`, built by `buildCauseActualsByKey()` from this **same FY's own** posted expense actuals, grouped by `causeLineReferenceKey(categoryId, cause, party)`. This is the *exact* mechanism already shipped for the budgeting page's "prior-year reference" columns (`docs/work-log/2026-07-28-causeline-prior-year-reference.md`) — it was always computed for whatever FY/`asOfDate` you pass `getFundReport()`, not exclusively for "the prior year." Since `getMonthlyStatement()` already calls `getFundReport(fund.id, reportFY, { asOfDate: monthEnd })`, `currentReport.causeActualsByKey` is **already sitting in memory, unused** by `financial-report-queries.ts`'s `buildLines()`. Wiring it in costs zero new queries.
- **One-Month actual per line** — not free, but cheap: `computeOneMonthCashActuals()` (`financial-report-queries.ts:440`) already fetches and joins every row needed (posted, reconciled, LEFT JOIN to bank lines) and buckets by `(categoryId, flow)`. Extending the same loop to also key by `causeLineReferenceKey(categoryId, beneficiaryCause, party)` requires no new DB round-trip — just a second `Map` populated in the existing loop.

**Net: this feature can be built on the member Statement page with zero additional database queries** — purely additional aggregation over rows the page already fetches. Worth telling Chris directly; it de-risks the "is this expensive" question.

**The accuracy caveat is confirmed, not hypothetical.** `docs/work-log/2026-07-30-prior-year-line-items.md` (written today, same soft-join mechanism) found this live in the database: FY2025's Foundation/Charitable budget has `ledger_budget_lines.label = 'Pilot Dogs'`, but the matching FY2025 transaction has `party = 'Pilot Dogs, Inc.'`. `causeLineReferenceKey` normalizes with `.trim()` only — no case-folding, no punctuation stripping — so `...::Pilot Dogs` ≠ `...::Pilot Dogs, Inc.`. **On this statement, that cause line would render "Annual Budget: $X,XXX.XX, Twelve-Month Actual: $0.00" for a gift the club actually made.** That is materially worse than a blank row: it's a plausible, wrong number, on a document explicitly built to reproduce "the same monthly Statement of Financial Condition the treasurer reports to the board." This is the single highest-risk item in this feature. Recommend, at minimum for v1: a footnote next to any cause-line breakdown stating actuals are matched by payee name and may not capture every transaction, and that the **category-level total above remains the fully-reconciled figure** (it's a straight sum with no name-matching involved — only the cause-line detail is soft-matched). Light normalization (case-fold + strip trailing corporate suffixes/punctuation before matching) is a reasonable fast-follow, not a hard blocker for v1, per the existing 2026-07-30 work-log's own recommendation on the same gap.

### 2. The exact all-zero-omission rule

Applies independently at **both** grains (category row and cause-line row) once cause-line rows exist. A row is "all-zero" (omitted) iff **all three** of:

- `oneMonthCents === 0`
- `twelveMonthCents === 0`
- `annualBudgetCents` is `null` OR `0`

This is an **AND across columns, never OR** — a cause line budgeted $500 with $0 spent so far this year is *not* all-zero and **must still render** (that's real information: "planned, not yet given"). `annualBudgetCents === null` (no budget row at all) is treated the same as `0` for this test, consistent with how the table already renders both as "—"/`$0.00`-equivalent today, and consistent with `resolveDisplayBudgetCents`'s existing convention that an annotation-only row displays as un-budgeted — the member surface never sees the `starred`/`note` fields that distinguish those cases anyway, so collapsing them here is safe.

**Implementation note for tech-lead:** filter for *display* only, never before totals are computed. `sumTotals()`/`TotalRow` must keep summing over the full `currentReport.income`/`.expense` arrays — only the on-screen row list should have all-zero rows removed, or the visible line items will stop footing to the printed totals.

**Cascade case:** if a category row is all-zero AND every cause line under it is individually all-zero, the whole category disappears — consistent with the existing `EmptySectionRow`/"No categories" precedent. If the category row is *not* all-zero (e.g., it has an actual that didn't match any cause line — see Gap 2 below) but every named cause line individually *is* all-zero, the category still renders with a nonzero total and **no visible breakdown under it** — which will look like a bug even though each row's omission was individually correct. This is exactly why Gap 2 below (an "Other" catch-all) matters.

## Gaps the Request Didn't Address

1. **Cause-line detail is not guaranteed to sum to the category total.** Any transaction with a `beneficiaryCause` tag whose `party` string doesn't exactly match any of that category's cause-line labels (the Pilot Dogs case above, or any typo) is counted in the category-row total but invisible at cause-line grain — there's no line for it to attach to. A reader who sums the visible cause-line rows and compares to the category total will see an unexplained gap. **Recommend adding a synthesized "Other" row per category** = category total minus sum of matched, live cause lines, so visible detail always foots to the printed total. This wasn't in the original request; flagging because a board-facing document that doesn't foot correctly reads as an error even when it isn't one.

2. **Budget-only-lump-sum categories with cause-tagged actuals.** If a category's budget was entered as one lump number (no `ledger_budget_lines` rows), `causeLinesFor()` returns `null` even when `causeActualsByKey` has real cause-tagged actuals for that category — those actuals have no row to render under (same root cause as Gap 1, worse case: zero visible breakdown at all, not just a partial one). Needs a decision: stay budget-driven (a cause only gets its own row once the treasurer has entered a budget line for it — matches how `BudgetEditor` already works, so no new mental model) or synthesize actual-only rows too. Recommend budget-driven for v1, but this means "a treasurer must enter a $0 budget cause line before its actuals show up in the report breakdown" — worth Chris knowing that constraint explicitly.

3. **Cause/line-item breakdown is architecturally expense-only today.** Confirmed by reading `isCauseEligibleCategory` (`src/lib/ledger.ts:617`): `flow === "expense" && countsAsGiving === true`. Income categories (dues, Zeffy donations received, interest) will never carry `causeLines`, so this feature never applies to them — consistent with "causes" being recipients of outgoing money, not a gap in practice, but confirm this matches Chris's mental model before Phase 3 builds around it.

4. **Breakdown coverage today is bounded by the still-open B-33 backlog item**, not by anything this feature controls. `countsAsGiving` is the sole eligibility switch for cause breakdown right now; B-33 (`docs/backlog.md`, unbuilt) wants to decouple "supports line-item breakdown" from "counts as philanthropic giving" so categories like Rudolph Run event costs (a large multi-vendor total across 14 vendors) can be itemized without inflating `/members/impact`'s giving totals. Until B-33 ships, this feature will only ever show breakdown for categories already flagged `countsAsGiving` (charitable donations, grants, scholarships) — any other category the treasurer might want itemized on the report stays lump-sum regardless. Not a blocker for this feature (it correctly reflects whatever data exists), but Chris should know the ceiling is set elsewhere.

5. **Print-friendliness risk, not addressed by the request.** `monthly-statement-table.tsx` is server-rendered and print-tuned (`print:shadow-none print:rounded-none`) apparently assuming something close to a one-page statement. Cause/line-item rows can roughly double-to-triple total row count on funds with heavy cause tagging (Foundation's Charitable donation out alone already carries WARM, Pilot Dogs, Foundation Fighting Blindness, Ohio Lions Eye Research Fund, and others per the FY2025 books). Needs a design decision (Phase 3/tech-lead): always-expand cause lines (accept a longer printed page — my lean, since this document is meant to be read/printed as a static record, not explored interactively), collapsible on screen only (needs a `'use client'` island — today's table is a pure Server Component, so this is an architectural change, flag for Phase 2), or a denser sub-row treatment.

6. **Mobile at 360px.** Category column is already `min-w-[180px]` inside an `overflow-x-auto` wrapper. Indented cause-line labels need their own left-padding treatment inside that same column — should reuse whatever indentation convention the admin `BudgetCauseEditor` cause-line UI already established (per CLAUDE.md's guidance against inventing a new visual pattern), not a new one.

7. **Brand consistency.** No destructive action or button is introduced by this read-only surface, so `ConfirmDialog`/`rounded-lg` don't directly apply — the only open brand question is whatever expand/collapse control, if one is chosen (see Gap 5), which would need `rounded-lg` (never `rounded-full`) and would introduce this component's first `'use client'` boundary.

8. **Does the omission rule apply retroactively to today's existing category-only rows, or only to new cause-line rows?** Chris's wording ("They can also leave off rows that have 0 for all values") reads as applying at both grains — i.e., this is partly a small behavior change to the *existing* category view (a category with $0/$0/no-budget today would newly disappear), not purely additive to new cause-line rows. Confirming this reading is correct — see Open Questions.

## Out of Scope (confirm with user)

- **Fixing the label↔party matching fragility** (Pilot Dogs / Pilot Dogs, Inc.) at the root — real and confirmed, but a separate normalization effort (case-fold + strip corporate suffixes), not this feature's job to fully solve. Recommend a footnote now, normalization as fast-follow (same recommendation `docs/work-log/2026-07-30-prior-year-line-items.md` already made for the budgeting page's identical gap).
- **B-33** (decoupling cause-breakdown eligibility from `countsAsGiving`) — this feature surfaces whatever breakdown already exists; it doesn't expand what's eligible.
- **The admin `reports/page.tsx` per-entity FundCard dashboard** — different, coarser surface with its own existing zero-omission convention; not touched here.
- **The Budgeting page** — Chris explicitly separated this; already has cause/line-item editing on the budget-entry side.

## Open Questions

1. Is "fiscal reports" the member Monthly Statement only, or also the admin Fund Report (`Budget vs. Actual`)? I recommend the member Statement as primary scope, admin Fund Report as a fast-follow using the identical, already-cheap mechanism — confirm.
2. Accuracy-caveat handling for the Pilot-Dogs-class mismatch: footnote only (cheap, ship in v1), light label normalization (medium effort), both, or explicitly accept the risk and defer? I recommend footnote now + normalization as fast-follow.
3. Add a synthesized "Other" catch-all row per category so visible cause-line detail always foots to the category total (Gap 1)? I recommend yes.
4. Budget-driven cause rows only (Gap 2), or synthesize actual-only rows for cause-tagged actuals with no matching budget line? I recommend budget-driven for v1, matching the existing `BudgetEditor` mental model.
5. Always-render cause lines when present, or make them collapsible (Gap 5)? This is a real architecture fork (collapsible needs a new `'use client'` boundary on a page that's a pure Server Component today) — I lean toward always-render for a print-oriented board document, but confirm before Phase 2.
6. Does the all-zero-omission rule also change today's existing category-only rows (Gap 8), or is it scoped purely to the new cause-line rows? I read the request as applying to both grains — confirm.

## What I did

- Read `src/lib/financial-report-queries.ts` in full (statement types, `getMonthlyStatement`, `computeOneMonthCashActuals`, `isMonthGatedForEntity`) to confirm current grain (category-only) and exactly where each Statement column is sourced.
- Read both member pages (`src/app/members/financial-reports/page.tsx`, `.../[entitySlug]/[month]/page.tsx`) and the render component (`src/components/members/monthly-statement-table.tsx`) to confirm permission gating, print styling, mobile wrapper, and today's zero-row behavior (none — every category renders unconditionally).
- Read `src/lib/ledger-queries.ts`'s `getFundReport()` (types + full implementation, lines 139–830) to confirm `causeLines`/`causeActualsByKey` are already computed for any fund+FY (including the member Statement's own `asOfDate`-bounded call), and are simply unconsumed by `financial-report-queries.ts`'s `buildLines()` today.
- Read `causeLineReferenceKey`, `buildCauseActualsByKey`, and `isCauseLineLive` in `src/lib/ledger.ts` to confirm the exact matching mechanism and its normalization (trim-only).
- Read `docs/work-log/2026-07-30-prior-year-line-items.md` (written today, same soft-join mechanism applied to prior-FY reference) to ground the Pilot-Dogs-vs-Pilot-Dogs-Inc. accuracy caveat in a confirmed, live-database finding rather than a hypothetical.
- Read the admin Fund Report page (`src/app/(dashboard)/admin/ledger/[fundSlug]/report/page.tsx`) to confirm it already fetches `causeLines`/`causeActualsByKey` via the same `getFundReport()` call (currently used only to feed `BudgetEditor`, not the report table itself) and to assess it as a secondary-scope candidate.
- Read the admin `reports/page.tsx` (`FundCard`) briefly to confirm it's a distinct, out-of-scope surface with its own existing zero-omission convention.
- Confirmed `isCauseEligibleCategory` (`flow === "expense" && countsAsGiving === true`) in `ledger.ts:617`, and cross-referenced the open B-33 backlog item (`docs/backlog.md`) to establish the current ceiling on breakdown coverage.

## Outputs

- `docs/work-log/2026-07-30-fiscal-report-cause-breakdown.md` (this file).
- No code changes — Phase 1 only.

## Open questions / handoff notes

See "Open Questions" above. Recommend routing to **architect (Phase 2)** next, specifically to rule on: (a) whether the admin Fund Report is in scope alongside the member Statement, and (b) the always-render-vs-collapsible question, since collapsible introduces this surface's first client boundary. Tech-lead's Phase 3 design should explicitly address the "Other" catch-all row and the accuracy-caveat footnote copy, since both directly affect what ships as v1 versus fast-follow.
