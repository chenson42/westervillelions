# Explicit Transaction → Budget-Line Link (B-30) — Work Log

> **Slug:** `2026-07-30-transaction-budget-line-link`
> **Surface:** mixed — admin transaction form + create/edit routes (`src/components/admin/ledger/transaction-form.tsx`, `src/app/api/admin/ledger/transactions/**`), reimbursement mark-paid route (`src/app/api/admin/ledger/reimbursements/[id]/route.ts`), schema (`ledger_transactions`), report queries (`src/lib/ledger-queries.ts` `getFundReport()`, `src/lib/financial-report-queries.ts`), and a one-time backfill script (`scripts/`).
> **Permission(s):** existing `ledger.record` (`FEATURES.LEDGER_RECORD`) covers the picker; report surfaces keep their existing gates — no new key.
> **Estimated complexity:** large
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-30 |
| 2 — Architectural review | tech-lead (fast-tracked, see note) | Complete | Approved — trivial footprint | 2026-07-30 |
| 3 — Technical design | tech-lead | Complete | Implementer(s) named | 2026-07-30 |
| 4 — Implementation | database-admin → api-developer → ux-developer | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## RESOLVED (Chris) — 2026-07-30

Three open questions from this Phase 1 are locked by Chris, ahead of Phase 3 design:

1. **Reimbursements are INCLUDED now** (answers Open Question 1). The reimbursement
   mark-paid flow gains category (+ optional budget-line) capture at payment time so
   reimbursement-derived transactions can link, same as any other expense. No longer
   deferred.
2. **Collapse-with-links routes through `<ConfirmDialog>`** (answers Open Question 2,
   Resolve #1's "line lifecycle" option (a)). Collapsing a budget breakdown that has
   transactions linked to its cause lines must warn with a real count — "N linked
   transactions will be unlinked" — not silently orphan them.
3. **Backfill runs against ALL historical fiscal years in one pass** (answers Open
   Question 4), dry-run by default, `--apply` to write, never guessing — reports every
   unmatched row with enough context to fix it by hand.

Open Questions 3 (beneficiary-cause edit-mode unlock) and 5 (fuzzy-fallback marker
copy/placement) are resolved in Phase 3 below per the analyst's own stated lean (fully
unlock cause-editing; a small, non-alarming "approximate match" marker). Open Question 6
(who resolves backfill mismatches) stays with Chris personally, per house practice for
every prior FY2025 books-cleanup script. Open Question 1a from the fiscal-report-cause-
breakdown work-log (member Statement only, or also the admin Fund Report) is answered
**both** — see Phase 3's Fiscal-Report Breakdown section.

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Give the treasurer an explicit, FK-backed way to say "this transaction is that budget line" instead of hoping a payee name matches a budget label — the shape is clear (nullable `budget_line_id` on `ledger_transactions`, a picker in the transaction form, exact aggregation at report time with the existing fuzzy match demoted to a flagged fallback, and a dry-run-first backfill that surfaces rather than guesses the Pilot-Dogs-class mismatches) — but this is a large, multi-surface change with real lifecycle questions (re-dating, re-categorizing, budget re-breakdown) that Phase 3 must nail down precisely, and it changes what B-18/B-19 mean.

## Scope

**In scope:**
- Schema: nullable `budgetLineId` FK on `ledger_transactions` → `ledger_budget_lines`.
- UX: an optional "applies to budget line" picker on the transaction form (create + edit), scoped by fund + derived fiscal year.
- Query change: `getFundReport()` and `financial-report-queries.ts` prefer the explicit link; fuzzy `causeLineReferenceKey` match becomes a flagged fallback for un-linked rows only, and is excluded for any row that IS linked (no double count).
- Backfill: a dry-run-first, idempotent `scripts/*.ts` script that links existing posted transactions (all FYs, with FY2025 as the explicit priority) via the *existing* fuzzy match, and reports (not guesses) every unmatched row.
- Fold-in: the not-yet-built fiscal-report cause/line breakdown (`docs/work-log/2026-07-30-fiscal-report-cause-breakdown.md`, Phase 1 already done, Phase 2 pending) is re-pointed to read the explicit link once this ships — that work-log's own Phase 1 is **subsumed**, not re-done; see "Fold-in" below.
- Reimbursement mark-paid flow — assessed below; recommend bringing category (+ optionally a link) into that flow rather than leaving paid reimbursements permanently uncategorized (a real gap confirmed in the code, not hypothetical — see Pass 4 below).

