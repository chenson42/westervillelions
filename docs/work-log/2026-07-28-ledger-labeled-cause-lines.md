# Labeled Cause Budget Lines (multiple lines per cause) — Work Log

> **Slug:** `2026-07-28-ledger-labeled-cause-lines`
> **Surface:** (dashboard) admin — The Ledger budgeting
> **Permission(s):** existing `ledger.manage` / `ledger.approve` expected to cover this (confirm in Phase 1/3)
> **Estimated complexity:** medium (adds a label column + relaxes the shipped (budgetId, cause) uniqueness → touches schema + API + UI, but no new subsystem)
> **Pipeline mode:** Full
> **Follow-up to:** B-17 Increment A (`docs/work-log/2026-07-27-ledger-cause-budget-lines.md`, shipped v1.40.0)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-28 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-07-28 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementer named | 2026-07-28 |
| 4 — Implementation | database-admin → api-developer → ux-developer | Complete | — | 2026-07-28 |
| 5 — Verification | qa | Complete | PASS | 2026-07-28 |
| 6 — Shipped vs intent | analyst | Complete | **SHIP IT** | 2026-07-28 |

---

# Phase 1 — Functional Refinement (analyst)

## Files Read

- `docs/work-log/2026-07-27-ledger-cause-budget-lines.md` (full, all 6 phases) — B-17 Increment A's shipped design: Human Answer 8 ("one line item per (cause, category, FY, flow)"), the `ledger_budget_lines_budget_cause_key` unique constraint on `(budgetId, cause)`, the client-side lump→breakdown pre-fill pattern (no dedicated "convert" endpoint), `assertBudgetUnlocked()` as the single lock gate, and the "Other community support" auto-line precedent.
- `src/lib/db/schema.ts` L799-824 (`ledgerBudgetLines` — `id`, `budgetId` FK cascade, `cause` text not-null, `amountCents`, `unique(budgetId, cause)`, index on `budgetId`)
- `src/lib/ledger.ts` L494-674 (`bucketGivingByCause`'s `OTHER_COMMUNITY_SUPPORT_CAUSE` reference; `BUDGET_CAUSES` — the 8-value taxonomy; `isValidBudgetCause`; `isCauseEligibleCategory` — `flow==='expense' && countsAsGiving===true`; `sumBudgetCauseLines`; `deriveCauseSeedLines` — most-recent-FY tie-break, union across years, per-**cause** collision map, no `party`/label dimension anywhere in its input shape)
- `src/lib/ledger-queries.ts` L923-1234 (`upsertBudgetCauseLine`, `deleteBudgetCauseLine`, `collapseBudgetCauseLines`) — confirms the write model keys every operation on `(fundId, fiscalYear, categoryId, flow, cause)`; `onConflictDoUpdate` targets `[ledgerBudgetLines.budgetId, ledgerBudgetLines.cause]` — **cause is the row's natural key today, not `id`**
- `src/components/admin/ledger/budget-cause-editor.tsx` (full) — confirms the Add-a-line UX today is a single `<select>` per row whose options are `ALL_CAUSES` **minus every cause already used by another row in this category** (`otherUsed`/`options` at L347-348); "renaming" an existing row's cause is implemented as DELETE-old-cause-then-PATCH-new-cause (L193-244) because there's no dedicated rename endpoint — cause is used as the row's identity for every mutation
- `docs/backlog.md` L32-95 (B-17/B-18/B-19 split — confirms B-18 "structured cause on transactions" and B-19 "cause-level budget-vs-actual" are still unstarted; `ledgerTransactions.party`/`beneficiaryCause` remain free text)

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> This is a coherent, well-motivated reversal of yesterday's "one line per cause" rule — the treasurer used the shipped feature for one day and immediately hit its real-world limit — but three of the seven design questions (label-required/collision rule, display grouping, seeding scope) change the shape of the schema and UI enough that they need the treasurer's explicit answer, not just my recommendation, before Phase 3 locks the uniqueness model and API contract.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`LEDGER_MANAGE`) | Add a cause line, now choosing a cause that **may already be used** by another line in the same category, plus typing a free-text **label** (e.g. "WARM", "Westerville Sharing & Caring") | Per line, during budget season |
| Admin (`LEDGER_MANAGE`) | Edit an existing labeled line's amount | Per line, as needed |
| Admin (`LEDGER_MANAGE`) | Edit an existing line's **label** in place (new verb — didn't exist before because a line's cause used to be its only identity, and this increment adds a second, independently-editable text field) | Occasional |
| Admin (`LEDGER_MANAGE`) | Remove a labeled line | Occasional |
| Admin (`LEDGER_MANAGE`) | Read a category's total (sum across ALL lines, labeled or not, same cause or different) | Continuously, as they edit |
| Admin (`LEDGER_MANAGE`) | Accept/adjust seed-proposed lines (scope of what gets proposed is an open question — see Q7) | Once per season |
| Admin (`LEDGER_APPROVE`) | Approve/lock a FY's budget, now covering N labeled lines per cause instead of at most one | Once per FY per entity |
| Admin (view roles) | Read a category's cause breakdown, now potentially showing repeated cause names distinguished only by label | As needed |

No new surface. Same admin-only, `LEDGER_MANAGE`/`LEDGER_APPROVE`/view-tier gate as B-17 Increment A — this is exclusively a shape change to an existing admin verb, not a new one visible to any other surface.

## Flows

