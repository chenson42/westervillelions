# Budgeting Page Redesign (reference columns, blank inputs, soft-delete, print) — Work Log

> **Slug:** `2026-07-28-budgeting-page-redesign`
> **Surface:** (dashboard) admin — The Ledger budgeting page
> **Permission(s):** existing `ledger.manage` / `ledger.approve` expected — confirm Phase 1/3
> **Estimated complexity:** large (layout redesign + soft-delete state + print view; builds on the v1.40/v1.41 cause-line editor)
> **Pipeline mode:** Full

## Treasurer's request (verbatim intent, 2026-07-28)
Redesign `/admin/ledger/budgeting` to be cleaner and printable:

1. **Printable version, printed from the page** — same data, "nice and neat and printable" (print CSS, like the member Monthly Statement). Not a separate export.
2. **Spare lines per category on the printout** — leave a couple of extra blank lines under each category for hand-written additions/subtractions.
3. **Cleaner per-category layout** — for each category show **prior-year budget**, **prior-year actual**, and a **blank input box** for the new budget. The blank input is the signal: an empty box = a category you haven't addressed yet, so you can tell at a glance what's still untouched. (This shifts away from pre-filling the new budget with last year's number.)
4. **Soft deletes** — removing a budget line does NOT immediately hide it. The line stays visible on the form with a **visual "deleted" indicator** and a **toggle to restore it**, until the budget is **finalized** (finalize = the existing approve/lock). Only on finalize does the deletion take effect.
5. **Remove the seeding-precursor section** — the current "here are last year's categories / last year's cause breakdown" preview shown before seeding is **noise**; drop it. (Prior-year budget + actual now live inline per category per #3, so the separate preview is redundant.)

## Context to ground the design (Phase 1/3 must read)
- Existing budgeting surface: `src/app/(dashboard)/admin/ledger/budgeting/page.tsx`, `src/components/admin/ledger/budget-editor.tsx`, `src/components/admin/ledger/budget-cause-editor.tsx` (the v1.41 labeled cause-line editor), `src/components/admin/ledger/guided-budget-setup.tsx` (the seed-from-last-year flow + the "precursor" preview to remove).
- Prior-year budget + actual data: `getFundReport(asOfDate)` and `computeSeedFromPriorYear` already compute prior-year figures; the report page already shows budget-vs-actual — reuse, don't reinvent.
- Print precedent: the `print:hidden` Tailwind variant + print CSS used by `/members/financial-reports` and `/admin/ledger/guide`.
- Approve/lock ("finalize") = `ledger_budget_approvals` (v1.39). Soft-delete-until-finalize must interact with that lock.
- Open design questions for Phase 1 to resolve: is the soft-delete "deleted, restorable" state **persisted** (a `deleted_at` flag on budget lines/rows, surviving reload) or **client-only until finalize**? How does "blank input = untouched" coexist with categories that legitimately budget $0? Does the redesign apply to the cause-line (labeled) breakdown too, or just category-level? Does removing the guided-seed precursor also remove the "seed from last year" action, or just its noisy preview?

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-28 |
| 2 — Architectural review (Increment 1) | architect | Skipped (accelerated pipeline, documented) | — | 2026-07-28 |
| 3 — Technical design (Increment 1) | tech-lead | Compressed into implementation brief (7pm deadline) | — | 2026-07-28 |
| 4 — Implementation (Increment 1) | ux-developer | Complete | — | 2026-07-28 |
| 5 — Verification (Increment 1) | qa | Complete | PASS | 2026-07-28 |
| 6 — Shipped vs intent (Increment 1) | analyst | Complete | SHIP WITH NOTES | 2026-07-28 |
| 2 — Architectural review (Increment 2) | architect | Complete | Approved with suggestions | 2026-07-28 |
| 3 — Technical design (Increment 2) | tech-lead | Complete | Design complete, implementers named | 2026-07-28 |
| 4 — Implementation (Increment 2, schema) | database-admin | Complete | — | 2026-07-28 |
| 4 — Implementation (Increment 2, server) | api-developer | Complete | — | 2026-07-28 |
| 4 — Implementation (Increment 2, client) | ux-developer | Complete | — | 2026-07-28 |
| 5 — Verification (Increment 2) | qa | Not started | — | — |
| 6 — Shipped vs intent (Increment 2) | analyst | Not started | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> A redesign of the existing LEDGER_MANAGE/LEDGER_APPROVE budgeting screen to put prior-year budget+actual inline per category with a blank "not yet addressed" input, print cleanly with hand-annotation space, and make line removal reversible until the budget is locked — no new permission, but soft-delete needs a persisted schema flag and the seed-preview removal forces a real scope decision on whether the "seed from last year" action itself survives.

## Grounding Notes (what I confirmed in code before refining)

- `getFundReport(fundId, fiscalYear)` (`src/lib/ledger-queries.ts:451`) already returns, per category, both `budgetCents` and `actualCents` at **category grain**. `computeSeedFromPriorYear` (`ledger-queries.ts:1848`) already calls `getFundReport(fund.id, priorFiscalYear)` to build the seed preview. So request #3's "prior-year budget + prior-year actual per category" is a **read-only reuse** of an existing query — call it a second time at `priorFY` alongside the existing `targetFY` call in `page.tsx` (which already fetches `targetReports` at `targetFY`, `budgeting/page.tsx:140`). No new aggregation.
- `ledgerBudgets` (schema.ts:772) is one row per `(fundId, fiscalYear, categoryId, flow)`, `annualAmountCents` **NOT NULL**. Today, "remove a line" (`BudgetEditor.commitValue`, `budget-editor.tsx:139`) means submitting an empty string → `annualAmountCents: null` in the PATCH → the row is hard-deleted server-side. There is **no delete-flag column today** — soft-delete is a real schema addition, not a UI-only toggle.
- The blank-vs-$0 distinction the request asks for (#3) **already exists** as an invariant: empty input → row absent ("—"/untouched); explicit "0" → a real `annualAmountCents = 0` row (see the `FU-1` comment at `budget-editor.tsx:137` and the footer copy "Enter 0 for a $0 budget. Leave blank to remove."). This redesign doesn't need to invent this model, just stop **pre-filling** the input with last year's number by default (that pre-fill doesn't actually happen today either — pre-fill only happens via the explicit "Seed" action, never automatically on page load, so #3's "shifts away from pre-filling" is really about not defaulting the *new inline layout's* input from the reference columns, which the current component doesn't do anyway).
- The "seeding-precursor preview" the request wants removed (#5) is concretely `ProposedLinesList` (`guided-budget-setup.tsx:181-216`), rendered per fund inside the `canManage && !locked` block (`guided-budget-setup.tsx:836`). The **seed action itself** — "Seed all funds" / "Seed this fund" / "Overwrite…" buttons, the `seedCauseLines` checkbox, and their `ConfirmDialog`s — is separate code the request's own wording doesn't ask to remove. This is Design Question #4, and I recommend keeping the action, dropping only `ProposedLinesList` (see below).
- Print precedent is exactly `print:hidden` Tailwind + a client `window.print()` button (`src/components/members/print-statement-button.tsx`), no PDF-generation dependency — already a locked decision for statements. Reuse verbatim.
- Two-tier gate (`budgeting/page.tsx:37-53`): `canAccess` = `LEDGER_MANAGE` **or** `LEDGER_APPROVE`; `canManage`/`canApprove` gate individual controls. `showRemoveControl` is already `canManage && !locked` (`guided-budget-setup.tsx:884`) — soft-delete/restore controls should gate identically.
- `assertBudgetUnlocked` (`ledger-queries.ts:705`) is the single server-side lock guard called from every write path. Any new soft-delete/restore endpoint must route through it too — the `disabled` prop on `BudgetEditor` is explicitly documented as UI-only defense-in-depth (`budget-editor.tsx:61-64`), the 409 is the real enforcement.

## User Verbs

This entire feature lives on one surface: **Admin** (`(dashboard)/admin/ledger/budgeting`). No public-visitor, access-pending, or ordinary-member verbs apply — it's gated by `LEDGER_MANAGE` and/or `LEDGER_APPROVE` before any of this renders.

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (LEDGER_MANAGE or LEDGER_APPROVE) | Click "Print / Save as PDF" to get a clean, hand-annotatable worksheet | Occasional (once per budget cycle, maybe a few times) |
| Admin (LEDGER_MANAGE) | Read prior-year budget and prior-year actual next to a blank input, type this year's number | Per category, repeated many times per budgeting session |
| Admin (LEDGER_MANAGE) | Remove a budget line (soft-delete) | Per category, occasional |
| Admin (LEDGER_MANAGE) | Restore a soft-deleted line | Per category, occasional, corrective |
| Admin (LEDGER_APPROVE) | Approve & lock (finalize) — now also the moment pending deletes take effect | Once per fiscal year (plus re-approvals after an unlock/amend) |
| Admin (LEDGER_MANAGE, still present) | Seed all funds / seed this fund / overwrite from prior year | Occasional, at the start of a budget cycle |

## Flows

**Flow 1 — Print the budget worksheet:** Admin on `/admin/ledger/budgeting?entity=X&fy=Y` (either `canManage` or `canApprove`) → clicks "Print / Save as PDF" (`print:hidden`, visible regardless of lock state or which tier holds access — a board member with only `LEDGER_APPROVE` should be able to print for review) → browser print dialog opens over a print-CSS-rendered version of the page: chrome (hero, entity/FY selector, seed panel, approve panel, add-category controls, trash icons) hidden; each fund renders as a clean table of category / prior-year budget / prior-year actual / this-year input (rendered as static text, not a live `<input>`, in print) / 2 blank ruled lines → outcome: a physical or PDF printout, ready for hand annotation.
- Failure: there isn't a network failure path here (it's client-side `window.print()`) — but a **long category list could paginate badly mid-row** without explicit page-break CSS, which the request doesn't mention. Flagged below as a gap.

**Flow 2 — Enter this year's budget for a category:** Unlocked budget, `LEDGER_MANAGE` holder on the redesigned per-category row → sees `[Category name] · Prior budget: $X · Prior actual: $Y · New budget: [blank input]` → types a dollar amount → blurs or presses Enter → existing `PATCH /api/admin/ledger/budgets` fires (unchanged contract) → outcome: value saved silently, `router.refresh()` (no success toast today — that's existing behavior, not a regression to introduce).
- Failure: invalid amount → existing toast ("Enter a valid amount…"); stale-tab race against a lock → existing 409 toast ("This budget is locked. Unlock it to make changes.") — both already implemented, just need to keep firing from the new layout.

**Flow 3 — Soft-delete a budget line:** Unlocked budget, `LEDGER_MANAGE` holder clicks the line's remove control → **new behavior**: instead of immediately clearing the input and hard-deleting the row, the line is marked "deleted" (visual treatment: strikethrough category name + gray background + a "Deleted — will be removed when this budget is finalized" badge) and the trash icon is replaced with a "Restore" toggle. The dollar value stays visible (not cleared) → outcome: line visibly marked, persisted (survives reload — see Design Q1), input disabled while marked.
- Failure: attempting to soft-delete on a budget that was locked by someone else since page load → the same 409 the PATCH path already returns.

**Flow 4 — Restore a soft-deleted line:** `LEDGER_MANAGE` holder clicks "Restore" on a marked line → line returns to its normal editable state immediately, no confirmation needed (this is now a reversible, non-destructive action — unlike today's remove, which is an immediate hard delete) → outcome: line indistinguishable from one that was never touched.
- Failure: same lock-race 409 as Flow 3.

**Flow 5 — Finalize (approve & lock) with pending soft-deletes:** `LEDGER_APPROVE` holder on an unlocked budget with 1+ soft-deleted lines → clicks "Approve & lock" → **the existing `ConfirmDialog` copy needs a new clause**: "N line(s) marked for deletion will be permanently removed" → confirms → server locks the budget **and** commits the pending deletes (in the same transaction) → outcome: budget locked read-only, soft-deleted lines gone.
- Failure: existing approve failures (missing board minute, network error, already-locked race) are unchanged.

## Permissions

- **Permission(s):** No new `FEATURES.*` key. Every verb above is already covered by the existing `FEATURES.LEDGER_MANAGE` (edit inputs, soft-delete, restore, seed, add category) and `FEATURES.LEDGER_APPROVE` (approve/lock, unlock) two-tier gate at `budgeting/page.tsx:37-53`. Print is visible to anyone who passes the page's `canAccess` check (either feature) — it's a read affordance, not a write.
- **Default roles:** Unchanged — whatever currently holds `LEDGER_MANAGE`/`LEDGER_APPROVE` (Treasurer/Assistant Treasurer for manage, Board/President for approve, per existing role bindings).

## Gaps the Request Didn't Address

- **Does a soft-deleted line's amount still count in the live balance readout?** `computeBudgetBalanceStatus` (surfaced in `GuidedBudgetSetup`'s balance badges) sums every line's current value. If a soft-deleted line still counts until finalize, the treasurer can't see the *effect* of the deletion before committing to it — which undercuts the point of showing it live. Recommend: **exclude soft-deleted lines' amounts from the balance calc immediately**, even though the row itself still exists and displays. This needs to be a locked decision before Phase 3, not left implicit.
- **Print pagination.** Nothing in the request addresses page breaks. A fund with 15+ categories will split a category's blank annotation lines across a page boundary if nothing prevents it. Recommend `break-inside: avoid` per category block (or at minimum per fund section) in the print CSS.
- **Cause-line-grain soft-delete.** The request's soft-delete language ("a removed line") maps naturally to a category/flow row (`ledgerBudgets`), not to an individual labeled cause line inside `BudgetCauseEditor` (`ledgerBudgetLines`). Recommend v1 scope soft-delete to the category/flow grain only; a cause line's existing hard-delete-with-`ConfirmDialog` behavior (`budget-cause-editor.tsx:357`) is untouched. Flag for treasurer confirmation — the v1.41 labeled-cause-line editor is recent and shouldn't quietly regress or get an inconsistent removal model from its parent row.
- **Does editing a soft-deleted line's amount implicitly restore it?** If a treasurer types a new number into a line marked "deleted" without hitting Restore first, least-surprise says that edit should implicitly clear the pending-delete flag. Not addressed by the request — recommend yes, and Restore stays available as an explicit no-op path for "I just want it back, unchanged."
- **Does today's remove-line `ConfirmDialog` (`budget-editor.tsx:393-407`) still make sense?** It exists today because remove is an immediate, irreversible hard delete. Once soft-delete makes removal reversible-until-finalize, that confirm dialog is probably no longer necessary (one click to mark deleted, one click to restore) — but the request doesn't say to drop it. Recommend dropping it for the same reason a "move to trash" UI pattern normally skips a confirm — and instead putting the one meaningful warning at finalize time (Flow 5's updated Approve dialog copy).
- **Prior-year reference columns for a brand-new (entity, FY) with zero prior-year data.** Must render the same "—" convention `getFundReport` already uses for a null `budgetCents`/absent activity, not a blank cell that looks broken. Not explicitly stated but should be called out so it isn't missed.
- **Mobile at 360px.** Today's `BudgetEditor` row is already a tight single flex row (category name + $ input + trash icon) at narrow widths. Adding two more reference-value columns risks overflow on a 360px admin viewport. Recommend the redesigned row either stacks (category name, then a 3-up prior-budget/prior-actual/new-input mini-grid beneath it) below a breakpoint, or the whole table scrolls horizontally inside its own `overflow-x-auto` container per the project's UX guideline — not a rigid 4-up row that clips.
- **Print output for categories in cause-breakdown mode.** The request's print spec doesn't say whether a category currently broken down by cause (v1.41) prints as its lump-sum total only, or expands the individual labeled cause lines too. Recommend the lump-sum total only for v1 simplicity (keeps the print table one row per category, matching the blank-lines-per-category ask) — but flag this explicitly, since a treasurer who just got labeled cause lines might expect them on the printout.

## Out of Scope (confirm with user)

- Cause-line-grain (`ledgerBudgetLines`) soft-delete/restore — category/flow grain only in v1.
- Bulk soft-delete or bulk-restore across multiple categories at once.
- Any change to the seed/overwrite API contract beyond what's needed — the seed action itself is kept, only its per-fund `ProposedLinesList` preview is removed (Design Q4).
- A generated-PDF export path — print stays a `window.print()` browser dialog, no new dependency.
- Expanding printed output to show individual cause-line detail for categories in breakdown mode (lump-sum total only, per the gap above).

## Open Questions (the six from the brief, with recommendations — starred ones genuinely need the treasurer, not just my judgment)

1. **★ Soft-delete persistence.** Recommend **persisted**, not client-only: a nullable `pending_delete_at timestamp` column on `ledger_budgets` (schema.ts:772). Client-only state would vanish on reload or when a second `LEDGER_MANAGE` holder (e.g., Assistant Treasurer) opens the same page mid-cycle — which directly contradicts the request's "stays visible… until finalized" (that phrase implies durability across sessions/viewers). On finalize (`ledger_budget_approvals` locking, `assertBudgetUnlocked`'s counterpart write path), rows with `pending_delete_at` set are hard-deleted in the same transaction as the lock write — consistent with today's model, where there's no history/versioning concept for a removed budget line at all. Schema implication for tech-lead: one nullable timestamp column + an idempotent migration; no new table.
2. **Blank vs. $0.** Already solved by the existing invariant — no row (absent `ledger_budgets` entry) = untouched/blank; an explicit `annualAmountCents = 0` row = deliberately budgeted zero. Nothing new to build here; just don't let the new reference-column layout accidentally auto-fill the blank input from the prior-year columns.
3. **Prior-year reference columns — category grain confirmed, cause grain out of v1.** `getFundReport(fund.id, priorFY)` already returns `budgetCents`/`actualCents` per category — no new computation, just a second call at `priorFY` alongside the existing `targetFY` call. Cause-line-grain prior-year reference (e.g., prior actual for one specific labeled cause line) would need new aggregation this codebase doesn't have yet — recommend leaving it out of v1; the v1.41 cause editor is untouched.
4. **★ Seed action vs. its preview — the scope fork.** Recommend: **keep the "seed from last year" action** (Seed all funds / Seed this fund / Overwrite… / the `seedCauseLines` checkbox and its confirms), **remove only `ProposedLinesList`** (the scrollable per-fund preview list). The request's wording ("last year's categories / last year's cause breakdown… is noise now that prior-year budget+actual live inline per category") describes exactly `ProposedLinesList`'s content, which is now redundant with the new reference columns — but it doesn't ask to remove the one-click bulk-copy action, which still saves real data-entry effort. This is a genuine fork and the treasurer should confirm before Phase 2/3, since dropping the seed action entirely is a materially smaller, simpler feature than keeping it.
5. **Print specifics.** Recommend 2 blank ruled lines per category (matches "a couple" in the treasurer's own framing). Print includes: category name, prior-year budget, prior-year actual, and the current input's value rendered as static text (not a live `<input>`) — reusing the `print:hidden` + `window.print()` pattern from `print-statement-button.tsx` verbatim, no new dependency. Needs `break-inside: avoid` page-break handling per category/fund (gap above).
6. **Soft-delete + the lock.** Confirmed by re-reading the code: soft-delete/restore controls gate exactly like today's `showRemoveControl` (`canManage && !locked`) — a locked budget shows no delete/restore affordance at all, matching `editorDisabled = locked || !canManage`. Finalize (`Approve & lock`) is the only moment pending deletes commit; unlocking to amend does **not** un-delete anything (soft-deletes that already committed at a prior finalize are gone for good, same as today's hard-delete-on-remove behavior).

## Recommended v1 Scope / Increment Split

This is large enough (layout redesign + one schema-backed state machine + print CSS, touching a shipped v1.39/v1.40/v1.41 surface) that I recommend **two increments**, not one Phase 3/4 pass:

- **Increment 1 (no schema change):** prior-year budget+actual reference columns (Design Q3), remove `ProposedLinesList` while keeping the seed action (Design Q4), print CSS + print button (Design Q5). This delivers 4 of the request's 5 items and can ship, get used through a real budget cycle, and get treasurer feedback before the riskier piece lands.
- **Increment 2 (schema change):** soft-delete + restore-until-finalize (Design Q1/Q6), including the finalize-time commit-of-pending-deletes and the updated Approve `ConfirmDialog` copy. This is the architecturally novel piece — a new persisted state that interacts with the lock invariant and the live balance calc — and deserves its own tech-lead design pass and its own QA click-through rather than being bundled in.

If the treasurer wants both in one push, that's fine functionally, but the two increments have very different risk profiles (one is additive/read-only, the other adds a write-path state machine) and I'd want that called out explicitly to whoever picks up Phase 2/3, not blurred together.

## Human Answers (Chris, 2026-07-28) + TIME-CRITICAL scoping

- **Seed action (Q4): REPLACE seeding with blank inputs.** Remove BOTH `ProposedLinesList` (the preview) AND the seed action (the "Seed all funds"/"Overwrite"/`seedCauseLines` buttons + dialogs). No seeding; the treasurer types each number using the new prior-year reference columns. (Note: the existing FY2026 budget is already populated from the earlier seed script, so nothing needs re-seeding for tonight.)
- **Ship split: TWO increments.** Increment 1 (this one) = prior-year reference columns + remove the seed flow (preview + action) + print. NO schema. Increment 2 (later) = soft-delete/restore-until-finalize (schema).
- **Soft-delete model: recommended** (persisted `pending_delete_at`, excluded from the live total immediately, committed on finalize, cause-line removal stays hard-delete) — **Increment 2 only, deferred.**

### ⏰ DEADLINE: club budget meeting TONIGHT 7:00pm (stated 2026-07-28 ~4:40pm). Increment 1 must be built, verified, and DEPLOYED before then. The must-haves for the meeting are the **printable worksheet + prior-year budget/actual reference columns + spare hand-annotation lines**. The seed-flow removal is part of Increment 1 but secondary to getting print+reference-columns solid.

## Phase 2 (Architectural Review) — SKIPPED for Increment 1 (accelerated pipeline)

Skipped per CLAUDE.md accelerated-pipeline rule: Increment 1 is obviously within existing structure — NO schema change, NO new dependency, NO new permission. It reuses `getFundReport(fund.id, priorFY)` (existing, read-only) for the reference columns, the existing `BudgetEditor`/`BudgetCauseEditor` components, and the `print:hidden` + `window.print()` pattern already shipped in `print-statement-button.tsx`/`/members/financial-reports`. The only removals are `ProposedLinesList` + the seed action in `guided-budget-setup.tsx`. No structural/dependency decision to make. (Increment 2's schema-backed soft-delete WILL get a proper architect + tech-lead pass.) Phase 3 is compressed into the implementation brief given the 7pm deadline; qa (Phase 5) + analyst (Phase 6) still run as gates.

---

# Phase 2 — Architectural Review (architect)

## Increment 2 — Phase 2 (Architectural Review) — 2026-07-28

**Owner:** architect
**Scope:** Soft-delete/restore-until-finalize for `ledger_budgets` (category/flow grain), deferred from Increment 1 per the Human Answers block above. Read Phase 1's soft-delete analysis (Design Q1/Q6, Flows 3-5, Gaps section) plus `src/lib/db/schema.ts` (`ledgerBudgets`/`ledgerBudgetApprovals`/`ledgerBudgetLines`), `src/lib/ledger-queries.ts` (`getFundReport`, `assertBudgetUnlocked`, `upsertBudgetLine`), `src/lib/ledger.ts` (`isBudgetLocked`, `computeBudgetBalanceStatus`), `src/components/admin/ledger/budget-editor.tsx`, `guided-budget-setup.tsx`, and the budget-approvals routes before writing this.

### VERDICT

**Approved with suggestions.** The confirmed model (persisted `pending_delete_at`, category/flow grain only, finalize = hard-delete-in-the-same-transaction-as-lock) is the correct shape and fits the existing architecture cleanly — one nullable column, one sibling write-path function next to `upsertBudgetLine`, one transaction extension on the existing approve route. Nothing here requires a new directory, a new dependency, or a new `FEATURES` key. The suggestions below are load-bearing implementation-contract calls that Phase 3 must resolve explicitly rather than improvise, because two of them (the delete-semantics unification and the running-total seam) have a wrong answer that would either reintroduce the exact footgun this feature exists to remove, or leak an uncommitted edit onto a member-facing surface.

### 1. Schema shape — CONFIRMED, simple

Add one column to `ledgerBudgets` in `schema.ts`:

```ts
pendingDeleteAt: timestamp("pending_delete_at"),
```

Nullable, no default, no `withTimezone` (matches the table's existing plain `timestamp` columns — `createdAt`/`updatedAt` on this same table are naive `timestamp`, not `timestamptz`; stay consistent with the table's own convention rather than the newer `{ withTimezone: true }` convention used on more recently added tables like the reconciliation tables). New migration `drizzle/migrations/0066_ledger_budgets_pending_delete.sql` (0065 is the current highest):

```sql
ALTER TABLE ledger_budgets ADD COLUMN IF NOT EXISTS pending_delete_at timestamp;
```

That is the whole migration. **No index needed.** The only new query pattern is the finalize-time purge (`WHERE entity_id = ? AND fiscal_year = ? AND pending_delete_at IS NOT NULL`), and `ledger_budgets` rows per `(entityId, fiscalYear)` number in the dozens (categories × 2 flows, one small nonprofit), not a scale where a partial index buys anything measurable. No unique-constraint change either — `pending_delete_at` is pure metadata on an existing row; the `(fundId, fiscalYear, categoryId, flow)` unique constraint is untouched and in fact does real work here (see item 6 below: it's precisely why "re-add the same category/flow" can never collide). Schema-is-source-of-truth flow is standard: `schema.ts` first, then the matching idempotent migration, same order as every prior increment on this table (0062/0063/0064).

### 2. The delete-semantics change — the load-bearing call

I read `commitValue`/`requestRemove`/`doRemove` in `budget-editor.tsx` directly (lines 159-252). Today, **two different gestures both resolve to the identical API call**: clicking the trash icon (`requestRemove` → `doRemove` → `commitValue(..., "")`) and simply blanking the input and blurring (`handleCommit` → `commitValue(..., "")`) — both send `PATCH { annualAmountCents: null }`, and `upsertBudgetLine` hard-deletes on `null` unconditionally. **This is the exact behavior soft-delete must retire for a persisted row, not just decorate.** If Phase 3 leaves blank-input-on-blur wired to `annualAmountCents: null`, a treasurer who fat-fingers backspace on a saved line still gets an instant, irreversible hard-delete — the soft-delete feature would only protect the trash-icon path while leaving the more accident-prone path (blank + blur/Enter) exactly as dangerous as today. That would ship a soft-delete feature that doesn't actually prevent the treasurer's stated problem.

**Ruling: unify both gestures onto soft-delete, with one exception for genuinely-unsaved state.**

- If a `ledger_budgets` row already exists for `(fundId, fiscalYear, categoryId, flow)` (i.e., there's something to lose), **both** the trash-icon click **and** blanking-the-input-then-blur/Enter must route to the new soft-delete write path (set `pending_delete_at`), never to `annualAmountCents: null`.
- If no row exists yet (a category that was never budgeted this year — input was already blank, nothing persisted), blanking is a true client-side no-op: no network call, matching today's UX for an already-empty field. There's nothing to soft-delete.
- **New write path:** recommend a sibling function next to `upsertBudgetLine` in `ledger-queries.ts` — e.g. `setBudgetLinePendingDelete(params: { fundId, fiscalYear, categoryId, flow, pendingDelete: boolean }, tx)` — that runs the *identical* guard sequence `upsertBudgetLine` already runs (fund/category lookup → `assertBudgetUnlocked` → the existing cause-line-children guard) and then does nothing but flip `pending_delete_at` to `now()` or `null`. It must **never** touch `annualAmountCents` — this is what "amount is preserved on soft-delete, restore brings the number back" requires, and it falls out for free if this function is a pure flag-flip with no amount branch at all.
  - The cause-line-children guard carrying over is not optional: a category in cause-breakdown mode (`BudgetCauseEditor`) has no trash icon in `budget-editor.tsx` today (confirmed by reading the JSX — the remove control only renders in the non-breakdown branch), so the UI already prevents this, but the server-side guard should still reject it defensively, exactly the same reason `upsertBudgetLine` checks it rather than trusting the client.
  - Recommend exposing this as a new mutually-exclusive body shape on the *existing* `PATCH /api/admin/ledger/budgets` route (`{ fundId, fiscalYear, categoryId, flow, pendingDelete: boolean }`, no `annualAmountCents` key) rather than a new route — keeps one endpoint, one auth/feature check, one 409-shape for the lock race, consistent with this feature's own precedent (the original guided-budgeting design's "one shared upsert core" call). Tech-lead should make the final call on route-vs-body-shape, but the shared-core principle should hold either way.
- **`annualAmountCents === null` on `upsertBudgetLine`/PATCH should be retired as a *live UI* path**, not necessarily deleted as code — it's already unreachable-from-the-UI dead weight once `budget-editor.tsx` is rewired (the seed route is the only other caller, and it's already flagged in B-28 as unreachable/pending deletion). Tech-lead must confirm no code path in the rewritten `budget-editor.tsx` ever sends `annualAmountCents: null` for a row with an existing `ledger_budgets` id.
- **Restore** = the same endpoint with `pendingDelete: false`. Per Flow 4, no confirm dialog — it's explicitly a non-destructive, corrective action.
- **Drop the existing remove-line `ConfirmDialog`** (`budget-editor.tsx:430-444`). Phase 1's own gap note flagged this as likely once removal becomes reversible, and Increment 2 is exactly the increment that makes it true — one click to mark deleted, one click to restore, no confirm needed for either. The one meaningful warning moves to the Approve & lock dialog's copy (Flow 5's "N line(s) marked for deletion will be permanently removed" clause). This is a *removal* of a confirm, not an introduction of a native dialog — does not create a CLAUDE.md violation.
- **Input stays disabled while a line is marked pending-delete** (per Flow 3's "input disabled while marked," which is also the Human-confirmed model). This single UI rule is what resolves edge case 6 below — see item 6.

### 3. Where the running-total exclusion lives — the subtle seam

I read `getFundReport` in full (`ledger-queries.ts:451-678`). **Its `totalIncomeCents`/`totalExpenseCents`/`endingCents` are computed from posted *actual transactions*, never from `budgetCents` — there is no fund-level aggregate of budget amounts anywhere inside this function.** The per-category `budgetCents` field exists only for per-line display and `variance` calc. Separately, I read `guided-budget-setup.tsx`'s `fundSums()` (lines 190-224): the "live running total" the treasurer sees while editing (the balance badge driving `computeBudgetBalanceStatus`) is computed **entirely client-side**, summing a local `lineValues` state that's seeded once from `budgetEditorLines[].budgetCents` and updated live via `BudgetEditor`'s `onInputChange` callback — it is never re-derived from a server round-trip or from `getFundReport` directly.

**Ruling: the exclusion is a budgeting-page-specific client projection. Do NOT filter `getFundReport` globally.**

1. `getFundReport`'s per-category `FundReportCategoryLine` gains one new **optional, purely informational** field — `pendingDeleteAt: string | null` — sourced off the `budgetRows` the function already fetches (free, no new query). This field must not participate in `budgetCents`, `variance`, `totalIncomeCents`, `totalExpenseCents`, or `endingCents` — all of those stay computed from the full, committed row set exactly as today.
2. This is the correct seam *because* `getFundReport`'s budget figures feed consumers that must keep showing the **committed** budget until finalize actually happens: `src/app/(dashboard)/admin/ledger/[fundSlug]/report/page.tsx` (the admin fund-report page) and, via `src/lib/financial-report-queries.ts`, `src/components/members/monthly-statement-table.tsx` — the **member-facing** Monthly Statement. If `getFundReport` excluded pending-delete rows globally, a treasurer marking a line pending-delete mid-session — before ever clicking Approve & lock — would immediately change what a member sees on their own statement. That is a real invariant violation, not a cosmetic inconsistency: the confirmed model is explicit that "only on finalize does the deletion take effect," and a member-facing leak of an uncommitted edit contradicts that directly.
3. `budgeting/page.tsx` must thread the new `pendingDeleteAt` field through into `budgetEditorLines`, alongside the Increment 1 `priorBudgetCents`/`priorActualCents` fields it already threads the same way.
4. `guided-budget-setup.tsx`'s `fundSums()` must exclude any key whose line is currently pending-delete from the `incomeCents`/`expenseCents` sums it feeds to `computeBudgetBalanceStatus` — and that exclusion must update **instantly** on click (soft-delete/restore), not wait for `router.refresh()`, exactly like `onInputChange` already updates the sum instantly on keystroke today. This requires threading a pending-delete-aware flag through the same per-key state `lineValues` already tracks.
5. `computeBudgetBalanceStatus` itself needs no change — it's already documented as a pure, presentation-only function over two pre-summed numbers; soft-delete awareness belongs in the caller that builds those numbers, not inside it.

**Every consumer of `getFundReport`'s budget figures, and how each is affected:** `budgeting/page.tsx` (this feature — gains the new field, must build the client-side exclusion); `[fundSlug]/report/page.tsx` (admin fund report — unaffected, correctly keeps showing committed figures); `monthly-statement-table.tsx` / `financial-report-queries.ts` (member-facing statement — unaffected, correctly keeps showing committed figures, and must stay unaffected per the reasoning above); `src/app/api/admin/ledger/categories/route.ts` (uses `getFundReport` for an unrelated purpose — worth a quick confirmation in Phase 3 that it doesn't read `budgetCents` in a way the new optional field could disturb, but adding an optional field is additive and should not require any change there).

### 4. The finalize transaction (approve/lock)

I read `POST /api/admin/ledger/budget-approvals/route.ts` in full. Today it does a single `db.insert(...).onConflictDoUpdate(...)` with **no `db.transaction()` wrapper at all** — unlike `upsertBudgetLine`, which already accepts an optional `tx` for exactly this reason.

**Ruling:**
- This route must be rewritten to open a `db.transaction(async (tx) => { ... })` that performs, atomically: (a) the existing lock-status upsert into `ledgerBudgetApprovals`, and (b) `DELETE FROM ledger_budgets WHERE entity_id = ? AND fiscal_year = ? AND pending_delete_at IS NOT NULL` (a plain Drizzle `.delete(ledgerBudgets).where(and(eq(entityId), eq(fiscalYear), isNotNull(pendingDeleteAt)))`, scoped by `entityId` since approval is keyed per-entity across all of that entity's funds, not per-fund).
- The pre-write lock check (`getBudgetApproval` → `isBudgetLocked`) should move **inside** the same transaction (pass `tx` through), not run before it as today — otherwise two concurrent finalize requests could both pass the check before either writes, the same class of check-then-act race `assertBudgetUnlocked` already guards against on the write side. This isn't a new problem this feature invents, but extending the route to a real transaction is the natural point to close it.
- **No cause-line cascade risk at finalize:** rows eligible for `pending_delete_at` can only be lump-sum rows (item 2's guard prevents a category with `ledger_budget_lines` children from ever being marked pending-delete), so the hard-delete at finalize never triggers the `ON DELETE CASCADE` on `ledgerBudgetLines.budgetId` unexpectedly. Worth a one-line comment in the migration or the delete call site noting this invariant explicitly, since it's easy to forget once cause-line-grain removal (unchanged, hard-delete-with-confirm) is running alongside soft-delete in the same UI.
- **Unlocking does not resurrect anything** — confirmed by reading `budget-approvals/unlock/route.ts`: unlock only flips `status` back to `'unlocked'` and never touches `ledger_budgets`. Since the pending-delete purge is a genuine, permanent hard-delete at lock time (no history/versioning table, consistent with today's remove-line behavior), there is nothing for unlock to restore — matches the existing invariant that removal has always been permanent once committed. Confirm this explicitly in the Phase 3 doc so it isn't assumed to need new work.

### 5. Invariants

- **Schema is the source of truth:** `schema.ts` gains `pendingDeleteAt` first, matching migration follows — standard flow, no deviation.
- **Migrations re-run on every deploy:** the single `ADD COLUMN IF NOT EXISTS` statement is idempotent by construction.
- **Permissions are the only gating mechanism:** no new `FEATURES.*` key. Soft-delete/restore gate identically to today's `showRemoveControl` (`canManage && !locked`, i.e., `FEATURES.LEDGER_MANAGE`); finalize stays gated by `FEATURES.LEDGER_APPROVE`. Every new write path (`setBudgetLinePendingDelete` or equivalent) must call `assertBudgetUnlocked` exactly like `upsertBudgetLine` does — this is the one new server-side gate this feature introduces, and it must be present on both the soft-delete and the restore direction, not just soft-delete.
- **No native dialogs:** removing the remove-line `ConfirmDialog` (item 2) is a simplification, not a violation — nothing here introduces `window.confirm`/`alert`/`prompt`. The updated Approve & lock dialog stays a `ConfirmDialog`.
- **Server/client boundary:** `budget-editor.tsx` and `guided-budget-setup.tsx` are already `"use client"` and stay that way — this feature is entirely local-state-driven (disabled inputs, instant visual toggle, instant running-total exclusion) with no new Server Component needed. The new write path is a route handler under the existing `src/app/api/admin/ledger/budgets` surface, consistent with API/Action Rules.
- **Member-facing exposure boundary:** unaffected. This entire feature lives inside `(dashboard)/admin/ledger/budgeting` and the `PATCH /api/admin/ledger/budgets` route family — no public or member-portal route is touched, and item 3's ruling is specifically what keeps it that way for the Monthly Statement.

### 6. Edge cases — ruled

- **A budget never gets locked, pending-deletes persist indefinitely:** Acceptable for v1. The row (and its stale amount) stays in `ledger_budgets` and therefore stays in `getFundReport`'s committed figures (fund report, member statement) until finalize — a "marked but never actually committed" state that can persist indefinitely. This matches existing precedent (nothing today forces a fund's budget to ever get locked either) and is a direct, intended consequence of the confirmed model tying commit-of-deletes to finalize only. **No "apply without lock" affordance should be added** — that would be scope creep past the confirmed model and would reopen exactly the "does removal without finalize actually take effect?" question the treasurer already resolved. Document as a known tradeoff, not a defect.
- **Editing a pending-delete line's amount:** Not directly reachable — item 2's ruling disables the input while a line is marked deleted, so there's no path to type a new amount without clicking Restore first. No separate server-side handling needed beyond that UI rule (though the server-side `setBudgetLinePendingDelete`/amount-upsert functions should each independently reject/no-op the "wrong" operation defensively, the same defense-in-depth posture the rest of this codebase already takes toward client-side gates).
- **Soft-delete then re-add the same `(categoryId, flow)`:** Resolved by construction, not by special-casing — the row is never actually deleted, so there is no uniqueness collision to handle. "Re-add" is just "click Restore, then edit the amount" (two clicks against the one existing row), not a new insert against the `(fundId, fiscalYear, categoryId, flow)` unique constraint. This is exactly why item 1 rules that no constraint change is needed.

### Notes for Phase 3 (tech-lead)

- Resolve the exact API shape for item 2 (new body field on the existing PATCH route vs. a new route) and name the sibling query function precisely (`setBudgetLinePendingDelete` is a suggested name, not a mandate).
- Write the exact `FundReportCategoryLine`/`BudgetLine`/`FundSetupItem.budgetEditorLines` type additions for `pendingDeleteAt`, threading it from `getFundReport` → `page.tsx` → `GuidedBudgetSetup` → `BudgetEditor`.
- Specify the exact visual treatment for a pending-delete row (strikethrough + gray background + badge copy, per Phase 1 Flow 3) and the Restore control's placement (replaces the trash icon in the same slot).
- Specify the updated Approve & lock `ConfirmDialog` copy (Flow 5's new clause) and confirm the count of pending-delete lines is computed client-side from the same data threaded through in item 3.
- Name the unit tests this needs: `setBudgetLinePendingDelete` guard sequence (locked → 409, cause-line children → 409, happy path both directions), the finalize-transaction purge (locked rows past finalize are gone; non-pending rows survive), and `fundSums()`'s exclusion of pending-delete lines from the balance calc.
- The already-flagged follow-ups from Increment 1 (B-28: delete the dead seed route/`computeSeedFromPriorYear`) are unrelated to this increment and don't block it — no need to bundle that cleanup in here.

---

# Phase 3 — Technical Design (tech-lead)

Increment 1's Phase 3 was compressed into the implementation brief per the 7pm-deadline accelerated pipeline (see the Phase 2 skip note above) — no separate Phase 3 doc was written for it, and Phase 4's "Implementer Notes" section stands in its place. Increment 2 gets the full design pass below, per the architect's Phase 2 verdict that this piece "deserves its own tech-lead design pass."

## Increment 2 — Phase 3 (Technical Design) — 2026-07-28

**Owner:** tech-lead
**Scope:** Soft-delete/restore-until-finalize for `ledger_budgets` (category/flow grain), implementing DECISION-052's rulings exactly and closing the open questions the architect left for this phase. Grounded by reading `src/lib/db/schema.ts` (`ledgerBudgets`/`ledgerBudgetApprovals`/`ledgerBudgetLines`), `src/lib/ledger-queries.ts` (`getFundReport`, `upsertBudgetLine`, `assertBudgetUnlocked`, `getBudgetApproval`), the budget-approvals/unlock routes, `src/components/admin/ledger/budget-editor.tsx` and `guided-budget-setup.tsx`, and `budget-print-worksheet.tsx` in full.

### Summary

Add a nullable `pending_delete_at` column to `ledger_budgets` so removing a budget line becomes reversible until the budget is finalized. Both the trash-icon control and blanking-an-input-then-blur route to the same new soft-delete write path for any already-persisted row — the amount is preserved, not cleared, so Restore brings the number back exactly. The line stays visible with a "deleted" visual treatment and a Restore toggle; its amount input is disabled while pending-delete. The running-total balance badge excludes pending-delete lines instantly (client-side only); `getFundReport`'s committed budget figures — which also feed the admin fund report and the member-facing Monthly Statement — are completely unaffected, so nothing changes for a member or a board reviewer until the treasurer actually clicks Approve & lock. That click becomes the one moment pending deletes take effect: the approve/lock route is rewritten to run the lock-status write and the pending-delete purge inside a single transaction, closing a pre-existing check-then-act race in the same motion. Cause-line (labeled beneficiary) removal is untouched — it stays an immediate hard-delete, and a category with cause-line children can never be marked pending-delete.

### Permissions

No new `FEATURES.*` key. Reuses the page's existing two-tier gate exactly as today:
- **`FEATURES.LEDGER_MANAGE`** gates soft-delete and restore — identical to today's `showRemoveControl = canManage && !locked`. Every write goes through `assertBudgetUnlocked`, so a stale tab racing a lock still gets the server's 409 regardless of what the disabled UI prop shows.
- **`FEATURES.LEDGER_APPROVE`** gates finalize (Approve & lock) — unchanged. Finalize is the only moment pending deletes commit.
- No change to default role bindings (Treasurer/Assistant Treasurer hold `LEDGER_MANAGE`; Board/President hold `LEDGER_APPROVE`, per existing bindings).

### API Contract

**`PATCH /api/admin/ledger/budgets`** — extended, not replaced. Two mutually-exclusive request shapes on the same route (DECISION-053 item 1):

```
// Shape A — amount write (existing, unchanged)
{ fundId, fiscalYear, categoryId, flow, annualAmountCents: number | null }

// Shape B — pending-delete write (new)
{ fundId, fiscalYear, categoryId, flow, pendingDelete: boolean }
```

- If a request body contains both `annualAmountCents` and `pendingDelete` → **400** `"Provide either annualAmountCents or pendingDelete, not both."`
- If neither key is present → **400**, same shape-validation message the route already returns today for a missing/invalid `annualAmountCents`.
- Shape A behavior is **completely unchanged** — still calls `upsertBudgetLine`, still accepts `annualAmountCents: null` to hard-delete a row with no cause-line children (kept for back-compat / any future non-UI caller; the redesigned client, per below, never sends it anymore for a row that ever existed).
- Shape B dispatches to a new sibling function, `setBudgetLinePendingDelete(params, tx)` in `src/lib/ledger-queries.ts`, mirroring `upsertBudgetLine`'s signature and guard order exactly:
  1. Fund + category lookup (400/404 on missing).
  2. `assertBudgetUnlocked(fund.entityId, fiscalYear, tx)` → 409 `{ reason: "locked" }` on a locked budget — run for **both** `pendingDelete: true` and `pendingDelete: false` (restore must be lock-guarded too, per the architect's explicit ruling that this is "the one new server-side gate... present on both the soft-delete and the restore direction, not just soft-delete").
  3. Cause-line-children guard (the same query `upsertBudgetLine` already runs) → 409 `{ reason: "has_cause_breakdown" }` if the row has any `ledger_budget_lines` children. Run on both directions defensively, even though a childful row can never legitimately reach a pending-delete state in the first place.
  4. **Row-must-exist check**: if no `ledger_budgets` row matches `(fundId, fiscalYear, categoryId, flow)` → **404** `"No budget line exists for this category to modify."` (DECISION-053 item 2 — defense-in-depth only; the client-side no-op rule below means the UI should never actually trigger this in normal use).
  5. Flip only `pending_delete_at` — set to `now()` when `pendingDelete: true`, `null` when `pendingDelete: false`. **`annual_amount_cents` is never read or written by this function** — this is what makes "restore brings the number back" true by construction, not by special-casing.
- **Response 200:** `{ action: "pending-delete" | "restored" }` (no `id` needed — the row already exists and its id doesn't change).
- **Recommend factoring the fund/category lookup + cause-line-children query into a small shared private helper** used by both `upsertBudgetLine` and `setBudgetLinePendingDelete`, so the guard sequence has one implementation, not two copies that could drift. Naming this as a refactor note for api-developer, not a hard requirement if time-boxed.

**Blank-input-then-blur vs. trash-icon mapping (both client gestures, same server call):**
- A new pure function, `resolveBudgetLineDeleteAction(hasExistingRow: boolean, rawValue: string): "soft-delete" | "noop"` lives in `src/lib/ledger.ts` next to `isBudgetLocked`/`computeBudgetBalanceStatus`/`formatBudgetReferenceCents` (DECISION-053 item 3). It returns `"soft-delete"` when `rawValue.trim() === "" && hasExistingRow`, else `"noop"`.
- **Trash icon click** (`requestRemove`/`doRemove` in `budget-editor.tsx`): always calls `resolveBudgetLineDeleteAction(line.budgetCents !== null, inputs[key] ?? "")`. `"soft-delete"` → `PATCH { pendingDelete: true }`. `"noop"` → nothing happens (there's no row to remove — e.g., an unsaved, still-blank line rendered with a trash icon before anything was ever typed).
- **Blank + blur/Enter** (`handleCommit`/`commitValue`): when the committed raw value is `""`, call the same `resolveBudgetLineDeleteAction`. `"soft-delete"` → the same `PATCH { pendingDelete: true }` (never `annualAmountCents: null`). `"noop"` → no network call at all — this is the existing `dirtyRef` short-circuit plus the "no row exists" check working together; nothing new to build for this case beyond routing the non-empty branch correctly.
- **`hasExistingRow` is read directly off the current `line.budgetCents !== null` prop**, not a separately-tracked piece of local state — this holds even for a pending-delete row, because the amount is preserved on soft-delete (a pending-delete row's `budgetCents` stays non-null). Every commit already triggers `router.refresh()`, so `line` reflects true server state by the time any subsequent gesture fires.
- **Restore** (the button that replaces the trash icon on a pending-delete row): always `PATCH { pendingDelete: false }`, no confirm, no `resolveBudgetLineDeleteAction` check needed (a pending-delete row always has an existing row by definition).
- **The existing remove-line `ConfirmDialog` (`budget-editor.tsx:430-444`) is deleted**, not repurposed. Soft-delete and restore are both single-click, no-confirm actions now.

**`POST /api/admin/ledger/budget-approvals` (approve/lock, "finalize") — rewritten to be transactional:**

```
Body (unchanged): { entityId, fiscalYear, boardMinute }
Response 200 (unchanged): { entityId, fiscalYear, status: 'locked', approvedByUserId, approvedAt, boardMinute }
```

The route body wraps everything after request validation in one `db.transaction(async (tx) => { ... })`:
1. **Lock-check moves inside the transaction.** `getBudgetApproval(entityId, fiscalYear, tx)` — this requires adding an optional `tx: DrizzleTransaction | typeof db = db` parameter to `getBudgetApproval` (it currently only accepts the module-level `db`, unlike `assertBudgetUnlocked` which already has this parameter). If `isBudgetLocked(current)` → abort the transaction and return the existing 409 ("This budget is already locked...").
2. **The lock-status upsert** — unchanged `insert(...).onConflictDoUpdate(...)` into `ledgerBudgetApprovals`, now run against `tx` instead of the module `db`.
3. **The pending-delete purge** — `tx.delete(ledgerBudgets).where(and(eq(ledgerBudgets.entityId, entityId), eq(ledgerBudgets.fiscalYear, fiscalYear), isNotNull(ledgerBudgets.pendingDeleteAt)))`. Scoped by `entityId` (not per-fund), matching how approval itself is entity-wide across all of that entity's funds.
4. Both writes commit together, or neither does — closing the pre-existing check-then-act race (two concurrent finalize requests can no longer both pass the lock check before either writes).
- **No response shape change** — the client already knows the pending-delete count from its own local state (see Component Plan below), so there's no need to return a purge count.
- **Unlock (`POST .../unlock`) is unchanged** — confirmed by reading it in full: it only ever flips `status` and writes the unlock trio, never touches `ledger_budgets`. Since the purge at finalize is a genuine hard-delete with no history table, there is nothing for unlock to resurrect — this matches today's existing behavior for a hard-deleted budget line (removal has always been permanent once committed).

### Data Model

- `src/lib/db/schema.ts` — `ledgerBudgets` gains one nullable column:
  ```ts
  pendingDeleteAt: timestamp("pending_delete_at"),
  ```
  Plain (non-timezone) `timestamp`, matching the table's existing `createdAt`/`updatedAt` convention. No default, no index, no constraint change — the existing `(fundId, fiscalYear, categoryId, flow)` unique constraint is untouched and is exactly why "soft-delete, then re-add the same category/flow" needs no special handling (the row was never actually gone).
- **Migration `drizzle/migrations/0066_ledger_budgets_pending_delete.sql`** (0065 is the current highest) — the entire migration:
  ```sql
  ALTER TABLE ledger_budgets ADD COLUMN IF NOT EXISTS pending_delete_at timestamp;
  ```
  Idempotent by construction.
- **`getFundReport`'s `FundReportCategoryLine`** (`src/lib/ledger-queries.ts`) gains one new field:
  ```ts
  pendingDeleteAt: string | null;
  ```
  Sourced off the `budgetRows` the function already fetches (free — no new query), serialized to an ISO string at this boundary rather than passed as a raw `Date` (DECISION-053 item 4, matching the existing convention where `budgeting/page.tsx`'s `formatApprovalDate` already converts `Date` fields to strings before handing them to a client component). **Confirmed: `budgetCents`, `variance`, `causeLines`, `totalIncomeCents`, `totalExpenseCents`, `endingCents` are completely unchanged** — every one of those stays computed from the full, committed row set exactly as today. This field is purely informational and participates in nothing else `getFundReport` computes.
- **No other schema change.** `ledgerBudgetLines` and `ledgerBudgetApprovals` are untouched.

### Component / Page Plan

**Files to modify (no new files/components needed):**

- **`src/lib/db/schema.ts`** — add `pendingDeleteAt` to `ledgerBudgets`.
- **`src/lib/ledger-queries.ts`** — `getFundReport`'s `FundReportCategoryLine` gains `pendingDeleteAt`; new `setBudgetLinePendingDelete`; `getBudgetApproval` gains an optional `tx` param.
- **`src/lib/ledger.ts`** — new pure `resolveBudgetLineDeleteAction(hasExistingRow, rawValue)`.
- **`src/app/api/admin/ledger/budgets/route.ts`** — branch on `pendingDelete` vs. `annualAmountCents` in the request body; 400 when both/neither present.
- **`src/app/api/admin/ledger/budget-approvals/route.ts`** — wrap in `db.transaction()`; move the lock check inside; add the pending-delete purge.
- **`src/app/(dashboard)/admin/ledger/budgeting/page.tsx`** — thread `pendingDeleteAt` (a string or null, straight off `getFundReport`'s target-FY report — **not** the prior-FY report, which has no bearing here) into `budgetEditorLines`, the same way `priorBudgetCents`/`priorActualCents` are already threaded through.
- **`src/components/admin/ledger/guided-budget-setup.tsx`**:
  - `FundSetupItem.budgetEditorLines[].pendingDeleteAt: string | null` added to the type.
  - New client state `pendingDeleteKeys: Record<string, Record<string, boolean>>`, keyed identically to `lineValues` (`fundId` → `` `${categoryId}_${flow}` ``), initialized from each line's `pendingDeleteAt !== null`.
  - `BudgetEditor` gains a new prop, `onPendingDeleteChange?: (key: string, pendingDelete: boolean) => void`, fired the instant a soft-delete/restore click resolves optimistically (mirrors how `onInputChange` already fires on every keystroke, ahead of the network round-trip) — `GuidedBudgetSetup` wires this to update `pendingDeleteKeys` immediately, then `router.refresh()` (already called by every successful commit) reconciles it with server truth.
  - `fundSums(fundId)` excludes any key where `pendingDeleteKeys[fundId]?.[key]` is true from both `incomeCents` and `expenseCents` (DECISION-052 item 1's live-exclusion ruling, made concrete).
  - **Approve & lock `ConfirmDialog` copy update**: compute `pendingDeleteCount` by summing `pendingDeleteKeys` across all funds (the same live client state `fundSums()` reads — instant, no extra round-trip). New copy: `` `This records board minute "${boardMinute.trim()}" and makes every fund's ${targetLabel} budget read-only.${pendingDeleteCount > 0 ? ` ${pendingDeleteCount} line(s) marked for deletion will be permanently removed.` : ""} It can be unlocked later to amend, then must be re-approved.` ``. Set `destructive={pendingDeleteCount > 0}` on this dialog (red confirm button only when something will actually be lost) — this is the one meaningful warning DECISION-052/the architect's ruling moved here from the now-deleted remove-line confirm.
- **`src/components/admin/ledger/budget-editor.tsx`**:
  - `BudgetLine` type gains `pendingDeleteAt?: string | null`.
  - Delete the `removeConfirm` state, the `ConfirmDialog` at the bottom of the file, and `requestRemove`'s amount-based branch (confirm-vs-immediate) — every removal is now immediate and reversible.
  - New rendering branch per line: when `line.pendingDeleteAt` is set, render the row with strikethrough on the category name, a muted/gray row background, a small badge reading "Deleted — will be removed when this budget is finalized," the amount still visible in the input **with the input `disabled`**, and the trash-icon button replaced by a "Restore" button in the same slot (same `min-h-[44px] min-w-[44px]` touch target).
  - The non-pending row's trash-icon handler and the blank+blur handler both route through `resolveBudgetLineDeleteAction` as specified in the API Contract section, then `PATCH { pendingDelete: true }` on `"soft-delete"`.
  - Restore button: `PATCH { pendingDelete: false }`, no confirm.
- **`src/components/admin/ledger/budget-print-worksheet.tsx`** — `PrintLine` gains `pendingDeleteAt: string | null`; `FlowTable` filters `lines.filter((l) => l.pendingDeleteAt === null)` before rendering (DECISION-053 item 5 — **pending-delete lines do not print**, since the worksheet is a forward-looking plan of what the budget will actually be, and a line already marked for removal isn't part of that). If a fund's flow table ends up with zero remaining lines after the filter, it's simply omitted, same as today's `if (income.length === 0 && expense.length === 0) return null` behavior on `FundWorksheet`.

### Implementation Order

1. **Schema** — add `pendingDeleteAt` to `ledgerBudgets` in `schema.ts`; write `drizzle/migrations/0066_ledger_budgets_pending_delete.sql`. Run `pnpm db:migrate` locally and confirm the column exists.
2. **Queries** — `setBudgetLinePendingDelete` in `ledger-queries.ts` (guard sequence + flag flip only); `getFundReport`'s `pendingDeleteAt` field addition; `getBudgetApproval`'s optional `tx` param; the rewritten transactional approve/lock route (lock-check-inside-tx + purge). Write the named unit tests below alongside these.
3. **Routes** — `PATCH /api/admin/ledger/budgets`'s new body-shape branch; confirm the 400 (both/neither key), 404 (no row), and 409 (locked / has-cause-breakdown, both directions) responses.
4. **UI** — `resolveBudgetLineDeleteAction` in `ledger.ts`; `budget-editor.tsx`'s pending-delete row rendering + Restore control + dropped `ConfirmDialog`; `guided-budget-setup.tsx`'s `pendingDeleteKeys` state, `fundSums()` exclusion, and the updated Approve dialog copy/`destructive` toggle; `budget-print-worksheet.tsx`'s filter.
5. **Tests** — the eleven named in the section below, all passing, hermetic (`unset DATABASE_URL DB_URL; pnpm test`).
6. **Release notes** — a `docs/release-notes/vX.Y.md` entry once QA passes, via the `/release-notes` skill (treasurer-facing framing: "budget line removal is now reversible until you lock the budget").

### Edge Cases & Risks

- **Check-then-act race on finalize.** Closed by wrapping the lock-check and the purge in one `db.transaction()` (API Contract section above) — two concurrent finalize requests can no longer both read "unlocked" before either commits.
- **A row with cause-line children.** `setBudgetLinePendingDelete` runs the identical cause-line-children guard `upsertBudgetLine` already runs, on both directions. The UI never renders a trash icon for a cause-breakdown row in the first place (confirmed by reading `budget-editor.tsx`'s JSX — the remove control only exists in the non-breakdown branch), so this 409 is pure defense-in-depth, not a reachable UI path today.
- **Blank input on a never-saved row.** `resolveBudgetLineDeleteAction(false, "")` → `"noop"`; no network call, no visual change. Already partially free from the existing `dirtyRef` short-circuit (a field that was never touched never calls `handleCommit` at all); the new function makes the "even if touched, there's nothing to lose" case explicit and testable.
- **Soft-delete → restore → edit.** Restore clears `pendingDeleteAt` and re-enables the input with its preserved amount showing; a subsequent edit is an ordinary `PATCH { annualAmountCents }` — no special handling needed, this is just the input becoming editable again.
- **A budget that never gets finalized.** Pending-delete rows (and their preserved amounts) persist indefinitely in `ledger_budgets`, and therefore stay in `getFundReport`'s committed figures (report page, member statement) — accepted as a known tradeoff per the architect's ruling, not a defect. No "apply without lock" affordance is being added.
- **Print worksheet.** Confirmed: pending-delete lines are excluded from the printout entirely (DECISION-053 item 5) — they represent categories about to be removed, not part of the plan being printed for hand-annotation.
- **Member statement / admin fund report leak.** The one regression this whole design exists to prevent: `getFundReport`'s `budgetCents`/`variance`/`totalIncomeCents`/`totalExpenseCents`/`endingCents` must be byte-for-byte identical whether or not any row in the fund+FY has `pendingDeleteAt` set. This is asserted directly by unit test #7 below, not just reasoned about — a pending-delete row must remain fully "live" everywhere except the two client-side UI surfaces (the balance badge and the print worksheet) that are explicitly scoped to change.
- **`getBudgetApproval`'s new `tx` parameter.** A signature change to an existing exported function — confirm its one other caller (`budgeting/page.tsx`, called with no `tx` argument, i.e. the default `db`) still typechecks unchanged; the parameter is optional and defaults exactly like `assertBudgetUnlocked`'s.

### Unit Tests to Write in Phase 4

1. `setBudgetLinePendingDelete` sets `pending_delete_at` and leaves `annual_amount_cents` byte-for-byte unchanged (happy path, soft-delete direction).
2. `setBudgetLinePendingDelete` restore direction clears `pending_delete_at`, again leaving the amount unchanged.
3. `setBudgetLinePendingDelete` rejects with 409 `{ reason: "locked" }` on a locked budget, for both `pendingDelete: true` and `pendingDelete: false`.
4. `setBudgetLinePendingDelete` rejects with 409 `{ reason: "has_cause_breakdown" }` for a row with `ledger_budget_lines` children.
5. `setBudgetLinePendingDelete` returns 404 when no row exists for the `(fundId, fiscalYear, categoryId, flow)` tuple.
6. `resolveBudgetLineDeleteAction(hasExistingRow, rawValue)` — pure-function table test: blank + existing row → `"soft-delete"`; blank + no row → `"noop"`; non-blank → `"noop"` (unreachable in practice via the blur handler, but the function's contract should still be explicit) for both true/false combinations.
7. **Regression guard**: `getFundReport`'s `budgetCents`, `variance`, `totalIncomeCents`, `totalExpenseCents`, `endingCents` are identical for a fund+FY before and after marking one of its budget rows `pending_delete_at` — proves the member-statement/fund-report leak this design is built to prevent doesn't exist.
8. `fundSums()` (or its extracted pure core, if factored out for testability) excludes a pending-delete line's amount from both `incomeCents` and `expenseCents`.
9. The approve/lock route: a budget with 1+ pending-delete rows, on successful finalize, ends with those rows physically gone from `ledger_budgets` and the lock-status row set to `'locked'` — both in the same request.
10. The approve/lock route: non-pending-delete rows for the same fund+FY survive finalize untouched.
11. Unlock, called after a finalize that purged pending-delete rows, does not cause those rows to reappear (confirms the "hard delete, no history" invariant holds through an unlock/re-approve cycle).

### Implementer Sequence

1. **database-admin** — schema (`pendingDeleteAt` column) + migration `0066_ledger_budgets_pending_delete.sql`.
2. **api-developer** — `setBudgetLinePendingDelete`, `getFundReport`'s field addition, `getBudgetApproval`'s `tx` param, the rewritten transactional approve/lock route, the `PATCH /budgets` route's new body branch, and unit tests #1–5, #7, #9–11 above.
3. **ux-developer** — `resolveBudgetLineDeleteAction` (+ unit test #6), `budget-editor.tsx`'s pending-delete row treatment + Restore control + dropped `ConfirmDialog`, `guided-budget-setup.tsx`'s `pendingDeleteKeys`/`fundSums()` exclusion (+ unit test #8) + Approve dialog copy/`destructive` toggle, and `budget-print-worksheet.tsx`'s filter.

**Gate:** design complete, implementer sequence named above. No architectural concern surfaced (Phase 2's suggestions are fully resolved by this doc); no functional inconsistency surfaced against Phase 1. Ready for Phase 4 — database-admin first.

---

# Phase 4 — Implementation (UI) — 2026-07-28

**Owner:** ux-developer
**Status:** Complete

## Summary

Increment 1 shipped ahead of the 7pm budget meeting: read-only prior-year (Prior Budget / Prior Actual) reference columns on every budget line, a print-only worksheet with hand-annotation blank lines and page-break protection per category, and full removal of the seed/preview flow. No schema change, no new dependency, no new permission — matches the Phase 1 scope exactly.

## Files Created

- `src/components/admin/ledger/print-budget-button.tsx` — client leaf, copy of `print-statement-button.tsx`'s `window.print()` pattern, relabeled for the budgeting page.
- `src/components/admin/ledger/budget-print-worksheet.tsx` — Server Component, `hidden print:block`. Renders one titled table per fund per flow (Income/Expense): Category | Prior Budget (FYprior) | Prior Actual (FYprior) | New Budget (FYtarget), each category in its own `<tbody className="break-inside-avoid-page">` with 2 blank ruled rows underneath for hand annotation. Built from the same static `fundItems` data used to render `GuidedBudgetSetup` — not the live `BudgetEditor` input state — so it always reflects the last-saved value.

## Files Modified

- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` — added a second parallel `getFundReport(fund.id, priorFY)` call alongside the existing `targetFY` call; threads `priorBudgetCents`/`priorActualCents` per category/flow into `budgetEditorLines`. Removed the `computeSeedFromPriorYear` call and its `previewByFundId`/`fundPreview` plumbing (dead once the seed UI was removed). Wrapped the interactive controls (breadcrumb, header, entity/FY selectors, `GuidedBudgetSetup`) in a `print:hidden` div; added `PrintBudgetButton` next to the selectors and `BudgetPrintWorksheet` as a sibling outside the `print:hidden` wrapper. Updated `PageHeader` copy — dropped the now-inaccurate "Seed FYtarget from FYprior" subtitle and "Guided Budget Setup" title (renamed to "Budget Planning" / "Treasury · Budgeting").
- `src/components/admin/ledger/guided-budget-setup.tsx` — removed `ProposedLinesList`, the "Seed all funds" entity-wide card, the per-fund seed-preview + "Seed this fund"/"Overwrite…" buttons, the `seedCauseLines` checkbox, `runSeed`/`handleConfirmOverwrite`/`startFillEmptySeed`/`handleConfirmCauseSeed`, the `SeedMode`/`SeedResponse*` types, and the two seed-related `ConfirmDialog`s (Overwrite, "Seed with cause-level detail?"). Removed the now-dead `seedableCount`/`collisionCount`/`seededFromBudgetFallback`/`seedableLines` fields from `FundSetupItem`, and the unused `priorFiscalYear` prop. Added `priorBudgetCents`/`priorActualCents` to `FundSetupItem.budgetEditorLines`' type (passthrough to `BudgetEditor`). The Approve/Lock + Unlock panels, balance badges, `BudgetEditor` line-level editing, and "+ Add category" flow are untouched.
- `src/components/admin/ledger/budget-editor.tsx` — added optional `priorBudgetCents`/`priorActualCents` to `BudgetLine`; new `ReferenceValue` read-only cell component; restructured each non-breakdown row from a single flex row into category-name-row + reference-columns-and-input-row, using `grid-cols-2` for the two reference cells so they shrink instead of overflowing at 360px (`sm:` breakpoint restores the wider fixed-width layout). Cause-breakdown-mode rows (`BudgetCauseEditor`) are unchanged — per Phase 1's scope note, cause-line-grain prior-year reference is out of v1.
- `src/app/(dashboard)/admin/layout.tsx` — wrapped `AdminSidebar` in a `print:hidden` div and added `print:pl-0`/`print:p-0` to the content wrapper, so admin-page printouts (this worksheet, and the existing `/admin/ledger/guide` print flow) don't print the sidebar or its reserved gutter.
- `src/components/layout/footer.tsx` — added `print:hidden` to the site footer (it has no route-based hide logic and was rendering under every admin page print, unlike `Header` which already early-returns `null` on `/admin*`).
- `src/lib/ledger.ts` — added `formatBudgetReferenceCents(cents: number | null): string` — pure formatter (`null` → "—", else `$X.XX`/`-$X.XX`), shared by `BudgetEditor`'s `ReferenceValue` cells and `BudgetPrintWorksheet`'s table cells.
- `src/lib/ledger.test.ts` — added a `describe("formatBudgetReferenceCents", …)` block (4 cases: null, zero, positive, negative).

## Schema Changes

None — Increment 1 is read-only reuse of `getFundReport`, as scoped.

## Implementer Notes

- Print worksheet is a static snapshot, not a live mirror of unsaved `BudgetEditor` input — matches Phase 1's explicit recommendation ("render the current input's value as static text, not a live control"). If a treasurer prints mid-edit before a field blurs/saves, the printout shows the last saved value, not the in-progress keystroke. Acceptable per design; not a bug.
- `break-inside-avoid-page` is applied per-category via one `<tbody>` per category (multiple `<tbody>` per `<table>` is valid HTML) rather than per-fund — a fund with many categories legitimately spans multiple pages, so only the category + its 2 blank lines are protected from being split, per the Phase 1 gap note.
- Left the seed API route (`/api/admin/ledger/budgets/seed`) and `computeSeedFromPriorYear`/`SeedProposedLine` in `ledger-queries.ts`/`ledger.ts` in place — unreachable from the UI now but not deleted, since deleting server code wasn't in scope and there was no time pressure to do it tonight. Flagged as a follow-up below.
- `GuidedBudgetSetup` was not renamed or split — it's still doing real work (Approve/Lock, Unlock, balance badges, `BudgetEditor` composition, add-category) after the seed code was stripped, so it wasn't vestigial per the task's own test.
- Gates: `pnpm exec tsc --noEmit` clean. `unset DATABASE_URL DB_URL; pnpm test` → 648 passed (was 644, +4 new `formatBudgetReferenceCents` tests), all hermetic. `pnpm build:only` → exit 0, `/admin/ledger/budgeting` present in the route list. Dev-server smoke: unauthenticated `GET /admin/ledger/budgeting` → 307 to `/signin` (correct auth-gate behavior), migrations replayed idempotently (expected "already exists, skipping" NOTICEs only, no errors). No `console.log` in any touched file.

## QA Click-Through List

1. **Reference columns.** Sign in as a `LEDGER_MANAGE` (or `LEDGER_APPROVE`) holder, open `/admin/ledger/budgeting`. Each category row should show "Prior Budget" / "Prior Actual" (small gray labels, dollar values below) to the left of the editable "New Budget" input. Values should match what `/admin/ledger/[fundSlug]/report?fy=<priorFY>` shows for the same fund/category/flow. A category with no prior-year data (e.g. brand-new) should show "—" in both reference cells, not a blank/broken cell.
2. **Print worksheet.** Click "Print / Save as PDF" next to the entity/FY selectors → browser print preview should show ONLY a titled worksheet (entity name, FY, prior-year reference) with one table per fund per flow, columns Category | Prior Budget | Prior Actual | New Budget, and 2 blank ruled lines under every category. No sidebar, no header/footer, no buttons/selectors, no Approve/Unlock panel, no trash icons. Check a fund with enough categories to span a page break — a category + its blank lines should never split across the page boundary.
3. **Seed flow gone.** Confirm there is no "Seed all funds", "Seed this fund", "Overwrite…" button, or `seedCauseLines` checkbox anywhere on the page, locked or unlocked. Existing FY2026 budget data (already populated from the earlier seed script per the human note in this doc) should still display normally in both the editor and the printout.
4. **Mobile 360px.** Resize/emulate to 360px width. Budget rows should stack (category name on its own line, then a 3-across reference/input row below) with no horizontal page scroll. The "Break down by cause" affordance and the cause-line editor (unaffected by this change) should still render normally.
5. **Existing flows unaffected.** Approve & lock, Unlock, "+ Add category" (existing and new), and the labeled cause-line editor (`BudgetCauseEditor`) all still work exactly as before — this increment didn't touch their code paths.

## Follow-Ups (not tonight)

- Delete the now-unreachable seed API route (`/api/admin/ledger/budgets/seed`) and `computeSeedFromPriorYear`/`SeedProposedLine` once confirmed nothing else depends on them.
- `/admin/ledger/guide#budgeting` (the in-app Treasury User's Guide) was not checked for stale "seed from last year" instructions — worth a pass since the guide is now describing a removed flow.
- Increment 2 (soft-delete/restore-until-finalize) remains fully deferred per the Human Answers section above — needs its own architect + tech-lead pass.

---

# Phase 5 — Verification (qa)

**Date:** 2026-07-28
**Verified by:** qa

## Summary

**PASS.** All four required gates are green (typecheck, hermetic unit tests at 648, production build with `/admin/ledger/budgeting` in the manifest, and a signed-in dev-server smoke test of the live page). Spot-checked the Prior-Year Budget/Actual reference columns against the raw `ledger_transactions` table for all 9 Foundation Charitable-Fund categories with FY2025 activity — every rendered "Prior Actual" dollar figure matches the DB exactly, reference cells are confirmed read-only (no `value=` attribute ever appears on the "New Budget" `<input>`s), the print worksheet renders as static server HTML with the correct 2-blank-row-per-category / `break-inside-avoid-page` structure and zero `<input>`/`<button>` elements inside it, and the seed flow (`ProposedLinesList`, "Seed"/"Overwrite" buttons, `seedCauseLines` checkbox) is completely absent from the rendered page — a case-insensitive grep for "seed" across the full page HTML returns zero hits. No regression found in Approve & lock, Add category, or the FY-selector default. One important **non-code, data-state finding** for tonight: this local DB currently has **zero rows in `ledger_budgets`, for any entity or fiscal year** — the work-log's note that "the existing FY2026 budget is already populated from the earlier seed script" does not hold on this database. `scripts/seed-fy2026-foundation-budget.ts` exists but is a lump-splitting script (defaults to DRY RUN) that assumes the lump budget rows already exist; it doesn't create them. This isn't an Increment 1 defect — the code correctly shows "—" for absent prior-year and current-year budget data — but it means the printout will show every "New Budget" cell blank until numbers are typed in first. Flagging this loudly since it's meeting-critical and outside this feature's code.

## Gate 1 — Type Check

`pnpm exec tsc --noEmit`: **PASS** (clean, zero output).

## Gate 2 — Hermetic Unit Tests

`unset DATABASE_URL DB_URL; pnpm test`: **PASS**
Total: 648 | Passed: 648 | Failed: 0
Duration: 998ms (22 test files)
Includes the 4 new `formatBudgetReferenceCents` cases in `src/lib/ledger.test.ts:2160-2176` (null → "—", 0 → "$0.00", 123456 → "$1234.56", -5000 → "-$50.00") — verified these match the function's actual behavior against the rendered page's own "—" / "$121.52" style output.

## Gate 3 — Production Build

`pnpm build:only`: **PASS**, exit 0. `/admin/ledger/budgeting` confirmed present in the route manifest (`ƒ /admin/ledger/budgeting`, dynamic).

## Gate 4 — Dev-Server Smoke Test

`pnpm dev` against `.env.local`: **PASS**. Migrations replayed idempotently on startup (only `already exists, skipping` NOTICEs, no errors). Signed in via the credentials provider using `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` (NextAuth CSRF token + `callback/credentials`, got a valid session cookie). Loaded `GET /admin/ledger/budgeting?entity=foundation&fy=2026` (Foundation, FY2026) authenticated: **200 OK**, 139KB of HTML, no `application error` / `internal server error` / React error-digest markers anywhere in the payload.

## Substance Checks

**Reference-column correctness (spot-checked against the DB directly, not inferred):**
- Queried `ledger_transactions` for Foundation, `status='posted'`, `txn_date` in `[2025-07-01, 2026-07-01)` (FY2025, confirmed as the correct "prior FY" window from the `computeDueDate`/fiscal-year convention in `src/lib/ledger.ts:123` — FY2025 = Jul 2025–Jun 2026) grouped by category/flow.
- All 9 categories with nonzero FY2025 activity matched the rendered "Prior Actual" cell exactly: Public donations $121.52, Grants received $2500.00, Rudolph Run $25190.63, Grant out $3400.00, Charitable donation out $15325.00, Program supplies $146.38, Fundraising event costs $10842.48, Insurance & bonding $187.00, Scholarships $7500.00. The remaining 7 categories with zero FY2025 activity correctly show "$0.00" (actual is a sum, defaults to 0) rather than "—".
- Confirmed `ledger_budgets` has **zero rows for Foundation at any fiscal year** (`select fiscal_year, count(*) ... group by 1` returned 0 rows) — so every "Prior Budget" cell correctly shows "—" (`formatBudgetReferenceCents(null)`), consistent with there being no FY2025 budget row to look up.
- **Read-only confirmed:** grepped all 16 rendered `<input type="number">` elements on the editor — none carry a `value=` attribute, i.e., the blank "New Budget" input is never auto-filled from either reference column. This holds even for categories with a large prior-year actual (e.g., Rudolph Run, $25,190.63 prior actual, input still blank).

**Current budget input / no regression to v1.41 cause-line editor:**
- "Break down by cause" affordance present (5 occurrences in HTML — one per breakdown-eligible category: Charitable donation out, Grant out, Scholarships, Disaster relief, Service projects), unchanged.
- "Approve & lock" control present and rendered (canApprove holder). "Add expense category" / "Add income category" both present. No "Unlock" control rendered — correct, since this FY2026 budget is unlocked (no approval row), so only "Approve & lock" should show.
- FY-selector default (v1.42.3): confirmed in `page.tsx:83-86` — `targetFY` defaults to `currentFiscalYear(new Date())` unless a valid `?fy=` is given; unchanged by this increment.
- Two-tier gate (`page.tsx:44-54`): `auth()` → redirect `/signin` if no session; `hasAnyFeature([LEDGER_MANAGE, LEDGER_APPROVE])` → redirect `/access-pending` if neither; `canManage`/`canApprove` computed separately for control-level gating. Identical to the pre-existing pattern, not modified by this increment.

**Print worksheet (verified via rendered server HTML, not a live browser — see Browser-Only Human Checks below):**
- `hidden print:block` wrapper present (2 occurrences — SSR HTML + the RSC flight duplicate for hydration), contains a `<h1>Foundation — Budget Worksheet</h1>` and "FY2026 budget • prior-year reference: FY2025" subhead, matching design.
- Structure for the (single-fund, 2-flow) Foundation Charitable Fund case: 2 `<table>`s (Income, Expense), 16 total `<tbody class="break-inside-avoid-page">` blocks (one per category, matching the 16-category editor above), each followed by exactly 2 blank `<tr>` rows (`class="h-7"`, `colSpan={4}`) — counted 32 blank rows total = 2 × 16, exact match.
- Confirmed **zero** `<input>` and **zero** `<button>` elements inside the print-worksheet HTML block — it is genuinely static text, matching the design's explicit "static snapshot, not a live mirror" call-out. Every category's "New Budget" cell rendered "—", consistent with the empty `ledger_budgets` table noted above (not a bug — it's rendering the real, currently-blank saved state).
- Column headers read "Prior Budget (FY2025)", "Prior Actual (FY2025)", "New Budget (FY2026)" — correct FY labels threaded through.

**Seed flow removal:**
- Case-insensitive grep for `seed` across the entire rendered page HTML (139KB): **zero matches**. No "Seed all funds", "Seed this fund", "Overwrite…" button, or `seedCauseLines` checkbox anywhere, confirming `ProposedLinesList` and the seed action are both gone from the UI as scoped by the Human Answers section (full removal, not just the preview).
- The unreachable `/api/admin/ledger/budgets/seed` route and `computeSeedFromPriorYear` were left in place per the implementer notes — confirmed harmless: nothing in the rendered page links to or calls that route, and it didn't block the build or typecheck.

## Feature-Gate Audit (mandatory)

No protected routes or server actions were added or changed by this increment. `page.tsx`'s existing gate (`auth()` + `hasAnyFeature([FEATURES.LEDGER_MANAGE, FEATURES.LEDGER_APPROVE])`, plus per-control `canManage`/`canApprove`) was read directly in source (`page.tsx:44-54`) and is unchanged from pre-increment behavior. The only new server-side data access is a second read-only `getFundReport(fund.id, priorFY)` call inside the same already-gated page — no new route, no new write path, no new `FEATURES.*` key needed. `computeSeedFromPriorYear`/the seed API route were not touched (left in place, unreachable from the UI) — their existing gate (if any) is out of scope for this increment and unchanged.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `GET /admin/ledger/budgeting` (page) | yes | yes (`hasAnyFeature`) | `FEATURES.LEDGER_MANAGE` / `FEATURES.LEDGER_APPROVE` (either) |

## Regression Tests Added

- `src/lib/ledger.test.ts:2160-2176` — `formatBudgetReferenceCents`: null → "—", zero → "$0.00", positive → "$X.XX", negative → "-$X.XX". Guards against the reference columns silently rendering blank/wrong-signed values for a category with no prior-year budget or a negative net (e.g., a refund-heavy income category).

## Coverage on Critical Modules

Not re-run with `--coverage` under the 7pm deadline (this increment didn't touch `src/lib/events.ts`, `src/lib/permissions.ts`, or `src/lib/members.ts` — the coverage targets those modules already carry are unaffected). `src/lib/ledger.ts` gained one new pure function with 4 direct unit tests; no coverage regression expected there.

## Browser-Only Human Checks (flagging honestly, not claiming these passed)

The runner cannot drive an actual print dialog or a resized viewport. Everything below was verified as far as static/server-rendered HTML allows (structure, class names, element counts) but **needs eyes before the meeting**:

| Check | What code-level verification showed | What still needs a human |
|-------|--------------------------------------|---------------------------|
| Actual print/PDF appearance | `hidden`/`print:block`/`print:hidden` classes present in the right places; chrome (sidebar, footer, buttons, selectors, approve panel) all carry `print:hidden` | Open the page, hit Ctrl/Cmd+P, and eyeball: does the sidebar/header genuinely disappear, does the worksheet look "neat," are the 2 blank lines usably sized for handwriting |
| Page-break behavior mid-category | `break-inside-avoid-page` applied to all 16 category `<tbody>`s in this fund; Foundation only has 1 fund so no fund-boundary page break to test here | Test with the **Club** entity (more funds/categories) to confirm a category block genuinely never splits across a printed page |
| 360px reference-column layout | `grid-cols-2` + `sm:` breakpoint present in `budget-editor.tsx` for the reference cells, matching the Phase 4 note | Resize/emulate to 360px in a real browser and confirm no horizontal scroll and no clipped text |
| Reference-column visual polish | Gray, small-caps labels above tabular-nums dollar values, confirmed in HTML/classes | Treasurer's own quick glance — is "Prior Budget" vs "Prior Actual" visually unambiguous at a glance during a live meeting |

## Data-State Flag (not a code defect — operational, meeting-critical)

`ledger_budgets` has **zero rows** for any entity/fiscal-year combination on this local DB, contradicting the work-log's note that "the existing FY2026 budget is already populated from the earlier seed script." `scripts/seed-fy2026-foundation-budget.ts` exists (git-committed this morning, v1.42.0) but only splits an existing lump budget row into labeled cause lines — it does not create the lump rows themselves, and its own docstring says it targets rows that "currently exist... auto-seeded from FY2025 actuals," which aren't present here. Recommend Chris either (a) confirm this is a local-DB-only gap and production genuinely has the FY2026 lump budget seeded, or (b) budget the FY2026 numbers live at tonight's meeting using the now-correct Prior-Year Actual reference columns as the guide — which is exactly the workflow this feature was built for.

## Verdict

**PASS**

Ready to deploy Increment 1. All four required gates green, reference-column data verified correct against the database directly, seed-flow removal confirmed complete, no regression to existing budget-editor/approve-lock/cause-line flows. The print dialog's visual appearance, page-break behavior with a multi-fund entity, and the 360px layout are flagged above as required human checks before or during the meeting — none of them are blocked on code, only on eyes.

---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-07-28
**Reviewed by:** analyst
**Framing:** This is a post-deploy sign-off — v1.44.0 is already live. The question is not "should this ship," it's "did what shipped deliver Increment 1's intent, and what needs to be tracked now that it's out in front of the treasurer."

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> Increment 1 shipped exactly what Phase 1 scoped — read-only prior-year reference columns, a static print worksheet with hand-annotation lines and page-break protection, and a clean removal of the seed flow — with zero regression to approve/lock, add-category, or the cause-line editor; the notes below are a real data gap (no FY2025 budget entered anywhere) and pre-existing structural model gaps that predate this increment and don't block tonight's use.

## What's Working

- **The reference-column mental model is exactly right.** I read the shipped `budget-editor.tsx` directly: `ReferenceValue` cells render `formatBudgetReferenceCents` output as plain read-only text next to a genuinely blank `<input>` — no `value=` ever set from the prior-year data (qa confirmed this by grepping all 16 rendered inputs; I confirmed it by reading the component, the input's `value={inputs[key] ?? ""}` is keyed off independent local state, never seeded from `priorBudgetCents`/`priorActualCents`). This was the crux of Design Question #2 in Phase 1 (blank-vs-$0 must not get muddied by the new columns) and it shipped clean.
- **The print worksheet is a real static snapshot, not a live mirror.** `budget-print-worksheet.tsx` takes `budgetEditorLines` as server-fetched props, not client input state — so a treasurer mid-edit at the meeting gets last-saved values on the printout, matching Phase 1's explicit recommendation. `break-inside-avoid-page` is applied per-category `<tbody>` (not per-fund), which is the correct grain — Phase 1's gap note called out exactly this risk ("a long category list could paginate badly mid-row") and the fix matches the concern precisely.
- **The seed-flow removal is total, not partial.** I grepped `guided-budget-setup.tsx` directly: zero occurrences of `ProposedLinesList`, and the only remaining "seed" hits are a historical code comment, not UI. This matches the Human Answer's "REPLACE seeding with blank inputs" instruction (full removal, not just the preview) exactly — the treasurer's Design-Q4 fork was resolved in favor of the more aggressive option and the code reflects that choice cleanly.
- **Mobile stacking is real, not decorative.** The shipped row structure genuinely splits into a category-name row and a separate `grid-cols-2` reference-value row that only widens to a fixed layout at `sm:`, exactly as Phase 1's mobile gap asked for — this isn't a class name that looks right, the JSX structure itself changed shape.
- **Empty states match the brand guideline verbatim.** Both the no-entities and no-funds empty states in `page.tsx` use `bg-gray-50 rounded-2xl p-10 text-center text-gray-500` — the project's exact prescribed empty-state pattern, unchanged by this increment but correctly still present after the surrounding refactor.

## Intent-vs-Shipped Diff

- Phase 1 said: prior-year budget + actual as a read-only reuse of `getFundReport(fund.id, priorFY)`, no new aggregation. Shipped: exactly that — a second parallel `getFundReport` call in `page.tsx`, threaded through a `priorByKey` map into `budgetEditorLines`. **Verdict: matches.**
- Phase 1 said: print via `print:hidden` + `window.print()`, reusing the `print-statement-button.tsx` pattern verbatim, no new dependency. Shipped: `print-budget-button.tsx` (copy of that pattern) + `budget-print-worksheet.tsx` (`hidden print:block`), plus the admin layout/sidebar and site footer were additionally given `print:hidden`/`print:pl-0` treatment that Phase 1 didn't explicitly call out but that was necessary for the chrome-hidden goal to actually hold — the sidebar and footer would otherwise have printed on every admin page, not just this one. **Verdict: matches** (the layout/footer touch is a correct completion of stated intent, not scope creep).
- Phase 1 said: drop `ProposedLinesList` but keep the seed action itself (my Phase 1 recommendation, Design Q4) — this was explicitly overridden by the treasurer's Human Answer to remove both. Shipped: both removed, per the Human Answer. **Verdict: matches the Human Answer** (supersedes my Phase 1 recommendation, which is exactly how this pipeline is supposed to work — the treasurer's explicit scoping call is authoritative over my draft recommendation).
- Phase 1 said (gap): a brand-new (entity, FY) with zero prior-year data should render "—", not a broken/blank-looking cell. Shipped: `formatBudgetReferenceCents(null)` → "—", confirmed both in the pure-function unit tests and in qa's live-data spot check (7 zero-activity categories correctly show "$0.00" — a real zero, not absent — while categories with no `ledger_budgets` row show "—"). **Verdict: matches.**
- Phase 1 said (gap): dropping the remove-line `ConfirmDialog` probably makes sense once removal is reversible via soft-delete. Shipped: soft-delete is deferred to Increment 2, so the `ConfirmDialog` on remove is correctly still present (I read it directly in `budget-editor.tsx` — `requestRemove` skips the dialog only when there's nothing meaningful to discard, otherwise still confirms). **Verdict: matches** — this was conditioned on soft-delete shipping, and since it didn't, keeping the confirm is the right call, not an oversight.
- Phase 1 said (gap): cause-line-grain (`ledgerBudgetLines`) reference columns and soft-delete are out of v1 scope. Shipped: `BudgetCauseEditor`'s breakdown-mode rows are untouched by this increment — no reference columns added there, no soft-delete language. **Verdict: matches.**
- Phase 1 said (Increment 2, deferred): soft-delete/restore-until-finalize, needs its own architect + tech-lead pass. Shipped: correctly not attempted in Increment 1; explicitly flagged as deferred in the work-log and in the v1.44.0 release notes. **Verdict: matches** (filed as B-27 below).

## Edge Cases

- Empty state (no entities / no funds): **pass** — verified in `page.tsx`, exact brand-guideline classes.
- Empty state (category with no prior-year data): **pass** — "—" rendering confirmed by direct code read and by qa's live-data check.
- Failure microcopy (invalid amount, locked-budget 409 race): **pass, unchanged** — this increment didn't touch `commitValue`'s error handling; the existing toast copy ("Enter a valid amount…", the 409 lock message) still fires from the new layout, confirmed by reading `budget-editor.tsx` directly.
- Permission gate: **pass** — `page.tsx`'s two-tier `hasAnyFeature([LEDGER_MANAGE, LEDGER_APPROVE])` gate (redirect to `/access-pending` on neither) is byte-for-byte the pre-existing pattern; not modified by this increment, confirmed by direct read.
- Mobile (360px): **pass, per code structure** — the stacked layout is real (see What's Working), though neither qa nor I have driven an actual 360px browser viewport (no browser-automation tool available to either of us). This is a code-level pass, not an eyes-on pass — see the print-check note below for what's still open.
- Brand consistency (rounded-2xl cards, rounded-lg buttons, ConfirmDialog for destructive): **pass** — empty states use `rounded-2xl`, the print button and category controls don't introduce any `rounded-full`, and the remove-line confirm still routes through `<ConfirmDialog destructive>`, not `window.confirm`.

## Follow-Ups (SHIP WITH NOTES)

Filed to `docs/backlog.md`:

- **B-25 — Enter the approved FY2025 budget** so the Prior Budget column stops rendering "—" everywhere. This is the top follow-up — the code is correct, the data behind it doesn't exist yet. Not a defect in this increment.
- **B-26 — Club/Administrative fund budget rows + missing categories** (New Member Fee, 4th of July Parade, Awards, Contingency, Lion L Support, Membership; District vs. International dues not split) vs. the approved budget. Data-completeness gap, not a code defect.
- **B-27 — Increment 2: soft-delete/restore-until-finalize.** The deferred half of the treasurer's original request. Needs its own architect + tech-lead pass before implementation — it's a new persisted state machine interacting with the existing budget-lock invariant, not a continuation of Increment 1's accelerated pipeline.
- **B-28 — Delete the unreachable seed API route** (`/api/admin/ledger/budgets/seed`) and the now-dead `computeSeedFromPriorYear`/`SeedProposedLine` code, plus check `/admin/ledger/guide#budgeting` for stale "seed from last year" instructional copy.
- **Pointer, not re-derived:** a separate budget audit (outside this pipeline) surfaced structural model gaps that predate and are broader than Increment 1 — opening carryover/closing-balance trailer, planned-deficit-as-approved handling (vs. treating it as a warning), fundraiser gross-vs-net pairing, a contingency/reserve primitive, per-line notes, raffle/non-raffle split, an empty `ledger_budget_approvals` table, and a duplicate/empty "club/activity" fund. These are real and worth triage, but they're a post-meeting exercise for whoever ran that audit to turn into scoped backlog items with the audit's own detail — I'm flagging the existence and category of these findings here rather than re-deriving fixes for items outside Increment 1's Phase 1 scope.

## Tonight's Human Print-Check (exact steps)

Nothing here is blocked on code — every item below is "needs eyes," confirmed by both qa and me reading the shipped source, not a suspected bug:

1. Open `/admin/ledger/budgeting?entity=foundation&fy=2026`, sign in as a `LEDGER_MANAGE` or `LEDGER_APPROVE` holder.
2. Click **Print / Save as PDF**. Confirm: no sidebar, no site header/footer, no entity/FY selectors, no Approve/Unlock panel, no trash icons — just the worksheet title, one table per fund/flow, and 2 blank ruled lines under every category.
3. **Repeat step 1-2 for the Club entity specifically** (`?entity=club&fy=2026` or whatever its slug is) — this is the multi-fund/multi-category case Foundation's single fund couldn't exercise. Confirm a category's row + its 2 blank lines never split across a printed page boundary anywhere in Club's longer category list.
4. On the same printout, confirm the "New Budget" column shows real dollar amounts where budget rows exist and "—" only where none do — per B-25/B-26 above, expect Prior Budget to read "—" across the board (real data gap, not a bug) and expect Club's New Budget column to also read mostly "—" until B-26 is worked.
5. Resize a browser window (or use dev-tools device emulation) to 360px on the on-screen (non-print) editor and confirm the category row stacks with no horizontal scroll, and that "Prior Budget"/"Prior Actual" labels are legible at that width.
6. Eyeball check, not a pass/fail: does the printout read as "neat" to the treasurer — is the 2-blank-line spacing usable for actual handwriting, is "Prior Budget" vs. "Prior Actual" unambiguous at a glance in a live meeting.

---

# Increment 2 — Phase 4 — Implementation (schema) — 2026-07-28

**Owner:** database-admin
**Status:** complete

### Summary

Added a single nullable `pending_delete_at timestamp` column to `ledger_budgets`, implementing DECISION-052/053's confirmed shape exactly: no default, no `withTimezone` (matches the table's existing plain `createdAt`/`updatedAt` convention), no index, no constraint change. This is the entire schema surface Increment 2 needs — the write-path logic (soft-delete flip, finalize-time purge) belongs to api-developer.

### What I did

- Read `ledgerBudgets` in `src/lib/db/schema.ts` (line 772) and its migration precedent (`0062`, `0065`) to confirm the table's timestamp convention (plain `timestamp`, not `timestamptz`) before adding the column.
- Confirmed `0065_remove_empty_scholarship_fund.sql` is the current highest-numbered migration, so `0066` was free (no collision with a parallel increment).
- Added `pendingDeleteAt: timestamp("pending_delete_at")` to `ledgerBudgets` in `schema.ts`, placed directly after `annualAmountCents` with a comment referencing DECISION-052/053 and this work-log.
- Wrote `drizzle/migrations/0066_ledger_budgets_pending_delete.sql`: a single `ALTER TABLE ledger_budgets ADD COLUMN IF NOT EXISTS pending_delete_at TIMESTAMP;` statement, idempotent by construction.
- Ran `pnpm exec tsc --noEmit` — clean, no errors.
- Applied the migration locally against `.env.local`'s Neon DB via `pnpm db:migrate`, then re-ran it a second time to confirm the replay is a clean no-op (second run emits `NOTICE: column "pending_delete_at" of relation "ledger_budgets" already exists, skipping` and completes with `✅ Migrations completed successfully`).
- Verified the live column shape with `psql \d ledger_budgets`: `pending_delete_at | timestamp without time zone | | |` — nullable, no default, confirmed.

### Outputs

- **Schema:** `src/lib/db/schema.ts` — `ledgerBudgets` gains `pendingDeleteAt: timestamp("pending_delete_at")` (nullable, no default, no `withTimezone`). `LedgerBudget`/`NewLedgerBudget` (`$inferSelect`/`$inferInsert`, schema.ts:796-797) now carry the field automatically — no separate type edit needed.
- **Migration:** `drizzle/migrations/0066_ledger_budgets_pending_delete.sql` — one statement, confirmed idempotent by two-pass local replay (see above).
- **Tables affected:** `ledger_budgets` only. No change to `ledger_budget_lines` or `ledger_budget_approvals`.
- **No new role bindings or seed rows** — this is a metadata column, not a feature gate; no new `FEATURES.*` key per DECISION-052/053.
- **Local apply command used:** `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate` (ran twice to confirm idempotency). `pnpm db:push` was not additionally run — `db:migrate` + the build's own `drizzle-kit push --force` will reconcile `schema.ts` on the next deploy; the column is additive and nullable so this carries no risk.

### Open questions / handoff notes

- **Exact symbol:** TypeScript field `pendingDeleteAt`, DB column `pending_delete_at`. Nullable, `Date | null` in the inferred type, **no default** — every existing row currently has `NULL` here after the migration.
- **For api-developer:** build `setBudgetLinePendingDelete(params, tx)` next to `upsertBudgetLine` in `ledger-queries.ts` per the Phase 3 design (API Contract section above) — it must flip only `pending_delete_at` (`now()` / `null`) and never touch `annual_amount_cents`. Add the `pendingDeleteAt` field to `getFundReport`'s `FundReportCategoryLine` (serialize `Date` → ISO string per the design doc's convention), thread it through `budgeting/page.tsx`, and wire the transactional finalize-time purge (`DELETE FROM ledger_budgets WHERE entity_id = ? AND fiscal_year = ? AND pending_delete_at IS NOT NULL`) into the rewritten `POST /api/admin/ledger/budget-approvals` transaction.
- **Foreign keys/relationships:** unchanged — `ledger_budgets` still FKs to `ledger_entities`, `ledger_funds` (both cascade), and `ledger_categories` (set null). The existing `(fund_id, fiscal_year, category_id, flow)` unique constraint is untouched, which is exactly why "soft-delete then re-add" needs no special handling (per Phase 2/3's ruling).
- **Next agent:** api-developer (Phase 4, server half) per the implementer sequence named in Phase 3.

---

# Increment 2 — Phase 4 — Implementation (API) — 2026-07-28

**Owner:** api-developer
**Status:** complete

### Summary

Implemented the full server half of soft-delete/restore-until-finalize per DECISION-052/053 exactly: a new `setBudgetLinePendingDelete` write core in `ledger-queries.ts` that mirrors `upsertBudgetLine`'s guard sequence but only ever flips `pending_delete_at`; a second, mutually-exclusive request-body shape on `PATCH /api/admin/ledger/budgets`; an informational `pendingDeleteAt` field added to `getFundReport`'s `FundReportCategoryLine` (proven, not just claimed, to leave every committed figure byte-for-byte unchanged); and a rewrite of `POST /api/admin/ledger/budget-approvals` to run the lock-check, the lock-status write, and the pending-delete purge inside one `db.transaction()`, closing a pre-existing check-then-act race. All 11 Phase 3-named tests that fall on the server side of the implementer split (1-5, 7, 9-11) are written and passing, plus the PATCH route's 400 both/neither test named in this task's brief.

### What I did

- Read the Phase 2 architect ruling, Phase 3 tech-lead design, and database-admin's schema handoff in full before writing any code.
- Added `setBudgetLinePendingDelete(params, tx)` to `src/lib/ledger-queries.ts`, placed directly after `upsertBudgetLine`: resolves fund/category (reusing `validateBudgetLineInput` with `annualAmountCents: null` to skip its amount-bounds branch), runs `assertBudgetUnlocked` for **both** `pendingDelete: true` and `pendingDelete: false` (409 `reason: "locked"`), then a row-must-exist check (404 — pending-delete has no insert branch, unlike `upsertBudgetLine`), then the cause-line-children guard (409 `reason: "has_cause_breakdown"`, identical query to `upsertBudgetLine`'s), then a pure flag-flip (`pending_delete_at = now()` or `null`) that never reads or writes `annual_amount_cents`.
- Added `pendingDeleteAt: string | null` to `FundReportCategoryLine` in `getFundReport` (`ledger-queries.ts`) — sourced off the `budgetRows` the function already fetches (a new `pendingDeleteMap`, built alongside the existing `budgetMap`/`budgetIdMap`), serialized `Date` → ISO string at this boundary. Threaded into both `buildLines` push sites (the normal category loop and the orphaned-budget-row loop). Added `pendingDeleteAt: null` to the two unrelated `FundReportCategoryLine` push sites inside `getEntityReport` (that function's own `buildLines`, which never surfaces budgets at all) purely to satisfy the now-required field — no behavior change there.
- Gave `getBudgetApproval` an optional `tx: DrizzleTransaction | typeof db = db` parameter (matching `assertBudgetUnlocked`'s existing convention) so the approve/lock route can run its lock-check inside the same transaction as its writes. Confirmed its one other caller (`budgeting/page.tsx`, 2-arg call site) still typechecks unchanged.
- Rewrote `PATCH /api/admin/ledger/budgets` (`src/app/api/admin/ledger/budgets/route.ts`) to dispatch on two mutually-exclusive body shapes: `{ ...annualAmountCents }` (Shape A, unchanged behavior, unchanged response shape) and `{ ...pendingDelete }` (Shape B, new — dispatches to `setBudgetLinePendingDelete`, surfaces `reason` in the JSON body on a 409). 400 when both keys present; the "neither present" case falls through unchanged into Shape A's existing amount-type check, which already 400s with its pre-existing message — no new code needed for that half of the requirement.
- Rewrote `POST /api/admin/ledger/budget-approvals` (`src/app/api/admin/ledger/budget-approvals/route.ts`) to wrap the lock-check + lock-status upsert + pending-delete purge in one `db.transaction()`. A `BudgetAlreadyLockedError` sentinel class (mirrors the existing `SeedLockedError` pattern in `budgets/seed/route.ts`) is thrown inside the transaction and caught by the outer handler to preserve the exact pre-existing 409 response. The purge is `tx.delete(ledgerBudgets).where(and(eq(entityId), eq(fiscalYear), isNotNull(pendingDeleteAt)))` — entity-wide, matching how approval itself is entity-wide across all of that entity's funds.
- Confirmed by direct read that `POST .../unlock` needed **no changes** — it never touches `ledger_budgets`, so a purge at finalize has nothing for unlock to resurrect. Wrote a regression test that would fail loudly if this ever changed (see Tests below).
- Wrote and ran all named tests; ran `pnpm exec tsc --noEmit`, `unset DATABASE_URL DB_URL; pnpm test`, and `pnpm build:only` — all green.

### Outputs

**`setBudgetLinePendingDelete(params, tx)`** — `src/lib/ledger-queries.ts`:
```ts
type SetBudgetLinePendingDeleteParams = {
  fundId: string; fiscalYear: number; categoryId: string;
  flow: "income" | "expense"; pendingDelete: boolean;
};
type SetBudgetLinePendingDeleteResult =
  | { ok: true; action: "pending-delete" | "restored" }
  | { ok: false; error: string; status: 400 | 404 | 409; reason?: "locked" | "has_cause_breakdown" };
```

**`PATCH /api/admin/ledger/budgets`** — gate: `FEATURES.LEDGER_MANAGE` (unchanged). Two mutually-exclusive shapes:
```
// Shape A (unchanged): { fundId, fiscalYear, categoryId, flow, annualAmountCents: number | null }
//   -> 200 { action: 'upserted' | 'deleted', id?: string }
// Shape B (new):        { fundId, fiscalYear, categoryId, flow, pendingDelete: boolean }
//   -> 200 { action: 'pending-delete' | 'restored' }
```
Errors: 400 both/neither of `annualAmountCents`/`pendingDelete` present (or neither → falls through to Shape A's existing amount-type 400); 404 fund/category not found, or (Shape B only) no budget row exists for the tuple; 409 `{ error, reason: 'locked' | 'has_cause_breakdown' }` (Shape B surfaces `reason`; Shape A's error body is unchanged from before this increment).

**`POST /api/admin/ledger/budget-approvals`** — gate: `FEATURES.LEDGER_APPROVE` (unchanged). Body/response shape unchanged. Now transactional: lock-check + lock-status upsert + `DELETE ... WHERE entity_id = ? AND fiscal_year = ? AND pending_delete_at IS NOT NULL` all happen inside one `db.transaction()`. Same 409 message/status as before on an already-locked budget, now thrown from inside the transaction via a `BudgetAlreadyLockedError` sentinel.

**`POST /api/admin/ledger/budget-approvals/unlock`** — unchanged, confirmed by direct read and by a new regression test.

**`getFundReport`** — `FundReportCategoryLine` gains `pendingDeleteAt: string | null`, purely informational. `budgetCents`/`variance`/`causeLines`/`totalIncomeCents`/`totalExpenseCents`/`endingCents` proven byte-for-byte unchanged by a direct regression test (see below), not just reasoned about.

- Files touched: `src/lib/ledger-queries.ts`, `src/lib/ledger-queries.test.ts`, `src/app/api/admin/ledger/budgets/route.ts`, `src/app/api/admin/ledger/budgets/route.test.ts` (new), `src/app/api/admin/ledger/budget-approvals/route.ts`, `src/app/api/admin/ledger/budget-approvals/route.test.ts` (new), `src/app/api/admin/ledger/budget-approvals/unlock/route.test.ts` (new).
- No schema change (database-admin's migration `0066` already committed; see the Phase 4 — schema section above).
- No new `FEATURES.*` key, no decisions.md entry needed (implementation followed DECISION-052/053 exactly, no new judgment calls).

### Tests written (all passing)

In `src/lib/ledger-queries.test.ts` (`describe("setBudgetLinePendingDelete", ...)`  and `describe("getFundReport — pending-delete regression guard", ...)`):
1. Soft-delete sets `pending_delete_at`, leaves `annualAmountCents` untouched (asserted via `not.toHaveProperty("annualAmountCents")` on the update call).
2. Restore clears `pending_delete_at`, same amount-untouched assertion.
3. 409 `{ reason: "locked" }` for **both** `pendingDelete: true` and `pendingDelete: false` (looped in one test).
4. 409 `{ reason: "has_cause_breakdown" }` for a row with `ledger_budget_lines` children.
5. 404 when no `ledger_budgets` row exists for the tuple.
7. `getFundReport` regression guard: two live calls (one with a row's `pendingDeleteAt` null, one with it set) — asserts `budgetCents`/`actualCents`/`variance`/`causeLines`/`totalIncomeCents`/`totalExpenseCents`/`endingCents` are identical, then strips `pendingDeleteAt` from both full report objects via a JSON replacer and asserts deep equality on everything else — byte-for-byte, not field-by-field.

In `src/app/api/admin/ledger/budgets/route.test.ts` (new file):
- 400 when both `annualAmountCents` and `pendingDelete` present.
- 400 when neither present (asserts it's the same pre-existing amount-validation message).
- Shape B dispatches to `setBudgetLinePendingDelete` and surfaces `reason` in the 409 body.
- Shape A still dispatches to `upsertBudgetLine` unchanged.

In `src/app/api/admin/ledger/budget-approvals/route.test.ts` (new file):
9. Finalize hard-deletes pending-delete rows atomically with the lock write — both writes happen inside one `db.transaction()` call (`db.transaction` called exactly once; one insert into `ledgerBudgetApprovals`, one delete from `ledgerBudgets`).
10. The purge's compiled `DELETE ... WHERE` clause (rendered via `PgDialect().sqlToQuery()`, not just reasoned about) is scoped to `entity_id` + `fiscal_year` + `pending_delete_at IS NOT NULL` — proving non-pending rows are structurally excluded.
- Bonus: an already-locked budget 409s with zero inserts/deletes (closes the race — the abort happens before either write, not after).

In `src/app/api/admin/ledger/budget-approvals/unlock/route.test.ts` (new file):
11. Unlock only ever writes `ledgerBudgetApprovals` — `db.delete`/`db.transaction` are mocked to **throw** if ever called, so any future change wiring unlock to touch `ledger_budgets` fails this test loudly instead of silently passing.

**Test count:** `unset DATABASE_URL DB_URL; pnpm test` → **662 passed** (was 648; +14: 6 in `ledger-queries.test.ts`, 4 in the new `budgets/route.test.ts`, 3 in the new `budget-approvals/route.test.ts`, 1 in the new `unlock/route.test.ts`). All hermetic — no `DATABASE_URL`/`DB_URL` in the environment.

### Gates

- `pnpm exec tsc --noEmit` — clean, zero errors.
- `unset DATABASE_URL DB_URL; pnpm test` — 662/662 passed.
- `pnpm build:only` — exit 0, full route manifest generated (not explicitly required by this task's gate list, but run anyway given the transactional route rewrite; no build errors).
- No `console.log` in any touched file (grepped directly).
- `assertBudgetUnlocked` runs on every `setBudgetLinePendingDelete` call, both directions.
- The finalize (`POST /budget-approvals`) is one atomic `db.transaction()` — lock-check, lock-status write, and purge all inside it.
- No schema change made in this phase (already complete from database-admin's Phase 4).
- Version/release notes/commit intentionally NOT bumped, per this task's explicit instruction.

### Open questions / handoff notes for ux-developer

- **PATCH request shapes** — see "Outputs" above verbatim. Your `resolveBudgetLineDeleteAction` (`src/lib/ledger.ts`) decides which shape to send: `"soft-delete"` → `PATCH { fundId, fiscalYear, categoryId, flow, pendingDelete: true }`; Restore → the same with `pendingDelete: false`; a genuine amount edit stays `PATCH { ...annualAmountCents }` (Shape A, byte-identical to before this increment).
- **409/404 reason codes to branch UI copy on** (Shape B only — Shape A's error body is unchanged): `{ error, reason: "locked" }` and `{ error, reason: "has_cause_breakdown" }` on 409; a plain `{ error }` (no `reason` field) on 404 (`"No budget line exists for this category to modify."` — should be unreachable from your UI per the design's own note that a never-saved row is a client-side no-op, never a network call).
- **New `pendingDeleteAt: string | null` field on `FundReportCategoryLine`** — already threaded out of `getFundReport`. `budgeting/page.tsx` still needs to be updated to pass it through into `budgetEditorLines` (per the Phase 3 design's Component Plan) — that's your Phase 4 work, not done here; I only added the field to the query layer.
- **`resolveBudgetLineDeleteAction`** (pure function in `src/lib/ledger.ts`) and its unit test (#6) are yours, not written here.
- **`fundSums()`'s pending-delete exclusion** (in `guided-budget-setup.tsx`) and its unit test (#8) are yours, not written here.
- **Restore has no confirm dialog** (per Flow 4) — a single `PATCH { pendingDelete: false }` click, no dialog, matching the design.
- **The existing remove-line `ConfirmDialog`** in `budget-editor.tsx` should be deleted per the architect/tech-lead ruling — both soft-delete and restore are single-click, no-confirm actions now. The one meaningful warning moves to the Approve & lock dialog's copy (pending-delete count, `destructive` toggle) — see Phase 3's Component Plan section for the exact copy.
- **Next agent:** ux-developer, per the implementer sequence named in Phase 3.

---

# Increment 2 — Phase 4 — Implementation (UI) — 2026-07-28

**Owner:** ux-developer
**Status:** Complete

### Summary

Implemented the full client half of soft-delete/restore-until-finalize per DECISION-052/053 exactly, on top of api-developer's server handoff. A new pure `resolveBudgetLineDeleteAction(hasExistingRow, rawValue)` in `src/lib/ledger.ts` unifies the trash-icon control and the blank-input-then-blur/Enter gesture onto one decision; `budget-editor.tsx` renders a pending-delete row visibly "deleted" (strikethrough, muted, disabled input, a badge, and a single-click Restore control) and drops its now-unneeded remove-line `ConfirmDialog` entirely; `guided-budget-setup.tsx`'s live balance badge (`fundSums()`) excludes pending-delete lines via a new pure `computeFundLineSums()` helper, and the Approve & lock `ConfirmDialog` gains a destructive warning with the exact pending-delete count; `budget-print-worksheet.tsx` excludes pending-delete lines from the printed worksheet; `budgeting/page.tsx` threads the new `pendingDeleteAt` field through from `getFundReport`. Both Phase-3-named client unit tests (#6, #8) are written and passing, plus the full 673/673 hermetic suite.

### What I did

- Read the Phase 3 tech-lead design and api-developer's Phase 4 (server) handoff in full before writing any code — confirmed the exact PATCH Shape B contract (`{ fundId, fiscalYear, categoryId, flow, pendingDelete: boolean }` → `{ action: "pending-delete" | "restored" }`), the 409 `reason` discriminant (`"locked" | "has_cause_breakdown"`), and the plain 404 body.
- Added `resolveBudgetLineDeleteAction(hasExistingRow, rawValue)` to `src/lib/ledger.ts` (pure, no DB) — `"soft-delete"` only when `rawValue.trim() === "" && hasExistingRow`, else `"noop"`. Wrote test #6 (the truth table: blank+existing, whitespace-only+existing, blank+never-saved, non-blank+existing, non-blank+never-saved) in `src/lib/ledger.test.ts`.
- Added `computeFundLineSums(lineValues, pendingDeleteKeys)` to `src/lib/ledger.ts` — the pure core of `guided-budget-setup.tsx`'s `fundSums()`, extracted because this repo has no component-test infra (vitest config is `environment: "node"`, no jsdom/RTL) — the same reason `computeBudgetBalanceStatus` etc. already live here instead of being inlined in the client island. Wrote test #8 (6 cases: normal sum, income exclusion, expense exclusion, explicit `false` included normally, empty input, omitted `pendingDeleteKeys` defaults to `{}`).
- Rewrote `budget-editor.tsx`:
  - `BudgetLine` gains `pendingDeleteAt?: string | null`; `BudgetEditorProps` gains `onPendingDeleteChange?: (key, pendingDelete) => void`, fired optimistically ahead of the round-trip.
  - New `setPendingDelete(categoryId, flow, pendingDelete)` — the single soft-delete/restore write path (`PATCH { pendingDelete }`), surfacing the 409 `has_cause_breakdown` reason as "This category is broken down by cause — remove its cause lines first.", falling back to the server's own `error` string otherwise (which already carries the existing locked message, "This budget is locked. Unlock it to make changes.", verbatim — no need to re-author it client-side).
  - `commitValue` (the blur/Enter path) now calls `resolveBudgetLineDeleteAction(hasExistingRow, raw)` first — `hasExistingRow` read directly off `lines.find(...).budgetCents !== null` (never a separately tracked flag, since a pending-delete row's amount is preserved). `"soft-delete"` → `setPendingDelete(..., true)`; blank + never-saved → true no-op, no network call; otherwise the unchanged Shape A amount-edit path (explicit `"0"` still a deliberate $0 budget).
  - `requestRemove(line)` (trash click) — always resolves with a hard-coded blank `rawValue` (a click is the semantic equivalent of blanking the line): `hasExistingRow` true → immediate soft-delete, no confirm; `hasExistingRow` false (an active category `getFundReport` surfaces with no budget set yet, still showing a trash icon) → true no-op.
  - `requestRestore(line)` — single-click `setPendingDelete(..., false)`, no confirm (a pending-delete row always has an existing row by definition).
  - New pending-delete row rendering branch: category name strikethrough + muted, a `bg-gray-200` "Deleted — removed when finalized" badge, the amount input rendered `disabled`/`readOnly` (preventing edit-while-pending independent of the page-level lock state), and the trash button replaced by a "Restore" button in the same slot — both gated identically to the existing trash control (`showRemoveControl && !disabled`, i.e. `canManage && !locked`).
  - **Deleted** the `removeConfirm` state and the remove-line `ConfirmDialog` entirely, along with the now-unused `ConfirmDialog` import — removal is reversible now, per DECISION-052/053.
  - Updated the editor's footer helper copy to mention removal is reversible until finalize.
- Updated `guided-budget-setup.tsx`:
  - `FundSetupItem.budgetEditorLines[]` gains `pendingDeleteAt: string | null` (required, sourced straight off `getFundReport`'s target-FY report).
  - New `pendingDeleteKeys` state (`Record<fundId, Record<key, boolean>>`), initialized from each line's `pendingDeleteAt !== null`, updated by a new `handlePendingDeleteChange` wired to `BudgetEditor`'s `onPendingDeleteChange`.
  - `fundSums()` now delegates to `computeFundLineSums(lineValues[fundId], pendingDeleteKeys[fundId])` — the per-fund balance badges (both the inline "Balanced"/"Needs review" chip and the Approve panel's fund list) update the instant a soft-delete/restore click resolves, ahead of `router.refresh()`.
  - New `totalPendingDeleteCount()` sums `pendingDeleteKeys` across every fund; the Approve & lock `ConfirmDialog`'s description now appends `"${n} budget line(s) marked for removal will be permanently deleted when you lock this budget."` when `n > 0`, and the dialog's `destructive` prop is `pendingDeleteCount > 0` (red confirm only when something will actually be lost — matches the ConfirmDialog convention used for other destructive confirms in this codebase).
- Updated `budget-print-worksheet.tsx`: `PrintLine` gains `pendingDeleteAt: string | null`; `FundWorksheet` filters both `income`/`expense` to `pendingDeleteAt === null` *before* the existing `income.length === 0 && expense.length === 0` emptiness check, so a fund whose only lines are all marked for removal is omitted entirely (same "nothing to print" behavior the check already gave a fund with zero budget lines).
- Updated `budgeting/page.tsx`: both `budgetEditorLines` map sites (income and expense) now pass `pendingDeleteAt: l.pendingDeleteAt` straight through from the target-FY `getFundReport()` call (not the prior-FY report, which has no bearing here).
- Ran `pnpm exec tsc --noEmit`, `unset DATABASE_URL DB_URL; pnpm test`, and `pnpm build:only` — all green. Grepped every touched file for `console.log`/`console.debug` — none found.

### Outputs

- `src/lib/ledger.ts` — `resolveBudgetLineDeleteAction`, `computeFundLineSums`.
- `src/lib/ledger.test.ts` — test #6 (`describe("resolveBudgetLineDeleteAction", ...)`, 5 cases) and test #8 (`describe("computeFundLineSums", ...)`, 6 cases).
- `src/components/admin/ledger/budget-editor.tsx` — `pendingDeleteAt` on `BudgetLine`, `onPendingDeleteChange` prop, `setPendingDelete`, rewritten `commitValue`/`requestRemove`, new `requestRestore`, pending-delete row rendering branch, removed `removeConfirm`/`ConfirmDialog`.
- `src/components/admin/ledger/guided-budget-setup.tsx` — `pendingDeleteAt` on `FundSetupItem.budgetEditorLines`, `pendingDeleteKeys` state + `handlePendingDeleteChange`, `fundSums()` now delegates to `computeFundLineSums`, `totalPendingDeleteCount()`, Approve dialog warning copy + `destructive` toggle.
- `src/components/admin/ledger/budget-print-worksheet.tsx` — `pendingDeleteAt` on `PrintLine`, `FundWorksheet`'s income/expense filter.
- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` — `pendingDeleteAt` threaded into both `budgetEditorLines` map sites.
- No new decisions.md entry needed — implementation followed DECISION-052/053 exactly, no new judgment calls beyond the one documented above (falling back to the server's own locked-error string rather than re-authoring it client-side, and filtering pending-delete lines at the `FundWorksheet` level before the emptiness check rather than inside `FlowTable`, so an all-pending-delete fund is omitted the same way a zero-line fund already is).

### Test list (all passing)

- `src/lib/ledger.test.ts` `describe("resolveBudgetLineDeleteAction", ...)` — blank+existing → soft-delete; whitespace-only+existing → soft-delete; blank+never-saved → noop; non-blank+existing → noop; non-blank+never-saved → noop.
- `src/lib/ledger.test.ts` `describe("computeFundLineSums", ...)` — normal sum with no pending keys; excludes a pending-delete income line; excludes a pending-delete expense line; an explicit `false` pending flag is included normally; empty `lineValues` returns `{0, 0}`; omitted `pendingDeleteKeys` defaults to `{}`.
- Full suite: `unset DATABASE_URL DB_URL; pnpm test` → **673 passed** (was 662 after api-developer's Phase 4; +11 here: 5 + 6).

### Gates

- `pnpm exec tsc --noEmit` — clean, zero errors.
- `unset DATABASE_URL DB_URL; pnpm test` — 673/673 passed, hermetic (no `DATABASE_URL`/`DB_URL` in the environment).
- `pnpm build:only` — exit 0, full route manifest generated, no build errors.
- No `console.log`/`console.debug` in any touched file (grepped directly).
- Soft-delete/restore controls gated identically to today's remove control: `canManage && !locked` (`showRemoveControl && !disabled`). The amount input is disabled whenever `pendingDeleteAt` is set, independent of the page-level lock state.
- No native browser dialogs added; the remove-line `ConfirmDialog` was removed per the design, not replaced — soft-delete and restore are both single-click, no-confirm. The Approve & lock `ConfirmDialog` (still present, unchanged component) carries the one meaningful warning now.
- Version/release notes/commit intentionally NOT bumped, per this task's explicit instruction.

### Open questions / handoff notes

- **QA manual click-through list** (next agent: **qa**, Phase 5):
  1. Soft-delete a saved budget line via the trash icon — it stays visible, struck through, muted, badged "Deleted — removed when finalized"; its amount input is disabled; the fund's live balance badge immediately excludes it from the running total.
  2. Click Restore on that line — it returns to the normal editable row with its original amount intact (not blanked), and the balance badge includes it again.
  3. Blank a saved line's input and blur/press Enter — same soft-delete effect as the trash icon (row goes to "deleted" state, no confirm dialog appears).
  4. Blank a genuinely never-saved line (an active category with no budget set yet) and blur — nothing happens; no toast, no network call, the row stays exactly as it was.
  5. Attempt to soft-delete (trash icon) a category currently in cause-breakdown mode — confirm the trash control isn't even rendered for a breakdown row (unchanged from before this increment); if reachable via a direct API test, confirm the 409 toast reads "This category is broken down by cause — remove its cause lines first."
  6. With 1+ lines marked pending-delete, open Approve & lock — confirm the dialog shows the exact count ("N budget line(s) marked for removal will be permanently deleted when you lock this budget.") and the confirm button renders red (destructive). With zero pending-delete lines, confirm the dialog has no warning sentence and a normal (non-red) confirm button.
  7. Lock the budget — confirm the pending-delete rows are gone entirely on reload (purged), and every non-pending line survived untouched.
  8. Print the worksheet (before finalizing) with at least one pending-delete line present — confirm it does not appear on the printout, and that a fund whose only line is pending-delete doesn't print an empty section for that fund.
  9. Resize to 360px — confirm the pending-delete row's strikethrough label, badge, disabled input, and Restore button stack cleanly with no horizontal scroll or overlap.
  10. Confirm a locked budget (viewed by an LEDGER_APPROVE-only or LEDGER_MANAGE-after-lock viewer) still shows any pending-delete rows in their muted/struck state but with no Restore button, matching the existing no-trash-icon-when-locked convention.
- **New copy strings the Lions Club may want to refine:** the "Deleted — removed when finalized" badge text; the Approve & lock warning sentence ("N budget line(s) marked for removal will be permanently deleted when you lock this budget."); the has-cause-breakdown 409 toast ("This category is broken down by cause — remove its cause lines first.").
- **UX decisions/tradeoffs made, not called out explicitly in Phase 3:**
  - The trash-icon click resolves `resolveBudgetLineDeleteAction` with a hard-coded blank `rawValue` rather than the input's currently-displayed value — this is the only reading consistent with the design's own "unsaved, still-blank line" no-op example, since a saved line's input almost always displays its non-blank formatted amount (even `"0.00"` for a deliberate $0 line) and would otherwise never resolve to `"soft-delete"` via the trash icon at all.
  - `computeFundLineSums` was extracted as a new pure helper (not named in Phase 3, which only said "`fundSums()` or its extracted pure core") because this repo's Vitest config has no jsdom/component-test environment — there was no way to exercise `fundSums()`'s exclusion logic in test #8 without pulling it out, consistent with `computeBudgetBalanceStatus`'s existing precedent in the same file.
  - Filtered pending-delete lines at the `FundWorksheet` level (before its existing emptiness check) rather than only inside `FlowTable`, so a fund whose every line is pending-delete is omitted from the printout exactly like a fund with zero budget lines — otherwise `FlowTable` would render a header with no body rows.
- **Next agent:** qa, for Phase 5 verification.
