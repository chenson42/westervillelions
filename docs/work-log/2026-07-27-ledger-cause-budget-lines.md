# Cause-Level Budget Detail (B-17) — Work Log

> **Slug:** `2026-07-27-ledger-cause-budget-lines`
> **Surface:** (dashboard) admin — The Ledger budgeting
> **Permission(s):** TBD — likely existing ledger/budget permission covers this (confirm in Phase 1/3)
> **Estimated complexity:** large (schema + API + UI + seeding + taxonomy reconciliation + interaction with the v1.39.0 budget-approval lock)
> **Pipeline mode:** Full
> **Backlog:** B-17 (`docs/backlog.md`)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES (Increment A only — see split recommendation) | 2026-07-27 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-07-27 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementer named | 2026-07-27 |
| 4 — Implementation | database-admin → api-developer → ux-developer | Loop-back fix landed (api-developer, Phase 4b-fix — see below) — schema/API/UI all done, regression fix applied | — | 2026-07-27 |
| 5 — Verification | qa | Complete (re-verified after fix) | **PASS** | 2026-07-27 |
| 6 — Shipped vs intent | analyst | Complete | **SHIP IT** | 2026-07-27 |

---

> **Correction (2026-07-28):** Several passages below (Phase 1 Files Read, Gaps, Human Answer 3,
> and Edge Cases) assert "production is still unseeded" and treat an empty seed-by-cause experience
> in prod as a ship-time risk. **That premise was stale and is wrong.** Production was seeded on
> 2026-07-20 (via `scripts/port-ledger-dev-to-prod.ts`) and kept in sync through 2026-07-21; verified
> live against the production Neon branch 2026-07-28. The error traces to a wrong one-line hook in the
> author's memory index (since fixed). No code defect resulted — `computeCauseSeedForCategory()`
> returns `[]` gracefully regardless — but the "will look empty in prod" concern does not apply.

# Phase 1 — Functional Refinement (analyst)

## Files Read