**Flow 1 — Add a labeled line to a cause that's already in use under this category:**
Entry: `/admin/ledger/budgeting` or a fund's `/report` page, a category already in breakdown mode → Step: treasurer clicks "+ Add cause" → Step: **UX must change from today's shipped behavior** — the cause dropdown can no longer exclude already-used causes (that's the entire point of this request), so it must offer all causes freely → Step: treasurer optionally types a label into a new text field → Step: enters a dollar amount → Outcome: a new line is created under the same cause as an existing line, distinguished by label.
- Failure: submitting a cause+label combination that's identical to an existing line (including two blank labels — see Q2/Q3) → inline "A line for this cause and label already exists — edit it instead," no duplicate row. This requires the uniqueness model to move from `(budgetId, cause)` to something involving label, and the failure copy must be specific enough that a treasurer distinguishes "duplicate cause" (fine, expected) from "duplicate cause+label" (blocked).
- Off-taxonomy cause submitted directly to the API → 400, unchanged from B-17 Increment A.
- Locked budget → 409, unchanged microcopy.
- **Not addressed by the request:** an overlong or garbage label (see Adversarial Pass, Input Boundaries below).

**Flow 2 — Edit an existing line's label (new flow, not named by the request but implied by "each labeled for budgeting purposes"):**
Entry: an existing labeled line's label field → Step: treasurer changes "WARM" to "WARM Inc." (a correction) → Outcome success: the line's label updates, amount and cause unchanged.
- **Gap, not a hypothetical one:** today's shipped code has no concept of "edit a field that isn't the amount" without deleting and recreating the row (the cause-rename path already does exactly this, and ux-developer flagged it in the Phase 4c notes as a real, if narrow, failure window). Adding label as a second renamable field on the same row **doubles the surface for that exact class of bug** unless the identity model changes from `(cause)` to the row's own primary key (`id`). This is a load-bearing implementation detail, not a UI nicety — see Gaps.
- Failure: same lock/network failure microcopy as amount edits; if a rename-via-delete+recreate approach is kept, the same "line transiently gone, refresh to verify" risk from B-17 Increment A applies here too, now on two fields instead of one.

**Flow 3 — Remove a labeled line:**
Entry: an existing labeled line → Step: treasurer removes it, `ConfirmDialog`-gated when non-zero, ungated at $0 → Outcome: line removed; if a sibling line with the same cause still exists, the category shows that remaining line under the same cause (not "no target set" — that state is reserved for zero lines left across ALL causes, mirroring the collapse-to-parent-delete rule Increment A already established, extended to "zero lines total," not "zero lines for this cause").
- Failure: locked budget → 409, unchanged.

**Flow 4 — Read a category's breakdown with repeated causes:**
Entry: fund report or budgeting page, a category with e.g. two "Hunger & Basic Needs" lines (WARM, Westerville Sharing & Caring) → Outcome: **undefined by the request** — does the treasurer see two identical-looking "Hunger & Basic Needs" rows with only the label distinguishing them, or a grouped view (cause header + subtotal, labeled lines nested under it)? This is Q6 below and is not a cosmetic detail — it's the actual budgeting-clarity motivation named in the request ("I need multiple lines... each labeled for budgeting purposes").
- No failure path — this is a read.

**Flow 5 — Seed lines from historical actuals, now with a per-line label:**
Entry: existing guided-budget-setup seed flow → Step: system proposes cause-level lines exactly as today (`deriveCauseSeedLines` groups only by `(cause, fiscalYear)` — it has no `party`/label dimension in its input shape at all) → **Open question:** does this increment also change seeding to propose one line per `(cause, party)` pair, reading `ledgerTransactions.party` as the label source? Or does seeding stay exactly as shipped (one line per cause, unlabeled), with the treasurer manually splitting it into labeled lines afterward?
- Failure/degenerate case, unchanged from Increment A: a category with no cause-tagged actuals in the lookback window falls back gracefully to no proposal, not a crash.
- **This is not a detail — it's a scope line.** Reading `party` to auto-propose per-beneficiary seed lines requires trusting `party`'s free-text quality (it's the same class of unstructured field B-18 was created specifically to clean up) and reworking `deriveCauseSeedLines`'s grouping key. Recommend staying cause-level-only for this increment (see Q7) and flag the per-party seed idea as a natural B-18/B-19-adjacent follow-up once `party`/`beneficiaryCause` are structured.

**Flow 6 — Collapse a multi-label cause breakdown back to lump sum (existing flow, now with more lines to collapse):**
Entry: same "Collapse to lump sum" control → Outcome: unchanged in shape — sums ALL lines (any cause, any label) into one dollar figure, deletes every child row. No new design question here; flagging only to confirm the existing `ConfirmDialog` copy ("individual cause records are deleted... per-cause detail is lost") still reads correctly when there are now potentially 10+ labeled lines instead of at most 8.

## Permissions

No new `FEATURES` key. Identical to B-17 Increment A:

- **Add/edit/remove a labeled line, edit a label, seed lines:** existing `FEATURES.LEDGER_MANAGE`.
- **Approve/lock (covers labeled lines transitively — lock is keyed on `(entityId, fiscalYear)`):** existing `FEATURES.LEDGER_APPROVE`.
- **View breakdown (read-only):** existing `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])`.
- **Default roles:** unchanged.

## Gaps the Request Didn't Address

**1. The write model's natural key breaks — this is the load-bearing gap.** Every mutation today (`upsertBudgetCauseLine`'s `onConflictDoUpdate` target, `deleteBudgetCauseLine`'s lookup, the UI's cause-rename-via-delete+PATCH) is keyed on `(budgetId, cause)` because cause used to be the row's whole identity. Once two rows can share a cause, **cause is no longer sufficient to address a row** — every write path needs to move to the row's own `id` (primary key) as the addressing key, with `(cause, label)` becoming descriptive data rather than an identity. This is not an implementation nicety; it's the actual mechanism this request needs, and if it's skipped, "edit this specific WARM line's amount" becomes ambiguous the moment a second same-cause line exists. Surfacing here so tech-lead treats it as the central API-contract decision, not a detail discovered mid-build.

**2. Label editing needs its own answer, not an inherited one.** B-17 Increment A's cause-rename (delete+recreate) already has a known, disclosed failure window (ux-developer's Phase 4c notes). Adding a second free-text, independently-editable field (label) on the same row means "rename" now applies to two things. If the row is re-addressed by `id` (Gap 1's fix), label edits become a trivial `UPDATE ... WHERE id = ...` with no delete-then-recreate risk at all — which is itself a good argument for making Gap 1's fix a hard requirement of this increment, not an optional cleanup.

**3. Display grouping is the actual value proposition, and it's unaddressed.** The request's own example ("under 'Charitable donations out' I could have multiple 'Hunger & Basic Needs' lines") describes a mental model of cause-as-header, label-as-sub-line. A flat list of `(cause, label, amount)` rows technically satisfies the schema requirement but may not deliver the budgeting clarity the treasurer is actually asking for. Recommend grouping lines by cause with a per-cause subtotal, labeled lines nested beneath — but this is a real scope/complexity decision for the treasurer, not something I should silently assume (see Q6).

**4. Empty/no-label collision rule is unresolved and has real DB implications.** Can two lines under the same cause both have a blank label? If yes, they're indistinguishable in the UI ("Hunger & Basic Needs — $500" and "Hunger & Basic Needs — $300" with nothing to tell them apart) and the uniqueness constraint can't use a naive `UNIQUE(budgetId, cause, label)` — Postgres treats `NULL <> NULL`, so a nullable label column would silently **allow** unlimited blank-label duplicates under that constraint shape, the opposite of what's needed. Functional recommendation: allow **at most one** blank/generic line per cause (the "I haven't picked a specific beneficiary yet" bucket) plus any number of distinctly-labeled lines — which requires either a non-null `label` column defaulting to `''` (so blank is a real, collidable value) or a partial unique index scoped to `label IS NULL`. DDL shape is tech-lead's call; the *functional rule* is mine to state and the treasurer's to confirm (Q2).

**5. The "Other community support" auto-line's relationship to labels is undefined.** When a lump-sum category is converted to breakdown, B-17 seeds one line at `cause = "Other community support"` with no label. Should a treasurer be able to add *additional*, labeled lines alongside that auto-line under the same pseudo-cause (e.g., a second "Other community support" line labeled "Pancake Breakfast overflow")? Functionally yes, for consistency — nothing about "Other community support" is special once cause can repeat — but flagging so Phase 3 doesn't special-case it out by accident.

**6. Input boundaries on the new field — not mentioned by the request.** A label is free text typed by a human. Needs: trim, a reasonable max length (recommend ~120 chars — matches this codebase's other short free-text fields like `party`), and rejection of an all-whitespace value as equivalent to blank (so it doesn't create a phantom "distinct" blank-labeled duplicate). This must be server-validated, not just constrained by a client `maxLength` attribute — the existing `isValidBudgetCause()` precedent (controlled-value, server-checked) doesn't map directly since label is open-ended text, but the same "never trust the client" posture applies.

**7. Existing shipped data migration must be additive, non-destructive.** Any cause line created in production under v1.40.0 has no label. The new column must be nullable/defaultable with zero backfill — every existing single-line-per-cause row should continue to read and behave exactly as it does today (an unlabeled/generic line for that cause), coexisting with any newly-added labeled siblings. This is an invariant I'm asserting, not a question — confirming it explicitly because the request touches a table and a constraint that already has live rows.

**8. Autocomplete/reuse of prior labels — not requested, worth flagging as a low-cost improvement.** Free text invites drift ("WARM" vs "W.A.R.M." vs "Warm Inc" across different categories or fiscal years), which undermines "for budgeting purposes" consistency the treasurer is asking for. A `<datalist>` populated from labels already used elsewhere in the same fund/entity (no new table, just a distinct-values query) would reduce this at near-zero cost. Not blocking — flagging as a Phase 3 nice-to-have, not a requirement.

**9. Mobile (360px).** Adding a label text input to `BudgetCauseEditor`'s already-stacked cause-`<select>` + amount-input + remove-button row makes each row four fields wide. The existing `flex-col … sm:flex-row` stacking pattern should extend cleanly, but this is now the densest row in the whole Ledger UI — flag explicitly for ux-developer/qa, don't assume it inherits gracefully.

**10. Brand consistency** — no new pattern introduced; the label is a plain text `<input>` alongside the existing cause `<select>` and amount `<input>`, same `rounded` / focus-ring treatment. `ConfirmDialog` precedent for removal carries forward unchanged. No `window.confirm`, no `rounded-full`, no `lions-red` risk identified.

## Out of Scope (confirm with user)

- **B-18 (structured cause on transactions/reimbursements)** — still not touched by this increment. Labels live only on the budget side; `ledgerTransactions.beneficiaryCause`/`party` remain free text, unaffected.
- **B-19 (cause-level budget-vs-actual)** — still blocked on B-18; unaffected by adding labels to the budget side.
- **Per-(cause, party) auto-seeding from historical actuals** — my recommendation is this stays out of scope for this increment (see Q7); flagging as implied-but-likely-not-intended by the request's framing.
- **A controlled/reusable label list (vs. free text with optional autocomplete)** — the request's own examples (WARM, Westerville Sharing & Caring) read as open-ended organization names, not a fixed taxonomy; treating labels as a second controlled list would be scope creep beyond what was asked.
- **Renaming a cause value itself, or editing the 8-value `BUDGET_CAUSES` taxonomy** — unrelated to this request; not touched.

## Open Questions

**Need the treasurer's explicit decision before Phase 3 (these change the schema/API shape, not just cosmetics):**

1. **Label required or optional, and what's the blank-label collision rule?** Can a cause have one unlabeled ("generic") line coexisting with N labeled lines, or does adding any label to a cause require every line under that cause to have one? My recommendation: optional, at most one blank per cause, any number of distinct non-blank labels — but this is a real product decision with DB constraint consequences (Gap 4), not a detail I should assume.
2. **Display grouping** — flat `(cause, label, amount)` list, or cause-header-with-subtotal-and-nested-labeled-lines? This is arguably the actual ask embedded in the request's own example, not an optional polish item (Gap 3).
3. **Seeding scope** — does this increment change `deriveCauseSeedLines` to propose one line per `(cause, party)` using `ledgerTransactions.party` as the label source, or does seeding stay cause-level-only (my recommendation), with labels added manually after seeding? (Flow 5, Gap linking to B-18's still-unstructured `party` field.)

**Recommendations I'm prepared to proceed on without a separate answer, stated here for the record:**

4. **Label type:** free text, optionally autocomplete-assisted from prior labels in the same fund/entity (Gap 8) — not a second controlled taxonomy.
5. **Row identity moves to `id`:** every write path (upsert/delete/rename) should address a specific line by its own primary key rather than reconstructing identity from `(cause)` or `(cause, label)` — this is the fix for Gap 1/2 and I consider it close to non-negotiable given the known rename-via-delete+recreate risk already flagged once in this same module.
6. **Existing data:** additive-only migration, no backfill, existing single lines continue to render as the unlabeled/generic line for their cause.
7. **Category total:** unchanged — sum of every line under the category regardless of cause or label.

## Human Answers (Chris, 2026-07-28)

Binding inputs for Phase 2/3. The three questions the analyst flagged as needing a decision:

- **Q2/Q3 — Label rule: OPTIONAL, one blank per cause.** A label is optional; a cause may keep exactly **one** unlabeled/generic line, PLUS any number of distinctly-labeled lines. Uniqueness blocks exact-duplicate `(cause, label)` — including a second blank-label line under the same cause. Existing v1.40.0 lines become the "generic" (unlabeled) line for their cause.
- **Q6 — Display: GROUPED BY CAUSE with per-cause subtotal.** Cause renders as a header, its labeled lines nested underneath, a subtotal per cause. (Confirmed against the ASCII mock: cause header → `• WARM` / `• Westerville Sharing & Caring` sub-lines → cause subtotal → category total.) Not a flat list.
- **Q7 — Seeding: CAUSE-LEVEL ONLY.** "Seed from last year" keeps proposing one unlabeled line per cause; the treasurer splits into labeled lines by hand. Do NOT rework `deriveCauseSeedLines` to a `(cause, party)` grain in this increment — that depends on transaction free-text `party` quality, which is B-18's job.

The four analyst "proceed without a separate answer" items (#4 free-text label + datalist autocomplete, #5 row identity → `id`, #6 additive-only migration, #7 category total unchanged) are all **accepted as stated** and are binding for design.

# Phase 2 — Architectural Review (architect)

## Files Read

- This work-log's full Phase 1 section, including the binding "Human Answers (Chris, 2026-07-28)" block and the four analyst "proceed without a separate answer" items.
- `docs/work-log/2026-07-27-ledger-cause-budget-lines.md` (B-17 Increment A, full) — shipped design, DECISION-045/046.
- `docs/decisions.md` DECISION-045 (taxonomy home + child-table shape, `(budgetId, cause)` uniqueness rationale) and DECISION-046 (API surface: no dedicated enter-breakdown endpoint, collapse endpoint, additive seed extension, category-eligibility predicate).
- `src/lib/db/schema.ts` L805-824 (`ledgerBudgetLines` — current columns, `unique("ledger_budget_lines_budget_cause_key").on(t.budgetId, t.cause)`).
- `drizzle/migrations/0063_ledger_budget_lines.sql` (the exact idempotent shape the new migration must extend: guarded `CREATE TABLE IF NOT EXISTS`, a `DO $$ ... IF NOT EXISTS (pg_constraint) ... END $$` guard around the unique constraint add).
- `src/lib/ledger-queries.ts` L923-1170 (`upsertBudgetCauseLine`, `deleteBudgetCauseLine`, `collapseBudgetCauseLines`) — confirms every write is keyed on `(fundId, fiscalYear, categoryId, flow, cause)`, `onConflictDoUpdate` targets `[ledgerBudgetLines.budgetId, ledgerBudgetLines.cause]`, and both upsert and delete resolve the parent `ledger_budgets` row and recompute `annualAmountCents = SUM(children)` in the same transaction, gated by `assertBudgetUnlocked()`.
- `src/app/api/admin/ledger/budgets/cause-lines/route.ts` (PATCH = upsert-by-cause, DELETE = delete-by-cause; both check `LEDGER_MANAGE`).
- `src/components/admin/ledger/budget-cause-editor.tsx` (full) — confirms `handleCauseChange`'s DELETE-then-PATCH "rename" path (the disclosed failure window Gap 1/2 refers to), the pending-row (`committedCause: null`) convention, and `nextUnusedCause`/`usedCauses` exclusion logic that must change now that causes can repeat.

## Verdict

**Approved with suggestions**

## Placement

- **No new module or top-level directory.** Everything stays inside the existing Ledger surface: `src/lib/db/schema.ts` (column + constraint change on `ledgerBudgetLines`), `drizzle/migrations/` (one new idempotent file), `src/lib/ledger-queries.ts` (id-keyed write functions replacing the cause-keyed ones), `src/app/api/admin/ledger/budgets/cause-lines/route.ts` (request/response shapes gain `id`/`label`), `src/components/admin/ledger/budget-cause-editor.tsx` (row keying + grouped-by-cause rendering). No sibling of `budget-cause-editor.tsx` is warranted for the grouping display — a cause-header/subtotal/nested-lines layout is a rendering change inside the same component, not a new one.
- **Server vs client split unchanged.** `budget-cause-editor.tsx` stays a client component (it already owns interactive state — row edits, blur/Enter commit, `ConfirmDialog`). The `<datalist>` autocomplete source (distinct prior labels for the fund/entity) is read server-side by the page that already fetches the budget/report data and passed down as a plain prop array — no new client-side fetch, no new route needed for it.
- **No new npm dependency.** The label input is a plain `<input list="...">` wired to a native `<datalist>` — zero-cost, already how HTML autocomplete works, nothing to evaluate against the dependency criteria.

## Schema-Shape Ruling (the load-bearing call)

**(a) `label` is `TEXT NOT NULL DEFAULT ''`, not nullable.** The binding rule is "at most one blank label per cause." Postgres unique constraints treat `NULL <> NULL` — a nullable `label` under a plain composite unique constraint would *permit* unlimited blank-label duplicates per cause, which is the exact case that must be blocked. Making blank a real, self-colliding empty string is what makes the constraint do the enforcement instead of application code. `ADD COLUMN ... TEXT NOT NULL DEFAULT ''` on a populated table is also cheap under Postgres's fast-default path (metadata-only, no table rewrite, since the default is a constant) — this doubles as the migration's backfill: every v1.40.0 row becomes `label = ''`, i.e. the generic/unlabeled line for its cause, satisfying binding item 6 (additive, no explicit backfill loop needed).

**(b) Uniqueness is a plain composite constraint — `UNIQUE(budget_id, cause, label)` — not a partial/expression index.** Once (a) is decided, `COALESCE(label, '')` has nothing to normalize; a partial or expression unique index would be solving a problem `NOT NULL DEFAULT ''` already eliminated, at the cost of a second, less-obvious mechanism for the next person reading the schema. Plain constraint, same idiom as the one it replaces.

**The constraint swap, and its idempotency/ordering risk (flagged as required, not optional):** this table has live rows in both dev and production (v1.40.0 shipped, seeded 2026-07-20). The new migration must, in order: (1) `ALTER TABLE ledger_budget_lines ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT ''` — first, because the new constraint references this column; (2) drop the old constraint guarded by `IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_budget_lines_budget_cause_key')`, mirroring 0063's own guard style; (3) add the new constraint (`ledger_budget_lines_budget_cause_label_key` on `(budget_id, cause, label)`) guarded by the equivalent `IF NOT EXISTS` check. All three steps no-op cleanly on replay, so the migration is safe under this project's no-tracking-table, replay-every-deploy rule.

**Why the swap cannot fail against existing data:** the *old* constraint was actively enforced for the entire time v1.40.0 rows were written — no two existing rows can share `(budget_id, cause)`. Since every existing row gets `label = ''` from the same statement that adds the column, the new, stricter `(budget_id, cause, label)` constraint is automatically satisfied by 100% of pre-existing data the instant the column exists. There is no window where the new constraint could reject a row that passed the old one. This is worth stating explicitly in the migration's own comment header (mirroring 0063's comment style) so the next person doesn't have to re-derive it.

**`schema.ts` must match exactly** — rename the constraint in the Drizzle table definition to `ledger_budget_lines_budget_cause_label_key` on `(t.budgetId, t.cause, t.label)` with the label column declared `.notNull().default("")`, so `drizzle-kit push --force` sees no drift against what the SQL migration already produced (schema.ts first, migration second, per the Schema-Is-Source-of-Truth invariant).

## Write-Model / Identity Change

**Endorsed, and treated as required per binding item 5, not optional cleanup.** `upsertBudgetCauseLine`'s cause-keyed `onConflictDoUpdate` and `deleteBudgetCauseLine`'s cause-keyed lookup both stop being sound the moment two rows can share a cause — cause alone can no longer address one row. Ruling for Phase 3 to formalize into an API contract:

- **Create** (client has no `id` yet — this includes the pending pre-fill row and any brand-new labeled line): resolve/create the parent `ledger_budgets` row exactly as today, then `INSERT` the child. The new `(budget_id, cause, label)` constraint should be allowed to do the enforcement — catch the constraint violation and return a specific, distinguishable error (a duplicate-line message, not the generic 500) rather than quietly merging into an `onConflictDoUpdate`, since two distinct lines merging into one silently is exactly the bug this increment exists to prevent.
- **Edit-amount** and **edit-label**: both collapse to one shape, `UPDATE ledger_budget_lines SET amount_cents = ..., label = ..., updated_at = now() WHERE id = $1`, after resolving the row's `budgetId` → `entityId`/`fiscalYear` (a join to `ledgerBudgets`) to run `assertBudgetUnlocked()` exactly as today. This retires the DELETE-then-PATCH "rename" path in `budget-cause-editor.tsx`'s `handleCauseChange` — a disclosed, narrow failure window from B-17 Increment A (ux-developer's Phase 4c notes) — rather than doubling that same risk onto a second independently-editable field. A label edit that collides with an existing `(cause, label)` pair on a *different* row is the same constraint-violation case as create and should surface the same distinguishable error.
- **Delete**: `DELETE ... WHERE id = $1`, same lock-check-then-recompute-parent-total shape as today, addressed by `id` alone.
- **API-contract implication for Phase 3:** routes now need a line `id` in the request body for edit/delete, and the create response must return the new row's `id` (the upsert response already does — `lineId` — so this is a rename/reuse, not a new field). The client (`budget-cause-editor.tsx`) must track `id` per row instead of `cause` — the existing `committedCause: string | null` field becomes something like `committedId: string | null`, and `usedCauses`/`nextUnusedCause`'s "exclude causes already in use" logic must be dropped entirely, since offering an already-used cause is now the whole point (replace with duplicate-`(cause,label)` rejection surfaced from the server, per binding item 1's collision rule).
- **Lump→breakdown pre-fill and collapse are unaffected in shape.** The pre-fill row still commits via a create call on first blur/Enter (now assigned an `id` on success instead of being "committed under a cause"); collapse still deletes every child row for a `budgetId` and leaves the parent's `annualAmountCents` untouched, since that invariant never depended on how children were addressed.
- **Suggestion, not a blocker:** whether edit/delete requests still redundantly carry `fundId`/`fiscalYear`/`categoryId`/`flow` alongside `id` (matching today's payload shape, defense-in-depth but redundant since `id` → `budgetId` already pins that whole tuple) or drop them in favor of deriving everything from the `id` via the `ledgerBudgets` join is a Phase 3 API-contract call, not an architectural one — either is sound. Leaning toward dropping the redundant fields for edit/delete (create still needs them, since no `budgetId` exists yet), but tech-lead should decide based on how much it simplifies the route handler vs. the client.
- **Suggestion:** pick a distinguishable status/error shape for "duplicate `(cause, label)`" (create or edit-label) vs. "budget locked" — both are plausible 409s today from adjacent code paths; the client's error surface (`toast.error`) should be able to tell a treasurer "a line for this cause and label already exists" apart from "this budget is locked," per Phase 1 Flow 1's stated requirement. Exact status code (400 vs 409) and error body shape is tech-lead's call.

## Invariants Touched

- **Schema is the source of truth** — respected: `schema.ts` updated first (label column + renamed constraint), matching idempotent SQL migration follows, in that order.
- **Migrations re-run on every deploy / must be idempotent** — the sharp edge in this increment. The three-step column-add → drop-old-constraint → add-new-constraint sequence, each individually guarded (`IF NOT EXISTS` column, `IF EXISTS`/`IF NOT EXISTS` constraint guards mirroring 0063's own style), is safe to replay indefinitely and cannot fail against the populated dev/production table for the reason stated above (old constraint's enforcement history guarantees the new one is already satisfied).
- **Permissions are the only gating mechanism** — unchanged. No new `FEATURES` key. `LEDGER_MANAGE` gates every create/edit/delete; `LEDGER_APPROVE`'s lock (`assertBudgetUnlocked()`) still gates every write, now resolved via the line's `id` → `budgetId` → `(entityId, fiscalYear)` instead of via the request's own `fundId`/`fiscalYear` fields for edit/delete — same check, different lookup path.
- **No native browser dialogs** — unaffected; `ConfirmDialog` continues to gate non-zero-amount line removal exactly as shipped.
- **Server/client boundary** — unaffected; no new client-only logic beyond what `budget-cause-editor.tsx` already owns.

## `OTHER_COMMUNITY_SUPPORT_CAUSE` Interaction

**Confirmed: no special-casing needed.** Under the new model, the lump→breakdown auto-line is simply a line where `cause = OTHER_COMMUNITY_SUPPORT_CAUSE` and `label = ''` — i.e., the generic/unlabeled line for that pseudo-cause, identical in shape to every other unlabeled line. A treasurer can add additional labeled lines under the same cause value (e.g., "Other community support" + label "Pancake Breakfast overflow") through the exact same create path as any other cause, consistent with Gap 5's recommendation in Phase 1. Nothing in `computeCauseSeedForCategory`/`deriveCauseSeedLines` touches this cause specially today and nothing here requires it to start.

## Notes for Phase 3

- Grouped-by-cause display (binding item 3: cause header → labeled sub-lines → per-cause subtotal → category total) is a client-side grouping/reduce over the flat row list already returned by the existing read path — no new query or endpoint needed; `sumBudgetCauseLines` already exists for the category total, and a per-cause subtotal is the same reduce keyed on `cause` instead of the whole list.
- The `<datalist>` autocomplete's data source (distinct labels already used in the same fund/entity) is a `SELECT DISTINCT label FROM ledger_budget_lines WHERE label <> ''` joined through `ledger_budgets` to the fund/entity, read once per page load alongside the existing budget/report fetch — no new table, no new route, per binding item 4/Gap 8.
- Label input validation (trim, ~120-char max, collapse all-whitespace to `''` before it ever reaches the uniqueness constraint) must happen server-side in the write path, not just via a client `maxLength` — per Phase 1 Gap 6. This is what makes the DB constraint meaningful: an untrimmed `" WARM"` and a trimmed `"WARM"` must not be treated as distinct labels.
- Seeding (`deriveCauseSeedLines`/`computeCauseSeedForCategory`) needs zero changes — binding item 4 (Q7) keeps it cause-level-only; seeded lines simply land with `label = ''` under the new model, same as any other generic line.
- Nothing here loops back to Phase 1 — the shape the analyst described (id-keyed writes, `NOT NULL DEFAULT ''` label, grouped display, cause-level-only seeding) is exactly what the schema/API can support cleanly. Advancing to Phase 3.

---

# Phase 3 — Technical Design (tech-lead)

**Date:** 2026-07-28

## Files Read

- This work-log's full Phase 1 (incl. binding "Human Answers (Chris, 2026-07-28)") and Phase 2 sections.
- `docs/decisions.md` DECISION-047 (schema-shape ruling, id-keyed write model), DECISION-046 (B-17's API-surface precedents this increment extends), DECISION-045 (child-table shape, taxonomy home).
- `docs/work-log/2026-07-27-ledger-cause-budget-lines.md` (full — Phase 3 template, shipped DDL/API/component shapes, the 12 named unit tests, the disclosed cause-rename-via-delete+PATCH failure window this increment retires).
- `src/lib/db/schema.ts` L799-824 (live `ledgerBudgetLines`: `id`, `budgetId` FK cascade, `cause` text not-null, `amountCents`, `unique(budgetId, cause)`, index on `budgetId`).
- `src/lib/ledger.ts` L519-674 (`BUDGET_CAUSES`, `OTHER_COMMUNITY_SUPPORT_CAUSE`, `isValidBudgetCause`, `isCauseEligibleCategory`, `sumBudgetCauseLines`, `deriveCauseSeedLines`, `CauseSeedSourceRow`/`CauseSeedProposedLine`).
- `src/lib/ledger-queries.ts` L93-125 (`FundReportCategoryLine`/`FundReport`), L460-600 (`causeLinesByBudgetId` build + `buildLines()`), L920-1234 (`upsertBudgetCauseLine`, `deleteBudgetCauseLine`, `collapseBudgetCauseLines`), L1235+ (`computeCauseSeedForCategory`), L2700-2740 (`getEntityReport`'s parallel `causeLines: null` site), L706-830 (`upsertBudgetLine`'s `reason?: "locked" | "has_cause_breakdown"` discriminator — the exact precedent this increment's 409s mirror).
- `src/app/api/admin/ledger/budgets/cause-lines/route.ts` (PATCH/DELETE, cause-keyed) and `.../cause-lines/collapse/route.ts` (POST, unaffected).
- `src/app/api/admin/ledger/budgets/route.ts` L82-93 (confirms `reason` is a type-level field today, not yet surfaced in the JSON error body — this increment is the first to put `reason` on the wire).
- `src/components/admin/ledger/budget-cause-editor.tsx` (full — `Row.committedCause`, `handleCauseChange`'s DELETE-then-PATCH rename path, `nextUnusedCause`/`otherUsed` exclusion, `ConfirmDialog` precedent).
- `src/components/admin/ledger/budget-editor.tsx` L1-30, 100-300 (`BudgetLine.causeLines`/`countsAsGiving`, `breakdownOverride` map, pending-row pre-fill wiring into `BudgetCauseEditor`).
- Both `budgeting/page.tsx` and `[fundSlug]/report/page.tsx` (`budgetEditorLines` mapping — confirms two call sites need the extended `causeLines` shape, not one).

## Summary

This increment relaxes B-17's "one line per cause" rule so a treasurer can enter several distinctly-labeled dollar amounts under the same cause (e.g. two "Hunger & Basic Needs" lines: "WARM" and "Westerville Sharing & Caring"), while keeping exactly one unlabeled/generic line as the default bucket. The schema gains a `label TEXT NOT NULL DEFAULT ''` column and swaps `ledger_budget_lines`' unique constraint from `(budget_id, cause)` to `(budget_id, cause, label)`; every write path moves from addressing a line by `(cause)` to addressing it by its own `id`, retiring the delete-then-recreate "rename" hack B-17 shipped with a disclosed failure window. Display groups lines by cause with a per-cause subtotal, nested labeled sub-lines, and an unchanged category total. Seeding, permissions, and the collapse-to-lump-sum flow are untouched. No new `FEATURES` key, no new endpoint beyond the existing `cause-lines`/`cause-lines/collapse` pair.

## Permissions

No new `FEATURES` key. Identical to B-17 Increment A — reconfirmed, not re-decided:

| Action | Gate |
|---|---|
| Create/edit-amount/edit-label/remove a labeled line, collapse to lump sum, seed | `FEATURES.LEDGER_MANAGE` |
| Approve/lock (covers labeled lines transitively — lock is keyed on `(entityId, fiscalYear)`) | `FEATURES.LEDGER_APPROVE` |
| View a category's grouped cause breakdown | `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` |

Default role bindings unchanged. No permissions migration needed.

## API Contract

Same two-route surface as B-17 (`/api/admin/ledger/budgets/cause-lines` PATCH+DELETE, `.../cause-lines/collapse` POST), each still `auth()` → `hasFeature(LEDGER_MANAGE)` → shape validation → `assertBudgetUnlocked()` → write, inside one `db.transaction()`. **Every write now disambiguates on presence of an `id` in the body — that's the entire API-contract change.**

**A cause value, once chosen at line creation, is not editable in place in this increment.** Phase 1 named exactly one edit verb (Flow 2: edit an existing line's *label*) — no "change an existing line's cause" flow was ever requested, and the binding decision's own wording ("edit-amount + edit-label = one UPDATE") names only those two fields. Moving a line to a different cause is therefore DELETE the old line + CREATE a new one under the target cause — two explicit, already-existing API calls, not a third mutable field on UPDATE. This is a deliberate scope call, not an oversight: it fully retires the delete-then-recreate rename hack (there is no in-place cause mutation left to protect), and it's a narrowing of what B-17's shipped UI technically allowed (every committed row had a live cause `<select>`). **Flagging this to the user explicitly — if losing in-place cause-editing on committed rows is unwanted, say so before Phase 4 and I'll add `cause` as a third optional UPDATE field (mechanically trivial — same collision-check codepath, just one more optional column in the `SET` clause); it's cut here to keep the write surface exactly as small as the binding decision's literal wording, not because it's hard to add.**

**1. `PATCH /api/admin/ledger/budgets/cause-lines`**

*No `id` in the body → CREATE* (also the entry point for a category's first line, i.e. "entering breakdown mode" — unchanged from B-17):

```
Body: {
  fundId: string; fiscalYear: number; categoryId: string; flow: "income" | "expense";
  cause: string;          // must satisfy isValidBudgetCause()
  label?: string;         // optional, defaults to ''; trimmed + capped at 120 chars server-side
  amountCents: number;    // non-negative integer, required
}
Response 200: { action: "created", lineId: string, cause: string, label: string, categoryTotalCents: number }
Errors: 400 (shape / off-taxonomy cause / bad amount / label > 120 chars after trim),
        404 (fund or category not found),
        409 { error: string, reason: "locked" | "duplicate_cause_label" }
```

Server behavior (inside `db.transaction()`), steps 1-4 identical to B-17's shipped `upsertBudgetCauseLine` (fetch fund+category, `validateBudgetLineInput()`, `isValidBudgetCause(cause)`, `assertBudgetUnlocked()`, resolve/create the parent `ledger_budgets` row via `onConflictDoNothing`), then:

5. Normalize the label (`normalizeBudgetLineLabel()` — trim; reject with 400 if the trimmed length exceeds 120 chars; an all-whitespace input normalizes to `''`, never a "distinct" blank).
6. Check for an existing sibling at `(budgetId, cause, normalizedLabel)` with a `SELECT` — if found, return `409 { reason: "duplicate_cause_label" }` with copy naming the cause and label (e.g. `A line for "Hunger & Basic Needs" with this label already exists — edit it instead.`) **before** attempting the insert. This is a plain `INSERT`, **not** `onConflictDoUpdate` — B-17's shipped upsert silently merged a same-cause write into the existing row, which is exactly the "two distinct lines collapse into one" bug this increment exists to prevent (architect's Phase 2 ruling). The `UNIQUE(budget_id, cause, label)` constraint is defense-in-depth against a race between the `SELECT` and the `INSERT` — catch a unique-violation on the `INSERT` itself and map it to the same `409`/`duplicate_cause_label` response, never a generic 500.
7. Recompute `SUM(amountCents)` over all children for that `budgetId` (unchanged mechanism) and `UPDATE` the parent's `annualAmountCents`.

*`id` present in the body → UPDATE:*

```
Body: { id: string; label?: string; amountCents?: number }   // at least one of label/amountCents required
Response 200: { action: "updated", lineId: string, cause: string, label: string, categoryTotalCents: number }
Errors: 400 (neither label nor amountCents provided / bad amount / label > 120 chars),
        404 (no line with this id),
        409 { error: string, reason: "locked" | "duplicate_cause_label" }
```

Server behavior: fetch the line by `id` → 404 if none → join to its parent `ledger_budgets` row to resolve `entityId`/`fiscalYear` → `assertBudgetUnlocked()` → if `label` is provided, normalize it and (only if it differs from the current value) check for a sibling collision at `(budgetId, cause, normalizedLabel)` **excluding this row's own `id`** → 409 `duplicate_cause_label` if found → `UPDATE ledger_budget_lines SET amountCents = COALESCE($amountCents, amountCents), label = COALESCE($normalizedLabel, label), updatedAt = now() WHERE id = $1` → recompute and persist the parent total (cheap even when only the label changed — no conditional branch to get wrong). One `UPDATE`, no delete, no second row ever created — this is what retires the disclosed B-17 rename failure window.

**2. `DELETE /api/admin/ledger/budgets/cause-lines`**

```
Body: { id: string }
Response 200: { action: "line_deleted", categoryTotalCents: number }
          or: { action: "parent_deleted" }   // this was the last line under the parent budget row
Errors: 404 (no line with this id), 409 { error: string, reason: "locked" }
```

Fetch the line by `id` → 404 if none → resolve parent → `assertBudgetUnlocked()` → delete → zero remaining children → delete the parent `ledger_budgets` row too (`parent_deleted`, unchanged "no target set" invariant); otherwise recompute and return the parent's new total.

**3. `POST /api/admin/ledger/budgets/cause-lines/collapse`** — **unchanged.** Body/response shape identical to B-17 (`{ fundId, fiscalYear, categoryId, flow }` → `{ action: "collapsed", annualAmountCents }`). Deletes every child row for the category regardless of cause or label — grouping is a display concern only, the collapse semantics ("parent total already equals the sum of children going in") don't care how many labels exist per cause.

**4. `POST /api/admin/ledger/budgets/seed`** — **unchanged contract**, one internal fix (see Edge Cases). Seeding stays cause-level-only per binding item Q7 — `deriveCauseSeedLines`/`computeCauseSeedForCategory` are not reworked to a `(cause, label)` grain. Seeded lines land with `label = ''`, i.e. they target the same "generic" slot an existing v1.40.0 row already occupies.

**No new GET route.** Both fund-report pages stay Server Components calling `getFundReport()` directly, extended to return `id`/`label` per line (see Data Model) plus one new, separately-called read function for the label-autocomplete `<datalist>` source (see Component Plan).

## Data Model

**Schema change** — `src/lib/db/schema.ts`, `ledgerBudgetLines`:

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
    // Free-text label distinguishing multiple lines under the same cause
    // (DECISION-047/048). NOT NULL DEFAULT '' — blank is a real, collidable
    // value ("the one generic line per cause"), not an absence. Every
    // pre-existing v1.40.0 row becomes label='' on migration, i.e. it stays
    // that cause's generic line — no functional change to any row that
        // existed before this migration ran.
    label: text("label").notNull().default(""),
    amountCents: integer("amount_cents").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("ledger_budget_lines_budget_cause_label_key").on(t.budgetId, t.cause, t.label),
    index("ix_ledger_budget_lines_budget").on(t.budgetId),
  ],
);
export type LedgerBudgetLine = typeof ledgerBudgetLines.$inferSelect;
export type NewLedgerBudgetLine = typeof ledgerBudgetLines.$inferInsert;
```

**Migration** `drizzle/migrations/0064_ledger_budget_line_labels.sql` — three ordered, individually-guarded statements, safe to replay on every deploy:

```sql
-- 1. Additive column. Fast-default path (constant DEFAULT '' on a NOT NULL
--    text column) — metadata-only on Postgres, no table rewrite, no lock
--    escalation even against the live populated table. This single statement
--    IS the backfill: every existing row becomes label='' the instant the
--    column exists, with zero explicit UPDATE loop.
ALTER TABLE ledger_budget_lines ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '';

-- 2. Drop the old (budget_id, cause) constraint the new, stricter one
--    replaces. Guarded the same way 0063 guards its own constraint add —
--    checked via pg_constraint, not a bare ALTER TABLE, so a replay after
--    the constraint is already gone is a clean no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_budget_lines_budget_cause_key') THEN
    ALTER TABLE ledger_budget_lines DROP CONSTRAINT ledger_budget_lines_budget_cause_key;
  END IF;
END $$;

-- 3. Add the new, wider constraint. Guarded by IF NOT EXISTS so a replay
--    after it's already been added is a clean no-op.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_budget_lines_budget_cause_label_key') THEN
    ALTER TABLE ledger_budget_lines ADD CONSTRAINT ledger_budget_lines_budget_cause_label_key UNIQUE (budget_id, cause, label);
  END IF;
END $$;
```

**Why the swap is provably safe against the live populated table (both dev and production carry v1.40.0 rows):** the *old* `(budget_id, cause)` constraint was continuously enforced for the entire time those rows were written — by definition, no two existing rows share `(budget_id, cause)`. Statement 1 gives every existing row the identical value `label = ''`. A set of rows that's already unique on `(budget_id, cause)` is trivially still unique on the strictly more granular `(budget_id, cause, label)` — adding a column that happens to be constant across the whole set can't create a collision that didn't already exist. There is no window in this three-step sequence where the new constraint could reject a pre-existing row: statement 1 makes every row satisfy it, statement 2 removes the only constraint that could otherwise conflict with statement 3's `ADD CONSTRAINT` attempting to reuse a name, and statement 3 succeeds because the full table already satisfies the constraint it's about to declare.

**Read side** — `FundReportCategoryLine` (`ledger-queries.ts`):

```ts
export type FundReportCategoryLine = {
  // ...unchanged fields (categoryId, categoryName, actualCents, budgetCents, variance, countsAsGiving)
  causeLines: { id: string; cause: string; label: string; amountCents: number }[] | null;
  // id/label are new; null still means lump-sum/no breakdown, never [].
};
```

`getFundReport()`'s existing batched `ledger_budget_lines WHERE budgetId IN (...)` query (no N+1, unchanged) adds `id` and `label` to its `select({...})` projection and to the `causeLinesByBudgetId` map's element shape. `getEntityReport()`'s parallel `causeLines: null` site is untouched (it never surfaces budgets at all).

## Component / Page Plan

**Files to modify:**
- `src/lib/ledger.ts` — add `MAX_BUDGET_LINE_LABEL_LENGTH = 120` and `normalizeBudgetLineLabel(raw: string | undefined | null): string` (trim only; caller decides whether the trimmed result exceeds the max and 400s — this function itself never throws, it's the same "pure helper, DB-touching caller enforces the error" split every other Ledger pure function already uses). No change to `BUDGET_CAUSES`/`OTHER_COMMUNITY_SUPPORT_CAUSE`/`isValidBudgetCause`/`isCauseEligibleCategory`/`sumBudgetCauseLines` — all reused verbatim, cause-vs-label are orthogonal concerns.
- `src/lib/ledger-queries.ts`:
  - Split `upsertBudgetCauseLine` into `createBudgetCauseLine(params, tx)` (plain `INSERT`, duplicate → 409) and `updateBudgetCauseLine(params: { id, label?, amountCents? }, tx)` (single `UPDATE ... WHERE id`).
  - `deleteBudgetCauseLine(id: string, tx)` — re-keyed from the `(fundId, fiscalYear, categoryId, flow, cause)` tuple to a bare `id`.
  - `collapseBudgetCauseLines` — **unchanged**, still tuple-keyed (operates on the whole category, not one line).
  - **Rename the existing cause-keyed upsert to `upsertBudgetCauseLineForSeed(params, tx)`** and keep it exactly as-is (still `onConflictDoUpdate`, still hardcodes `label: ''`) — this is now the *only* caller of an upsert-style write, reserved for the seed route (see Edge Cases for why seeding needs upsert semantics while the interactive route needs insert-or-409 semantics).
  - Add `getBudgetCauseLineLabels(entityId: string, tx: DrizzleTransaction | typeof db = db): Promise<string[]>` — `SELECT DISTINCT label FROM ledger_budget_lines JOIN ledger_budgets ON ... JOIN ledger_funds ON ... WHERE ledger_funds.entity_id = $1 AND label <> '' ORDER BY label`. Entity-scoped (not fund-scoped) — a treasurer typing "WARM" under one fund's category benefits from seeing "WARM" was already used under a sibling fund in the same entity; it's a suggestion list, not a constraint, so a label that doesn't apply to the current fund is harmless if offered.
  - Extend `FundReportCategoryLine`/`getFundReport()` per Data Model.
- `src/app/api/admin/ledger/budgets/cause-lines/route.ts` — PATCH dispatches to `createBudgetCauseLine` (no `id`) or `updateBudgetCauseLine` (`id` present); DELETE takes `{ id }`; both surface `reason` in the JSON error body for the first time (`{ error, reason }`, not just `{ error }`) so the client can distinguish the two 409s.
- `src/app/api/admin/ledger/budgets/cause-lines/collapse/route.ts` — unchanged.
- `src/app/api/admin/ledger/budgets/seed/route.ts` — one-line change: call `upsertBudgetCauseLineForSeed` instead of the now-split `upsertBudgetCauseLine`. No contract change.
- `src/components/admin/ledger/budget-cause-editor.tsx` — substantial rewrite (see below).
- `src/components/admin/ledger/budget-editor.tsx` — thread `id`/`label` through the `causeLines` prop shape; pass a new `labelOptions: string[]` prop down to `BudgetCauseEditor`; the lump→breakdown pre-fill's synthetic row changes from `{ cause, amountCents }` to `{ id: null, cause: OTHER_COMMUNITY_SUPPORT_CAUSE, label: "", amountCents }` — mechanically identical wiring otherwise.
- Both page files (`budgeting/page.tsx`, `[fundSlug]/report/page.tsx`) — thread the extended `causeLines` shape (unchanged mapping otherwise, just more fields); call `getBudgetCauseLineLabels(entityId)` once per page load (not once per fund) and pass the same array to every `BudgetEditor` instance on that page.

**`budget-cause-editor.tsx` rewrite, functional shape:**
- **Row identity moves from `committedCause: string | null` to `id: string | null`.** `id === null` means "never saved" (a fresh add), exactly mirroring B-17's `committedCause` convention but keyed correctly now that cause can repeat.
- **Cause is chosen once, at creation, and is not editable on a committed row** (see API Contract's flagged scope note). A never-saved row shows a cause `<select>` (options = `ALL_CAUSES`, **no exclusion of already-used causes** — dropping B-17's `otherUsed`/`nextUnusedCause` logic entirely, since offering an in-use cause is the entire point of this increment). Once a row commits (first successful `PATCH` with no `id` → response includes the new `id`), its cause becomes a plain label in the grouped display, not a control.
- **Free-text label**: every row (pending or committed) gets a text `<input list={datalistId} maxLength={120} placeholder="Label (optional)">` bound to a per-editor-instance `<datalist id={datalistId}>` populated from the `labelOptions` prop. Editing a committed row's label re-uses the existing `dirtyRef`/blur-or-Enter commit pattern (calls `PATCH` with `{ id, label }`), same as the amount field.
- **Grouped display**: rows are bucketed by `cause` for rendering (a `Map<cause, Row[]>` built via `reduce`, iterated in canonical `ALL_CAUSES` order — not insertion order — so the grouping is stable across re-renders/reloads). Each group renders: a cause header, a per-cause subtotal (`sumBudgetCauseLines` over that group's rows — same pure helper, just called once per group instead of once for the whole category), then its member rows (label input + amount input + remove button — no cause select, since cause is now structural). The category total (unchanged, sum over every row regardless of group) renders once, below all groups, exactly where B-17's single "Category total" line was.
- **Add**: one "+ Add line" control below all groups appends a fresh pending row (`id: null`, `cause: BUDGET_CAUSES[0]`, `label: ""`, `value: ""`) with its own cause `<select>` — no per-group "add to this cause" shortcut required for this increment (ux-developer may add one as a low-cost ergonomic improvement; not a functional requirement).
- **Remove**: unchanged `ConfirmDialog` precedent (non-zero amount gated, $0/never-saved rows removed immediately), now calling `DELETE { id }` for committed rows.
- **Collapse to lump sum**: unchanged control and copy, still tuple-keyed (`POST .../collapse`), still deletes every row in the category regardless of grouping.
- **Mobile (360px)**: each row is now *simpler* than B-17's shipped row for committed lines (label input + amount input + remove button — no select), which eases the Gap 9 density concern for the common case; the "+ Add line" pending row remains the densest (select + label + amount + remove), same class of density B-17 already shipped and qa already verified at 360px. Still must stack (`flex-col … sm:flex-row`), not overflow.

No new pages.

## Implementation Order

1. **Schema** — `label` column + constraint rename in `src/lib/db/schema.ts`, then `drizzle/migrations/0064_ledger_budget_line_labels.sql`.
2. **Pure helpers** — `MAX_BUDGET_LINE_LABEL_LENGTH`, `normalizeBudgetLineLabel()` in `src/lib/ledger.ts`.
3. **Query functions** — split `createBudgetCauseLine`/`updateBudgetCauseLine`, re-key `deleteBudgetCauseLine` to `id`, rename the seed-only upsert to `upsertBudgetCauseLineForSeed` (fix its collision-detection query per Edge Cases), add `getBudgetCauseLineLabels()`, extend `FundReportCategoryLine`/`getFundReport()` in `src/lib/ledger-queries.ts`.
4. **Routes** — `PATCH`/`DELETE .../cause-lines` id-dispatch + `reason` in error bodies; one-line update to `.../budgets/seed/route.ts`'s call site; `.../cause-lines/collapse/route.ts` untouched.
5. **UI** — `budget-cause-editor.tsx` rewrite, `budget-editor.tsx` prop threading, both page files' `getBudgetCauseLineLabels()` call + mapping.
6. **Unit tests** — every test named below, written by the implementer(s), not qa.
7. **Release notes entry** — tech-lead, at Phase 6 SHIP IT.

No email notifications apply (planning-only, same as B-17).

## Edge Cases & Risks

- **Constraint swap on populated dev/prod data** — proven safe above (Data Model); flagging again here because it's the single riskiest line in the migration and the proof depends on the *old* constraint having actually been enforced continuously, which it has (shipped v1.40.0, no direct-SQL bypass of the write path exists).
- **Duplicate `(cause, label)` including two blank labels** — enforced by `SELECT`-then-`INSERT` in `createBudgetCauseLine`, with the DB constraint as race defense-in-depth; both paths map to the same `409 { reason: "duplicate_cause_label" }`.
- **Editing a label into a collision** — `updateBudgetCauseLine` must check `(budgetId, cause, newLabel)` **excluding the row's own `id`** before writing, or a treasurer renaming line A's label to match line B's would either silently violate the constraint (500) or (worse, if the check were written wrong) match against itself and always report "no collision." Needs an explicit `id <> $self` clause in the collision `SELECT`.
- **Locked-budget writes** — all three write paths (`create`, `update`, `delete`) resolve their budget row's `(entityId, fiscalYear)` (directly for create, via a join for update/delete) and call `assertBudgetUnlocked()` before any write, returning `409 { reason: "locked" }` — the client must show a different toast for `locked` vs `duplicate_cause_label` (Phase 1 Flow 1's stated requirement), not a generic "save failed."
- **Lump→breakdown auto-line coexisting with labeled siblings** — the `OTHER_COMMUNITY_SUPPORT_CAUSE` pre-fill row still lands as `label: ''` (the generic line), and per DECISION-047/048's "no special-casing," a treasurer can freely add labeled siblings under that same pseudo-cause afterward through the identical `createBudgetCauseLine` path any other cause uses.
- **Label whitespace normalization** — `normalizeBudgetLineLabel()` trims edges only (does not collapse internal whitespace or case-fold); `" WARM "` and `"WARM"` are treated as the same value for uniqueness (both normalize to `"WARM"`), but `"WARM"` and `"Warm"` remain distinct on purpose — this is free text, not a second controlled taxonomy, and over-normalizing would silently merge two treasurer-intended labels that happen to differ only in case.
- **Seeding stays cause-level-only, but its collision check needs a one-line fix.** `computeCauseSeedForCategory()`'s `existingCauseAmountMap` (used to flag `collision: true`/decide fill-empty vs. skip) is currently built from every existing child row for a category. Under the new model, a cause can have a labeled sibling (e.g. "WARM") with **no** blank-label line yet — that cause is *not* "already covered" from the seed's point of view, because seeding only ever targets the generic (`label: ''`) slot. `existingCauseAmountMap` must therefore be built by **filtering to rows where `label === ''`** before the map is constructed; otherwise `fill-empty` mode would wrongly skip seeding a cause's generic line just because a treasurer had already added an unrelated labeled line under it. This is a required, surgical fix inside `computeCauseSeedForCategory`, not a scope change — seeding's grain and UX are untouched.
- **`upsertBudgetCauseLineForSeed`'s conflict target must widen to three columns.** Its `onConflictDoUpdate({ target: [...] })` moves from `[budgetId, cause]` to `[budgetId, cause, label]` to match the new constraint — mechanically required regardless of the collision-map fix above, since it always writes `label: ''` explicitly and the constraint it's upserting against now has three columns.
- **Transactional parent-total rollup with multiple same-cause children** — unchanged mechanism (every write re-reads **all** children for the `budgetId` and recomputes `SUM(amountCents)`, never an incremental `+=`) and still holds with N labeled siblings per cause exactly as it held with N different causes in B-17 — the rollup was never cause-aware to begin with, so this increment introduces zero new risk here.
- **No in-place cause change on a committed row** (flagged above, in API Contract) — a deliberate scope cut, explicitly surfaced to the user before Phase 4.
- **Seeding's existing scope-tightening from B-17 (cause-line proposals only for categories with a top-level seed line; `fill-empty` + `seedCauseLines` can still convert a lump-sum category into a breakdown) is unaffected by this increment** — both are B-17 behaviors this design doesn't touch.

## Unit Tests to Write in Phase 4

Named per the task brief, plus the mechanical carry-forwards from B-17's own suite that need updating for the renamed/split functions:

1. **Uniqueness on `(cause, label)` including two-blank collision** — `createBudgetCauseLine` twice with the same `(cause, label: '')` → second call returns `409 { reason: "duplicate_cause_label" }`, no second row written; the same cause with two *different* labels both succeed as distinct rows.
2. **Label trim/normalization** — `normalizeBudgetLineLabel(" WARM ")` → `"WARM"`; an all-whitespace input → `""`; a 121-character input is rejected 400 by the route/query layer (the pure helper itself doesn't throw — the caller enforces the cap, per its own doc comment).
3. **id-keyed update changes amount without touching cause/label, and vice versa** — `updateBudgetCauseLine({ id, amountCents })` leaves `cause`/`label` unchanged; `updateBudgetCauseLine({ id, label })` leaves `amountCents`/`cause` unchanged.
4. **Delete-by-id leaves siblings** — deleting one line under a cause with two labeled siblings returns `action: "line_deleted"` (not `"parent_deleted"`) and the remaining sibling's row and the parent's recomputed total are both intact.
5. **Multi-same-cause parent-total rollup** — `createBudgetCauseLine` twice under the same cause with different labels; the parent `ledger_budgets.annualAmountCents` equals the sum of both, not just the most recent write.
6. **The two 409 reason codes** — `createBudgetCauseLine`/`updateBudgetCauseLine`/`deleteBudgetCauseLine` against a locked `(entityId, fiscalYear)` fixture each return `{ reason: "locked" }`; `createBudgetCauseLine`/`updateBudgetCauseLine` against a duplicate `(cause, label)` fixture each return `{ reason: "duplicate_cause_label" }` — asserting the discriminator field itself, not just the 409 status, since the client dispatches its toast copy off `reason`.
7. **Seed collision-map fix** — `computeCauseSeedForCategory()` against a fixture where a cause has one labeled (non-blank) existing line and zero blank-label lines returns that cause as `collision: false` (still proposable), not `true`.
8. **`upsertBudgetCauseLineForSeed` conflict target** — a second seed write to the same `(fundId, fiscalYear, categoryId, flow, cause)` updates the existing `label: ''` row rather than violating the constraint or creating a duplicate.
9. **Migration idempotency reasoning — documented, not code-tested** (DB DDL has no unit-test harness in this codebase). The Phase 4 database-admin should carry the "old constraint's continuous enforcement guarantees the new one is already satisfied" proof from this doc's Data Model section into the migration file's own header comment, mirroring how `0063`/prior migrations document their own safety reasoning inline.
10. **Regression carry-forwards** — existing B-17 tests referencing the old cause-keyed `upsertBudgetCauseLine`/`deleteBudgetCauseLine` signatures must be updated to call the new `createBudgetCauseLine`/`updateBudgetCauseLine`/`deleteBudgetCauseLine(id, tx)` functions; `isValidBudgetCause`/`isCauseEligibleCategory`/`sumBudgetCauseLines`/`deriveCauseSeedLines`/`OTHER_COMMUNITY_SUPPORT_CAUSE` byte-identity tests are unaffected and must still pass unchanged.

## Implementer

**Specialist split — database-admin → api-developer → ux-developer**, sequentially, mirroring B-17 Increment A exactly (CLAUDE.md reserves full-stack-developer for work small enough that a handoff adds more overhead than it removes; this touches a schema/constraint swap on a populated table, a split write-function API, and a component rewrite — well past that threshold).

1. **database-admin** — `label` column + constraint rename in `schema.ts`; `drizzle/migrations/0064_ledger_budget_line_labels.sql`.
2. **api-developer** — `normalizeBudgetLineLabel()`/`MAX_BUDGET_LINE_LABEL_LENGTH` in `ledger.ts`; the `createBudgetCauseLine`/`updateBudgetCauseLine`/`deleteBudgetCauseLine(id)`/`upsertBudgetCauseLineForSeed`/`getBudgetCauseLineLabels` split in `ledger-queries.ts` (incl. the seed collision-map fix); the `FundReportCategoryLine`/`getFundReport()` extension; the id-dispatching `PATCH`/`DELETE` route + the seed route's one-line call-site update; all 10 named tests above.
3. **ux-developer** — `budget-cause-editor.tsx` rewrite (grouped display, `<datalist>`, id-keyed ops, dropped cause select on committed rows); `budget-editor.tsx` prop threading; both page files' `getBudgetCauseLineLabels()` wiring; mobile pass at 360px (lower risk than B-17's, since committed rows lost a field).

---

> **Human decision (Chris, 2026-07-28):** In-place cause editing is intentionally NOT carried
> forward — a line's cause is fixed at creation; changing it = delete + recreate (both existing
> operations). Accepted as designed. The per-row cause `<select>` from v1.40.0 is dropped on
> committed rows. (The tech-lead's other two flagged items — the seed collision-map `label=''`
> filter, and entity-scoped datalist autocomplete — were design decisions, not user calls, and
> stand as written in DECISION-048.)

# Phase 4 — Implementation

## Phase 4 — Implementation (schema) — 2026-07-28

**Owner:** database-admin
**Status:** complete

### Summary

Added the `label` column and swapped `ledgerBudgetLines`' unique constraint from `(budgetId, cause)` to `(budgetId, cause, label)`, exactly per DECISION-047/048 and the Phase 3 Data Model section. This is schema-only — no query/route/UI changes, which are api-developer's and ux-developer's steps next.

### What I did

- Read the Phase 3 design section of this work-log, DECISION-047 and DECISION-048, the live `ledgerBudgetLines` definition (`src/lib/db/schema.ts` L805-821, pre-change), and both `drizzle/migrations/0063_ledger_budget_lines.sql` and `0062_ledger_budget_approvals.sql` to mirror the exact idempotent guard style.
- Confirmed `0064` is free (`ls drizzle/migrations/*.sql | sort | tail -3` → highest existing is `0063`).
- Added `label: text("label").notNull().default("")` to `ledgerBudgetLines` in `src/lib/db/schema.ts`, with the same doc-comment reasoning the design doc specifies (blank is a real, collidable value; existing rows backfill to `''` and remain each cause's generic line).
- Renamed the unique constraint from `ledger_budget_lines_budget_cause_key` to `ledger_budget_lines_budget_cause_label_key`, widened to `(t.budgetId, t.cause, t.label)`. Left the `ix_ledger_budget_lines_budget` index on `budgetId` untouched.
- Wrote `drizzle/migrations/0064_ledger_budget_line_labels.sql`: (1) `ALTER TABLE ... ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT ''` (metadata-only fast-default path — no table rewrite, doubles as the backfill), (2) drop the old constraint guarded by a `pg_constraint` `IF EXISTS` check, (3) add the new constraint guarded by a `pg_constraint` `IF NOT EXISTS` check — mirroring 0063's exact guard idiom. Included the "old constraint's continuous enforcement guarantees the new one is already satisfied" proof as an inline comment, per the design doc's instruction.
- Ran `pnpm exec tsc --noEmit` — clean, no errors.
- Did **not** run `pnpm db:push` or apply the migration to any database, and did not touch version/release notes, per task scope.

### Outputs

- `src/lib/db/schema.ts` — `ledgerBudgetLines`: new `label` column, constraint renamed and widened (see exact lines below).
- `drizzle/migrations/0064_ledger_budget_line_labels.sql` — new file, 3 idempotent statements (column add, guarded constraint drop, guarded constraint add).
- Tables affected: `ledger_budget_lines` only (column + constraint change; no new table).
- No role bindings / seed rows — this increment introduces no new `FEATURES` key (unchanged from Phase 1/2/3).
- Local apply command (not run, per scope): `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`, then `pnpm db:push` since `schema.ts` also changed.

### Implementer Notes

No conventions needed reconciling — this table's existing style (plain `unique()` builder, no CHECK constraint on `cause`, matching `0063`'s guard idiom) extended cleanly to the three-column constraint. The fast-default path (`ADD COLUMN ... NOT NULL DEFAULT ''` where the default is a constant) is metadata-only on Postgres — no table rewrite, no long lock — confirmed this is the same mechanism the design doc and DECISION-047 both call out, not a new claim I'm introducing. The migration's safety proof (old constraint's continuous enforcement ⇒ new constraint is already satisfied by every pre-existing row) is written into the SQL file itself as a comment, not just this work-log, so it survives independently of the doc.

### Open questions / handoff notes

- **New column for api-developer:** `label: text("label").notNull().default("")` on `ledgerBudgetLines` — always a string, never null; `''` means "the generic/unlabeled line for this cause."
- **Constraint name to expect:** `ledger_budget_lines_budget_cause_label_key`, UNIQUE on `(budget_id, cause, label)`. The old `ledger_budget_lines_budget_cause_key` on `(budget_id, cause)` no longer exists after this migration runs.
- **Per DECISION-048: `createBudgetCauseLine` must be a plain `INSERT`, not `onConflictDoUpdate`.** The old upsert pattern would silently merge two distinct, differently-labeled lines together the moment a duplicate `(cause, label)` was submitted — exactly the bug this increment exists to prevent. Do a `SELECT`-then-`INSERT` (409 `duplicate_cause_label` on collision), with the new DB constraint as race-condition defense-in-depth (catch the unique-violation and map it to the same 409). The seed-only path (`upsertBudgetCauseLineForSeed`) is the sole exception — it keeps upsert semantics but its `onConflictDoUpdate` target must widen to `[budgetId, cause, label]` (always writing `label: ''`) to match the new constraint shape.
- Next agent: **api-developer** — pure helpers in `src/lib/ledger.ts` (`MAX_BUDGET_LINE_LABEL_LENGTH`, `normalizeBudgetLineLabel()`), then the query/route split in `src/lib/ledger-queries.ts` and `src/app/api/admin/ledger/budgets/cause-lines/route.ts` per the Phase 3 API Contract and Component/Page Plan sections above.

---

## Phase 4 — Implementation (API) — 2026-07-28

**Owner:** api-developer
**Status:** complete

### Summary

Implemented the full id-keyed write model per DECISION-047/048: `createBudgetCauseLine` (plain INSERT, pre-check + race-catch duplicate detection), `updateBudgetCauseLine` (single `UPDATE ... WHERE id` for amount and/or label), `deleteBudgetCauseLine(id, tx)`, and the seed-only `upsertBudgetCauseLineForSeed` (upsert semantics retained, conflict target widened to 3 columns). Added the pure `normalizeBudgetLineLabel()`/`MAX_BUDGET_LINE_LABEL_LENGTH` helpers, fixed `computeCauseSeedForCategory`'s collision-map to count only `label=''` rows, extended `getFundReport()`'s `causeLines` with `id`/`label`, added `getBudgetCauseLineLabels()` for the datalist, and rewrote the `PATCH`/`DELETE /api/admin/ledger/budgets/cause-lines` route to dispatch on `id` presence with both 409 reason codes on the wire. All 10 named unit tests from the Phase 3 design are written and passing, plus regression carry-forwards for the renamed/split functions.

### What I did

- Read the full Phase 1-3 work-log sections, DECISION-047/048, the database-admin Phase 4 handoff notes, and the live `ledger.ts`/`ledger-queries.ts`/route files before writing any code.
- **`src/lib/ledger.ts`:** added `MAX_BUDGET_LINE_LABEL_LENGTH = 120` and `normalizeBudgetLineLabel(raw)` (trim-only; null/undefined/whitespace-only → `""`; never throws — the DB-touching caller enforces the length cap, mirroring `validateBudgetLineInput`'s established split). Left `BUDGET_CAUSES`/`OTHER_COMMUNITY_SUPPORT_CAUSE`/`isValidBudgetCause`/`isCauseEligibleCategory`/`sumBudgetCauseLines`/`deriveCauseSeedLines` untouched — cause and label are orthogonal concerns.
- **`src/lib/ledger-queries.ts`:**
  - Split the old cause-keyed `upsertBudgetCauseLine` into `createBudgetCauseLine` (plain `INSERT`, pre-check `SELECT` for an existing `(budgetId, cause, normalizedLabel)` sibling → 409 `duplicate_cause_label` before ever attempting the insert; a thrown `23505` on the insert itself — the race window between the pre-check and the write — is caught via a local `pgErrorCode()` helper (mirrors the existing pattern in `.../reconciliation/sessions/[sessionId]/match/route.ts`) and mapped to the identical 409) and `updateBudgetCauseLine` (fetches the line by `id`, joins to its parent for the lock check, applies `amountCents`/`label` independently via `COALESCE`-style optional fields, and — only when the label actually changes — re-checks `(budgetId, cause, newLabel)` **excluding the row's own id** before writing; same race-catch on the `UPDATE` itself).
  - `deleteBudgetCauseLine` re-keyed from the `(fundId, fiscalYear, categoryId, flow, cause)` tuple to a bare `id`: fetch → resolve parent/fund → lock check → delete → recompute-or-delete-parent, unchanged in every other respect.
  - Renamed the old function to `upsertBudgetCauseLineForSeed`, kept it byte-for-byte the same shape (still `onConflictDoUpdate`, still hardcodes `label: ""`), only widening its conflict target from `[budgetId, cause]` to `[budgetId, cause, label]` to match the new 3-column constraint.
  - **Seed collision-map fix:** `computeCauseSeedForCategory`'s `existingCauseAmountMap` build now filters to `eq(ledgerBudgetLines.label, "")` at the SQL level — a cause with only a labeled sibling (e.g. "WARM") is no longer treated as "already covered," so `fill-empty` mode still proposes that cause's generic line.
  - Added `getBudgetCauseLineLabels(entityId, tx = db)` — `selectDistinct` over `ledger_budget_lines` joined through `ledger_budgets`/`ledger_funds`, filtered to non-empty labels for the given entity, ordered alphabetically.
  - Extended `FundReportCategoryLine.causeLines` to `{ id, cause, label, amountCents }[] | null` and threaded `id`/`label` through `getFundReport()`'s batched cause-line query and its per-budget map — still one query, no N+1.
- **Routes:**
  - Rewrote `PATCH /api/admin/ledger/budgets/cause-lines` to dispatch on `id` presence in the body: no `id` → validates and calls `createBudgetCauseLine`; `id` present → validates (`label`/`amountCents` optional, at least one required, both type-checked) and calls `updateBudgetCauseLine`. Both branches surface `reason` in the JSON error body (`{ error, reason }`) whenever the query layer sets one, alongside the existing `{ error }`-only shape for plain 400/404s.
  - Rewrote `DELETE` to take `{ id }` and call `deleteBudgetCauseLine(id, tx)`; surfaces `reason: "locked"` the same way.
  - `collapse/route.ts` — untouched, per the design (still tuple-keyed, semantics unaffected).
  - `seed/route.ts` — one-line call-site rename (`upsertBudgetCauseLine` → `upsertBudgetCauseLineForSeed`) plus the matching import rename; response shape unchanged.
- **Tests:**
  - `src/lib/ledger.test.ts` — 5 new tests for `normalizeBudgetLineLabel` (trim equivalence, all-whitespace → `""`, null/undefined → `""`, no case-folding, no throw on an over-length input).
  - `src/lib/ledger-queries.test.ts` — full rewrite of the mock-tx harness (kept hermetic via the existing `vi.mock("@/lib/db")`) to cover: `createBudgetCauseLine` uniqueness incl. two-blank collision and the race-catch path, label-length 400, lock 409; `updateBudgetCauseLine` amount-only vs. label-only independence, label-collision-excluding-self 409, lock 409, 404, "neither field provided" 400; `deleteBudgetCauseLine` lock 409, parent-delete-on-empty, delete-leaves-siblings-with-correct-rollup, 404; `upsertBudgetCauseLineForSeed` conflict-target-widened-to-3-columns re-run behavior, lock 409; `collapseBudgetCauseLines` unchanged carry-forward; `computeCauseSeedForCategory`'s label='' collision-map fix; the pre-existing `upsertBudgetLine` cause-line-aware-guard regression tests carried forward unchanged.
- Ran `pnpm exec tsc --noEmit` (clean) and `unset DATABASE_URL DB_URL; pnpm test` (578 passed, up from 561 — 17 new tests: 5 in `ledger.test.ts`, 12 net new in `ledger-queries.test.ts` after accounting for the split/renamed functions replacing the old 11).
- Did **not** run `pnpm db:push`/migrations, bump the version, or touch release notes, per task scope.

### Outputs

**Route: `PATCH /api/admin/ledger/budgets/cause-lines`** (`src/app/api/admin/ledger/budgets/cause-lines/route.ts`) — gate: `auth()` + `hasFeature(LEDGER_MANAGE)`.

- No `id` in body → CREATE:
  ```
  Body: { fundId, fiscalYear, categoryId, flow: "income"|"expense", cause, label?: string, amountCents: number }
  200: { action: "created", lineId, cause, label, categoryTotalCents }
  400: off-taxonomy cause / bad amount / label > 120 chars after trim / bad shape
  404: fund or category not found
  409: { error, reason: "locked" | "duplicate_cause_label" }
  ```
- `id` present → UPDATE (at least one of `label`/`amountCents` required; cause is NOT editable — DECISION-048 item 2):
  ```
  Body: { id, label?: string, amountCents?: number }
  200: { action: "updated", lineId, cause, label, categoryTotalCents }
  400: neither field provided / bad amount / label > 120 chars
  404: no line with this id
  409: { error, reason: "locked" | "duplicate_cause_label" }
  ```

**Route: `DELETE /api/admin/ledger/budgets/cause-lines`** — gate: same.
```
Body: { id }
200: { action: "line_deleted", categoryTotalCents } | { action: "parent_deleted" }
404: no line with this id
409: { error, reason: "locked" }
```

**Route: `POST /api/admin/ledger/budgets/cause-lines/collapse`** — unchanged, not touched this phase.

**Route: `POST /api/admin/ledger/budgets/seed`** — unchanged response contract; internal call-site renamed to `upsertBudgetCauseLineForSeed`.

**`src/lib/ledger-queries.ts` exported symbols (new/changed):**
- `createBudgetCauseLine(params: { fundId, fiscalYear, categoryId, flow, cause, label?, amountCents }, tx: DrizzleTransaction): Promise<CreateBudgetCauseLineResult>`
- `updateBudgetCauseLine(params: { id, label?, amountCents? }, tx: DrizzleTransaction): Promise<UpdateBudgetCauseLineResult>`
- `deleteBudgetCauseLine(id: string, tx: DrizzleTransaction): Promise<DeleteBudgetCauseLineResult>` — **signature changed** from the old `(params, tx)` tuple form.
- `upsertBudgetCauseLineForSeed(params: { fundId, fiscalYear, categoryId, flow, cause, amountCents }, tx: DrizzleTransaction): Promise<UpsertBudgetCauseLineForSeedResult>` — seed-route-only, hardcodes `label: ""`.
- `getBudgetCauseLineLabels(entityId: string, tx?: DrizzleTransaction | typeof db): Promise<string[]>` — new, for the `<datalist>`.
- `collapseBudgetCauseLines` — unchanged.
- `FundReportCategoryLine.causeLines: { id: string; cause: string; label: string; amountCents: number }[] | null` — `id`/`label` are new fields; `getFundReport()` populates both.
- **Removed:** `upsertBudgetCauseLine` (renamed/split — no longer exists under that name).

**Two 409 reason codes**, both on the wire as `{ error: string, reason: "locked" | "duplicate_cause_label" }`:
- `"locked"` — from `create`, `update`, `delete` (and the seed path, unsurfaced to the client but present internally).
- `"duplicate_cause_label"` — from `create` and `update` only (a delete can never collide).

**Schema:** no changes this phase — database-admin's `label`/constraint work (migration `0064_ledger_budget_line_labels.sql`) was already complete when I started.

### Implementer Notes

- **Create/update/delete dispatch:** the route's `PATCH` handler branches purely on `body.id !== undefined` — no `id` means "this is a brand-new line" (including a category's first line / entering breakdown mode, unchanged from B-17), `id` present means "edit this exact row." This mirrors DECISION-048 item 1 exactly: one route, one verb per branch, no third endpoint.
- **Pre-check-plus-race-catch collision handling:** both `createBudgetCauseLine` and `updateBudgetCauseLine` run a same-transaction `SELECT` for the sibling collision *before* attempting the write — this is what produces a clean `409` in the overwhelming common case with a specific, cause-naming error message. The `UNIQUE(budget_id, cause, label)` constraint is defense-in-depth for the narrow race between that `SELECT` and the `INSERT`/`UPDATE` — a thrown `23505` (extracted via a local `pgErrorCode()` helper that unwraps Drizzle's `.cause` wrapping, copied from the existing pattern in the reconciliation-match route) is caught and mapped to the *identical* `duplicate_cause_label` response body, so the client never sees a different shape depending on which of the two paths caught the collision.
- **Seed collision-map fix:** `computeCauseSeedForCategory` used to build its `existingCauseAmountMap` from every existing child row for a category — under the new model that would wrongly treat a cause as "already covered" the moment ANY labeled sibling existed. The fix adds `eq(ledgerBudgetLines.label, "")` to that one `SELECT`'s `WHERE` clause, so only the generic/unlabeled row (the only slot seeding ever targets) counts toward the collision map. Covered by its own named test.
- **Parent-total integrity with multiple same-cause children:** unchanged mechanism from B-17 — every write (`create`, `update`, `delete`) re-reads **all** children for the `budgetId` after the write and recomputes `SUM(amountCents)` fresh, never an incremental `+=`. This was already cause-agnostic in B-17 (it just summed whatever rows existed) so N labeled siblings per cause introduce zero new risk; the "multi-same-cause parent-total rollup" test asserts this directly by creating two lines under the same cause with different labels and checking the parent total equals both summed, not just the latest write.
- Both `pgErrorCode()` (local to `ledger-queries.ts`, module-private) and `duplicateCauseLabelResult()` (a tiny shared response-builder used by both `createBudgetCauseLine` and `updateBudgetCauseLine`) exist so the two callers can never drift in error copy or status/reason shape.

### Open questions / handoff notes

- **Next agent: `ux-developer`.** The API contract above is ready to consume. Specifically needed:
  - `budget-cause-editor.tsx` rewrite: row identity moves from `committedCause: string | null` to `id: string | null`; drop the `otherUsed`/`nextUnusedCause` cause-exclusion logic entirely (offering an already-used cause is now the point); cause `<select>` only renders on never-saved (`id === null`) rows — a committed row's cause becomes a plain label, not editable in place (per DECISION-048 item 2 — moving a line to a different cause is DELETE + CREATE, both already-existing calls); grouped-by-cause display (cause header → labeled sub-lines → per-cause subtotal → category total, per Human Answer Q6) is a client-side `reduce` over the flat `causeLines` array, iterated in `BUDGET_CAUSES` canonical order for render stability.
  - `budget-editor.tsx`: thread `id`/`label` through the `causeLines` prop shape (currently typed narrower, at `{ cause, amountCents }[]`, in both `budget-editor.tsx` and `guided-budget-setup.tsx` — these need widening to match the new `FundReportCategoryLine.causeLines` shape); the lump→breakdown pre-fill row becomes `{ id: null, cause: OTHER_COMMUNITY_SUPPORT_CAUSE, label: "", amountCents }`.
  - Both page files (`budgeting/page.tsx`, `[fundSlug]/report/page.tsx`) need a `getBudgetCauseLineLabels(entityId)` call (once per page load, not once per fund) threaded down as a `labelOptions: string[]` prop for the `<datalist>`.
  - Free-text label input: `<input list={datalistId} maxLength={120} placeholder="Label (optional)">` per row, bound to a per-editor-instance `<datalist>`; committing a label edit calls `PATCH { id, label }` via the existing blur/Enter commit pattern (same as the amount field).
  - `ConfirmDialog` removal flow, `collapse` control, and mobile stacking pattern all carry forward unchanged from B-17.
- No schema changes needed from here — database-admin's work is already in place and untouched by this phase.
- `getBudgetCauseLineLabels` itself has no dedicated unit test (it's a straightforward pass-through `selectDistinct` query, not named in the Phase 3 test list) — flagging in case qa wants to add one at the query layer or exercise it via an integration/click-through instead.

---

## Phase 4 — Implementation (UI) — 2026-07-28

**Owner:** ux-developer
**Status:** complete

### Summary

Rewrote `budget-cause-editor.tsx` to the grouped-by-cause display and id-keyed
in-place edits DECISION-047/048 require: rows are keyed by their own `id`
(`null` = never saved), a committed row has no cause `<select>` (cause is a
group header, not a per-row control), a free-text label `<input list>` bound
to a per-instance `<datalist>` replaces nothing (this is new), and amount/label
edits both collapse to a single `PATCH { id, ... }` — the old
delete-then-recreate cause-rename path is gone entirely, along with the
`otherUsed`/`nextUnusedCause` exclusion logic. Threaded the widened
`{ id, cause, label, amountCents }` `causeLines` shape through
`budget-editor.tsx` and `guided-budget-setup.tsx`, and wired
`getBudgetCauseLineLabels(entityId)` into both `budgeting/page.tsx` and
`[fundSlug]/report/page.tsx` so every `BudgetCauseEditor` instance gets the
autocomplete data.

### What I did

- Read the full Phase 1–3 design (this work-log), DECISION-047/048, and the
  api-developer Phase 4 handoff notes before touching any component. Read the
  live `cause-lines/route.ts` to confirm exact request/response shapes
  (`{ action, lineId, cause, label, categoryTotalCents }` on create/update;
  `{ error, reason }` on 409/400) and `ledger-queries.ts`'s
  `getBudgetCauseLineLabels(entityId, tx?)` signature.
- **`src/components/admin/ledger/budget-cause-editor.tsx`** — full rewrite:
  - `Row` keyed by `id: string | null` (was `committedCause: string | null`).
  - Dropped `otherUsed`/`nextUnusedCause` entirely — offering an already-used
    cause is now the point, per DECISION-048 item 1's dropped exclusion.
  - Grouped-by-cause render: rows bucketed into a `Map<cause, number[]>` of
    row indices, iterated in canonical `ALL_CAUSES` order (any off-taxonomy
    cause — shouldn't happen, `isValidBudgetCause` gates every write — still
    renders, appended defensively rather than silently dropped). Each group
    renders a header (cause name) + a per-cause subtotal
    (`sumBudgetCauseLines` called once per group) + its member rows nested
    under a left border, then the category total renders once below all
    groups (`sumBudgetCauseLines` over every row, unchanged mechanism).
  - Per-row free-text label `<input list={datalistId} maxLength={120}>`,
    `placeholder="(generic)"` when blank — this is what renders an unlabeled
    line as "(generic)" per the task's requirement — bound to a
    per-editor-instance `<datalist>` populated from the `labelOptions` prop.
  - Committed rows (`id !== null`) show a bullet (`&bull;`) instead of a
    cause `<select>` — cause is fixed at creation (DECISION-048 item 2).
    Never-saved rows (`id === null`) keep a cause `<select>`, scoped to that
    row only, with no exclusion — changing it just re-groups the row locally
    (`handlePendingCauseChange`, no network call, mirrors the old pending
    branch of `handleCauseChange`).
  - `commitRow(index)` dispatches on `row.id`: `null` → `commitCreate` (first
    commit = the create call, unchanged trigger — blur/Enter on either the
    label or amount field); non-null → `commitUpdate`, which tracks two
    independent dirty flags (`dirtyAmountRef`, `dirtyLabelRef`) and sends only
    the field(s) actually touched in one `PATCH { id, amountCents?, label? }`
    — this is the in-place edit that retires the delete+recreate rename hack.
  - `describeWriteError()` reads `{ error, reason }` and forwards the server's
    already-specific message (`A line for "<cause>" with this label already
    exists — edit it instead.` / `This budget is locked. Unlock it to make
    changes.`) with a reason-keyed fallback for a malformed/missing body —
    the server text already distinguishes the two 409s, so the client just
    needs to not clobber it with a generic message.
  - `ConfirmDialog` remove flow now sends `DELETE { id }`; collapse flow
    unchanged (still tuple-keyed, still deletes every row in the category
    regardless of grouping).
  - "+ Add line" (renamed from "+ Add cause") appends `{ id: null, cause:
    BUDGET_CAUSES[0], label: "", value: "" }` — no `usedCauses.size >=
    ALL_CAUSES.length` disable guard anymore (that guard existed only because
    causes used to be exclusive; a cause can repeat now, so there's no
    "all causes taken" state to guard against).
- **`src/components/admin/ledger/budget-editor.tsx`**:
  - `BudgetLine.causeLines` widened from `{ cause, amountCents }[] | null` to
    `BudgetCauseLine[] | null` (imported from the editor — `{ id, cause,
    label, amountCents }`).
  - Added `labelOptions?: string[]` prop, threaded straight into
    `BudgetCauseEditor`.
  - The lump→breakdown pre-fill row changed from `{ cause:
    OTHER_COMMUNITY_SUPPORT_CAUSE, amountCents }` to `{ id: null, cause:
    OTHER_COMMUNITY_SUPPORT_CAUSE, label: "", amountCents }` — no
    special-casing beyond the shape widening, per DECISION-047/048's "no
    special-casing" ruling.
- **`src/components/admin/ledger/guided-budget-setup.tsx`**: `FundSetupItem.budgetEditorLines[].causeLines` widened to `BudgetCauseLine[] | null`; added `labelOptions?: string[]` to `GuidedBudgetSetupProps`, threaded into every `<BudgetEditor>` instance the component renders (one per fund).
- **Both page files** (`budgeting/page.tsx`, `[fundSlug]/report/page.tsx`): added a `getBudgetCauseLineLabels(entity.id)` call — once per page load in each file, not once per fund, run in parallel with the existing `Promise.all` fetches — and threaded the result down as `labelOptions` to `GuidedBudgetSetup`/`BudgetEditor` respectively.
- Ran `pnpm exec tsc --noEmit` (clean), `unset DATABASE_URL DB_URL; pnpm test` (578 passed, unchanged from api-developer's phase — no new tests added, see note below), and `pnpm build:only` (clean production build, all routes compiled).
- Did **not** bump the version, touch release notes, run `db:push`/migrations, or commit, per task scope.

### Outputs

- `src/components/admin/ledger/budget-cause-editor.tsx` — full rewrite (grouped display, id-keyed ops, datalist, dropped cause-exclusion logic). Now exports `BudgetCauseLine` (`{ id: string | null; cause: string; label: string; amountCents: number }`) for the parent components to import.
- `src/components/admin/ledger/budget-editor.tsx` — `causeLines` prop shape widened, `labelOptions` prop added and threaded, pre-fill row shape updated.
- `src/components/admin/ledger/guided-budget-setup.tsx` — `causeLines` prop shape widened, `labelOptions` prop added and threaded to every per-fund `BudgetEditor`.
- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` — `getBudgetCauseLineLabels(entity.id)` call, `labelOptions` passed to `GuidedBudgetSetup`.
- `src/app/(dashboard)/admin/ledger/[fundSlug]/report/page.tsx` — `getBudgetCauseLineLabels(entity.id)` call, `labelOptions` passed to `BudgetEditor`.
- No new decisions logged — this phase implements DECISION-047/048 as designed, no new tradeoffs surfaced.

### Implementer Notes

- **Grouped-render approach**: rows stay a flat array (same state shape family as B-17), but rendering builds a `Map<cause, number[]>` of row *indices* (not copies) keyed by `row.cause`, iterated in `ALL_CAUSES` canonical order so group order never depends on insertion/fetch order. Storing indices rather than row objects means every mutation (`handleAmountChange`, `handleLabelChange`, `commitRow`, etc.) still operates on the flat `rows` array by index exactly as before — the grouping is a pure rendering concern layered on top, not a change to how state is stored or mutated.
- **How id-keyed in-place edit replaced delete+recreate**: the old `handleCauseChange` (DELETE old cause, then PATCH new cause) is gone completely — there's no code path left that deletes and recreates a row, because cause is no longer editable on a committed row (DECISION-048 item 2) and the two fields that *are* editable (amount, label) both go through `commitUpdate`'s single `PATCH { id, amountCents?, label? }`. Two independent dirty refs (`dirtyAmountRef`, `dirtyLabelRef`) mean editing just the label (or just the amount) sends only that field — editing both before either blurs sends both in one call. This is a strict simplification over B-17: fewer network calls, no window where a row is transiently gone.
- **Datalist wiring**: one `<datalist>` per `BudgetCauseEditor` instance (id scoped to `categoryId`+`flow`, so multiple breakdowns on the same page never collide on DOM id), populated from the `labelOptions` prop which both pages fetch once via `getBudgetCauseLineLabels(entity.id)` and thread down through `GuidedBudgetSetup`/`BudgetEditor` — matches DECISION-048 item 4's entity-scoped ruling exactly (not fund-scoped, not category-scoped). Native `<input list>` — zero JS, zero new dependency.
- **360px approach**: committed rows are now *simpler* than B-17's shipped row — no cause `<select>`, just a bullet + label input + amount input + remove button, still wrapped in the existing `flex-col … sm:flex-row` stacking pattern. The one row that still carries a 4-field density (select + label + amount + remove) is a *never-saved* pending row, which is the same class of density B-17 already shipped and qa already verified at 360px — so this increment's mobile risk is lower than B-17's, per the Phase 3 design's own prediction.
- The category-total line and the "Collapse to lump sum"/"Cancel" controls are visually and behaviorally unchanged from B-17 — they render once, below all groups, not per-group.
- No new unit tests added this phase — the task scope explicitly doesn't require presentation-component tests, and no new pure helper was extracted from the component (label/amount parsing reuses the same `parseDollarsToCents` pattern B-17 already had; `describeWriteError` is a tiny reason→copy mapper trivial enough that a dedicated test would just re-assert its three branches verbatim). qa should exercise it via the manual click-through instead.

### Open questions / handoff notes

- **Next agent: qa (Phase 5).** Manual click-through list:
  1. **Grouped display** — a category with two labeled lines under the same cause (e.g. "Hunger & Basic Needs" → "WARM" $3,000 + "Westerville Sharing & Caring" $2,000) renders as one cause header, a per-cause subtotal ($5,000), both labeled lines nested underneath, and the category total below all groups.
  2. **Add a second same-cause labeled line** — "+ Add line" on a category that already has a committed line under "Hunger & Basic Needs"; pick the same cause again, type a distinct label, save — confirms the used-cause exclusion is really gone (B-17 would have hidden that cause from the picker).
  3. **Duplicate-collision message** — try to save a second line with the exact same `(cause, label)` as an existing one (including two blank labels under the same cause) — expect the inline/toast message naming the cause, not a generic failure, and no second row created.
  4. **In-place label edit** — edit an existing committed line's label (e.g. "WARM" → "WARM Inc.") and confirm it updates without the row disappearing/reappearing (no delete+recreate visible network activity), and that editing just the amount on a different row doesn't also resend the label.
  5. **Remove** — remove a labeled line via the trash icon; `ConfirmDialog` for a non-zero line, immediate removal for a $0 line; confirm a sibling under the same cause survives and the category total recomputes correctly.
  6. **Lump→breakdown still works** — "Break down by cause" on a lump-sum category still pre-fills one unlabeled ("(generic)") "Other community support" row at the prior lump-sum value, and a treasurer can add labeled siblings under that same pseudo-cause afterward.
  7. **Locked disabling** — with the FY's budget locked, confirm add/edit/remove/collapse controls are all disabled or hidden, and a stale-tab write attempt surfaces "This budget is locked. Unlock it to make changes." via toast.
  8. **360px** — DevTools responsive mode at 360px width: grouped rows (bullet + label + amount + remove) stack cleanly with no horizontal scroll; the "+ Add line" pending row (select + label + amount + remove) is denser but still doesn't overflow.
  9. **Datalist autocomplete** — typing a partial label that matches a prior label used under a *different* fund in the same entity shows it as a browser autocomplete suggestion (entity-scoped, not fund-scoped).
- Copy strings introduced that the Lions Club may want to refine: the label input's `placeholder="(generic)"`, the "+ Add line" button label (renamed from B-17's "+ Add cause" since a line no longer maps 1:1 to a cause), and the collapse `ConfirmDialog`'s description (added "(including every label)" to the existing per-cause-detail-lost copy).
- UX tradeoff made, not specified by Phase 3: pending (never-saved) rows show a bullet-free cause `<select>` inline within their eventual group rather than floating outside all groups until committed — this means a pending row visually "joins" its group immediately as the treasurer picks a cause, before it's ever saved. Flagging in case the treasurer finds that confusing (a row appearing grouped before it's actually persisted); the alternative (rendering all pending rows in an "unsaved" section separate from the grouped, saved ones) is a small, isolated change if this reads as misleading.

---

# Phase 5 — Verification (qa)

**Date:** 2026-07-28
**Verified by:** qa

## Summary

**PASS.** All four required gates are green (typecheck, production build, hermetic
unit tests, dev-server smoke). The riskiest line in this increment — swapping
`ledger_budget_lines`' unique constraint from `(budget_id, cause)` to
`(budget_id, cause, label)` on a table the design doc describes as having live
rows in dev and production — was proven safe by inserting synthetic
pre-migration rows, running migration `0064` against them, and confirming zero
data loss, correct backfill, and idempotent replay (four consecutive applies,
zero errors). Live-drove the full id-keyed write model as the authenticated
`LEDGER_MANAGE` admin via the real API (not mocks): dual same-cause labeled
lines, both 409 reason codes (`locked`, `duplicate_cause_label`, including the
one-blank-per-cause rule and a same-case-different-whitespace collision),
id-keyed edit-in-place, delete-leaves-sibling, delete-last-deletes-parent,
label length/normalization validation, the `Other community support`
pseudo-cause coexisting with a labeled sibling, and the full
lock→write-rejected→unlock→write-succeeds cycle. The v1.40.0 regression case
(an unlabeled line created/edited exactly like before) still works. All test
data was cleaned up; the local dev DB is back to its pre-verification state.
Client-only rendering (grouped display, datalist, ConfirmDialog, locked-UI
disabling, 360px) could not be driven through the harness and is called out
below for a manual browser check — not claimed as passing.

## Type Check

`pnpm exec tsc --noEmit`: **PASS** — clean, no errors.

## Unit Tests (hermetic)

`unset DATABASE_URL DB_URL; pnpm test`: **PASS**
Total: 578 | Passed: 578 | Failed: 0
Duration: ~0.7-0.9s across three separate runs during this verification
Confirms the hermetic property (tests pass with **no DB URL set at all**) still
holds after this increment — this was a known fix from the B-17 pre-push and a
regression here would have been an automatic FAIL per the task brief. It did
not regress.

## Production Build

`pnpm build:only`: **PASS**
Notes: `next build` (Turbopack) — "Compiled successfully in 7.2s", "Finished
TypeScript" clean, 102 routes generated (static + dynamic), no unused-export
warnings, no server/client boundary errors. Ran with `build:only` only —
no migrations or `drizzle-kit push` executed by this command, per task
instruction.

## Migration Verification — `0064_ledger_budget_line_labels.sql`

**The local dev `ledger_budget_lines` table was empty (0 rows) at verification
start** — despite the design doc's "this table has live rows in dev and
production" framing (true as of when B-17 shipped, but no budget rows persist
in the current local dev snapshot). To actually exercise the swap against
populated data as the task required, rather than trivially against an empty
table, I inserted **synthetic pre-migration rows** simulating the exact
v1.40.0 shape (no `label` column existed yet) directly via SQL, then ran the
real migration:

1. **Before migration:** created a throwaway `ledger_budgets` row (fiscal year
   2099, clearly a test marker) and two `ledger_budget_lines` children under
   distinct causes (`Hunger & Basic Needs`, `Environment`), confirmed the live
   schema at that point still showed the *old* constraint,
   `ledger_budget_lines_budget_cause_key` on `(budget_id, cause)`, and no
   `label` column.
2. **Ran `pnpm db:migrate`** (the project's real migration runner, not a
   hand-rolled apply). Result: `0064` applied cleanly, `0060-0063` all no-oped
   as expected (already applied).
3. **Post-migration schema:** `label text not null default ''::text` column
   present; old constraint gone; new
   `ledger_budget_lines_budget_cause_label_key` UNIQUE on
   `(budget_id, cause, label)` present.
4. **Data integrity:** both synthetic pre-existing rows survived with zero
   loss and were backfilled to `label=''` exactly as designed — confirmed by
   direct `SELECT`.
5. **Idempotency:** replayed migration `0064` two more times directly via
   `psql -f`, then ran the full `pnpm db:migrate` runner a fourth time (this
   run also happened again automatically as part of `pnpm dev`'s startup
   hook). All four replays were clean no-ops — zero errors, zero duplicate
   side effects.
6. **Constraint enforcement, live:** confirmed the new constraint actually
   does the job — a second row with `(cause='Hunger & Basic Needs', label='')`
   was rejected with `duplicate key value violates unique constraint
   "ledger_budget_lines_budget_cause_label_key"`; a distinctly-labeled row
   (`label='WARM'`) under the same cause succeeded; a second `'WARM'` was
   rejected. This matches the design doc's "old constraint's continuous
   enforcement guarantees the new one is already satisfied" proof exactly —
   the swap could not fail against the populated set, and did not.
7. **Cleanup:** deleted the synthetic `ledger_budgets` test row (cascades
   removed its lines). Verified `ledger_budget_lines`/`ledger_budgets` both
   back to 0 rows before moving on to API-level testing.

**Verdict on the migration: PASS.** Idempotent under four replays, provably
safe against populated data (both by the design doc's logical proof and by
direct empirical test), `schema.ts` matches the live post-migration structure
exactly (column type/default, constraint name and columns).

## Live API Verification (authenticated `LEDGER_MANAGE` admin, real dev server)

Signed in via the NextAuth credentials callback using `.env.local`'s
`E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` (Playwright browser context — the same
mechanism `e2e/helpers/auth.ts` uses), then drove
`PATCH`/`DELETE /api/admin/ledger/budgets/cause-lines`,
`POST /api/admin/ledger/budget-approvals` (+ `/unlock`) directly against the
running `pnpm dev` server, using a throwaway test fund/category
(Foundation entity's Charitable Fund / "Charitable donation out" category)
and fiscal year 2099 as an obviously-synthetic marker. All test rows and the
one budget-approval row created during the lock/unlock test were deleted
afterward; DB confirmed back to its pre-test state (0 rows in
`ledger_budget_lines`/`ledger_budgets`, 0 rows in `ledger_budget_approvals`
for FY 2099).

| Scenario | Result |
|---|---|
| (a) Two lines, same cause ("Hunger & Basic Needs"), distinct labels ("WARM" $3,000 / "Westerville Sharing & Caring" $2,000) | **PASS** — both created (200), `categoryTotalCents` = 500000 = sum |
| (b) Third line, exact duplicate `(cause, label)` = ("Hunger & Basic Needs", "WARM") | **PASS** — `409 { reason: "duplicate_cause_label" }`, message names the cause, no row written |
| (c) Two blank-label lines under one cause ("Community & Civic") | **PASS** — first creates with `label:""`, second → `409 duplicate_cause_label` |
| Label normalization: `" Bake Sale "` then `"Bake Sale"` under the same cause | **PASS** — first trims to `"Bake Sale"` on write; second collides (`409`), proving trim-then-compare, not raw-string compare |
| Over-length label (121 chars) | **PASS** — `400 "label must be 120 characters or fewer"` |
| (d) Edit a line's amount **and** label by id in one call | **PASS** — single `PATCH {id, amountCents, label}` → `200`, `categoryTotalCents` recomputed correctly; cause unchanged |
| (e1) Delete one of two same-cause siblings by id | **PASS** — `action: "line_deleted"`, remaining sibling's row and the parent's recomputed total both correct |
| (e2)/(e3) Delete the last remaining line(s) in a category | **PASS** — `action: "parent_deleted"` on the final delete, mirroring the "no target set" invariant |
| 404 on delete of a nonexistent id | **PASS** — `404 "No cause line found for this id"` |
| `OTHER_COMMUNITY_SUPPORT_CAUSE` generic line + labeled sibling under the same pseudo-cause | **PASS** — both created without special-casing, exactly per DECISION-047/048's "no special-casing" ruling |
| (f) Locked budget → create/edit/delete all rejected | **PASS** — all three return `409 { reason: "locked", error: "This budget is locked. Unlock it to make changes." }` |
| Unlock, then the same writes succeed again | **PASS** (used for cleanup, confirms the lock isn't sticky) |
| Regression: create+edit an **unlabeled** (v1.40.0-style) line, no `label` in the request body at all | **PASS** — creates with `label:""`, amount-only edit-by-id works unchanged |
| Dev-server smoke: `GET /admin/ledger/budgeting` and a fund `/report` page as the authenticated admin | **PASS** — both `200`, no "Application error" text, no runtime errors in the `pnpm dev` log for the entire session |

Parent-total = sum-of-children held after every single write above (checked
via the `categoryTotalCents` returned by each call, cross-referenced against
the running total by hand) — no incremental-rollup drift observed across
create/edit/delete sequences involving multiple same-cause children.

## Regression Status

- **v1.40.0 single-unlabeled-line create/edit** — confirmed working via direct
  API call with no `label` field in the request body at all (see table
  above). No behavior change for a treasurer who never uses labels.
- **Hermetic test suite (578/578, no DB URL)** — confirmed unchanged/still
  green, guarding against the exact class of regression the B-17 pre-push
  fixed.
- **Seed collision-map fix** (`computeCauseSeedForCategory` only counting
  `label=''` rows toward "already covered") — covered by its own named unit
  test in the hermetic suite (api-developer's Phase 4 test #7); not
  independently re-driven live in this pass since it's a pure-function path
  already exercised deterministically by Vitest. Flagging this as
  intentionally not duplicated live, not as a gap.

## Client-Only Flows — Not Reachable In Harness

These require an actual browser rendering the React component tree and could
**not** be verified by this pass (API-level testing proves the server
contract; it does not prove the UI consumes it correctly). Marked honestly as
unverified, not as passing:

| Flow | Status |
|---|---|
| Grouped-by-cause display (cause header → per-cause subtotal → nested labeled lines → category total) | **Not reachable in harness** — recommend manual browser check |
| `<datalist>` label autocomplete (entity-scoped, cross-fund suggestion) | **Not reachable in harness** |
| In-place label edit UX (no visible row disappear/reappear, independent dirty-tracking of amount vs. label fields) | **Not reachable in harness** — the underlying API-level behavior (single `PATCH` per touched field, no delete+recreate) is confirmed; the *visual* absence of flicker is not |
| `ConfirmDialog` on non-zero-amount line removal | **Not reachable in harness** |
| Locked-budget UI disabling (buttons disabled/hidden, toast copy shown to the user) | **Not reachable in harness** — the *server* 409s are confirmed; the *client's* handling of them is not |
| 360px mobile stacking of the grouped rows and the "+ Add line" pending row | **Not reachable in harness** |
| "+ Add line" control offering an already-used cause without exclusion, in the actual `<select>` | **Not reachable in harness** — functionally proven via direct API create (scenario (a) above), not observed through the picker UI itself |

**Recommend the user manually click through this list in a real browser**
against `pnpm dev` before Phase 6 closes, per the ux-developer's own
Phase 4 handoff notes (9-item click-through list). None of the above are
claimed as passing here.

## Feature-Gate Audit (mandatory before PASS)

Read every touched route file directly — not inferred from passing tests.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `PATCH /api/admin/ledger/budgets/cause-lines` (create + update, id-dispatched) | yes | yes | `FEATURES.LEDGER_MANAGE` |
| `DELETE /api/admin/ledger/budgets/cause-lines` | yes | yes | `FEATURES.LEDGER_MANAGE` |
| `POST /api/admin/ledger/budgets/cause-lines/collapse` (unchanged this phase) | yes | yes | `FEATURES.LEDGER_MANAGE` |
| `POST /api/admin/ledger/budgets/seed` (one-line call-site rename only) | yes | yes | `FEATURES.LEDGER_MANAGE` |
| `(dashboard)/admin/ledger/budgeting/page.tsx` (Server Component, calls `getBudgetCauseLineLabels`) | yes | yes | view: `hasAnyFeature([LEDGER_MANAGE, LEDGER_APPROVE])`; write-affordances additionally gated on `LEDGER_MANAGE`/`LEDGER_APPROVE` |
| `(dashboard)/admin/ledger/[fundSlug]/report/page.tsx` (Server Component, calls `getBudgetCauseLineLabels`) | yes | yes | view: `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])`; write-affordances additionally gated on `LEDGER_MANAGE` |

No new `FEATURES` key was introduced by this increment (confirmed against the
Phase 3 design's permission table — reused verbatim). `getBudgetCauseLineLabels`
(the new datalist-source query) has **no dedicated API route** — it is only
ever called server-side from inside the two already-gated pages above, so it
introduces no new unauthenticated surface. Confirmed by grepping
`src/app/api/` for the symbol: zero matches.

## Coverage on Touched Modules

Ran `pnpm exec vitest run --coverage` (v8 provider, hermetic — no DB URL).
Figures below are for the **whole file**, not just this increment's slice —
both `ledger.ts` and `ledger-queries.ts` are large, shared modules most of
whose surface predates this feature:

- `src/lib/ledger.ts`: **100% stmts / 95.65% branch / 100% funcs / 100% lines**
  — includes the new `normalizeBudgetLineLabel`/`MAX_BUDGET_LINE_LABEL_LENGTH`
  helpers.
- `src/lib/ledger-queries.ts`: **22.94% stmts / 23.3% branch** file-wide — this
  is a ~3,900-line module; the low whole-file % reflects large swaths of
  pre-existing DB-bound code this increment didn't touch, not this
  increment's own functions. All 10 unit tests named in the Phase 3 design
  doc (uniqueness incl. two-blank collision, trim/normalization, id-keyed
  update independence, delete-leaves-siblings, multi-same-cause rollup, both
  409 reason codes, seed collision-map fix, seed conflict-target widening,
  migration-idempotency documentation, and the regression carry-forwards for
  the renamed/split functions) are present and passing in the 578-test
  hermetic suite — confirmed by reading `src/lib/ledger-queries.test.ts`'s
  diff, not just trusting the implementer's summary.
- Not otherwise in scope for this feature: `src/lib/permissions.ts` (no new
  `FEATURES` key touched) and `src/lib/members.ts` (untouched by this
  increment) — both are the qa agent's standing 7-day coverage-review
  responsibility, not part of this Phase 5 pass.

## Verdict

**PASS**

---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-07-28
**Owner:** analyst
**Status:** complete

## Files Read / Verified

Re-read this work-log's Phase 1 (incl. the binding "Human Answers, 2026-07-28"),
Phase 2/3 (DECISION-047/048), all three Phase 4 subsections, and qa's Phase 5
PASS in full. Did not stop at the narrative — cross-checked the load-bearing
claims directly against the shipped code and `docs/decisions.md`:

- `src/lib/db/schema.ts` L805-828 — `label text not null default ''`, constraint
  renamed to `ledger_budget_lines_budget_cause_label_key` on `(budgetId, cause, label)`. Matches Phase 3/DECISION-047 exactly.
- `drizzle/migrations/0064_ledger_budget_line_labels.sql` — read in full; three
  ordered, individually-guarded statements exactly as designed, with the
  safety proof written into the file's own comments.
- `src/app/api/admin/ledger/budgets/cause-lines/route.ts` — read in full;
  id-dispatch on `PATCH`, `reason` on the wire for both 409s, `auth()` +
  `hasFeature(LEDGER_MANAGE)` gate present.
- `src/lib/ledger-queries.ts` — confirmed `existingCauseAmountMap`'s seed
  collision-map query filters `eq(ledgerBudgetLines.label, "")` (L1746), and
  `normalizeBudgetLineLabel`/`MAX_BUDGET_LINE_LABEL_LENGTH` exist in `ledger.ts`.
- `src/components/admin/ledger/budget-cause-editor.tsx` — confirmed
  `id`-keyed rows (`id === null` = pending), the `rowsByCause` grouping `Map`
  iterated in `ALL_CAUSES` order, independent `dirtyAmountRef`/`dirtyLabelRef`,
  `ConfirmDialog` import and usage, `rounded-lg` (no `rounded-full`, no
  `window.confirm`).
- `docs/decisions.md` DECISION-047/048 — match the work-log's Phase 2/3 narrative.
- `docs/work-log/2026-07-27-ledger-cause-budget-lines.md` (B-17's own Phase 6) —
  read for precedent on how B-17 handled the identical class of
  harness-unreachable client-only flows (SHIP IT, tracked as backlog B-20/B-21,
  recommended a manual click-through independent of the ship decision).
- `docs/backlog.md` B-20/B-21 — updated in this pass (see Outputs).

## VERDICT

**SHIP IT**

## ONE-LINE TAKE

> A treasurer can now enter several distinctly-labeled dollar amounts under one cause (e.g. two "Hunger & Basic Needs" lines — WARM, Westerville Sharing & Caring), see them grouped under a cause header with a per-cause subtotal, and edit either field in place with no delete-then-recreate risk — every one of the eight binding decisions verified directly against the shipped code and qa's live evidence, not just the narrative, with only client-rendering verification (same class of gap B-17 shipped with) left for a human browser pass.

## What's Working

- **The write-model fix is real, not cosmetic.** Row identity moved from `(cause)` to `id` exactly as required — `updateBudgetCauseLine` is a single `UPDATE ... WHERE id = $1` covering amount and/or label independently, and the old DELETE-then-PATCH "rename" hack (B-17's disclosed, narrow data-loss window) is gone from the codebase entirely, not just deprecated. This was the central risk Phase 1 flagged (Gap 1/2) and it landed exactly as designed.
- **The migration was proven safe against populated data, empirically, not just by proof-reading.** qa didn't just read the "old constraint's continuous enforcement guarantees the new one is already satisfied" argument — it inserted synthetic pre-migration rows, ran the real `pnpm db:migrate`, and replayed it four times, observing zero data loss and correct `label=''` backfill each time. That's a stronger bar than this project's migrations usually clear before Phase 6.
- **The seed collision-map fix is small, correct, and independently unit-tested.** `existingCauseAmountMap`'s `eq(ledgerBudgetLines.label, "")` filter (L1746 of `ledger-queries.ts`) is exactly the one-line surgical fix Phase 3 called for — a cause with only a labeled sibling no longer wrongly reads as "already covered" by seeding.
- **Two distinct, human-readable 409s.** `reason: "locked"` vs `reason: "duplicate_cause_label"` are both on the wire and both were live-tested against the real dev server (not mocked), including the two-blank-label collision case and a same-value-different-whitespace collision (`" Bake Sale "` vs `"Bake Sale"`), which is exactly the trim-then-compare behavior Gap 6 asked for.

## Intent-vs-Shipped Diff

1. **Multiple lines per cause, distinguished by a free-text label.** Phase 1 said this is the whole point of the request. Shipped: confirmed in schema (`label` column), API (`createBudgetCauseLine` allows any cause regardless of existing siblings), and qa's live scenario (a) — two "Hunger & Basic Needs" lines, "WARM" $3,000 + "Westerville Sharing & Caring" $2,000, both created. **Verdict: matches.**
2. **Label optional; exactly one blank/generic line per cause; duplicate `(cause, label)` incl. two-blank blocked via `UNIQUE(budget_id, cause, label)`.** Shipped: constraint confirmed in `schema.ts` and the live migration; qa's scenario (c) (two blank labels under "Community & Civic") and the exact-duplicate scenario (b) both correctly 409 with `duplicate_cause_label`. **Verdict: matches.**
3. **Display grouped by cause with per-cause subtotals.** Phase 1 called this the actual value proposition, not cosmetic (Gap 3). Shipped: `budget-cause-editor.tsx`'s `rowsByCause` `Map`, iterated in canonical `ALL_CAUSES` order, renders a header + `sumBudgetCauseLines`-per-group subtotal + nested rows, confirmed by reading the component. **Not independently confirmed in a rendered browser** — qa's harness couldn't reach it. **Verdict: matches, by code inspection; visual confirmation pending** (see Edge Cases / Follow-Ups).
4. **Seeding stays cause-level; collision-map counts only `label=''`.** Human Answer Q7 was explicit: do not rework seeding to a `(cause, party)` grain. Shipped: `deriveCauseSeedLines`/`computeCauseSeedForCategory` untouched in grain; the one required fix (filter to `label=''` rows before building the collision map) is present at L1746 and covered by its own named unit test (Phase 3 test #7, confirmed present in the 578-test suite). **Verdict: matches.**
5. **Row identity moved to `id`; in-place amount+label edit; cause NOT editable in place (delete+recreate).** Binding item 5 plus the explicit human decision (line 475-480 of this log) both confirmed. Shipped: `updateBudgetCauseLine` is one `UPDATE ... WHERE id`; a committed row's cause renders as a bullet, not a `<select>` (confirmed in the component); moving a line to a new cause is a manual DELETE + CREATE, both pre-existing calls. **Verdict: matches** — the narrowing from B-17 (every committed row used to have a live cause dropdown) was explicitly flagged to the user by tech-lead before Phase 4 and explicitly accepted, so this is confirmed intent, not silent scope creep.
6. **Two distinct 409 reason codes.** Shipped and live-tested (`locked`, `duplicate_cause_label`), both surfaced in the JSON body per DECISION-048 item 1. **Verdict: matches.**
7. **Migration 0064 additive/idempotent, safe on populated tables; existing v1.40.0 lines become the generic (`label=''`) line.** Shipped and empirically proven by qa (synthetic pre-migration rows, real migration runner, 4x replay, zero data loss). **Verdict: matches — verified more rigorously than the median migration in this codebase.**
8. **`LEDGER_MANAGE`/`LEDGER_APPROVE` reused, no new key; lock still gates all writes.** Confirmed by qa's Feature-Gate Audit table (read every touched route directly) and by my own re-read of `route.ts`. **Verdict: matches.**

## Edge Cases

- **Empty state:** not applicable / pass — this increment doesn't add a new empty state; the existing "no cause lines yet" / lump-sum states are unaffected, and the `OTHER_COMMUNITY_SUPPORT_CAUSE` pre-fill still lands correctly (confirmed live).
- **Failure microcopy:** pass — both 409s produce specific, human copy (`A line for "<cause>" with this label already exists — edit it instead.` / `This budget is locked. Unlock it to make changes.`), confirmed both server-side (qa's live API tests) and client-side (`describeWriteError()` forwards the server text rather than a generic "save failed," confirmed by reading the component).
- **Permission gate:** pass — `auth()` + `hasFeature(LEDGER_MANAGE)` present on both mutating routes, confirmed by reading the route file directly (not inferred from tests); qa's Feature-Gate Audit table independently confirms the same. No new `FEATURES` key, as designed.
- **Mobile (360px):** not independently verified — flagged by ux-developer and qa as harness-unreachable. Code inspection shows the same `flex-col … sm:flex-row` stacking pattern carried forward, and committed rows are now *simpler* than B-17's shipped row (no cause `<select>`), which is a lower-risk shape than what qa already visually verified at 360px for B-17. Treating as low-risk-but-unconfirmed, same class as item 3 above — see Follow-Ups.

## Follow-Ups (tracked, not blockers)

Verdict is SHIP IT — none of the following were the cause of a FAIL and nothing in the shipped code suggests they will fail, but they haven't been seen by a human or a test runner in a real browser yet:

1. **Manual browser click-through, recommended before or shortly after this push** (mirrors the ux-developer's own 9-item Phase 4 list and qa's Phase 5 "Client-Only Flows" table almost exactly):
   - Grouped display: two labeled lines under one cause render as one header, correct per-cause subtotal, both lines nested, category total below all groups.
   - "+ Add line" on a category with an existing committed line under a cause — confirm the cause picker offers that same cause again (B-17 would have hidden it).
   - Duplicate-collision toast names the cause/label, not a generic error.
   - Edit an existing line's label in place — confirm no visible row disappear/reappear, and that editing only the amount on a different row doesn't also resend its label.
   - Remove a labeled line — `ConfirmDialog` for non-zero, immediate for $0; sibling under the same cause survives with a correct recomputed total.
   - Lump→breakdown pre-fill still shows one unlabeled "(generic)" "Other community support" row, and a labeled sibling can be added under it afterward.
   - Locked budget: add/edit/remove/collapse controls disabled or hidden; a stale-tab write attempt shows the "locked" toast, not a crash.
   - 360px: grouped rows (bullet + label + amount + remove) and the denser "+ Add line" pending row (select + label + amount + remove) both stack with no horizontal scroll.
   - `<datalist>` autocomplete: a partial label typed under one fund suggests a prior label used under a *different* fund in the same entity.
   - **Filed as an expansion of `docs/backlog.md` B-20** (Playwright e2e coverage for the Ledger budgeting module) rather than a new backlog item — same underlying gap (zero e2e specs on this surface), now with this increment's flows folded in.
2. **B-21 (dedicated rename endpoint) is now closed, not just deprioritized.** The DELETE+PATCH rename window it tracked no longer exists — cause is fixed at creation and there's no in-place cause mutation left to protect. Marked `[x]` closed/superseded in `docs/backlog.md` with a pointer to DECISION-047/048.
3. **Release notes / version bump not yet done.** `package.json` is still `1.40.0` and there's no `v1.40.md`/`v1.41.md` entry for this increment. This is the expected next step (Phase 3's own Implementation Order named "Release notes entry — tech-lead, at Phase 6 SHIP IT" as step 7, i.e., now), not a defect — flagging so it isn't dropped before the push.
4. **Copy review, low priority.** ux-developer flagged the label placeholder (`"(generic)"`), the "+ Add line" button text, and the collapse `ConfirmDialog`'s amended description ("...including every label") as strings the Lions Club may want to word-smith. Not functionally blocking.

## Outputs

- `docs/work-log/2026-07-28-ledger-labeled-cause-lines.md` — this Phase 6 section; Per-Phase Status table row 6 updated to Complete / SHIP IT / 2026-07-28.
- `docs/backlog.md` — B-20 widened to include this increment's client-only flows (grouped display, datalist, in-place label edit, locked-UI + two-toast-copy disabling, "+Add line" no-exclusion picker); B-21 marked `[x]` closed/superseded (the rename-window risk it tracked no longer exists under the shipped design).

## Open Questions / Handoff Notes

- No loop-back needed. Pipeline closes here.
- Recommend the user (or a future qa/Playwright pass under B-20) walk the click-through list above in a real browser before or shortly after pushing to `main` — same non-blocking recommendation pattern B-17 shipped with.
- Next actual step before push: release notes entry + version bump (tech-lead), then `/pre-push`.

---

# Deployment & Security Note (2026-07-28, v1.41.0)

Pre-push for the v1.41.0 push to `main`. Gates: typecheck PASS; hermetic unit tests PASS (578/578, no `DATABASE_URL` needed); `build:only` PASS; migration `0064` idempotent (verified by qa via synthetic populated rows + 4× replay); no debug logs / native dialogs / staged env files.

**CVE audit:** `pnpm audit --prod --audit-level=high` exits 1 with the SAME residual set the treasurer explicitly acknowledged at the v1.40.0 push — 3 critical + 2 high in the **Auth.js / `next-auth@5.0.0-beta.30` / `@auth/core`** chain, + 1 high transitive `brace-expansion` under `exceljs`. The v1.40.0 `next`/`postcss` bumps cleared all Next.js/PostCSS highs and they remain clear; nothing new this push. Override re-acknowledged by the treasurer (2026-07-28) with the explicit instruction to remediate the Auth.js criticals as the immediate next task (the overdue dependencies review — investigate the `next-auth` beta → patched-Auth.js upgrade).
