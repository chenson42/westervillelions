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
| 1 — Functional refinement | analyst | In progress | — | 2026-08-08 |
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

> The treasurer wants "not yet posted" money visible on two reports that today are built exclusively from `status='posted'` figures; the working `/admin/ledger/reports` view can absorb this cleanly (it already shows a separate, non-folded pending line), but folding board-unapproved disbursements into the headline of the board-facing Statement of Financial Condition changes what that document *claims* in a way that goes beyond the bank-tie-out trade-off the treasurer was warned about — designable, but only with the posted subtotal kept mechanically recoverable and the compliance figures on the same admin page kept untouched.

## Ground Truth Established

- **Two different "not yet posted" concepts exist in this schema, and the request's wording maps to only one of them.** `ledgerTransactions.status` is `'posted' | 'pending' | 'rejected'` (`src/lib/db/schema.ts:745`). `pending` is exclusively an **expense-side, over-disbursement-threshold, awaiting-board-approval** state — every aggregation site filters it as `t.status === "pending" && t.flow === "expense"` (`src/lib/ledger-queries.ts:706-707`, `:3022-3030`, `:4275-4276`), and the entry-form toast confirms the semantics directly: *"Submitted — awaiting board approval (over the disbursement threshold)"* (`src/components/admin/ledger/transaction-form.tsx:479`). Separately, a **posted** transaction can be `reconciled=false` — money the club has already recorded as spent/received but the bank hasn't cleared yet (outstanding checks, deposits in transit). That second case is **already surfaced today**, without folding, via `hasUncashedCheck` per-line and the `bookVsCashDivergenceCents` footnote (`src/lib/financial-report-queries.ts:116-118`, `:150-153`). The treasurer's literal phrase — "transactions that have not posted yet" — is the schema's own term for the first case (`status='pending'`), not the second. Phase 3 must not conflate them; they are different numbers with different governance weight (see Gaps).
- **`rejected` is never counted anywhere today.** Every real aggregation site explicitly filters to `status='posted'` or `status='pending'` — nothing sums an unfiltered status set except the raw transaction-ledger CSV export, which lists status per row for transparency (`src/app/api/admin/ledger/export/route.ts:144,174`), not for a total. Confirmed: rejected must stay excluded, and this should be a named unit test, not an assumption.
- **The board-facing publication gate is structurally blind to `pending`.** `isMonthGatedForEntity()` (`src/lib/financial-report-queries.ts:408-440`) only selects rows where `eq(ledgerTransactions.status, "posted")` and `reconciled=false` (lines 428-429) — a `pending` row is never fetched by this query at all, so it has zero effect on whether a month gates. **This resolves the coherence question directly: yes, a month can already be published today while pending (unapproved) transactions dated inside it exist** — the gate was never checking for them, so nothing about "should we show pending on a report month" conflicts with how a month becomes ready. The open question is not "can this coexist" but "what does showing it, on a document that can't itself change once a pending item later resolves, imply" (see Gaps).
- **Both existing figures this feature would touch are posted-only today, confirmed by reading the code, not inferred from the type names.** `computeOneMonthCashActuals()` filters to `status='posted', reconciled=true` (`financial-report-queries.ts:509-511`) — pending is invisible to the One-Month column today. `MonthlyStatement.twelveMonthCents`/`endingBookBalanceCents` both come from `getFundReport()` (`financial-report-queries.ts:872`, `currentReport.endingCents`), whose own header comment states every figure it returns is `status='posted'`-scoped (`financial-report-queries.ts:9-14`, cross-checked against the `status='posted'` filters throughout `ledger-queries.ts`, e.g. lines 4403, 4663 doc comments). Nothing about "not yet posted" reaches either report surface today.
- **`/admin/ledger/reports` already has working precedent for a labeled-but-*separate* presentation, which the treasurer's "fold, don't separate-column" decision explicitly moves away from.** `FundCard` (`src/app/(dashboard)/admin/ledger/reports/page.tsx:150-159`) renders a distinct `"Encumbered (pending approval)"` line using `report.pendingExpenseCents`, visually separate from — not netted into — the Ending Balance above it. The page's own footer states: *"Cash-basis report. Figures reflect posted transactions only... not a filed tax return"* (lines 397-401). Folding pending into the FundCard's headline total is a real, deliberate departure from that existing pattern and disclaimer, and the disclaimer's wording will need to change to stay honest.
- **The same admin page computes a compliance-grade figure from the identical posted-only data this feature would fold.** `entityReport.grossReceiptsCents`, `.netCents`, and `.determine990Result` render in the "Entity Totals" section of the *same page* as the FundCards (`admin/ledger/reports/page.tsx:349-393`) and are posted-only by construction (`ledger-queries.ts` — `determine990` call sites gated on `status === "posted"`, e.g. lines 3223, 3243). If FundCard totals fold pending but Entity Totals doesn't, the same page will show two totals that intentionally disagree with each other for different, unstated reasons — and if Entity Totals also folds, a real IRS-990-adjacent compliance number would start counting board-unapproved money. This is the single biggest collateral-damage risk on the admin surface and the request never mentions it.
- **The board-facing statement type has a deliberate, narrow data-exposure boundary that a "list of unposted transactions" would strain.** `MonthlyStatementCategoryLine`'s doc comment is explicit: it carries only `categoryId`, `categoryName`, three `*Cents` numbers, and a boolean — **never** `party`, `memo`, `checkNumber`, `publicNote`, `donorId`, or any transaction id (`financial-report-queries.ts:26-31`). "Note any transactions that have not posted yet" naturally wants *some* description per item; whether that's "category + amount" (fits the existing boundary) or "payee + purpose" (a new, deliberate exception) is undecided.
- **A sibling in-flight feature already solved the "posted vs. pending must never silently merge" problem and named a convention.** `docs/work-log/2026-08-08-budget-context-on-transaction-entry.md` (DECISION-069, ruling #4) deliberately returns labeled `postedCents`/`pendingCents` fields rather than a single merged number, specifically so a figure that counts pending never looks identical to — and silently disagrees with — every posted-only figure elsewhere in the app. This feature is the mirror-image case: it wants a single *displayed* folded number, but the same discipline applies to the *data* underneath it (see Gaps).
- **`getPhilanthropy()` (`/members/impact`) is posted-only and out of this request's stated scope** (`ledger-queries.ts:4707`, `eq(ledgerTransactions.status, "posted")`) — not touched by the treasurer's ask, but shares helper functions with the reports code path, so it's worth naming explicitly as a do-not-touch rather than leaving it to be discovered by accident in Phase 4.
- **Budget-vs-actual surfaces** (`/admin/ledger/budgeting`, `budget-editor.tsx`, `budget-overview-table.tsx`) consume `getFundReport()` actuals directly (posted-only) and are likewise not in the treasurer's stated scope — flagged as untouched, not silently changed.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`ledger.view`/`ledger.record`/`ledger.manage`) | Views `/admin/ledger/reports`, reads fund totals that now fold in pending disbursements | Per working session |
| Admin | Reads a list/marker of which transactions in the period are pending | Per working session |
| Signed-in member (any linked member — no `FEATURES` gate on this surface) | Views `/members/financial-reports/[entity]/[month]`, reads a Statement of Financial Condition whose totals now fold in pending disbursements | Monthly, around board meetings |
| Signed-in member | Reads a note/list of which transactions in the period haven't posted yet | Monthly |

The request itself ("fiscal reports should show non posted totals... note any transactions that have not posted yet") is a "the system supports X" statement, not a described interaction — the verbs above are inferred from the two existing pages' mechanics, per Pass 1's instruction to flag this. Confirmed scope with the treasurer directly: both surfaces, folded presentation.

## Flows

**Flow 1 — Treasurer reads the admin working report with pending folded in:** Entry: treasurer navigates to `/admin/ledger/reports` → picks entity/fiscal year via `EntitySwitcher`/`FiscalYearSelector` → each `FundCard`'s Total Expenses / Ending Balance now includes that fund's pending (over-threshold, awaiting-approval) disbursements, with the pending amount also itemized/marked distinctly → outcome: the headline number the treasurer works from during the day includes committed-but-not-yet-approved spending, not just approved spending.
- Failure: not addressed by the request. If the pending-figure computation fails independently of the existing posted computation, does the whole card fail to render, or silently show posted-only with no indication anything is missing? Needs explicit microcopy, distinct from "$0 pending" (which reads as "nothing is pending," a real and different state).

**Flow 2 — Board member reads the monthly statement with pending folded in:** Entry: signed-in, member-linked user navigates to `/members/financial-reports` → picks entity + month via `FinancialReportPicker` (only months that clear `isMonthGatedForEntity()` are offered) → `MonthlyStatementTable` renders One Month / Twelve Month / Annual Budget columns whose totals now fold in that fund's pending expenses, plus a note/list of which line items are pending → outcome: the board reads a stated cash position that includes money not yet approved by the board itself to spend.
- Failure: not addressed by the request, and this is the sharpest case in the whole review. A month's gate is blind to `pending` (Ground Truth above) — a month can be "ready" today while carrying open pending items. Once this feature ships, a board member could read a published month's total, and later that pending item resolves (approved → posted, or rejected) with no defined behavior for whether the already-published historical month's figure updates, gets a correction note, or stays frozen as originally shown. Undefined today; must be decided in Phase 3, not left to whichever behavior falls out of not caching anything (see Open Questions).

## Permissions

- **Permission(s):** No new `FEATURES` key needed on either surface. `/admin/ledger/reports` is already gated by `hasAnyFeature(session.user.id, [FEATURES.LEDGER_VIEW, FEATURES.LEDGER_RECORD, FEATURES.LEDGER_MANAGE])` (`admin/ledger/reports/page.tsx:174-179`). `/members/financial-reports` has no `FEATURES` gate at all — any user with a linked member record can view it (matches the CLAUDE.md description: "Open to any linked member, no `FEATURES` gate"). This feature changes what those already-gated surfaces *show*, not who can reach them.
- **Default roles:** N/A — no new binding.

## Gaps the Request Didn't Address

- **"Not yet posted" is ambiguous between `status='pending'` and `reconciled=false`, and the request's own wording only clearly names one of them.** The literal schema term for "has not posted yet" is `status='pending'` — money the treasurer entered but the board hasn't approved (over the disbursement threshold). It is *not* the same as a posted-but-uncleared check, which the report already handles via footnote without folding into totals. Conflating the two would silently double the scope of "not posted" beyond what the treasurer asked for. **Resolution:** Phase 3 names this explicitly with a worked dollar example; recommend this feature is about `status='pending'` only, and the existing `reconciled=false` footnote mechanism is left exactly as-is.
- **A published board month's total can now become stale in a way it never could before.** Since the gate never checked `pending`, a month can publish while carrying live pending items; once this feature folds those into the headline, that headline is a claim that can later prove wrong (the pending item gets rejected, or approved at a different amount than initially entered). **Resolution needed:** freeze the historical figure as shown at generation time (recommended — a board document shouldn't silently change after a meeting has already read it), or explicitly re-derive live on every page load and accept that a number a board member cites in April can differ from the same URL in May. Pick one; don't let it fall out of caching behavior by accident.
- **The same admin page (`/admin/ledger/reports`) computes a 990-adjacent compliance figure from the same posted-only source this feature is being asked to loosen.** `grossReceiptsCents`/`netCents`/`determine990Result` must not silently start counting pending money just because the FundCard next to them does. **Resolution:** Phase 3 must explicitly rule that Entity Totals / 990 determination stays posted-only regardless of what the FundCard's operating total shows, and the page's disclaimer text needs updating to describe *which* numbers on the page are cash-basis-posted-only vs. which fold in pending, since after this change the page will contain both for the first time.
- **Data-exposure boundary for the "note" itself.** `MonthlyStatementCategoryLine` deliberately excludes `party`/`memo`/`checkNumber`/`publicNote`/donor/transaction ids (`financial-report-queries.ts:26-31`). "Note any transactions that have not posted yet" needs a decided granularity — category + dollar amount fits the existing boundary with zero new exposure decisions; a named/itemized list (who, what) does not, and would need its own explicit sign-off, not an assumption that "note" means "list with payee."
- **Rejected transactions must positively stay excluded, confirmed by a test, not by inheritance.** Every current aggregation filters explicitly to `posted` or `pending`; this feature's new pending-inclusive query must do the same, named as a Phase 3 unit test (`status='rejected'` rows contribute $0 to any total on either surface).
- **Consistency with DECISION-069's `postedCents`/`pendingCents` convention.** The sibling budget-context feature exists specifically to keep a posted+pending figure from ever looking indistinguishable from a posted-only one. Recommend this feature's data layer return the same labeled pair (`postedCents`, `pendingCents`) on every row/total it touches — so "fold into totals" happens in the UI's rendering (a single displayed number), while the underlying payload keeps the posted subtotal mechanically recoverable, satisfying the treasurer's "fold" instruction without making the posted figure unrecoverable. This is the least-damaging faithful reading of his decision.
- **Failure microcopy** for the pending-figure fetch, distinct from a legitimate "$0 pending" state — not addressed by the request, needed on both surfaces.
- **Empty/reassuring state.** Most fund-months will have no pending items. That's the common case, not an edge case, and should read as quiet confirmation ("No pending transactions this period"), not an alarming empty-state treatment — not addressed by the request.
- **Print layout.** `/members/financial-reports` already has print-specific chrome (`print:hidden` on the picker/back-link, a dedicated `PrintStatementButton`) because board members print this for meetings. A new pending note/list needs to render sanely in print, not just on-screen — not addressed by the request.
- **Mobile at 360px.** Not addressed; existing tables already need to fit this width, and a new inline note/list adds vertical content that must not force horizontal scroll.
- **Brand consistency.** No destructive action is introduced (read-only report), so `<ConfirmDialog>` doesn't apply. A new "pending" marker/badge should follow the existing yellow-badge idiom already used on this exact page for `hasUncashedCheck`/encumbered amounts (`bg-yellow-50` / `text-yellow-700`, e.g. `admin/ledger/reports/page.tsx:152-159`) rather than inventing new color semantics — not addressed by the request but a cheap, obvious reuse.