- `docs/backlog.md` L32-66 (B-17, full entry)
- `docs/work-log/2026-07-27-ledger-budget-approve.md` (full — v1.39.0 lock table, `assertBudgetUnlocked()`, `upsertBudgetLine()` as the single write core, the shipped explicit "Remove line" control with `ConfirmDialog`, two-tier `LEDGER_MANAGE`/`LEDGER_APPROVE` page gate)
- `docs/work-log/2026-07-27-ledger-guided-budgeting.md` (full — seed-from-prior-year pattern, `computeSeedFromPriorYear`/`deriveSeedLinesForFund`, fill-empty vs. overwrite semantics)
- `src/lib/db/schema.ts` L538-836 (`ledgerFunds`, `ledgerCategories`, `ledgerTransactions.beneficiaryCause` — free `text`, no enum/FK — `ledgerBudgets`, `ledgerBudgetApprovals`)
- `src/lib/ledger-queries.ts` L2457-2700 (`getPhilanthropy`, `bucketGivingByCause` call site, the exact giving predicate SQL)
- `src/lib/ledger.ts` L380-480 (`bucketGivingByCause` — confirms null/blank `beneficiaryCause` already buckets to `causeKey: ''`, display label **"Other community support"** today, on `/members/impact`)
- `scripts/import-quicken-ledger.ts` L213-330, 500-535 (`deriveCause` — the live 9-value cause taxonomy; `mapFoundation`/`mapClub` — category derivation; confirms cause-eligibility is `flow==='expense' && fundKind in ('charitable','activity')` — **not** `'scholarship'`)
- `drizzle/migrations/0044_ledger_books.sql` L200-360 (fund seed: Foundation has both a `charitable` fund with a historical "Scholarships" category **and** a separate `scholarship` fund with its own "Scholarship award" category — confirms the taxonomy wart named in B-17's Q2)
- `src/lib/permissions.ts` L53-56, 121-124 (`FEATURES.LEDGER_VIEW/RECORD/MANAGE/APPROVE` — full catalog, confirms no gap for a new key)
- Grepped `ledgerReimbursements` — it also carries a free-text `beneficiaryCause` column (`ledger-queries.ts` L1663, L1716), a second existing free-text surface Q3 must account for, not just `ledgerTransactions`
- User's memory note (`project_ledger_quicken_seed.md`): the Quicken historical import — the only source of "past ~2 FYs of cause-tagged transactions" the backlog's seeding step depends on — has been run against the **local dev DB only**; **production is still unseeded**. This is load-bearing for the seeding flow and is called out below.

## VERDICT

**READY WITH NOTES** — for a narrowed **Increment A** only (cause-tagged budget line items, planning-side, no actuals matching). See "Recommended split" below; Increments B and C should not proceed past Phase 1 today.

## ONE-LINE TAKE

> Chuck's category→cause two-level budget model is the right shape and can ship as a self-contained planning feature reusing every write-path/lock/permission precedent the last two Ledger increments already established — but the backlog's own Q3 ("actuals matching needs `beneficiary_cause` to become structured") is not a detail inside this increment, it's a second, separate, data-migration-shaped feature touching two other tables' free-text historical data, and bundling it in would triple the real scope without the user having explicitly signed up for that.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`LEDGER_MANAGE`) | Toggle a budget category between **lump-sum** (one dollar amount, today's existing behavior) and **cause breakdown** (N cause-tagged line items) | Per category, mostly at year-start |
| Admin (`LEDGER_MANAGE`) | Add a cause line item to a category: pick a cause from a **controlled list** + enter a dollar amount | Per line, during budget season |
| Admin (`LEDGER_MANAGE`) | Edit an existing cause line item's amount | Per line, as needed |
| Admin (`LEDGER_MANAGE`) | Remove a cause line item | Occasional |
| Admin (`LEDGER_MANAGE`) | Read a category's computed total (sum of its cause line items) while in breakdown mode | Continuously, as they edit |
| Admin (`LEDGER_MANAGE`) | Accept/adjust proposed cause line items seeded from ~2 FYs of prior cause-tagged actuals (extends the existing guided-budgeting seed flow) | Once per season |
| Admin (`LEDGER_APPROVE`) | Approve/lock a fiscal year's budget — must now also lock cause line items, not just category-level rows | Once per FY per entity |
| Admin (`LEDGER_VIEW`/`RECORD`/`MANAGE`) | View a category's cause breakdown on the read-only fund report (no actuals comparison in this increment — see split) | As needed |

No other surface touches this. Anonymous visitors, access-pending members, and signed-in members never see a budget number, cause-tagged or not — matches the existing `LEDGER_MANAGE`-only gate on `BudgetEditor`.

## Flows

**Flow 1 — Add a cause line item to a category (enter breakdown mode):**
Entry: `/admin/ledger/budgeting` (or the per-fund report page's `BudgetEditor`), an existing category row → Step: treasurer clicks a new "Break down by cause" affordance → Step: picks a cause from a controlled dropdown (the taxonomy — see Gaps, Q2) → Step: enters a dollar amount for that cause → Step: repeats for additional causes → Outcome success: the category's displayed total becomes the sum of its line items; a new write path creates/updates a cause-scoped budget-line row.
- Failure: picking a cause already used by another line item under the same category+FY+flow → inline "This cause already has a line item — edit the existing one instead," no duplicate row (needs a DB-level unique constraint mirroring `ledger_budgets_fund_year_cat_flow_key`, widened to include cause — functional requirement, DDL is tech-lead's call). Invalid/negative amount → same validation as today's single amount field. Writing against a locked `(entity, fiscalYear)` → 409 "This budget is locked. Unlock it to make changes." (reusing `assertBudgetUnlocked()` verbatim — see Gap 5, this is not automatically true, it must be wired in).
- Unknown/off-taxonomy cause value submitted directly to the API (bypassing the dropdown) → 400, not a silent insert — cause must be server-validated against the controlled list, not just client-constrained.

**Flow 2 — Lump-sum mode (existing, unchanged):**
Entry: same category row, breakdown never toggled → Step: treasurer types one dollar amount directly, exactly as today → Outcome: unchanged, a single `ledger_budgets` row, no cause line items. **This already works — naming it explicitly so Phase 3 doesn't touch it.**

**Flow 3 — Switch a category from lump-sum to breakdown, or back:**
Entry: a category row that already has a lump-sum amount set → Step: treasurer clicks "Break down by cause" → **Undefined by the backlog: does the existing lump sum get discarded, or carried forward as a starting line item?** My recommendation: seed one line item in the "Other community support" cause (reusing the exact label `/members/impact` already uses for null-cause rows — see Gap 1) pre-filled with the old lump-sum amount, rather than silently deleting a number the treasurer already entered. The reverse (breakdown → lump-sum) needs the same care: collapsing N line items back into one lump sum either sums them (data-preserving, my recommendation) or discards them — must be an explicit, stated choice, not an inferred one.
- Failure: either direction against a locked budget → same 409 as Flow 1.

**Flow 4 — Remove a cause line item:**
Entry: an existing cause line item → Step: treasurer removes it, mirroring the **exact precedent v1.39.0 just shipped** for category-level lines — an explicit "Remove" control, `ConfirmDialog`-gated when the amount is non-zero, no dialog when it's already blank/$0 (`budget-editor.tsx` L158-189, 225-272, per the approve/lock work-log's Phase 4/5 notes) → Outcome: line item removed, category total recomputes. If it was the last line item, the category needs an explicit "no target set" state — it must **not** silently revert to lump-sum mode with a stale/empty amount.
- Failure: locked budget → 409, identical microcopy to Flow 1.

**Flow 5 — Seed cause line items from historical data (extends guided budgeting):**
Entry: the existing guided-budget-setup seed flow, entity + target FY selected → Step: system proposes, per category, cause-grouped historical actuals from "the past ~2 FYs" as candidate line items → Step: treasurer reviews, accepts, adjusts, or discards each proposed line — same fill-empty/overwrite semantics `computeSeedFromPriorYear`/`decideSeedWriteAction` already established for category-level seeding → Outcome: line items created for the target FY.
- Failure/degenerate case (not addressed by the backlog): a category has **no** cause-tagged actuals in the lookback window (either genuinely new, or every transaction under it has a null/blank cause) → falls back to today's category-level lump-sum seed behavior, no crash, no confusing empty breakdown UI.
- **Real, concrete risk, not hypothetical:** per the user's own memory note, the Quicken historical import — the only source of the "past ~2 FYs of cause-tagged transactions" this seeding step needs — **has only been run against the local dev DB; production is still unseeded.** If B-17 ships before that import runs in production, every treasurer who tries the seed-by-cause flow in production sees an empty or near-empty proposal, which reads as "the feature is broken," not "there's no data yet." Flagging as a hard open question below, not assuming it'll be resolved by the time this ships.

**Flow 6 — Cause-level budget-vs-actual (explicitly OUT of this increment — see split):**
Comparing a cause line item's budgeted amount against actual spend in that cause requires `ledger_transactions.beneficiaryCause` (and `ledger_reimbursements.beneficiaryCause`) to be a structured, matchable value — today it's free text, grouped only by a case-insensitive/trim key at read time (`bucketGivingByCause`). This flow does not exist in Increment A. Naming it here so Phase 3 doesn't accidentally half-build it, and so the fund report page's cause-breakdown display in Increment A is explicit about showing **budget only**, not "budget vs. actual," for cause lines.

## Permissions

- **Add/edit/remove a cause line item, toggle breakdown mode:** existing `FEATURES.LEDGER_MANAGE` — identical gate to every other budget write today (`ledger.manage`, "Manage funds, budgets, entities, and opening balances"). No new key.
- **Seed cause line items from history:** existing `FEATURES.LEDGER_MANAGE`, same as the existing guided-budgeting seed action.
- **Approve/lock covering cause line items:** existing `FEATURES.LEDGER_APPROVE` — no new key. `assertBudgetUnlocked()` must gate whichever write path cause line items use, exactly as it already gates `upsertBudgetLine()` and `POST /categories`.
- **View cause breakdown (read-only, budget-only in this increment):** existing `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` — matches the fund report page's current gate.
- **Default roles:** unchanged — whoever already holds `LEDGER_MANAGE`/`LEDGER_APPROVE` (treasurer, admin, board member per `drizzle/migrations/0047_ledger_approve_permission.sql`).

## Gaps the Request Didn't Address — including B-17's own four named open questions

**1. Null-cause giving rows need an "Other community support" line item — live count not run.**
Per the backlog: flagged, not fabricated. Precedent already exists and should be reused verbatim: `bucketGivingByCause()` (`src/lib/ledger.ts` L459-480) already treats a null/blank `beneficiaryCause` as `causeKey: ''`, displayed as **"Other community support"** on `/members/impact` today. B-17's budget-side "Other community support" line item should use this exact label, not invent new copy. The count itself — how many posted giving-eligible expense rows have a null/blank `beneficiary_cause` — has not been queried against real data (staged, not run, per the backlog note; confirmed no query artifact exists anywhere in `scripts/` or `docs/`). **This needs to be run before Phase 2/3 sizing**, using the exact giving predicate `getPhilanthropy()` already codifies (`status='posted' AND transfer_group_id IS NULL AND flow='expense' AND fund.kind IN ('activity','charitable','scholarship') AND category.counts_as_giving IS NOT FALSE`), filtered to `beneficiary_cause IS NULL OR trim(beneficiary_cause)=''` — a read-only query, runnable via the Neon MCP `run_sql` tool against the local or (once seeded) production DB. Do not proceed to Phase 3 with a guessed number.

**2. Taxonomy warts — functional recommendation on each:**
- **"Disaster Relief" exists as both a cause and a category.** Confirmed by reading `mapFoundation()` (categoryName `"Disaster relief"`, charitable fund, for `Special Grant` rows) and `deriveCause()` (`CAUSE_DISASTER = "Disaster Relief"`, same rows, matched by check number). **Recommendation: this is not a conflict to resolve, it's the expected degenerate case of the two-level model** — a category that maps 1:1 to a single cause is fine; a treasurer picking the "Disaster Relief" cause under the "Disaster relief" category will see the two labels match, which is correct, not confusing, as long as the UI doesn't try to auto-hide or auto-collapse the cause picker when it string-matches the category name (don't special-case this — treat every category the same way).
- **"Fundraising event costs" is a cause value but isn't beneficiary giving.** Confirmed: `deriveCause()` emits this cause for `Rudolph Run Expenses`/`Pancake Breakfast Expenses`/`WinterFest`, which are fundraising overhead, not gifts to a cause. **Recommendation: exclude "Fundraising event costs" from the cause picker's dropdown for budget line items entirely.** It already sits outside `/members/impact`'s giving totals via `countsAsGiving=false` on its category (DECISION-030) — a treasurer who wants to budget fundraising costs should use a normal lump-sum category line, never a "cause." (Confirm the relevant categories are in fact `countsAsGiving=false` before Phase 3 — I read the taxonomy comment, not the live category rows, for this check.)
- **"Scholarships" — folds into Youth, or stays its own cause?** **Recommendation: folds into "Youth & Education."** `deriveCause()` already does exactly this today for every historical Charitable-fund scholarship category (`Scholarships`, `High School Scholarships`, `BMX Race Scholarships` → `CAUSE_YOUTH`). Introducing a separate "Scholarships" cause would fork the taxonomy from the one the entire historical import already used, undermining Q3's actuals-matching goal before that work even starts. Note this is orthogonal to the **Scholarship Fund** (`ledgerFunds.kind='scholarship'`, its own "Scholarship award" category, seeded in `0044_ledger_books.sql`) — that's a fund-level split for a different reason (Foundation program-fund accounting), and its category can still carry a "Youth & Education" cause line item like any other.
- **New wart found, not in the backlog:** the Quicken import's `eligibleForCause` gate is `flow==='expense' && fundKind in ('charitable','activity')` — it does **not** tag `scholarship`-fund transactions with a cause at all. If the Scholarship Fund has posted expense history, none of it has a `beneficiaryCause` today, so it falls into "Other community support" by the same null-handling as everything else — worth confirming with the user whether Scholarship Fund spend should be cause-tagged going forward (trivially "Youth & Education" every time, arguably not even worth a picker) or left alone.

**3. Actuals matching — real scope call, not a detail.**
`ledger_transactions.beneficiaryCause` is a plain `text` column (`schema.ts` L658) with **no enum, no FK, no CHECK constraint** — grouped only by a case-insensitive/trim key at query time. `ledger_reimbursements` carries the same free-text column (`ledger-queries.ts` L1663, L1716) — a **second** surface, not mentioned in the backlog's Q3 at all. Converting these to a structured, pickable value is not "add a dropdown" — it's: (a) defining the shared taxonomy as a real app-level const/type (today it lives only inside `scripts/import-quicken-ledger.ts`, a one-off import script, not importable by the running app), (b) a one-time backfill mapping every existing free-text value onto that taxonomy (case-insensitively, the way `bucketGivingByCause` already keys them) and flagging non-matches for treasurer review rather than silently dropping or miscategorizing them, and (c) reworking every existing entry point that writes `beneficiaryCause` today (at minimum the transaction form and the reimbursement form) from free text to a constrained picker. **This is a prerequisite sub-feature in its own right and does not belong in this increment** — see Recommended Split below.

**4. Schema shape — functional tradeoffs for tech-lead (not deciding the DDL myself):**
- **Child table (`ledger_budget_lines` under `ledger_budgets`/`ledgerCategories`):** naturally expresses "N cause lines per category," leaves `ledger_budgets` untouched for the lump-sum case (a category either has a direct lump-sum row or has child line items, not an ambiguous mix), and keeps "does this category have a breakdown" a simple existence check.
- **Nullable `cause` column on a revised `ledger_budgets` row:** would need the existing unique constraint (`fundId, fiscalYear, categoryId, flow`) widened to include `cause`, turns "the category's total" into a `SUM(...) GROUP BY` instead of a direct read, and — most importantly — lets the *same table* hold both "this is the category's one target" (cause null) and "this is one of several cause-scoped targets" (cause set) for the identical tuple, which is exactly the lump-sum/breakdown ambiguity Flow 3 above shows is already a real design question, not just a storage detail.
- Both shapes need the taxonomy promoted out of the import script into a real shared constant (functional requirement either way, per Gap 3).
- My functional lean is the child-table model, since it structurally prevents the lump-sum/breakdown state from being ambiguous — but this is tech-lead's call to make, framed here only in terms of what each shape does or doesn't let a treasurer do.

**5. Lock enforcement must cover the new write path — not automatic.**
`assertBudgetUnlocked()` is called today from inside `upsertBudgetLine()` and explicitly from `POST /categories` (per architect Ruling 2 in the approve/lock work-log: "every write path touching `ledger_budgets` or `ledger_categories`... must reject when locked, and the check must live in exactly one place"). Whatever new write path cause line items use — a new endpoint, or an extension funneled through `upsertBudgetLine` — **must** call `assertBudgetUnlocked()` before writing. This does not happen automatically just because it's "a budget thing"; it is the single most load-bearing invariant carried over from the immediately-prior increment and deserves explicit design attention, not an assumption that it's inherited for free.

**6. Empty state.** A brand-new install, or any category with zero cause line items and no lump sum, must render identically to today's "no target set yet" empty row — not a half-built breakdown UI with an empty add-line form permanently expanded. Not addressed by the backlog.

**7. Mobile (360px).** Cause line items add a third nested layer (category → line items → cause-picker + amount pairs) inside `BudgetEditor`, which is already a dense per-line table. This is the highest-risk UI surface in the feature for overflow/touch-target problems at 360px and isn't mentioned in the backlog. Flag for ux-developer to test explicitly, not just inherit the existing editor's mobile behavior.

**8. Seeding tie-break rule, unspecified.** "Pull the past ~2 FYs of cause-tagged transactions, group by (category, cause)" doesn't say how to reconcile a cause that appears in both years under the same category with different totals — sum both years? average? most recent year only? Not addressed; needs an explicit answer (see Open Questions) before Phase 3 can spec `computeSeedFromPriorYear`'s cause-aware sibling.

**9. Remove-line-item brand/UX consistency — should match the shipped precedent.** v1.39.0 shipped an explicit "Remove" control on category-level budget lines, `ConfirmDialog`-gated when the stored amount is non-zero, no dialog when already blank (`budget-editor.tsx` L158-272). Cause line items should follow this exact precedent, not reintroduce a silent blank-to-delete pattern for a newer, more granular row that's arguably *more* likely to represent real treasurer effort (multiple cause lines vs. one category amount). Flagging so Phase 3 copies the precedent deliberately rather than by accident.

## Recommended Split

The backlog's own Q3 already signals this is bigger than "add cause to the budget UI." Concretely:

- **Increment A — Cause-tagged budget line items (planning only).** Category → cause line items OR lump sum, both supported; controlled cause taxonomy (promoted to a shared const, reusing `deriveCause`'s 9 values minus "Fundraising event costs," plus "Other community support"); seeding from historical cause-tagged actuals (contingent on Gap 5's Flow 5 risk); full lock/approve integration. **This is what Phase 2 should review next.** Delivers real value on its own: a treasurer can plan next year's spend by cause even before actuals can be compared against it.
- **Increment B — Structured cause on transactions (separate backlog item).** Promote the taxonomy to an app-level shared type; add a constrained cause picker to the transaction and reimbursement entry forms (replacing today's free-text `beneficiaryCause` on both `ledgerTransactions` and `ledgerReimbursements`); one-time backfill/reconciliation of existing free-text values. Independently valuable — this also cleans up `/members/impact`'s cause data, which today is only as consistent as whatever a human typed. Should get its own Phase 1.
- **Increment C — Cause-level budget-vs-actual (depends on A and B).** Extends `getFundReport` (or a cause-scoped sibling) to compare Increment A's budget cause lines against Increment B's now-structured `beneficiaryCause` actuals. This is the piece that actually reaches B-17's stated motivation ("whether the budget can hit the `/members/impact` giving-by-cause grain") — it cannot be built correctly on top of free text, so it must wait for B.

Recommend logging B and C as their own `B-nn` backlog entries (cross-referencing this work-log) rather than treating them as later phases of this same pipeline run.

## Out of Scope (confirm with user)

- Cause-level budget-vs-actual comparison (Increment C above) — explicitly deferred pending Increment B.
- Structured/constrained cause on `ledger_transactions`/`ledger_reimbursements` (Increment B above) — explicitly deferred, logged as its own backlog item.
- Full category-management CRUD (edit/deactivate/reorder) — already deferred as B-16; unaffected by this feature.
- Automatic reconciliation of existing free-text `beneficiaryCause` values against the new controlled taxonomy — belongs to Increment B, not A.
- An "adjust for inflation" or percentage-scaling control on cause-line seeding — raw copy only, matching the precedent already set for category-level seeding in guided budgeting.

## Open Questions

1. **Confirm the split.** Does the user want Increment A (planning-only cause line items) to proceed to Phase 2 now, with B and C logged as separate backlog items — or is bundling B into this same pipeline run intentional despite the added scope?
2. **Null-cause count.** Please authorize running the read-only query (Gap 1) against the local (and, once seeded, production) DB before Phase 2, so the "Other community support" line item's real weight is known, not guessed.
3. **Production Quicken seed status.** Has (or will) the Quicken historical import be run against production before this ships? If not, is a sparse/empty seed-by-cause experience in production acceptable at launch, or is running that import a hard prerequisite?
4. **Lump-sum ⇄ breakdown toggle behavior (Flow 3).** When a category with an existing lump-sum amount is switched to breakdown mode, does the lump sum become a starting "Other community support" line item (my recommendation, preserves the dollar figure) or get discarded? And the reverse — does collapsing breakdown back to lump-sum sum the line items, or discard them?
5. **Taxonomy exclusions.** Confirm dropping "Fundraising event costs" from the cause picker (Gap 2) and folding "Scholarships" into "Youth & Education" (Gap 2) — both are my recommendations, not locked decisions.
6. **Scholarship Fund cause-tagging.** Should Scholarship Fund (`ledgerFunds.kind='scholarship'`) expense transactions get cause-tagged going forward (trivially "Youth & Education" every time), or is that fund exempted from cause tagging since the fund itself already implies the cause?
7. **Seeding tie-break rule (Gap 8).** When a cause under a category has different amounts across the two lookback FYs, does the seed propose the sum, the average, or the most recent year only?
8. **Duplicate-cause-per-category uniqueness.** Confirm a treasurer should never be able to create two line items with the same cause under the same category+FY+flow (my assumption throughout Flow 1) — if intentional duplicates are ever wanted (e.g., two different notes on the same cause), that changes the uniqueness model.

## Human Answers (Chris, 2026-07-27)

Resolutions to the Open Questions above; these are binding inputs for Phase 2/3.

1. **Split — CONFIRMED. Increment A only.** Proceed to Phase 2 with planning-only cause line items. B (structured cause on transactions) and C (cause budget-vs-actual) to be filed as new backlog items (`docs/backlog.md`). B/C do NOT run in this pipeline.
2. **Null-cause count — deferred, not a Phase 2 blocker.** Per memory (`project_ledger_quicken_seed.md`), the connected Neon DB is the user's *local dev* DB and production is unseeded, so a count there would not reflect prod reality. Logged as a ship-time analysis item, not run now.
3. **Production Quicken seed — ship-time dependency, not a Phase 2 blocker.** Flagged: if this ships before the Quicken import runs in prod, the seed-by-cause flow will present empty, not "no data yet." Carry into Phase 5/6 as a launch risk; the seeding UI must have a graceful empty state regardless.
4. **Lump-sum ⇄ breakdown — ANSWERED.** Switching a lump-sum category to breakdown mode **preserves the existing amount as one "Other community support" cause line item** (reuse the exact `/members/impact` `bucketGivingByCause` label — do NOT invent new copy). The reverse (collapsing breakdown → lump-sum) is a Phase 3 detail; default is to sum the line items into the single amount.
5. **Taxonomy — ANSWERED. Both accepted.** Drop "Fundraising event costs" from the budget cause picker (not beneficiary giving); fold "Scholarships" into "Youth & Education".
6. **Scholarship Fund cause-tagging — deferred to Increment B.** Out of scope for A; revisit when B promotes cause to a structured transaction field.
7. **Seeding tie-break — ANSWERED. Most-recent FY.** Consistent with the shipped guided-budgeting "seed from last year" pattern.
8. **Uniqueness — CONFIRMED.** One line item per (cause, category, FY, flow). Enforce with a DB unique constraint widening the existing `ledger_budgets_fund_year_cat_flow_key` to include cause (DDL shape is tech-lead's call).

---

# Phase 2 — Architectural Review (architect)

**Date:** 2026-07-27

## Files Read

- `src/lib/db/schema.ts` L538-836 (`ledgerFunds`, `ledgerCategories`, `ledgerTransactions.beneficiaryCause`, `ledgerBudgets` + its `ledger_budgets_fund_year_cat_flow_key` unique constraint, `ledgerBudgetApprovals`, `ledgerAcknowledgments` as the existing child-table-off-a-parent-transaction precedent)
- `src/lib/ledger.ts` full pass — confirmed **zero imports** (pure functions, no DB access, client- and server-importable); `bucketGivingByCause` (L459-505, "Other community support" label source), `validateBudgetLineInput`, `deriveSeedLinesForFund`, `decideSeedWriteAction`, `isBudgetLocked` (L1041-1293) — the established home for every shared cross-cutting Ledger pure helper
- `src/lib/ledger-queries.ts` L560-950 — `assertBudgetUnlocked` (L587-609, the single lock-check core), `upsertBudgetLine` (L695-780, the single write core PATCH/seed both funnel through, lock check called inside its transaction), `computeSeedFromPriorYear`/`getBudgetApproval`
- `scripts/import-quicken-ledger.ts` L213-330 — `deriveCause()`, the only place the 9-value cause taxonomy exists today, private to a one-off `tsx` script, not importable by the running app
- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` full pass — Server Component, direct query-function calls (no internal API round-trip, DECISION-044 convention), two-tier `LEDGER_MANAGE`/`LEDGER_APPROVE` gate
- `src/components/admin/ledger/budget-editor.tsx` L1-60 — confirmed `"use client"`, existing `ConfirmDialog` import for the shipped remove-line precedent (Gap 9)
- `src/lib/permissions.ts` L53-56, 121-124 — `FEATURES.LEDGER_VIEW/RECORD/MANAGE/APPROVE`, full catalog
- `docs/decisions.md` — confirmed DECISION-044 is the current highest number; DECISION-030 (`countsAsGiving`) confirmed as the precedent excluding fundraising-overhead categories from giving reporting

## Verdict

**Approved with suggestions.** Increment A's scope (planning-only cause line items, no actuals matching) is architecturally self-contained and fits entirely inside the existing Ledger module — no new top-level directory, no new dependency, no new permission key. Nothing loops back to Phase 1; the split confirmed by the user (A now, B/C as B-18/B-19) is the right shape. The two structural calls below are recorded as **DECISION-045**.

## Placement

- **Directory placement — no new modules.** Everything lives inside the existing Ledger structure:
  - Schema: new `ledgerBudgetLines` table added to `src/lib/db/schema.ts` immediately after `ledgerBudgets` (same file every other Ledger table lives in), plus a matching idempotent migration under `drizzle/migrations/`.
  - Taxonomy + validator: new exported const(s) in `src/lib/ledger.ts`, alongside `validateBudgetLineInput`/`isBudgetLocked` — see the load-bearing ruling below.
  - Write/read logic: new functions in `src/lib/ledger-queries.ts` alongside `upsertBudgetLine`/`assertBudgetUnlocked`/`computeSeedFromPriorYear` — no new query module.
  - Routes: extend the existing `src/app/api/admin/ledger/budgets/` tree (a cause-line write endpoint, and a cause-aware extension of `/budgets/seed`) — same `/api/admin/ledger/...` convention, each handler checks `auth()` + `hasFeature(FEATURES.LEDGER_MANAGE)` (or `LEDGER_APPROVE` where the existing lock endpoints do).
  - UI: extend `budget-editor.tsx` (breakdown toggle + cause line rows) and `guided-budget-setup.tsx` (cause-aware seed review); any new sub-component (e.g. a cause picker) lives in `src/components/admin/ledger/` alongside the existing compositions, built on the existing `ui/select` primitive.
- **Server vs client split — no new pattern.** `budgeting/page.tsx` stays a Server Component, fetching cause lines the same direct-query-call way it already fetches everything else (DECISION-044 convention — no new internal GET route). `BudgetEditor` and any new cause-line sub-component must carry `"use client"` — they need blur-to-save interactivity and local input state, exactly like today's editor. This is an extension of an existing client component's props/children, not a new client/server boundary decision.
- **Dependencies: none.** A cause dropdown is served by the existing shadcn/Radix `Select` primitive already in `src/components/ui/`. No date, uuid, or validation library is needed beyond what's already in `package.json`. Confirms Phase 1's "expected: none."

## The Load-Bearing Call — Taxonomy Home

**Ruling: `src/lib/ledger.ts`.** The controlled cause list is promoted out of `scripts/import-quicken-ledger.ts` (a one-off `tsx` script, not imported by the running app) into a new exported const in `ledger.ts` — the 8 causes that survive the confirmed taxonomy edit (drop `"Fundraising event costs"`; `"Scholarships"` was never its own const, it already folds into `CAUSE_YOUTH` in `deriveCause` today) plus the literal `"Other community support"`, **re-exported from the same const, not re-typed**, so the budget-side label is byte-identical to what `bucketGivingByCause()` already renders on `/members/impact` for null-cause rows. A sibling validator (mirroring `validateBudgetLineInput`'s shape) rejects off-taxonomy values server-side, satisfying Flow 1's stated requirement that a direct API call bypassing the dropdown gets a 400, not a silent insert.

Why `ledger.ts` and not `ledger-queries.ts`, a new `src/lib/ledger-taxonomy.ts`, or leaving it in the script: `ledger.ts` has **zero imports today** — it's pure functions only, no DB access — which is exactly the shape a value that must be importable from both a server-side validator *and* a client-side `<select>` component needs. It is also already the established home for every other shared, cross-cutting Ledger helper (`bucketGivingByCause`, `validateBudgetLineInput`, `isBudgetLocked`, `deriveSeedLinesForFund`) — a new file would fragment a pattern that doesn't need fragmenting for one const array and one validator function. `import-quicken-ledger.ts` keeps its own *matching rules* (the payee/memo/category → cause `if` chain), but in Phase 4 should import the *value* consts from `ledger.ts` instead of maintaining a second private copy — one taxonomy, not two kept in sync by convention.

This directly satisfies the reuse requirement for B-18 (structured cause on transactions/reimbursements): it imports this exact same const and validator when it promotes `beneficiaryCause` to a constrained field. No second re-home.

## Schema Shape — Recommendation

**`ledger_budget_lines` child table, FK'd to `ledger_budgets.id`** (cascade delete) — not a nullable `cause` column added to `ledger_budgets`. Recommended shape (tech-lead owns final DDL):

- `ledger_budgets` keeps its current meaning exactly as-is: the rolled-up total for a `(fundId, fiscalYear, categoryId, flow)` tuple. Every existing consumer (`getFundReport`, `budgetVariance`, guided-budgeting's `computeSeedFromPriorYear`) keeps reading it unmodified — this increment's blast radius stays contained to the new write path and new UI, not every existing report/variance/seed read path.
- `ledger_budget_lines` rows (`id`, `budgetId` FK → `ledger_budgets.id` cascade, `cause` text, `amountCents`, timestamps) hold the cause-level detail. Any write to a category's cause lines is **one transaction** that upserts/deletes the child rows *and* recomputes `ledger_budgets.annualAmountCents` as their sum — funneled through the existing `upsertBudgetLine()`/`assertBudgetUnlocked()` core (or a sibling function sharing its transaction and its single lock-check call site), not a second independent enforcement point.
- **"Breakdown mode" is not a separate boolean column.** It is simply "this `ledger_budgets` row has 1+ `ledger_budget_lines` children." This directly resolves Phase 1 Flow 3's ambiguity concern: a single row can never simultaneously mean "the one target" (lump sum) and "one of several targets" (breakdown) for the same tuple, because the two states are structurally different row shapes, not a flag on one ambiguous shape.
- **Gap 6 (Flow 4) resolution:** removing the last cause line item deletes the parent `ledger_budgets` row too — mirroring exactly how `upsertBudgetLine` already treats `annualAmountCents: null` as "delete the row" for lump sum today. "No target set" has exactly one representation in the data regardless of which mode emptied it into that state — no half-built breakdown UI with a stale/empty parent row.
- **Uniqueness:** `(budgetId, cause)` on the child table satisfies the confirmed "one line item per (cause, category, FY, flow)" requirement — `budgetId` already uniquely identifies that tuple via `ledger_budgets_fund_year_cat_flow_key`, so the child table doesn't need to duplicate `fundId`/`fiscalYear`/`categoryId`/`flow` columns.
- **`cause` stays free `text`, app-layer validated** against the `ledger.ts` taxonomy — no DB CHECK constraint or enum. This matches DECISION-041's established precedent for this codebase's other app-layer-enforced text fields (`ledger_transactions.status`, and `beneficiary_cause` itself) — keeps the taxonomy changeable without a schema migration.

Rejected alternative (nullable `cause` on `ledger_budgets`): would require widening the existing unique constraint to include `cause`, turn "the category's total" into a `SUM(...) GROUP BY` read instead of a direct column read for every existing consumer, and — the disqualifying reason — lets the identical `(fundId, fiscalYear, categoryId, flow)` tuple simultaneously hold both a lump-sum row (cause null) and breakdown rows (cause set), which is exactly the ambiguity Flow 3 already flagged as a real design risk, not a storage detail.

## Invariants Touched

- **Schema is the source of truth.** `ledgerBudgetLines` must be added to `src/lib/db/schema.ts` *first*, then a matching idempotent migration committed under `drizzle/migrations/` — standard order, no exception needed.
- **Migrations re-run on every deploy / must be idempotent.** The new table needs `CREATE TABLE IF NOT EXISTS`. Flagging explicitly for database-admin: Postgres has no `ADD CONSTRAINT IF NOT EXISTS` — the `(budgetId, cause)` unique constraint (and any FK) must use the guarded `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE ...) THEN ... END IF; END $$;` pattern this codebase already uses elsewhere in `drizzle/migrations/`, not a bare `ALTER TABLE ... ADD CONSTRAINT`.
- **Permissions are the only gate.** No new `FEATURES.*` key. Confirmed reuse, matching Phase 1 exactly: `LEDGER_MANAGE` for every cause-line write and the seed-accept action, `LEDGER_APPROVE` for lock/unlock (already covers cause lines transitively since lock is keyed on `(entityId, fiscalYear)`, not on individual rows), `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` for read. No environment-flag mechanism introduced or needed.
- **The `ledger_budget_approvals` lock — explicit interaction.** `assertBudgetUnlocked()` must be the single enforcement point for the new write path, exactly as the prior increment's architect Ruling 2 established ("every write path touching `ledger_budgets` or `ledger_categories`... must reject when locked, and the check must live in exactly one place"). Because this ruling's recommended schema shape has the cause-line write funnel through the same transaction that updates the parent `ledger_budgets` row, the cleanest implementation is extending `upsertBudgetLine()` itself (or a sibling that shares its transaction) rather than a parallel, second lock check on a standalone cause-line endpoint — a second call site is how this invariant quietly drifts.
- **No native browser dialogs.** Cause line removal must reuse `<ConfirmDialog>` exactly as v1.39.0's category-level "Remove" control did (`budget-editor.tsx` L158-272, Gap 9) — non-zero amount gated, blank/$0 ungated. Flagging as a MUST-carry-forward, not a new decision.
- **Brand consistency.** No new card/button patterns introduced by this increment's placement — the cause picker is a `Select` inside the existing `rounded-2xl` budget editor rows; no `rounded-xl`, no `lions-red`. Confirm at Phase 4/5, not a Phase 2 concern beyond noting there's nothing here that should deviate.

## Notes — Carried Forward for Phase 3

- **Ship-time risks are not Phase 2 blockers, but tech-lead should carry them into the design doc's Edge Cases:** the production Quicken-seed gap (Open Question 3) and the deferred null-cause count (Open Question 2) both affect how graceful the seed-from-history empty state needs to be — this is a UI/data requirement, not an architectural one, but it originates from a fact this review re-confirmed (no query artifact exists anywhere checking real null-cause volume).
- **Mobile risk (Gap 7)** — cause line items add a third nested layer inside an already-dense `BudgetEditor` table. Not an architectural concern, but tech-lead's component plan should explicitly account for it rather than silently inheriting the existing editor's mobile behavior.
- **Seeding tie-break (answered: most-recent FY)** — the cause-aware sibling to `deriveSeedLinesForFund`/`computeSeedFromPriorYear` should follow the exact same "prior FY is always `targetFiscalYear - 1`" convention already locked for category-level seeding; a two-FY lookback for tie-breaking is a data-query detail (which FY's rows win when both years have the same cause under the same category), not a change to the source-FY picker.
- **Scholarship Fund cause-tagging** — explicitly out of scope for Increment A (deferred to B-18) per the user's answer; nothing in this review's schema/taxonomy ruling blocks that later decision, since `ledger_budget_lines.cause` is validated against the same shared taxonomy regardless of which fund's category it sits under.

---

# Phase 3 — Technical Design (tech-lead)

**Date:** 2026-07-27

## Files Read

- `src/lib/db/schema.ts` L538-834 (`ledgerFunds`, `ledgerCategories.countsAsGiving`, `ledgerTransactions.beneficiaryCause`, `ledgerBudgets` + `ledger_budgets_fund_year_cat_flow_key`, `ledgerBudgetApprovals`)
- `src/lib/ledger.ts` L380-508 (`bucketGivingByCause`, the exact "Other community support" literal at L497), L1041-1298 (`computeBudgetBalanceStatus`, `deriveSeedLinesForFund`, `validateBudgetLineInput`, `decideSeedWriteAction`, `isBudgetLocked`)
- `src/lib/ledger-queries.ts` L93-108 (`FundReportCategoryLine`/`FundReport`), L384-560 (`getFundReport` — budgetMap/actualMap build, category eligibility), L571-802 (`assertBudgetUnlocked`, `getBudgetApproval`, `upsertBudgetLine`), L805-924 (`computeSeedFromPriorYear`)
- `src/app/api/admin/ledger/budgets/route.ts` (PATCH — shape validation delegates to `upsertBudgetLine`/`validateBudgetLineInput`)
- `src/app/api/admin/ledger/budgets/seed/route.ts` (POST — `computeSeedFromPriorYear` → `db.transaction` → `upsertBudgetLine` loop, `SeedLockedError` rollback pattern)
- `src/components/admin/ledger/budget-editor.tsx` (full — `commitValue`/`doRemove`/`ConfirmDialog` precedent for line removal, non-zero-amount gating)
- `src/components/admin/ledger/guided-budget-setup.tsx` (full — `FundSetupItem`/`ProposedLinesList`, per-fund seed review cards, live balance readout via `onInputChange`)
- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` and `src/app/(dashboard)/admin/ledger/[fundSlug]/report/page.tsx` (both `BudgetEditor` call sites — confirms two places need the breakdown UI, not one)
- `scripts/import-quicken-ledger.ts` L213-292 (`deriveCause()` — confirms the exact 8-cause taxonomy after dropping `CAUSE_FUNDRAISING`, and that `NO_CAUSE_CATEGORY_NAMES`/`countsAsGiving=false` categories never carry a cause today)
- `drizzle/migrations/0062_ledger_budget_approvals.sql` (idempotent-migration pattern to mirror: `CREATE TABLE IF NOT EXISTS` + guarded `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_constraint ...)` for the unique constraint + `CREATE INDEX IF NOT EXISTS`)
- `src/lib/permissions.ts` L53-56, 121-124 (`FEATURES.LEDGER_*` — confirms no gap)

## Summary

Increment A adds a per-category "cause breakdown" to Ledger budgeting: a treasurer can either keep a category as a single lump-sum dollar amount (today's behavior, untouched) or split it into N cause-tagged line items whose amounts sum to the category's total. This is planning-only — no actuals comparison, no changes to `ledger_transactions`/`ledger_reimbursements`. It reuses every write-path precedent the last two Ledger increments established: `assertBudgetUnlocked()` as the single lock gate, `LEDGER_MANAGE`/`LEDGER_APPROVE`/`LEDGER_VIEW` as the only permission surface, `ConfirmDialog` for destructive removal, and the existing `getFundReport`/`BudgetEditor`/guided-seed component tree extended rather than replaced. Per DECISION-045, cause detail lives in a new `ledger_budget_lines` child table FK'd to `ledger_budgets`, which keeps its existing meaning as the always-current rolled-up total — every write to a category's cause lines recomputes that total in the same transaction, so no existing report/variance/seed consumer needs to change.

## Permissions

No new `FEATURES` key (Phase 2 confirmed). Reused exactly as today:

| Action | Gate |
|---|---|
| Upsert/delete a cause line, collapse breakdown → lump sum, accept a cause-seed proposal | `FEATURES.LEDGER_MANAGE` |
| Approve/lock a fiscal year (covers cause lines transitively — lock is keyed on `(entityId, fiscalYear)`, not per-row) | `FEATURES.LEDGER_APPROVE` |
| View a category's cause breakdown (fund report, budgeting page) | `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` |

Default role bindings unchanged — no new migration needed for permissions.

## API Contract

All four routes live under the existing `/api/admin/ledger/budgets/` tree. Every write route: `auth()` → `hasFeature(LEDGER_MANAGE)` → shape validation → `assertBudgetUnlocked()` → write. None of these routes accept a `null`/delete-via-amount convention the way `PATCH /budgets` does — cause lines are deleted explicitly, never implied by a blank amount, because a blank amount mid-edit is a much more common, non-destructive state for a breakdown row than for a single lump-sum field.

**1. `PATCH /api/admin/ledger/budgets/cause-lines`** — upsert one cause line (also the entry point for adding a category's *first* cause line, i.e. "entering breakdown mode" — see Component Plan for why there is no separate "convert" endpoint).

```
Body: {
  fundId: string;
  fiscalYear: number;
  categoryId: string;
  flow: "income" | "expense";
  cause: string;          // must satisfy isValidBudgetCause() server-side
  amountCents: number;    // non-negative integer, required (no null/delete here)
}
Response 200: { action: "upserted", lineId: string, categoryTotalCents: number }
Errors: 400 (shape / off-taxonomy cause / bad amount), 404 (fund or category not found),
        409 (budget locked — "This budget is locked. Unlock it to make changes.")
```

Server behavior, inside one `db.transaction()`:
1. Fetch fund + category; run `validateBudgetLineInput({ fund, category, flow, fiscalYear, annualAmountCents: amountCents })` for the shared fund/category/flow/fiscalYear/amount-bounds checks (reused verbatim — no second copy of those bounds).
2. `isValidBudgetCause(cause)` → 400 if not one of the 8 causes or `OTHER_COMMUNITY_SUPPORT_CAUSE`.
3. `assertBudgetUnlocked(fund.entityId, fiscalYear, tx)`.
4. Upsert the parent `ledger_budgets` row for `(fundId, fiscalYear, categoryId, flow)` (`onConflictDoNothing` — its `annualAmountCents` is corrected in step 6 regardless of whether it pre-existed).
5. Upsert the child row on `(budgetId, cause)` (`onConflictDoUpdate` — editing an existing cause line and adding a new one are the same call).
6. Recompute `SUM(amountCents)` over all children for that `budgetId`; `UPDATE ledger_budgets SET annualAmountCents = <sum>` — this is the step that keeps the parent's rolled-up total always current, per DECISION-045. Return that sum as `categoryTotalCents`.

**2. `DELETE /api/admin/ledger/budgets/cause-lines`** — remove one cause line.

```
Body: { fundId: string; fiscalYear: number; categoryId: string; flow: "income" | "expense"; cause: string }
Response 200: { action: "line_deleted", categoryTotalCents: number }
          or: { action: "parent_deleted" }   // this was the last cause line
Errors: 404 (no budget row for that tuple, or no line for that cause), 409 (locked)
```

Look up the parent row → 404 if none. `assertBudgetUnlocked()`. Delete the child row matching `(budgetId, cause)` → 404 if nothing matched. Recompute the remaining sum: zero children left → delete the parent `ledger_budgets` row too (mirrors `upsertBudgetLine`'s existing `annualAmountCents: null` → delete-the-row behavior, so "no target set" has exactly one representation regardless of which mode emptied it); otherwise `UPDATE` the parent's total and return it.

**3. `POST /api/admin/ledger/budgets/cause-lines/collapse`** — breakdown → lump-sum (Human Answer 4: sums the line items).

```
Body: { fundId: string; fiscalYear: number; categoryId: string; flow: "income" | "expense" }
Response 200: { action: "collapsed", annualAmountCents: number }
Errors: 404 (no budget row), 409 (locked)
```

`assertBudgetUnlocked()`, then `DELETE FROM ledger_budget_lines WHERE budgetId = ...` (all children). The parent's `annualAmountCents` is **not recomputed here** — it already equals the sum of children going into this call (invariant maintained by every prior write), so deleting the children and leaving the parent's number untouched *is* "collapse by summing." Idempotent-safe if called on an already-lump-sum category (zero children deleted, current amount returned unchanged) — the UI should not offer this control in that state, but the server doesn't need to special-case it.

**4. `POST /api/admin/ledger/budgets/seed` (existing route, extended)** — adds optional cause-line seeding, backward-compatible.

```
Body (new field, optional, default false): { ...existing fields, seedCauseLines?: boolean }
Response (new field per fund/category line, only when seedCauseLines was true):
  lines[].causeLines?: Array<{
    cause: string;
    amountCents: number;
    sourceFiscalYear: number;      // which of the two lookback FYs this value came from
    action: "seeded" | "skipped_existing" | "overwritten";
  }>
```

When `seedCauseLines` is true, for every category where `flow === "expense" && fund.kind in ("activity","charitable") && category.countsAsGiving === true` (the cause-eligible set — see Component Plan), the same `db.transaction()` that seeds category-level lump sums also computes and writes cause lines via `computeCauseSeedForCategory()` → `deriveCauseSeedLines()` → `upsertBudgetCauseLine(..., tx)`, reusing `decideSeedWriteAction(mode, collision)` for the identical fill-empty/overwrite semantics already established. A category with zero cause-tagged actuals in the two-FY lookback window (Human Answer 3's ship-time risk — unseeded prod) simply gets `causeLines: []` for that category; the existing lump-sum seed line is unaffected. A lock rejection mid-loop throws `SeedLockedError` exactly as today, rolling back the whole request atomically — cause-line writes must reuse this same transaction, not a second one.

**No new GET route.** `budgeting/page.tsx` and `[fundSlug]/report/page.tsx` stay Server Components calling `getFundReport()` directly (DECISION-044 convention) — `getFundReport()` is extended to include cause-line data in its existing return shape (see Data Model).

## Data Model

**New table**, added to `src/lib/db/schema.ts` immediately after `ledgerBudgets`:

```ts
export const ledgerBudgetLines = pgTable(
  "ledger_budget_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => ledgerBudgets.id, { onDelete: "cascade" }),
    // App-layer valid values: the 8 BUDGET_CAUSES + OTHER_COMMUNITY_SUPPORT_CAUSE
    // (src/lib/ledger.ts). No DB CHECK/enum — DECISION-041 precedent.
    cause: text("cause").notNull(),
    amountCents: integer("amount_cents").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("ledger_budget_lines_budget_cause_key").on(t.budgetId, t.cause),
    index("ix_ledger_budget_lines_budget").on(t.budgetId),
  ],
);
export type LedgerBudgetLine = typeof ledgerBudgetLines.$inferSelect;
export type NewLedgerBudgetLine = typeof ledgerBudgetLines.$inferInsert;
```

**Migration** `drizzle/migrations/0063_ledger_budget_lines.sql` — mirrors `0062_ledger_budget_approvals.sql` exactly: `CREATE TABLE IF NOT EXISTS`, a guarded `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_budget_lines_budget_cause_key') THEN ALTER TABLE ... ADD CONSTRAINT ... END IF; END $$;` for the unique constraint, `CREATE INDEX IF NOT EXISTS`. Schema update lands first, migration second, per the standard order.

**Keeping `ledger_budgets.annualAmountCents` in sync:** every write in the API contract above (upsert, delete, collapse) recomputes and persists the parent's total as part of the same `db.transaction()` as the child-row write — never a separate follow-up call. This is the single invariant the whole design depends on ("`ledger_budgets.annualAmountCents` always equals the sum of its `ledger_budget_lines` when any exist") — see Edge Cases.

**Read side** — extend `FundReportCategoryLine` (`ledger-queries.ts` L93-99) and `getFundReport()`:

```ts
export type FundReportCategoryLine = {
  categoryId: string;
  categoryName: string;
  actualCents: number;
  budgetCents: number | null;
  variance: BudgetVarianceResult;
  countsAsGiving: boolean;   // new — sourced from ledgerCategories.countsAsGiving, drives cause-breakdown eligibility client-side
  causeLines: { cause: string; amountCents: number }[] | null;  // new — null = lump-sum/no breakdown; never [] (empty breakdown deletes the parent row)
};
```

`getFundReport()` already fetches `budgetRows` (`ledgerBudgets` for the fund+FY) — add one batched query for `ledger_budget_lines WHERE budgetId IN (...)` keyed off those same `budgetRows` IDs (no N+1), fold into a `Map<budgetId, {cause, amountCents}[]>`, and attach to each `FundReportCategoryLine` by its budget row's ID when building `income`/`expense` in `buildLines()`.

## Component / Page Plan

**Files to modify:**
- `src/lib/ledger.ts` — add `BUDGET_CAUSES` (the 8-value const array), `OTHER_COMMUNITY_SUPPORT_CAUSE` (the literal, currently inlined at L497 inside `bucketGivingByCause`), `isValidBudgetCause()`, `deriveCauseSeedLines()` (pure — tie-break logic), `sumBudgetCauseLines()` (pure — trivial but extracted so the rollup math is unit-testable without a DB). Refactor `bucketGivingByCause` L497 to reference `OTHER_COMMUNITY_SUPPORT_CAUSE` instead of the inline string literal, so the two are provably byte-identical, not just visually identical.
- `src/lib/ledger-queries.ts` — add `upsertBudgetCauseLine()`, `deleteBudgetCauseLine()`, `collapseBudgetCauseLines()`, `computeCauseSeedForCategory()`; extend `FundReportCategoryLine`/`getFundReport()` per Data Model.
- `src/app/api/admin/ledger/budgets/route.ts` — unchanged.
- `src/app/api/admin/ledger/budgets/seed/route.ts` — extend body/response per API Contract #4.
- `src/components/admin/ledger/budget-editor.tsx` — per-line, when a category is cause-eligible (`flow === "expense" && countsAsGiving === true` — fund-kind eligibility is already implicit since `BudgetEditor` only ever renders categories belonging to one fund) and currently lump-sum (`causeLines === null`), render a small "Break down by cause" text-button next to the dollar input. Clicking it flips *local* component state only (no network call) to show one pre-filled cause row instead of the dollar input: `cause: OTHER_COMMUNITY_SUPPORT_CAUSE`, `amountCents` = the category's current lump-sum value (or 0 if none). Nothing is persisted until that row is committed via the normal blur/Enter pattern (which calls the new `PATCH .../cause-lines` route) — so navigating away before committing leaves the original lump-sum row untouched. Categories already in breakdown mode (`causeLines !== null`) render via the new `BudgetCauseEditor` instead of the dollar input.
- `src/components/admin/ledger/guided-budget-setup.tsx` / `ProposedLinesList` — extend the seed-preview list to show proposed cause lines nested under their category (when `seedCauseLines` was requested), and add a checkbox/toggle to opt into `seedCauseLines: true` on both the entity-wide and per-fund seed actions.
- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` and `.../[fundSlug]/report/page.tsx` — pass the extended `causeLines`/`countsAsGiving` fields through to `BudgetEditor`/`GuidedBudgetSetup` unchanged in shape otherwise (both already map `report.income`/`report.expense` into `budgetEditorLines` — just include the two new fields in that mapping).
- `scripts/import-quicken-ledger.ts` — lowest-priority item, does not block shipping: replace the private `CAUSE_VISION`/`CAUSE_YOUTH`/etc. string literals with imports from `src/lib/ledger.ts`'s `BUDGET_CAUSES` (keep `CAUSE_FUNDRAISING` private to the script — it stays a valid transaction-tagging value for historical import purposes even though it's excluded from the budget-side taxonomy).

**New component:** `src/components/admin/ledger/budget-cause-editor.tsx` — client component, one instance per category currently in breakdown mode. Renders:
- One row per existing cause line: a `Select` (shadcn primitive, options = `BUDGET_CAUSES` + `OTHER_COMMUNITY_SUPPORT_CAUSE` minus causes already used by *other* lines in this category) + a dollar input, styled to match `BudgetEditor`'s existing row (`rounded` input, `tabular-nums`, same focus ring). Blur/Enter commits via `PATCH .../cause-lines`.
- An explicit "Remove" icon-button per row, `ConfirmDialog`-gated when the line's amount is non-zero, immediate (no dialog) when already $0 — exact precedent from `budget-editor.tsx` L158-189. Removing the last line calls `DELETE .../cause-lines`; the component then reports back to its parent (`onCollapsedToEmpty` or a `router.refresh()`, matching `BudgetEditor`'s existing refresh-on-write pattern) so the row re-renders as an ordinary empty lump-sum row.
- A read-only "Category total: $X" line (client-computed sum of the visible rows — same live-update pattern `GuidedBudgetSetup`'s `fundSums`/`onInputChange` already uses, not a server round-trip per keystroke).
- An "+ Add cause" row, disabled once all 8+1 causes are already used for this category.
- A "Collapse to lump sum" link, `ConfirmDialog`-gated (`destructive`), copy explicit that individual cause records are deleted even though the dollar total survives as one amount — calls `POST .../cause-lines/collapse`.
- Mobile (360px): rows stack (cause `Select` full-width above the dollar input + remove button, not inline) below a breakpoint — flagged from Phase 1 Gap 7/Phase 2 as the highest overflow risk in this feature; must not silently inherit `BudgetEditor`'s current single-row flex layout unchanged.

No new pages.

## Implementation Order

1. **Schema** — `ledgerBudgetLines` in `src/lib/db/schema.ts`, then `drizzle/migrations/0063_ledger_budget_lines.sql` (idempotent, mirrors `0062`).
2. **Taxonomy + pure helpers** — `BUDGET_CAUSES`, `OTHER_COMMUNITY_SUPPORT_CAUSE`, `isValidBudgetCause()`, `deriveCauseSeedLines()`, `sumBudgetCauseLines()` in `src/lib/ledger.ts`; refactor `bucketGivingByCause`'s literal to reference the const.
3. **Query functions** — `upsertBudgetCauseLine()`, `deleteBudgetCauseLine()`, `collapseBudgetCauseLines()`, `computeCauseSeedForCategory()` in `src/lib/ledger-queries.ts`; extend `FundReportCategoryLine`/`getFundReport()`.
4. **Routes** — `PATCH`/`DELETE /api/admin/ledger/budgets/cause-lines`, `POST /api/admin/ledger/budgets/cause-lines/collapse`, extend `POST /api/admin/ledger/budgets/seed`.
5. **UI** — `BudgetCauseEditor`; modify `budget-editor.tsx`, `guided-budget-setup.tsx`, both page files.
6. **`scripts/import-quicken-ledger.ts` refactor** — import shared taxonomy consts (non-blocking cleanup, do last if time allows).
7. **Unit tests** — every test named below, written by the implementer(s), not qa.
8. **Release notes entry** — tech-lead, at Phase 6 SHIP IT.

No email notifications apply to this feature (planning-only, no approval-trigger email precedent exists for budget line edits today).

## Edge Cases & Risks

- **Locked-budget writes** on all three new write paths (upsert, delete, collapse) must 409 with the exact existing microcopy ("This budget is locked. Unlock it to make changes.") — `assertBudgetUnlocked()` is the single enforcement point; a second, parallel lock check anywhere is how this invariant drifts (explicitly called out by Phase 2).
- **Off-taxonomy cause submitted directly to the API**, bypassing the dropdown → 400, not a silent insert.
- **Duplicate cause under the same category+FY+flow** — the `(budgetId, cause)` unique constraint plus `onConflictDoUpdate` means a second write to the same cause is always an edit, never a second row; no error surfaced, which is correct (the UI's `Select` already prevents choosing an in-use cause, so a collision here only happens via direct API use, and updating is the safe behavior).
- **Emptying the last cause line** deletes the parent `ledger_budgets` row — the category must render identically to today's "no target set" empty state afterward, not a dangling empty breakdown form.
- **Lump→breakdown is a client-side pre-fill, not a server-enforced transition** — if a treasurer clicks "Break down by cause" and navigates away before committing the first row, nothing is written; the original lump sum survives untouched. This is intentional (matches `BudgetEditor`'s existing "nothing saves until blur/Enter" pattern) but must be communicated clearly in the UI so it doesn't read as data loss.
- **Breakdown→lump collapse is irreversible for per-cause detail** even though the total dollar figure survives — `ConfirmDialog` copy must say this explicitly.
- **Unseeded production Quicken import** (Human Answer 3) — `computeCauseSeedForCategory()` must return `[]`, not throw, when a category has zero cause-tagged actuals in the two-FY lookback window; the seed-review UI must render a "no cause history yet — add lines manually below" message, not a blank/confusing panel.
- **Transactional integrity is the highest-risk implementation detail.** Every write that touches both a child row and the parent's rolled-up total (upsert, delete, collapse, and the seed loop's cause-line writes) must happen inside exactly one `db.transaction()` — a partial write (child upserted, parent total stale) silently breaks the "parent = sum of children" invariant every read path depends on. The seed route's cause-line writes must reuse the *same* transaction as its existing category-level seed loop, not a second one — a lock rejection mid-seed must roll back everything atomically, exactly like today's `SeedLockedError` pattern.
- **Category eligibility for breakdown mode** is scoped to `flow === "expense" && countsAsGiving === true` (fund-kind eligibility — activity/charitable, not administrative/scholarship — is implicit per-fund). This extends Phase 1 Gap 2's picker-level exclusion of "Fundraising event costs" to the category level too: a non-giving category (ops, insurance, fundraising overhead) shouldn't offer a cause picker at all, since cause-tagging only makes sense for giving-eligible spend. **CONFIRMED by Chris 2026-07-27** — "Giving expense categories only." Not looser (all-expense or every-category were offered and declined). This predicate is locked for Increment A.
- **Mobile (360px)** — `BudgetCauseEditor` adds a third nested layer inside an already-dense editor; must stack, not overflow or force horizontal scroll on the row itself (the *table* it sits in already handles overflow via `overflow-x-auto` on the fund report page, but the cause-line rows themselves need their own stacking behavior at that width).

## Unit Tests to Write in Phase 4

1. **`isValidBudgetCause`** — accepts each of the 8 `BUDGET_CAUSES` values and `OTHER_COMMUNITY_SUPPORT_CAUSE`; rejects an arbitrary string; rejects `"Fundraising event costs"` specifically (regression-guards the dropped taxonomy value); rejects `""`.
2. **`OTHER_COMMUNITY_SUPPORT_CAUSE` byte-identity** — asserts the const equals the literal `"Other community support"` and that `bucketGivingByCause()`'s null-cause `causeLabel` output is `=== OTHER_COMMUNITY_SUPPORT_CAUSE` (guards the "re-exported, not re-typed" requirement from DECISION-045 against silent drift).
3. **`deriveCauseSeedLines` — most-recent-FY tie-break** — a cause present in both lookback years with *different* amounts proposes the more-recent year's amount, not a sum or average.
4. **`deriveCauseSeedLines` — union across years** — a cause present only in the older lookback year is still proposed; a cause present only in the newer year is still proposed.
5. **`deriveCauseSeedLines` — collision flagging** — a proposed cause matching an entry in `existingCauseAmountMap` is flagged `collision: true` with the correct `existingAmountCents`; a cause with no existing entry is `collision: false`.
6. **`deriveCauseSeedLines` — empty input** — zero rows in both lookback years returns `[]`, not a throw (Human Answer 3's graceful-empty-state requirement, at the pure-function level).
7. **`sumBudgetCauseLines`** — sums a list of `{amountCents}` correctly; empty list returns `0`.
8. **Uniqueness** — two `upsertBudgetCauseLine()` calls with the same `(fundId, fiscalYear, categoryId, flow, cause)` result in one row (update, not a duplicate), and the second call's amount wins.
9. **Lock guard** — `upsertBudgetCauseLine()`, `deleteBudgetCauseLine()`, and `collapseBudgetCauseLines()` each return `{ ok: false, status: 409 }` against a locked `(entityId, fiscalYear)` fixture, without writing any row.
10. **Parent-total rollup** — after `upsertBudgetCauseLine()` adds a second cause line to a category, the parent `ledger_budgets.annualAmountCents` equals the sum of both children, not just the newest write.
11. **Parent-delete-on-empty** — `deleteBudgetCauseLine()` on a category's last remaining cause line returns `action: "parent_deleted"`, and the parent `ledger_budgets` row no longer exists afterward.
12. **Category eligibility** — a helper predicate (extracted alongside the UI logic, e.g. `isCauseEligibleCategory({ flow, countsAsGiving })`) returns `false` for income-flow and `countsAsGiving === false` categories, `true` for expense + `countsAsGiving === true`.

## Implementer

**Specialist split** — database-admin → api-developer → ux-developer, sequentially. This is schema + API + UI at a size (new table, four routes/route-extensions, a new client component, two modified pages) consistent with every prior Ledger increment that ran the split cleanly (guided budgeting, budget approve/lock) rather than full-stack-developer, which CLAUDE.md reserves for work small enough (~< 150 lines across API + UI) that a handoff adds more overhead than it removes — this increment is well past that threshold.

1. **database-admin** — `ledgerBudgetLines` in `schema.ts` + `drizzle/migrations/0063_ledger_budget_lines.sql`.
2. **api-developer** — taxonomy/validator/pure helpers in `ledger.ts`; new query functions + `getFundReport` extension in `ledger-queries.ts`; the three new/extended routes; unit tests 1-12 above (all are pure-function or query-level tests, squarely api-developer's existing pattern for this module).
3. **ux-developer** — `BudgetCauseEditor`; `budget-editor.tsx` breakdown-entry affordance; `guided-budget-setup.tsx` seed-review extension; both page files' data-plumbing; mobile pass at 360px.

---

# Phase 4 — Implementation

**Status:** Complete (all three specialist steps finished — schema/database-admin, API/api-developer, UI/ux-developer. Next: qa for Phase 5.)

## Phase 4a — Schema (database-admin) — 2026-07-27

### Files Created

- `drizzle/migrations/0063_ledger_budget_lines.sql` — idempotent migration: `CREATE TABLE IF NOT EXISTS ledger_budget_lines`, guarded `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_constraint ...) THEN ALTER TABLE ... ADD CONSTRAINT ... END IF; END $$;` for the `(budget_id, cause)` unique constraint, `CREATE INDEX IF NOT EXISTS`. Mirrors `0062_ledger_budget_approvals.sql` exactly.

### Files Modified

- `src/lib/db/schema.ts` — added `ledgerBudgetLines` table (+ `LedgerBudgetLine`/`NewLedgerBudgetLine` inferred types), placed immediately after `ledgerBudgets` and before `ledgerBudgetApprovals`, per Phase 3 placement instruction.

### Schema Changes

- **New table:** `ledger_budget_lines` — `id` (uuid pk), `budget_id` (uuid, FK → `ledger_budgets.id`, `ON DELETE CASCADE`, not null), `cause` (text, not null, app-validated only — no DB enum/CHECK, DECISION-041 precedent), `amount_cents` (integer, not null), `created_at`/`updated_at` (timestamp, not null, default now()).
  - Unique constraint `ledger_budget_lines_budget_cause_key` on `(budget_id, cause)` — enforces "one line item per cause per budget row" (Human Answer 8).
  - Index `ix_ledger_budget_lines_budget` on `budget_id`.
- Migration file: `drizzle/migrations/0063_ledger_budget_lines.sql` (idempotent — every statement uses `IF NOT EXISTS` or a guarded `DO $$ ... END $$` block; safe to replay on every deploy).
- Exported symbol for api-developer to import: `ledgerBudgetLines` (table), `LedgerBudgetLine` / `NewLedgerBudgetLine` (inferred types) — all from `@/lib/db/schema`.

### Implementer Notes

- **Timestamp convention reconciled against the Phase 3 snippet's literal text vs. the actual sibling tables.** Neither `ledgerBudgets` nor `ledgerBudgetApprovals` (the two tables this design explicitly says to mirror) use `withTimezone: true` — both declare plain `timestamp("created_at").notNull().defaultNow()`. A repo-wide grep confirms no `ledger_*` table in `schema.ts` uses `withTimezone`; it's used only on a minority (15/102) of timestamp columns elsewhere in the file, on unrelated tables. Per this task's explicit instruction ("If the surrounding tables differ from the snippet above in any convention, follow the surrounding code, not the snippet"), I omitted `withTimezone: true` to match `ledgerBudgets`/`ledgerBudgetApprovals` exactly, even though it's also absent from the Phase 3 doc's own DDL sketch (both agree, so no actual conflict — just flagging that this diverges from the general database-admin agent default of always using `withTimezone: true` on new tables, and that divergence is intentional and matches this specific module's established convention).
- No other deviations from the Phase 3 DDL — column names, types, FK `onDelete: "cascade"`, unique constraint name, and index name are verbatim as specified in DECISION-045/046 and the Phase 3 Data Model section.
- Verified `pnpm exec tsc --noEmit` passes with the new table in place (clean run, no output/errors).
- Did **not** run the migration against any database (including the local dev DB) and did **not** run `pnpm db:push` — out of scope per this task's instructions; the build pipeline / next `pnpm db:migrate` invocation applies it.
- Local apply command (for whoever runs it next): `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate` (then `pnpm db:push` since `schema.ts` also changed).

### Handoff to api-developer

- Table/types ready to import: `ledgerBudgetLines`, `LedgerBudgetLine`, `NewLedgerBudgetLine` from `@/lib/db/schema`.
- Per Phase 3 Implementation Order steps 2-4: next up is (2) taxonomy + pure helpers in `src/lib/ledger.ts` (`BUDGET_CAUSES`, `OTHER_COMMUNITY_SUPPORT_CAUSE`, `isValidBudgetCause()`, `deriveCauseSeedLines()`, `sumBudgetCauseLines()`, plus the `bucketGivingByCause` literal refactor), then (3) query functions in `src/lib/ledger-queries.ts` (`upsertBudgetCauseLine()`, `deleteBudgetCauseLine()`, `collapseBudgetCauseLines()`, `computeCauseSeedForCategory()`, plus extending `FundReportCategoryLine`/`getFundReport()`), then (4) the new routes under `/api/admin/ledger/budgets/cause-lines` (PATCH + DELETE) and `/cause-lines/collapse` (POST), plus extending `POST /budgets/seed`.
- Every write path must call `assertBudgetUnlocked()` inside the same `db.transaction()` that touches `ledger_budget_lines` and recomputes the parent `ledger_budgets.annualAmountCents` — this is the standing invariant the whole design depends on (Phase 3 Data Model, DECISION-045/046 item 2).
- `cause` has no DB-level constraint — the 400-on-off-taxonomy-value requirement is entirely api-developer's responsibility via `isValidBudgetCause()`.

---

## Phase 4b — Implementation (API) — 2026-07-27

**Owner:** api-developer
**Status:** complete

### Summary

Implemented Phase 3's Implementation Order steps 2-4: the taxonomy + pure helpers in `src/lib/ledger.ts`, the transactional write/read query functions in `src/lib/ledger-queries.ts`, the three new/extended routes under `/api/admin/ledger/budgets/`, and all 12 unit tests named in the Phase 3 design doc. Also completed step 6 (`scripts/import-quicken-ledger.ts` now imports the shared `BUDGET_CAUSES` consts instead of maintaining a private copy). `pnpm exec tsc --noEmit` and `pnpm test` both pass clean (558 tests, 8 new query-level tests + 18 new pure-helper tests added on top of the prior 532).

### What I did

- Added `BUDGET_CAUSES`, `OTHER_COMMUNITY_SUPPORT_CAUSE`, `isValidBudgetCause()`, `isCauseEligibleCategory()`, `sumBudgetCauseLines()`, `deriveCauseSeedLines()` to `src/lib/ledger.ts`, placed directly after `bucketGivingByCause()`. Refactored `bucketGivingByCause()`'s inline `"Other community support"` literal (L497) to reference `OTHER_COMMUNITY_SUPPORT_CAUSE` instead, byte-identity-guarded by a unit test.
- Updated `scripts/import-quicken-ledger.ts`: `CAUSE_VISION`...`CAUSE_RECYCLING` are now destructured from the imported `BUDGET_CAUSES` array (positional, order-matched, commented) instead of being private literals; `CAUSE_FUNDRAISING` stays a private literal (deliberately excluded from the budget taxonomy but still valid for historical transaction tagging). No change to `deriveCause()`'s matching rules.
- Added `upsertBudgetCauseLine()`, `deleteBudgetCauseLine()`, `collapseBudgetCauseLines()`, `computeCauseSeedForCategory()` to `src/lib/ledger-queries.ts`, placed after `upsertBudgetLine()` and before `computeSeedFromPriorYear()`. Extended `FundReportCategoryLine` (`countsAsGiving`, `causeLines`) and `getFundReport()` (one batched `ledger_budget_lines` query keyed off `budgetRows`' own IDs — no N+1) and the second `FundReportCategoryLine`-building site in `getEntityReport()` (which never surfaces budgets, so `causeLines: null` unconditionally there).
- Created `src/app/api/admin/ledger/budgets/cause-lines/route.ts` (PATCH + DELETE) and `src/app/api/admin/ledger/budgets/cause-lines/collapse/route.ts` (POST), matching the existing `budgets/route.ts` / `budget-approvals/unlock/route.ts` auth/validation/error-shape conventions exactly.
- Extended `src/app/api/admin/ledger/budgets/seed/route.ts` additively: optional `seedCauseLines: boolean` body field (default false); when true, for each expense line in the existing per-fund seed loop whose category is cause-eligible (`countsAsGiving === true`, fetched via `tx` inside the same transaction), calls `computeCauseSeedForCategory()` → `decideSeedWriteAction()` (same `mode` param, reused verbatim) → `upsertBudgetCauseLine()`, appending `causeLines` to that line's response entry.
- Wrote all 12 named unit tests: 8 pure-helper tests (1-7, 12) appended to `src/lib/ledger.test.ts`; 4 DB-level tests (8-11) in a new `src/lib/ledger-queries.test.ts`, using the same mock-`tx`/call-order-canned-response pattern already established in `dues-ledger-sync.test.ts` (no real DB, no new test infra). Added 2 small supporting tests beyond the named 12 (a `line_deleted`-not-last-line case, a `collapse` happy path) for connective coverage.

### Outputs

**Exported taxonomy symbols** (`src/lib/ledger.ts`, pure, zero DB imports — client- and server-importable):
- `BUDGET_CAUSES: readonly [8 strings]` — `"Vision & Eye Care"`, `"Youth & Education"`, `"Hunger & Basic Needs"`, `"Health & Disability"`, `"Disaster Relief"`, `"Lions International Programs"`, `"Community & Civic"`, `"Bags to Benches (Recycling)"` — byte-identical to `deriveCause()`'s historical `CAUSE_*` consts, minus `"Fundraising event costs"`.
- `OTHER_COMMUNITY_SUPPORT_CAUSE = "Other community support"` — same const `bucketGivingByCause()` now references; the two can't drift.
- `type BudgetCause = (typeof BUDGET_CAUSES)[number]`
- `isValidBudgetCause(cause: string): boolean`
- `isCauseEligibleCategory(input: { flow: string; countsAsGiving: boolean | null | undefined }): boolean` — `flow === "expense" && countsAsGiving === true`. ux-developer needs this for the "Break down by cause" affordance gate (DECISION-046 item 4).
- `sumBudgetCauseLines(lines: { amountCents: number }[]): number`
- `deriveCauseSeedLines(rows: CauseSeedSourceRow[], existingCauseAmountMap: Map<string, number>): CauseSeedProposedLine[]` — pure, most-recent-FY tie-break, union across years, collision-flagged.

**Query functions** (`src/lib/ledger-queries.ts`, all require an enclosing `db.transaction()`'s `tx` — no default to module-level `db`, since every one is multi-statement and must be atomic):
- `upsertBudgetCauseLine(params: { fundId, fiscalYear, categoryId, flow, cause, amountCents }, tx) => { ok: true; action: "upserted"; lineId: string; categoryTotalCents: number } | { ok: false; error; status: 400|404|409 }`
- `deleteBudgetCauseLine(params: { fundId, fiscalYear, categoryId, flow, cause }, tx) => { ok: true; action: "line_deleted"; categoryTotalCents } | { ok: true; action: "parent_deleted" } | { ok: false; error; status: 404|409 }`
- `collapseBudgetCauseLines(params: { fundId, fiscalYear, categoryId, flow }, tx) => { ok: true; action: "collapsed"; annualAmountCents } | { ok: false; error; status: 404|409 }`
- `computeCauseSeedForCategory(fundId, categoryId, targetFiscalYear, tx?) => CauseSeedProposedLine[]` — read-only, defaults `tx` to module `db`, safe to call standalone.
- `FundReportCategoryLine` gained `countsAsGiving: boolean` and `causeLines: { cause: string; amountCents: number }[] | null` (never `[]`) — `getFundReport()`'s `income`/`expense` arrays now carry both fields on every line.

**Routes** (all gated `auth()` + `hasFeature(session.user.id, FEATURES.LEDGER_MANAGE)` via `@/lib/permissions-server`, matching this module's established pattern — not the client-safe `hasFeature(features, FEATURE)` from `@/lib/permissions`):
- `PATCH /api/admin/ledger/budgets/cause-lines` — body `{ fundId, fiscalYear, categoryId, flow, cause, amountCents }` → `200 { action: "upserted", lineId, categoryTotalCents }`. 400 (shape/off-taxonomy cause/bad amount), 404 (fund/category not found), 409 (locked, exact microcopy "This budget is locked. Unlock it to make changes.").
- `DELETE /api/admin/ledger/budgets/cause-lines` — body `{ fundId, fiscalYear, categoryId, flow, cause }` → `200 { action: "line_deleted", categoryTotalCents }` or `200 { action: "parent_deleted" }`. 404, 409 as above.
- `POST /api/admin/ledger/budgets/cause-lines/collapse` — body `{ fundId, fiscalYear, categoryId, flow }` → `200 { action: "collapsed", annualAmountCents }`. 404, 409.
- `POST /api/admin/ledger/budgets/seed` (extended) — new optional body field `seedCauseLines?: boolean` (default false); response's `funds[].lines[]` entries gain an optional `causeLines?: Array<{ cause, amountCents, sourceFiscalYear, action: "seeded"|"skipped_existing"|"overwritten" }>` when `seedCauseLines` was true AND that line is an eligible expense category. Fully backward-compatible — omitting the field reproduces today's exact response shape.

**Schema changes:** none in this phase — `ledgerBudgetLines` + migration `0063_ledger_budget_lines.sql` were database-admin's Phase 4a (already landed, see above).

### Implementer Notes

- **Transactional integrity (the highest-risk detail):** `upsertBudgetCauseLine`, `deleteBudgetCauseLine`, and `collapseBudgetCauseLines` all require an already-open `tx` parameter (no `= db` default, unlike `upsertBudgetLine`) — this is a deliberate API difference from the existing single-row `upsertBudgetLine()`, because these three are inherently multi-statement (child row write + parent-total recompute, or delete-then-recompute-or-delete-parent) and a `db`-default would silently make that non-atomic. Every route handler wraps its call in `db.transaction((tx) => ...)`. The seed route reuses the SAME `tx` its existing category-level loop already opened — cause-line writes are literally inside the same `for` loop body, same transaction, so a `SeedLockedError` thrown by a cause-line write rolls back everything (lump sums already seeded in this request included), reusing the exact `SeedLockedError`/catch pattern already in the file.
- **Parent-total sync mechanism:** every write recomputes the parent's `annualAmountCents` by re-reading ALL child rows for that `budgetId` (`sumBudgetCauseLines(childRows)`) and `UPDATE`-ing the parent inside the same transaction — never an incremental `+= amountCents` update. This is deliberately more conservative than incrementing: it can never drift even if a future write path adds/removes children through a different code path, at the cost of one extra `SELECT` per write (negligible — a category has at most 9 cause lines).
- **`bucketGivingByCause` refactor** was a single-line change (L497): `causeKey === "" ? "Other community support" : firstSeenOriginal` → `causeKey === "" ? OTHER_COMMUNITY_SUPPORT_CAUSE : firstSeenOriginal`. A new test (`OTHER_COMMUNITY_SUPPORT_CAUSE byte-identity`) asserts `bucketGivingByCause()`'s output is `===` the const, not just `.toBe()`-equal in value, so any future edit that reintroduces a second literal copy fails loudly.
- **Seed route's cause-line scoping is narrower than "every eligible category":** cause-line seeding only runs for categories that ALREADY have a top-level `lines[]` entry (i.e., had actuals or a prior budget in the immediate prior FY, per `deriveSeedLinesForFund`'s existing one-FY-lookback scoping) — even though `computeCauseSeedForCategory()` itself looks back two FYs. A category with cause-tagged history in the *older* lookback FY only, and nothing in FY-1, won't get a proposed breakdown from this seed pass (documented in the route's JSDoc). This is a deliberate, disclosed scope-tightening to match the Phase 3 API contract's literal wording ("per fund/category line" — i.e., augmenting existing lines, not inventing new ones), not a silently-dropped requirement. A treasurer can still add such cause lines manually via `PATCH /cause-lines`.
- **`fill-empty` mode interacts with cause-line seeding at cause granularity, not category granularity:** if a category already has a lump-sum amount set (so its top-level line write is `skip`ped under `fill-empty` mode, per existing behavior), cause-line seeding for that SAME category still runs independently — because cause-level collision is checked against `existingCauseAmountMap` (child rows), and a lump-sum-only category has zero children, so every proposed cause line reads as `collision: false` and gets seeded. Net effect: enabling `seedCauseLines: true` with `fill-empty` mode CAN convert an existing lump-sum category into a cause breakdown, even though the top-level lump sum itself was left untouched (skipped). This follows the Phase 3 spec's literal wording ("reuses `decideSeedWriteAction(mode, collision)` for the identical fill-empty/overwrite semantics already established" — at cause granularity) rather than inventing an extra category-level gate not specified there. Flagging for qa/ux-developer awareness — if real usage shows this surprises treasurers, it's a one-line fix (skip cause-line seeding entirely for a category whose top-level write was skipped).
- **Auth pattern confirmed against existing precedent, not CLAUDE.md's generic example:** this module uses `hasFeature(session.user.id, FEATURES.X)` (async, from `@/lib/permissions-server`, takes a user ID) on every existing Ledger route (`budgets/route.ts`, `budgets/seed/route.ts`, `budget-approvals/unlock/route.ts`) — not the client-safe `hasFeature(session.user.features, FEATURES.X)` sync helper from `@/lib/permissions` shown in CLAUDE.md's illustrative snippet. Followed the module's actual, consistent precedent.

### Test list (all passing)

Pure helpers (`src/lib/ledger.test.ts`, appended after `validateRequiredTrimmedText`):
1. `isValidBudgetCause` — accepts all 8 `BUDGET_CAUSES` + `OTHER_COMMUNITY_SUPPORT_CAUSE`; rejects an arbitrary string, `"Fundraising event costs"`, and `""`.
2. `OTHER_COMMUNITY_SUPPORT_CAUSE` byte-identity — equals the literal; `bucketGivingByCause()`'s null-cause `causeLabel` is `===` the const.
3-6. `deriveCauseSeedLines` — most-recent-FY tie-break; union across years; collision flagging (match + no-match); empty input returns `[]`.
7. `sumBudgetCauseLines` — sums correctly; empty list returns `0`.
12. `isCauseEligibleCategory` — true for expense+countsAsGiving true; false for income, countsAsGiving false, and countsAsGiving null.

Query-level (`src/lib/ledger-queries.test.ts`, new file):
8. `upsertBudgetCauseLine` uniqueness — two calls with the same tuple both target the same `budgetId` via `onConflictDoUpdate` (never `onConflictDoNothing` for the child row); the second call's `categoryTotalCents` reflects only the latest amount.
9. Lock guard — `upsertBudgetCauseLine`, `deleteBudgetCauseLine`, `collapseBudgetCauseLines` each return `{ ok: false, status: 409 }` against a locked fixture, with zero insert/update/delete calls.
10. Parent-total rollup — `upsertBudgetCauseLine` recomputes the parent's `annualAmountCents` as the sum of ALL children read back post-write, not just the newly-written line.
11. Parent-delete-on-empty — `deleteBudgetCauseLine` on the last remaining line returns `action: "parent_deleted"` and issues a `ledgerBudgets` delete, with zero update calls.

Verified: `pnpm exec tsc --noEmit` clean; `pnpm test` → **558 passed** (550 pre-existing + 8 new). Ran with `DATABASE_URL` exported from `.env.local` per CLAUDE.md — importing `ledger-queries.ts` transitively imports `@/lib/db`, which throws at import time if unset (matches existing `dues-ledger-sync.test.ts` behavior, not new). `pnpm lint` could not be run — pre-existing, unrelated environment issue (ESLint 9.39.2 / `minimatch` ESM interop failure in `node_modules`, reproduces on a clean `git stash` too); flagging for deployment-engineer's dependency review, not caused by this change.

### Open questions / handoff notes

**Next: ux-developer** (Phase 4, step 5 — `BudgetCauseEditor`, `budget-editor.tsx`, `guided-budget-setup.tsx`, both page files, mobile pass at 360px per Phase 3 Component Plan).

- Import `BUDGET_CAUSES`, `OTHER_COMMUNITY_SUPPORT_CAUSE`, `isValidBudgetCause`, `isCauseEligibleCategory` from `@/lib/ledger` for the cause `<Select>` options and the "Break down by cause" affordance gate — do not re-derive these client-side.
- `getFundReport()`'s `income`/`expense` lines now carry `countsAsGiving` and `causeLines` — thread both through `budgeting/page.tsx`'s and `[fundSlug]/report/page.tsx`'s existing `budgetEditorLines` mapping (currently `{categoryId, categoryName, flow, budgetCents}` — just add the two new fields, per Phase 3 Component Plan).
- Route contracts are exactly as specified in the Phase 3 API Contract section — no deviations. `PATCH`/`DELETE .../cause-lines`, `POST .../cause-lines/collapse`, and the extended `POST .../budgets/seed` (`seedCauseLines?: boolean`, response `lines[].causeLines?`).
- Known scoping note (see Implementer Notes above): the seed flow's cause-line proposals are scoped to categories that already have a top-level seed line (immediate-prior-FY actuals/budget), even though the cause lookback itself spans two FYs. If a treasurer expects a category with only older cause history to auto-propose, it won't — surface "add manually" as the fallback, not a bug.
- Also known: `seedCauseLines: true` + `mode: "fill-empty"` can convert an already-lump-summed category into a breakdown (cause-level collision only, not category-level) — worth a UI confirmation step before running seed-with-cause-lines against a fund that already has manually-entered lump sums, though not required to ship Increment A.
- `scripts/import-quicken-ledger.ts`'s Phase 3 Implementation Order step 6 (import shared taxonomy consts) is done — not blocking, no action needed from ux-developer.

---

## Phase 4c — Implementation (UI) — 2026-07-27

**Owner:** ux-developer
**Status:** complete

### Summary

Built the client-side half of B-17 Increment A on top of api-developer's Phase 4b contract: a new `BudgetCauseEditor` nested component for cause-level line items, the "Break down by cause" affordance in `BudgetEditor` (client-side pre-fill, no dedicated endpoint per DECISION-046), an optional `seedCauseLines` toggle in the guided-setup seed flow with a confirmation gate for the fill-empty/lump-sum-conversion edge case api-developer flagged, and both fund-report pages' data plumbing. `pnpm exec tsc --noEmit` is clean, `pnpm test` is unchanged at 558/558 passing (no new pure helpers were extracted on the UI side that warranted their own tests — the two `parseDollarsToCents` copies are 4-line presentational parsers, same class as `BudgetEditor`'s pre-existing inline parsing), and `pnpm build:only` succeeds.

### What I did

- Created `src/components/admin/ledger/budget-cause-editor.tsx` — the per-category cause-line editor: one row per cause (native `<select>` + dollar input), add/remove/edit, a live "Category total" readout, and a collapse-to-lump-sum control.
- Modified `src/components/admin/ledger/budget-editor.tsx` — added the `countsAsGiving`/`causeLines` fields to `BudgetLine`, a `breakdownOverride` local-state map, the "Break down by cause" text-button, and the `enterBreakdown`/`exitBreakdown` handlers that bridge BudgetCauseEditor's local pre-fill/collapse/empty flows back into the plain lump-sum row.
- Modified `src/components/admin/ledger/guided-budget-setup.tsx` — added a `seedCauseLines` checkbox to the entity-wide seed panel (shared by both entity-wide and per-fund seed actions), a confirmation gate for fill-empty + seedCauseLines (api-developer's flagged risk), an appended note on the existing Overwrite confirm dialog, and extended `SeedResponseFund`/added `SeedResponseLine`/`SeedResponseCauseLine` types plus a cause-line count summary appended to the post-seed toast.
- Modified `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` and `.../[fundSlug]/report/page.tsx` — threaded `countsAsGiving`/`causeLines` from `getFundReport()`'s `FundReportCategoryLine` through each page's existing `budgetEditorLines` mapping into `BudgetEditor`.

### Outputs

- `src/components/admin/ledger/budget-cause-editor.tsx` (new)
- `src/components/admin/ledger/budget-editor.tsx` (modified)
- `src/components/admin/ledger/guided-budget-setup.tsx` (modified)
- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` (modified — data plumbing only)
- `src/app/(dashboard)/admin/ledger/[fundSlug]/report/page.tsx` (modified — data plumbing only)

### Implementer Notes

**Lump → breakdown local-state pre-fill.** `BudgetEditor` keeps a `breakdownOverride: Record<string, boolean>` map keyed the same way as its existing `inputs` map (`${categoryId}_${flow}`). A line renders as breakdown when `breakdownOverride[key]` is `true`, as lump-sum when `false`, and otherwise defers to the server-sourced `line.causeLines !== null && length > 0`. Clicking "Break down by cause" sets the override to `true` and hands `BudgetCauseEditor` a single synthetic row — `{ cause: OTHER_COMMUNITY_SUPPORT_CAUSE, amountCents: <parsed from the current lump-sum input> }` — with `pending={true}`. Inside `BudgetCauseEditor`, a pending row's `committedCause` is `null`; unlike an already-saved row (which only re-PATCHes when actually edited, via a `dirtyRef` gate identical to `BudgetEditor`'s own), a pending row *always* attempts its first commit on blur/Enter regardless of the dirty flag — that blur/Enter *is* how the row gets created. If the treasurer never blurs/Enters that field (navigates to a different page, closes the tab), nothing is ever POSTed and the original lump sum is untouched, matching the Phase 3 edge-case requirement verbatim. Exiting breakdown mode (`onExitBreakdown`) is reason-coded (`"cancelled" | "collapsed" | "emptied"`) because the correct dollar value to restore into the reappearing lump-sum input differs: cancel/collapse restore the original `line.budgetCents` unchanged (the server total was never touched, or — for collapse — was already correct going in, per DECISION-046 item 2's "parent = sum of children" invariant); "emptied" (the last committed cause line removed one row at a time) blanks the input, since that path deletes the parent `ledger_budgets` row entirely. `dirtyRef` is cleared in all three cases so the reappearing lump-sum input doesn't fire a redundant PATCH on its next blur.

**Cause rename semantics (a deviation worth flagging).** Phase 3's Component Plan describes a `<Select>` on *every* row, including already-committed ones, implying the cause of a saved line can be changed in place. There is no dedicated rename endpoint (DECISION-046 explicitly scopes the API to upsert/delete/collapse only), so I implemented changing an already-committed row's cause as DELETE-old-cause then PATCH-new-cause-with-current-amount, sequentially. If the PATCH half fails after the DELETE succeeds, the line is transiently gone; I call `router.refresh()` in both the success and failure paths so the UI never keeps showing stale/wrong local state, and the toast error is explicit that the line may need to be re-verified. This is a real (if narrow) window where a network failure mid-rename could lose a cause line's data, which the "no dedicated endpoint" API design doesn't fully close — flagging for qa to exercise (throttle/offline mid-rename) and for the team to decide whether it's worth a dedicated rename endpoint if real usage shows it's a problem.

**Locked-state disabling.** `BudgetCauseEditor` takes the same `disabled` prop `BudgetEditor` already threads from its callers (`editorDisabled = locked || !canManage` in `guided-budget-setup.tsx`; always `false` on the fund-report page, which doesn't check lock state today — pre-existing, out of scope). When `disabled`, every select/input in `BudgetCauseEditor` is `disabled`, the remove button, "+ Add cause", and collapse/cancel controls are hidden entirely (not just disabled — mirrors `BudgetEditor`'s own `showRemoveControl && !disabled` pattern), and a footer note reads "This budget is locked for editing." The "Break down by cause" affordance itself is also hidden when `disabled` (it's a `LEDGER_MANAGE` action gated the same as every other write control in this editor). All of this is UI-only defense-in-depth exactly like the rest of the file — the real enforcement is `assertBudgetUnlocked()`'s 409, whose exact message ("This budget is locked. Unlock it to make changes.") is surfaced unchanged via the existing `catch` → `toast.error` pattern in every fetch call.

**360px mobile stacking.** Each cause-line row is `flex flex-col gap-2 sm:flex-row sm:items-center` — the cause `<select>` renders full-width on its own line, with the dollar input + remove button as a second full-width row beneath it, below the `sm` breakpoint; from `sm` up they sit inline (select flexes, amount input fixes to `w-28`). This is the same stacking technique used elsewhere in the admin surface for narrow-viewport form rows — no horizontal scroll is introduced on the row itself (the ambient `overflow-x-auto` on the report table's `<table>` is unrelated and untouched). Verified by reading the rendered class list at a 360px viewport width in the browser devtools responsive mode; did not add a Playwright viewport test for this (out of scope per the "not required to add unit tests for pure-presentational components" instruction) — flagging for qa to click through at 360px explicitly, per Phase 3's own risk flag.

**Seed flow UI scope decision.** Phase 3/api-developer's handoff asked for "no cause history yet — add lines manually below" empty-state messaging, but there is no pre-seed GET/preview of cause-line proposals (Phase 3: "No new GET route" — cause-line proposals only exist in the POST `/budgets/seed` response, after the write already happened). So I implemented this as *proactive* static help text under the `seedCauseLines` checkbox ("Categories with no cause history yet keep their lump-sum amount only — add cause lines manually below afterward") rather than a per-category post-seed panel, since there's no category-level preview data available before the click to react to. The post-seed toast does append a cause-line seeded/overwritten count when `seedCauseLines` was used, so the treasurer gets *some* per-run feedback, just not a category-by-category empty-state breakdown.

**Small duplication, not extracted.** `parseDollarsToCents()` (parses a dollar-string input to integer cents, clamping negatives/NaN to 0) is defined identically in both `budget-editor.tsx` and `budget-cause-editor.tsx` — 4 lines each, same class of pure parsing logic `BudgetEditor` already inlined before this change. Not extracted to a shared module; too small to warrant one, consistent with the "don't need to add unit tests for pure-presentational components" guidance, though it is presentational-adjacent, not purely presentational — flagged here rather than silently duplicated.

**Addendum (2026-07-27, same day) — surfaced the Phase 4b-fix's skipped-cause-breakdown count.** qa's Phase 5 run found that guided-seed overwrite mode was silently clobbering categories already broken down by cause; api-developer's Phase 4b-fix (see that section below) closed the data-integrity bug server-side and added `causeBreakdownSkippedCount` (per-fund) plus a `"skipped_cause_breakdown"` line action to the seed response, but flagged that the UI didn't yet render either — a treasurer running overwrite over a mix of lump-sum and cause-broken-down categories would see the broken-down ones correctly protected, but with no explanation of why they didn't change. Closed that gap in `guided-budget-setup.tsx` only: extended `SeedResponseLine`'s `action` union and `SeedResponseFund` with the new field, and folded a per-fund clause — `"N categor{y/ies} skipped — already broken down by cause"` — into the existing post-seed toast/summary line (not a new dialog), placed after "already set" so it doesn't get conflated with an ordinary fill-empty collision. The per-fund filter that decides whether a fund appears in the summary at all was extended to include `causeBreakdownSkippedCount > 0`, so a fund where *every* line was protected this way (nothing seeded/overwritten/skipped-existing) still shows up. A skip count of 0 renders nothing (existing `if (count > 0) parts.push(...)` pattern, unchanged). No API/query/guard logic touched. `pnpm exec tsc --noEmit` clean; `pnpm test` 561/561 (the Phase 4b-fix's new query-level tests already accounted for the jump from 558).

### Gates Verified

- `pnpm exec tsc --noEmit` — clean (re-verified after the addendum above).
- `pnpm test` — 561/561 passing (558 at the end of the main Phase 4c pass; +3 from api-developer's Phase 4b-fix regression tests, unaffected by this addendum's UI-only change).
- `pnpm build:only` — succeeds (exit 0), no new errors.
- No `console.log` in any new/modified file. No `window.confirm/alert/prompt` — both destructive actions (`Remove this cause line?`, `Collapse to a single lump sum?`) and the two informational seed confirmations use `ConfirmDialog`; the new skipped-cause-breakdown copy reuses the existing toast, no new dialog.
- `'use client'` only on `budget-cause-editor.tsx`, `budget-editor.tsx`, `guided-budget-setup.tsx` — all three need hooks/handlers; both page files stay Server Components, unchanged.

### Open questions / handoff notes

**For qa (Phase 5) — flows to click through that a test runner can't fully reach:**

1. **Enter breakdown → commit → verify total.** On `/admin/ledger/budgeting` (or a fund's `/report` page), find a giving-eligible expense category (`countsAsGiving: true`) with a lump-sum amount set, click "Break down by cause," verify the pre-filled row shows `Other community support` at the prior lump-sum amount, edit the amount and press Enter, confirm a toast fires and the "Category total" updates.
2. **Navigate-away-without-committing leaves the lump sum untouched.** Click "Break down by cause," do *not* interact with the pre-filled row, navigate to a different admin page, come back — the category should show its original lump-sum amount, not a breakdown, and not a $0/blank amount.
3. **Add a second cause line, remove one via the $0-no-confirm path and a nonzero-confirm path**, verify the `ConfirmDialog` fires only for the nonzero case (mirrors `BudgetEditor`'s existing precedent).
4. **Rename an existing committed row's cause via the dropdown** — verify the total is unchanged after the rename and a `router.refresh()`-driven reload still shows the new cause with the right amount. This is the flagged rename-via-delete+patch path — worth an explicit look since there's no atomic guarantee (see Implementer Notes).
5. **Collapse to lump sum** on a breakdown with 2+ committed lines — verify the `ConfirmDialog` copy, and that the reappearing lump-sum input shows the correct summed total (not blank, not stale).
6. **Empty a breakdown by removing lines one at a time down to zero** — verify the category reverts to a blank (not stale-total) lump-sum input, matching the "parent_deleted" contract.
7. **Locked-budget behavior**: with a FY's budget locked (via the Approve panel), verify no "Break down by cause" button appears, and any already-in-breakdown category shows disabled selects/inputs with no remove/add/collapse controls.
8. **Seed with `seedCauseLines` checked**, both fill-empty (verify the new confirm dialog fires) and overwrite (verify the appended sentence in the existing overwrite confirm) — check the post-seed toast includes a cause-line count.
9. **360px viewport** — open a category's breakdown and confirm the cause `<select>` and amount input stack vertically with no horizontal scroll on the row.
10. **Skipped-cause-breakdown copy (addendum)** — run guided-seed in overwrite mode against a fund with at least one lump-sum category and one already broken down by cause; confirm the post-seed toast reads "N categor{y/ies} skipped — already broken down by cause" for the affected fund, and that a fund with zero such skips shows no extra "0 skipped" text.

**New copy strings the Lions Club may want to refine:**
- "Break down by cause" (button label)
- "Category total: $X" 
- "Collapse to a single lump sum?" / its `ConfirmDialog` description
- "Also propose cause-level detail for giving categories, based on the last two fiscal years of cause-tagged history." (seed checkbox label) + its helper sub-text
- "Seed with cause-level detail?" confirm dialog copy

**UX decisions/tradeoffs made (beyond what's captured inline above):**
- Existing-row cause "rename" uses DELETE+PATCH rather than blocking cause edits on committed rows — see Implementer Notes for the tradeoff and residual risk.
- A single shared `seedCauseLines` checkbox (not one per entity-wide vs. per-fund action) — reduces UI surface for a rarely-used option; if usage shows treasurers want it scoped differently, splitting is a small change.
- "Cancel" (no confirm) vs. "Collapse to lump sum" (`ConfirmDialog`, destructive) are two different controls depending on whether any row has been committed yet — added because the destructive "per-cause detail is lost" framing would be misleading when nothing has actually been saved yet.

**Next: qa** for Phase 5 (typecheck/build already re-verified above; needs the manual click-through list above plus whatever automated coverage qa judges warranted for the new routes/component).

---

## Phase 4b-fix — Regression Fix (API) — 2026-07-27

**Owner:** api-developer
**Status:** complete — awaiting qa re-verification

### Root cause

qa's Phase 5 FAIL (see below) found that the **pre-existing, unmodified** `upsertBudgetLine()` — reachable via `PATCH /api/admin/ledger/budgets` and the guided-seed route's top-level per-category loop under `mode: "overwrite"` — writes `ledger_budgets.annualAmountCents` directly from the caller's number with zero awareness of existing `ledger_budget_lines` children. Because B-17 Increment A's three new write functions (`upsertBudgetCauseLine`, `deleteBudgetCauseLine`, `collapseBudgetCauseLines`, all landed in Phase 4b) correctly maintain "parent = sum of children," but `upsertBudgetLine()` — the OLD lump-sum path that predates the cause-line child table — was left untouched on the unstated assumption it would never be called against a budget row that has children, this is a cross-path invariant violation: a category broken down by cause could be silently desynced (or, via the `annualAmountCents === null` delete branch, have its children cascade-deleted outright, since `ledger_budget_lines.budget_id → ledger_budgets.id` is `ON DELETE CASCADE`) by an entirely ordinary action — editing a lump-sum category via the old route, or running guided-seed overwrite without opting into `seedCauseLines`. qa reproduced this live against the local dev DB; see the Adversarial Finding in the Phase 5 section below for the full reproduction.

### The guard

`upsertBudgetLine()` (`src/lib/ledger-queries.ts`) now runs a cause-line-aware guard immediately after the existing lock check and before either write branch (delete or upsert), inside the same transaction:

1. Look up the existing `ledger_budgets` row for the exact `(fundId, fiscalYear, categoryId, flow)` tuple, if any.
2. If it exists, check for at least one `ledger_budget_lines` child row.
3. If a child exists, reject with `{ ok: false, error: "This category is broken down by cause — edit its cause lines instead.", status: 409, reason: "has_cause_breakdown" }` — regardless of whether the call would have set a numeric amount or cleared it to `null` (both are unsafe once children exist; the `null`/delete branch would otherwise cascade-delete the children).

`UpsertBudgetLineResult`'s `ok: false` variant gained an optional `reason?: "locked" | "has_cause_breakdown"` discriminator (the existing lock-check rejection now also tags itself `reason: "locked"`) so callers can tell the two distinct 409 causes apart — a locked budget must still abort the whole caller's request, but a cause-broken-down category should just be skipped and the rest of the request should proceed. `PATCH /api/admin/ledger/budgets` needed no changes — it already surfaces `result.error`/`result.status` generically and the new 409 flows through unchanged.

**Guided-seed route** (`src/app/api/admin/ledger/budgets/seed/route.ts`) top-level per-category loop: when `upsertBudgetLine()` rejects with `reason: "has_cause_breakdown"`, the loop now skips that line (increments a new `causeBreakdownSkippedCount`, pushes a line with a new `action: "skipped_cause_breakdown"`, and `continue`s) instead of throwing `SeedLockedError` and rolling back the entire request — a category being broken down by cause is not a reason to abort seeding every OTHER category in the same request. Any other rejection reason (currently just `"locked"`) still throws and rolls back everything, unchanged from before. The existing cause-line-seeding sub-loop (added in Phase 4b, runs after the top-level loop) is unaffected and still correctly processes a `"skipped_cause_breakdown"` line via `upsertBudgetCauseLine()` — the right write path for a category that's already broken down.

`ResponseFund` gained `causeBreakdownSkippedCount: number`; `ResponseLine.action` gained `"skipped_cause_breakdown"` as a fourth value, distinct from `"skipped_existing"` so the UI isn't forced into misleading "already set" copy for a category that's protected for a completely different reason. Both changes are additive — the route's JSDoc header was updated to document them.

### New test

`src/lib/ledger-queries.test.ts`, new `describe("upsertBudgetLine — cause-line-aware guard (regression fix)")` block, three tests:
1. **"should not silently overwrite annualAmountCents when the budget row already has ledger_budget_lines children — regression for parent/child rollup desync"** — the test qa specified in the Phase 5 section (below), using qa's exact fixture values (2 children summing to $20.00, an attempted $500.00 overwrite). Asserts rejection with `reason: "has_cause_breakdown"` and zero insert/update/delete calls.
2. **"clearing a budget to null (delete) is also rejected when children exist — would otherwise cascade-delete them"** — covers the `annualAmountCents === null` branch qa's reproduction didn't explicitly exercise but the same root cause threatens.
3. **"still upserts normally when the budget row has no cause-line children (ordinary lump-sum path, unaffected by the guard)"** — sanity check that the guard adds a rejection path without changing existing, correct behavior for the common case.

**Verified failing pre-fix, passing post-fix:** temporarily reverted the guard block in `upsertBudgetLine()` (kept the new test file as-is) and re-ran `pnpm exec vitest run src/lib/ledger-queries.test.ts -t "cause-line-aware guard"` — both new regression tests failed (test 1 threw a `TypeError` from the now-missing select calls; test 2 returned `{ ok: true, action: "deleted" }` instead of the expected rejection, i.e. reproduced qa's exact silent-success bug). Restored the guard (diffed byte-identical against the pre-revert version) and re-ran — all three new tests pass.

**Full gate, post-fix:** `pnpm exec tsc --noEmit` — clean. `pnpm test` (with `DATABASE_URL` exported from `.env.local`) — **561/561 passed**, 18 test files (558 prior + 3 new).

### Files modified

- `src/lib/ledger-queries.ts` — `upsertBudgetLine()` guard + `UpsertBudgetLineResult.reason` discriminator.
- `src/app/api/admin/ledger/budgets/seed/route.ts` — top-level loop's rejection handling now branches on `reason`; `causeBreakdownSkippedCount` + `"skipped_cause_breakdown"` action added to the response contract; JSDoc updated.
- `src/lib/ledger-queries.test.ts` — 3 new tests (see above).

### Handoff to qa

Re-run the full Phase 5 gate (tsc, `pnpm test`, `pnpm build:only`, dev-server smoke) and specifically re-verify the exact live reproduction from the prior FAIL now returns a `409` rejection instead of a silent `200`. The guided-seed route's new `"skipped_cause_breakdown"` action/`causeBreakdownSkippedCount` field are new response surface `guided-budget-setup.tsx` does not yet render (it wasn't asked of ux-developer as part of this fix, scoped to api-developer/query-layer per the loop-back) — flagging so it's a known, tracked gap rather than a surprise: a treasurer running guided-seed overwrite over a mix of lump-sum and cause-broken-down categories will now correctly NOT have the broken-down ones clobbered, but the seed-review UI won't yet have distinct copy calling out which categories were protected this way (they'll just not show up as changed). Recommend a small ux-developer follow-up to render `causeBreakdownSkippedCount`/`"skipped_cause_breakdown"` with accurate copy (e.g. "N protected — already broken down by cause") before or shortly after this ships; not a blocker for the FAIL's root cause, which is fully closed.

---

# Phase 5 — Verification (qa)

**Date:** 2026-07-27
**Verified by:** qa

## Summary

**FAIL.** Every flow the ux-developer named as risky (breakdown entry, add/remove/edit lines, collapse, lock enforcement, off-taxonomy rejection, graceful empty seed state) works exactly as designed — confirmed not just by reading code but by authenticating as the real `E2E Test Admin` account and driving the live API + local dev DB directly for the highest-risk paths. But adversarial testing of the "parent = sum of children" invariant (the task's explicit ask: "consider whether any path could leave it stale") found a real, silent, reproducible integrity bug: the **pre-existing, unmodified** `upsertBudgetLine()` — reachable via `PATCH /api/admin/ledger/budgets` (unchanged by this feature) and via the guided-seed route's top-level per-category loop under `overwrite` mode — will blindly overwrite a budget row's `annualAmountCents` with **zero awareness of existing `ledger_budget_lines` children**, leaving the parent's rolled-up total permanently desynced from its cause-line children until the next per-cause-line edit happens to self-heal it. Reproduced live against the local DB (see below). No test — named in Phase 3 or otherwise — covers this cross-path interaction, so it slipped through the entire 558-test suite and both builds. This directly contradicts DECISION-045/046's stated central invariant ("the standing invariant every prior write maintains") and is silent — no error, no toast, nothing a treasurer would notice until the numbers on two parts of the same page visibly disagree.

## Type Check

`pnpm exec tsc --noEmit`: **PASS** (clean, no output)

## Unit Tests

`pnpm test`: **PASS** — 558/558 passed, 18 test files, 669ms. (Required `DATABASE_URL` exported from `.env.local` before running — `ledger-queries.test.ts` transitively imports `@/lib/db`, which throws at import time otherwise; this matches the pre-existing `dues-ledger-sync.test.ts` behavior, not a new requirement.) No failures.

## Production Build

`pnpm build:only`: **PASS** — `✓ Compiled successfully in 6.9s`. All four new/extended routes (`/api/admin/ledger/budgets/cause-lines`, `.../cause-lines/collapse`, the extended `.../budgets/seed`) present in the route manifest as dynamic (`ƒ`) handlers. No new warnings.

## Dev-Server Smoke Test

`pnpm dev` against `.env.local`: **PASS.** On startup the dev server replayed `drizzle/migrations/` (project convention — migrations re-run on every `pnpm dev` start) and `0063_ledger_budget_lines.sql` applied cleanly (`✅ Migrations completed successfully`), confirming the migration is idempotent and correct against the real local schema, not just reviewed by eye.

I did **not** stop at a curl-for-non-500 check. `.env.local` carries a dedicated `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` test account; I signed in through NextAuth's actual credentials callback (CSRF token → `POST /api/auth/callback/credentials`) and confirmed a real session with `ledger.manage`/`ledger.approve` in `features`. All smoke testing below used that live, authenticated session against the local dev DB (per project memory, this Neon DB is the user's local dev DB, not production — writes were made and then explicitly cleaned up).

- `GET /admin/ledger/budgeting` (unauthenticated): 307 → `/signin?callbackUrl=...` — correct gate.
- `GET /admin/ledger/budgeting` (authenticated, `ledger.manage`): 200, page renders, "Break down by cause" string present, no error markers.
- `GET /admin/ledger/activity/report` (authenticated): 200, renders cleanly, "Break down by cause" present.
- `PATCH`/`DELETE /api/admin/ledger/budgets/cause-lines`, `POST /api/admin/ledger/budgets/cause-lines/collapse` (unauthenticated): all 401 `{"error":"Unauthorized"}` — correct.

## Manual / Live-API Click-Through

The environment has no browser-automation tool available this session (no Playwright driver invoked; the repo also has **no existing Playwright specs for the Ledger module at all** — `e2e/` covers events, donate, admin-security, receipts, signups, none of it Ledger/budgeting — so `pnpm test:e2e` would not exercise this feature even if run). Per the task's own fallback instruction, I went further than a non-500 curl check: I drove the real API + DB directly, as the actual authenticated admin, for every flow with a server-side component. Pure client-side-only behavior (local React state, `ConfirmDialog` trigger conditions, dropdown UX, viewport CSS) has no server signal to verify this way and is marked not-reachable below, honestly, rather than inferred from passing code review.

| # | Flow (ux-developer's Phase 4c list) | Result | Notes |
|---|---|---|---|
| 1 | Enter breakdown → commit → verify total | **Exercised via live API** | `PATCH .../cause-lines` against a real fund/category/FY: first line → `categoryTotalCents: 1000`; second line → `categoryTotalCents: 1500`. DB read-back confirmed `ledger_budgets.annual_amount_cents = 1500 = SUM(ledger_budget_lines.amount_cents)`. Matches spec exactly. |
| 2 | Navigate-away-without-committing leaves lump sum untouched | **Not reachable** | Purely client-local state — by design nothing is sent to the server in this case, so there is no server-side signal to observe. Needs an actual browser. Code review (budget-editor.tsx `enterBreakdown`/pending-row logic) is consistent with the claim but unverified live. |
| 3 | Add/remove lines; `ConfirmDialog` on non-zero remove, none on $0 | **Server half exercised; dialog gating not reachable** | `DELETE .../cause-lines` verified live: removing one of two lines → `{action:"line_deleted", categoryTotalCents:500}`; removing the last → `{action:"parent_deleted"}`, and the parent `ledger_budgets` row was confirmed deleted from the DB (`count(*) = 0`). The `ConfirmDialog` pop/no-pop distinction itself is client-only — not reachable without a browser. |
| 4 | Rename an existing committed cause via dropdown | **Not reachable live; code-reviewed** | The DELETE-then-PATCH sequence and its mid-failure `router.refresh()` recovery (`budget-cause-editor.tsx` `handleCauseChange`, L193-244) were read in full — see explicit call below. Did not drive an actual dropdown rename or throttle a real browser request mid-sequence. |
| 5 | Collapse to lump sum, verify total | **Exercised via live API** | Upserted one cause line ($25.00) → `POST .../cause-lines/collapse` → `{action:"collapsed", annualAmountCents:2500}`. Correct — sum preserved, children deleted. |
| 6 | Empty a breakdown to zero → parent deletes | **Exercised via live API** | Same as #3's last-line case — `parent_deleted`, confirmed zero rows remain for that `(fundId, fiscalYear, categoryId, flow)` tuple. |
| 7 | Locked-state disables writes | **Server half exercised live; UI disabled-rendering not reachable** | Inserted a `locked` row into `ledger_budget_approvals` for a real `(entityId, fiscalYear)`, then hit all three write routes (`PATCH`, `DELETE`, `POST .../collapse`) — **all three returned 409 with the exact microcopy** `"This budget is locked. Unlock it to make changes."`, and a DB check afterward confirmed **zero partial writes** (line count and total unchanged). Did not verify the client's "no button rendered, controls hidden" rendering in a browser. |
| 8 | Seed with `seedCauseLines`, fill-empty and overwrite, confirm dialogs, toast copy | **Partially exercised via live API** | `POST /budgets/seed` with `seedCauseLines:true` against a target FY with zero lookback history returned `200` with `lines:[]` and `seededCount:0` — the graceful-empty-state contract (Human Answer 3 / Edge Cases) holds at the API level, no crash. Did not run the overwrite-mode path against real cause-tagged history (local dev DB has 93 cause-tagged transactions from the Quicken import — deliberately avoided seeding into any FY a real treasurer might be using, to not contaminate real planning data) and did not verify the fill-empty confirm-dialog trigger or the toast's cause-line count text — both client-only. |
| 9 | 360px viewport stacking | **Not reachable** | No visual/browser tool available this session. ux-developer's claim (devtools responsive-mode read of the class list) is unverified by qa. |

**Net:** 3 of 9 flows fully exercised end-to-end against the live system; 4 of 9 partially exercised (server contract confirmed live, client-only half unverified); 2 of 9 (navigate-away, 360px) have no server signal and are entirely unverified pending an actual manual browser pass. This is a stronger baseline than a plain curl-for-401 check, but it is not a substitute for a human (or Playwright) driving the actual UI — recommend the user do a real click-through of flows 2, 3 (dialog), 4, 8 (dialogs/toast), 9 before this ships, independent of the FAIL below.

## Adversarial Finding — Parent/Child Budget-Total Desync (FAIL cause)

The task asked explicitly: *"api-developer re-sums children on every write; verify the tests actually assert this and consider whether any path could leave it stale."* The three new write paths (`upsertBudgetCauseLine`, `deleteBudgetCauseLine`, `collapseBudgetCauseLines`) all correctly re-sum and are all correctly tested (`src/lib/ledger-queries.test.ts` L227-257, L289-338 — parent-total-rollup and parent-delete-on-empty, both passing). But there is a **fourth** path that also writes `ledger_budgets.annualAmountCents`: the **pre-existing, un-modified** `upsertBudgetLine()` (`src/lib/ledger-queries.ts` L751-858), reachable via:
- `PATCH /api/admin/ledger/budgets` (untouched by this feature, still live), and
- `POST /api/admin/ledger/budgets/seed`'s **top-level** per-line loop (`src/app/api/admin/ledger/budgets/seed/route.ts` L217-273) under `mode: "overwrite"` — an entirely ordinary guided-budgeting action, not an API-bypass scenario.

`upsertBudgetLine()`'s `onConflictDoUpdate` (`ledger-queries.ts` L838-855) sets `annualAmountCents` directly from the caller's number, with **no query against `ledger_budget_lines`, no check for existing children, no recompute.** Phase 3's Data Model section says the new cause-line functions must "recompute the parent's total... never a separate follow-up call" — that discipline was applied faithfully to the three new functions, but `upsertBudgetLine()` itself was left exactly as before, on the (unstated, untested) assumption it would never be called against a budget row that has cause-line children. Nothing in the shipped code enforces that assumption.

**Reproduced live**, session as `E2E Test Admin` (`ledger.manage`), fund `activity`/`8f71f400-...`, category "Service projects", FY 2099 (unused test year, cleaned up after):

```
1. PATCH .../cause-lines  cause="Youth & Education" amountCents=1200  -> 200 {categoryTotalCents: 1200}
2. PATCH .../cause-lines  cause="Vision & Eye Care"  amountCents=800  -> 200 {categoryTotalCents: 2000}
3. PATCH /api/admin/ledger/budgets  (the OLD, unmodified route) annualAmountCents=50000  -> 200 {action:"upserted"}

DB after step 3:
 parent_total | child_count | sum_of_children
 50000        | 2           | 2000
```

The two cause-line children survive untouched; the parent's `annualAmountCents` is now **50000** while its children sum to **2000** — the invariant Phase 3 calls "the single invariant the whole design depends on" is broken, silently, with a 200 response and no error. `getFundReport()`'s `budgetCents` (sourced straight from `annualAmountCents`) and `causeLines` (sourced from the children) would visibly disagree on the fund report page — the category's headline budget number and its own cause breakdown underneath would show different totals. The desync persists until the treasurer happens to edit any single cause line again (which forces a fresh recompute) — for a category seeded once at the start of a budget season and never touched again, that could be the entire fiscal year.

**How this is reachable without any malicious API bypass:** a treasurer manually breaks a category into cause lines early in budget season, then later runs "Seed next year's budget" in `overwrite` mode for the rest of their categories **without** checking the (unchecked-by-default) "seed cause-level detail" box — completely standard guided-budgeting usage per the existing feature. The seed route's top-level loop calls `upsertBudgetLine()` unconditionally for every seedable line under `overwrite`, including this now-already-broken-down category, silently stomping its total.

Cleaned up: all FY-2099 test rows (`ledger_budget_lines`, `ledger_budgets`, `ledger_budget_approvals`) deleted after reproduction; confirmed zero rows remain for that fiscal year before closing out.

**This is the actual FAIL cause**, not the rename deviation below.

## Explicit Call — Rename Deviation (flagged by ux-developer, Phase 4c)

Assessed severity: **acceptable to ship with a tracked note, not a blocker on its own.** The DELETE-then-PATCH sequence (`budget-cause-editor.tsx` `handleCauseChange`, L193-244) does have a real, narrow data-loss window if the network fails between the two calls — but unlike the finding above, this failure mode is **not silent**: the `catch` block surfaces an explicit `toast.error` naming the exact situation ("...was removed but could not be re-added...") and immediately calls `router.refresh()` so the UI reflects true server state rather than a stale/lying view. The blast radius is bounded to one cause line's cause+amount (recoverable by re-entering it manually — this is planning data, not a posted transaction), and it requires a fairly specific failure timing (request 1 succeeds, request 2 fails, in the ~seconds between two sequential fetches). Recommend logging this as a follow-up to consider a dedicated rename endpoint if real usage shows the DELETE+PATCH window is hit in practice, but it does not block Phase 5 on its own — the parent/child desync finding above is qualitatively worse (silent, not user-facing, no self-heal signal) and is what drives the FAIL verdict.

## Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `PATCH /api/admin/ledger/budgets/cause-lines` | yes | yes | `FEATURES.LEDGER_MANAGE` — correct (mutation, matches every other budget write) |
| `DELETE /api/admin/ledger/budgets/cause-lines` | yes | yes | `FEATURES.LEDGER_MANAGE` — correct |
| `POST /api/admin/ledger/budgets/cause-lines/collapse` | yes | yes | `FEATURES.LEDGER_MANAGE` — correct |
| `POST /api/admin/ledger/budgets/seed` (extended) | yes | yes | `FEATURES.LEDGER_MANAGE` — correct (pre-existing gate, unchanged by the `seedCauseLines` extension) |

All four checked by reading the route files directly (`src/app/api/admin/ledger/budgets/cause-lines/route.ts`, `.../cause-lines/collapse/route.ts`, `.../budgets/seed/route.ts`), not inferred from passing tests. All use this module's established `hasFeature(session.user.id, FEATURES.X)` async pattern from `@/lib/permissions-server`, consistent with every other Ledger route. No gap.

## `pnpm lint`

Reproduces the same ESLint 9.39.2 / `minimatch` ESM-interop `SyntaxError` on a **clean `git stash`** of every file this feature touched (verified directly — stashed, re-ran `pnpm lint`, identical failure at config-load time before any source file is read, then restored the stash). Confirmed pre-existing and unrelated to this change, exactly as api-developer reported. Logged here for deployment-engineer's dependency review, not counted against this feature's verdict.

## Coverage on Critical Modules

- `src/lib/ledger.ts` (`BUDGET_CAUSES`, `isValidBudgetCause`, `isCauseEligibleCategory`, `sumBudgetCauseLines`, `deriveCauseSeedLines`, `OTHER_COMMUNITY_SUPPORT_CAUSE` byte-identity) — all 12 Phase-3-named unit tests present and passing (`src/lib/ledger.test.ts` L2153-2210+). Every branch named in the design doc is covered.
- `src/lib/ledger-queries.ts` cause-line functions — uniqueness, lock guard (all three functions), parent-total rollup, parent-delete-on-empty all covered (`src/lib/ledger-queries.test.ts`, 8 tests). **Gap found by this review, not by the existing suite:** no test covers `upsertBudgetLine()` against a budget row that already has `ledger_budget_lines` children — see Adversarial Finding above. This is the missing regression test, not yet written (belongs to the fix, per this project's regression-test-first discipline: write it failing against current `main`, then land the fix, then it passes).

## Regression Tests Added

None added by qa this pass — per this project's discipline, the regression test for the finding above should be written by the implementer as part of the fix (failing-first), not backfilled by qa before the fix exists. Recommended test, to live in `src/lib/ledger-queries.test.ts`:
- **"`upsertBudgetLine` should not silently overwrite `annualAmountCents` when the budget row already has `ledger_budget_lines` children — regression for parent/child rollup desync"** — arrange a budget row with 2 committed cause-line children summing to $20.00; act by calling `upsertBudgetLine()` with a raw `annualAmountCents` of $500.00 against the same tuple; assert either a rejection (preferred — surfaces the conflict) or that the children are consistently reconciled, not silently orphaned.

## Verdict

**FAIL.**

**Loop-back:** **api-developer** (Phase 4b) — this is a defect in `src/lib/ledger-queries.ts`'s `upsertBudgetLine()` and its callers (`src/app/api/admin/ledger/budgets/route.ts`, and the top-level loop in `src/app/api/admin/ledger/budgets/seed/route.ts`), not a design flaw requiring a Phase 3 loop-back — the fix is scoped and mechanical: `upsertBudgetLine()` must become cause-line-aware (reject, or explicitly reconcile, when the target budget row already has `ledger_budget_lines` children) before this ships. Recommended fix shape: have `upsertBudgetLine()` check for existing children before its `onConflictDoUpdate` and return `{ ok: false, status: 409, error: "This category has a cause breakdown — edit or collapse it before setting a lump-sum amount directly." }` when children exist (mirrors this feature's own established pattern of explicit rejection over silent overwrite), and have the seed route's top-level loop either skip categories with existing children under `overwrite` mode or surface that skip in its response the same way `skipped_existing` is surfaced today.

Once fixed: re-run the full Phase 5 gate (tsc, `pnpm test`, `pnpm build:only`, and re-verify the specific reproduction above returns a rejection instead of a silent 200), plus close out the two fully-unreached flows (#2 navigate-away, #9 360px) and the partially-reached dialog/toast flows (#3, #4, #8) with an actual manual browser click-through — recommend the user do this pass directly since no browser-automation tool was available in this QA session.

---

# Phase 5 — Re-Verification (qa)

**Date:** 2026-07-27
**Verified by:** qa

## Summary

**PASS.** Re-ran the full Phase 5 gate against api-developer's Phase 4b-fix and ux-developer's follow-on. All four gates pass (tsc clean, 561/561 unit tests, production build compiles, dev-server smoke clean with a real authenticated admin session). Independently re-ran my exact original live reproduction against the fixed code — **the pre-existing lump-sum route now correctly 409s** for both the numeric-overwrite and null-delete variants, and the DB confirms zero partial writes: parent total and children both remain exactly as they were before the rejected call. Additionally set up and ran a live guided-seed `overwrite` request against the same broken-down category — it correctly skipped the category (`causeBreakdownSkippedCount: 1`, `action: "skipped_cause_breakdown"`) rather than clobbering it, and the DB confirms the breakdown was left completely untouched. The new regression test in `src/lib/ledger-queries.test.ts` genuinely covers the fix (see below). The rename deviation and the `pnpm lint` pre-existing breakage are both unchanged from the original review. Verdict flips to **PASS** — ready for Phase 6.

## Type Check

`pnpm exec tsc --noEmit`: **PASS** (clean, no output)

## Unit Tests

`pnpm test`: **PASS** — 561/561 passed, 18 test files, 667ms (3 new tests over the prior 558, matching the reported `describe("upsertBudgetLine — cause-line-aware guard (regression fix)")` block). Ran with `DATABASE_URL` exported from `.env.local`, same requirement as before.

## Production Build

`pnpm build:only`: **PASS** — `✓ Compiled successfully in 6.9s`. No new warnings, route manifest unchanged in shape.

## Dev-Server Smoke Test

`pnpm dev` against `.env.local`: **PASS.** Migrations replayed on startup, including `0063_ledger_budget_lines.sql` again (idempotent, no errors — second confirmation this migration is safe to re-run). Re-authenticated as `E2E Test Admin` through NextAuth's real credentials callback (same method as the original run) and confirmed a live session with `ledger.manage` before doing any of the verification below.

## Independent Re-Verification of the Fix

**1. Re-ran the exact original live reproduction fixture** (fund `activity`/`8f71f400-...`, category "Service projects", FY 2099, cleaned-up test year):

```
1. PATCH .../cause-lines  cause="Youth & Education" amountCents=1200  -> 200 {categoryTotalCents: 1200}
2. PATCH .../cause-lines  cause="Vision & Eye Care"  amountCents=800  -> 200 {categoryTotalCents: 2000}
3. PATCH /api/admin/ledger/budgets  (the OLD route)  annualAmountCents=50000
   -> 409 {"error":"This category is broken down by cause — edit its cause lines instead."}
4. PATCH /api/admin/ledger/budgets  (the OLD route)  annualAmountCents=null (the delete variant)
   -> 409 {"error":"This category is broken down by cause — edit its cause lines instead."}

DB after steps 3 and 4:
 parent_total | child_count | sum_of_children
 2000         | 2           | 2000
```

Both the numeric-overwrite and the null/delete variants are now rejected with `409`, and the DB confirms **zero partial writes** — parent total and children are byte-identical to their state before either rejected call. This directly closes the reproduction that drove the original FAIL.

**2. Ran a live guided-seed `overwrite` request against the same broken-down category** (set up by inserting a prior-FY-2098 `ledger_budgets` row directly so the category was "seedable" for FY2099, since FY2098/2099 have no real transaction history — a fiscal year 72 years in the future was deliberately chosen so this never collides with real club data):

```
POST /api/admin/ledger/budgets/seed  {entityId, targetFiscalYear:2099, mode:"overwrite", fundIds:[fund]}
-> 200 {
     "causeBreakdownSkippedCount": 1,
     "lines": [{ "categoryId": "...", "categoryName": "Service projects", "flow": "expense",
                 "amountCents": 1500, "source": "prior_budget", "action": "skipped_cause_breakdown" }]
   }

DB after: parent_total=2000, child_count=2, sum_of_children=2000 — unchanged.
```

The seed correctly **skipped** the broken-down category (not clobbered it), and surfaced the skip count/action in the response exactly as api-developer described. Confirms the seed route's branch on `reason === "has_cause_breakdown"` (continue/skip) vs. any other rejection (abort/rollback) is wired correctly, not just present in the diff.

**3. Regression test genuinely covers the fix — verified by reading, not just by it passing.** `src/lib/ledger-queries.test.ts` L407-484: the first test (L408) matches my exact $20.00-children/$500.00-overwrite fixture and asserts `reason: "has_cause_breakdown"`, `status: 409`, and zero insert/update/delete calls — this is the precise shape that would fail against the pre-fix code (which had no such check and would instead have proceeded to the `onConflictDoUpdate` write). The second test (L452) covers the null/delete cascade-risk variant I didn't originally call out by name but the fix correctly closes anyway. The third test (L486) confirms the guard doesn't false-positive on an ordinary lump-sum category with no children. api-developer reports having verified both variants fail pre-fix and pass post-fix by reverting just the guard block — consistent with this project's regression-test-first discipline; I did not re-do that revert myself since my own live DB reproduction (above) is an independent, stronger confirmation than re-running the same unit test against a reverted diff.

## Skip-Copy Follow-On (#10)

Exercised to the depth the harness allows: the `POST /budgets/seed` response carries `causeBreakdownSkippedCount` and the correct per-line `action: "skipped_cause_breakdown"` (confirmed live, above) — the server contract ux-developer's new toast/summary logic (`guided-budget-setup.tsx` L354-367, `causeBreakdownSkippedCount > 0` → `"N categor{y/ies} skipped — already broken down by cause"`) depends on is correct and live-verified. The toast/summary rendering itself is client-side and **not reachable** without a browser in this harness — matching the same honesty standard as the original review's flow #8. Not a blocker: the data it renders is proven correct at the source.

## Rename Deviation — Reconfirmed Unchanged

Re-checked `src/components/admin/ledger/budget-cause-editor.tsx` — `handleCauseChange` (L193) is unchanged since the original review (same line number, same DELETE-then-PATCH sequence, same `router.refresh()` recovery). Original call stands: **acceptable to ship with a tracked note**, not a blocker. Nothing in this fix pass touched it.

## `pnpm lint` — Reconfirmed Pre-Existing

Re-ran directly (no need to re-stash — no files relevant to lint's failure path changed): identical `ESLint 9.39.2` / `minimatch` ESM-interop `SyntaxError` at config-load time, byte-for-byte the same stack trace as the original review. Still pre-existing, still unrelated to this feature, still deployment-engineer's item.

## Manual Click-Through — Status Unchanged

The three flows fully exercised, four partially exercised, and two not-reachable from the original Phase 5 review (see the FAIL section above) are unaffected by this fix — the fix touched only `upsertBudgetLine`/the seed route's rejection branching, not any of the `BudgetCauseEditor` UI code those flows depend on. Recommend the user still do a real browser pass on flows #2 (navigate-away), #3 (`ConfirmDialog` gating), #4 (live dropdown rename), #8 (fill-empty/overwrite confirm dialogs + toast copy including the new skip line), and #9 (360px) before or shortly after shipping — none of these block the PASS verdict, since they were never the cause of the FAIL and nothing about them changed.

## Cleanup

All FY 2098/2099 test rows (`ledger_budget_lines`, `ledger_budgets`) created during this re-verification were deleted after the reproduction; confirmed zero rows remain for either fiscal year before closing out. Dev server stopped.

## Verdict

**PASS.**

The original FAIL's root cause — the pre-existing `upsertBudgetLine()` silently desyncing `ledger_budgets.annualAmountCents` from its `ledger_budget_lines` children — is fixed, tested, and independently re-reproduced live against the real local DB with the opposite (correct) outcome. All four gates pass. The rename deviation remains an acceptable ship-with-note. `pnpm lint`'s breakage remains confirmed pre-existing and out of scope for this feature.

**Next: analyst**, Phase 6 — shipped-vs-intent review. Recommend the analyst's review note the still-open manual-browser-click-through items above (flows #2/#3/#4/#8/#9) as a tracked follow-up rather than a blocker, consistent with how qa scoped them in both passes.

---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-07-27

## Files Read (this phase)

- Full work-log (this file, all phases) — Phase 1 Human Answers block, Phase 2/3, Phase 4a/4b/4c + 4b-fix, both Phase 5 sections.
- `docs/decisions.md` DECISION-045, DECISION-046.
- `docs/backlog.md` L32-91 — confirmed B-17/B-18/B-19 entries exist as filed.
- `src/lib/ledger.ts` L536-570 — live `BUDGET_CAUSES` (8 values), `OTHER_COMMUNITY_SUPPORT_CAUSE` const, `bucketGivingByCause()` L506 referencing the const (not a re-typed literal).
- `src/lib/ledger-queries.ts` L741, L858 and `src/app/api/admin/ledger/budgets/seed/route.ts` L103-290 — live `has_cause_breakdown` / `skipped_cause_breakdown` guard from the Phase 4b-fix.

## VERDICT

**SHIP IT**

## ONE-LINE TAKE

> Increment A shipped exactly the planning-only, cause-tagged-budget-line feature Phase 1 scoped — every one of Chris's eight binding answers is honored in the live code, the one real data-integrity bug qa found (the pre-existing lump-sum path silently desyncing a cause-broken-down category's total) was caught, fixed, and independently re-reproduced live before this closed, and what's left is a short, already-named list of browser-only checks and one narrow, non-silent rename edge case — neither rises to a ship blocker.

## What's Working

- **The parent/child total invariant, post-fix.** This is the load-bearing mechanic of the whole design (DECISION-045: "the single invariant the whole design depends on"), and qa's adversarial pass found the one real path where it broke — the old `PATCH /api/admin/ledger/budgets` route and guided-seed's `overwrite` mode both wrote `annualAmountCents` with zero awareness of `ledger_budget_lines` children. The Phase 4b-fix closes it with an explicit, non-silent 409 (`has_cause_breakdown`) rather than a quiet reconciliation, and the seed route's top-level loop now skips (not aborts) a broken-down category under `overwrite`, reporting `causeBreakdownSkippedCount`/`skipped_cause_breakdown` rather than clobbering it. qa re-ran its exact original live reproduction post-fix and confirmed zero partial writes both for the numeric-overwrite and the `null` cascade-delete variant. This is exactly the kind of cross-path invariant bug that's easy to miss in code review and qa's live-DB adversarial pass earned its keep here.
- **Lock enforcement funnels through one call site.** `assertBudgetUnlocked()` gates all three new write paths plus the pre-existing lump-sum path, and qa verified all three return the exact microcopy ("This budget is locked. Unlock it to make changes.") with zero partial writes, live against a real locked `(entity, fiscalYear)` row — not inferred from reading the code.
- **The child-table schema shape resolves Flow 3's ambiguity as designed.** "Breakdown mode" has no boolean flag — it's structurally "1+ child rows exist" — so emptying a category to zero lines deletes the parent row (`parent_deleted`), giving "no target set" exactly one representation regardless of which mode produced it. qa confirmed this live (DB row count = 0 after the last line's removal).
- **Taxonomy is genuinely one source of truth, not two kept in sync by convention.** `bucketGivingByCause()` (used on `/members/impact`) and the new budget-side picker both reference the same `OTHER_COMMUNITY_SUPPORT_CAUSE` const, guarded by a `===` byte-identity unit test — confirmed live in `src/lib/ledger.ts` L506, not just claimed in the work-log.

## Intent-vs-Shipped Diff

- Phase 1 said: proceed with **Increment A only**; file B (structured cause on transactions) and C (cause budget-vs-actual) as separate backlog items. Shipped: `docs/backlog.md` L72-91 has B-18 and B-19 filed, cross-referencing this work-log, correctly scoped as depending on A. **Verdict: matches.**
- Phase 1 Human Answer 4 said: lump→breakdown preserves the existing amount as one **"Other community support"** line, using the exact `/members/impact` label. Shipped: `budget-editor.tsx`'s `enterBreakdown` pre-fills `{ cause: OTHER_COMMUNITY_SUPPORT_CAUSE, amountCents: <old lump sum> }`, and that const is the same one `bucketGivingByCause()` renders, byte-identity-tested. **Verdict: matches.**
- Phase 1 Human Answer 5 said: drop "Fundraising event costs" from the picker; fold "Scholarships" into "Youth & Education." Shipped: `BUDGET_CAUSES` is 8 values, no "Fundraising event costs" entry; `deriveCause()` already folded Scholarships into `CAUSE_YOUTH` and nothing reintroduced a separate value. **Verdict: matches.**
- Phase 1 Human Answer 7 said: seeding tie-break = most-recent FY when a cause appears in both lookback years with different amounts. Shipped: `deriveCauseSeedLines()` implements most-recent-FY tie-break, union across years, and collision flagging, all covered by named unit tests 3-6. **Verdict: matches.**
- Phase 1 Human Answer 8 said: one line item per (cause, category, FY, flow), DB-enforced. Shipped: `(budget_id, cause)` unique constraint on `ledger_budget_lines`, plus `onConflictDoUpdate` so a same-tuple write is always an edit, never a duplicate row — matches the design's stated resolution that `budgetId` already uniquely identifies the (fund, FY, category, flow) tuple. **Verdict: matches.**
- Phase 2/DECISION-045 said: lock integration must gate the new write path — extended, not parallel. Shipped: correct for the three new paths, but qa's adversarial pass found the *old*, pre-existing `upsertBudgetLine()` path had no awareness of cause-line children at all — not a lock-gate miss, but a sibling invariant miss in the same family of concerns. Phase 4b-fix closed it same-day, independently re-verified by qa live. **Verdict: acceptable drift** — the gap was real, but it was caught inside the pipeline (Phase 5, not by a user in production) and closed before Phase 6, which is the process working as intended, not a shipped defect.
- Phase 3 DECISION-046 item 4 said: cause-breakdown eligibility = `flow === "expense" && countsAsGiving === true`. Shipped: `isCauseEligibleCategory()` implements exactly this predicate, unit-tested for expense+true, income, and countsAsGiving-false/null cases. **Verdict: matches.**
- Phase 1 Human Answer 3 (production Quicken seed) said: this is a ship-time dependency, not a Phase 2 blocker, but the seeding UI must degrade gracefully when prod is unseeded. Shipped: `computeCauseSeedForCategory()` returns `[]` (not a throw) on zero lookback history, verified live via `POST /budgets/seed` returning `200 {lines: [], seededCount: 0}`; ux-developer added static helper copy under the seed checkbox rather than a per-category empty-state panel (there's no pre-seed preview route to react to, per Phase 3's "no new GET route" ruling). **Verdict: matches** — the degrade-gracefully requirement is met; the specific empty-state *shape* (proactive help text vs. reactive per-category panel) is a reasonable implementation choice within what Phase 1 actually asked for.

## Edge Cases

- **Empty state:** pass. Zero-lookback-history seed returns `[]`/`200`, not a crash or a confusing blank breakdown panel; a category with no cause lines and no lump sum renders as today's ordinary empty row (structurally guaranteed by the "breakdown = 1+ children" schema shape, not a separate empty-state branch that could drift out of sync).
- **Failure microcopy:** pass. Locked-budget 409s reuse the exact existing sentence verbatim, confirmed live. The new `has_cause_breakdown` 409 reads as human copy ("This category is broken down by cause — edit its cause lines instead."), not a stack trace or raw error code. Off-taxonomy cause values get a 400, not a silent insert.
- **Permission gate:** pass. All four routes/route-extensions checked `auth()` + `hasFeature(session.user.id, FEATURES.LEDGER_MANAGE)` — verified by qa reading the route files directly, not inferred from tests, and confirmed live with 401s for unauthenticated requests. No new `FEATURES` key was needed or added, matching Phase 1/2/3's ruling.
- **Mobile (360px):** not independently verified this pass. ux-developer implemented and described the stacking behavior (`flex flex-col gap-2 sm:flex-row`) and read the rendered class list in devtools responsive mode; qa's harness had no browser-automation tool available and explicitly marked this flow "not reachable" in both Phase 5 passes. This is a real, named gap in verification depth, not a known failure — see Follow-Ups.

## Follow-Ups (SHIP WITH NOTES items — tracked, not blockers)

Verdict is SHIP IT, not SHIP WITH NOTES, but two items surfaced by qa/ux-developer are real enough to track rather than let evaporate:

1. **Manual browser click-through of five flows the harness couldn't reach** — navigate-away-without-committing (flow #2), `ConfirmDialog` gating on remove (#3), live dropdown rename (#4), seed confirm-dialogs/toast copy including the new skip line (#8), and 360px stacking (#9). None of these were the cause of either FAIL and nothing in the fix touched the code paths they exercise, so they don't block shipping — but they were never independently confirmed by a human or by Playwright either. **Filed as `docs/backlog.md` B-20** (Playwright e2e coverage for the Ledger budgeting module, currently zero specs) for the 7-day test-coverage review; in the meantime the user should walk them by hand in a real browser before or shortly after this ships.
2. **Cause-line rename via sequential DELETE+PATCH.** Narrow data-loss window if the network fails between the two calls; not silent (explicit toast + `router.refresh()` self-heal), bounded blast radius (one planning-data cause line, re-enterable by hand), specific timing required. qa called this acceptable-to-ship-with-a-note in both passes. **Filed as `docs/backlog.md` B-21** (dedicated rename endpoint) — revisit only if real usage shows the window gets hit in practice, not preemptively.

## Manual Verification Recommended Before Push

Since the QA harness had no browser automation this session, the user should do a real click-through of:
1. Break down a giving-eligible expense category by cause, confirm the pre-filled "Other community support" row and live total.
2. Click "Break down by cause," then navigate away without touching the field — confirm the original lump sum is untouched, not blanked.
3. Remove a cause line with a non-zero amount (expect `ConfirmDialog`) and a $0 line (expect no dialog).
4. Rename an existing committed cause line via the dropdown — confirm the total is unchanged and the row reflects the new cause after refresh.
5. Run guided-seed with the `seedCauseLines` checkbox, both fill-empty and overwrite modes, confirming the dialogs and toast copy (including the new "N skipped — already broken down by cause" line) read correctly.
6. Resize to 360px and confirm the cause `<select>` + amount input stack vertically with no horizontal scroll.

None of these block the ship — qa scoped them as post-fix, non-blocking verification gaps in both Phase 5 passes — but they haven't been seen by a human or a test runner yet, and #2 and #4 in particular touch client-only state that has no server-side signal to catch a regression later.

---

# Deployment & Security Note (2026-07-28)

Pre-push (`/pre-push`) run for the v1.40.0 push to `main` (production deploy). Gate results:

- Typecheck: **PASS**. Unit tests: **PASS 561/561** — and now hermetic: `src/lib/ledger-queries.test.ts`
  was importing the real `@/lib/db` (throws without `DATABASE_URL`), so a bare `pnpm test`/CI went red
  even though the agents saw green with `.env.local` loaded. Fixed by `vi.mock("@/lib/db")`, matching
  the `members.test.ts` pattern. Production build (`build:only`): **PASS**. Schema/migration `0063`:
  idempotent. No debug logs / native dialogs / staged env files.
- **CVE audit (`pnpm audit --prod --audit-level=high`): partially remediated + acknowledged override
  (treasurer-approved 2026-07-28).** The audit was pre-existing and unrelated to B-17 (feature added
  zero dependencies); last dependencies review 2026-06-26 was "clean," so ~1 month of new framework
  advisories had accrued. Applied safe in-range patch bumps this push: **`next` 16.2.9 → 16.2.12** and
  **`postcss` 8.5.15 → 8.5.24**, clearing all 5 Next.js/PostCSS highs (SSRF, middleware bypass, DoS,
  PostCSS path traversal). Rebuilt + retested green after the bump.
- **Remaining, explicitly overridden and deferred to the overdue dependencies review (next task):**
  3 critical + 2 high in the **Auth.js / `next-auth@5.0.0-beta.30` / `@auth/core`** chain (config-error
  and email-normalizer criticals, `getToken()` highs) — no clean in-range patch; needs a scoped beta-
  upgrade investigation. Plus 1 high **`brace-expansion` DoS** transitively under `exceljs>archiver`
  (build/script tooling only). These block the audit gate but were accepted for this feature push;
  remediating them is the first item of the follow-up dependencies review.
