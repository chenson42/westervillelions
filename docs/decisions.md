# Decisions Log

Architectural and implementation decisions for the Westerville Lions Club website. Newest first. Each decision is numbered; the number does not change once assigned.

## Format

Each decision uses this shape:

```markdown
## DECISION-NNN: [One-line title]

**Status:** Resolved | Superseded by DECISION-MMM | Under review
**Date:** YYYY-MM-DD

**Decision:** [What we decided.]

**Rationale:** [Why we decided it — the tradeoff named out loud.]

**Impact:** [What changes in the codebase as a result; any follow-ups.]

---
```

- **Architectural decisions** (new top-level directories, new npm dependencies, structural changes) are owned by the architect agent.
- **Implementation decisions** (data shape, API surface, where logic lives, library choice within already-approved deps) are owned by the tech-lead agent.

Both kinds live in this single file, newest first. Numbers are assigned in order and never reused.

---

## DECISION-057: Budget Star & Notes — lazy-create upsert keeps `annualAmountCents` out of the conflict `SET`; star/note routed through two new endpoints that never call `assertBudgetUnlocked()`

**Status:** Resolved
**Date:** 2026-07-29

**Decision:** Add `starred boolean not null default false` + `note text` (nullable, no default) to
both `ledger_budgets` and `ledger_budget_lines` (`drizzle/migrations/0068_ledger_budget_star_notes.sql`).
Category-grain star/note writes go through a new `PATCH /api/admin/ledger/budgets/annotations`,
backed by `setBudgetCategoryAnnotation()`, whose lazy-create upsert puts `annualAmountCents: 0`
**only** in the insert `.values()` and builds the `onConflictDoUpdate` `set` clause
**conditionally** — `starred`/`note` are included only when the caller actually sent them, so a
star-only click never blanks an existing note and never touches an existing budgeted amount.
Cause-line-grain star/note writes go through a new sibling `PATCH
/api/admin/ledger/budgets/cause-lines/annotations`, backed by `setBudgetCauseLineAnnotation()` —
a plain conditional `UPDATE` against an existing row by `id`, no lazy-create (a cause line only
ever exists once actually created). **Neither new query function calls
`assertBudgetUnlocked()`, on purpose** — both route files carry a loud header comment stating the
omission is intentional (Phase 1 Decision 6: stars/notes stay editable even when the FY budget is
Approve-&-locked) and citing this decision, so a future "audit every write path for a missing lock
check" pass doesn't silently "fix" it.

**Rationale:** The lazy-create shape mirrors `upsertBudgetLine`'s existing insert/conflict pattern
closely enough that copying it verbatim (as `upsertBudgetLine` itself does, re-writing
`annualAmountCents` in both the insert and the conflict `set`) would be an easy, silent way to
zero out a real budgeted amount the first time someone stars an already-budgeted category — the
architect flagged this in Phase 2 as the single highest-risk implementation-correctness landmine
in this feature, so the exact Drizzle shape is spelled out here rather than left to be
independently re-derived. Routing star/note through two brand-new endpoints, rather than a third
body shape on either existing lock-gated PATCH dispatcher (`/budgets`, `/budgets/cause-lines`),
keeps a lock-gated and a deliberately-non-lock-gated write path from sharing one dispatch function
distinguished only by which body keys are present — exactly the shape that gets miscopied later.
Skipping `assertBudgetUnlocked()` at all is itself the first exception to an otherwise-universal
"every budget write path is lock-gated" invariant in this codebase; making that omission loud and
self-documenting at the call site is cheaper than relying on every future reader to already know
this work-log exists.

**Impact:** `src/lib/db/schema.ts` (`ledgerBudgets`/`ledgerBudgetLines` gain `starred`/`note`,
each with a doc comment pointing at this decision and at the Phase 1 Decision 9 admin-only
boundary); `drizzle/migrations/0068_ledger_budget_star_notes.sql`; `src/lib/ledger.ts`
(`MAX_BUDGET_NOTE_LENGTH = 500`); `src/lib/ledger-queries.ts` (`setBudgetCategoryAnnotation`,
`setBudgetCauseLineAnnotation`, `getFundReport`'s widened `FundReportCategoryLine`/`causeLines[]`);
two new route files under `src/app/api/admin/ledger/budgets/`. Full design in
`docs/work-log/2026-07-28-budget-star-notes.md` Phase 3.

---

## DECISION-056: Budgeting Page Restructure — `ledger_budget_lines.pending_delete_at` mirrors `ledger_budgets.pending_delete_at` exactly, one idempotent `ADD COLUMN`, no index/backfill

**Status:** Resolved
**Date:** 2026-07-29

**Decision:** Add `pendingDeleteAt: timestamp("pending_delete_at")` to `ledgerBudgetLines` in
`src/lib/db/schema.ts` — same nullable-timestamp shape, no default, as
`ledgerBudgets.pendingDeleteAt` (DECISION-052/053). One idempotent
`ALTER TABLE ledger_budget_lines ADD COLUMN IF NOT EXISTS pending_delete_at TIMESTAMP;` in
`drizzle/migrations/0067_ledger_budget_lines_pending_delete.sql`, matching
`0066_ledger_budgets_pending_delete.sql` verbatim in shape. No new index — the column is only
ever filtered alongside `budget_id`, already covered by `ix_ledger_budget_lines_budget`. No
backfill — every pre-existing row becomes `NULL` (not pending-delete), the correct default with
zero migration-time write.

**Rationale:** This is the schema half of Q1's resolution (Chris, 2026-07-29 — see
`docs/work-log/2026-07-29-budgeting-restructure.md`): category removal becomes uniformly
reversible-until-finalize regardless of breakdown state. Mirroring the existing column exactly,
rather than inventing a new shape, keeps `setBudgetCauseLinePendingDelete` a pure flag-flip with
the same "restore brings the number back exactly by construction" property the category-grain
function already has.

**Impact:** `src/lib/db/schema.ts`, `drizzle/migrations/0067_ledger_budget_lines_pending_delete.sql`.
Implementer: database-admin.

---

## DECISION-055: Budgeting Page Restructure — line-item removal becomes a `pendingDeleteAt` flag-flip, not a delayed hard `DELETE`; new cause-group route follows the `.../collapse` sibling-route precedent

**Status:** Resolved
**Date:** 2026-07-29

**Decision:** Three implementation calls closing Phase 3 for
`docs/work-log/2026-07-29-budgeting-restructure.md`, on top of the architect's Phase 2 rulings:

1. **Single line-item removal (Flow 4) becomes a `PATCH .../cause-lines { id, pendingDelete }`
   flag-flip, not a delayed hard `DELETE`.** The alternative reading — keep the existing `DELETE`
   handler as a true hard delete and just hold the client's call to it until the toast expires —
   was rejected because it would leave `ledger_budget_lines.pendingDeleteAt` (the column Q1 adds)
   with no interactive write path at all: category-level removal never cascades a write onto
   children (Ruling 4), so the single-line and cause-group removal flows are the *only* places
   that column is ever set. A flag-flip also gives line-item removal the same
   "recoverable-until-finalize via a persistent Restore control" property every other grain now
   has, which is the uniform mental model Q1 asked for — a delayed-but-still-hard delete would
   have made line items the one grain that's unrecoverable once the toast closes, an inconsistency
   the whole feature exists to remove.
2. **Cause-group cascade delete (Flow 5) gets its own sibling route,
   `PATCH /api/admin/ledger/budgets/cause-lines/group`**, rather than a fourth body-shape branch
   on the existing single-line PATCH. Its addressing shape (`fundId, fiscalYear, categoryId, flow,
   cause`) is structurally different from the single-line route's `{ id }` addressing, the same
   reasoning that already gave `.../cause-lines/collapse` its own file instead of folding into the
   main PATCH.
3. **The existing `DELETE /api/admin/ledger/budgets/cause-lines` handler is left in place,
   unused by the new UI, rather than deleted.** Removing dead code is a 30-day code-review
   candidate, not a Phase 4 side quest — deleting it now risks breaking a caller this design
   pass didn't find.

**Rationale:** Every write path this feature introduces reuses the existing PATCH-with-mutually-
exclusive-body-shape convention (DECISION-053 item 1) rather than forking new auth/lock-guard
sequences — the cost of a slightly bigger single-route dispatch is smaller than the cost of N
routes each re-deriving the same fund/category/lock lookups.

**Impact:** New `setBudgetCauseLinePendingDelete` and `setBudgetCauseGroupPendingDelete` in
`src/lib/ledger-queries.ts`; extended dispatch in
`src/app/api/admin/ledger/budgets/cause-lines/route.ts`; new
`src/app/api/admin/ledger/budgets/cause-lines/group/route.ts`. See the Phase 3 design doc in
`docs/work-log/2026-07-29-budgeting-restructure.md` for full request/response shapes.

---

## DECISION-054: Budgeting Page Restructure — blur/click race fixed with `onMouseDown` `preventDefault()`; `computeFundLineSums` gains a third cents-to-subtract parameter; one shared `isCauseLineLive` OR-predicate

**Status:** Resolved
**Date:** 2026-07-29

**Decision:** Two implementation calls closing Phase 3 for
`docs/work-log/2026-07-29-budgeting-restructure.md`:

1. **The blur-vs-click race (Gap 4) is fixed with `onMouseDown={(e) => e.preventDefault()}` on
   every add/remove/restore/collapse control** across `budget-editor.tsx` and
   `budget-cause-editor.tsx`, over the analyst's other two candidate directions. Rejected:
   guaranteeing "no remount ever happens" across every render path this feature touches (too
   fragile to future regression, no test would catch a re-break). Rejected: disabling every
   control during any in-flight commit anywhere on the page (fights the feature's own "reliable on
   the first click" goal by adding friction to non-racing sequences). Chosen: suppress the
   blur-triggered commit from ever queuing in the first place when the mousedown target is a
   control about to consume the click — this is the standard fix for this exact class of bug and
   needs no assumption about the rest of the tree's remount behavior.
2. **`computeFundLineSums` (`src/lib/ledger.ts`) gains a third parameter**,
   `causeLinePendingCents: Record<string, number>` (`${categoryId}_${flow}` → cents to subtract),
   defaulted to `{}` for backward compatibility. Needed because cause-line-grain pending-delete
   never touches the parent's `annualAmountCents` (architect Ruling 1) — without this third
   subtraction, the re-seeded `lineValues` a category's live total is built from would silently
   include a dead cause line's dollars after every `router.refresh()`, not just between
   keystrokes.
3. **One shared pure predicate, `isCauseLineLive(causeLinePendingDeleteAt, categoryPendingDeleteAt)`**,
   added to `src/lib/ledger.ts` and reused by the print worksheet's data assembly and the
   `causeLinePendingCents` seed function in `guided-budget-setup.tsx` — the architect's explicit
   ask that the print worksheet, live-totals helper, and finalize-purge not each reinvent slightly
   different exclusion logic.

**Rationale:** All three keep the existing Vitest-seam discipline (pure functions, no DB access)
this feature area already established, and none require a new dependency.

**Impact:** `src/lib/ledger.ts` (`computeFundLineSums` signature change, new `isCauseLineLive`
export); `src/components/admin/ledger/budget-editor.tsx` and `budget-cause-editor.tsx` (new
`onMouseDown` handlers); `src/components/admin/ledger/guided-budget-setup.tsx` (new
`causeLinePendingCents` state, seeded/re-synced alongside the existing `lineValues`/
`pendingDeleteKeys` pair). See the Phase 3 design doc for full detail.

---

## DECISION-053: Budget soft-delete (Increment 2) — one PATCH route with a mutually-exclusive body shape, a shared pure client decision function, string-typed `pendingDeleteAt`, and print excludes pending-delete lines

**Status:** Resolved
**Date:** 2026-07-28

**Decision:** Five implementation calls closing Phase 3 for `docs/work-log/2026-07-28-budgeting-page-redesign.md` Increment 2, on top of DECISION-052's rulings:

1. **One route, one mutually-exclusive body shape — no new route.** `PATCH /api/admin/ledger/budgets` gains a second, mutually-exclusive request shape: `{ fundId, fiscalYear, categoryId, flow, pendingDelete: boolean }` alongside the existing `{ ..., annualAmountCents: number | null }`. A request carrying both `annualAmountCents` and `pendingDelete` is a 400. This keeps one endpoint, one auth check, one 409-shape for the lock race — consistent with `upsertBudgetLine`'s own "one shared core" precedent — rather than forking a second route that would duplicate the fund/category/lock/cause-line-children guard sequence.
2. **The new write path 404s when no row exists, for both directions.** `setBudgetLinePendingDelete` (sibling to `upsertBudgetLine`) requires an existing `(fundId, fiscalYear, categoryId, flow)` row and returns 404 if none is found — it never silently creates one. The client-side "genuinely-never-saved blank is a no-op" rule (DECISION-052 item 2) means the UI should never actually trigger this 404 in normal use; it exists purely as defense-in-depth against a stale-tab race (e.g., someone else deleted the category concurrently), matching this codebase's existing posture of not trusting client-side gates alone.
3. **A shared pure decision function, `resolveBudgetLineDeleteAction(hasExistingRow, rawValue)`, lives in `src/lib/ledger.ts` and is unit-tested directly** rather than leaving the blank-vs-no-op branch as inline logic inside `budget-editor.tsx`'s event handlers. This is the one piece of Increment 2's client logic that has no natural place in a Vitest suite otherwise (everything else routes through server functions), and the codebase already has precedent for pulling UI-decision logic into pure, tested helpers in `ledger.ts` (`isBudgetLocked`, `computeBudgetBalanceStatus`, `formatBudgetReferenceCents`).
4. **`pendingDeleteAt` is serialized to an ISO string (or `null`) at the `getFundReport` boundary, not passed as a raw `Date`.** Matches the existing convention at this exact Server-Component-to-Client-Component boundary (`budgeting/page.tsx`'s `formatApprovalDate` already converts `LedgerBudgetApproval`'s `Date` fields to strings/labels before handing them to `GuidedBudgetSetup`) rather than introducing a new pattern of passing `Date` objects across that boundary.
5. **The print worksheet (`budget-print-worksheet.tsx`) excludes pending-delete lines entirely** rather than printing them with a "deleted" annotation. A worksheet exists to plan and hand-annotate the budget that will actually take effect; a line already marked for removal isn't part of that forward-looking plan, and Increment 1's worksheet is a static, forward-looking snapshot by design (Phase 1: "render the current value as static text"). `GuidedBudgetSetup` (the interactive, on-screen view) still renders pending-delete rows with the strikethrough/Restore treatment — only the print path filters them out.

**Rationale:** Every one of these keeps the "one code path per concern" shape DECISION-052 already established for this increment: one route instead of two, one server-side existence check instead of a special no-op response, one pure function instead of scattered inline branches, one boundary-serialization convention instead of a new one, and one clear answer (exclude) to the print-worksheet question the tech-lead brief itself flagged as needing confirmation rather than silent invention.

**Impact:** `src/app/api/admin/ledger/budgets/route.ts` (branch on `pendingDelete` vs `annualAmountCents`, 400 on both/neither), `src/lib/ledger-queries.ts` (`setBudgetLinePendingDelete`, `getBudgetApproval` gains an optional `tx` param, `getFundReport`'s `FundReportCategoryLine.pendingDeleteAt: string | null`), `src/lib/ledger.ts` (`resolveBudgetLineDeleteAction`), `src/components/admin/ledger/budget-editor.tsx` / `guided-budget-setup.tsx` (shared decision function wired into both gestures, `pendingDeleteKeys` client state for the instant `fundSums()` exclusion, Approve dialog's `pendingDeleteCount` + conditional `destructive`), `src/components/admin/ledger/budget-print-worksheet.tsx` (filter pending-delete lines out of every `FlowTable`). Full API contract and named unit tests in the Phase 3 section of the work-log.

---

## DECISION-052: Budget soft-delete (Increment 2) — client-side running-total exclusion, not a `getFundReport` filter; blank-input and trash-icon unified onto one soft-delete path

**Status:** Resolved
**Date:** 2026-07-28

**Decision:** Two rulings closing Phase 2 for `docs/work-log/2026-07-28-budgeting-page-redesign.md` Increment 2 (soft-delete/restore-until-finalize on `ledger_budgets`, category/flow grain):

1. **The live "excluded from the running total" behavior is a client-side projection inside `guided-budget-setup.tsx`'s `fundSums()`, not a filter inside `getFundReport()`.** `getFundReport()`'s aggregate totals (`totalIncomeCents`/`totalExpenseCents`/`endingCents`) are already computed from posted actual transactions, never from summed `budgetCents` — there is no fund-level budget aggregate inside that function to filter in the first place. The live balance badge the treasurer sees while editing is computed entirely client-side from local `lineValues` state. `getFundReport` gains one new optional, purely informational field (`pendingDeleteAt` per category line, sourced off the row set it already fetches) but its `budgetCents`/`variance`/totals stay computed from the full, committed row set unchanged — because `getFundReport`'s budget figures also feed the admin fund-report page and, via `financial-report-queries.ts`, the **member-facing** Monthly Statement, both of which must keep showing the committed budget until finalize actually happens. Filtering `getFundReport` globally would leak an uncommitted, mid-session edit onto a member's own statement before the treasurer ever clicks Approve & lock — a direct violation of "only on finalize does the deletion take effect."
2. **Blanking a budget input and clicking the trash icon must be unified onto the same soft-delete write path for any already-persisted row; only a genuinely-never-saved row still gets a true no-op.** Today both gestures call `PATCH { annualAmountCents: null }`, which hard-deletes unconditionally. Leaving blank-input-then-blur/Enter on that path while only decorating the trash icon would leave the more accident-prone gesture (a stray backspace) exactly as dangerous as before soft-delete existed — shipping a feature that doesn't fix the problem it exists to fix. The new write path (a sibling function next to `upsertBudgetLine`, running the identical fund/category/lock/cause-line-children guard sequence) only flips `pending_delete_at`, never touches `annualAmountCents` — this is what makes "restore brings the number back" true by construction rather than by special-casing.

**Rationale:** Both rulings protect the same invariant from two different angles — soft-delete must be reversible-until-finalize in fact, not just in the one UI affordance that got a redesign. Filtering `getFundReport` would make the reversibility fiction leak to members; leaving blank-input wired to hard-delete would make it a fiction for the treasurer's own most common gesture.

**Impact:** `src/lib/db/schema.ts` — `ledgerBudgets` gains nullable `pendingDeleteAt` (migration `0066_ledger_budgets_pending_delete.sql`, `ADD COLUMN IF NOT EXISTS`, no index). `src/lib/ledger-queries.ts` — `getFundReport`'s `FundReportCategoryLine` gains optional `pendingDeleteAt`; new sibling write function alongside `upsertBudgetLine`; `POST /api/admin/ledger/budget-approvals` gains a `db.transaction()` wrapper purging `pending_delete_at IS NOT NULL` rows atomically with the lock write. `src/components/admin/ledger/budget-editor.tsx`/`guided-budget-setup.tsx` — remove-line `ConfirmDialog` dropped (removal is reversible now), both delete gestures rewired to the new path, `fundSums()` excludes pending-delete lines live. Full detail in the Increment 2 Phase 2 section of the work-log.

---

## DECISION-051: Batch reconciliation — array-only match body (no back-compat shim), new session-scoped match-detail query, `asOf`-anchored 12-day in-transit-deposit window

**Status:** Resolved
**Date:** 2026-07-28

**Decision:** Four implementation calls closing Phase 3 for `docs/work-log/2026-07-28-zeffy-batch-reconciliation.md`, on top of DECISION-036's schema ruling and the architect's Phase 2 seams:

1. **`POST .../match`'s request body drops the singular `transactionId` entirely in favor of `transactionIds: string[]` (array-only, min length 1) — no back-compat alias.** This route has exactly one caller in the codebase (`reconciliation-match-picker.tsx`), rewritten in this same feature; there is no external consumer to break. A 1-element array is the degenerate single-match case, so there is only ever one code path to maintain, per the architect's Phase 2 recommendation.
2. **A new read helper, `getMatchedTransactionsForSession()`, joins `ledger_reconciliation_matches` → `ledger_transactions` (one query, whole session, no N+1)** rather than trying to make `getBankLinesForSession()`'s `matchedTransactionIds: string[]` carry enough information to render Flow 2's expandable per-transaction list. `candidateTransactions` deliberately excludes already-matched rows, so nothing else in the existing data already supplied date/party/amount for a matched transaction plus the specific `matchId` its Unmatch button needs — inventing that shape as a second query, grouped client-side by `bankLineId`, keeps `BankLineWithMatch` itself simple (just the id array named in the binding decision) rather than overloading one type with two different UI needs.
3. **The month-gate carve-out window is 12 days, anchored to `asOf` (today), not `monthEnd`.** Justified from the verified 2026-07-28 case (rows dated 6/24-6/25 cleared the bank 6/29, a 4-5 day lag) plus Zeffy's ~7-day remittance cycle, rounded up with margin. Anchoring to `asOf` (mirroring `hasMonthElapsed()`'s existing injectable-`asOf`, local-getter pattern in the same file) is not a preference but a correctness requirement the architect flagged explicitly (§5): a `monthEnd`-relative window would exclude a forgotten, never-remitted batch forever as real time passes, which fails the treasurer's stated requirement that a long-stale batch must still flag. The carve-out is threaded through **both** `isMonthGatedForEntity()` and `getLatestOpenMonthForEntity()`'s own `blockingDates` filter — omitting the second would reintroduce the exact candidate-picker-truncation bug already fixed once for outstanding checks.
4. **Correcting a wrong pick inside a committed batch is "unmatch every row down to zero, then re-pick the full corrected set," not "add the missing row back in isolation."** The existing "bank line already has a match → 409" gate in `match/route.ts` stays unchanged (architect §4: a line is matched once, as a complete set) — a partial per-row unmatch leaves the line "claimed" and unable to accept a new POST until every remaining match on it is also removed. Accepted as bounded v1 friction per the binding decision (per-row-only unmatch); a fast-follow that relaxes the gate to "reject only when the line is already balanced" is named as a reversible follow-up if real usage makes this painful.

**Rationale:** All four favor the shape that keeps exactly one code path per concern (one match-body shape, one query per new UI need, one gate-relaxation rule) over a shape that would require either a second request format, an overloaded read type, or an unbounded month-gate exclusion that could hide a broken sync indefinitely.

**Impact:** `src/lib/reconciliation-queries.ts` (`getTieOutAssembly`/`getBankLinesForSession` fan-out fix + `BankLineWithMatch.matchedTransactionIds: string[]`, new `getMatchedTransactionsForSession`/`MatchedTransactionRow`), `src/app/api/admin/ledger/reconciliation/sessions/[sessionId]/match/route.ts` (batch body + 9-step validation + atomic insert), `src/lib/financial-report-queries.ts` (`isInTransitZeffyDepositRow`, `daysBetween`, `asOf` threaded through `isMonthGatedForEntity`/`getLatestOpenMonthForEntity`), `src/components/admin/ledger/reconciliation-match-picker.tsx` (multi-select + running-sum + Zeffy filter chip), `src/components/admin/ledger/reconciliation-matching-grid.tsx` (expandable "Matched · N" + per-row unmatch), `src/components/admin/ledger/guide/reconciliation-section.tsx` §10. Full API contract, query rewrites, and the nine named unit tests are in the Phase 3 section of the work-log.

---

## DECISION-050: Monthly Financial Statement — exclude Quicken-imported rows from One-Month cash bucketing; no fund-picker route segment; Annual-Budget-column balance rows cut from v1

**Status:** Resolved
**Date:** 2026-07-28

**Decision:** Three implementation calls closing Phase 3 for `docs/work-log/2026-07-28-monthly-financial-report.md`, on top of DECISION-049's placement ruling:

1. **`computeOneMonthCashActuals()`'s `reconciledAt` fallback excludes Quicken-imported rows rather than mis-bucketing them.** `scripts/import-quicken-ledger.ts` sets `reconciledAt: t.reconciled ? new Date() : null` — every historical reconciled row's `reconciledAt` is the 2026-07-20 import run's timestamp, not a real bank-clear date. Phase 1/2's "fall back to `reconciledAt` for legacy rows" language, read literally, would bucket roughly a year's worth of historical transactions into whichever single calendar month the import happened to land in — a silent, materially wrong number on a feature whose entire premise is "these numbers must never look wrong." The importer already tags every row it writes with a `[quicken-import]` marker in `memo` (`buildMemo()`); the query layer checks for that literal marker (colocated as its own constant in `financial-report-queries.ts`, not imported from `scripts/` — one-off scripts aren't meant to be an app dependency) and excludes matching rows from the One-Month column entirely, surfacing `hasUndatedHistoricalRows` in the footer. These rows are unaffected in the Twelve-Month/Budget columns (txnDate/posted-basis via `getFundReport()`, untouched by this problem). Only true legacy per-row-toggle rows (a human's real-time click, no import marker) use the `reconciledAt`-date fallback as originally recommended.
2. **The `[entitySlug]/[month]` route has no fund segment.** The seed migration (`0044_ledger_books.sql`) creates exactly one fund per (entity, exposed-kind) — `club`/`administrative`, `foundation`/`charitable` — so "which fund" is fully determined by `entitySlug` today; a fund-picker would be a UI control with only one possible choice. `getMonthlyStatement()` still takes a resolved `LedgerFund` and re-checks its `kind` against the allowlist (architect's ruling), so this stays correct if a second exposed-kind is ever seeded — the route just doesn't expose a control for a choice that doesn't exist yet.
3. **The reference reports' Annual-Budget-column "Beginning fund balance"/"Ending fund balance" rows are cut from v1** (rendered as "—"). Checking the actual PDF numbers against `getFundReport()`'s rollforward math confirms this figure isn't derivable from anything in this schema — it's a separate, hand-tracked estimate the prior treasurer kept outside the books software (the Foundation PDF's Budget-column beginning, $29,569.30, matches neither the Twelve-Month column's beginning, $20,000.28, nor any value the rolled-forward-opening logic can produce). Building it would mean inventing a new persisted "budgeted beginning balance" input with no authoring UI in scope — the same class of problem Phase 1 already deferred for per-line notes. Reversible scope cut, not a technical wall; flagged to the user for sign-off alongside the divergence-footnote wording, not blocking Phase 4.

**Rationale:** All three favor catching a real, high-stakes correctness gap (item 1) and not inventing new persisted inputs with no authoring surface (items 2's non-issue and item 3) over reproducing the reference layout at the cost of either wrong numbers or undisclosed scope creep.

**Impact:** `src/lib/financial-report-queries.ts` (`computeOneMonthCashActuals`'s three-tier fallback, `hasUndatedHistoricalRows` flag), `src/app/members/financial-reports/[entitySlug]/[month]/page.tsx` (no fund route segment), `src/components/members/monthly-statement-table.tsx` (Annual Budget column renders "—" on the two balance rows). Full contract in the Phase 3 section of the work-log.

---

## DECISION-049: Monthly Financial Statement — new `financial-report-queries.ts` sibling module; extend `getFundReport()` with an `asOfDate` bound instead of duplicating its rollforward math

**Status:** Resolved
**Date:** 2026-07-28

**Decision:** Phase 2 architectural ruling for `docs/work-log/2026-07-28-monthly-financial-report.md`. Two placement calls:

1. **`getFundReport(fundId, fiscalYear)` gains an optional third argument, `opts?: { asOfDate?: string }`**, narrowing the upper bound of its transaction query from "FY end" to `min(fyEnd, asOfDate+1 day)`. The FYTD-actuals, budget-variance, and rolled-forward book-balance figures the monthly statement needs are the *same figures* `getFundReport()` already computes for the admin Ledger — reimplementing that rollforward/budget/cause-line logic in a new function would create a second, independently-maintained path to numbers that must never disagree with what the admin sees. `asOfDate` is additive and optional; every existing call site (the admin fund-report page, budget editor) is unaffected because it's undefined there.
2. **A new sibling module, `src/lib/financial-report-queries.ts`**, holds everything that is genuinely new: the bank-cleared-date "One-Month" column (joining `ledgerTransactions` → `ledgerReconciliationMatches` → `ledgerBankLines.postingDate`, with the `reconciledAt`-fallback for legacy-toggled rows), the transaction-level reconciliation gate (generalizing `getOverview()`'s `unreconciledPriorMonth` predicate to an arbitrary month boundary instead of "today"), the divergence footnote between book balance and one-month cash net, and the member-exposed-fund allowlist (`fund.kind IN ('administrative','charitable')`). This mirrors the precedent already set by `reconciliation-queries.ts` being split from `ledger-queries.ts` (same file's own header cites that split as "a distinct feature surface built on top of the existing ledger_transactions table, not a rework of it") — the monthly statement is likewise a distinct read surface composing the existing engine, not a rework of it.

**Rationale:** The single most load-bearing risk this feature carries (per Phase 1) is member-visible numbers silently drifting from the admin Ledger's numbers. Keeping exactly one function responsible for "what does the book say FYTD/ending balance is" — extended, not forked — forecloses that risk at the architecture level rather than relying on discipline at the query-writing level. The bank-cleared-date lens has no existing home to extend (nothing in `ledger-queries.ts` today buckets by `postingDate`), so it gets a new file rather than being wedged into `getFundReport()` as an unrelated third concern.

**Impact:** `src/lib/ledger-queries.ts` — `getFundReport()` signature gains `opts?: { asOfDate?: string }` (additive, backward-compatible). New file `src/lib/financial-report-queries.ts` — exports a single entry point (name TBD by tech-lead, e.g. `getMonthlyStatement(fundId, year, month)`) returning a discriminated union (`{ status: 'gated' } | { status: 'ready', statement: ... }`) so "not yet reconciled" and "reconciled, zero activity" never collapse into the same shape. New route `src/app/members/financial-reports/...` (Server Components) and `src/components/members/` additions consume only this module's aggregated return type — never raw `ledgerTransactions` rows.

---

## DECISION-048: Labeled cause budget lines — API contract closing Phase 3 (id-dispatch on one route, no in-place cause change, insert-not-upsert on create, entity-scoped label autocomplete)

**Status:** Resolved
**Date:** 2026-07-28

**Decision:** Four implementation calls closing Phase 3 for `docs/work-log/2026-07-28-ledger-labeled-cause-lines.md`, left open by DECISION-047 ("exact HTTP verbs, request/response shapes, and the duplicate-`(cause,label)` error contract are tech-lead's call"):

1. **One route, dispatched by the presence of `id`, not a new endpoint.** `PATCH /api/admin/ledger/budgets/cause-lines` still handles both "create the first/next line" (no `id` in the body) and "edit an existing line's amount and/or label" (`id` present) — matching B-17's existing route-count discipline (DECISION-046) rather than adding a third route for what is, from the client's perspective, one form submitting either an add or a save.
2. **Cause is fixed at creation; there is no in-place cause change in this increment.** Phase 1 named exactly one edit verb for existing lines (label) and the binding decision's own wording scopes the single-`UPDATE` retirement of the delete+recreate hack to "edit-amount + edit-label" — not cause. Moving a line to a different cause is DELETE the old line + CREATE a new one, two calls that already exist, rather than a third mutable field on `UPDATE`. This narrows what B-17's shipped UI technically allowed (every committed row had a live cause `<select>`) — flagged explicitly to the user in the Phase 3 doc as a reversible scope cut, not a hard technical constraint, since adding `cause` as an optional third `UPDATE` field later is mechanically trivial (same collision-check codepath).
3. **`createBudgetCauseLine` is a plain `INSERT` with a pre-check, not `onConflictDoUpdate`.** B-17's shipped upsert silently merged a same-cause write into the existing row; under the new model that exact mechanism would silently merge two *distinct, differently-labeled* lines the moment a duplicate `(cause, label)` was submitted — precisely the failure this increment exists to prevent (architect's Phase 2 ruling, DECISION-047 item 3). A `SELECT`-then-`INSERT` gives a clean `409 duplicate_cause_label` in the common case; the `UNIQUE(budget_id, cause, label)` constraint is race-condition defense-in-depth, caught and mapped to the identical response. Seeding keeps upsert semantics (renamed to `upsertBudgetCauseLineForSeed`, hardcoded `label: ''`) since re-running "seed from last year" must still update an existing generic line, not 409 against itself.
4. **The `<datalist>` autocomplete source is scoped to the entity, not the single fund being edited.** `getBudgetCauseLineLabels(entityId)` joins `ledger_budget_lines → ledger_budgets → ledger_funds` and filters on `entity_id`, read once per page load and shared across every `BudgetEditor` instance on that page (both `budgeting/page.tsx`, which renders all of an entity's funds at once, and `[fundSlug]/report/page.tsx`, which renders one). A label used under a sibling fund in the same entity (e.g. Foundation's charitable fund and its scholarship fund) is a reasonable suggestion even for the fund currently being edited — it's an optional autocomplete hint, not a constraint, so an irrelevant suggestion is harmless where a missed one would undermine the whole point of offering consistency across entries.

**Rationale:** All four favor the smallest new surface that satisfies DECISION-047's binding shape (id-keyed writes, `NOT NULL DEFAULT ''` label, one blank per cause) over inventing new endpoints, new mutable fields, or a narrower autocomplete scope that Phase 1's own Gap 8 ("WARM" vs "W.A.R.M." vs "Warm Inc" drifting *across categories or fiscal years*) already argued against.

**Impact:** `src/lib/ledger-queries.ts` (`upsertBudgetCauseLine` split into `createBudgetCauseLine`/`updateBudgetCauseLine`, `deleteBudgetCauseLine` re-keyed to `id`, the former upsert renamed `upsertBudgetCauseLineForSeed` and its conflict target widened to three columns, new `getBudgetCauseLineLabels`), `src/app/api/admin/ledger/budgets/cause-lines/route.ts` (id-dispatch, `reason` now on the wire), `src/app/api/admin/ledger/budgets/seed/route.ts` (one-line call-site rename), `src/components/admin/ledger/budget-cause-editor.tsx` (cause `<select>` only on never-saved rows; grouped-by-cause display for committed ones). Full request/response shapes and the ten named unit tests are in the Phase 3 section of the work-log.

---

## DECISION-047: Labeled cause budget lines — `label` column shape, constraint swap on a populated table, id-keyed write model

**Status:** Resolved
**Date:** 2026-07-28

**Decision:** Three structural calls closing Phase 2 for `docs/work-log/2026-07-28-ledger-labeled-cause-lines.md` (B-17 follow-up, relaxing DECISION-045's `(budgetId, cause)` uniqueness to allow multiple labeled lines per cause):

1. **`label` is `TEXT NOT NULL DEFAULT ''`, not nullable.** The binding functional rule (Chris, 2026-07-28) is "one blank label per cause, plus any number of distinctly-labeled lines" — that requires blank to be a real, collidable value. Postgres unique constraints treat `NULL <> NULL`, so a nullable `label` column under a plain `UNIQUE(budget_id, cause, label)` constraint would silently *allow* unlimited blank-label duplicates per cause — exactly the case that must be blocked. `NOT NULL DEFAULT ''` makes blank an ordinary string that collides with itself, so the existing v1.40.0 rows (which get backfilled to `label = ''` by the same `ADD COLUMN ... DEFAULT ''` statement, metadata-only under Postgres's fast-default path) become each cause's one legitimate "generic" line without any explicit backfill loop.
2. **Uniqueness is a plain composite constraint, `UNIQUE(budget_id, cause, label)` — no partial or expression index.** Because `label` can never be `NULL` under Item 1, a `COALESCE(label, '')`-based partial/expression unique index would be solving a problem that no longer exists; it adds a second, less-obvious mechanism for zero benefit over the plain constraint. The migration swaps the existing `ledger_budget_lines_budget_cause_key` (on `(budget_id, cause)`) for a new `ledger_budget_lines_budget_cause_label_key` (on `(budget_id, cause, label)`). Order of operations, all idempotent so the migration is safe to replay on every deploy: (a) `ALTER TABLE ... ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT ''` — must run first, since the new constraint references the column; (b) drop the old constraint guarded by `IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ...)`; (c) add the new constraint guarded by the equivalent `IF NOT EXISTS` check. This is safe against the live populated table (both dev and production carry v1.40.0 rows) because the *old* constraint was actively enforced the entire time those rows were written — no two existing rows share `(budget_id, cause)`, so they trivially satisfy the new, stricter `(budget_id, cause, label='')` constraint too; the swap cannot produce a duplicate-key error against existing data.
3. **Row identity moves from `(budgetId, cause)` to the line's own `id` for every write.** `upsertBudgetCauseLine`'s cause-keyed `onConflictDoUpdate` and `deleteBudgetCauseLine`'s cause-keyed lookup both stop being viable the moment a cause can have more than one row — cause is no longer sufficient to address a specific line. Create (no id yet) stays close to today's shape (resolve/create the parent `ledger_budgets` row, then insert the child, validating the new `(cause, label)` uniqueness server-side as a 409/400 rather than relying on `onConflictDoUpdate` to silently merge two distinct lines). Edit-amount and edit-label both become a single `UPDATE ledger_budget_lines SET ... WHERE id = $1` — no more delete-then-recreate, which retires the narrow "line transiently gone" failure window `budget-cause-editor.tsx`'s cause-rename path carried in B-17 Increment A. Delete becomes `DELETE ... WHERE id = $1`. All three still resolve the parent's `entityId`/`fiscalYear` via a join back to `ledgerBudgets` for `assertBudgetUnlocked()` — the lock check is unaffected in substance, only in how the row is found first.

**Rationale:** All three favor the shape that is correct by construction over a shape that requires the write path to remember an extra rule. A `NOT NULL DEFAULT ''` column plus a plain composite unique constraint enforces "one blank per cause" at the database level with no special-cased query logic; an id-keyed write model matches the row's actual identity now that two rows can share every other field, and eliminates a known, previously-disclosed class of bug (delete+recreate as a stand-in for rename) rather than doubling that risk onto a second editable field (label).

**Impact:** `src/lib/db/schema.ts` (`ledgerBudgetLines`: new `label` column, constraint renamed to `ledger_budget_lines_budget_cause_label_key` on `(budgetId, cause, label)`), a new idempotent migration under `drizzle/migrations/` (next number after `0063_ledger_budget_lines.sql`), `src/lib/ledger-queries.ts` (`upsertBudgetCauseLine`/`deleteBudgetCauseLine` split into id-keyed create/update/delete operations), `src/app/api/admin/ledger/budgets/cause-lines/route.ts` (request/response shapes gain `id` and `label`), `src/components/admin/ledger/budget-cause-editor.tsx` (rows keyed by `id` once committed; cause-rename-via-delete+PATCH path removed in favor of in-place label/amount edits). Exact HTTP verbs, request/response shapes, and the duplicate-`(cause,label)` error contract are tech-lead's call in Phase 3.

---

## DECISION-046: Cause-tagged budget line items — API surface (no "enter breakdown" endpoint; a dedicated collapse endpoint; seed extension is additive; category eligibility predicate)

**Status:** Resolved
**Date:** 2026-07-27

**Decision:** Four implementation calls closing the Phase 3 design for `docs/work-log/2026-07-27-ledger-cause-budget-lines.md` (B-17 Increment A), left open by DECISION-045's schema/taxonomy ruling:

1. **Entering breakdown mode has no dedicated server endpoint.** The generic `PATCH /api/admin/ledger/budgets/cause-lines` upsert route doubles as the entry point for a category's first cause line. "Preserving the existing lump-sum amount as one `Other community support` line" (Human Answer 4) is a **client-side pre-fill**: clicking "Break down by cause" flips local component state to show one row pre-filled with `cause: OTHER_COMMUNITY_SUPPORT_CAUSE` and `amountCents` = the category's current lump-sum value, and nothing is written until that row commits via the normal blur/Enter pattern. Rejected alternative: a dedicated `POST .../cause-lines/enter-breakdown` endpoint that reads the current lump sum server-side and writes the first line atomically — this would be more "transactionally honest" (no window where the UI shows a pending conversion that hasn't saved), but it's a second endpoint and a second code path for behavior the existing `BudgetEditor` UX (nothing saves until blur/Enter, same as every other row in this editor) already covers correctly. If real usage shows treasurers losing the pre-filled row by navigating away, revisit.
2. **Collapsing breakdown → lump-sum (`POST .../cause-lines/collapse`) does not recompute the parent total — it deletes the children and leaves `ledger_budgets.annualAmountCents` untouched.** This works *because* every prior write already maintains "parent total = sum of children" as a standing invariant, so the parent's stored number is already correct the instant before collapse. No separate summing step is needed or safer than trusting the invariant.
3. **`POST /api/admin/ledger/budgets/seed` is extended additively (`seedCauseLines?: boolean`, default `false`), not split into a second route.** Cause-line seeding reuses the exact same `db.transaction()` as the existing category-level seed loop — a lock rejection partway through must roll back both lump-sum and cause-line writes atomically via the existing `SeedLockedError` pattern, which only holds if they share one transaction.
4. **Category eligibility for showing the "Break down by cause" affordance is `flow === "expense" && categoryCountsAsGiving === true`** (fund-kind eligibility is implicit — `BudgetEditor` only ever renders one fund's categories). This extends Phase 1 Gap 2's picker-level exclusion of the "Fundraising event costs" *cause value* to the category level too: a category already flagged `countsAsGiving = false` (ops, insurance, fundraising overhead — DECISION-030) has no giving-cause story to tell, so it shouldn't offer the picker at all. This is a functional extension beyond what Phase 1/2 explicitly ruled on, not a re-litigation of either — flagged in the Phase 3 doc so it's visible and reversible (one predicate change) if the user wants breakdown offered more broadly.

**Rationale:** All four favor the smallest number of new endpoints/branches that still satisfy the bound Phase 1/2 requirements, reusing `BudgetEditor`'s existing "nothing saves until commit" UX and the seed route's existing single-transaction/rollback pattern rather than inventing parallel ones.

**Impact:** `src/app/api/admin/ledger/budgets/cause-lines/route.ts` (new, PATCH + DELETE), `src/app/api/admin/ledger/budgets/cause-lines/collapse/route.ts` (new, POST), `src/app/api/admin/ledger/budgets/seed/route.ts` (extended), `src/lib/ledger-queries.ts` (`upsertBudgetCauseLine`, `deleteBudgetCauseLine`, `collapseBudgetCauseLines`, `computeCauseSeedForCategory`), `src/components/admin/ledger/budget-editor.tsx` and the new `budget-cause-editor.tsx`. Full request/response shapes and the unit-test list are in the Phase 3 section of the work-log.

---

## DECISION-045: Cause-tagged budget line items — taxonomy promoted to `src/lib/ledger.ts`, `ledger_budget_lines` child table over a nullable-cause column

**Status:** Resolved
**Date:** 2026-07-27

**Decision:** Two structural calls closing Phase 2 for `docs/work-log/2026-07-27-ledger-cause-budget-lines.md` (B-17 Increment A), left open by Phase 1 (analyst Gap 3, Gap 4):

1. **The cause taxonomy's runtime home is `src/lib/ledger.ts`**, as a new exported const array (the 9-value list minus `"Fundraising event costs"`, i.e. 8 real causes) plus the literal `"Other community support"` re-exported from the same module — not re-typed — so it round-trips exactly with `bucketGivingByCause()`'s existing null-cause label. `ledger.ts` has zero imports today (pure functions, no DB access) and is already the home for every other cross-cutting Ledger pure helper (`validateBudgetLineInput`, `isBudgetLocked`, `deriveSeedLinesForFund`, `bucketGivingByCause`) — it is both server- and client-importable, which a cause picker component and a server-side 400-rejection check both need from the same source. A validator (`isValidBudgetCause` or equivalent) ships alongside it, mirroring `validateBudgetLineInput`'s pattern. `scripts/import-quicken-ledger.ts`'s `deriveCause()` keeps its own matching *rules* (payee/memo/category → cause) but should import the *value* consts from `ledger.ts` in Phase 4 rather than maintaining a second private copy of the same strings — one taxonomy, not two that must be kept in sync by convention. B-18 (structured cause on transactions/reimbursements) reuses this exact same const and validator; no second re-home.
2. **Schema shape: a `ledger_budget_lines` child table, FK'd to `ledger_budgets.id`** (cascade delete), not a nullable `cause` column added to `ledger_budgets` itself. Recommended shape: the existing `ledger_budgets` row stays the rolled-up total for its `(fundId, fiscalYear, categoryId, flow)` tuple — read by every existing consumer (`getFundReport`, `budgetVariance`, guided-budgeting seed) completely unmodified — while `ledger_budget_lines` rows hold the cause-level detail. Any write to a category's cause lines is one transaction that upserts/deletes the child rows *and* recomputes `ledger_budgets.annualAmountCents` as their sum, funneled through the existing `upsertBudgetLine()`/`assertBudgetUnlocked()` core (or a sibling that shares its transaction and lock check) — not a second, independent enforcement point. "Breakdown mode" is not a separate boolean; it is simply "this budget row has 1+ child rows." Emptying a category to zero cause lines deletes the parent `ledger_budgets` row too, mirroring today's existing `annualAmountCents: null` → delete-the-row behavior exactly, so "no target set" only ever has one representation regardless of which mode produced it. Uniqueness: `(budgetId, cause)` on the child table — sufficient to satisfy "one line item per (cause, category, FY, flow)" because `budgetId` already uniquely identifies that tuple via `ledger_budgets_fund_year_cat_flow_key`. `cause` stays free `text`, validated at the app layer against the Item 1 taxonomy — no DB CHECK/enum, consistent with DECISION-041's precedent for this codebase's other app-layer-enforced text fields (`ledger_transactions.status`, `beneficiary_cause` itself).

**Rationale:** The child-table shape structurally prevents the lump-sum/breakdown ambiguity Phase 1 Flow 3 flagged (a single row can never simultaneously mean "the one target" and "one of several targets" for the same tuple), and keeping `ledger_budgets.annualAmountCents` as an always-current rolled-up cache means zero changes are required to any existing report/variance/seed read path in this increment — the blast radius stays contained to the new write path and the new UI, not every consumer of budget totals. The taxonomy's home in `ledger.ts` follows the file's own established convention (every other shared, pure, cross-cutting Ledger helper already lives there) rather than inventing a new module for a single const array.

**Impact:** `src/lib/db/schema.ts` (new `ledgerBudgetLines` table, added before its matching migration), a new idempotent migration under `drizzle/migrations/`, `src/lib/ledger.ts` (taxonomy const + validator), `src/lib/ledger-queries.ts` (new write/read functions alongside `upsertBudgetLine`/`assertBudgetUnlocked`), `scripts/import-quicken-ledger.ts` (Phase 4 refactor to import the shared consts instead of its own private copies). Full DDL, function signatures, and API contract are tech-lead's call in Phase 3 — this decision fixes the shape, not the column list.

---

## DECISION-044: Budget approve/lock API surface — route names, no chained category+amount write, lock state read via query function not a GET route, re-lock requires explicit unlock first

**Status:** Resolved
**Date:** 2026-07-27

**Decision:** Four implementation calls closing the Phase 3 design for `docs/work-log/2026-07-27-ledger-budget-approve.md`, all left open by the architect (Phase 2, Suggestions 1 and 3):

1. **Route names:** `POST /api/admin/ledger/budget-approvals` (approve/lock) and `POST /api/admin/ledger/budget-approvals/unlock` (unlock) — not nested under `/budgets/`, since `ledgerBudgetApprovals` is its own resource keyed by `(entityId, fiscalYear)`, not a budget line.
2. **`POST /api/admin/ledger/categories` does not accept an inline `annualAmountCents`.** Creating a category and setting its first dollar amount stay two separate calls (`POST /categories` then the client's existing `PATCH /budgets` on blur, unchanged) rather than one endpoint doing both. A brand-new category is created with no budget line at all — it appears in `BudgetEditor` as an empty-amount row ready to type into, matching Phase 1 Flow 1's stated outcome exactly. Chaining would mean the categories route re-implements amount validation that already lives in `validateBudgetLineInput`/`upsertBudgetLine`, for a save-two-round-trips optimization on an occasional, low-cardinality action (a few new categories per year, per Phase 1's own cadence estimate).
3. **No new `GET` route for lock state.** `budgeting/page.tsx` is a Server Component that already fetches every other piece of page data (`getFunds`, `getFundReport`, `computeSeedFromPriorYear`) by calling `ledger-queries.ts` functions directly, never through an internal API round-trip. The new `getBudgetApproval(entityId, fiscalYear)` query function follows that existing convention rather than introducing the first internal-fetch GET route on this page.
4. **Re-approving an already-locked `(entityId, fiscalYear)` returns `409`, not a silent overwrite.** Locking a second time without first calling unlock is rejected with `"This budget is already locked. Unlock it to make changes and re-approve."` — this forces the explicit unlock-then-relock sequence Phase 1's Flow 5 describes (reason captured, then re-approve) rather than letting a second `POST /budget-approvals` quietly replace the first approval's trio and erase which board vote is actually on record.

**Rationale:** All four choices favor matching an existing convention already established elsewhere in this file/module over inventing a new one for a feature that fires a handful of times per year. See Impact for the specific files each affects.

**Impact:** `src/app/api/admin/ledger/budget-approvals/route.ts` (approve), `src/app/api/admin/ledger/budget-approvals/unlock/route.ts` (unlock), `src/app/api/admin/ledger/categories/route.ts` (create, no amount param), `src/lib/ledger-queries.ts` (`getBudgetApproval`, no corresponding route), `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` (calls `getBudgetApproval` directly). Full contracts in Phase 3 of the work-log.

---

## DECISION-043: Budget approve/lock modeled as a single status-flip row per (entity, fiscalYear), not an event log

**Status:** Resolved
**Date:** 2026-07-27

**Decision:** The new `ledger_budget_approvals` table (Phase 2 architectural review, `docs/work-log/2026-07-27-ledger-budget-approve.md`) is **one row per `(entityId, fiscalYear)`**, unique-constrained on that pair, carrying a `status` column (`'locked' | 'unlocked'`, default `'unlocked'`) plus current-state approval fields (`approvedByUserId`, `approvedAt`, `boardMinute`) and current-state unlock fields (`unlockedByUserId`, `unlockedAt`, `unlockReason`). Locking updates the approval trio and flips `status`; unlocking updates the unlock trio and flips `status` back — **neither action clears the other's fields**, so the most recent lock and the most recent unlock are both visible at once even after several lock/unlock cycles. This is **not** an append-only event log of every lock/unlock action.

**Rationale:** This mirrors the codebase's existing convention exactly rather than inventing a new one: `ledgerTransactions` (approval) and `ledgerReimbursements` (submit/approve/reject/pay) both model approval state as nullable current-state columns on a single row, never as a separate audit-event table — and there is no generic audit-log table in this schema to reuse (`googleGroupSyncLog` is sync-specific, not a generic audit mechanism). Budget adoption is a once-a-year, low-cardinality board action; an event-log table would add a second table, a list query, and a list UI for an action that fires a handful of times a year at most, with no stated requirement for a full history beyond "the most recent unlock is visible" (Phase 1, analyst). If a future increment needs full multi-cycle audit history, that's a new, separately-scoped feature — not a reason to over-build this one.

**Impact:** `src/lib/db/schema.ts` gets a new `ledgerBudgetApprovals` table; a matching idempotent migration (`drizzle/migrations/0062_ledger_budget_approvals.sql` or next available number) creates it and leaves existing `ledger_budgets` untouched. `assertBudgetUnlocked(entityId, fiscalYear)` (new shared guard) reads this table's `status` column. Follow-up: if the club later wants a full lock/unlock history (e.g., for 990 audit trail), add an event-log table then — don't retrofit this one to serve two shapes.

---

## DECISION-042: Guided budgeting — Activity fund balance tolerance set to ±$100

**Status:** Resolved
**Date:** 2026-07-27

**Decision:** `computeBudgetBalanceStatus()` (`src/lib/ledger.ts`, guided-budgeting increment) treats the Activity fund as balanced (`status: "ok"`) whenever `|budgetedIncomeCents - budgetedExpenseCents| <= 10_000` (±$100), and `warn` outside that band. Administrative uses a strict `income < expense` rule (no tolerance); Charitable/Scholarship are always `info` (planned drawdown is legitimate, never `warn`).

**Rationale:** Locked product decision 4 (Phase 1/2 of `docs/work-log/2026-07-27-ledger-guided-budgeting.md`) specified "Activity warns if net ≠ ~$0 (tolerance TBD — tech-lead specifies)" — the numeric value itself was left to Phase 3. The Activity fund is a pass-through clearing account for publicly-raised charitable money; "balanced" means planned receipts ≈ planned disbursements, not an exact-zero requirement. A treasurer hand-entering roughly a dozen category lines, each realistically rounded to the nearest $25–$50, will rarely land on an exact $0 net by design — a flat-dollar band absorbs that entry-level rounding noise without masking a genuine four-figure planning gap. Chosen as an absolute-dollar threshold (not a percentage of budget size) because the Activity fund's "near zero" target doesn't scale with fund size the way an operating-budget ratio would.

**Impact:** `src/lib/ledger.ts` — `computeBudgetBalanceStatus()`. Unit-tested at the boundary (net = exactly $100 → `ok`; net = $100.01 → `warn`; symmetric on the deficit side) in `src/lib/ledger.test.ts`. This is a starting default, not a number validated against a real budgeting season yet — flagged to the treasurer as adjustable after first use if it proves too tight or too loose. Presentation-only: never blocks a save, never stored.

---

## DECISION-041: Prospective members — no DB-level CHECK constraint for the `isActive`/`membershipStatus` invariant; application-level enforcement only

**Status:** Resolved
**Date:** 2026-07-26

**Decision:**

Adding `members.membershipStatus` (`prospective | active | ended`) per the prospective-members feature (`docs/work-log/2026-07-26-prospective-members.md`), the architect flagged a DB-level `CHECK` constraint enforcing `is_active = (membership_status = 'active')` as an optional hardening suggestion, noting no CHECK-constraint precedent existed in `drizzle/migrations/`. Declining it: this codebase already has an on-the-record decision *against* CHECK constraints on status-like text columns — `src/lib/db/schema.ts` lines 935, 958, and 1018 each carry `"No CHECK constraint on status — consistent with ledger_transactions.status pattern (inc1 precedent)"`. The invariant is enforced entirely in application code: every write path (`POST`/`PATCH /api/admin/members`, both membership-application approval branches, the roster-import scripts) derives `isActive` from `membershipStatus` via a single shared helper (`isActiveForStatus()` in `src/lib/members.ts`), never accepts a client-submitted `isActive`, and the invariant is regression-guarded by unit tests in `src/lib/members.test.ts`.

**Rationale:**

Adding a CHECK constraint here would introduce a new pattern this codebase has explicitly decided against elsewhere, not extend an existing one. It would also create an unrepresented-in-`schema.ts` database object to reason about on every future schema change — this project's Drizzle models have no first-class CHECK-constraint builder in use anywhere, and the invariant "`schema.ts` is the source of truth; anything in the live DB that isn't in `schema.ts` is dropped on the next `pnpm db:push`" makes an object Drizzle doesn't know about a standing risk, for a guarantee the application-level helper already provides. The partial unique index added in migration 0042 (`dues_settings`, similarly unrepresented in `schema.ts`) has run safely in production since — precedent that an unmanaged raw-SQL object is survivable, but that doesn't make adding a *second* undeclared kind of object (a CHECK constraint, a category this codebase has never used) the right default.

**Impact:**

`drizzle/migrations/0061_members_membership_status.sql` adds the column and backfill only, no CHECK constraint. `src/lib/members.ts` centralizes the invariant in `isActiveForStatus()`, `shouldProvisionOnMemberCreate()`, `shouldProvisionOnMemberUpdate()` — every write path must route through these, not reimplement the logic inline. If a future incident shows application-level enforcement was insufficient (e.g., a write path bypasses the helper), revisit this decision then, with that incident as the concrete justification a hypothetical one doesn't provide today.

---

## DECISION-040: Receipt storage moves to Postgres — `DatabaseReceiptStorage` adapter, `NODE_ENV`-gated selection (no new required env var), `@vercel/blob` removed

**Status:** Resolved
**Date:** 2026-07-21

**Decision:**

Add a third `ReceiptStorage` adapter, `DatabaseReceiptStorage`, backed by a new
dedicated table `ledger_receipt_files` (bytes live off the hot ledger/reimbursement/
acknowledgment rows, keyed by the existing opaque `receipts/<uuid>/<name>` key —
DECISION-020's key format is unchanged). `getReceiptStorage()`'s selection rule
changes from "`BLOB_READ_WRITE_TOKEN` present → Blob" to:

```
process.env.NODE_ENV === "production" → DatabaseReceiptStorage
otherwise (development, test)          → LocalReceiptStorage
```

**No new environment variable, in production or anywhere else.** `NODE_ENV` is
platform-set by `next build`/`next start` (true on every Vercel-hosted deployment —
Production *and* Preview, both of which share the same `DATABASE_URL` and neither
of which has a writable persistent filesystem) and by Vitest/Playwright/`pnpm dev`
for the other branch — never a value an operator manually configures per
environment, so it cannot be silently left unset the way `BLOB_READ_WRITE_TOKEN`
was. `LocalReceiptStorage` remains the zero-config dev/test adapter, and the
factory's `.receipt-store/` path never activates in any Vercel-built runtime.

`@vercel/blob` is dropped from `package.json`; `src/lib/receipt-storage/vercel-blob.ts`
is deleted outright, not kept behind a dead branch. The external dependency,
the token requirement, and the Hobby-plan Blob cap are fully eliminated, matching
the user's stated decision.

**Table shape** (`schema.ts` first, then an idempotent migration):

```ts
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return "bytea"; },
});

export const ledgerReceiptFiles = pgTable("ledger_receipt_files", {
  key: text("key").primaryKey(),               // receipts/<uuid>/<name> — DECISION-020 format
  contentType: text("content_type").notNull(),
  bytes: bytea("bytes").notNull(),
  byteSize: integer("byte_size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

This is the first use of Drizzle's `customType` in this codebase (no prior binary
column exists); it is not a new dependency — `customType` ships in `drizzle-orm/pg-core`,
already installed. A separate table (not a `bytea` column inline on
`ledger_transactions` / `ledger_reimbursements` / `ledger_acknowledgments`) keeps
those hot, frequently-`SELECT *`'d tables narrow — same reasoning that already
produced `ledgerFilings`, `ledgerReconciliationMatches`, etc. as side tables rather
than columns bolted onto a busy parent. Naming follows the `ledger_*` family since
100% of current consumers (ledger transactions, reimbursements, acknowledgment
letters) are Ledger-domain features. No `CHECK` constraint on `key`'s format,
consistent with this codebase's precedent of validating enum/pattern-shaped
columns at the app layer only (`ledger_transactions.status`, `ledger_reimbursements.status`).
10 MB receipts are trivial for Postgres `bytea`/TOAST and for `postgres.js`'s
message handling — no config changes needed.

`DatabaseReceiptStorage.save()` is `INSERT ... ON CONFLICT (key) DO UPDATE SET
content_type = excluded.content_type, bytes = excluded.bytes, byte_size =
excluded.byte_size` — preserves the interface's upsert semantics (matches Blob's
`allowOverwrite: true`, Local's unconditional `writeFileSync`). `read()` returns
`null` on a missing key (never throws); `delete()` is a no-op on a missing key
(never throws). The `ReceiptStorage` interface itself does not change.

**Two pre-existing defects are folded into this work, not deferred:**

1. **Orphan-bytes on receipt remove/replace** — `src/app/api/admin/ledger/transactions/[id]/route.ts`
   (~line 355) nulls `receiptStorageKey` without calling `getReceiptStorage().delete()`
   on the old key. Harmless under disposable Blob storage; becomes permanent,
   unbounded row growth inside the primary database once bytes live in Postgres.
   The acknowledgment-letter route already deletes-then-saves correctly — this
   fix makes the transaction-receipt path match the codebase's own established
   pattern. In scope for Phase 4, on the exact file this change touches.
2. **Byte-corruption guard adoption gap** — `receiptBytesToBodyInit()` is only
   called by 2 of 4 read routes; `acknowledgments/[id]/letter/route.ts` (line 77)
   and `members/reimbursements/[id]/receipt/route.ts` (line 50) still do the
   unguarded `stored.bytes.buffer` pattern. This project's DB driver is
   `postgres.js` (`drizzle-orm/postgres-js`), not `pg`/node-postgres — `postgres.js`
   decodes `bytea` via `Buffer.from(hexString, "hex")`, which is subject to the
   same small-allocation pooling behavior as `fs.readFileSync` (nonzero
   `byteOffset` into a shared pool ArrayBuffer for buffers under
   `Buffer.poolSize >> 1`). The exact bug class the guard exists for is reachable
   again on the new byte source, not just theoretically. Both remaining call
   sites route through `receiptBytesToBodyInit()` as part of this work, before
   the byte source changes underneath them.

Both are small, sit directly on files this change already modifies, and get
strictly worse (defect 1) or newly live again (defect 2) as a direct result of
the byte-source swap — bundled here rather than spun into separate bug-fix
work-log entries.

**Rationale:**

The user's whole motivation is eliminating a required-env-var-in-production
footgun (`BLOB_READ_WRITE_TOKEN` unset → silent fallback to `LocalReceiptStorage`
→ `fs.writeFileSync` on Vercel's read-only FS → 500 on every receipt upload).
`DATABASE_URL` is present in every environment, so naive "DB present → DB adapter"
logic was considered and rejected — it would force the DB adapter into local dev
and any future test that calls the factory, killing the zero-config `.receipt-store/`
dev experience and risking real network+DB round-trips in unit tests. An explicit
opt-in var (e.g. `RECEIPT_STORAGE=database`) was also rejected — it reintroduces
the exact same footgun class it's meant to replace: a manually-set flag that can
be forgotten, and forgetting it would silently reselect `LocalReceiptStorage` in
production, breaking uploads in exactly the way that triggered this work. Dropping
`LocalReceiptStorage` entirely (DB always) was rejected too — it would require a
reachable `DATABASE_URL` before any local contributor or CI run could exercise
receipts, with no adapter this project has ever built to mock that boundary.
`NODE_ENV === "production"` is the only signal that is both automatic (never a
human's job to set) and precisely correlated with "no persistent writable
filesystem is available" — which is the actual constraint driving adapter choice,
not the vaguer "are we in prod."

**Impact:**
- New: `src/lib/receipt-storage/database.ts` (`DatabaseReceiptStorage`).
- Removed: `src/lib/receipt-storage/vercel-blob.ts`; `@vercel/blob` dropped from `package.json`.
- `src/lib/receipt-storage/index.ts`: factory selection rule changes to the
  `NODE_ENV` check above; the FU-6 "warn in production, falling back to Local"
  log line is removed (Local can no longer be selected in production).
- `schema.ts` gains `bytea` customType export + `ledgerReceiptFiles` table; a new
  idempotent migration adds `CREATE TABLE IF NOT EXISTS ledger_receipt_files (...)`.
- `src/app/api/admin/ledger/transactions/[id]/route.ts`: Flow D gains a
  `getReceiptStorage().delete(oldKey)` call.
- `src/app/api/admin/ledger/acknowledgments/[id]/letter/route.ts` and
  `src/app/api/members/reimbursements/[id]/receipt/route.ts`: route reads through
  `receiptBytesToBodyInit()`.
- No data migration — no existing production receipts to move (user-confirmed;
  uploads have been failing since v1.31 shipped).
- No `FEATURES` change — this is a backend adapter swap, permissions are
  unaffected.
- Refines DECISION-020 (adapter selection rule and adapter roster both change;
  the `ReceiptStorage` interface and opaque-key/proxy-route model are unchanged
  and remain authoritative).

---

## DECISION-039: HEIC WASM decoder swap — `libheif-js` (`wasm-bundle` subpath) replaces `heic2any`, main-thread decode, no `next.config.ts` change

**Status:** Resolved
**Date:** 2026-07-21

**Decision:** Replace `heic2any` with `libheif-js@^1.19.8`, imported
exclusively via its `libheif-js/wasm-bundle` subpath
(`import("libheif-js/wasm-bundle")`), in `src/lib/heic-decode.ts`. Same
trigger condition as DECISION-038 (only after a native
`createImageBitmap()` failure on a HEIC/HEIF file in
`receipt-file-input.tsx`) and the same dynamic-`import()`-only,
own-async-chunk shape — Safari and every successful native-decode path
still never fetch it. `heic2any` is removed outright; no dual-decoder
fallback.

**Rationale:** `heic2any@0.0.4` embeds a `libheif` WASM build too old to
parse modern iPhone HEIC (10-bit `heix` + HDR gain-map `tmap`, 48 MP) —
reproduced against a real user photo (decode failure in 201 ms,
`Could not parse HEIF file`) in
`docs/work-log/2026-07-21-heic-modern-iphone-decode.md`. It's also
unmaintained since ~2021 with no newer release, so there's no "wait for
an update" option. `libheif-js@1.19.8` decodes the same file correctly
(independently re-verified in this review: 787 ms, correct 4284×5712
dimensions, non-blank RGBA output), is actively maintained (last
published 2025-06-12, steady history since 2020, explicit policy of
tracking upstream `libheif`), and carries zero transitive runtime
dependencies (strictly better than the `heic-decode` package DECISION-038
rejected for depending on `libheif-js` transitively — this decision takes
it directly instead).

`libheif-js` ships three entry points; unpacked the real tarball rather
than trusting the README. The default `libheif-js` import (2.1 MB,
"classic pure-JS" build) and the `libheif-js/wasm` split-asset entry
(Node-only `fs.readFileSync` of a separate `.wasm` file — no browser
story, would need real asset-pipeline config this project doesn't carry)
were both rejected. `libheif-js/wasm-bundle` (1.4 MB raw / ~521 KB gzip)
inlines its WASM as base64 in the JS — verified directly, no separate
`.wasm` fetch — the same packaging property that made `heic2any`
viable under DECISION-038's "no asset-pipeline/CSP changes" requirement.
Modest size increase over `heic2any` (~180 KB gzip) accepted as the cost
of a decoder that actually decodes the target files; it's still a single
lazy chunk under the same gate.

`libheif-js` decodes on the calling thread (no internal Worker, unlike
`heic2any`'s Blob-backed Worker). Re-verified 787 ms for the reproduction
file. Ruled acceptable for now without a Worker wrapper: the receipt
upload UI already shows a "Preparing photo…" state and disables the file
input during decode, this is an authenticated-treasurer, occasional-use
admin flow (not public or latency-sensitive), and a Worker wrapper would
add real marshaling complexity for a UX gain not currently needed.
Revisit if decode times grow or main-thread contention becomes an issue —
not filed as a backlog item by this decision, flagged in the work-log for
whoever hits it next.

**License class, addressed explicitly per this decision's own review
criteria:** `libheif-js`'s own `package.json` now declares
`"license": "LGPL-3.0"` directly for the wrapper (one notch stricter than
`heic2any`'s MIT-wrapper-around-LGPL shape — same underlying compiled
`libheif` either way, LGPL-3.0, unchanged from DECISION-038). DECISION-038's
acceptability reasoning applies unchanged: consumed unmodified as an npm
dependency (ordinary LGPL linking/consumption, not the modify-and-
redistribute case LGPL's copyleft targets), used strictly client-side,
decode-only, inside a small nonprofit's internal admin tool by an
authenticated treasurer converting a receipt photo they already possess —
not a commercial product, not redistributed as a standalone artifact. If
this judgment is ever revisited, the removal surface is still a single
dynamic-import call site. Zero transitive runtime dependencies, confirmed
by inspecting the installed package's `package.json` (no `"dependencies"`
key).

**Impact:** `package.json`: `heic2any` removed, `libheif-js@^1.19.8`
added. `src/lib/heic-decode.ts`: decoder call replaced; new RGBA→JPEG
canvas-encode glue added inside this file (libheif-js hands back raw
pixel data via `image.display()`, not a Blob) — lives here rather than in
`image-resize.ts` because that module owns *resizing an already-decoded
image*, a different concern from *encoding a decoder-specific raw pixel
buffer*; folding it in there would leak a decoder-specific data shape
into a module whose callers only ever hand it images/Blobs. Public
contract of `heic-decode.ts` is unchanged
(`decodeHeicFileToJpegBlob(file): Promise<Blob>`, `HeicDecodeStageError`,
stages `"chunk-load"`/`"decode"`, `classifyHeicDecodeFailure`, messages)
— `receipt-file-input.tsx` requires zero changes. No `next.config.ts`
change; no schema, route, or `FEATURES` change. Full reasoning, entry-
point comparison table, and implementation sketch in the Phase 2/3
sections of
`docs/work-log/2026-07-21-heic-modern-iphone-decode.md`.

---

## DECISION-038: HEIC WASM decode fallback — `heic2any` (MIT wrapper, embeds LGPL-3.0 libheif WASM), client-only, no `next.config.ts` change

**Status:** Superseded by DECISION-039 (dependency choice only — the
trigger condition, dynamic-import-only shape, and "own async chunk, never
loaded by Safari" invariant this decision established all still stand)
**Date:** 2026-07-21

**Decision:** Add `heic2any@^0.0.4` as the WASM HEIC decoder for
`docs/work-log/2026-07-21-receipt-heic-wasm-fallback.md`, chosen over
`libheif-js` and `heic-decode`. Dynamically imported (`import("heic2any")`)
from a new `src/lib/heic-decode.ts` module, itself imported only by the
existing client component `src/components/admin/ledger/receipt-file-input.tsx`
— triggered exclusively after a native `createImageBitmap()` failure on a
HEIC/HEIF file, so it never loads for Safari or for any successful
native-decode path. No schema, no server route, no `FEATURES` key, no
`next.config.ts` change.

**Rationale:** All three Phase 1-named candidates wrap the same underlying
decoder (libheif compiled to WASM); the choice came down to packaging and
API fit, verified by unpacking each tarball rather than trusting READMEs.
`heic2any`'s bundle embeds its WASM inline (no separate `.wasm` asset file,
instantiated inside a `Blob`-backed `Worker`), which is what makes the
"no bundler/asset-pipeline config needed" property true — the two
lower-level candidates consume libheif's raw Emscripten output and would
carry asset-loading risk this project's `next.config.ts` isn't currently
configured for. `heic2any` also has the best API fit: File/Blob in, JPEG
Blob out, feeding straight back into the existing `resizeImage()` canvas
pipeline in `image-resize.ts` without new pixel-buffer glue. Zero
transitive npm dependencies (`heic-decode` carries one: `libheif-js`).

**License class, addressed explicitly per this decision's own review
criteria:** `heic2any`'s own code is MIT (verified via its `LICENSE.md` and
`package.json`). It embeds a compiled build of **libheif**, which upstream
is **LGPL-3.0**, and HEIC's HEVC codec carries patent-pool licensing
considerations in principle. Judged acceptable for this project: consumed
unmodified as an npm dependency (ordinary LGPL linking/consumption, not the
modify-and-redistribute case LGPL's copyleft targets), used strictly
client-side and decode-only inside a small nonprofit's internal admin tool
by an authenticated treasurer converting a receipt photo they already
possess — not a commercial product, not redistributed as a standalone
artifact. If this judgment is ever revisited, the removal surface is a
single dynamic-import call site.

**Impact:** New `dependencies` entry in `package.json` (`heic2any`,
installed in Phase 4). New file `src/lib/heic-decode.ts` (pure failure
classifier + message lookup + one thin `import("heic2any")` wrapper,
mirroring the `image-resize.ts` pure-logic/DOM-glue split). No change to
`next.config.ts` — confirmed the existing CSP (`worker-src 'self' blob:`,
`script-src ... 'unsafe-eval' ...`) already permits the `Blob`-Worker/WASM
mechanics `heic2any` uses. Full reasoning and dependency-by-dependency
comparison in the Phase 2 section of
`docs/work-log/2026-07-21-receipt-heic-wasm-fallback.md`.

---

## DECISION-037: Treasury User's Guide — live-value scope limited to 990 determination + current settings recap, no `ensureFilingsForFY` write from the guide

**Status:** Resolved
**Date:** 2026-07-21

**Decision:** Of the whole guide, exactly two of eleven sections read the database — `compliance-calendar-section.tsx` (current FY 990 form determination, per entity) and `settings-section.tsx` (a "current values" recap of the five settings fields). Every other section, including all 14 compliance guardrails, is pure static JSX with thresholds phrased generically ("the amount configured on the Settings page," not a dollar figure). The two live reads happen once in `page.tsx` (`getEntities()`, `getComplianceOverview(entity.id, currentFiscalYear())` per entity, `getSettings()`) and are passed down as props — section components never fetch independently. The guide calls `getComplianceOverview()` directly and deliberately does **not** call `ensureFilingsForFY()` first, unlike `compliance/page.tsx`: `determine990Result` is computed from financial totals (gross receipts/assets) inside `getOverview()`, not from the `ledger_filings` rows `ensureFilingsForFY` seeds, so skipping it doesn't affect the one value the guide displays — and a read-only content page should never trigger a write side effect.

**Rationale:** Phase 1 (Pass 4) identified the drift risk — hardcoded example numbers ("reserves below $1,000") rot the moment a treasurer edits Settings — and named two ways to resolve it: phrase generically, or interpolate live. Phase 2 (Ruling 3) confirmed JSX can support either cleanly but explicitly punted the per-value choice to Phase 3. Blanket-applying live interpolation everywhere would maximize the DB-dependent surface of a page whose entire value proposition (Phase 1, Flow 1) is that static content has no failure path; going generic everywhere would leave the 990 determination — the one number in this guide with real legal-filing consequences if a successor reads a stale example — silently wrong. Splitting the difference by value, not by section-type convention, keeps the failure surface to the two places where being wrong actually costs something.

**Impact:** `page.tsx` needs `export const dynamic = "force-dynamic"` (matches every other Ledger subpage) and an inline try/catch per live read; `compliance-calendar-section.tsx` and `settings-section.tsx` accept an optional/nullable prop and render a one-line fallback ("Unable to load the current 990 determination — see the Compliance page." / "...see the Settings page.") on failure or on an empty `getEntities()` result, rather than the full-page `LoadErrorCard` treatment (that pattern is for a whole page failing to load, not one subsection of a long static page). The other nine sections have zero DB dependency and therefore zero new failure-path surface.

---

## DECISION-036: Bank Reconciliation Sessions (inc2) — three new tables, `reconciledSessionId` provenance pointer (not a parallel status), many-to-one-ready match links, hard immutability lock on cleared rows, overlap-hard/gap-soft period validation, reopen-ordering rule, deposit-slip-vs-check-number split

**Status:** Resolved
**Date:** 2026-07-21

**Decision:**

Phase 3 technical design for Bank Reconciliation inc2 (work-log:
`docs/work-log/2026-07-21-ledger-reconciliation-sessions.md`) locked the
following, building on this feature's Phase 2 rulings (same parent work-log,
`docs/work-log/2026-07-21-bank-reconciliation.md`):

1. **Three new tables, one new column, no second schema module:**
   `ledger_reconciliation_sessions` (bank account + statement period, opening/
   closing balances, `status` open|closed, upload metadata, close/reopen
   audit fields), `ledger_bank_lines` (parsed Chase CSV rows — signed
   `amountCents`, raw `checkOrSlipNumber`, `inStatementPeriod` flag, a
   `(sessionId, dedupeKey)` unique constraint), `ledger_reconciliation_matches`
   (bank line ↔ transaction links), and `ledgerTransactions.reconciledSessionId`
   (nullable FK, `ON DELETE SET NULL`).
2. **`reconciledSessionId` is a provenance pointer, not a parallel reconciled
   state** — modeled directly on DECISION-025's `sync_stale` precedent
   ("add a marker, don't fork state"). Session close still writes the same
   `ledgerTransactions.reconciled`/`reconciledAt` columns the legacy per-row
   toggle already writes; the new column only records *which session, if
   any,* set them. Reopen reverts only rows where `reconciledSessionId`
   points at itself. The legacy toggle route is extended to clear
   `reconciledSessionId` to null on every write (either direction) — an
   out-of-band correction always supersedes session provenance, so the two
   mechanisms can never end up pointing at stale, conflicting state.
3. **Match-link cardinality is many-to-one-ready without a future schema
   change.** `ledger_reconciliation_matches.transactionId` is `UNIQUE`
   forever (a book row clears against exactly one bank line, even after
   inc3). `bankLineId` is deliberately **not** unique at the schema layer —
   inc2's `/match` route enforces a 1:1 rule itself (reject if the bank line
   already has a match), which inc3 can simply remove at the route layer to
   enable Zeffy lump-deposit batch matching, with zero migration required.
4. **Reconciled-row immutability: a full lock, not a `syncStale`-style
   silent-degradation marker.** A transaction with `reconciledSessionId` set
   cannot be edited (any field) or deleted via the standard transaction
   routes until its closing session is reopened — structurally identical to
   the existing `approvedAt` guard. This was a genuine choice (the architect
   flagged reusing `syncStale` as a reasonable alternative); the harder lock
   was chosen because this feature's defining decision is a **hard** tie-out
   with no discrepancy-note escape hatch (User Decision, parent work-log
   Phase 1) — silently degrading a closed session's arithmetic via an
   unflagged edit would contradict that decision's spirit. `syncStale`
   keeps its original, narrower scope (a dues-payment source edit after
   reconcile).
5. **Period validation splits hard-block from soft-warning.** Overlapping
   periods on the same bank account are a hard block (409) at session
   creation, checked against sessions of *any* status, inclusive of shared
   boundary days. Non-contiguous periods (a gap between the prior session's
   close and this session's start) are a **soft, non-blocking** warning only
   — required to keep the User Decision supporting arbitrary historical
   periods (the 24-month T-13 backlog, worked non-sequentially) functional,
   while the one thing that would actually corrupt tie-out math (double-
   claimed bank-statement days) stays hard-blocked.
6. **Reopen ordering rule.** A closed session cannot be reopened if any
   *later-period* closed session exists for the same bank account — standard
   bank-rec discipline preventing an inconsistent audit trail from revisiting
   an earlier period after later periods have already finalized on top of it.
7. **Deposit-slip vs. check-number split, resolving inc1's forwarded Phase 6
   note.** Chase's own "Check or Slip #" CSV column is stored verbatim on
   every bank line regardless of sign (no schema fork). It is copied into a
   newly created transaction's `checkNumber` field only when the bank line
   is a debit (negative `amountCents`); for a credit/deposit line, the value
   is never auto-populated into `checkNumber`, since Chase's column
   conflates "check number" and "deposit slip number" — the exact category
   confusion T-21/DECISION-034 uncovered on the `payment_method` side. This
   keeps inc3's future check-number-first auto-match matching key clean.
8. **Bank lines store signed cents, diverging from `ledgerTransactions`'
   positive-only + `flow` model.** Deliberate: a bank line has no `flow`
   until matched to a book row; forcing a sign-to-flow translation at parse
   time would be a premature, lossy interpretation this staging table
   doesn't need.
9. **Parse-and-discard confirmed at the implementation level:** the CSV
   upload route never persists the uploaded file; only derived
   `ledger_bank_lines` rows are written, per the architect's Phase 2 ruling.
10. **No new `FEATURES` key.** `LEDGER_RECORD` gates create/upload/match/
    unmatch/create-from-bank-line/close; `LEDGER_MANAGE` gates reopen;
    `LEDGER_VIEW` gates reads — all enforced server-side in each route body.

**Rationale:**

Every structural choice here reuses an existing, proven shape in this
codebase (DECISION-025's marker-not-fork precedent, the `approvedAt`
immutability idiom, DECISION-035's last-state-only audit-field trio) rather
than inventing a new convention. The two genuinely new pieces of judgment —
the immutability lock's strictness and the overlap/gap split — both follow
directly from the User's explicit hard-tie-out and historical-backlog
decisions rather than from an assumed default.

**Impact:**

- `src/lib/db/schema.ts` — three new tables (`ledgerReconciliationSessions`,
  `ledgerBankLines`, `ledgerReconciliationMatches`) plus
  `ledgerTransactions.reconciledSessionId`.
- New migration `00NN_ledger_reconciliation_sessions.sql` — number is
  next-free at implementation time (`0057_ledger_receipt_waiver.sql` is
  latest as of this writing, claimed by the concurrent transaction-receipts
  work; expect `0058+`, implementer re-checks).
- `src/app/api/admin/ledger/transactions/[id]/reconcile/route.ts` — clears
  `reconciledSessionId` to null on every toggle write.
- `src/app/api/admin/ledger/transactions/[id]/route.ts` — new immutability
  guard mirroring `approvedAt`'s.
- New `src/lib/reconciliation.ts` (+ `reconciliation.test.ts`, 22 named
  tests) and `src/lib/reconciliation-queries.ts`.
- New API routes under `src/app/api/admin/ledger/reconciliation/sessions/`
  (create, list, detail, upload, match, unmatch, create-from-bank-line,
  close, reopen).
- New admin pages under
  `src/app/(dashboard)/admin/ledger/reconciliation/` and eight new
  components under `src/components/admin/ledger/`; new `admin-sidebar.tsx`
  nav entry.
- Implementer sequence: database-admin → api-developer → ux-developer.

---

## DECISION-035: Transaction Receipt Upload + Waiver — column rename to `receipt_storage_key`, three-column waiver (not a side table), `LEDGER_MANAGE` gating, shared `RECEIPT_KEY_REGEX`, downscale numbers, `all` pseudo-fund-slug for the guardrail link

**Status:** Resolved
**Date:** 2026-07-21

**Decision:**

Phase 3 technical design for Transaction Receipt Upload (work-log:
`docs/work-log/2026-07-21-transaction-receipts.md`) locked the following, building on Phase 2's
architectural rulings:

1. **`ledger_transactions.receipt_url` → `receipt_storage_key`, nullable, data-free rename.**
   Verified 0/147 expense rows have a non-null value (Phase 2 read-only query), so this is a pure
   rename with no backfill branch — copies DECISION-020's opaque-key + proxy-route pattern
   already proven for member reimbursements, except nullable (an expense transaction can
   legitimately lack a receipt; a reimbursement request cannot). Migration
   `0057_ledger_receipt_waiver.sql` guards the rename for both "old column still present" and
   "already renamed" states so it's safe to re-run on every deploy.
2. **Waiver = three nullable columns on `ledger_transactions`, not a side table:**
   `receiptWaivedAt` / `receiptWaivedByUserId` / `receiptWaiverReason`. Same shape as this table's
   existing `approvedAt`/`approvedByUserId`/`rejectionReason` — a 1:1, low-cardinality
   who/when/why annotation, not a 1:many relationship that would justify a table. Un-waiving
   clears all three (reversible, not an append-only audit log — the user asked for a recorded
   reason for the *current* state, not a history of every waive/unwaive cycle).
3. **Waiving is gated `LEDGER_MANAGE`, not `LEDGER_RECORD`.** Waiving suppresses a compliance
   signal — a judgment call over whether a control requirement applies to a row — which is the
   same tier distinction that already separates `LEDGER_APPROVE` from `LEDGER_RECORD` for
   approve/reject. If waiving were gated `LEDGER_RECORD`, anyone who can enter a transaction could
   silently zero out the compliance count. No new `FEATURES` key was needed — `LEDGER_MANAGE`
   already exists for exactly this class of structural/governance authority over the books.
4. **Route shape:** `POST /api/admin/ledger/transactions/upload` (flat, no `[id]` — mirrors the
   reimbursement upload precedent, since a receipt can attach before the transaction record
   exists), `GET /api/admin/ledger/transactions/[id]/receipt` (proxy view), and
   `POST`+`DELETE /api/admin/ledger/transactions/[id]/receipt/waive` (waive / un-waive) as a
   dedicated sibling sub-route — matching this codebase's established precedent
   (`/approve`, `/reject`, `/reconcile`, `/acknowledge`) of a permission-tier step-up living in
   its own route file, never a conditional branch inside the shared PATCH handler.
5. **`RECEIPT_KEY_REGEX` hoisted** from its two duplicated definitions
   (`src/app/api/members/reimbursements/route.ts` and `.../[id]/route.ts`) into a single export
   in `src/lib/receipt-storage/index.ts`, imported at all four call sites (the two existing plus
   the two new transaction routes) rather than pasting a third copy.
6. **Downscale target: 1600px longest edge, JPEG quality 0.82; PNG converts to JPEG; PDF passes
   through untouched; HEIC stays out of scope** (the existing magic-byte/accept-list boundary
   never admitted it). 1600px keeps typical receipt text legible on zoom while shedding a modern
   phone photo's native 3000-4000px dimension; 0.82 is above the quality where JPEG block
   artifacts become visible on small receipt-font text. Pure dimension math lives in a new
   `src/lib/image-resize.ts` (unit-testable, no DOM); canvas/`toBlob()` glue is a thin client
   component, mirroring the `permissions.ts`/`permissions-server.ts` pure/environment split.
7. **Guardrail-to-list link resolves the fund-scoped-vs-entity-scoped mismatch (Phase 2 Ruling 7)
   via a new `all` pseudo-fund-slug**, not a new page. The compliance guardrail count is computed
   per-entity across all of that entity's funds, but the only filterable transaction list is
   fund-scoped. `[fundSlug]/page.tsx` gains a special case for the literal segment `all`: skip the
   single-fund lookup and fund-specific balance/budget chrome, render only the shared header and
   a transaction table built without a `fundId` filter. `GuardrailFlag` gains an optional
   `linkHref`, populated by Check 11 as
   `/admin/ledger/all?entity=<slug>&fy=<fy>&receipt=missing`, and both rendering call sites
   (`ledger-entity-detail.tsx`, `compliance/page.tsx`) render it generically.
8. **Uploading a real receipt onto a waived row clears the waiver** (not the reverse; removing a
   receipt does not waive it). An actual receipt supersedes an administrative excuse; the
   alternative (both fields set simultaneously) is an unresolvable dual state with no clear UI
   story.

**Rationale:** Every one of these mirrors an existing, proven pattern in this codebase
(DECISION-020's storage adapter, the approve/reject sibling-route shape, the
`approvedAt`/`rejectionReason` column shape, the `permissions.ts`/`permissions-server.ts` pure/
impure split) rather than inventing a new convention — the only genuinely new code is the
canvas-based image downscale, which has no repo precedent to copy (confirmed in Phase 1/2: no
`sharp`/`pica`/`browser-image-compression` dependency exists or is needed).

**Impact:** `schema.ts` gains 3 columns and one rename on `ledgerTransactions`; migration
`0057_ledger_receipt_waiver.sql`; 3 new/changed API routes plus payload changes on the existing
`POST`/`PATCH .../transactions[/[id]]`; new `src/lib/image-resize.ts`,
`receipt-file-input.tsx`, `receipt-waiver-control.tsx`; `[fundSlug]/page.tsx`,
`ledger-entity-detail.tsx`, and `compliance/page.tsx` render the new receipt state and the
guardrail's actionable link. No new `FEATURES` keys, no new tables. Implementer sequence:
database-admin → api-developer → ux-developer.

---

## DECISION-034: Ledger Check Numbers (T-18, inc1) — text column, CSV-replay backfill (not memo-parsing, not re-running the destructive importer), uncashed-checks detection unchanged

**Status:** Resolved
**Date:** 2026-07-21

**Decision:**

Phase 3 technical design for Bank Reconciliation inc1 (work-log:
`docs/work-log/2026-07-21-ledger-check-number.md`) locked the backfill
mechanism after the task's stated premise — "check numbers live in
free-text memos," per `docs/treasurer-todo.md` T-18 and the parent
work-log's Intent — turned out to be empirically false on inspection:

1. **`check_number` is `text`, not `integer`**, with a composite, non-unique
   index on `(bank_account_id, check_number)`. Matches this codebase's
   convention for numeric-looking identifier fields (`last4`, `slug`) that
   are only ever exact-matched, never subject to arithmetic or range
   queries — and avoids baking in a leading-zero/format assumption the real
   data doesn't need but a future account's data might.
2. **Backfill source is the original Quicken register CSVs, not memo/party
   text.** Sampling the local DB's 109 `paymentMethod='check'` rows showed
   memo/party text almost never contains a check number — the one row that
   does ("Replacement for check #8045") refers to a *different* check's
   number than its own row. Tracing further: `scripts/import-quicken-ledger.ts`
   already parses a `checkNum` field from the register's "Check #" column at
   import time; it's discarded before insert, used only for cause-derivation
   and console logs. The real numbers are recoverable, near-unambiguously,
   from the source CSVs (still on disk, paths already hardcoded in that
   script).
3. **Backfill mechanism is a new, additive, `UPDATE`-only script
   (`scripts/backfill-check-numbers.ts`), not a re-run of
   `import-quicken-ledger.ts`.** That importer's idempotency model is
   destructive-and-total: it deletes every `[quicken-import]`-marked row and
   reinserts all of them fresh with new UUIDs, computing `reconciled`/
   `reconciledAt` from the CSV's own "Clr" column rather than live DB state.
   Re-running it today would silently discard any reconciliation/edit state
   the treasurer has layered on via the admin UI since the 2026-07-20 seed,
   and cascade-delete any `ledgerAcknowledgments` referencing a
   soon-to-be-replaced transaction ID. The new script instead matches each
   CSV register row to its corresponding existing DB row by
   (`entityId`, `txnDate`, `amountCents`, `paymentMethod='check'`, `flow`,
   `[quicken-import]` marker) and does a targeted `UPDATE ... SET
   check_number = $1 WHERE id = $2` — never touching any other column, never
   changing the row's `id`. Zero or multiple matches are logged to a review
   list rather than guessed at, satisfying Phase 1's low-confidence-review
   requirement at the point where this dataset's actual ambiguity lives
   (CSV-to-row matching), not at a memo-regex step with almost no signal to
   parse. `import-quicken-ledger.ts` itself gets an *additive* enhancement
   (capture `checkNumber` in its row-builder) purely so that production's
   still-pending first seed (production is unseeded per project memory)
   gets the column for free — that enhancement is not re-run against the
   already-seeded local DB.
4. **A memo-parsing pure function (`parseCheckNumberFromMemo` in the new
   `src/lib/check-number.ts`) is kept, but demoted to a low-confidence
   enrichment hint** surfaced only on rows the CSV-match step can't resolve
   — never the primary mechanism. Its test suite is built directly from the
   real ambiguous example found in the data (the "replacement for check
   #8045" row, whose own actual number is 8049).
5. **Uncashed-checks detection is unchanged**, correcting a mischaracterization
   in the parent work-log's framing. `getDashboard()`'s uncashed-checks query
   already detects via `paymentMethod='check'` + `flow='expense'` +
   `reconciled=false` (DECISION-031/032) — memo is only ever displayed, never
   used for detection. `checkNumber` is added as a new displayed column only;
   detection does not switch to requiring a non-null `checkNumber`, since that
   would silently drop legitimate uncashed checks lacking a backfilled/typed
   number.
6. **Surfaced, not fixed: 3 rows mistagged `paymentMethod='check'`** (Walmart,
   OTC Brands, FSP Product Decorator — all register "Check #"="Card") are
   actually debit-card purchases per the register's own data. The backfill
   script reports this plainly and offers a separate, explicit
   `--fix-payment-method` opt-in flag — never bundled into the default
   `--apply` — since it's a real but independently-scoped data-quality fix
   discovered as a byproduct, not this increment's stated column.

**Rationale:**

Every choice here follows from checking the stated premise against real data
before designing around it, rather than building the memo-parser the task
framing assumed was needed. A regex parser built to spec against a premise
that doesn't hold would have produced a "backfill" that silently populated
almost nothing, while a destructive-reinsert "backfill" (the more literal
reading of "re-run the idempotent importer") would have quietly destroyed
weeks of admin-UI reconciliation state the first time someone ran it. The
CSV-replay-plus-safe-UPDATE design gets near-total, low-risk coverage for
the one dataset that actually needs backfilling (local dev; production isn't
seeded yet) while leaving every other column and every row ID untouched.

**Impact:**

- `src/lib/db/schema.ts` — `ledgerTransactions.checkNumber` (text, nullable) +
  composite index.
- `drizzle/migrations/00NN_ledger_check_number.sql` (new; NN = next free slot
  at implementation time, after `0055`).
- `src/lib/check-number.ts` (new) — `parseCheckNumberFromMemo()`,
  `classifyRegisterCheckColumn()`; `src/lib/check-number.test.ts` (new) — ten
  named unit tests.
- `scripts/backfill-check-numbers.ts` (new) — additive, dry-run-default,
  `--apply` to write, `--fix-payment-method` opt-in for the debit-card
  correction.
- `scripts/import-quicken-ledger.ts` — additive `checkNumber` capture in the
  row-builder (for production's still-pending first seed); not re-run
  against local dev as part of this increment.
- `src/components/admin/ledger/transaction-form.tsx`,
  `src/components/admin/ledger/uncashed-checks-panel.tsx`,
  `src/lib/ledger-queries.ts` (`UncashedCheckRow` widen),
  `src/app/api/admin/ledger/transactions/route.ts` and `.../[id]/route.ts`.
- Full design: `docs/work-log/2026-07-21-ledger-check-number.md`, Phase 3 —
  Technical Design.

---

## DECISION-033: Failed Login Visibility — table/enum shape, permission-naming convention, opportunistic-prune pattern, IP/UA deferred

**Status:** Resolved
**Date:** 2026-07-21

**Decision:**

Phase 3 technical design for Failed Login Visibility (work-log:
`docs/work-log/2026-07-21-failed-login-visibility.md`) locked five
implementation-level choices Phase 2 explicitly deferred:

1. **New table `failed_login_attempts`** — `id` (uuid), `attempted_email`
   (`varchar(255)`, length-capped at the recorder call site, not relying on
   the DB constraint to reject-and-throw), `provider` (text: `"credentials"`
   | `"google"`), `reason` (text, six values —
   `missing_credentials`/`unknown_email`/`no_password_set`/`deactivated`/
   `bad_password`/`oauth_deactivated`), nullable `user_id` FK
   `ON DELETE SET NULL` (mirrors `event_occurrence_overrides.cancelled_by_user_id`,
   DECISION-001), `created_at` as `timestamptz` (not naive `timestamp` — this
   project has a documented naive-timestamp-as-UTC bug on unrelated
   `eventRsvps`/occurrence columns). Two indexes: `created_at` (reverse-chron
   list) and `attempted_email` (search + grouped `GROUP BY`). Split across
   two migrations, `0054_failed_login_attempts.sql` (table) and
   `0055_admin_security_permission.sql` (permission), following this repo's
   established convention (`0044_ledger_books.sql` → `0045_ledger_permissions.sql`,
   `0040_dues_tracking.sql` → `0041_dues_permissions.sql`) rather than one
   combined file.
2. **Permission key: `FEATURES.ADMIN_SECURITY_VIEW = "admin.security_view"`.**
   Architect Ruling 5 left the naming convention open (bare-noun `admin.*`
   style vs. action-suffixed `*.view` style, both precedented in the same
   catalog). Chose the action-suffixed style to leave room for a future
   `admin.security_manage` (e.g., a manual "clear old entries" action) without
   a rename, matching the `DUES_VIEW`/`DUES_MANAGE` and
   `LEDGER_VIEW`/`LEDGER_MANAGE` precedent. Bound to `admin` role only (locked
   user decision) — not `treasurer` or `board_member`.
3. **Opportunistic prune, piggybacked on insert, unconditional deletion** —
   no cron/worker infra exists in this project. Cutoff computed by a pure,
   independently-unit-tested function `pruneCutoff(now: Date = new Date())`
   returning `now - 90 days` as a plain JS `Date`, rather than a Postgres
   `now() - interval '90 days'` SQL expression — this makes prune-window
   correctness testable without a DB connection and sidesteps any
   Postgres-interval-syntax edge case.
4. **IP address / user agent capture ruled OUT of v1.** `next/headers`'
   `headers()` would very likely work inside NextAuth's `authorize()`/`signIn`
   callbacks (they execute inside the App Router route handler NextAuth
   registers), but "very likely" isn't good enough to bake an unverified API
   call into a fire-and-forget block that must never throw, for a feature
   Phase 1 explicitly scoped as a nice-to-have. Deferred as a candidate,
   additive (`ADD COLUMN IF NOT EXISTS`), non-blocking fast-follow.
5. **`Credentials.authorize()`'s existing `if (!user || !user.password) return null;` must be split into two branches** (`unknown_email` vs.
   `no_password_set`) to preserve the six-way reason granularity the analyst
   required — this is a real logic change, not just an additive recorder
   call, and was called out explicitly so the implementer doesn't under-scope
   it as "add six calls."

**Rationale:**

Each choice follows existing repo precedent over inventing a new one: the
migration split matches every prior new-table-plus-permission feature; the
`timestamptz`/nullable-FK/index choices directly reuse patterns this codebase
already debugged into correctness (DECISION-001, the naive-timestamp bug);
the `pruneCutoff()` pure-function design keeps a security-relevant retention
rule testable and DB-independent, the same discipline DECISION-031/032
applied to `getDashboard()`'s query-layer seams. Deferring IP/UA capture
trades a nice-to-have for a smaller, better-verified v1 surface, consistent
with the analyst's own framing of it as optional.

**Impact:**

- `src/lib/db/schema.ts` — new `failedLoginAttempts` table + types; `varchar` added to the top-of-file import list.
- `src/lib/permissions.ts` — `FEATURES.ADMIN_SECURITY_VIEW` + `FEATURE_DESCRIPTIONS` entry.
- `src/lib/auth/failed-login.ts` (new) — recorder, `normalizeAttemptedEmail`, `pruneCutoff`, shared enums/labels; `src/lib/auth/failed-login.test.ts` (new) — five named unit tests.
- `src/lib/auth/index.ts` — six `recordFailedLogin()` call sites, including the required branch split.
- `src/app/(dashboard)/admin/security/page.tsx` (new), `src/components/admin/admin-sidebar.tsx` (new nav item).
- `drizzle/migrations/0054_failed_login_attempts.sql`, `drizzle/migrations/0055_admin_security_permission.sql` (new).
- Full design: `docs/work-log/2026-07-21-failed-login-visibility.md`, Phase 3 — Technical Design.

---

## DECISION-032: Ledger Dashboard — implementation-level calls from Phase 3 design (error boundary, mobile table pattern, EntitySwitcher non-reuse, uncashed-checks flow scoping, fund-name guardrail widen)

**Status:** Resolved
**Date:** 2026-07-20

**Decision:**

Phase 3 technical design for the Ledger Dashboard (work-log: `docs/work-log/2026-07-20-ledger-dashboard.md`) resolved five implementation-level questions Phase 2 left open:

1. **Error boundary: inline `try/catch` in `page.tsx`, not `error.tsx`.** This codebase has zero existing `error.tsx` files; introducing one would be a first-of-its-kind Client Component boundary for a single page's static failure card, cutting against the Server-Component-by-default invariant for no interactivity gained (retry is a plain `<Link>` re-navigation). `try/catch` wraps each of the page's three DB-fetching phases individually, rendering a shared `LoadErrorCard()`. Correctness trap documented for the implementer: `redirect()` throws internally and must never sit inside one of these `try` blocks.
2. **Uncashed-checks list reuses the Approvals page's `overflow-x-auto` table pattern, not a stacked card list.** Confirmed by reading `src/app/(dashboard)/admin/ledger/approvals/page.tsx` (L111–113) — this is the established convention for tabular admin-ledger lists, already solving the same mobile-overflow problem Phase 1 Gap #5 raised. Matching it beats inventing a second, inconsistent pattern.
3. **`EntitySwitcher` is not reused for the dashboard's entity-card row.** It's a Client Component implementing a single-select tab toggle (`router.push`, one active entity); the dashboard needs always-show-both stat cards with no active/selected concept. A new Server Component (`dashboard-entity-card.tsx`) is cleaner than gutting `EntitySwitcher`'s interaction model and forcing an unneeded client boundary onto the dashboard. `EntitySwitcher` is unchanged and stays in use on the per-entity detail view.
4. **Uncashed-checks query scoped to `flow='expense'`, not just `paymentMethod='check'`.** "Uncashed checks" is a check-writer's-eye-view concept (checks the club wrote that a payee hasn't cashed); a `flow='income'` check-tagged row (an incoming check payment) is a different concept and would carry the wrong meaning if it ever appeared unreconciled in this list. The dev-DB spot-check found the one existing `check`/`income` row is already reconciled, so this doesn't change today's output — it's forward-looking correctness.
5. **Aged-public-fund guardrail detail text gains fund names via an additive, optional field**, not a breaking change to `AgedPublicFundFact`/`GuardrailsInput`. `fundName` is optional on `AgedPublicFundFact` (the 11 existing `countAgedPublicFunds` test literals don't set it and keep compiling); `agedPublicFundNames?: string[]` is a new optional `GuardrailsInput` field; a private `isAgedPublicFund()` predicate is shared between `countAgedPublicFunds()` and the new `agedPublicFundNames()` so the count and the name list can never disagree — same reuse discipline `fundBalanceCents()` established under DECISION-028/029.

**Rationale:**

Each of these follows the same underlying principle: match this codebase's own established precedent (Approvals table, `fundBalanceCents()` reuse, additive/optional field conventions already used throughout `GuardrailsInput`) rather than introduce a new pattern, even where introducing one wouldn't be wrong in isolation. The error-boundary and `EntitySwitcher` calls both protect the Server-Component-by-default invariant from a plausible but unnecessary client-boundary creep.

**Impact:**

- `src/lib/ledger.ts` — `AgedPublicFundFact.fundName?: string`, private `isAgedPublicFund()`, new `agedPublicFundNames()`, `GuardrailsInput.agedPublicFundNames?: string[]`, `guardrails()` detail-string change, new `daysSinceTxnDate()`.
- `src/lib/ledger-queries.ts` — `EntityOverview` widened (`syncStaleTxns`, `unreconciledPriorMonth`); new `getDashboard()` and its exported types (`DashboardData`, `DashboardEntitySummary`, `EntityTaggedGuardrailFlag`, `UncashedCheckRow`).
- `src/app/(dashboard)/admin/ledger/page.tsx` and four new files under `src/components/admin/ledger/` — see full component plan in the work-log.
- No schema change. No new `FEATURES` key.
- Full design: `docs/work-log/2026-07-20-ledger-dashboard.md`, Phase 3 — Technical Design.

---

## DECISION-031: Ledger Dashboard — same route (searchParams-keyed), new `getDashboard()` query function rather than widening `getOverview()`

**Status:** Resolved
**Date:** 2026-07-20

**Decision:**

Phase 2 architectural review for the Ledger Dashboard feature (work-log: `docs/work-log/2026-07-20-ledger-dashboard.md`). Two rulings:

**Ruling A — Route structure.** `/admin/ledger` stays a single `page.tsx`, keyed by `searchParams`: no `entity` param renders the new two-entity dashboard; `?entity=<slug>&fy=<year>` renders the existing per-entity detail view, unchanged. No new nested route (`/admin/ledger/[entitySlug]`). Every existing internal link in this surface (fund cards, reimbursements, reports, fund-report quick links) already passes `entity=`/`fy=` explicitly and needs zero changes. The admin sidebar's "Ledger" item already points at bare `/admin/ledger` — under this ruling it lands on the dashboard, exactly the desired top-of-nav UX, for free. `[fundSlug]` stays a genuinely nested route because a fund is a distinct sub-resource; dashboard-vs-detail is a view-mode toggle on the same resource, correctly modeled as a query param per Next.js App Router convention.

**Ruling B — Query-layer shape.** A new `getDashboard()` function in `src/lib/ledger-queries.ts`, not an extension of `EntityOverview`/`getOverview()`. `getOverview()` is single-entity and FY-scoped by contract; the dashboard needs a different shape (both entities' summaries, a cross-entity uncashed-checks list, cross-entity audit-item counts) that would break `EntityOverview`'s single-entity contract for every existing consumer if bolted on. `getDashboard()` composes two `getOverview()` calls (current FY per entity, in parallel via `Promise.all`, matching the page's existing batch-fetch style) plus one new cross-entity query for unreconciled check-method transactions. Separately, `EntityOverview` gets a minimal *additive* widen — `syncStaleTxns` and `unreconciledPriorMonth`, both already computed inside `getOverview()` but not returned (Phase 1 Gap #4) — since exposing already-computed per-entity fields is compatible with the existing contract, unlike making the function itself cross-entity.

**Rationale:**

`getOverview()` is already ~300 lines and has been the subject of two correctness bug fixes in the preceding 24 hours (DECISION-028, DECISION-029), both rooted in logic — guardrail inputs, cross-FY rollforward — accreting inline inside one DB-bound function with no unit-test seam. Adding a third responsibility (cross-entity dashboard aggregation) would repeat the exact anti-pattern DECISION-028's rationale named as the root cause. A dedicated `getDashboard()` keeps `getOverview()`'s single-entity contract stable, gives the new cross-entity aggregation its own seam, and follows the batch-fetch discipline established in DECISION-027 Ruling A (one new query, not N+1).

**Impact:**

- `src/lib/ledger-queries.ts` — new `getDashboard()` function; `EntityOverview` type widened with `syncStaleTxns: number` and `unreconciledPriorMonth: number`.
- `src/app/(dashboard)/admin/ledger/page.tsx` — branches on presence/validity of the `entity` searchParam; no new route file.
- No schema change. Structured `checkNumber` column (Phase 1 Gap #1) stays explicitly out of scope for this feature — a `treasurer-todo.md` follow-up item, not a migration riding along with this work.
- Full design: `docs/work-log/2026-07-20-ledger-dashboard.md`, Phase 2 — Architectural Review.

---

## DECISION-030: Philanthropy/impact reporting counts TRUE GIFTS only — fundraising-overhead and operational spend excluded via a new per-category `counts_as_giving` flag, with conservative null-inclusion

**Status:** Resolved
**Date:** 2026-07-20

**Decision:**

`/members/impact` (all-time/current-FY giving totals, giving by cause, giving by fiscal year, recent named gifts) previously counted every posted, non-transfer expense row on an `activity`/`charitable`/`scholarship` fund as philanthropic giving. That predicate over-counted: fundraising event costs, general operations, and insurance & bonding are real expenses against public/charitable funds but are not gifts given to a cause — they are the overhead of running the club/Foundation. A new `ledger_categories.counts_as_giving` boolean (`NOT NULL DEFAULT true`) marks categories whose spend is operational/fundraising overhead; `false` excludes a category's transactions from philanthropy reporting even though the transaction otherwise satisfies the existing giving-eligible fund-kind rule. Three categories were flagged `false` on migration: `Fundraising event costs`, `Operations`, `Insurance & bonding` (all entities, expense flow).

The giving predicate — duplicated by design at two synced sites, `isGiving()` (`src/lib/ledger.ts`) and the SQL `WHERE` clause inside `getPhilanthropy()` (`src/lib/ledger-queries.ts`) — was extended at both sites with the same rule: `categoryCountsAsGiving !== false` (helper) / `counts_as_giving IS NOT FALSE`-equivalent via `LEFT JOIN` + `OR(isNull, = true)` (SQL). A **null or missing flag stays INCLUDED** — a transaction with no `categoryId`, or whose category has never had the flag set explicitly to `false`, is not silently dropped from the report; it keeps appearing under "Other community support." Only an explicit `false` excludes a row.

**Rationale:** The conservative null-inclusion choice was deliberate, not an oversight. `categoryId` is nullable on `ledger_transactions` (`onDelete: 'set null'`), so uncategorized or since-recategorized public-fund expenses exist and will continue to exist. Defaulting an unset/unknown flag to *exclude* would silently shrink the giving total every time a category went uncategorized or a category row was deleted — the opposite failure mode from the one this decision fixes, and harder to notice because it fails quiet rather than loud. Requiring an explicit `false` means every exclusion is a deliberate, auditable act (a migration UPDATE or a future admin toggle), never an accident of missing data.

Only surfaces that need the "true gift" meaning were touched. `determine990()` and `get990Prep()` were audited and left untouched — the 990 needs actual expense totals (operations, insurance, and fundraising costs all belong on the return), which is the opposite of what this refinement excludes; narrowing the predicate there would corrupt compliance math. `getDonor()`'s `givingHistory` (money donors give *to* the club, `flow='income'`) is a different, unrelated concept from `isGiving()` (money the club/Foundation gives *out*, `flow='expense'`) and was not touched.

**Impact:**
- `src/lib/db/schema.ts` — `ledgerCategories.countsAsGiving: boolean("counts_as_giving").notNull().default(true)`.
- `drizzle/migrations/0053_ledger_category_counts_as_giving.sql` — idempotent `ADD COLUMN IF NOT EXISTS` + guarded `UPDATE` flagging the three named categories false across all entities.
- `src/lib/ledger.ts` — `isGiving(row, fundKind, categoryCountsAsGiving?)` gains a 3rd optional parameter; existing call shape (2-arg) unaffected.
- `src/lib/ledger-queries.ts` — `getPhilanthropy()`'s two queries (aggregate fold + recent-named-gifts) both gain a `LEFT JOIN` to `ledger_categories` and the `counts_as_giving` filter.
- `src/lib/ledger-impact.test.ts` — 5 new `isGiving()` cases covering explicit `false`/`true`/`null`/omitted, and `false` stacked with an already-disqualifying fund kind.
- Dev-DB giving total: $86,682.64 → $61,999.54 (−$24,683.10 across 43 excluded transactions).
- Full work-log: `docs/work-log/2026-07-20-impact-true-gifts.md`.

---

## DECISION-029: Ledger fund opening/ending balances rolled forward past their static seed for any FY after the fund's first

**Status:** Resolved
**Date:** 2026-07-20

**Decision:**

Bug fix (display-side counterpart to DECISION-028). `getOverview()`, `getFundReport()`, and `getEntityReport()` in `src/lib/ledger-queries.ts` all computed a fund's `openingCents` for the selected FY as the raw `fund.openingBalanceCents` seed — a static value anchored once at the fund's inception (e.g. 6/30/2024) and never itself mutated — and `endingCents` as `openingCents + <selected-FY posted income> − <selected-FY posted expense>`. For any FY after the fund's first, this silently dropped every prior fiscal year's net activity from both figures. Seeded with 276 real transactions spanning FY2024-25 and FY2025-26 (`scripts/import-quicken-ledger.ts`, 2026-07-20), the bug became visible for the first time: `/admin/ledger` showed the club's Administrative Fund at $19,090.10 (the raw seed) instead of the true $16,134.12, Activity at $0.00 instead of $84.52, and the Foundation's Charitable Fund at $28,569.30 instead of $4,836.57.

**Fix:** each affected function now runs a companion "pre-FY rollforward" query — `SELECT fund_id, flow, SUM(amount_cents) FROM ledger_transactions WHERE status='posted' AND txn_date < <FY start> GROUP BY fund_id, flow`, unbounded below, posted-only — and feeds the result into a new pure function, `rolledForwardOpeningCents(seedCents, preFyTxns)` in `src/lib/ledger.ts`. That function filters defensively to `status === 'posted'` (belt-and-suspenders with the SQL WHERE clause, same defense-in-depth posture as the DECISION-026 Ruling 3 unique index) and delegates the actual summation to the existing canonical `fundBalanceCents()` — no second, hand-rolled balance formula, matching the reuse discipline DECISION-028 established. `endingCents` is then `rolledForwardOpening + <selected-FY posted income> − <selected-FY posted expense>`, unchanged in shape from before.

**Call sites fixed:** `getOverview()` (one companion query, batched across all of the entity's funds), `getFundReport()` (one companion query, single fund), `getEntityReport()` (one companion query, batched across all of the entity's funds — mirrors `getOverview()`'s shape exactly). **Call sites already correct / unaffected:** `getComplianceOverview()`, `get990Prep()`, and the `entityBalance` sums inside `getEntityReport()`/`getOverview()` all derive their entity-level balance by summing `fundSummaries[].endingCents` or `fundReports[].endingCents` — once the three primary functions were fixed, these derived sums became correct automatically with no code change. The `agedPublicFunds` guardrail path (Query A2 + `countAgedPublicFunds()`, DECISION-028) was already cross-FY-correct by construction and was not touched.

**Behavioral note:** `entityBalanceCents` fed into `guardrails()` (Check 4 — reserves below threshold — and Check 6 — negative fund balance, per-fund) now reflects the TRUE rolled-forward balance rather than a FY-scoped delta-only figure. This is a correctness fix, not a meaning change: both checks' intent was always "is the club's real money low or negative right now," and the FY-scoped figure was silently wrong for any FY after a fund's first.

**Rationale:** Reusing `fundBalanceCents()` rather than hand-rolling a third balance formula keeps every "balance" in the codebase provably identical in arithmetic (same discipline DECISION-028 established for the cross-FY aged-funds figure). Filtering defensively inside `rolledForwardOpeningCents()` even though the SQL query already filters to `status='posted'` follows the project's established defense-in-depth pattern (DECISION-026 Ruling 3) and — unlike the SQL-only alternative — gives this money-figure computation a real Vitest seam, since `ledger-queries.ts` functions have no DB-mocking test infrastructure in this codebase (same gap DECISION-028's rationale names).

**Impact:**
- `src/lib/ledger.ts` — new exported `rolledForwardOpeningCents(seedCents, preFyTxns)`.
- `src/lib/ledger-queries.ts` — new pre-FY rollforward query + `rolledForwardOpeningCents()` call in `getOverview()`, `getFundReport()`, `getEntityReport()`. `FundReport`/`FundSummary` type doc comments updated to describe the rolled-forward `openingCents` contract.
- `src/lib/ledger.test.ts` — new `describe("rolledForwardOpeningCents", ...)` block: first-FY regression, later-FY rollforward with the real repro numbers, pre-FY pending/rejected exclusion, zero-seed fund, multi-row netting.
- No schema change, no new routes.
- Full work-log: `docs/work-log/2026-07-20-ledger-balance-rollforward.md`.

---

## DECISION-028: Lions Fund-Compliance Guardrails — aged-public-fund gate corrected to a true cross-FY balance; gating logic extracted into a testable pure function

**Status:** Resolved (corrects part of DECISION-027)
**Date:** 2026-07-20

**Decision:**

QA's Phase 5 verification (2026-06-27 work-log, Bug 2) found that the aged-public-fund WARN silently fails to fire whenever a public fund's aged, undisbursed income falls entirely in a fiscal year other than the one currently selected in `getOverview()`. Root cause: the balance-positive gate reused `fundSummaries[].endingCents`, which DECISION-027's Ruling B explicitly (and incorrectly) specified as the balance source: *"The balance-positive condition is applied in the TypeScript aggregation, not SQL, using the already-computed `fundSummaries[].endingCents`."* That field is bound to the FY window passed into `getOverview()` — it is not the fund's true balance. This decision corrects that one sentence of DECISION-027. Ruling A (category batch-fetch) and the rest of Ruling B (dedicated query over a denormalized column) are unaffected and stand.

**Corrected design:**

1. **New companion aggregate query in `getOverview()`** (`src/lib/ledger-queries.ts`), alongside the existing (unchanged, already-correct) Query A: a `SELECT fund_id, flow, SUM(amount_cents) FROM ledger_transactions WHERE fund_id IN (<publicFundIds>) AND status='posted' AND flow IN ('income','expense') GROUP BY fund_id, flow` — no FY bound, bounded to public fund IDs only (same bounded-batch discipline as DECISION-027).
2. **Reuse the existing canonical balance function**, `fundBalanceCents(openingCents, postedTxns)` (already defined in `src/lib/ledger.ts`, already unit-tested, already imported into `ledger-queries.ts` but previously unused there) — called once per public fund with two synthetic `FlowRow` entries built from the new query's per-flow sums. This guarantees the cross-FY figure uses **exactly** the same arithmetic as every other balance in the system; no second, hand-rolled definition of "balance" is introduced.
3. **New exported pure function `countAgedPublicFunds()`** in `src/lib/ledger.ts`, alongside `guardrails()`. Takes an array of per-fund cross-FY facts (`fundKind`, `crossFyBalanceCents`, `oldestPostedIncomeDate`), a threshold, and an injectable `now`, and returns the count. `getOverview()` builds this fact array from the fund rows + the new query + the existing (unchanged) Query A, and calls this function instead of inline-filtering `fundSummaries`.
4. **`GuardrailsInput` / `guardrails()` signature is unchanged.** The bug and its fix are entirely upstream of `guardrails()`, which still receives a flat `agedPublicFunds: number` count. No change to the pure gating function or its existing 5 unit tests.

**Rationale:**

The extraction into `countAgedPublicFunds()` is the direct fix for the coverage gap QA flagged: the original aggregation lived inline inside `getOverview()`, a DB-bound function with no unit-test seam in this codebase (confirmed: no test file exercises `getOverview()` today), so the FY-scoping defect had no layer capable of catching it before a live click-through. A pure function taking plain data and returning a count can be — and now is — unit tested directly with fixture data that reproduces QA's exact scenario (a fund whose cross-FY balance is positive but whose FY-scoped view would read $0), closing the gap at the layer where it actually belongs rather than asking QA to invent DB-mocking infrastructure under loop-back pressure.

**Impact:**

- `src/lib/ledger-queries.ts` — new companion query in `getOverview()`; `agedPublicFundsRaw` computation rewritten to call `countAgedPublicFunds()`.
- `src/lib/ledger.ts` — new exported `countAgedPublicFunds()` function and its input type, placed near `guardrails()`.
- `src/lib/ledger.test.ts` — new `describe("countAgedPublicFunds", ...)` block, including a named regression test for the exact FY-scoping failure QA reproduced. No change to the existing `guardrails()` Enhancement-1 tests.
- No schema change. No change to `GuardrailsInput`'s shape or `guardrails()`'s existing tests.
- Full design: `docs/work-log/2026-06-27-lions-fund-compliance.md`, "Phase 3 — Revised Design (loop-back from Phase 5) — 2026-07-20."

---

## DECISION-027: Lions Fund-Compliance Guardrails — cross-FY aging query approach and Enhancement 2 category-fundKind resolution strategy

**Status:** Resolved
**Date:** 2026-06-27

**Decision:**
Two architectural rulings for the Lions Fund-Compliance Guardrails feature (work-log: `docs/work-log/2026-06-27-lions-fund-compliance.md`):

**Ruling A — Enhancement 2 (direct-to-admin public income): resolve category `fundKind` via a single batch fetch before the aggregation pass, not a JOIN on `allTxns`.**

`getOverview()` currently fetches all FY transactions in one query and then aggregates in TypeScript. To compute `adminPublicIncomeCount` (income rows in an administrative fund where the category's `fundKind != 'administrative'`), the aggregation loop needs `fundKind` for each transaction's `categoryId`. The cleanest approach consistent with the file's existing N+1-avoidance pattern:

1. After fetching `allTxns`, collect the distinct `categoryId` values that appear on income rows in administrative funds.
2. Fetch those category rows in a single `inArray` query (at most one extra round-trip; category sets are small — typically < 20 rows per entity).
3. Build a `Map<categoryId, fundKind>` and use it in the existing TypeScript aggregation pass.

This is preferred over joining categories into the `allTxns` query because: (a) `allTxns` is already used for multiple aggregation purposes and adding a LEFT JOIN would widen every row for a check that only applies to a small subset; (b) the precedent in `getFundReport()` and `getEntityReport()` is exactly this pattern — fetch categories separately, merge in TypeScript; (c) the category set for an entity is bounded and small enough that a batch fetch is cheap and idiomatic. The `get990Prep()` SQL approach (inline LEFT JOIN) is a counter-precedent but is appropriate there because the entire function is a single SQL GROUP BY — not a TypeScript aggregation pass.

**Ruling B — Enhancement 1 (aging guardrail): use a dedicated cross-FY aggregate query, not a denormalized column.**

The aging check needs the oldest posted income date for each public fund (kind ∈ activity/charitable/scholarship) across all fiscal years, where the fund's current balance is positive. The two options were:

- Option 1: A small dedicated SQL query added to `getOverview()` — one extra DB round-trip, computes `MIN(txn_date)` per fund over all posted income rows with no FY bound, filtered to public funds.
- Option 2: A denormalized `ledger_funds.oldest_posted_income_date` column maintained on every insert/update/delete of an income transaction.

**Ruling: use Option 1 (dedicated query).** Rationale: a denormalized column (Option 2) introduces a write-time maintenance obligation that spans every income transaction mutation path (record, approve, reject, hard-delete) — four distinct touch points, each requiring the column to be recalculated. A bug in any one of those paths silently corrupts the guardrail. Option 1 is a single read-time query that is always correct by definition. The performance cost is one additional DB query per `getOverview()` call, which is acceptable — `getOverview()` already runs multiple round-trips (entity, funds, settings, transactions) and this query returns O(N-funds) aggregate rows, not O(N-transactions) data.

**Correctness of the "unspent" proxy:** The metric is "oldest posted income date on a fund where the current balance is positive." This is a conservative proxy — a fund with $0 net balance but old income and old offsetting expenses will NOT fire (correct: the money was spent). A fund with any positive balance AND old income will fire. This matches the analyst's G-3 specification. The query is: `SELECT fund_id, MIN(txn_date) as oldest_income_date FROM ledger_transactions WHERE flow='income' AND status='posted' AND fund_id IN (<public-fund-ids>) GROUP BY fund_id`. The balance-positive condition is applied in the TypeScript aggregation, not SQL, using the already-computed `fundSummaries[].endingCents`.

**Rationale:**
The N+1-free discipline in `ledger-queries.ts` is worth preserving — but N+1 means unbounded per-row round-trips, not "more than two queries." A bounded batch fetch (Ruling A) and a single aggregate query (Ruling B) both stay within the spirit of the file's documented strategy. Denormalized columns that mirror computed values across multiple write paths are a consistent source of drift bugs and are the wrong tool when a read-time query is fast and correct.

**Impact:**
- `getOverview()` in `src/lib/ledger-queries.ts` gains one new batch-fetch for category `fundKind` (Ruling A) and one new cross-FY aggregate query for oldest income date (Ruling B).
- `GuardrailsInput` in `src/lib/ledger.ts` gains two new fields: `agedPublicFunds: number` and `adminPublicIncomeCount: number`.
- `ledger_settings` in `src/lib/db/schema.ts` gains `holdingPeriodWarnDays: integer` (default 365). A matching idempotent migration is required.
- No new npm dependencies, routes, or directories. All changes are confined to `src/lib/ledger.ts`, `src/lib/ledger-queries.ts`, `src/lib/db/schema.ts`, and `drizzle/migrations/`.

---

## DECISION-026: `deriveAckType()` — quid-pro-quo type takes precedence over written-ack when both thresholds are met; `amountCents` on `ledgerAcknowledgments` is immutable after creation; DB-level unique index on `donation_txn_id` is defense-in-depth

**Status:** Resolved
**Date:** 2026-06-26

**Decision:**
Three implementation-level rulings for the Ledger inc6a acknowledgment feature:

1. **`deriveAckType` precedence when both thresholds are met.** When a gift is both ≥ $250 (written-ack threshold) AND carries a quid-pro-quo FMV ≥ $75 (disclosure threshold), the derived type is `'quid_pro_quo_75'`, not `'written_ack_250'`. Rationale: the quid-pro-quo disclosure obligation is stricter — it requires itemizing the FMV of goods/services received. A `written_ack_250` letter that omits the quid-pro-quo FMV would be legally insufficient. Using `'quid_pro_quo_75'` when both apply ensures the treasurer records the FMV. Manual override (`typeOverride`) allows the treasurer to change the type when the auto-derived result is wrong.

2. **`amountCents` on `ledgerAcknowledgments` is immutable after creation.** The `PATCH /api/admin/ledger/transactions/[id]/acknowledge` (mark-sent) route does not accept `amountCents` in the request body. The column is copied from the linked transaction at ack-creation time and never updated. If the underlying transaction's amount is corrected after the ack is created, the ack retains the amount that was acknowledged — which is the legally correct amount to state in the letter. A note is surfaced in the UI if the ack amount diverges from the current transaction amount (a simple display-layer comparison; no structural enforcement needed).

3. **Unique index on `ledgerAcknowledgments(donationTxnId)` as defense-in-depth.** The API already enforces one-ack-per-transaction at the application layer, but a DB-level unique index (`CREATE UNIQUE INDEX IF NOT EXISTS ix_ledger_acks_unique_txn ON ledger_acknowledgments(donation_txn_id)`) provides a second line of defense against race conditions (two simultaneous POST requests for the same transaction). The index is included in `0051_ledger_donors.sql`. The application-layer check returns a user-readable 409 before the DB constraint would trigger, so the raw `DatabaseError` from the constraint is a backstop, not the primary error path.

**Rationale:**
Ruling 1 flows from IRS Pub 1771: a quid-pro-quo contribution over $75 requires disclosure of the FMV of goods/services. A written acknowledgment alone is insufficient if goods/services were provided. Erring on the side of the stricter type is the only correct default.

Ruling 2 is the standard approach for legal acknowledgment records: the letter states what was received by the organization at the time the relationship was recorded, not a later-revised figure. Allowing the ack amount to drift with transaction edits would make the record misleading.

Ruling 3 is consistent with the existing unique-constraint pattern on `ledger_transactions(dues_payment_id)` (DECISION-025). Small implementation cost, prevents a hard-to-debug data integrity issue.

**Impact:**
- `src/lib/ledger.ts` — `deriveAckType(amountCents, quidProQuoValueCents)` returns `'quid_pro_quo_75'` when `quidProQuoValueCents >= 7500`, regardless of whether `amountCents >= 25000`.
- `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts` (PATCH) — no `amountCents` field accepted.
- `drizzle/migrations/0051_ledger_donors.sql` — includes `CREATE UNIQUE INDEX IF NOT EXISTS ix_ledger_acks_unique_txn ON ledger_acknowledgments(donation_txn_id)`.
- Vitest tests for `deriveAckType` must include the case: $300 gift + $75 quid-pro-quo → `'quid_pro_quo_75'`.

---

## DECISION-025: Dues↔Ledger coupling — same-transaction-atomic via `src/lib/dues-ledger-sync.ts`; `sync_stale` marker for reconciled-conflict

**Status:** Resolved
**Date:** 2026-06-26

**Decision:**
Six structural rulings for the Ledger inc 6a dues↔ledger auto-post feature:

1. **Helper module:** `src/lib/dues-ledger-sync.ts` (new file). Exports `syncDuesCreate(tx, payment)`, `syncDuesUpdate(tx, paymentId, patch)`, `syncDuesDelete(tx, paymentId)`. Accepts a Drizzle transaction client `tx`, never `db` directly — callers must wrap in `db.transaction()`.

2. **Atomicity:** The three dues API routes (`POST`, `PATCH`, `DELETE` on `/api/admin/dues/[memberId]`) wrap their existing DB write + the sync helper call in a single `db.transaction()`. The dues write and the ledger write either both commit or both roll back. Exception: if `getAdministrativeFundId()` returns null (configuration error — Administrative fund not seeded), the sync call throws; the catch block inside the transaction logs the error and sets a `syncFailed: true` flag on the response body without re-throwing, so the dues write still commits. This is the one best-effort carve-out: a dues payment without a ledger row is recoverable; a rolled-back dues payment is data loss.

3. **Idempotency:** `ledger_transactions` gains a `dues_payment_id uuid UNIQUE REFERENCES dues_payments(id) ON DELETE SET NULL` column. The unique constraint enforces one ledger row per dues payment. `ON DELETE SET NULL` (not CASCADE) is required: a hard-deleted dues payment must not cascade-delete a possibly-reconciled ledger row.

4. **Reconciled-conflict marker:** `ledger_transactions` gains a `sync_stale boolean NOT NULL DEFAULT false` column. When a dues payment is edited (PATCH) or deleted (DELETE) and its linked ledger row has `reconciled = true`, the sync helper sets `sync_stale = true` on the ledger row without modifying any other financial fields. The dues change proceeds. The dues API returns `{ syncStale: true }` in the response body. The `sync_stale` flag is surfaced in `guardrails()` (`src/lib/ledger.ts`) as a WARN-severity flag fed by a `syncStaleTxns` count added to `getOverview()` in `ledger-queries.ts`.

5. **Dependency direction:** Dues feature → ledger schema. `src/lib/dues-ledger-sync.ts` imports from `src/lib/db/schema.ts` (ledger tables) and `src/lib/ledger-queries.ts` (fund lookup). The ledger feature does not import from the dues feature. This direction is correct: the ledger is core infrastructure (shipped v1.20.0); dues is a feature that posts income to it.

6. **`donor_id` column on `ledger_transactions`:** A nullable `donor_id uuid REFERENCES ledger_donors(id) ON DELETE SET NULL` column is added to `ledger_transactions` to link Foundation income transactions to a donor record (independent of the acknowledgment). The acknowledgment table (`ledger_acknowledgments`) also carries `donor_id` for direct ack-to-donor linkage.

**Rationale:**
Same-transaction-atomic is the correct default for financial writes. The two alternatives considered were: (a) best-effort fire-and-forget (dues write commits first; ledger insert attempted after) — rejected because a crash between the two writes leaves dues recorded without a ledger entry, a silent discrepancy; (b) ledger-first (insert ledger row first, dues payment second) — rejected because failure-mode semantics are harder to reason about and the dues payment is the authoritative record. Atomic-with-catch satisfies both the data-integrity requirement and the practical requirement that a configuration error not block dues recording.

Placing the helper in `dues-ledger-sync.ts` rather than inside `ledger-queries.ts` isolates the cross-feature concern: the ledger query layer should not know about dues payments, and the dues routes should not know about ledger internals. The sync module is the explicit seam.

`ON DELETE SET NULL` on the `dues_payment_id` FK (rather than CASCADE) is required because a reconciled ledger transaction is part of the club's audited financial record; it must not be silently removed because someone deleted its source dues payment. `sync_stale` provides the signal for the treasurer to resolve the discrepancy manually.

**Impact:**
- New file: `src/lib/dues-ledger-sync.ts`.
- `src/lib/db/schema.ts` — `ledgerTransactions` gains `duesPaymentId` (uuid, unique, nullable, FK → dues_payments ON DELETE SET NULL) and `syncStale` (boolean, NOT NULL DEFAULT false) and `donorId` (uuid, nullable, FK → ledger_donors ON DELETE SET NULL).
- New tables in `schema.ts`: `ledgerDonors`, `ledgerAcknowledgments`.
- New idempotent migration: `drizzle/migrations/0051_ledger_donors_acks_dues_sync.sql` (or next sequential number — database-admin assigns).
- `src/app/api/admin/dues/[memberId]/route.ts` (POST) — wrapped in `db.transaction()`, calls `syncDuesCreate`.
- `src/app/api/admin/dues/[memberId]/[paymentId]/route.ts` (PATCH, DELETE) — wrapped in `db.transaction()`, calls `syncDuesUpdate` / `syncDuesDelete`.
- `src/lib/ledger.ts` — new `syncStaleTxns` input to `guardrails()`; new WARN flag.
- `src/lib/ledger-queries.ts` — `getOverview()` adds `syncStaleTxns` count.
- New API routes: `src/app/api/admin/ledger/donors/route.ts`, `src/app/api/admin/ledger/donors/[id]/route.ts`, `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts`.
- New proxy route: `src/app/api/admin/ledger/acknowledgments/[id]/letter/route.ts`.
- New admin pages: `src/app/(dashboard)/admin/ledger/donors/` (list + detail with ack tab or sub-route — tech-lead decides per Suggestion 1).

---

## DECISION-024: `isGiving()` definition — fund-kind+flow+transfer-check only; null-party rows excluded from recent gifts

**Status:** Resolved
**Date:** 2026-06-26

**Decision:**
Two implementation-level rulings for the Ledger inc5 Impact Dashboard:

1. **`isGiving()` uses fund-kind + flow + transfer-check only — no category keyword matching.** The pure helper in `src/lib/ledger.ts` defines "giving" as: `flow === 'expense'` AND `transferGroupId === null` AND `fund.kind IN ('activity', 'charitable', 'scholarship')`. Category keywords (donation/grant/scholarship/vision/relief/screening) mentioned in the feature doc are NOT part of the definition. The SQL giving predicate in `getPhilanthropy()` in `src/lib/ledger-queries.ts` uses the same three-condition rule. Both definitions carry a cross-reference comment requiring sync.

2. **Null-`party` rows are excluded from the "Recent named gifts" section.** The `getPhilanthropy()` recent-gifts query adds `AND party IS NOT NULL` so that giving rows without a named recipient do not produce "Unnamed recipient: $X" entries. These rows are fully captured in all-time, current-FY, by-cause, and by-FY totals — only the named-recipients display excludes them.

**Rationale:**

_Category keywords:_ The feature doc lists category keywords as a secondary gate on `isGiving()`. However, categories are free text entered by the treasurer — any keyword list will silently miss transactions with unexpected category names (e.g., "youth program" vs. "Youth Programs"). The fund-kind gate (`kind IN ('activity','charitable','scholarship')`) is deterministic: it enforces the Administrative fund exclusion at the domain boundary and is identical in the pure helper and the SQL predicate. Adding keyword matching on top would diverge: the pure helper would need to check `categoryName`, which is not on the transaction row itself (it requires a join), making the helper no longer "pure." Keeping the rule to fund-kind+flow+transfer-check makes the helper fully testable without DB access and the SQL predicate fully consistent.

_Null party in recent gifts:_ A "Recent named gifts" section has user value when it names specific recipients ("$2,000 to Westerville Food Pantry"). A null-party entry adds no value and would require a placeholder ("Unnamed recipient") that confuses members. The aggregate sections (by-cause, by-FY, all-time total) capture every giving dollar including those without a named payee. Excluding null-party rows from only the recent-gifts display is the minimal change that keeps the section meaningful.

**Impact:**
- `src/lib/ledger.ts` — `isGiving(row, fundKind)` checks `row.flow`, `row.transferGroupId`, and `fundKind` only. No `categoryName` or keyword matching.
- `src/lib/ledger-queries.ts` — `getPhilanthropy()` SQL predicate: `status='posted' AND transfer_group_id IS NULL AND flow='expense' AND fund.kind IN ('activity','charitable','scholarship')`.
- `getPhilanthropy()` recent-gifts query adds `AND party IS NOT NULL`.
- Vitest tests include a case confirming that `isGiving()` returns true for an `administrative` fund → false (the exclusion is a fund-kind check, not a status or category check).

---

## DECISION-023: `csvCellSafe()` for ledger CSV export — injection guard lives in the export route, not in a shared util; dues `csvCell()` left unchanged

**Status:** Resolved
**Date:** 2026-06-25

**Decision:**
The ledger CSV export route (`src/app/api/admin/ledger/export/route.ts`) defines its own `csvCellSafe()` helper that extends the dues `csvCell()` logic with a leading-character injection guard: if a cell value's first character is `=`, `+`, `-`, or `@`, a tab character (`\t`) is prepended before any quoting step. This guards against spreadsheet formula injection (CVE-class: CSV injection). The existing `csvCell()` in `src/app/api/admin/dues/export/route.ts` is NOT modified. A Vitest unit test for `csvCellSafe()` is required before the export route ships.

The `csvCellSafe()` helper is applied to every free-text column (Category, Party/Payee, Memo in the transaction CSV; Line/Group and any category-derived label in the 990-prep CSV). Controlled-value columns (Date, Fund, Flow, Amount, Status, Reconciled, Payment Method) use a plain `csvCell()` inline (no injection guard needed — values are server-generated enums or formatted numbers).

**Rationale:**
Placing `csvCellSafe()` in the export route rather than extracting it to a shared util avoids pulling ledger-specific security logic into a file shared by unrelated exports. The dues export fields are all admin-controlled (no free-text from untrusted input); the ledger `party` and `memo` fields are free-text entered by treasurers and could contain `=` or `+`. The two helpers have different correctness requirements. Retroactively patching `csvCell()` in the dues export is out of scope for inc4; that surface will be caught in the next security review. The tab-prepend approach is the standard published defense (OWASP CSV Injection); it is invisible in most spreadsheet apps under normal rendering.

**Impact:**
- New local function `csvCellSafe()` in `src/app/api/admin/ledger/export/route.ts`.
- New Vitest unit test file (location: co-located or in `src/lib/__tests__/csv-ledger-export.test.ts`); minimum 8 cases (see Phase 3 design doc).
- `src/app/api/admin/dues/export/route.ts` — no change.
- Security review must audit whether `csvCell()` in the dues export should also be upgraded; flagged for the next 30-day security review.

---

## DECISION-022: `ledger_filings` 5-year cadence stored as `next_due_year integer`; `listFilings` includes a 5-year row only when `nextDueYear === fiscalYear + 1`

**Status:** Resolved
**Date:** 2026-06-25

**Decision:**
The `Statement of Continued Existence` (Ohio SOS, every 5 years) and any future `recurrence='5_year'` filing row is controlled by a `next_due_year integer` column on `ledger_filings`. The value is the **calendar year** in which `due_month/due_day` falls for the next required filing (e.g., `next_due_year=2030` means the filing is due `due_month/due_day` in calendar year 2030, which is inside FY2030 for a Lions Jul–Jun FY).

`listFilings(entityId, fiscalYear)` includes a `recurrence='5_year'` row only when `nextDueYear === fiscalYear + 1`. (The `+1` maps a FY start-year to the second calendar year that falls inside it, where months 1–6 land — Nov 15 of FY2029 = Nov 15 2029. Wait — Nov is month 11 ≥ 7, so it lands in the *first* calendar year of the FY. Nov of FY2029 = Nov 2029 = `fiscalYear + 0`. So the correct test for "does this row's due date fall inside `fiscalYear`?" is `nextDueYear === fiscalYear` for months ≥ 7 and `nextDueYear === fiscalYear + 1` for months < 7. Because the Statement of Continued Existence is due Nov 15 (month 11 ≥ 7), the correct test is `nextDueYear === fiscalYear`. `listFilings(2029)` includes the row when `next_due_year = 2029`.)

**Correction on filter predicate:** After applying `computeDueDate` logic (month ≥ 7 → same calendar year as FY start; month < 7 → FY start + 1), the test is:
- Month ≥ 7 (like Nov): `next_due_year === fiscalYear`
- Month < 7: `next_due_year === fiscalYear + 1`

Simplest implementation: `listFilings` computes the expected calendar year for the row's due month (`dueMonth >= 7 ? fiscalYear : fiscalYear + 1`) and compares to `nextDueYear`. Rows that do not match are excluded from the returned set.

On rollover, `ensureFilingsForFY` sets `next_due_year = prior.nextDueYear + 5`. The new row is a copy in the DB for every FY, but surfaces only in the FY where the computed calendar year matches.

**Rationale:**
Two simpler alternatives were considered:
- (a) Store a boolean `isDueThisFY` — requires updating the column every year, which adds write complexity to the rollover and is fragile if a year is skipped.
- (b) Compute the due year entirely from the seed year: `(fiscalYear - seedFY) % 5 === 0` — requires storing the `seedFY` on the row or hardcoding it in the query helper. It also makes the query helper dependent on knowing the original seed year, which would break if the entity's filings are ever re-seeded.

Storing `next_due_year` as an explicit column is the smallest, most self-contained approach: the value is always correct for the row at hand, rollover is a `+5` arithmetic operation, and the filter in `listFilings` is a single equality check. No external seed-year constant needed.

**Impact:**
- `ledger_filings` has a `next_due_year integer` column (nullable for `recurrence='annual'` rows; non-null for `recurrence='5_year'`).
- `listFilings` filters 5-year rows: `row.nextDueYear === (row.dueMonth >= 7 ? fiscalYear : fiscalYear + 1)`.
- `ensureFilingsForFY` sets `next_due_year = CASE WHEN recurrence = '5_year' THEN next_due_year + 5 ELSE NULL END` in the rollover INSERT.
- Migration seed for the Statement of Continued Existence seeds `next_due_year = 2030` (placeholder — the actual next Ohio SOS renewal year should be confirmed with the treasurer before the migration goes to production).

---

## DECISION-021: `ledger_filings` due-date storage — `dueMonth` + `dueDay` integers; rollover is an explicit idempotent `ensureFilingsForFY()` step, not write-on-read

**Status:** Resolved
**Date:** 2026-06-25

**Decision:**
Two data-shape rulings for the `ledger_filings` table in Ledger inc3 (Compliance):

1. **Due-date column shape:** Store `due_month integer NOT NULL` (1–12) and `due_day integer NOT NULL` (1–31) on `ledger_filings` in place of an absolute `due_date date` column. The absolute due date for display and overdue-check purposes is computed at query time as `make_date(fiscal_year_start_year + 1 if due_month < fy_start_month else fiscal_year_start_year, due_month, due_day)` — for the Lions Jul–Jun FY, months 1–6 land in the fiscal-year's second calendar year and months 7–12 land in the first. `listFilings(entityId, fiscalYear)` materializes each row's `dueDate` from these two columns. The seed data records real month/day pairs (e.g., IRS 990-N: `due_month=11, due_day=15`; Ohio Unclaimed Funds: `due_month=11, due_day=1`). The 5-year `Statement of Continued Existence` carries `recurrence='5_year'`; `listFilings` computes its next due-year at query time by finding the nearest multiple-of-5 boundary from the entity's first filing year.

2. **Auto-rollover mechanism:** The FY materialization is NOT a write-on-read side-effect inside `listFilings`. Instead, a dedicated `ensureFilingsForFY(entityId, fiscalYear)` server-action/helper inserts the next FY's rows (by copying the prior year's `agency`, `title`, `due_month`, `due_day`, `recurrence` and assigning `status = 'not_started'`) if none exist for that FY. This function is idempotent (`INSERT … ON CONFLICT DO NOTHING` keyed on `(entity_id, fiscal_year, agency, title)`). It is called: (a) once as an idempotent seed step in the migration for the current FY; (b) explicitly on first navigation to the compliance page when no rows exist for the requested FY (a server component calls it before rendering). `listFilings` is a pure read; it never inserts.

**Rationale:**

_Due-date shape:_ Storing an absolute `date` per row (e.g., `2026-11-15`) is correct for the seed FY but drifts on rollover — a copy that bumps the year field by 1 works for most rows but silently produces wrong dates for any filing that crosses the calendar-year boundary inside a Jul–Jun FY (e.g., a March filing in FY2026 is March 2027, not March 2026). The month/day column pair + FY-aware computation is deterministic, rollover-safe, and makes the seed data readable without requiring date arithmetic in the migration.

_Rollover mechanism:_ A write-on-read `listFilings` is architecturally problematic: (a) it violates the convention that `GET` requests on this codebase are side-effect-free — a `SELECT` that may do an `INSERT` is invisible to callers, difficult to test, and can produce duplicate-insert races under concurrent requests; (b) the existing codebase has no precedent for write-on-read query helpers, and introducing one would require special-casing in the API route middleware (no read-lock, no idempotency guard). An explicit `ensureFilingsForFY()` call in the server component is consistent with the `getSettings()` + singleton-upsert pattern already in `ledger-queries.ts`, is trivially testable, and its idempotency is provable from the `ON CONFLICT DO NOTHING` clause.

**Impact:**
- `ledger_filings` schema: `due_date date` column replaced by `due_month integer NOT NULL` + `due_day integer NOT NULL`. No `due_date` column in `schema.ts` or the migration.
- New computed-field helper in `src/lib/ledger-queries.ts`: `computeDueDate(fiscalYear, dueMonth, dueDay): Date` (exported; pure).
- `listFilings(entityId, fiscalYear)` returns rows enriched with a computed `dueDate: Date` property — it never inserts.
- New `ensureFilingsForFY(entityId, fiscalYear)` in `src/lib/ledger-queries.ts` (or a co-located `actions.ts`): idempotent INSERT … ON CONFLICT DO NOTHING.
- The compliance page server component calls `ensureFilingsForFY` before `listFilings`.
- Migration seed rows use `due_month` / `due_day` integer pairs.
- Tech-lead must specify the `computeDueDate` boundary rule (month < 7 → FY start year + 1, month ≥ 7 → FY start year) in the Phase 3 design doc. The 5-year cadence for `Statement of Continued Existence` is handled by a separate `nextDueYear` computation, also in tech-lead's design.

---

## DECISION-020: Receipt storage is pluggable via a `ReceiptStorage` interface; proxy routes stream content; store an opaque key, not a provider URL

**Status:** Resolved
**Date:** 2026-06-25

**Decision:**
Receipt file storage is exposed through a **`ReceiptStorage` interface** (three methods: `save`, `read`, `delete`) with two concrete adapters selected at runtime by environment:

- **`VercelBlobStorage`** (default in production): wraps `@vercel/blob`. Blobs are written under `receipts/<uuid>/<sanitized-name>` with `access: 'public'` but UUID-namespaced. The adapter is lazy-imported (`import()`) inside its module file so that local dev never loads the `@vercel/blob` package.
- **`LocalReceiptStorage`** (default when `BLOB_READ_WRITE_TOKEN` is absent): writes files under a `.receipt-store/` directory in the repo root (added to `.gitignore`). Reads and streams from disk. Requires zero configuration — no env var, no Vercel account.

Selection rule: `getReceiptStorage()` checks `process.env.BLOB_READ_WRITE_TOKEN`; if set, returns a `VercelBlobStorage` instance; otherwise returns a `LocalReceiptStorage` instance.

**Column rename:** `ledger_reimbursements.receipt_url` is renamed to `receipt_storage_key` (`text NOT NULL`). The column stores an opaque, provider-neutral key (e.g., `receipts/<uuid>/<filename>`) — not a full Vercel Blob URL. This is provider-agnostic and works identically for both adapters.

**Proxy routes stream bytes, not redirect.** `GET /api/members/reimbursements/[id]/receipt` and `GET /api/admin/ledger/reimbursements/[id]/receipt` call `getReceiptStorage().read(key)`, then return the raw bytes with `Content-Type: <contentType>` and `Content-Disposition: inline`. They do NOT redirect to any storage URL. The storage URL/path is never sent to the browser. This works identically for Vercel Blob and local-filesystem, and is strictly more private than a redirect.

**Upload route** returns `{ key: string }` (not `{ url: string }`). The key is stored in `receipt_storage_key`. The browser never learns the underlying blob URL or local path.

**`isBlobUrl()` is removed.** Because the upload route returns an opaque key (not a URL) and the column stores that key, there is no external-URL injection surface to validate. The Blob URL allow-list check on PATCH is replaced by a format check: the key must match the pattern `receipts/<uuid>/<filename>` and must exist in the storage (the read call returns null if not).

**`BLOB_READ_WRITE_TOKEN`** is required only in production. It is absent locally, and local dev needs no storage config at all.

**Rationale:**
DECISION-018 mandated Vercel Blob as the production storage provider — this decision does not change that. It adds a pluggability layer that fixes two problems DECISION-018 left open: (1) the original design required `BLOB_READ_WRITE_TOKEN` in local dev even though Vercel Blob cannot be used locally without network access and a real Blob store; (2) the redirect-based proxy model exposed the Vercel Blob CDN URL to the browser for the duration of the browser fetch, creating a window where the URL could be intercepted and reused without auth. Streaming the bytes from the server through the proxy closes that window and makes the two adapters behaviorally identical. The local adapter costs zero production-runtime overhead (never loaded) and zero configuration.

The `ReceiptStorage` interface also future-proofs the design: swapping to Cloudflare R2 or S3 in a future increment is a new adapter module, not a rewrite of upload/proxy routes.

**Impact:**
- New module: `src/lib/receipt-storage/index.ts` (interface + `getReceiptStorage()` factory + re-exports).
- New module: `src/lib/receipt-storage/vercel-blob.ts` (VercelBlobStorage adapter).
- New module: `src/lib/receipt-storage/local.ts` (LocalReceiptStorage adapter).
- `.receipt-store/` added to `.gitignore`.
- `src/lib/blob.ts` is **not created** (superseded by the receipt-storage module).
- `ledger_reimbursements.receipt_url` is **renamed** to `receipt_storage_key text NOT NULL` in migration `0046_ledger_controls.sql` and in `schema.ts`.
- Upload route returns `{ key }` instead of `{ url }`.
- Proxy routes (`GET .../receipt`) stream bytes via `getReceiptStorage().read(key)` instead of redirecting.
- `isBlobUrl()` helper is not needed and is not created.
- Refines DECISION-018.

---

## DECISION-019: Receipt file-type validation — hand-rolled magic-byte check, no `file-type` npm package

**Status:** Resolved
**Date:** 2026-06-25

**Decision:**
The receipt upload handler in `src/app/api/members/reimbursements/upload/route.ts` validates file type via a **hand-rolled magic-byte inspection** of the first 8 bytes of the uploaded buffer. No additional npm package (`file-type` or otherwise) is added. Supported formats and their byte signatures:

| Format | Bytes checked |
|--------|--------------|
| PDF | `25 50 44 46` (first 4: `%PDF`) |
| JPEG | `FF D8 FF` (first 3) |
| PNG | `89 50 4E 47 0D 0A 1A 0A` (all 8) |

If the buffer does not match any of these signatures, the handler returns 400. Content-Type from the request header is used as a hint for the error message only — the magic bytes are the authoritative check.

**Rationale:**
The `file-type` npm package (~50 KB, MIT, ESM-only) would work correctly for this use case. However, this project must validate exactly three MIME types (PDF, JPEG, PNG). The magic bytes for all three fit in a trivial 10-line helper function. Adding a dependency for three byte comparisons introduces: (1) a package to audit at every `pnpm audit` run; (2) ESM-only compatibility surface to manage in a Next.js App Router project; (3) ongoing maintenance cost if the package releases breaking changes. The hand-rolled check is simpler, has zero maintenance surface, is fully transparent to the reader, and is correct for the use case. The dependency evaluation criteria prefer the option already available — in this case, Node.js `Buffer` comparison — when it solves the problem adequately.

**Impact:**
- No new npm package.
- The magic-byte logic lives in `src/lib/blob.ts` (the `uploadReceipt` helper). It is unit-testable with a three-case Vitest test (valid PDF, valid JPEG, invalid content).
- If a future increment requires a broader set of supported file types (e.g., Word docs, spreadsheets), this decision should be revisited and `file-type` evaluated at that time.

---

## DECISION-018: Receipt file storage for ledger reimbursements — Vercel Blob with server-minted signed URLs

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
Receipt files for `ledger_reimbursements` are stored in **Vercel Blob** (`@vercel/blob` npm package, new dependency). Blobs are uploaded server-side from the receipt-upload route handler (never from the browser directly to Blob), minted with `put(path, stream, { access: 'public' })` but placed under a UUID path that is not guessable. All receipt reads from the member portal or admin UI go through a **server-side proxy route** (`GET /api/members/reimbursements/[id]/receipt` for the member, `GET /api/admin/ledger/reimbursements/[id]/receipt` for officers) that verifies session + ownership/permission before redirecting to the blob URL. The blob URL itself is never embedded in HTML or returned in JSON to the client; every access is mediated by a server check.

Required new env var: `BLOB_READ_WRITE_TOKEN` (Vercel Blob store token).

The `receiptUrl` column on `ledger_reimbursements` stores the full Vercel Blob URL (e.g., `https://<store>.public.blob.vercel-storage.com/<uuid>/<filename>`). File-type validation (PDF, JPEG, PNG; max 10 MB) is enforced server-side in the upload handler before writing to Blob.

The existing `receiptUrl` text field on `ledger_transactions` (ordinary transactions, FU-3) remains a paste-URL text field for now — no file-upload UX for ordinary transactions in inc2. The file-storage decision applies only to `ledger_reimbursements` in this increment.

The `public/uploads`-based upload handler at `src/app/api/admin/upload/route.ts` (used for campaign images) is left untouched; that surface is not financial and ephemeral loss there is acceptable. Receipt files are financial documents with a 7-year retention requirement — they require durable object storage.

**Rationale:**
- `public/uploads` + `writeFile` is already used for campaign images and is the only file-upload precedent in the codebase. That handler was confirmed unacceptable for receipts: Vercel's serverless runtime provides no persistent local disk, so any file written to the local filesystem is lost between invocations and certainly lost on redeployment. Financial documents with a 7-year retention requirement cannot use ephemeral storage.
- **Vercel Blob** is the correct fit: the project is deployed on Vercel, Blob is native to the platform (no cross-provider credentials, no separate CDN), it is actively maintained, and the `@vercel/blob` package adds negligible bundle weight to a server-only upload route. License: Apache-2.0.
- **Cloudflare R2 / S3** would work but introduce additional cross-provider credentials (`AWS_ACCESS_KEY_ID`, etc.) and a heavier SDK for a single use-case in a small club app. The dependency evaluation criteria prefer the option that is already available in the deploy environment.
- **Storing blobs in Postgres** (bytea) is rejected: blob columns at multi-MB scale degrade query performance across all tables sharing the DB connection pool and violate the principle of keeping the DB for structured data only.
- The access-control model (server proxy, never raw blob URL to the client) provides defense-in-depth: even if a blob URL were somehow leaked, the server route is the only entry point that links the UUID path back to a member identity or a permission check.

**Impact:**
- New npm dependency: `@vercel/blob`. Add to `package.json` (production dependency).
- New env var: `BLOB_READ_WRITE_TOKEN` — deployment-engineer must document in Vercel environment variables.
- New upload route: `src/app/api/members/reimbursements/upload/route.ts` — accepts a multipart file, validates type + size, calls `put()`, returns the blob URL to the server action (not to the browser). This is a server action or route handler intermediary, not a direct browser-to-Blob upload.
- New receipt-proxy routes: `GET /api/members/reimbursements/[id]/receipt` (auth + memberId ownership check → redirect) and `GET /api/admin/ledger/reimbursements/[id]/receipt` (auth + `LEDGER_VIEW` → redirect).
- `ledger_reimbursements.receiptUrl` column: `text NOT NULL` (required — every reimbursement must have a receipt).
- `ledger_transactions.receiptUrl` remains text (paste-URL) for ordinary transactions — no file upload in inc2 for that surface.
- Security review must audit: upload file-type sniffing (MIME type from Content-Type header is spoofable — server must also inspect the first bytes), size limit enforcement, that the blob path is UUID-namespaced (not predictable), and that the proxy routes return 404 (not 403) for IDs that exist but belong to another member.

---

## DECISION-017: Ledger `flow` column stores `'income' | 'expense'` only; `transferGroupId` is the transfer discriminator

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
The `flow` column on `ledger_transactions` takes only two values: `'income'` and `'expense'`. It does NOT store a third value `'transfer'`. For a transfer pair (two linked rows per DECISION-016), the debit row stores `flow = 'expense'` and the credit row stores `flow = 'income'`. The `transferGroupId` UUID column (non-null on both rows of a pair) is the sole discriminator used to: (a) label rows as "Transfer" in the UI, (b) enforce two-row atomic delete/edit, and (c) join transfer pairs in the inc2 firewall guardrail. No check constraint on `flow` may include `'transfer'` as a valid value.

**Rationale:**
DECISION-016 established two linked rows so that `fundBalanceCents()` can be a single-pass sum with no special cases. That property only holds if `flow` encodes the sign direction (`'income'` = positive, `'expense'` = negative) on each row independently. If `flow = 'transfer'` were stored, the balance helper would need to know whether the queried fund is the source (debit) or destination (credit) of each transfer row — reintroducing exactly the asymmetry DECISION-016 was designed to eliminate. The spec and DECISION-016 text reference `flow = 'transfer'` as the *conceptual* category, not a literal column value; this decision binds the implementation to the reading that preserves the single-pass property.

**Impact:**
- `ledger_transactions.flow` check constraint (if any): `flow IN ('income', 'expense')` — no `'transfer'`.
- `fundBalanceCents()` in `src/lib/ledger.ts`: income rows add, expense rows subtract, no other branch needed.
- UI code that renders "Transfer" derives the label from `transferGroupId IS NOT NULL`, not from `flow = 'transfer'`.
- The inc2 firewall guardrail joins on `transferGroupId` and checks `sourceFund.kind` vs `destFund.kind` — it does not filter on a `flow` value.

---

## DECISION-016: Ledger transfer representation — two linked rows via `transferGroupId`

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
Ledger transfers between funds are stored as **two linked rows** in `ledger_transactions`, not a single row with a `transferFromFundId` annotation. The debit row has `flow = 'expense'`, `fundId = sourceFundId`, and a UUID `transferGroupId`. The credit row has `flow = 'income'`, `fundId = destFundId`, and the same `transferGroupId`. Both rows share the same `entityId`, `txnDate`, `amountCents`, and `memo`. The server action that records a transfer inserts both rows atomically (a single DB transaction). Cross-entity transfers are not defined and must be rejected server-side.

The `flow = 'transfer'` discriminator is retained on both rows (alongside `transferGroupId`) so the UI can render them with a "Transfer" label, suppress the `party` required-field validation on the debit row, and so the inc2 firewall guardrail can detect Activity→Admin flows by joining on `transferGroupId` to find pairs where source `fund.kind = 'activity'` and destination `fund.kind = 'administrative'`.

**Rationale:**
The single-row design (one row, `transferFromFundId` nullable) makes `fundBalanceCents()` asymmetric: the helper cannot be a simple sum over `(fundId, flow)` tuples because transfer rows serve double duty — income for the destination fund, expense for the source fund in the same row. Every balance query and the inc2 guardrail would need to special-case this. The two-row design keeps `fundBalanceCents()` a single-pass sum with no special cases: each fund sums only its own rows. The firewall guardrail becomes a straightforward join on `transferGroupId`. Both the debit and credit appear in their respective fund ledgers as first-class rows, satisfying the audit-trail requirement symmetrically.

**Impact:**
- `ledger_transactions` gains a nullable `transferGroupId uuid` column (no FK — it is a self-join key within the same table).
- `src/lib/ledger.ts` — `fundBalanceCents()` sums all rows for a fund by sign (income positive, expense negative) with no transfer special-case.
- The server action for recording a transfer inserts two rows in a single DB transaction. The form UI collects source fund, destination fund, amount, date, memo — one submission.
- `flow = 'transfer'` is still a valid discriminator value and appears on both rows of a transfer pair.
- `transferFromFundId` column from the spec prototype is dropped — that was a demo-prototype artifact, not a schema commitment.

---

## DECISION-015: Fiscal-year convention is start-year, shared via `src/lib/fiscal-year.ts`

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
The Lions fiscal year (Jul 1 – Jun 30) is labeled by its **starting** calendar year everywhere in the app: `FY2026 = Jul 1 2026 – Jun 30 2027`. The helpers `getFiscalYear` / `currentFiscalYear` / `fiscalYearLabel` are extracted from `src/lib/dues.ts` into a single shared module `src/lib/fiscal-year.ts` (re-exported from `dues.ts` for back-compat). The forthcoming Ledger accounting feature imports from `@/lib/fiscal-year` rather than redefining it.

**Rationale:**
The Ledger prototype (`Westerville_Lions_Ledger.html`) labeled the same 12 months by their **ending** year (`FY2026 = Jul 2025 – Jun 2026`) — off by one from the shipped dues feature. Two features disagreeing on what "FY2026" means would cause treasurers to record dues and accounting against different windows and mis-file. The transparency doc's per-capita cycle (Jul 2026 → Jun 2027 as one Lions year) matches the start-year labeling already shipped in dues, so we standardize on it and give it one home.

**Impact:**
New file `src/lib/fiscal-year.ts`; `dues.ts` now re-exports the three helpers (no behavior change — dues was already start-year, so no data migration). The Ledger spec (`docs/features/the-ledger-accounting.md`, §2) and all future ledger fiscal-year math depend on this module. The prototype's end-year labeling is explicitly dropped.

---

## DECISION-014: Dues Tracking scope expansion — treasurer role, two-amount dues_settings, dues_category on members, new permission keys

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
Five implementation-level decisions added in the Phase 3 loop-back revision after scope expansion (work-log: `docs/work-log/2026-06-24-dues-tracking.md`):

1. **New `treasurer` role seeded at sort_order 3.** The existing role order (admin=1, board_member=2, member=3, volunteer=4) gains `treasurer` at position 3; `member` shifts to 4, `volunteer` to 5. The migration uses conditional UPDATEs (`WHERE name = 'member' AND sort_order = 3`) to make the bump idempotent. `ROLES.TREASURER = "treasurer"` added to `src/lib/permissions.ts`.

2. **Two permission keys replace the old single `dues.view` / `membership.manage` design.**
   - `FEATURES.DUES_VIEW = "dues.view"` — read gate. Bound to `admin` + `board_member` + `treasurer`.
   - `FEATURES.DUES_MANAGE = "dues.manage"` — write gate. Bound to `admin` + `treasurer` ONLY. `membership.manage` is NOT the dues write gate. Membership managers who are not admins or treasurers have no dues write access.
   - All read surfaces gate on `hasAnyFeature([DUES_VIEW, DUES_MANAGE])`. All write surfaces gate on `hasFeature(DUES_MANAGE)`. CSV export gates on `hasAnyFeature([DUES_MANAGE, REPORTS_EXPORT])`.

3. **`dues_settings` holds two amounts per fiscal year.** The single `expected_amount_cents` column from DECISION-013 does not exist. The table has `individual_amount_cents` and `family_amount_cents` instead. The status query resolves the applicable amount with a CASE expression keyed on `m.dues_category`. FY2026 seed: individual 12000 cents ($120.00), family 9600 cents ($96.00).

4. **New `members.dues_category` column (`text NOT NULL DEFAULT 'individual'`).** Values: `individual | family`. Set by treasurer/admin on the per-member dues detail page via `PATCH /api/admin/dues/[memberId]/category`. Existing members default to `individual` via the column default. Changing the category retroactively recomputes status for all fiscal years (acceptable at club scale; documented in UI).

5. **Named treasurer role assignments in migration.** Chris Henson (chenson42@gmail.com) and James Shively (jmshively@gmail.com) receive the `treasurer` role via idempotent email-keyed `user_roles` INSERTs in `0040_dues_tracking.sql`. Email keys (not UUID) ensure the migration works in production without hardcoding environment-specific IDs.

**Rationale:** A separate `treasurer` role with its own permission key keeps financial write access narrowly scoped without requiring new UI for role management. The two-amount design is the minimal extension for a family discount: one row per year, two columns, resolved at query time. Putting `dues_category` on the member (not per payment or per fiscal year) reflects the reality that membership type is a stable attribute of the person, not a per-year decision. Email-keyed user assignments are idempotent across environments.

**Impact:**
- `src/lib/db/schema.ts` — `duesCategory` column on `members`; `individualAmountCents` + `familyAmountCents` on `duesSettings` (no `expectedAmountCents`).
- `src/lib/permissions.ts` — `DUES_VIEW`, `DUES_MANAGE` in `FEATURES`; `TREASURER` in `ROLES`.
- `drizzle/migrations/0040_dues_tracking.sql` — DDL + treasurer role seed + sort_order bumps + FY2026 seed + user_roles bindings.
- `drizzle/migrations/0041_dues_permissions.sql` — both feature rows + role bindings.
- `src/lib/dues.ts` — `deriveStatus()` takes `(totalPaidCents, expectedCents | null)`.
- New API endpoint: `PATCH /api/admin/dues/[memberId]/category`.
- New admin component: `DuesCategoryControl` on per-member detail page.
- New admin component: `DuesConfigureModal` (two-input) on dues list page.

**Amends:** DECISION-013 — the Impact bullet for `dues_settings.expected_amount_cents` is superseded. The fiscal-year integer convention and integer-cents storage decisions in DECISION-013 remain valid and unchanged.

---

## DECISION-013: Dues Tracking — fiscal year as starting integer, amounts as integer cents, status derived on read

**Status:** Resolved (Impact amended by DECISION-014 — `dues_settings` has two amount columns, not one)
**Date:** 2026-06-24

**Decision:**
Three implementation-level data choices for the `dues_payments` and `dues_settings` tables:

1. **Fiscal year stored as a single integer (the starting calendar year).** FY2026 = Jul 1 2026 – Jun 30 2027 is stored as `fiscal_year = 2026`. The helper `getFiscalYear(date)` in `src/lib/dues.ts` maps any payment date to this integer: if the month is January–June (0–5), return `year - 1`; if July–December (6–11), return `year`. This avoids storing a date range per year and avoids any ambiguity about which year a row belongs to. Display label is `FY2026 (Jul 2026 – Jun 2027)`.

2. **Amounts stored as integer cents.** `amount_cents: integer` avoids floating-point rounding on financial values. The UI divides by 100 for display and multiplies by 100 on input. Negative values represent refunds/reversals. Zero is disallowed at the application layer (validated before insert).

3. **Dues status (Paid / Partial / Unpaid) computed on read, never stored.** Status = `COALESCE(SUM(amount_cents), 0)` for a `(member_id, fiscal_year)` pair, compared to the applicable `dues_settings` amount for that year (individual or family, per DECISION-014). No denormalized status column on `members` or `dues_payments`. This eliminates the risk of stale cached status and keeps the data model minimal; the club's scale (~100 members) makes the GROUP BY query negligible.

**Rationale:** Integer fiscal year is unambiguous and queryable with a simple equality filter. Integer cents is standard practice for financial storage at any scale. Derived status avoids the class of bugs where a stored flag diverges from the actual payment sum after an edit or delete.

**Impact:**
- `dues_payments.fiscal_year`: `integer NOT NULL`
- `dues_payments.amount_cents`: `integer NOT NULL` (non-zero enforced at app layer)
- `dues_settings`: two amount columns — `individual_amount_cents` and `family_amount_cents` (see DECISION-014; the single `expected_amount_cents` column is superseded)
- `src/lib/dues.ts` — new file: `getFiscalYear()`, `currentFiscalYear()`, `fiscalYearLabel()`, `deriveStatus()`
- No stored status column anywhere.

---

## DECISION-012: Dues Tracking — separate `/admin/dues` route, `DUES_VIEW` permission key, CSV via Response + manual encoding, member-portal path reserved

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
Four structural rulings for the Annual Membership Dues Tracking feature (work-log: `docs/work-log/2026-06-24-dues-tracking.md`):

1. **Separate `/admin/dues` route, not a tab under `/admin/membership`.** The existing `/admin/membership` route is scoped to membership *applications* (the `membership_applications` table). Dues tracking is a financially distinct domain (a `dues_payments` table linked to `members`). Merging the two would conflate a one-time intake workflow with a recurring per-year ledger, creating a surface with two unrelated data models and two unrelated permission audiences. The new route lives at `src/app/(dashboard)/admin/dues/` with its own top-level sidebar entry, gated on the new `DUES_VIEW` key. A sub-route at `src/app/(dashboard)/admin/dues/[memberId]/` holds per-member detail. The admin API handlers live under `src/app/api/admin/dues/`.

2. **New `DUES_VIEW` feature key added to the `FEATURES` catalog.** The analyst's Option A (new `dues.view` key, bound to `board_member` and `admin`) is the architecturally correct choice. Option B (grant `membership.manage` to `board_member`) would give board members write-API access even when the UI hides controls — a quiet invariant violation. `DUES_VIEW` becomes the read gate; `MEMBERSHIP_MANAGE` remains the write gate. Page-level and API-level checks use `hasFeature()` with these two keys; no second gating mechanism is introduced.

3. **Export uses `Response` with hand-rolled CSV, not `exceljs`.** The existing `exceljs` export produces an `.xlsx` file targeted at Zeffy's import format. The dues export is a plain auditor CSV (name, email, year, amount, status). Adding a 1 MB+ Excel workbook for six columns of plain text is not justified. A hand-rolled `text/csv` response — already a supported output of the native `Response` API in Node — keeps the bundle clean. `exceljs` is not introduced as a new dependency for this surface.

4. **Member self-view path reserved at `/members/dues` but not built in this increment.** If member self-view is added later, it lives in the existing `src/app/members/` route group (already authenticated), not in `/(dashboard)/admin`. No code is written for this path now; the reservation is noted so the data model (Phase 3) does not foreclose it.

**Rationale:** Separating dues from membership applications keeps each admin surface coherent. A new permission key is the only correct enforcement model for the read-vs-write split. Hand-rolled CSV avoids a new dependency. Reserving the member self-view path prevents a schema decision from accidentally locking out the future increment.

**Impact:**
- `src/app/(dashboard)/admin/dues/` — new route directory (Phase 4).
- `src/app/(dashboard)/admin/dues/[memberId]/` — new sub-route for per-member detail (Phase 4).
- `src/app/api/admin/dues/` — new API route directory (Phase 4).
- `src/components/admin/admin-sidebar.tsx` — new "Dues" entry gated on `DUES_VIEW` (Phase 4).
- `src/lib/permissions.ts` — `DUES_VIEW: "dues.view"` added to `FEATURES` (Phase 4, via add-permission skill).
- `drizzle/migrations/` — idempotent migration binding `dues.view` to `admin` and `board_member` roles (Phase 4, via add-permission skill).
- No new npm dependencies introduced.

---

## DECISION-011: Write-in Signups implementation details — `kind` discriminator, shared `AdminRsvpRow` type, no `force` flag, no server capacity check

**Status:** Resolved
**Date:** 2026-05-20

**Decision:**
Four implementation-level rulings for the Write-in Signups feature, downstream of DECISION-010:

1. **Explicit `kind` discriminator in POST body.** `POST /api/admin/events/[id]/signup` uses `{ kind: "member" | "guest", ... }` as the discriminator rather than inferring intent from the presence/absence of `userId`. If `kind` is absent but `userId` is present, the server treats it as `kind: "member"` for backward compatibility during the transition (existing call sites in `occurrence-rsvp-section.tsx` and `admin-event-rsvp-table.tsx` do not yet send `kind`; they are updated in step 8 of the implementation order).

2. **`AdminRsvpRow` hoisted to `src/types/admin-rsvp.ts`.** The local `RsvpRowData` interface in `occurrence-rsvp-section.tsx` and the local `RsvpRow` interface in `admin-event-rsvp-table.tsx` are equivalent types with different names. `WriteInForm`'s `onAdded` callback would require a mapped adapter at each call site if the types stayed local and diverged. Hoisting to `src/types/admin-rsvp.ts` resolves the naming conflict, removes the adapter risk, and gives TypeScript a single source of truth for the admin attendee row shape. The raw DB query result type (`RsvpRow` in `page.tsx` lines 12–20) stays local — it represents the pre-consolidation Drizzle query shape and is not the same thing.

3. **No `force: true` flag in the POST body.** The server never enforces a capacity cap on the admin signup path (existing behavior). The inline client warning (yellow advisory above the submit button) is the only capacity signal. The `created_by_user_id` audit column implicitly records admin-initiated override inserts. Adding a `force` flag would introduce a code path with no observable server-side effect.

4. **No server-side capacity check on admin POST.** Consistent with existing behavior — the admin path bypasses capacity enforcement. The client advisory warning satisfies the soft-warn policy from Phase 1.

**Rationale:** Explicit discriminators eliminate a class of client bugs (sending both `userId` and `guestName`). Hoisting the shared type captures the real duplication between the two components at the type level without merging their structurally different parents. Omitting `force` and the server cap check keeps the admin path consistent with its pre-existing behavior and avoids dead code.

**Impact:**
- `src/types/admin-rsvp.ts` — new file.
- `src/components/admin/occurrence-rsvp-section.tsx` — local `RsvpRowData` removed; imports `AdminRsvpRow`.
- `src/components/admin/admin-event-rsvp-table.tsx` — local `RsvpRow` removed; imports `AdminRsvpRow`.
- `src/app/(dashboard)/admin/events/[id]/page.tsx` — row-mapping output typed as `AdminRsvpRow`; `isGuest: !r.userId` added to non-recurring rows.
- `src/app/api/admin/events/[id]/signup/route.ts` — POST branches on `kind`; backward-compat fallback for absent `kind`.

---

## DECISION-010: API shape, lookup endpoint, component placement, and schema addition for Write-in Signups

**Status:** Resolved
**Date:** 2026-05-20

**Decision:**
Four structural rulings for the Write-in Signups feature (work-log: `docs/work-log/2026-05-20-write-in-signups.md`):

1. **Extend the existing admin signup route; no separate `/guest-signup` route.** `POST /api/admin/events/[id]/signup` accepts a discriminated body: either `{ userId, occurrenceDate? }` (existing member path) or `{ guestName, guestEmail?, occurrenceDate?, force? }` (new guest path). `DELETE` accepts either `{ userId, occurrenceDate? }` or `{ rsvpId }` (new guest path; requires eventId ownership check). A new `PATCH /api/admin/events/[id]/signup/[rsvpId]` route handles in-place guest edits at `src/app/api/admin/events/[id]/signup/[rsvpId]/route.ts`.

2. **Email-match lookup lives at `GET /api/admin/members/lookup?email=...`** (`src/app/api/admin/members/lookup/route.ts`). Gated by `FEATURES.EVENTS_EDIT` (not `MEMBERS_VIEW`). Returns only `{ id, name, email }` to limit PII exposure. No existing endpoint does a point-lookup by email; the full-list `GET /api/admin/members` over-fetches for this purpose.

3. **One shared `WriteInForm` component in `src/components/admin/write-in-form.tsx`.** Reused by both `occurrence-rsvp-section.tsx` (recurring path) and `admin-event-rsvp-table.tsx` (non-recurring path). The two call sites differ only in whether `occurrenceDate` is passed. No unification of the parent components is required.

4. **`created_by_user_id` added to `event_rsvps`.** Nullable `uuid` referencing `users.id` with `ON DELETE SET NULL`. Member self-signups leave it null; admin write-ins populate it with the session user's id. Idempotent migration: `ALTER TABLE event_rsvps ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;`. No index needed.

**Rationale:** Extending the existing route avoids duplicating auth preamble and response shape. The narrow lookup endpoint limits data exposure to exactly what the email-match CTA requires. A single shared `WriteInForm` captures the real duplication between the two admin RSVP components without merging their structurally different parent state. The audit column is low-risk (nullable, idempotent migration) and provides an accountable record for capacity-override inserts.

**Impact:**
- `src/app/api/admin/events/[id]/signup/route.ts` — extended (POST + DELETE branches).
- `src/app/api/admin/events/[id]/signup/[rsvpId]/route.ts` — new file (PATCH).
- `src/app/api/admin/members/lookup/route.ts` — new file (GET).
- `src/components/admin/write-in-form.tsx` — new file.
- `src/lib/db/schema.ts` — `createdByUserId` column added to `eventRsvps`.
- `drizzle/migrations/` — new idempotent migration for `created_by_user_id` column.
- Three latent bug fixes in `occurrence-rsvp-section.tsx`, `admin-event-rsvp-table.tsx`, and `admin/events/[id]/page.tsx` are included in the same implementation pass.

---

## DECISION-009: Component rename strategy and shadcn scaffold classification for Add-to-Calendar dropdown

**Status:** Resolved
**Date:** 2026-05-20

**Decision:**
Two structural rulings for the "Add to Calendar — Provider Dropdown" feature (work-log: `docs/work-log/2026-05-20-add-to-calendar-dropdown.md`):

1. **Rename in place, not alongside.** `src/components/events/add-to-calendar-button.tsx` is renamed to `add-to-calendar-dropdown.tsx` and its body is replaced entirely. A parallel file is not created. The old component (`AddToCalendarButton`) will have no callers after this feature ships; keeping both files creates an ambiguity that must be managed forever. Four call sites are updated as part of the same change. The new export is `AddToCalendarDropdown`.

2. **`npx shadcn@latest add dropdown-menu` is not a new npm dependency.** `@radix-ui/react-dropdown-menu` is already in `package.json`. The scaffold command generates `src/components/ui/dropdown-menu.tsx` — a TypeScript/TSX wrapper file — and adds no new entry to `pnpm-lock.yaml`. This is the same structural pattern as `src/components/ui/confirm-dialog.tsx` (a hand-written Radix wrapper). DECISION-008's "no new npm dep" ruling is preserved.

**Rationale:** Rename-in-place eliminates dead artifacts in a single commit. The shadcn scaffold ruling keeps the wrapper consistent with the rest of `src/components/ui/` without widening the dependency graph.

**Impact:**
- `src/components/events/add-to-calendar-button.tsx` → `src/components/events/add-to-calendar-dropdown.tsx` (renamed, body replaced).
- `src/components/ui/dropdown-menu.tsx` created via shadcn scaffold.
- Four call sites updated to import `AddToCalendarDropdown` from the new path.
- Dead `eventTitle` prop removed from the component and all call sites (v1.15.0 follow-up, closed here).

---

## DECISION-008: ICS generator, route, and button placement for Add-to-Calendar feature

**Status:** Resolved
**Date:** 2026-05-20

**Decision:**
Three structural rulings for the Add-to-Calendar feature (work-log: `docs/work-log/2026-05-20-add-to-calendar.md`):

1. **ICS generator lives in `src/lib/events.ts`.** The generator functions (`generateIcsEvent`, `generateIcsSeries`, `buildVcalendar`) are added as new exports to the existing file rather than a new `src/lib/ics.ts` or `src/lib/events/ics.ts`. `events.ts` already owns `generateOccurrences`, `parseWallClock`, and `easternOffsetFor` — all three are required by the ICS generator. Keeping them co-located avoids a cross-file import of a module that owns every piece of data the generator needs. File will reach ~500 lines; that is still well within a single-concern boundary.

2. **Route lives at `src/app/api/events/[id]/ics/route.ts`, not under a new `/api/ics/` namespace.** The existing public event API lives at `src/app/api/events/[id]/rsvp` and `src/app/api/events/[id]/signup`. An ICS download is another operation on the same event resource and belongs in the same resource tree. A top-level `/api/ics/` namespace adds a second resource tree that mirrors `/api/events/` without justification. A single handler at this path uses an internal branch (see ruling 3) to enforce `isPublic` vs. `FEATURES.MEMBERS_VIEW`.

3. **Single handler with an internal auth branch.** One `GET` handler checks: if the event is public (`isPublic === true`), serve the ICS to any caller; if private, require a session and `hasFeature(session.user.features, FEATURES.MEMBERS_VIEW)`. Two separate handlers (one public, one member) would share identical ICS generation logic and differ only in the five-line auth preamble — not enough divergence to justify duplication.

4. **No new npm dependency.** A hand-rolled ICS generator (~200 lines) is correct. The `ics` and `ical-generator` npm packages are actively maintained but neither is already in `package.json`. The ICS format needed here is a small, well-specified subset of RFC 5545 (VCALENDAR + VEVENT + optional VTIMEZONE). The project dependency evaluation criteria require that an existing dependency solve the problem before a new one is added. None does. Adding a new dep for ~200 lines of string building (where correctness is fully verifiable against the RFC) is not warranted. No bundle-size impact on the server-only route.

5. **`<AddToCalendarButton>` lives in `src/components/events/`.** It is an event-surface-specific component, not a general UI primitive, so `src/components/ui/` is wrong. Its only peer event components are `occurrence-signup-list.tsx` and `single-event-signup.tsx`, both already in `src/components/events/`.

**Rationale:** Nesting under the existing events resource tree and co-locating the generator with its dependencies are the two choices that minimize new indirection. The single-handler-with-branch pattern matches the existing RSVP handler, which also branches on session state internally.

**Impact:**
- `src/lib/events.ts` gains ICS generator exports (~200 lines).
- New route: `src/app/api/events/[id]/ics/route.ts`.
- New component: `src/components/events/add-to-calendar-button.tsx`.
- No new npm dependency. No new migration. No new FEATURES key.

---

## DECISION-007: `OccurrenceGroupData.date` stays typed as `Date`; `rsvpByDate` key uses `format(d, "yyyy-MM-dd HH:mm:ss")`

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
`OccurrenceGroupData.date` remains typed as `Date` (not changed to `string`). After `eventRsvps.occurrenceDate` switches to `mode: "string"`, the `rsvpByDate` map key in `src/app/(dashboard)/admin/events/[id]/page.tsx` changes from `row.occurrenceDate?.toISOString() ?? "null"` to `row.occurrenceDate ?? "null"` (plain string from DB). The lookup key at line 119 changes from `d.toISOString()` to `format(d, "yyyy-MM-dd HH:mm:ss")` (date-fns, local components) so both sides of the map use the same string format that Postgres returns.

**Rationale:** `generateOccurrences` returns `Date[]`; changing `OccurrenceGroupData.date` to `string` would cascade type changes through the entire admin page, the orphan-detection loop, and the sort comparator — more churn than benefit. The Date type is correct and coherent as long as dates are locally parsed on the way in (via `parseWallClock`). The map key format change is a surgical two-line edit that makes both sides consistent without touching the type.

**Impact:** Two lines in `src/app/(dashboard)/admin/events/[id]/page.tsx` — lines 99 and 119. No type change to `OccurrenceGroupData`.

---

## DECISION-006: Helper placement and `formatEventWhen` centralization for wall-clock refactor

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
New time helpers (`parseWallClock`, `formatEasternOffset`, `formatEventWhen`) live in the existing `src/lib/events.ts`, not in a new file or subdirectory. A single `formatEventWhen(event): string` helper is required and must be the only place that branches on `event.isAllDay` for display purposes — callers must not re-implement the branch inline.

**Rationale:** `events.ts` is 245 lines and handles a single domain. Adding three small helpers (~30 lines each) reaches ~330 lines — still cohesive. A new `src/lib/event-times.ts` file would require updating ~12 import sites and adds indirection without justification at this size. The centralized `formatEventWhen` helper is required because 10+ display sites need the all-day branch; a missing branch at any one site produces a silent wrong display (time shown when it should be omitted, or vice versa). Making the branch optional-inline creates an untestable invariant.

**Impact:** `src/lib/events.ts` gains three new exported functions. All display sites import and call `formatEventWhen` rather than branching directly on `isAllDay`.

---

## DECISION-005: Migration shape and `mode: "string"` annotation for wall-clock columns

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
One migration file (`drizzle/migrations/0037_events_wall_clock_and_all_day.sql`) adds the single new DDL change: `ALTER TABLE events ADD COLUMN IF NOT EXISTS is_all_day boolean NOT NULL DEFAULT false`. The `mode: "string"` annotation on `events.startDate`, `events.endDate`, `events.recurrenceEndDate`, and `eventRsvps.occurrenceDate` is a Drizzle TypeScript-only annotation — it instructs Drizzle to return the raw Postgres string rather than constructing a `Date` object. It emits no DDL and will not alter or drop the column on `db:push`. No second migration file is needed for the mode changes.

**Rationale:** Splitting into two migrations (one for `is_all_day`, one as a documentation note) adds file noise with no operational benefit — the mode annotation requires zero SQL. A single migration with only the `ADD COLUMN IF NOT EXISTS` statement satisfies the idempotency invariant (CLAUDE.md: "Every statement must be idempotent"). Confirming mode is DDL-safe is critical: Drizzle's `mode` option on `timestamp()` affects only the JS return type, not the Postgres column definition. The column remains `timestamp without time zone` in the database regardless of the `mode` value in `schema.ts`.

**Impact:** New file `drizzle/migrations/0037_events_wall_clock_and_all_day.sql` with one statement. `src/lib/db/schema.ts` updated to add `mode: "string"` to four columns and a new `isAllDay` boolean column on the `events` table.

---

## DECISION-004: RSVP count display on cancelled occurrence rows

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
On public and member-portal cancelled occurrence rows (`OccurrenceSignupList`), suppress the "X attendees" count and the action button entirely — render only the "Cancelled" badge and optional reason text. In the admin accordion, always show the count; admins need to know how many people were signed up before the cancellation.

**Rationale:** Showing a signup count on a row where signups are impossible is confusing to members. Admins have a legitimate need for the number (historical data; they may want to notify those members manually in v2). The difference in behavior is appropriate to the audience.

**Impact:** `OccurrenceSignupList` checks `row.isCancelled` before rendering the count `<p>` and the action button. Admin accordion header always renders its count span regardless of `isCancelled`.

---

## DECISION-003: Orphaned cancellation records surfaced in admin accordion as extra rows

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
When an admin edits the recurrence rule so that a previously cancelled date falls outside the new generated window, the cancellation record is NOT silently hidden and NOT accompanied by a warning at edit time. Instead, the admin detail page (`src/app/(dashboard)/admin/events/[id]/page.tsx`) detects orphans by comparing the `eventOccurrenceOverrides` set against the generated occurrence list and appends them to `occurrenceGroups` with a display label that includes "outside current recurrence rule." The admin can Restore (delete the record) to clean up. Sort order is chronological across generated and orphaned rows.

**Rationale:** Option (b) — warn at recurrence-rule edit time — requires changes to the event-edit form and introduces a two-step flow (edit, then decide what to do about orphans). Option (c) — leave invisible — is a data integrity risk. Option (a) is purely additive (no form changes) and keeps orphan management explicit in the same accordion where cancellations live.

**Impact:** `src/app/(dashboard)/admin/events/[id]/page.tsx` gains post-generation orphan detection logic. No new API surface required.

---

## DECISION-002: `generateOccurrences` signature unchanged; only `getNextOccurrence` gains cancellation exclusion

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
The architect's suggestion specified `generateOccurrences` should gain a `cancelledDates: Set<string>` parameter to skip cancelled dates. After reading all call-sites, this is the correct place for the exclusion on the `/events` list (next-occurrence computation) but the WRONG place for the detail-page occurrence list, where cancelled dates must APPEAR (with a badge) rather than be skipped. To avoid a confusing dual-mode parameter ("sometimes skip, sometimes don't"), the exclusion is placed only on `getNextOccurrence`, which is responsible for "what is the next bookable date." `generateOccurrences` remains a pure date generator. Callers that need the `isCancelled` flag annotate their `OccurrenceRow[]` after generation using the cancellation map fetched separately.

**Rationale:** Filtering inside `generateOccurrences` would produce inconsistent behavior depending on caller intent. The function's contract is "give me all dates in the window" — callers decide what to do with each date. `getNextOccurrence`'s contract is "give me the next actionable date" — skipping cancelled dates is correct there.

**Impact:** `src/lib/events.ts` — `getNextOccurrence` and its `findNextDayOfWeek` helper gain `cancelledDates: Set<string> = new Set()`. `generateOccurrences` is unchanged. Five `getNextOccurrence` call-sites each gain a batch cancellation fetch.

---

## DECISION-001: Cancel-occurrence table name, occurrence_date column type, and cancel API shape

**Status:** Resolved (Impact bullet about `generateOccurrences` partially superseded by [DECISION-002](#decision-002-generateoccurrences-signature-unchanged-only-getnextoccurrence-gains-cancellation-exclusion))
**Date:** 2026-05-18

**Decision:**
Three rulings for the "Cancel a Single Event Occurrence" feature (work-log: `docs/work-log/2026-05-18-cancel-event-occurrence.md`):

1. **Table name:** `event_occurrence_overrides`. This is the right name: it is additive (does not touch `events` or `eventRsvps`), is self-describing, and leaves room for future override types (e.g., time-change overrides) without a rename. Columns: `id uuid PK`, `event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE`, `occurrence_date date NOT NULL`, `cancelled_at timestamp WITH TIME ZONE NOT NULL`, `cancelled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL`, `cancellation_reason text`. Composite unique on `(event_id, occurrence_date)`.

2. **`occurrence_date` is a `date` column (no time component).** The existing `eventRsvps.occurrenceDate` is a `timestamp` (naive, no timezone — the known project bug). We do NOT use that column type for the new table. Occurrence cancellation is keyed on the calendar date of the occurrence (`YYYY-MM-DD`), not its wall-clock time. A `date` column avoids timezone ambiguity entirely: the API route segment carries `YYYY-MM-DD`, the DB stores `YYYY-MM-DD`, and the UI badge lookup is a string equality check. This is safe because every occurrence of a given event on a given calendar date is the same occurrence — there is no scenario where two occurrences of the same event share the same calendar date.

3. **Single toggle endpoint:** `POST /api/admin/events/[id]/occurrences/[date]/cancel` with body `{ cancelled: boolean, reason?: string }`. Rationale: a single endpoint is easier to guard (one auth check, one hasFeature check, one rate-limit surface), easier to test (one contract), and the body makes the intent explicit. Two separate endpoints (cancel + restore) would duplicate boilerplate and create an ambiguous "which one do I call?" question for the client. The `[date]` segment carries a `YYYY-MM-DD` string. When `cancelled: true`, the handler upserts a row into `event_occurrence_overrides`; when `cancelled: false`, it deletes it. The handler returns the updated occurrence state.

**Rationale:** All three choices minimize ambiguity at the data-model and API boundaries. The `date` column type is the most load-bearing decision: using `timestamp` here (matching the existing `eventRsvps.occurrenceDate`) would re-introduce the naive-timestamp bug and create a join surface where two `timestamp` values with different TZ assumptions must be compared for equality — a known failure mode in this codebase. The `date` column sidesteps that entirely.

**Impact:**
- New file: `drizzle/migrations/0036_event_occurrence_overrides.sql` (idempotent: `CREATE TABLE IF NOT EXISTS`, unique constraint guarded with `IF NOT EXISTS`).
- New table in `src/lib/db/schema.ts`: `eventOccurrenceOverrides`.
- New route: `src/app/api/admin/events/[id]/occurrences/[date]/cancel/route.ts`.
- ~~`src/lib/events.ts` — `generateOccurrences()` gains an optional `cancelledDates: Set<string>` parameter.~~ **Superseded by DECISION-002:** the parameter was placed on `getNextOccurrence` (and its `findNextDayOfWeek` helper) instead. `generateOccurrences` is unchanged.
- `src/types/events.ts` — `OccurrenceRow` gains `isCancelled: boolean` and `cancellationReason: string | null`.
- No new npm dependency. No new `FEATURES` key. No new role binding.

---

<!-- Decisions are appended above this line, newest first. -->