## Out of Scope (confirm with user)

- Changing `isMonthGatedForEntity()` so a month with open pending items no longer gates as "ready" — not requested; flagged instead as an open question about whether the board-facing figure should be allowed to go stale (see Gaps).
- Extending pending-folding to `/members/impact` (philanthropy), `/admin/ledger/budgeting` (budget-vs-actual), or the 990/compliance determination on `/admin/ledger/reports` itself — all three are posted-only today and none were named in the request; recommend they stay posted-only unless the treasurer explicitly asks otherwise in a future request.
- A fully itemized (payee/purpose) list of pending transactions on the board-facing statement — recommend category + amount only by default, consistent with the existing data-exposure boundary, unless the treasurer confirms he wants payee-level detail visible to the board.
- Retroactively updating an already-shown historical month's total when a pending item inside it later resolves — recommend frozen-at-generation, footnoted if ever corrected, but this needs the treasurer's explicit answer (see Open Questions).

## Open Questions

- When you say "not yet posted," do you mean `status='pending'` specifically (over-threshold disbursements awaiting board approval — money not yet approved to spend), or do you also want posted-but-bank-uncleared amounts (`reconciled=false`, already shown today via the outstanding-check marker and book-vs-cash footnote) folded in too? These are different numbers with different governance weight, and the answer changes what gets built.
- On `/admin/ledger/reports`: should the Entity Totals block (Gross Receipts / Net / IRS Form) also fold in pending, or does it stay posted-only as a compliance-grade figure distinct from the FundCard's now-folded operating total? I recommend the latter — folding board-unapproved disbursements into a 990-adjacent determination is a materially bigger and riskier decision than folding them into an operating snapshot, and nothing in the original request asked for that.
- On `/members/financial-reports`: once a month publishes with pending items folded into its total, and one of those items later gets approved or rejected, should that historical month's figure update to match, or stay frozen as originally shown?
- For "note any transactions that have not posted yet" on the board-facing statement: is category + dollar amount (e.g., "Youth Programs — $450 pending board approval") sufficient, or do you want payee/purpose visible too? The statement's data layer deliberately excludes payee/memo from board view today; showing it would be a new, deliberate exception.
- Should this feature and the sibling budget-context feature (DECISION-069) share the identical `postedCents`/`pendingCents` field-labeling convention wherever a combined figure is computed? Recommended for consistency, but it constrains how Phase 3 names fields on both.