**Explicitly NOT in scope for B-30 itself** (called out so Phase 2/3 don't scope-creep):
- Retiring `beneficiaryCause` as free text (that's B-18 — see "B-18/B-19 reconciliation" below).
- Changing `/members/impact`'s giving-by-cause bucketing, which reads `beneficiaryCause` directly and is untouched by this link (confirmed — `bucketGivingByCause()` in `src/lib/ledger.ts` never looks at `budgetLineId`).
- The label=party autocomplete idea from B-29's discussion — B-29 already notes it's **dropped** if B-30 lands; confirmed dropped here.

## Verify Against the Code — What I Found

- **`causeLineReferenceKey(categoryId, cause, labelOrParty)`** (`src/lib/ledger.ts:1658`) = `` `${categoryId}::${cause}::${normalizeBudgetLineLabel(labelOrParty)}` ``. Normalization is **trim-only** (no case-fold, no punctuation strip) — confirms the Pilot Dogs / Pilot Dogs, Inc. mismatch is structural, not a fluke.
- **Category-grain actuals are already exact.** `getFundReport()`'s `actualMap` (line ~716) sums `postedTxns` by `${categoryId}_${flow}` — a real FK join, no string matching. **Only the cause/line-item grain is fuzzy** (`causeActualsByKey`, built by `buildCauseActualsByKey()` from `(categoryId, cause, party)` — line ~728). This matters for scoping: B-30 doesn't need to touch category-level budget-vs-actual at all, only the cause/line grain.
- **`ledger_budget_lines`** (`src/lib/db/schema.ts:822`) has a real `id`, lives under a `budgetId` → `ledger_budgets` row (which carries `fundId`, `fiscalYear`, `categoryId`, `flow`), and is unique on `(budgetId, cause, label)`. So a "line" already fully implies fund + FY + category + flow + cause + label — the FK target is well-defined.
- **A transaction's FY** derives via `getFiscalYear(txnDate)` (`src/lib/fiscal-year.ts:25`, Jul–Jun year, already the shared FY helper used everywhere else in the Ledger).
- **`isCauseEligibleCategory`** (`ledger.ts:617`): `flow === "expense" && countsAsGiving === true`. Cause lines — and therefore budget-line targets — only exist under giving-eligible expense categories. Income transactions and lump-sum/non-giving expense categories have **no line to point at**, confirming Chris's point (2) verbatim.
- **The transaction form's `beneficiaryCause` field is create-only in the UI** (`transaction-form.tsx:659`, gated `!isEdit`) — **but the PATCH API route already accepts and persists `beneficiaryCause` updates** (`src/app/api/admin/ledger/transactions/[id]/route.ts:346-351`). This is a pure UI gap, not an API one, and it's directly relevant to the picker design (see Resolve #2). `categoryId` and `party`, by contrast, are already editable in both create and edit.
- **Reimbursement mark-paid transactions carry no `categoryId` and no `beneficiaryCause` at all.** Confirmed by reading the full insert in `src/app/api/admin/ledger/reimbursements/[id]/route.ts` (~line 321-340): the `ledgerTransactions.insert()` sets `entityId`, `fundId`, `txnDate`, `flow`, `amountCents`, `party`, `memo`, `paymentMethod`, `status`, `approvedByUserId/At`, `boardMinute`, `recordedByUserId` — **no `categoryId`, no `beneficiaryCause`**. Every reimbursement-derived expense transaction is born uncategorized and cause-less; someone has to remember to open it in the edit form afterward and add a category (cause can't even be added there today, per the point above). This is a real, pre-existing gap the trigger prompt asked me to assess — see Pass 4 and Resolve below.
- **`getMonthlyStatement()` / `computeOneMonthCashActuals()`** (`src/lib/financial-report-queries.ts:440`) bucket the One-Month cash-basis column by `(categoryId, flow)` only — no cause/line grain yet (that's the un-built fold-in feature). It already fetches every row needed to add a `budgetLineId` bucket at zero extra query cost, mirroring what the cause-breakdown work-log found for `causeActualsByKey`.
- **Locking**: budgets lock at `(entityId, fiscalYear)` grain via `assertBudgetUnlocked()` (`ledger-queries.ts:869`) — relevant to whether a transaction can still be linked/relinked against a locked FY's budget (Resolve #1, edge cases).

## Pass 1 — User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`ledger.record`) | Picks a budget line ("applies to") while entering or editing an expense transaction, from a list scoped to the transaction's fund + derived fiscal year | Per transaction, optional |
| Admin (`ledger.record`) | Sees category (and, per Resolve #2, cause) auto-filled when a line is picked | Per transaction, on picker use |
| Admin (`ledger.record`) | Leaves the picker blank for transactions that don't map to any line (income, lump-sum categories, non-giving expense) | Per transaction, common case |
| Admin (`ledger.manage`/`ledger.record`, TBD — see Open Questions) | Runs the backfill script against dev, reviews the unmatched report, hand-resolves (edits a party or a budget label), re-runs, then repeats against prod | One-time, per environment |
| Admin (`ledger.record`), if reimbursement scope confirmed | Picks a category (and optionally a budget line) at reimbursement mark-paid time, not after the fact | Per reimbursement, at payment |
| Signed-in member (statement reader) | Sees cause/line-item breakdown rows sourced from the exact link, with a narrower/rarer accuracy footnote than the fiscal-report-breakdown work-log originally scoped (only for genuinely un-linked rows) | Per statement view, passive |

## Pass 2 — Flow Audit

**Flow 1 — Treasurer links a new expense transaction to a budget line:** entry: "Add Transaction" in `transaction-form.tsx`, expense flow selected → step: picks fund → step: enters `txnDate` (FY derives silently) → step: opens the new "Applies to budget line" picker, pre-filtered to that fund + derived FY's giving-eligible expense categories → step: picks a line (e.g. Foundation/Charitable → "Pilot Dogs") → step: category and cause auto-fill from the line (see Resolve #2 for exactly how) → step: fills party/memo/amount as today → outcome: transaction saves with `budgetLineId` set; the line's actuals are now exact, no string match involved.
- Failure: line list is empty for the chosen fund+FY (no budget entered yet, or category is lump-sum) → picker shows "No budget lines available for this fund/year" (not a blank dropdown, not an error) and the treasurer proceeds without a link, exactly as today. Failure: treasurer picks a line, then changes the category away from what the line implies → see Resolve #1 (link clears, doesn't silently go stale).

**Flow 2 — Treasurer edits an existing transaction's link:** entry: "Edit" on a transaction row → step: current link (if any) shows selected in the picker → step: treasurer changes the line, or clears it → outcome: link updates; category/cause re-derive per Resolve #2's rules.
- Failure: the previously-linked budget line was deleted (breakdown collapsed) or is now `pendingDeleteAt` — see Resolve #1's "line lifecycle" edge case; the form must not crash on a dangling reference.

**Flow 3 — Admin runs the backfill script:** entry: `pnpm exec tsx scripts/backfill-budget-line-links.ts` (dry run, no `--apply`) against dev → step: script matches every un-linked, cause-tagged, categorized posted expense transaction against its FY's budget lines using the existing `causeLineReferenceKey` logic → step: prints a summary — N matched (would-link), N unmatched with full detail (category, party, cause, amount, date, and the candidate labels that existed for that (category, cause) so the mismatch is legible), N skipped (no category, e.g. reimbursement-derived) → outcome: admin/Chris reviews the unmatched list, fixes root causes (edit a transaction's party, or a budget line's label) in the app UI, re-runs dry-run until clean, then `--apply`s to dev, then repeats the whole dry-run → review → apply cycle against prod.
- Failure: script finds a ambiguous/multiple-candidate match (shouldn't happen given the `(budgetId, cause, label)` uniqueness, but a defensive check belongs here) → reports as unmatched with a distinct "ambiguous" reason rather than guessing.

**Flow 4 — Member reads a statement with linked cause-line detail (fold-in):** entry: `/members/financial-reports/[entitySlug]/[month]` → step: a cause line whose budget-line `id` has linked, posted actuals shows the exact sum, no caveat → step: a cause line with no linked actuals but a nonzero fuzzy-match hit shows that number with an "approximate match" indicator/footnote → step: a cause line with neither shows $0 (and is omitted per the existing all-zero rule if budget is also $0) → outcome: same visual shape as the fiscal-report-breakdown work-log already speced, but the accuracy caveat now applies to a narrowing, explicitly-flagged subset instead of every cause-line row.
- Failure: none new — this composes existing report queries.

## Pass 3 — Permissions

- **Picker (transaction form, create + edit):** existing `FEATURES.LEDGER_RECORD` (`ledger.record`) — the same permission that already gates the transaction form. No new key.
- **Backfill script:** not a `FEATURES`-gated surface — it's a `pnpm exec tsx` script run by a human with DB/deploy access (matches every other `scripts/backfill-*.ts` precedent in this repo). No permission key needed; note it in the script's own header comment, matching `scripts/backfill-bank-account.ts`'s style.
- **Report surfaces (member Statement, admin Fund Report):** unchanged from the fiscal-report-breakdown work-log's own Phase 1 — member surface stays ungated (any linked member), admin surface stays on existing `LEDGER_VIEW`/`RECORD`/`MANAGE`.
- **Reimbursement mark-paid picker (if in scope):** existing reimbursement-approval permission already gates that route (confirm exact key name in Phase 3 — the route file didn't need re-reading for a key name here, tech-lead should confirm against `FEATURES` directly); no new key expected.

## Resolve — Design Questions from the Trigger

### 1. The link: schema, FY resolution, and lifecycle

**Schema:**
```
budgetLineId: uuid("budget_line_id")
  .references(() => ledgerBudgetLines.id, { onDelete: "set null" }),
```
on `ledger_transactions`, nullable, plus `index("ix_ledger_txns_budget_line").on(t.budgetLineId)` (every report aggregation will group by this column).

**FY resolution:** a transaction's FY = `getFiscalYear(txnDate)` (existing shared helper). A budget line's FY comes transitively through `budgetLineId → ledgerBudgetLines.budgetId → ledgerBudgets.fiscalYear`. The picker's candidate list is filtered to lines whose budget row matches `(fundId = transaction's fundId, fiscalYear = getFiscalYear(txnDate))` — never a manual FY input.

**Re-dating into a different FY:** if `txnDate` is edited such that its derived FY no longer matches the linked line's budget FY, the link is now describing the wrong year's plan. Recommend: **the server clears `budgetLineId` automatically** whenever an edit changes `txnDate`'s derived FY away from the currently-linked line's FY (enforced in the PATCH route, not just the client) — silently stale is worse than requiring a re-pick. The UI should surface this as a visible "link cleared because the date moved to a different fiscal year — please re-select" notice, not a silent drop.

**Category/fund change:** since a line implies a category (and a fund, via its budget row), recommend the same clear-on-mismatch rule: changing `categoryId` or `fundId` away from what the linked line implies clears `budgetLineId` server-side. Setting `categoryId` to null while linked is a contradiction under the same rule — also clears the link.

**Line lifecycle (collapse/re-breakdown):** `onDelete: "set null"` on the FK means deleting a `ledger_budget_lines` row (breakdown collapsed) orphans any transaction links to it — they silently become un-linked, falling back to the fuzzy match (or to nothing, if fuzzy also fails). This is the schema's designed-safe behavior (no dangling FK, no crash) but is a **silent regression in report accuracy** if a treasurer collapses a breakdown that active transactions were linked to. Recommend one of: (a) block collapse via a confirm-dialog warning ("N transactions are linked to lines in this breakdown — collapsing will unlink them") — tech-lead's call whether this needs a DB query at collapse-time or is acceptable as a soft warning; (b) accept it silently for v1 and rely on the backfill script being re-runnable to re-link after the fact. I lean (a) — a `<ConfirmDialog>` with a real count is cheap and matches this codebase's existing destructive-confirm pattern, but the actual query cost is a Phase 3/4 call.

**Pending-delete:** a line marked `pendingDeleteAt` (soft-delete-until-finalize) but not yet purged — should a transaction still be linkable to it, and should its actual still count? Recommend: still counts (mirrors `isCauseLineLive`'s existing "pending but not yet purged" semantics elsewhere), but the picker should not offer a pending-delete line as a *new* selectable option (mirrors how such lines already don't participate in "live" totals for other purposes).

**Locked budget:** if a budget's FY is locked, can a transaction still be newly linked/re-linked against one of its lines? Recommend yes — linking a transaction doesn't mutate the budget itself (no `annualAmountCents`/line write), only the transaction row, so `assertBudgetUnlocked()` shouldn't need to gate this at all. Flag for tech-lead to confirm this reading against the lock's actual intent.

### 2. The picker UX

Lives in `transaction-form.tsx`, in the same block as category/party/cause, visible only when `!isTransferOrSweep && !isEditingTransfer && apiFlow === "expense"` (transfers/sweeps/income never have a line to point at, per `isCauseEligibleCategory`).

- **Optional `<select>`**, default "No linked budget line," grouped Category → Cause → Label (mirrors the treasurer's existing `BudgetCauseEditor` mental model — no new visual vocabulary).
- **Filtered by fund + derived FY** as described in Resolve #1; re-filters live as `fundId`/`txnDate` change, same pattern as the existing `filteredCategories` effect at `transaction-form.tsx:243-248`.
- **Selecting a line auto-fills category** (overwrites `categoryId`) and **auto-fills `beneficiaryCause`** from the line's `cause`. This is the one place this feature meaningfully changes existing behavior: **it requires relaxing `beneficiaryCause`'s current create-only UI gate** (`!isEdit` at line 659), since editing an existing transaction's link must also be able to set/change its cause. Recommend: once the picker ships, the free-text cause input on the form becomes edit-visible too (or is replaced by "cause shows read-only, auto-derived from the picked line; type a free-text cause only when no line is picked" — Phase 3's call on exact layout), rather than leaving a UI-only inconsistency where the API accepts an edit the form never sends.
- **If a category was already manually chosen** before the treasurer opens the picker, pre-scope the line list to that category (still show other categories' lines if they change their mind) — and if picking a line would change an already-different category, don't silently overwrite it without feedback; a one-line inline notice ("this line belongs to Grants, not Scholarships — category will update") is enough, no modal needed.
- **Optional, never forced** — most transactions (all income, most operating expenses) will have zero candidate lines and the picker naturally reads "No budget lines available" or is simply skipped past.

### 3. Report/query change

- `getFundReport()` gains an exact aggregation: `actualByBudgetLineId: Map<budgetLineId, cents>`, summed from `postedTxns` where `budgetLineId` is set — a straight FK-keyed sum, same pattern as the existing `actualMap` (categoryId-keyed) already does.
- **A linked transaction must never also feed the fuzzy `causeActualsByKey` path** (the double-count risk Chris named explicitly). Concretely: the loop that builds `causeActualSourceRows` (`ledger-queries.ts:728-739`) adds one line — skip any `postedTxn` where `txn.budgetLineId != null`. Cheap, and it's the one change that makes "hybrid, never both" true by construction rather than by convention.
- **Fallback, not full replacement:** for a budget line with **zero exact actual** (`actualByBudgetLineId` has no entry, or an entry of 0), fall back to the existing fuzzy `causeActualsByKey` lookup by `causeLineReferenceKey`. If the fuzzy path finds a nonzero amount, render it but **flag it** (an "approximate match" marker, not a silent identical-looking number) — this is the direct fold-in point for the fiscal-report-breakdown work-log's accuracy-caveat footnote, now scoped to *only* rows sourced this way instead of every cause-line row.
- **This fallback does not retire once backfill runs.** Some fraction of historical rows will always end up in the backfill's "unmatched, needs manual resolution" bucket (Chris explicitly wants those surfaced, not guessed) — so the fuzzy path remains a permanent, narrower safety net for genuinely un-linkable rows, not a transitional shim. Worth saying to Chris directly so "hybrid vs replace" isn't read as "temporary."
- `financial-report-queries.ts`'s `computeOneMonthCashActuals()` needs the parallel change: bucket by `budgetLineId` alongside the existing `(categoryId, flow)` bucket, at zero extra query cost (same join it already does), with the identical exclude-if-linked rule for whatever fuzzy One-Month bucket the fold-in work adds.
- **Prior-year-reference feature** (2026-07-28, `docs/work-log/2026-07-28-causeline-prior-year-reference.md`): compares *this* FY's fuzzy actuals against *last* FY's budget cause lines by `(cause, label)` — inherently cross-FY, so it can't use this-FY's `budgetLineId` link directly (the link points at this FY's line, not last FY's). Recommend leaving this comparison on the fuzzy path for now (apply the same exclude-if-this-txn-is-linked rule for consistency), and revisit once backfill coverage across multiple FYs is high enough that a cross-FY line-to-line mapping becomes worth building — not blocking for v1.

### 4. Backfill

- **Script:** `scripts/backfill-budget-line-links.ts` (name for tech-lead/database-admin to finalize), following this repo's established pattern (`scripts/backfill-bank-account.ts` is the closest precedent — dotenv-loaded, `--apply` flag defaulting to dry-run, `PROD_DATABASE_URL` vs `DATABASE_URL` target detection, only touches rows where `budget_line_id IS NULL` so re-running after a successful apply is a no-op).
- **Algorithm:** for every posted, expense-flow transaction with a non-blank `beneficiaryCause`, a non-null `categoryId`, and `budgetLineId IS NULL`: resolve its FY via `getFiscalYear(txnDate)`, look up the `ledger_budgets` row for `(fundId, fiscalYear, categoryId, flow='expense')`, fetch its cause lines, and run the **existing** `causeLineReferenceKey(categoryId, cause, party)` match against each line's `causeLineReferenceKey(categoryId, line.cause, line.label)`. Exact match → would-link (dry-run) / sets `budgetLineId` (`--apply`). No match → reported as unmatched with full context (category, party, `beneficiaryCause`, amount, date, and the candidate labels that DID exist for that category+cause, so a mismatch like Pilot Dogs vs. Pilot Dogs, Inc. is immediately legible, not just "no match").
- **Explicitly does not guess** — Chris's requirement. No fuzzy-fuzzy (e.g. Levenshtein) matching beyond what already exists; a near-miss is reported, never auto-linked.
- **Reimbursement-derived transactions surface in a separate bucket**, not lumped with the Pilot-Dogs-style unmatched list — since they fail the "non-null `categoryId`" precondition entirely (confirmed finding above), their fix path is different (add a category via the edit form first, not fix a label) and conflating the two reports would mislead whoever reviews it.
- **Scope flags:** `--entity=`, `--fiscal-year=` (Chris wants FY2025 prioritized explicitly, but the script should default to scanning every FY rather than being FY2025-only, since "old reports become testable" implies more than one year eventually).
- **Discipline note (from project memory):** the Ledger's dev AND prod DBs were seeded from Quicken exports on 2026-07-20 and must **never** be re-imported (delete-and-reinsert wipes post-seed edits). This backfill script must be a pure, narrow `UPDATE ... SET budget_line_id = $1 WHERE id = $2`-style write — never structured as any kind of delete-and-reinsert, and never touching `amountCents`/`party`/`beneficiaryCause`/anything but `budget_line_id`. Flagging explicitly because this is exactly the class of script that could accidentally be written as "wipe and re-derive," and the existing memory note is a hard guardrail against that pattern in this codebase.
- **Dev → prod discipline:** dry-run dev → review with Chris → apply dev → dry-run prod → review → apply prod, matching the multi-step discipline the existing FY2025 books-cleanup scripts already establish (`scripts/fix-ledger-categories.ts`, `scripts/rehome-misc-actuals.ts`, `scripts/split-event-costs.ts` — all currently modified per git status, i.e. active precedent for this exact workflow).

### 5. Fold in the fiscal-report cause/line-item breakdown

Confirms and **subsumes** `docs/work-log/2026-07-30-fiscal-report-cause-breakdown.md`'s Phase 1 (analyst, READY WITH NOTES, still pending Phase 2). That work-log's design stands almost entirely — same scope call (member Statement primary, admin Fund Report secondary, pending Chris's confirmation), same all-zero omission rule, same "Other" catch-all recommendation, same lump-sum/no-line-eligible-for-actual-only-rows question (Gap 2) — **except** its single highest-risk item, the accuracy caveat, changes shape:

- **Before (that work-log's world):** every cause-line row is fuzzy-matched; the caveat footnote applies universally, "the category total is exact, the breakdown might not be."
- **After (this work-log's world):** a cause-line row is exact once its transactions are linked (which the backfill script drives toward for existing data, and the picker guarantees going forward); the caveat narrows to a visibly-flagged subset — rows still resolved via the fuzzy fallback because nobody has linked them yet (new data, entered without using the picker) or because they're in the backfill's confirmed-unmatched bucket (a genuine label/party mismatch someone hasn't fixed).
- Recommend Phase 3 for the fold-in explicitly design the "approximate match" visual marker (small, non-alarming — this is a board-facing document, not a debug view) and confirm whether it should also read the backfill's unmatched-report data to say something more specific than "approximate" (e.g. "unmatched — see [budget label] discrepancy") — a nicety, not a blocker.
- The rest of that work-log's Gaps (1 "Other" row, 2 lump-sum/actual-only rows, 5 print-friendliness, 6 mobile, 7 brand, 8 zero-omission-scope) are **unchanged by B-30** and should be carried forward as-is into Phase 3 rather than re-derived.

### 6. B-18 / B-19 reconciliation

- **B-18 (structured cause taxonomy on transactions, promoting `beneficiaryCause` from free text) — NOT superseded.** Verified: `/members/impact`'s giving-by-cause bucketing (`bucketGivingByCause()` in `src/lib/ledger.ts`) reads `beneficiaryCause` directly and has no relationship to `budgetLineId`. Every transaction that ISN'T linked to a budget line (all income, lump-sum-category expenses, anything the treasurer skips the picker on) still depends entirely on free-text `beneficiaryCause` quality for both `/members/impact` and this feature's own fuzzy fallback. **Recommend: keep B-18, but lower its urgency** — it's no longer a hard prerequisite for budget-vs-actual accuracy on *linked* transactions (B-30 solves that directly via FK, no structured-cause dependency), so its remaining value is narrower: tightening `/members/impact`'s buckets and improving the fallback-match quality for un-linked rows.
- **B-19 (cause-level budget-vs-actual) — SUPERSEDED by B-30.** B-19's stated job ("compare each cause budget line item against actuals... needs the transaction's cause to be structured (B-18)") is exactly what B-30 delivers, at a *finer* grain (line-item, not just cause) and via a *stronger* mechanism (explicit FK, not structured-text matching) — B-19's dependency on B-18 was only needed because its planned mechanism was still string-matching-based; B-30's FK sidesteps that dependency entirely. Recommend marking B-19 closed/superseded in the backlog with a pointer to this work-log and to the fiscal-report-breakdown work-log (which is the actual UI consumption of "cause-level budget-vs-actual").
- **B-17 Increment A** (already shipped — cause/line-item budget entry) is unaffected; B-30 builds on top of it (the FK target IS a `ledger_budget_lines` row from that increment).

## Pass 4 — Edge Cases the Request Didn't Mention

- **Reimbursements are structurally out of the loop today** — confirmed above (no `categoryId`, no `beneficiaryCause`, therefore no path to `budgetLineId` either) — worth restating as its own edge case beyond the Resolve section: even after B-30 ships, a reimbursement paid through the existing mark-paid route produces a transaction that is invisible to every budget-vs-actual view (category-grain AND line-grain) until someone manually edits it afterward. Recommend the mark-paid dialog gain, at minimum, a required-or-strongly-encouraged category picker (it already collects fund + payment method + payment date at that step — category is a natural fourth field), with an optional budget-line picker following the same rules as the main transaction form. This is new scope Chris should explicitly bless or defer (see Open Questions).
- **OAuth-vs-password / access-pending:** not applicable — this entire feature lives behind admin `ledger.record`, not a member-facing auth path.
- **Google Group sync:** not touched.
- **Email queue:** not touched — no notification implied by linking a transaction.
- **Empty state:** a fund/FY with no budget at all → picker shows "No budget lines available" (not blank, not broken) — same empty-state convention as the rest of the Ledger's optional selects.
- **Mobile (360px):** the picker is one more `<select>` in an already-mobile-tested form (`transaction-form.tsx` already handles 360px per existing Ledger patterns) — low risk, but Phase 3/QA should confirm the grouped-by-category-then-cause option list doesn't overflow on a narrow viewport (native `<select>` renders natively on mobile regardless, so this is lower-risk than a custom dropdown).
- **Brand consistency:** picker is a `<select>` matching the form's existing `rounded-lg` input styling — no new pattern. The "collapse a breakdown with linked transactions" warning (Resolve #1) should use `<ConfirmDialog>`, never `window.confirm`.
- **Failure microcopy:** the FY-mismatch auto-clear (Resolve #1) needs real copy — "This link was cleared because the transaction date moved to a different fiscal year" — not a silent value change the treasurer has to notice on their own.

## Pass 5 — Adversarial Pass

- **Redirect targets:** none — no URL params, no callback flow.
- **State-machine shortcuts:** could an admin PATCH a transaction's `budgetLineId` via direct API call to a line that belongs to a *different* fund or FY than the transaction, bypassing the form's client-side filtering? **Yes, if the PATCH route doesn't re-validate server-side.** This must be enforced in `src/app/api/admin/ledger/transactions/[id]/route.ts`, not just the picker's client-side filter — re-derive the transaction's FY from its (possibly also-changing, in the same request) `txnDate`/`fundId` and reject (400) a `budgetLineId` whose budget row doesn't match. Flag as a hard requirement for Phase 3/4, not a nicety.
- **Enumeration leaks:** not applicable — admin-only, authenticated surface, no cross-user data exposure risk from picking a line.
- **Input boundaries:** `budgetLineId` is a UUID FK — invalid/non-existent UUID should 400, not 500; mirrors how `categoryId` is already validated in the same route (`ledger.ts:265` pattern in the create route reads the category to confirm existence before accepting it — same treatment needed for `budgetLineId`).
- **Self-targeting:** not applicable — no privilege escalation surface here.

## Gaps the Request Didn't Address

1. **Reimbursement mark-paid has no category/cause capture at all today** — a pre-existing gap, not introduced by B-30, but B-30 is the natural moment to fix it since otherwise every reimbursement-derived transaction remains permanently un-linkable. See Resolve section + Open Questions.
2. **`beneficiaryCause` is UI-create-only** even though the API already supports editing it — the picker's edit-mode auto-fill behavior requires resolving this UI gap regardless of B-30's own scope. Flagging so Phase 3 doesn't treat it as new/surprising scope creep — it's a pre-existing inconsistency this feature is forced to touch.
3. **Collapsing a budget breakdown with live transaction links** silently orphans them (schema-safe, report-silent) unless Phase 3 adds a warning — see Resolve #1.
4. **The backfill's unmatched bucket has no defined resolution workflow** beyond "Chris manually fixes it" — fine for a one-time backfill, but if this becomes a recurring need (new FYs, ongoing small mismatches), consider whether the admin UI eventually wants a permanent "unmatched transactions" view rather than only a script output. Recommend deferring this — not needed for v1, flag as a possible fast-follow only if the manual-fix workflow proves painful in practice.

## Out of Scope (confirm with user)

- Retiring `beneficiaryCause` as free text (B-18) — orthogonal, not superseded, stays a separate backlog item.
- Changing `/members/impact`'s cause bucketing — untouched, reads `beneficiaryCause` directly regardless of linking.
- A permanent "unmatched transactions" admin view beyond the one-time backfill script's report output (Gap 4) — recommend deferring.
- Cross-FY line-to-line mapping for the prior-year-reference feature — recommend staying on the fuzzy path for now (Resolve #3).

## Open Questions

1. **Reimbursements: in or out of scope for this pass?** I recommend bringing a category picker (and optionally a budget-line picker) into the mark-paid dialog now, since deferring it means B-30 ships while reimbursement-derived transactions remain structurally invisible to every budget-vs-actual view. If Chris wants to defer, that should be an explicit call, not a silent omission.
2. **Collapse-a-breakdown-with-live-links:** block with a `<ConfirmDialog>` warning showing the linked-transaction count (Resolve #1, option a), or accept silent orphaning for v1 and rely on the backfill script being re-runnable (option b)? I lean (a).
3. **`beneficiaryCause` edit-mode UI:** once the picker auto-fills cause from a line, should the free-text cause input become edit-visible for the *un-linked* case too (so a treasurer can also change cause on an already-existing, never-linked transaction), or does this feature only need to unlock cause-editing specifically when a line is being picked? I recommend the former (fully unlock it) since the API already supports it and a narrower unlock would just be more UI complexity for the same underlying capability.
4. **Backfill scope:** run once against all historical FYs (FY2025 explicitly prioritized per Chris's ask), or a first pass limited to FY2025 only with later FYs deferred to a second run? I recommend running the same script against all FYs in one pass — the algorithm doesn't get more expensive per FY, and "old reports become testable" benefits from more coverage, not less.
5. **The "approximate match" fallback indicator's exact copy/placement** on the member Statement (Resolve #5) — a Phase 3 design question, not a blocker, but worth Chris seeing a mock before it ships since it's the one piece of this feature a non-admin member actually sees.
6. **Who resolves backfill mismatches** — Chris personally (treasurer), or can an admin/api-developer make the label/party edit directly from the unmatched report without Chris's sign-off on each one? Affects whether the backfill's output needs to be a formatted report Chris reviews, or something an implementer can act on independently.

## What I did

- Read `docs/backlog.md` B-30 in full, plus its stated neighbors B-17 (and its Increment A split), B-18, B-19, and B-29 (the "B-30 second" sequencing note and the dropped label=party autocomplete).
- Read `docs/work-log/2026-07-30-fiscal-report-cause-breakdown.md` in full (Phase 1 already complete, READY WITH NOTES) to ground the fold-in section in its existing scope call, zero-omission rule, and accuracy-caveat finding rather than re-deriving them.
- Read `src/lib/ledger.ts`: `isCauseEligibleCategory`, `causeLineReferenceKey`, `buildCauseActualsByKey`, `isCauseLineLive`, `normalizeBudgetLineLabel`, `bucketGivingByCause` — confirmed the exact matching mechanism, its trim-only normalization, and confirmed `/members/impact`'s cause bucketing is independent of any budget-line link (load-bearing for the B-18 reconciliation).
- Read `src/lib/ledger-queries.ts`'s `getFundReport()` in full around the budget/actuals-building section (~lines 590-842): confirmed category-grain actuals are already exact (FK-based), only cause/line-grain is fuzzy; confirmed `causeActualsByKey`'s construction and its one live consumer today (`budget-cause-editor.tsx`'s prior-year reference display, informational only, not yet a report figure).
- Read `src/lib/financial-report-queries.ts`'s `computeOneMonthCashActuals()` / `getMonthlyStatement()` to confirm the One-Month grain buckets by `(categoryId, flow)` only today and can add a `budgetLineId` bucket at zero extra query cost.
- Read `src/lib/db/schema.ts` for `ledgerTransactions`, `ledgerBudgets`, `ledgerBudgetLines`, `ledgerCategories`, `ledgerReimbursements` in full — confirmed FK shapes, the `(budgetId, cause, label)` uniqueness, and that `ledgerReimbursements` has no `categoryId` column at all.
- Read `src/components/admin/ledger/transaction-form.tsx` in full for the category/party/memo/beneficiaryCause fields — found and confirmed the `beneficiaryCause` create-only UI gate (`!isEdit`) contradicts the PATCH route, which already accepts edits to it.
- Read `src/app/api/admin/ledger/transactions/route.ts` (POST) and `.../[id]/route.ts` (PATCH) in full for the fields each already validates/persists.
- Read `src/app/api/admin/ledger/reimbursements/[id]/route.ts`'s mark-paid transaction-insert in full — confirmed no `categoryId`/`beneficiaryCause` are set, the single most concrete "assess whether reimbursements are in scope" finding.
- Read `src/lib/fiscal-year.ts` (`getFiscalYear`) — the shared FY-derivation helper this feature reuses rather than reinventing.
- Read `scripts/backfill-bank-account.ts` in full as the house style precedent for the backfill script's shape (dotenv load, `--apply`/dry-run default, `PROD_DATABASE_URL` targeting, idempotent `WHERE column IS NULL` guard).
- Checked `docs/reviews/log.md`-adjacent cadence is not required here (this is new Phase 1 work, not a periodic review trigger) — no review cadence check performed since none was due for this kind of work.

## Outputs

- `docs/work-log/2026-07-30-transaction-budget-line-link.md` (this file).
- `docs/backlog.md` B-30 updated with a pointer to this work-log and a note that it subsumes the fiscal-report-cause-breakdown work-log's Phase 1 and reshapes B-18 (kept, lowered urgency) / B-19 (superseded).
- No code changes — Phase 1 only.

## Open questions / handoff notes

See "Open Questions" above — particularly #1 (reimbursement scope) and #2 (collapse-with-live-links behavior), since both materially change the size of Phase 3's design doc. Recommend routing to **architect (Phase 2)** next to rule on: (a) whether the reimbursement mark-paid flow's category/link picker is in this feature's scope or a fast-follow, (b) the collapse-with-live-links confirm-dialog's query cost, and (c) confirming the fiscal-report-breakdown fold-in's admin-Fund-Report secondary-scope question (inherited, still unconfirmed) alongside this feature rather than as a separate architectural pass.

---

# Phase 2 — Architectural Footprint (tech-lead note, fast-tracked)

**No architect agent was spawned for this pass** — noted here explicitly per the
"no silent skips" documentation discipline (CLAUDE.md's Bug-Fix Variant, applied here
by analogy since Chris's three locked decisions already resolved the two open questions
that would have been architect's actual judgment calls: reimbursement scope and the
collapse-confirm mechanism). What's left for Phase 2 to rule on is a pure structural-fit
check, and it's a clean no:

- **No new top-level directory.** Every file touched or added lives inside existing
  directories: `src/lib/db/schema.ts` (existing table gets one new column), `drizzle/migrations/`
  (one new file), `src/lib/ledger.ts` / `src/lib/ledger-queries.ts` / `src/lib/financial-report-queries.ts`
  (existing modules gain functions), `src/app/api/admin/ledger/**` (existing route handlers
  gain fields), `src/components/admin/ledger/**` (one new small presentational component,
  `budget-line-picker.tsx`, alongside its ~15 existing siblings), `scripts/` (one new backfill
  script, matching ~10 existing precedents).
- **No new npm dependency.** Every piece (grouped `<select>`, `<ConfirmDialog>`, Drizzle
  joins, `pnpm exec tsx` script) reuses machinery already in the dependency graph.
- **No new client/server boundary.** `transaction-form.tsx` and `pay-reimbursement-dialog.tsx`
  are already `'use client'`; the admin Fund Report page and the member Statement page are
  already Server Components reading a query-layer return type — this feature widens those
  return types, it doesn't change who's a Server vs. Client Component.
- **Schema footprint is one nullable FK + one index** on an existing table
  (`ledger_transactions.budget_line_id → ledger_budget_lines.id`, `ON DELETE SET NULL`) —
  the smallest possible structural change, not a new table, not a new relationship shape
  the rest of the schema hasn't already established (mirrors `duesPaymentId`'s existing
  nullable-FK-with-unique-ish precedent on the same table).

**Verdict:** Approved — trivial footprint, fast-tracked. If a future reviewer wants a full
architect pass on this work-log specifically, the open items to re-litigate would be the
same two Chris already locked (reimbursement scope, collapse-confirm mechanism) — nothing
structural remains open.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Give the treasurer an explicit, FK-backed way to say "this transaction is that budget
line" — a nullable `budgetLineId` on `ledger_transactions`, pointed at `ledger_budget_lines`.
Two entry points get a picker: the main transaction form (create + edit, expense-only) and
the reimbursement mark-paid dialog, which today drops category and cause entirely and is
being fixed in the same pass per Chris's lock. Report queries (`getFundReport()`,
`computeOneMonthCashActuals()`) gain an exact FK-keyed aggregation per budget line, with the
existing fuzzy `causeLineReferenceKey` match demoted to a **permanent, visibly flagged
fallback** for genuinely un-linked rows — never both counted for the same transaction. The
member Monthly Statement and the admin Fund Report both grow a cause/line-item breakdown
under any category that has one, always-rendered, zero-row-omitted, with a synthesized
"Other" catch-all so visible detail always foots to the category total. A dry-run-first
backfill script links existing historical data across every fiscal year in one pass,
reporting (never guessing) every row it can't match. Collapsing a budget breakdown that has
live transaction links now warns via `<ConfirmDialog>` with a real count instead of silently
orphaning them.

## Permissions

No new `FEATURES` key. Existing keys cover every surface:

- **Both pickers** (transaction form + reimbursement mark-paid): `FEATURES.LEDGER_RECORD`
  (`ledger.record`) — identical to what already gates each form.
- **Report surfaces** (member Statement, admin Fund Report): unchanged. Member surface
  stays ungated (any linked member); admin surface stays on `LEDGER_VIEW`/`LEDGER_RECORD`/`LEDGER_MANAGE`.
- **Collapse-with-links warning**: no new gate — it's a richer confirm on the same
  `LEDGER_MANAGE`/`BUDGET_EDIT`-gated collapse action that already exists.
- **Backfill script**: not `FEATURES`-gated — a `pnpm exec tsx` script run by a human with
  DB/deploy access, matching every prior `scripts/backfill-*.ts` precedent.

## Data Model

**One column + one index on an existing table.** No new tables.

`src/lib/db/schema.ts` — add to `ledgerTransactions` (after `donorId`, before the
reconciliation-session pointer, keeping related "what does this money apply to" FKs
grouped):

```typescript
// Explicit link to a budget line item (B-30, DECISION-061) — nullable, expense-only
// at the app layer (only expense-flow, giving-eligible categories have lines to point
// at — see isCauseEligibleCategory). onDelete: 'set null' — collapsing a budget
// breakdown deletes its ledger_budget_lines rows; a linked transaction survives as
// simply un-linked, never orphaned/crashing. The UI warns before that happens (see
// the collapse ConfirmDialog change below) but the FK itself is the safety net.
budgetLineId: uuid("budget_line_id")
  .references(() => ledgerBudgetLines.id, { onDelete: "set null" }),
```

And in the `(t) => [...]` index array:

```typescript
index("ix_ledger_txns_budget_line").on(t.budgetLineId),
```

**Migration** — `drizzle/migrations/0072_ledger_txn_budget_line.sql` (0071 is taken by
`ledger_budget_notes`, DECISION-060 — **database-admin must re-check this number at
implementation time**, since other concurrent work may claim 0072 first):

```sql
ALTER TABLE ledger_transactions
  ADD COLUMN IF NOT EXISTS budget_line_id uuid REFERENCES ledger_budget_lines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_ledger_txns_budget_line ON ledger_transactions (budget_line_id);
```

Both statements are naturally idempotent (`IF NOT EXISTS`) — no seed data, no backfill in
the migration itself (the backfill is a separate, reviewed script, never folded into a
migration that re-runs unattended on every deploy).

**No schema change on `ledger_reimbursements`.** Confirmed in Phase 1: the row already
carries an optional, member-supplied `beneficiaryCause` — the mark-paid gap is that this
value is never copied onto the transaction the pay action creates, and no `categoryId` is
ever collected at all. Both are fixed at the API layer (the pay action's insert), not the
schema layer — see "Reimbursement Mark-Paid Picker" below.

## Component/Page Plan

**New:**
- `src/components/admin/ledger/budget-line-picker.tsx` — shared presentational
  `<BudgetLinePicker>`, used by both the transaction form and the reimbursement mark-paid
  dialog (extracted once, per DECISION-060's own precedent against copying a private
  helper/markup pattern into a second file).
- `scripts/backfill-budget-line-links.ts`.

**Modified:**
- `src/lib/db/schema.ts` — `ledgerTransactions.budgetLineId` + index.
- `src/lib/ledger.ts` — `resolveCauseLineActual()`, `isEligibleForFuzzyCauseMatch()`,
  `shouldClearBudgetLineLink()` (new pure helpers, each unit-tested — see Implementation
  Order).
- `src/lib/ledger-queries.ts` — `getFundReport()` (exact aggregation + fuzzy exclusion +
  enriched `causeLines[]`); new `getBudgetLineOptions(entityId)` query;
  `collapseBudgetCauseLines()`'s caller gets a pre-collapse linked-count (see below).
- `src/lib/financial-report-queries.ts` — `computeOneMonthCashActuals()` (budget-line +
  cause-key bucketing); `MonthlyStatementCategoryLine`/`MonthlyStatement` types gain
  `causeLines`; `getMonthlyStatement()`'s `buildLines()` builds them + the "Other" row +
  zero-omission filter.
- `src/app/api/admin/ledger/transactions/route.ts` (POST) — accept + validate `budgetLineId`.
- `src/app/api/admin/ledger/transactions/[id]/route.ts` (PATCH) — accept + validate
  `budgetLineId`; server-side auto-clear on FY/category mismatch.
- `src/app/api/admin/ledger/reimbursements/[id]/route.ts` (pay action) — accept
  `categoryId` (required) + `budgetLineId` (optional); carry `beneficiaryCause` from the
  reimbursement row onto the new transaction.
- `src/app/api/admin/ledger/budgets/cause-lines/collapse/route.ts` — return
  `unlinkedCount` in the response (data already available from the pre-collapse fetch;
  no new query).
- `src/components/admin/ledger/transaction-form.tsx` — wire in `<BudgetLinePicker>`;
  relax `beneficiaryCause`'s create-only UI gate (fixes the found bug — the PATCH API
  already accepts edits, the form never sent them).
- `src/components/admin/ledger/transaction-form-dialog.tsx`, and every page/component that
  renders `TransactionForm`/`TransactionFormDialog` today (`src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx`,
  `src/components/admin/ledger/ledger-entity-detail.tsx`, `split-transaction-dialog.tsx`,
  `transaction-actions.tsx`) — thread a new `budgetLines` prop, mirroring how `categories`
  already threads through every one of these call sites.
- `src/components/admin/ledger/pay-reimbursement-dialog.tsx` — add a required category
  `<select>` + `<BudgetLinePicker>`; its parent gains `categories`/`budgetLines` props,
  mirroring the existing `funds` prop.
- `src/components/admin/ledger/budget-cause-editor.tsx` — collapse `<ConfirmDialog>`
  description becomes dynamic, naming the linked-transaction count.
- `src/app/(dashboard)/admin/ledger/[fundSlug]/report/page.tsx` — render cause/line
  sub-rows (exact + flagged-fuzzy + Other) under each `countsAsGiving` category.
- `src/components/members/monthly-statement-table.tsx` — render the same shape for the
  member Statement.

## The Two Pickers

### 1. Transaction form (`transaction-form.tsx`)

Renders only when `!isTransferOrSweep && !isEditingTransfer && apiFlow === "expense"` —
the same guard the existing category/party/cause fields already use, right below the
beneficiary-cause field.

- **Data source**: `getBudgetLineOptions(entityId)` (new query in `ledger-queries.ts`) —
  one query joining `ledgerBudgetLines → ledgerBudgets → ledgerCategories`, filtered to
  `ledgerBudgets.flow = 'expense'` and the budget's fund belonging to `entityId`. Returns:

  ```typescript
  export type BudgetLineOption = {
    id: string;               // ledger_budget_lines.id — the value this feature stores
    fundId: string;
    fiscalYear: number;
    categoryId: string;
    categoryName: string;
    cause: string;
    label: string;
    pendingDeleteAt: string | null;
  };
  ```

  Fetched once, server-side, by the same page that already fetches `funds`/`categories`
  for `TransactionFormDialog` (mirrors that existing pattern exactly) and passed down as a
  new `budgetLines: BudgetLineOption[]` prop. Cheap — bounded by however many budget lines
  an entity has ever had across every fiscal year (tens to low hundreds of rows), no N+1.

- **Client-side filter** (in `<BudgetLinePicker>`, reactive to `fundId`/`txnDate`/`categoryId`
  the same way `filteredCategories` already reacts to `fundId`/`flowMode`):

  ```typescript
  const effectiveFY = getFiscalYear(new Date(txnDate + "T00:00:00")); // pure, client-safe (src/lib/fiscal-year.ts)
  const candidates = budgetLines.filter(
    (l) =>
      l.fundId === fundId &&
      l.fiscalYear === effectiveFY &&
      (l.pendingDeleteAt === null || l.id === value), // don't OFFER a pending-delete line as a NEW pick, but don't hide an already-selected one
  );
  ```

- **Rendering**: one `<select>`, default `"No linked budget line"`, grouped by `<optgroup label={categoryName}>`, with each `<option>` text = `${cause}${label ? " — " + label : ""}`. Native `<select>`, no new visual vocabulary, `rounded-lg` matching every other form control. Empty candidate list renders the select with only the default option and a line of `text-gray-400` helper text: "No budget lines available for this fund/year."

- **Selecting a line auto-fills**: `categoryId` (from the line's `categoryId`) and
  `beneficiaryCause` (from the line's `cause`) — both remain editable afterward (the
  treasurer can hand-edit the auto-filled cause text without invalidating the link; only
  `categoryId`/`txnDate` changes affect link validity — see Link Integrity below). If the
  treasurer had already picked a *different* category before opening the picker, selecting
  a line that implies a different category shows a one-line inline notice ("This line
  belongs to Grants — category will update") rather than silently overwriting with no
  feedback.

- **`beneficiaryCause` UI gate fix**: the field's current `!isEdit` guard is removed. It
  now renders whenever `!isTransferOrSweep && apiFlow === "expense"`, in both create and
  edit mode — closing the gap where the PATCH API already accepted `beneficiaryCause`
  edits the form never sent (Phase 1 Gap 2). This is required regardless of whether a line
  is picked, since the picker's edit-mode auto-fill has to write into a field edit mode can
  already show.

- **Payload**: `TransactionForm`'s `performSubmit()` adds `budgetLineId: budgetLineId || null` to both the POST (create) and PATCH (edit) bodies, mirroring exactly how `categoryId`/`beneficiaryCause` are already sent.

### 2. Reimbursement mark-paid (`pay-reimbursement-dialog.tsx`)

Per Chris's lock, this flow gains category capture now rather than staying a permanent
blind spot. Cause is **not** a new field here — `ledgerReimbursements.beneficiaryCause` is
already collected at submission time (member-supplied, optional) and simply needs to be
carried onto the transaction the pay action creates, which it isn't today.

- **New required field**: Category `<select>`, positioned after the Fund picker (fund
  determines which categories are eligible — `categories.filter(c => c.fundKind === selectedFund.kind && c.flow === "expense")`, identical filter logic to `transaction-form.tsx`'s `filteredCategories`). Required — the "Mark Paid" button disables until both `fundId` and `categoryId` are set (extends the existing `disabled={submitting || !fundId}` check).
- **New optional field**: the same `<BudgetLinePicker>` component, filtered by
  `(fundId, getFiscalYear(paymentDate), categoryId)` — identical mechanics to the
  transaction form's picker, reused rather than reimplemented.
- **Props**: `PayReimbursementDialog` gains `categories: LedgerCategory[]` and
  `budgetLines: BudgetLineOption[]`, threaded from whichever page/component already passes
  it `funds` today (same fetch site, same pattern).
- **Server (pay action, `reimbursements/[id]/route.ts`)**: body gains
  `categoryId: string` (now required — 400 if missing) and `budgetLineId?: string | null`
  (optional). Both validated identically to the main transaction POST route (category
  exists, `fundKind` matches the chosen fund, `flow === 'expense'`; budget line belongs to
  a budget row matching `(fundId, getFiscalYear(paymentDate), categoryId, flow='expense')`).
  The transaction insert gains three fields it doesn't set today:

  ```typescript
  categoryId,
  beneficiaryCause: reimb.beneficiaryCause ?? null,   // carried over, not newly collected
  budgetLineId: budgetLineId ?? null,
  ```

- **Scope note**: this only affects reimbursements paid *after* this ships. Reimbursements already paid keep their categoryless transaction rows — those are exactly the backfill script's "reimbursement-derived, no category" bucket (Phase 1 Resolve #4), which reports them for manual follow-up rather than guessing a category. Out of scope: back-filling category on already-paid reimbursements automatically.

## Link Integrity (server-enforced, not just client filtering)

Per Phase 1's adversarial pass (Pass 5): a direct PATCH bypassing the form's client-side
filter must not be able to link a transaction to a budget line from the wrong fund or
fiscal year. Both routes validate server-side; the PATCH route additionally auto-clears a
now-stale link rather than rejecting the whole edit.

**POST `/api/admin/ledger/transactions`** (create): when `budgetLineId` is present and
non-null, look up its budget row and reject (400) unless ALL of:
- the line's budget `fundId === body.fundId`
- the line's budget `fiscalYear === derivedFiscalYear` (from `txnDate`)
- the line's budget `categoryId === body.categoryId` (so a client can't send a mismatched pair)
- `body.flow === 'expense'`

Mirrors the existing `categoryId` validation in the same route (fetch → 404 if missing →
400 if mismatched) — same shape, same error-message style.

**PATCH `/api/admin/ledger/transactions/[id]`** (edit) — two cases:

1. **Client explicitly sends `budgetLineId`** (picking, changing, or clearing the link):
   validate exactly like POST above, using the *effective* fund (immutable — fund is never
   editable via this route, confirmed reading the handler), *effective* FY (from
   `update.txnDate ?? existing.txnDate`), and *effective* category (`update.categoryId !== undefined ? update.categoryId : existing.categoryId`). Mismatch → 400.
2. **Client does NOT touch `budgetLineId`, but changes `txnDate` or `categoryId` such that
   the EXISTING link no longer matches** (re-dating into a different FY, or re-categorizing
   away from the line's category): **auto-clear, don't reject.** Pure helper:

   ```typescript
   // src/lib/ledger.ts
   export function shouldClearBudgetLineLink(
     linkedLineBudget: { fiscalYear: number; categoryId: string | null },
     effectiveFiscalYear: number,
     effectiveCategoryId: string | null,
   ): boolean {
     return (
       linkedLineBudget.fiscalYear !== effectiveFiscalYear ||
       linkedLineBudget.categoryId !== effectiveCategoryId
     );
   }
   ```

   When true: `update.budgetLineId = null`, and the response gains
   `budgetLineLinkCleared: true` so the client can toast the microcopy Phase 1 specified
   verbatim: *"This link was cleared because the transaction date moved to a different
   fiscal year — please re-select"* (or the category-mismatch variant of the same
   sentence). This only fires when `existing.budgetLineId` is actually set — a no-op
   lookup otherwise.

**Locked budget**: confirmed no gate needed — linking a transaction writes only
`ledger_transactions.budget_line_id`, never `ledger_budget_lines.amount_cents` or any
other budget figure, so `assertBudgetUnlocked()` is correctly never called here (Phase 1's
own reading, confirmed by re-reading `assertBudgetUnlocked`'s callers — none touch
`ledgerTransactions`).

**Pending-delete lines**: still linkable server-side (no extra validation blocks it) —
only the picker's client-side filter excludes them as a *new* option, per Phase 1's
"still counts" reading (mirrors `isCauseLineLive`'s existing semantics elsewhere).

**Invalid UUID**: `budgetLineId` a non-existent/malformed UUID → 400, not 500, matching
the existing `categoryId` treatment in both routes.

## Report Query Change + Fallback Flagging

**Core rule, enforced by construction, not convention: a linked transaction contributes to
the exact aggregation and is excluded from the fuzzy pool. Never both.**

New pure helper (`src/lib/ledger.ts`), the single seam every consumer below calls through:

```typescript
/** Resolves a cause line's actual: exact link wins outright; the fuzzy match is a
 *  permanent, flagged fallback ONLY when there is no exact link at all. Never both. */
export function resolveCauseLineActual(
  linkedCents: number,
  fallbackCents: number | null,
): { cents: number; isFuzzyFallback: boolean } {
  if (linkedCents > 0) return { cents: linkedCents, isFuzzyFallback: false };
  if (fallbackCents && fallbackCents > 0) return { cents: fallbackCents, isFuzzyFallback: true };
  return { cents: 0, isFuzzyFallback: false };
}
```

**`getFundReport()` (`ledger-queries.ts`)**: in the same loop that already builds
`causeActualSourceRows` from `postedTxns` (~line 728), split into two maps instead of one
list, using a pure eligibility predicate:

```typescript
// src/lib/ledger.ts
export function isEligibleForFuzzyCauseMatch(txn: {
  flow: string; categoryId: string | null; budgetLineId: string | null; beneficiaryCause: string | null;
}): boolean {
  return txn.flow === "expense" && !!txn.categoryId && !txn.budgetLineId && !!txn.beneficiaryCause?.trim();
}
```

```typescript
const actualByBudgetLineId = new Map<string, number>();
const linkedTxnCountByBudgetLineId = new Map<string, number>();
for (const txn of postedTxns) {
  if (txn.flow === "expense" && txn.budgetLineId) {
    actualByBudgetLineId.set(txn.budgetLineId, (actualByBudgetLineId.get(txn.budgetLineId) ?? 0) + txn.amountCents);
    linkedTxnCountByBudgetLineId.set(txn.budgetLineId, (linkedTxnCountByBudgetLineId.get(txn.budgetLineId) ?? 0) + 1);
  }
}
// causeActualSourceRows loop gains one line: `if (!isEligibleForFuzzyCauseMatch(txn)) continue;`
// replacing the current unconditional cause-tag check — this is the ONE change that makes
// "linked transactions never feed the fuzzy pool" true structurally.
```

`causeLinesFor()`'s per-line object (and `FundReportCategoryLine.causeLines[]`'s type) gain
three fields, resolved via `resolveCauseLineActual()`:

```typescript
linkedActualCents: number;         // raw exact sum — 0 if nothing linked yet
linkedTransactionCount: number;    // feeds the collapse-with-links ConfirmDialog
actualCents: number;               // renamed conceptually: resolveCauseLineActual(...).cents
isFuzzyFallback: boolean;          // true only when actualCents came from the fuzzy path
```

`FundReport` itself gains nothing new at the top level — `causeActualsByKey` stays exactly
as-is (still needed as the fallback's data source, and still the sole mechanism for the
cross-FY prior-year-reference feature, which Phase 1 already decided stays on the fuzzy
path unchanged). The `if (!isEligibleForFuzzyCauseMatch(txn)) continue` guard is the one
place this cascades correctly into that consumer too, with no separate change needed
there.

**`computeOneMonthCashActuals()` (`financial-report-queries.ts`)**: parallel change. The
existing row select gains `budgetLineId`, `beneficiaryCause`, `party`. Two new maps
populated in the same existing loop (no new DB round-trip):

```typescript
byBudgetLine: Map<string, number>;   // exact, keyed by budgetLineId
byCauseKey: Map<string, number>;     // fuzzy fallback, keyed by causeLineReferenceKey — same isEligibleForFuzzyCauseMatch guard
```

`OneMonthCashActuals`'s type gains both maps alongside the existing `byCategory`.

**`getMonthlyStatement()`'s `buildLines()`**: for every category whose `causeLines !== null`
(i.e. it already has a cause breakdown — budget-driven, per the fiscal-report-breakdown
work-log's Gap 2 answer, carried forward unchanged), build a `MonthlyStatementCauseLine[]`:

```typescript
export type MonthlyStatementCauseLine = {
  id: string;              // budget line id, or "other" for the synthesized catch-all
  cause: string;
  label: string;
  oneMonthCents: number;
  twelveMonthCents: number;
  annualBudgetCents: number | null;
  isFuzzyFallback: boolean;
  isOtherRow: boolean;
};
```

For each real line: `oneMonthCents`/`twelveMonthCents` via `resolveCauseLineActual()` fed
by `oneMonth.byBudgetLine`/`oneMonth.byCauseKey` (One-Month) and `line.linkedActualCents`/
`line.actualCents` from the already-fetched `currentReport` (Twelve-Month — zero extra
query, exactly like today's category-grain figures). `annualBudgetCents = line.amountCents`.

**"Other" catch-all row** (per category, closing Phase 1's fiscal-report-breakdown Gap 1 —
folded in here): `categoryTotal − Σ(resolved named-line cents)`, computed independently for
One-Month and Twelve-Month. `annualBudgetCents: null` always (budget lines already sum to
the category's budget by construction — DECISION-045 — so there's never a leftover budget
dollar to attribute to "Other," only leftover *actuals* from cause-tagged-but-unmatched or
untagged transactions). `isFuzzyFallback: false`, `isOtherRow: true` — it's a residual, not
a matched figure, so it never carries the fuzzy footnote itself. **Not clamped at zero** —
if "Other" ever goes negative, that's a real double-counting bug surfacing, not a display
glitch to hide (flagged as an edge case below).

**Zero-omission rule** (fiscal-report-breakdown work-log's Resolve #2, carried forward
verbatim, applied at BOTH category and cause-line grain, and specifically including the
new "Other" row):

```typescript
// src/lib/financial-report-queries.ts (or ledger.ts — implementer's call, either is fine)
export function isAllZeroRow(row: {
  oneMonthCents: number; twelveMonthCents: number; annualBudgetCents: number | null;
}): boolean {
  return row.oneMonthCents === 0 && row.twelveMonthCents === 0 && (row.annualBudgetCents === null || row.annualBudgetCents === 0);
}
```

AND across all three columns, never OR. Filters **display only** — `sumTotals()` keeps
summing the full, unfiltered array; only the rendered row list drops all-zero rows. Applies
identically to today's existing category-only rows (Gap 8 — yes, this is a small visible
behavior change to categories that had no cause breakdown before, per the analyst's own
reading of Chris's original wording).

## Fiscal-Report Breakdown (folded in)

**Both surfaces get the breakdown** — the member Statement (primary) AND the admin Fund
Report (secondary), per this task's explicit direction, resolving Phase 1's Open Question 1.

- **Always-render, never collapsible** (resolves Gap 5) — this is a printed/read board
  document, not an explorable UI; no new `'use client'` boundary needed on either page.
- **Fuzzy-fallback rows get a small, non-alarming visual marker** — a superscript symbol
  or a light `text-gray-400` tag next to the dollar figure (e.g. "~$420.00" or
  "$420.00 †"), NOT a loud warning badge — this is a board-facing document. A single
  shared footnote at the bottom of the table: *"Amounts marked † are matched by payee name
  and may not capture every transaction — the category total above is fully reconciled
  regardless."* One footnote per table, not one per row, keeping the print layout clean.
- **Member Statement** (`monthly-statement-table.tsx`): cause-line rows render as indented
  sub-rows under their category row (reuse `BudgetCauseEditor`'s existing cause-line
  indentation convention per CLAUDE.md's "don't invent a new visual pattern" guidance —
  resolves Gap 6). Category column stays `min-w-[180px]` inside the existing
  `overflow-x-auto` wrapper.
- **Admin Fund Report** (`[fundSlug]/report/page.tsx`): same shape under Actual YTD /
  Budget / Variance — Variance is computed only for real budget lines (`budgetCents` is a
  real number for every named line by construction); the "Other" row shows Variance as
  "—" (no budget figure to vary against, same convention the category-grain table already
  uses for `budgetCents === null`).
- Categories with `causeLines === null` (lump-sum, or not `countsAsGiving`) render exactly
  as today — no breakdown attempted, no behavior change (Gap 2/3, carried forward
  unchanged).

## Collapse-With-Links ConfirmDialog

`budget-cause-editor.tsx`'s existing collapse `<ConfirmDialog>` (title: "Collapse to a
single lump sum?") already exists for the data-loss-of-detail warning — it just doesn't
know about linked transactions yet. Fix, at zero extra query cost:

- `causeLinesFor()`'s enriched line objects (above) already carry `linkedTransactionCount`
  per line — this flows into `BudgetCauseEditor` exactly the way `causeActualsByKey`
  already does today (bubbled straight through from the report/page.tsx → `BudgetEditor` →
  `BudgetCauseEditor`, per Phase 1's confirmed wiring).
- Before opening the confirm dialog, sum `linkedTransactionCount` across every row
  currently in the breakdown (committed + uncommitted-but-saved rows — pending-delete rows
  excluded, they're already gone from the treasurer's mental model).
- **When the sum is 0**: description stays exactly as today's copy — no change for the
  common case.
- **When the sum is > 0**: description becomes: *"This deletes the individual cause line
  items — the category's dollar total is kept as one lump-sum amount, but the per-cause
  detail is lost. **N transaction(s) currently linked to these lines will be unlinked**
  (they'll fall back to the payee-name match, or show as unmatched) and can't be
  automatically re-linked without re-running the backfill script."* Still `destructive`,
  still labeled "Collapse."
- **Server**: `POST /api/admin/ledger/budgets/cause-lines/collapse` already causes the
  unlink for free via the FK's `ON DELETE SET NULL` — no new server logic required for
  correctness. Add `unlinkedCount` to its 200 response (the pre-delete count, already
  computable in the same handler from the lines about to be deleted) purely so the client
  toast can confirm what happened ("Collapsed to a single lump-sum amount. 3 linked
  transactions were unlinked.") rather than the treasurer having to trust the pre-action
  warning was accurate.

## Backfill Script

`scripts/backfill-budget-line-links.ts` — per Phase 1's Resolve #4 (already fully
specified there; not re-derived here), locked to **all historical fiscal years in one
pass** per Chris's decision:

- **Pattern**: house style — `scripts/backfill-bank-account.ts` precedent. Dotenv-loaded,
  `--apply` flag defaulting to dry-run, `PROD_DATABASE_URL` vs `DATABASE_URL` target
  detection, only touches rows where `budget_line_id IS NULL` (idempotent re-run).
- **Scope flags**: `--entity=`, `--fiscal-year=` (optional narrowing); default with no
  flags is every FY, every entity — the locked default, not FY2025-only.
- **Pure matcher, unit-testable in isolation from the DB**:

  ```typescript
  export type BackfillMatchResult =
    | { status: "matched"; budgetLineId: string }
    | { status: "unmatched"; reason: "no-match" }
    | { status: "unmatched"; reason: "ambiguous"; candidateIds: string[] }
    | { status: "skipped"; reason: "no-category" };

  export function matchBudgetLineForTransaction(
    txn: { categoryId: string | null; beneficiaryCause: string | null; party: string | null },
    candidateLines: { id: string; cause: string; label: string; categoryId: string }[],
  ): BackfillMatchResult
  ```

  Reuses the existing `causeLineReferenceKey()`/`normalizeBudgetLineLabel()` exactly —
  **no new fuzzy logic, no Levenshtein, no guessing.** Exact match → `matched`. Zero
  matches → `unmatched`/`no-match` (reports the transaction's `party`/`categoryId`/`cause`
  alongside every candidate label that DID exist for that `(category, cause)`, so a
  Pilot-Dogs-class mismatch is immediately legible). More than one candidate (shouldn't
  happen given `(budgetId, cause, label)` uniqueness, but defended against) →
  `unmatched`/`ambiguous`. No `categoryId` at all (pre-fix reimbursement-derived rows) →
  `skipped`/`no-category`, reported in its own bucket, never lumped with genuine mismatches
  (different fix path — add a category via the edit form first, not fix a label).
- **Write**: a narrow `UPDATE ledger_transactions SET budget_line_id = $1 WHERE id = $2` —
  never touches `amountCents`/`party`/`beneficiaryCause`/anything else. **Hard guardrail
  from project memory**: the Ledger's dev AND prod DBs were seeded from Quicken exports on
  2026-07-20 and must never be re-imported — this script is structurally incapable of that
  class of mistake by construction (single-column, ID-scoped `UPDATE`, no delete-and-
  reinsert anywhere in it).
- **Discipline**: dry-run dev → Chris reviews the unmatched report → `--apply` dev →
  dry-run prod → review → `--apply` prod. Matches the multi-step discipline already
  established by `scripts/fix-ledger-categories.ts` / `scripts/rehome-misc-actuals.ts` /
  `scripts/split-event-costs.ts`.

## Implementation Order

1. **Schema (database-admin).** `ledgerTransactions.budgetLineId` + index in `schema.ts`;
   migration `drizzle/migrations/0072_ledger_txn_budget_line.sql` (re-verify the number is
   still free at implementation time). No seed data, no backfill in the migration.

2. **Pure helpers + their unit tests (api-developer, `src/lib/ledger.ts`).** Write and test
   BEFORE wiring them into queries/routes:
   - `resolveCauseLineActual(linkedCents, fallbackCents)` — tests: linked > 0 → exact,
     fallback ignored even when also nonzero (never both); linked = 0 & fallback > 0 →
     fuzzy, flagged; linked = 0 & fallback null/0 → zero, not flagged.
   - `isEligibleForFuzzyCauseMatch(txn)` — tests: linked txn excluded even with
     cause+category present; unlinked expense with cause+category → eligible; expense with
     no category → excluded; income → excluded; blank/whitespace-only cause → excluded.
   - `shouldClearBudgetLineLink(linkedLineBudget, effectiveFY, effectiveCategoryId)` —
     tests: FY match + category match → false; FY mismatch alone → true; category
     mismatch alone → true; both mismatch → true; category cleared to `null` while linked
     → true.
   - `isAllZeroRow(row)` — tests: all three zero/null → true; nonzero `annualBudgetCents`
     alone (e.g. budgeted $500, $0 spent) → false (must still render); nonzero
     `oneMonthCents` alone → false; `annualBudgetCents: 0` treated same as `null`.

3. **Query layer (api-developer, `ledger-queries.ts` + `financial-report-queries.ts`).**
   `getFundReport()`'s exact/fuzzy split using the helpers above; new
   `getBudgetLineOptions(entityId)`; `computeOneMonthCashActuals()`'s parallel bucketing;
   `getMonthlyStatement()`'s `buildLines()` producing cause-line children + "Other" row +
   zero-omission filter applied at both grains.

4. **Route handlers (api-developer).** POST/PATCH `/api/admin/ledger/transactions*`
   (`budgetLineId` validation + PATCH auto-clear + `budgetLineLinkCleared` response flag);
   PATCH `/api/admin/ledger/reimbursements/[id]` pay action (`categoryId` required,
   `budgetLineId` optional, `beneficiaryCause` carry-over); POST
   `.../budgets/cause-lines/collapse` (`unlinkedCount` in response).

5. **Backfill script (api-developer or database-admin — either is fine, no UI
   dependency).** `scripts/backfill-budget-line-links.ts`, matcher unit-tested per above,
   dry-run verified against dev before any `--apply`.

6. **UI (ux-developer).** `<BudgetLinePicker>` (new, shared); wire into
   `transaction-form.tsx` (+ relax the `beneficiaryCause` gate) and
   `pay-reimbursement-dialog.tsx` (+ required category select); thread the new
   `budgetLines`/`categories` props through every call site named in the Component/Page
   Plan; `budget-cause-editor.tsx`'s dynamic collapse-warning copy; the admin Fund Report
   table's and the member Statement table's cause/line breakdown rendering (always-render,
   footnoted fuzzy rows, "Other" row, zero-omission applied).

7. **Release notes entry** — write via `/release-notes` when this reaches Phase 6 SHIP IT.

## Edge Cases & Risks

- **"Other" row going negative** is possible if a bug elsewhere ever double-counts (e.g. a
  future change accidentally lets a linked transaction leak into the fuzzy pool). Left
  un-clamped deliberately — a negative "Other" is a loud, honest signal something's wrong,
  and clamping to zero would hide exactly the class of bug `isEligibleForFuzzyCauseMatch`'s
  guard exists to prevent.
- **A transaction linked to a line, then the line's category is later changed** — not
  possible today (no route edits a `ledger_budget_lines.categoryId`; a line's category is
  fixed at creation via its parent `ledger_budgets` row, which is itself immutable-by-
  category post-creation) — noted only so a future feature that adds line re-categorization
  remembers to re-run `shouldClearBudgetLineLink`-style logic against every linked
  transaction, not just re-derive one field.
- **Reimbursement pay action's now-required `categoryId`** is a real behavior change to an
  existing flow — every future reimbursement mark-paid requires one more field than today.
  Acceptable per Chris's lock; flagged so qa's click-through explicitly exercises the
  "Mark Paid" button staying disabled until category is picked.
- **Backfill runtime on prod's full history** — Phase 1 already sized this as "not more
  expensive per FY," but the FIRST all-FY dry-run against prod should still be watched for
  runtime/row-count sanity before `--apply` (a defensive check, not an expectation of a
  real problem).
- **Mobile (360px)**: `<BudgetLinePicker>` is one more native `<select>` in already-tested
  forms — low risk. Cause-line sub-rows in the Statement/Fund Report tables need the same
  indentation treatment `BudgetCauseEditor` already uses at narrow widths — reuse, don't
  reinvent (Gap 6, carried forward).
- **Print**: cause-line rows roughly double-to-triple the Statement's row count for
  heavily cause-tagged funds (Foundation/Charitable). Accepted per Phase 1's own lean
  (a static printed record, not an explored view) and this task's "always-render" directive
  — not re-litigated here.

## Out of Scope

- Retiring `beneficiaryCause` as free text (B-18) — orthogonal, stays a separate backlog
  item at lowered urgency.
- Changing `/members/impact`'s giving-by-cause bucketing — untouched, reads
  `beneficiaryCause` directly regardless of any link.
- A permanent "unmatched transactions" admin view beyond the backfill script's one-time
  report output — deferred (Phase 1 Gap 4); revisit only if the manual-fix workflow proves
  painful in practice.
- Cross-FY line-to-line mapping for the prior-year-reference feature — stays on the fuzzy
  path (Phase 1 Resolve #3), now with the same `isEligibleForFuzzyCauseMatch` exclusion
  applied for consistency, at no extra implementation cost.
- Back-filling category on reimbursements already paid before this ships — those surface in
  the backfill's own "no-category" bucket for manual, one-at-a-time resolution via the
  transaction edit form (which already supports setting `categoryId`).
- Light normalization of `causeLineReferenceKey` (case-fold, strip corporate suffixes) to
  shrink the fuzzy-fallback's own miss rate — real, but a separate fast-follow (both Phase
  1 documents already recommended this; unchanged here).

## Named Implementer Sequence

**Specialist split**, per CLAUDE.md's guidance for a large feature with schema + API + UI —
mirrors every prior Ledger increment:

1. **database-admin** — schema + migration (Implementation Order step 1).
2. **api-developer** — pure helpers + unit tests, query layer, route handlers, backfill
   script (steps 2–5). This is the largest chunk of the feature by line count and risk
   (link-integrity validation, exact/fuzzy report aggregation, the backfill matcher) —
   keep it as one continuous api-developer pass rather than splitting further, since the
   query-layer changes and the route handlers that consume them are tightly coupled.
3. **ux-developer** — `<BudgetLinePicker>`, both forms, both report surfaces (step 6),
   once the API surface from step 2 is real and typed.
4. **qa** — Phase 5, after all three land. Explicitly exercise: create+link a transaction;
   edit a linked transaction's date across an FY boundary and confirm the toast + cleared
   link; mark a reimbursement paid with a category and confirm the transaction inherits
   `beneficiaryCause`; collapse a breakdown with linked transactions and confirm the count
   in the dialog matches reality; view both report surfaces for a fund with real cause
   detail and confirm the "Other" row foots the category total; run the backfill script
   dry-run against dev and sanity-check its report shape (do NOT `--apply` during QA — that
   decision stays with Chris per Open Question 6).

## Decisions Logged

`docs/decisions.md` DECISION-061 (bundled implementation decisions from this design —
report-shape choice, reimbursement category requirement, link-integrity auto-clear
behavior, and the collapse-count sourcing).
