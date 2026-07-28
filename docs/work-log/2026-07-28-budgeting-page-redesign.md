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
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | ux-developer (Increment 1) | Complete | — | 2026-07-28 |
| 5 — Verification | qa | Complete | PASS | 2026-07-28 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

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