## The board-facing half, said plainly, once

I think folding board-unapproved disbursements into the headline "cash position" of a Statement of Financial Condition is a real degradation of what that document is for, and a bigger one than the bank-tie-out trade-off the treasurer was warned about. "Posted but the bank hasn't cleared it yet" still means the club has actually recorded the money as spent — the report already handles that safely today via a footnote, with no need to touch the headline number. "Pending" is a different claim: money the board has not yet voted to approve, that may be rejected outright. A Statement of Financial Condition that folds it in stops answering "what does the club have" and starts answering "what would the club have if every currently-proposed expense goes through as proposed" — a materially less certain statement to hand a board. That said, the treasurer was told this cost explicitly and chose it anyway; that's his call to make, not mine to overturn. Below is designed as the least-damaging faithful version of that choice: fold visually into one displayed number on both surfaces, but keep the posted subtotal mechanically recoverable in the payload (`postedCents`/`pendingCents`), itemize what's pending distinctly rather than burying it, and keep the 990/compliance figures on the admin page posted-only regardless of what the operating total does.

## Recommended Pipeline Mode

**Full** (matches this work-log's own front matter). This changes the meaning of a board-facing financial document, touches arithmetic shared with a compliance-grade figure on the same admin page, and has a real structural question (the gate/pending interaction) that Phase 2/3 must rule on explicitly rather than let an implementer infer. Do not compress to a bug-fix-style abbreviated pipeline.

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
