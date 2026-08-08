# Unposted Transactions in Fiscal Reports — Work Log

> **Slug:** `2026-08-08-unposted-in-fiscal-reports`
> **Surface:** mixed — `/admin/ledger/reports` AND `/members/financial-reports` (board-facing)
> **Permission(s):** existing gates on both surfaces; no new key expected
> **Estimated complexity:** medium — changes the meaning of a board-facing financial document
> **Pipeline mode:** Full — financial reporting semantics, board-facing

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-08 |
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

> Under the revised decision — two labeled figures (posted, and including-unposted) plus an itemized note, on both surfaces — the board-facing document keeps its bank tie-out and the readability risk moves from "does this document still mean what it says" (my objection to the original fold-into-totals brief) to a narrower, concrete question: does doubling every numeric column actually fit a table that's already at 4 columns and print/360px-constrained, and the answer, read against the real component, is "not if you double every column" — but the underlying figure is real (the gate does not prevent a published month from containing pending items) and there's a legible way to show it that doesn't double the table.

## Ground Truth Established

- **Two different "not yet posted" concepts exist in this schema; the treasurer's wording maps to one of them.** `ledgerTransactions.status` is `'posted' | 'pending' | 'rejected'` (`src/lib/db/schema.ts:745`). `pending` is exclusively an **expense-side, over-disbursement-threshold, awaiting-board-approval** state — every aggregation site filters it as `t.status === "pending" && t.flow === "expense"` (`src/lib/ledger-queries.ts:706-707`, `:3022-3030`, `:4275-4276`), and the entry-form toast confirms it directly: *"Submitted — awaiting board approval (over the disbursement threshold)"* (`src/components/admin/ledger/transaction-form.tsx:479`). **Because it is expense-only, "including unposted" is only ever different from "posted" on expense rows** — a Revenue category, Total Revenue, or any income-flow line is numerically identical in both figures, always. This is the load-bearing fact for the readability question below: a design that mirrors both columns/figures across the Revenue section as well as Expenses is showing the same number twice for no reason. Separately, a **posted** transaction can be `reconciled=false` — money already recorded as spent/received but not yet bank-cleared (outstanding checks, deposits in transit) — already surfaced today without a second column, via `hasUncashedCheck` per-line and the `bookVsCashDivergenceCents` footnote (`src/lib/financial-report-queries.ts:116-118`, `:150-153`). "Not yet posted" is the schema's term for the first case; Phase 3 must not conflate the two into one "unposted" bucket.
- **`rejected` is never counted anywhere today** — every real aggregation site explicitly filters to `status='posted'` or `status='pending'`; nothing sums an unfiltered status set except the raw CSV export, which lists status per row for transparency (`src/app/api/admin/ledger/export/route.ts:144,174`), not for a total. Confirmed: rejected must stay excluded, named as a unit test, not assumed.
- **The publication gate is structurally blind to `pending` — this directly answers the "is the member-facing half a no-op" question, and the answer is no.** `isMonthGatedForEntity()` (`financial-report-queries.ts:408-440`) selects only rows where `eq(ledgerTransactions.status, "posted")` and `reconciled=false` (lines 428-429). A `pending` row is never fetched by this query — it has **zero** effect on whether a month gates. So a month can be, and regularly will be, "ready"/published while a `pending` (unapproved, over-threshold) expense dated inside it still sits unresolved. This is not a rare edge case: the sibling budget-context work-log independently confirms `pending` exists specifically for real, recurring over-threshold disbursements awaiting a board vote. **The member-facing half of this feature is not a no-op — it will render, and often.**
- **Both existing report figures are posted-only today**, confirmed by reading the code. `computeOneMonthCashActuals()` filters to `status='posted', reconciled=true` (`financial-report-queries.ts:509-511`) — pending is invisible to the One-Month column. `MonthlyStatement.twelveMonthCents`/`endingBookBalanceCents` come from `getFundReport()` (`financial-report-queries.ts:872`), posted-only by the module's own header comment (`financial-report-queries.ts:9-14`) and confirmed against `ledger-queries.ts`'s `status='posted'` filters throughout (e.g. lines 4403, 4663). The rendered table's own footer already states this in board-facing prose today: *"Revenue and expense transactions are not included in this report until posted by the bank in the month of the report"* (`src/components/members/monthly-statement-table.tsx:169-171`).
- **A naming collision already exists in that exact footer sentence, and this feature is about to make it worse if not handled deliberately.** The shipped footer text uses "posted" to mean *bank-cleared* ("posted by the bank"), while the schema's `status='posted'` means *board-approved/recorded*, independent of whether the bank has cleared it. A new column or figure literally labeled **"Posted"** sitting one paragraph above/below that sentence would read, to a board member, as "cleared by the bank" — which is not what it means. **Recommend the new figure NOT be labeled "Posted" on this surface** — see Column Labels below.
- **The member-facing table is a real, already-dense 4-column table, not a blank canvas** (`monthly-statement-table.tsx`). Columns today: Category, One Month Ended, Twelve Months Ended, Annual Budget — plus indented cause-line sub-rows, a section header row, a total row, a net row, and two balance rows, inside a wrapper whose own comment already notes it needs `overflow-x-auto` for 360px and is "narrower than the 5-column admin report" (lines 108-111) — i.e. this component is already written with the awareness that width is a live constraint, not spare capacity. **Naively doubling every numeric column (One Month Posted / One Month Incl. Unposted / Twelve Month Posted / Twelve Month Incl. Unposted, ×2 for cause-line sub-rows too) turns a 4-column table into 6, on a component that already flags 4 as tight** — this is the concrete "does it fit" answer the treasurer asked for, and combined with the Revenue-is-always-identical fact above, doubling every column would also render two visibly identical numbers side-by-side on every Revenue row, which reads as a mistake, not a feature.
- **`/admin/ledger/reports` is a card layout, not a table, and already ships most of what's being asked for.** `FundCard` (`admin/ledger/reports/page.tsx:150-159`) already renders a distinct **"Encumbered (pending approval)"** line using `report.pendingExpenseCents`, separate from — not merged into — the Ending Balance above it, and the page's footer already discloses *"Cash-basis report. Figures reflect posted transactions only"* (lines 397-401). Under the revised two-figure decision, the admin surface needs almost no change to its arithmetic (it's already posted-only + a separate pending figure); the real gap there is that today's "Encumbered" line is a single dollar figure with **no itemization** — there is no list of which transactions make it up. That itemized list (the "note") is the actual admin-side deliverable, not a new total.
- **The same admin page computes a 990-adjacent compliance figure from the identical posted-only source.** `entityReport.grossReceiptsCents`, `.netCents`, `.determine990Result` (`admin/ledger/reports/page.tsx:349-393`) are posted-only by construction (`determine990` call sites gated on `status === "posted"`, e.g. `ledger-queries.ts:3223, 3243`). This must stay posted-only regardless of what any new "including unposted" figure shows elsewhere on the same page — the treasurer's revised decision doesn't ask to touch this, but nothing stops a careless Phase 4 implementation from doing so by reusing the wrong source, so it's named explicitly.
- **The board-facing statement type has a deliberate, narrow data-exposure boundary** that the itemized "note" would need to respect: `MonthlyStatementCategoryLine` carries only `categoryId`, `categoryName`, three `*Cents` numbers, and a boolean — never `party`, `memo`, `checkNumber`, `publicNote`, `donorId`, or a transaction id (`financial-report-queries.ts:26-31`). A per-transaction note listing pending items needs an explicit, separate ruling on how much detail it exposes (see Gaps).
- **DECISION-069's `postedCents`/`pendingCents` convention is now a closer fit than before, not a looser one.** The sibling budget-context feature returns exactly this labeled pair so a posted+pending figure never looks indistinguishable from a posted-only one. The revised two-figure decision *is* that same pattern, one layer up — recommend the data layer underneath this feature use the identical field names, so both features' server responses share one vocabulary even though their UI presentations (an inline form panel vs. a printed board table) look nothing alike.
- **`getPhilanthropy()` (`/members/impact`) and the budget-vs-actual surfaces** (`/admin/ledger/budgeting`, `budget-editor.tsx`, `budget-overview-table.tsx`) are posted-only and outside the treasurer's stated scope (both surfaces) — named as do-not-touch, not silently assumed safe.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`ledger.view`/`ledger.record`/`ledger.manage`) | Views `/admin/ledger/reports`, reads the existing posted (bank-tying) fund total plus an itemized list of what's pending | Per working session |
| Signed-in member (any linked member — no `FEATURES` gate) | Views `/members/financial-reports/[entity]/[month]`, reads a Statement of Financial Condition presenting both a posted figure and an including-unposted figure, plus a note listing what's pending | Monthly, around board meetings |

The request itself is a "the system supports X" statement, not a described interaction — the verbs above are inferred from the two existing pages' mechanics.

## Flows

**Flow 1 — Treasurer reads the admin working report:** Entry: treasurer navigates to `/admin/ledger/reports` → picks entity/fiscal year → each `FundCard` shows the Ending Balance exactly as today (posted-only, ties to the bank/books) → the existing "Encumbered (pending approval)" line gains an itemized breakdown (which categories/amounts make it up) rather than staying a single number → outcome: the treasurer's headline figure is unchanged from today; the new value is visibility into *what* is pending, not a new total.
- Failure: not addressed by the request. If the itemization fetch fails independently of the already-working totals, the page should still render the existing, working posted figures — a failure in the new itemization must not take down the whole card. Needs explicit microcopy.

**Flow 2 — Board member reads the monthly statement:** Entry: signed-in, member-linked user navigates to `/members/financial-reports` → picks entity + month via `FinancialReportPicker` (only gate-cleared months offered) → `MonthlyStatementTable` renders the existing posted figures (unchanged, still ties to the bank per the existing footer sentence) plus a second, clearly-labeled including-unposted figure wherever pending expenses exist for that period, plus an itemized note of what's pending → outcome: the board reads a stable, bank-tying primary figure and a distinct, explicitly-labeled estimate of committed-but-unapproved spending, without the two being confusable.
- Failure: not addressed by the request. Confirmed real (not hypothetical) per Ground Truth: a gate-cleared, published month can carry live pending items. Because the posted figure never moves (it's the same posted-only computation shipped today), the risk that concerned me in the original "fold" brief — a board document silently overstating cash on hand — is substantially resolved by this design. What remains open: whether the *including-unposted* figure for an already-viewed past month is allowed to change on a later page load as a pending item resolves (approved → posted, or rejected), since `getMonthlyStatement()` re-derives live on every call rather than snapshotting (see Open Questions) — lower-stakes than before, since only the explicitly-labeled estimate column moves, never the posted one.

## Permissions

- **Permission(s):** No new `FEATURES` key needed on either surface. `/admin/ledger/reports` is already gated by `hasAnyFeature(session.user.id, [FEATURES.LEDGER_VIEW, FEATURES.LEDGER_RECORD, FEATURES.LEDGER_MANAGE])` (`admin/ledger/reports/page.tsx:174-179`). `/members/financial-reports` has no `FEATURES` gate — any linked member can view it. This feature changes what those already-gated surfaces show, not who can reach them.
- **Default roles:** N/A — no new binding.

## Gaps the Request Didn't Address

- **Column-vs-row layout for the member-facing table is undecided, and "two columns" doesn't fit literally without real cost.** Given the table is already a tight 4 columns and pending only ever affects Expense rows (never Revenue), recommend Phase 3 NOT double every numeric column. A pair of clearly-labeled **additional rows** under Total Expenses / Net income / Ending fund balance (e.g. "Pending board approval" then "incl. pending" totals) delivers the same two-figures-plus-note requirement without widening the table, without a print/360px regression, and without ever showing an identical number twice on a Revenue row. This is a recommendation for Phase 3/ux-developer to weigh, not a mandate — but the "just double the columns" version should be treated as a rejected option, not a default, given the concrete legibility cost shown above.
- **Column/row labels must not collide with the existing "posted by the bank" footer sentence.** Recommend NOT literally labeling anything "Posted" vs. "Including Unposted" on the member-facing surface — reuse the vocabulary the app has already shipped and board members have already seen: **"Encumbered"/"Pending board approval"** (the admin FundCard's existing term) for the delta, with the existing One Month/Twelve Month columns left exactly as they are (silently still posted-only, as today). This keeps the two surfaces terminologically consistent (the treasurer's own stated goal) by reusing the one term that already exists, instead of introducing a new pair of words on one surface only.
- **Admin-side deliverable is narrower than it first reads.** Per Ground Truth, the admin total doesn't need to change at all — it already ties to the bank and already shows a separate pending figure. The actual new work on `/admin/ledger/reports` is itemizing `pendingExpenseCents` into a list. Phase 3 should scope it that way rather than re-deriving a "second column" that already exists.
- **The itemized "note" needs a decided level of detail on both surfaces**, consistent with `MonthlyStatementCategoryLine`'s existing data-exposure boundary (no `party`/`memo`/`checkNumber`/`publicNote`/donor/transaction id today). Category + dollar amount fits the boundary with zero new exposure decisions; anything with payee/purpose is a new, deliberate exception that needs explicit sign-off, especially on the board-facing surface, and could differ between the two surfaces (admin sees more detail than the board, plausibly) — worth asking rather than assuming symmetry.
- **Whether the including-unposted figure is allowed to drift for an already-published month.** Lower-stakes than under the original "fold" brief (the posted figure never moves), but still undecided: should the pending-inclusive figure for a past month re-derive live (and change if a pending item resolves after the board already read it), or freeze at generation time? Recommend re-deriving live is acceptable here specifically *because* it's explicitly labeled as an estimate, not the club's stated cash position — but this is a product call, not mine to assume silently.
- **Rejected transactions must positively stay excluded**, confirmed by a named Phase 3 unit test on both surfaces, not inherited by accident.
- **Consistency with DECISION-069's `postedCents`/`pendingCents` field convention** at the data layer — recommended so both features' server responses share one vocabulary, independent of how differently their UIs present it (see Ground Truth).
- **Failure microcopy** for the new pending/itemization fetch, distinct from a legitimate "nothing pending" state — not addressed by the request.
- **Empty/reassuring state.** Most fund-periods will have nothing pending — that's the common case. Should read as quiet confirmation ("No pending transactions this period"), not an alarming empty-state box.
- **Print layout.** `/members/financial-reports` has print-specific chrome already (`print:hidden`, `PrintStatementButton`) because board members print this for meetings — any new row/note must render sanely in print, not just on-screen.
- **Mobile at 360px.** Not addressed; the row-based recommendation above avoids the worst of this, but a new itemized note still needs to stack cleanly.
- **Brand consistency.** No destructive action (read-only report), so `<ConfirmDialog>` doesn't apply. A pending marker should reuse the existing yellow-badge idiom already on this exact admin page for `hasUncashedCheck`/encumbered amounts (`bg-yellow-50`/`text-yellow-700`, `admin/ledger/reports/page.tsx:152-159`) rather than inventing new color semantics.

## Out of Scope (confirm with user)

- Doubling every numeric column on the member-facing table (including Revenue, where pending never applies) — evaluated above and recommended against on readability grounds; propose the row-based alternative instead.
- Extending the including-unposted figure to `/members/impact` (philanthropy), `/admin/ledger/budgeting` (budget-vs-actual), or the 990/compliance determination on `/admin/ledger/reports` itself — none were named in the revised decision either; all three stay posted-only.
- A fully itemized (payee/purpose) list of pending transactions — recommend category + amount only by default on both surfaces unless the treasurer confirms otherwise.
- Changing `isMonthGatedForEntity()` so a month with open pending items no longer gates as "ready" — not requested; the gate stays exactly as it is today, and the including-unposted figure is presented as a labeled estimate instead.

## Open Questions

- **Column labels:** does "Encumbered" / "Pending board approval" (reusing the admin page's existing, already-shipped term) read clearly to a board member, or is there a term the treasurer already uses out loud at board meetings that should be reused instead? Whatever word is picked should be identical on both surfaces per the stated readability goal.
- **Layout:** is an additional labeled row (Pending / incl. Pending) under Total Expenses, Net income, and Ending fund balance an acceptable reading of "two columns," given a literal doubled-column table doesn't fit this component without real width/print cost? Or is a genuinely columnar layout non-negotiable, in which case Phase 3 needs to design a narrower per-column format (e.g. a compact "$X (+$Y pend.)" single cell) as the fallback?
- **Itemization detail:** category + dollar amount, or payee/purpose too — same on both surfaces, or more detail for admin than for the board?
- **Staleness:** should the including-unposted figure for an already-viewed month be allowed to change on a later page load as pending items resolve, or should it freeze once shown? (The posted figure never moves either way.)
- **DECISION-069 alignment:** confirm sharing the `postedCents`/`pendingCents` field-naming convention at the data layer between this feature and the budget-context feature.

## The board-facing half, said plainly, once

My original objection to the "fold pending into the totals" brief was that a Statement of Financial Condition would stop stating a cash position the club actually holds. The revised decision — a stable posted figure that still ties to the bank, plus a separate, explicitly-labeled including-unposted estimate — directly answers that: the primary figure never moves, so the document keeps its meaning, and the board still gets visibility into money that's effectively committed. I no longer think the board-facing half is a mistake under this design. The remaining risk isn't integrity, it's legibility, exactly what the treasurer asked me to judge: this table is already dense, and doubling every column is the wrong way to add a second figure to it. The row-based alternative above is the concrete, least-damaging way to deliver "two figures plus a note" without the width and print cost of a literal second column set.

## Recommended Pipeline Mode

**Full** (matches this work-log's own front matter). Board-facing financial-document semantics, a real layout-fit decision that affects an already-shipped component, and a naming/terminology decision that spans two surfaces all warrant an explicit architect/tech-lead ruling rather than an implementer's judgment call. Do not compress to a bug-fix-style abbreviated pipeline.

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


---

## Treasurer Decisions (2026-08-08)

**Superseding the initial "fold pending into the totals" answer.** The treasurer revised it after the
bank tie-out consequence was raised:

> "I think the reports in the admin section should tie to the bank, so the extra column makes sense
> there. Unposted transactions are for all purposes money that is spent, so on the member report I
> think it should be part of the totals with the note. Or maybe even make it extremely clear on all
> reports with your original idea of two columns. **I just want the report to be easy to read.**"

**Resolved: two columns on BOTH surfaces** — a posted figure that continues to tie out to the bank, and
an including-unposted figure showing money effectively committed — plus a note listing the unposted
transactions.

Rationale: presenting unposted money differently on the two reports would force anyone comparing them
to hold two mental models, which defeats the stated goal. The posted column preserves the bank tie-out
on the board-facing Statement of Financial Condition, so it never has to state a cash position the club
does not hold, while the second column still surfaces commitments the board should see.

**Readability is the acceptance criterion, in the treasurer's own words** — not the column count. If a
second column per section cannot fit the existing One Month / Twelve Months / Annual Budget structure
legibly, the design must propose something that does rather than shipping a wider, denser table.

Open for Phase 1 to resolve: the column labels a board member understands without explanation, and
whether the member-facing publication gate (a month publishes only once everything posted is
reconciled) means a published month can contain unposted transactions at all — if it cannot, that half
of the feature is a no-op and must be reported as such rather than built.
