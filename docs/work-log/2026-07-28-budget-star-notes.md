# Budget Star & Notes — Work Log

> **Slug:** `2026-07-28-budget-star-notes`
> **Surface:** (dashboard) admin — The Ledger budgeting (`/admin/ledger/budgeting`)
> **Permission(s):** existing `ledger.manage` (`FEATURES.LEDGER_MANAGE`)
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-28 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-07-28 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-07-29 |
| 4 — Implementation (schema) | database-admin | Complete | Schema done, api-developer next | 2026-07-29 |
| 4 — Implementation (API) | api-developer | Complete | Server/logic done, ux-developer next | 2026-07-29 |
| 4 — Implementation (UI) | ux-developer | Complete | UI done, qa next | 2026-07-29 |
| 5 — Verification | qa | Complete | FAIL — loop back to ux-developer (tech-lead ruling needed first) | 2026-07-29 |
| 4 — Implementation (fix, loop-back) | full-stack-developer | Complete | Fixed at the `getFundReport` layer per the ruling; qa to re-verify | 2026-07-29 |
| 5 — Verification (re-verify) | qa | Complete | **PASS** | 2026-07-29 |
| 6 — Shipped vs intent | analyst | Complete | **SHIP IT** | 2026-07-29 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> The treasurer wants to flag priority budget items and leave a working note on them during meeting prep — small feature, but the request is silent on the one hard case that already exists in this data model: categories that appear on screen with no `ledger_budgets` row behind them.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`ledger.manage`) | Star a category row on the budgeting page | On demand, during budget prep/meetings |
| Admin (`ledger.manage`) | Un-star a category row | On demand |
| Admin (`ledger.manage`) | Star / un-star a cause line row (`budget-cause-editor.tsx`) | On demand |
| Admin (`ledger.manage`) | Add / edit / clear a free-text note on a category row | On demand |
| Admin (`ledger.manage`) | Add / edit / clear a free-text note on a cause line row | On demand |
| Admin (`ledger.manage`) | View starred items sorted to top (proposed) | Per page load |
| Admin (`ledger.manage`) | Print the budget worksheet with stars/notes visible | Per board meeting |

No public or member-portal verbs — this is an internal working-notes feature, confirmed out of member-facing surfaces (see Adversarial Pass, Gap 9).

## Flows

**Flow 1 — Star a category row:** entry: `/admin/ledger/budgeting`, fund card expanded → user clicks a star icon/button on a category row in `budget-editor.tsx` → row updates optimistically (filled star) → outcome: star persists on next page load; category may move to top-of-list if sort-to-top is in scope (see Decision 1).
- Failure: save fails (network/DB) → star icon reverts to unstarred, inline toast "Couldn't save — try again." No silent-fail; no page-wide error.

**Flow 2 — Add a note to a category row:** entry: same page → user clicks a note icon/"Add note" affordance → inline textarea or popover opens → types free text → saves on blur or explicit Save button → outcome: note icon shows filled/badge state, hover or click reveals note text.
- Failure: over-length paste or save failure → inline validation message ("Note is limited to N characters") or the same save-failed toast as Flow 1. Never a blocking modal for a low-stakes annotation.

**Flow 3 — Star/note a cause line:** entry: category row expanded to cause lines in `budget-cause-editor.tsx` → same star/note affordances per cause line row → outcome: identical to Flows 1–2 at the line grain.
- Failure: same as above.

**Flow 4 — Star/note an un-budgeted category:** entry: a category with NO `ledger_budgets` row for this fund+FY (currently rendered by `getFundReport` as a $0 row with no amount entered) → user stars or notes it → outcome (design-dependent, see Decision 4): either a `ledger_budgets` row is lazily created with `annualAmountCents = 0` to carry the flag, or a dedicated annotations table stores it keyed by category without requiring a budget row to exist.
- Failure: if the lazy-create path is chosen and the insert races a concurrent "enter this category's actual amount" edit, the unique constraint `ledger_budgets_fund_year_cat_flow_key` must resolve via upsert, not a duplicate-key error surfaced to the user.

**Flow 5 — Print worksheet with stars/notes:** entry: budget editor → "Print worksheet" (`budget-print-worksheet.tsx`) → outcome: starred rows show a star glyph and notes render as a line under the row (or a footnote list), so the treasurer can mark up the physical page in the meeting.
- Failure: n/a — this is a client-side print render, no network call to fail. If a note is very long, it should truncate or wrap without breaking the print layout (an edge case for tech-lead/ux-developer, not a functional flow failure).

**Flow 6 — Lock interaction:** entry: budget is Approve-&-locked for the FY → user attempts to star/note a row → outcome (Decision 6, recommended): star/note controls remain active and editable even though `annualAmountCents` fields are disabled, because annotations aren't budget figures.
- Failure: if tech-lead instead chooses to freeze annotations with the lock, the failure state is a disabled control with a tooltip ("Notes are locked with this year's budget"), not a silent no-op.

## Permissions

- **Permission(s):** existing `ledger.manage` (`FEATURES.LEDGER_MANAGE`) — same gate as budget amount editing. No new `FEATURES` key needed; this is an annotation on data already gated by that key.
- **Default roles:** whichever roles already carry `ledger.manage` today (Admin, Treasurer-equivalent). No widening.

## Gaps the Request Didn't Address

- **Un-budgeted category annotations (the core gap).** `getFundReport` renders every active category as a row even with zero `ledger_budgets` rows behind it. A star/note keyed to `ledger_budgets.id` is impossible to attach to such a row. **Recommendation: lazy-create the `ledger_budgets` row (amount = 0) on first star/note**, rather than a separate `ledger_budget_annotations` table. Rationale: (a) it reuses the existing unique constraint and cascade-delete semantics instead of inventing a second nullable-FK shape; (b) a category the treasurer bothered to star or note is very likely a category they're about to budget anyway, so creating the row early isn't wasted; (c) it avoids a second lookup/join on every `getFundReport` call, which already batches budget-line fetches by `budgetRows`' own IDs — adding a second annotations table means a second batched fetch keyed on category IDs that may or may not have a budget row, which is exactly the kind of nullable-dual-key shape DECISION-041's "no DB CHECK, enforce in app code" precedent warns is fragile. The one thing tech-lead must resolve: whether "lazy-create on star/note" writes `annualAmountCents: 0` in a way indistinguishable from a treasurer who deliberately budgeted $0 for a category — recommend a code comment, not a schema flag, since this is cosmetic (a $0 row with no note/star already renders identically to today's un-budgeted display) and not worth a new column.
- **Sort-to-top interacting with existing row order.** Category and cause-line rows currently render in `sortOrder`/`name` order (category) and cause-taxonomy order (cause lines). If starred rows sort to top, that's a second sort key layered on the first — needs an explicit "starred rows first, then existing order within each group" rule so it's not ambiguous to tech-lead.
- **Note character limit undefined by the request.** Treasurer didn't specify; recommend 500 chars — enough for a working note ("confirm with youth committee before locking," "matches last year + 5%"), short enough to not become a second description field competing with `ledgerBudgetLines.label`.
- **Empty state.** A fund/FY with zero stars and zero notes should show no visual clutter — star/note icons are unfilled/outline by default, not an empty-state banner. Confirm this reads as "available action," not "broken feature."
- **Concurrent editors.** Two admins with `ledger.manage` editing the same budget page — last-write-wins is the existing pattern elsewhere in the budgeting editors (per `budget-editor.tsx`/`guided-budget-setup.tsx`); no new conflict-resolution needed here, but tech-lead should confirm this explicitly rather than silently inheriting it.

## Out of Scope (confirm with user)

- Starred-only filter / dedicated "starred items" view — treated as a follow-up, not in this increment (Decision 1).
- Carry-over of stars/notes across fiscal years — treated as per-FY only, follow-up if wanted (Decision 5).
- Rich text / attachments on notes — plain text only.
- Notifications (e.g., emailing another admin when a note is added) — no email story in the request; not building one.

## Open Questions

*(Decisions 1–9 below each carry a recommended default. Flagging only the ones that materially change scope or that a wrong guess would be expensive to unwind.)*

1. **Star semantics** — Recommend: visual flag only, PLUS sort-to-top (cheap to add, high meeting-prep value: treasurer scans starred items first). Starred-only filter deferred as follow-up.
2. **Note shape** — Recommend: plain text, 500-char limit, one note per row (category or cause line), editable by `ledger.manage`, shown as an icon that expands a popover/inline textarea (not always-visible — keeps the dense budget table dense).
3. **Grain coverage** — Confirmed: both category rows (`budget-editor.tsx`) and cause line rows (`budget-cause-editor.tsx`) get star + note, per the request's explicit "line items and categories."
4. **Un-budgeted category annotations** — **Needs the treasurer's call is optional but the model choice is load-bearing for Phase 3.** Recommendation stated above (lazy-create `ledger_budgets` row). Flagging to you only if you want a say between that and a dedicated annotations table — otherwise tech-lead runs with the lazy-create recommendation.
5. **Per-FY vs carry-over** — Recommend: per-FY only (stars/notes belong to that year's `ledger_budgets`/`ledger_budget_lines` rows, consistent with how amounts already work). Carry-over is a follow-up if the treasurer finds themselves re-starring the same items every July.
6. **Lock interaction** — Recommend: notes/stars stay editable even when the FY is Approve-&-locked. They're working annotations, not the approved figures; freezing them would block exactly the kind of "note for next year" the treasurer would want to leave right after locking.
7. **Soft-delete interaction** — Recommend: a cause line marked `pending_delete_at` still renders its star/note until purge (consistent with how the row itself still displays until the purge-on-lock event).
8. **Printable worksheet** — Recommend: yes, stars/notes appear on `budget-print-worksheet.tsx`. This is explicitly a meeting-prep feature; leaving it off the printout defeats the point.
9. **Member-facing leak check** — **Confirmed clear, not a gap.** Verified directly: `/members/financial-reports` is served by `src/lib/financial-report-queries.ts`, which queries `ledgerTransactions` only — no import of `ledgerBudgets`/`ledgerBudgetLines` anywhere in that file. `/members/impact` is served by `getPhilanthropy()` in `src/lib/ledger-queries.ts`, a separate function from `getFundReport()` (the one that touches budgets) — the impact page's imports confirm this. So today's architecture already keeps budget data, and by extension any star/note field added to `ledgerBudgets`/`ledgerBudgetLines`, entirely out of both member surfaces. **Standing instruction for tech-lead/api-developer: do not add a `star`/`note` field to any select list shared with `getPhilanthropy` or the financial-report-queries path** — keep the annotation columns/table scoped to admin-only query functions.

**Genuinely worth a 30-second treasurer check-in:** Decision 4 (data model — only if they have a preference beyond "just make it work"), Decision 1 (is sort-to-top actually wanted, or is a plain star enough), Decision 6 (should locking freeze notes too — some treasurers may *want* notes frozen with the figures as an audit trail). Decisions 2, 3, 5, 7, 8, 9 are safe to default and proceed.

### User Confirmations (2026-07-28)

The three flagged decisions were put to the user; all three returned the analyst's recommended default:

- **Decision 1 (Star behavior):** ✅ **Flag + sort-to-top.** Starred rows show a filled star and float to the top of their group; existing `sortOrder`/`name` order preserved within each group (starred-first, then existing order). Starred-only filter remains a deferred follow-up.
- **Decision 6 (Lock behavior):** ✅ **Stars/notes stay editable** when the FY budget is Approve-&-locked. Annotation controls remain active even though `annualAmountCents` fields are disabled.
- **Decision 4 (Data model):** ✅ **Lazy-create the `ledger_budgets` row** (`annualAmountCents = 0`) on first star/note of an un-budgeted category, resolving the unique constraint `ledger_budgets_fund_year_cat_flow_key` via upsert. No separate annotations table; no schema flag distinguishing lazy-created-$0 from deliberately-budgeted-$0 (code comment only).

Decisions 2, 3, 5, 7, 8, 9 proceed on their recommended defaults. Phase 2 (architect) may begin.

## Recommended Phase 4 Split

database-admin (new column(s) on `ledger_budgets`/`ledger_budget_lines`, or the annotations table if Decision 4 goes that way, plus idempotent migration) → api-developer (server actions for star/note CRUD, gated by `ledger.manage`, wired into the existing budget-editor save paths) → ux-developer (star/note UI in `budget-editor.tsx`, `budget-cause-editor.tsx`, print rendering in `budget-print-worksheet.tsx`). This is small per-layer but touches three existing files plus schema — the specialist split keeps each change reviewable, and it's consistent with how prior Ledger increments (guided budgeting, DECISION-052/053) were staged.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.**

This feature reuses the existing budgeting module cleanly — no new directories, no new top-level modules, no new dependencies. But I found one implementation-correctness landmine in the lazy-create model that would silently corrupt real budget data if Phase 3/4 copy the nearest existing pattern (`upsertBudgetLine`'s `onConflictDoUpdate`) verbatim, and one invariant reversal (star/note writes must skip the lock check that every other budget write path enforces) that needs to be a loud, commented exception rather than an easy-to-miss omission. Both are addressed below as must-honor notes, not blockers — the shape of the feature is right.

## Placement

- **Directory placement:** No new directories or top-level modules. Everything lands in existing files, consistent with how every prior Ledger increment (cause lines, soft-delete, prior-year reference) extended this same module:
  - `src/lib/db/schema.ts` — new columns on the existing `ledgerBudgets` and `ledgerBudgetLines` `pgTable` definitions (around lines 772–836).
  - `drizzle/migrations/` — one new idempotent migration adding those columns.
  - `src/lib/ledger-queries.ts` — extend `FundReportCategoryLine` (lines 136–166) with `starred`/`note` fields, extend `getFundReport`'s per-category lookup maps (it already builds a `pendingDeleteMap` at line 610 in exactly this shape — the star/note maps are siblings of that), and add the write helper(s) (see Invariants below for why this should NOT simply extend `upsertBudgetLine`).
  - `src/app/api/admin/ledger/budgets/route.ts` and `.../cause-lines/route.ts`, or a new sibling route file — see routing note below.
  - `src/components/admin/ledger/budget-editor.tsx`, `budget-cause-editor.tsx`, `budget-print-worksheet.tsx` — UI additions only, no new component files strictly required (star/note controls are small enough to live inline in these three, matching how e.g. the pending-delete UI was added in place rather than as a new component).

- **Server vs Client split:** Already correct, no change in shape needed. `budget-editor.tsx` and `budget-cause-editor.tsx` are both already `"use client"` (confirmed — top of file) and already own their own `fetch(...).PATCH` round-trips to `/api/admin/ledger/budgets` and `/api/admin/ledger/budgets/cause-lines`; the star/note controls and their optimistic-update/toast-on-failure behavior (per Phase 1 Flows 1–3) belong there, following the same pattern already used for amount edits. `budget-print-worksheet.tsx` has no client code today (it's a static-snapshot component fed entirely by server-fetched props per its own doc comment) and should stay that way — star/note reach it as plain data fields on `PrintLine`, populated by the page Server Component that already assembles `PrintFund`/`PrintLine` from `getFundReport()`.

- **Dependencies:** None needed, confirmed. A boolean flag + a bounded plain-text field with a client-side character counter is fully covered by existing primitives (`sonner` toast, native `<textarea>`/popover, no new UI library). No dependency-evaluation criteria apply because nothing new is being introduced.

## Invariants Touched

- **Schema-is-source-of-truth:** Respected as designed, provided the order is followed — add the new columns to `schema.ts` first, then a matching idempotent SQL migration (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) under `drizzle/migrations/`. No new table needed (Decision 4 already ruled this out); this is a pure column addition to two existing tables.

- **Migrations re-run on every deploy:** Standard `ADD COLUMN IF NOT EXISTS` covers this — no special idempotency risk here since there's no seed data or conditional insert involved, just new nullable/defaulted columns.

- **Admin-only data-exposure boundary (Phase 1 Decision 9):** Verified independently, not just taking the analyst's word for it — `getPhilanthropy()` and `src/lib/financial-report-queries.ts` are confirmed structurally separate from `getFundReport()` and never import `ledgerBudgets`/`ledgerBudgetLines`. Standing instruction holds: the new `starred`/`note` columns must never appear in a select list shared with either of those paths. **Suggestion:** put a one-line doc comment directly on the new schema columns pointing at Decision 9 / this work-log slug, the same way `pendingDeleteAt` and `label` carry comments explaining their provenance — so a future refactor that touches `ledgerBudgets` doesn't casually widen a shared select statement into these two member-facing functions without noticing.

- **"Every budget-row write path is lock-gated" (the invariant this feature must deliberately break, on purpose, per Decision 6):** I checked every existing write helper against `ledger_budgets`/`ledger_budget_lines` — `upsertBudgetLine`, `setBudgetLinePendingDelete`, `createBudgetCauseLine`, `updateBudgetCauseLine`, `deleteBudgetCauseLine` — and every single one calls `assertBudgetUnlocked()` before writing, including the *restore* direction of the soft-delete flow (explicitly called out in that function's own doc comment as "restore is lock-guarded too"). Decision 6 requires the star/note write path to be the **first** exception to this pattern. That's a legitimate, confirmed-by-the-user product decision, not an architectural problem — but it means Phase 3/4 must treat "skip `assertBudgetUnlocked`" as an intentional, commented divergence (mirroring how `pendingDeleteAt`'s doc comment explains *why* it's written separately from `annualAmountCents`), not something a future maintainer stumbles on and "fixes" by adding the lock check back in. **This is the single highest-risk regression vector for this feature** — a well-intentioned future PR that "makes budget locking consistent" would silently violate Decision 6 unless the exception is self-documenting at the call site.

## Notes

Two must-honor items for Phase 3, plus two scoping questions worth resolving before implementation:

1. **The lazy-create upsert must not let the `ON CONFLICT DO UPDATE` clause touch `annualAmountCents`.** `upsertBudgetLine`'s existing pattern (lines 1039–1058 of `ledger-queries.ts`) inserts with `annualAmountCents` in the `.values()` AND re-writes it in the `.onConflictDoUpdate({ set: { annualAmountCents, ... } })` — correct for that function, because every call to it *means* "set this category's amount." The star/note write helper must NOT copy this shape wholesale: a star/note action on a category that **already has a real budgeted amount** (say $5,000) must not zero it out. The correct pattern is `INSERT ... VALUES (..., annualAmountCents: 0) ON CONFLICT (...) DO UPDATE SET starred = excluded.starred, note = excluded.note, updated_at = now()` — i.e., `annualAmountCents: 0` appears only in the insert values (used solely when no row exists yet) and is absent from the conflict's `SET` clause, so an existing row's real amount is left untouched on every star/note write. Get this wrong and the first time someone stars an already-budgeted category, its amount silently becomes $0. Tech-lead should call this out explicitly in the design doc's Data Model section and name the exact Drizzle shape, and QA (Phase 5) should include a specific test: star a category that already has a non-zero budgeted amount, then verify the amount is unchanged.

2. **Route placement:** I'd recommend against folding star/note into the existing `PATCH /api/admin/ledger/budgets` handler as a third mutually-exclusive "Shape C," even though that handler already has a shape-dispatch pattern (Shape A = amount, Shape B = pending-delete). Shape B is deliberately lock-gated; star/note deliberately is not. Bundling a lock-gated and a non-lock-gated write path behind one dispatch function, distinguished only by which body keys are present, is exactly the kind of thing that gets miscopied later (see the invariant note above). A separate route (e.g. a `.../budgets/annotations` PATCH, or equivalent for cause lines) makes the "this path skips the lock check, on purpose" fact obvious from the file/route name rather than buried in a conditional inside a handler whose sibling branch does the opposite. Tech-lead's call on exact naming, but the separation itself is the architectural recommendation.

3. **Cause-line grain doesn't need lazy-create.** Unlike category rows, a `ledger_budget_lines` row only ever exists once a cause line has actually been created (via the existing create-or-update `cause-lines` route) — there's no "un-budgeted cause line" rendered on screen the way `getFundReport` renders un-budgeted categories. So the cause-line star/note write is a plain upsert-by-`id` against an existing row (or 404 if the id doesn't exist), no conflict-target upsert logic needed there at all. Simpler than the category case — flagging so Phase 3 doesn't over-engineer symmetry between the two grains where none is needed.

4. **Scoping gap worth a deliberate call, not a silent default:** `budget-print-worksheet.tsx` today renders category rows only — it has no cause-line breakdown rendering at all (confirmed: no `causeLine` reference anywhere in that file). Decision 8 says stars/notes should appear on the printable worksheet, and Decision 3 confirms both grains are in scope for star/note generally — but if the worksheet never shows cause lines to begin with, a cause-line note has nowhere to render on paper without also adding cause-line breakdown to the worksheet for the first time (which would be scope creep beyond this feature). Recommend Phase 3 explicitly scope Decision 8 to **category-grain stars/notes only** on the print worksheet, and note cause-line annotations as screen-only for this increment — rather than have this surface as a surprise gap during Phase 4/5.

5. No loop-back to Phase 1 — the feature shape, permission gate, and data model choice are all sound. The items above are implementation-correctness and routing guidance for Phase 3, not a scope or intent problem.

---

# Phase 3 — Technical Design (tech-lead)

## Reconciling Phase 1/2 against the shipped B-29 restructure (read this first)

Phases 1–2 of this work-log were written against the *pre-restructure* budgeting page. B-29
(`docs/work-log/2026-07-29-budgeting-restructure.md`) shipped since, and reshaped the exact
rows this feature attaches to: category rows now live inside per-flow `Income`/`Expense`
sections (`renderFlowSection` in `guided-budget-setup.tsx`); a category can be `pendingDeleteAt`
**and** carry `causeLines` simultaneously (Flow 6); cause lines are grouped under a **new,
previously-nonexistent row grain** — the cause-group header (subtotal + group remove/restore) —
inside `budget-cause-editor.tsx`; and a cause line itself can independently be `pendingDeleteAt`
or `holdingForDelete` (the delayed-commit Undo state), rendered "dead" regardless of its parent
category's state.

**Verdict: every Phase 1 flow still holds, at the same two grains Phase 1 named (category row,
cause-line row) — no loop-back to Phase 1.** Specifically:

- **Flow 1/2 (star/note a category row)** — still attaches to the same conceptual row, now
  rendered inside `renderFlowSection`'s per-flow list instead of a flat fund-wide list, and in
  **three** render branches instead of two (pending-delete / in-breakdown / lump-sum, per
  `budget-editor.tsx`'s render-order fix) instead of two. All three branches render the category
  name; the annotation controls attach next to it in all three (see Component Plan).
- **Flow 3 (star/note a cause line)** — still attaches to the same conceptual row inside
  `budget-cause-editor.tsx`, now nested one level deeper (inside a cause-group header) than it
  was pre-restructure, and now itself has a "dead" (own-`pendingDeleteAt`/`holdingForDelete`)
  state independent of its parent. The annotation controls attach to the row regardless of dead
  state (see Decision 7, reaffirmed below).
- **Flow 4 (star/note an un-budgeted category)** — unaffected by B-29; confirmed by re-reading
  `getFundReport` (`src/lib/ledger-queries.ts:528-539`) that `categories` is *every active
  category for the fund's kind*, not just ones with a budget row — so `budgetEditorLines` already
  contains a row (with `budgetCents: null`) for every un-budgeted category, rendered by the same
  lump-sum branch a deliberately-$0 category uses. `FundSetupItem.unbudgetedCategories` (the
  "+ Add category" existing-category picker's source list) is confirmed dead-in-practice
  defensive code for a mismatch that can't currently occur — it is never the source of a rendered,
  annotatable row, so it needs no star/note handling.
- **Flow 5 (print worksheet)** — **re-scoped, not broken.** Phase 2's architect note had scoped
  worksheet stars/notes to category-grain only, reasoning "the print worksheet has no cause-line
  rendering at all." B-29 added exactly that rendering (folding in B-31). Per this task's
  explicit instruction, **cause-line stars/notes now also render on the worksheet** — see
  Component Plan.
- **Flow 6 (lock interaction)** — unaffected; B-29 didn't touch `assertBudgetUnlocked` semantics,
  only *which* write paths call it.
- **Flow 7 (soft-delete interaction, Decision 7)** — B-29 *added* a second, independent
  soft-delete axis (the cause line's own `pendingDeleteAt`/`holdingForDelete`) that didn't exist
  at Phase 1 time. Decision 7 ("a cause line marked pending-delete still renders its star/note
  until purge") is reaffirmed and extended: star/note stay visible **and editable** on a row in
  *either* dead state (own-flag pending-delete, or the client-only delayed-commit hold), and on a
  category row that's `pendingDeleteAt` regardless of whether it carries `causeLines`. This is a
  deliberate call, not a silent default — see Edge Cases.

**One genuinely new scope question B-29 raises that Phase 1 never addressed, because the grain
didn't exist yet: the cause-GROUP header.** B-29 introduced a third row grain (a cause name +
subtotal + group remove/restore control) between the category row and its individual cause
lines. Phase 1's Decision 3 confirmed grain coverage as "category rows and cause line rows" —
literally, not "every grain the editor has." **Ruling: cause-group headers get no star/note in
this increment.** Extending to a grain the original request never asked for is scope creep, not
a gap-fill; if the treasurer wants "flag this whole cause for discussion" after using the shipped
increment, that's a well-scoped follow-up (a single boolean/note pair keyed by
`(budgetId, cause)`, no new row-identity problem), not something this design should build
speculatively. **This does not warrant a Phase 1 loop-back** — it's an explicit non-goal, stated
here rather than silently omitted.

## Summary

We're adding a **star** (boolean flag) and a **note** (≤500-char plain text) to both the category
row (`ledger_budgets`) and the cause-line row (`ledger_budget_lines`), visible and editable on
both the interactive budgeting page and the printable worksheet, gated by the existing
`ledger.manage` permission with no new `FEATURES` key. Starred rows sort to the top of their
group (flow section for categories; cause group for cause lines), computed client-side from
optimistic local state so the reorder is instant on click — safe to do instantly, where it
wouldn't have been before B-29, because B-29's `onMouseDown={preventDefault}` mitigation (applied
to every new star/note control here too) already defends against exactly the DOM-reorder-under-a-click
hazard an instant reorder would otherwise risk reintroducing.

The two new columns get their own pair of routes — `PATCH /api/admin/ledger/budgets/annotations`
(category grain, lazy-creates the `ledger_budgets` row on first star/note of an un-budgeted
category) and `PATCH /api/admin/ledger/budgets/cause-lines/annotations` (cause-line grain, plain
update against an existing row, no lazy-create needed) — deliberately kept off the two existing
lock-gated PATCH dispatchers (`/budgets`, `/budgets/cause-lines`) per the architect's Phase 2
ruling: this is the **first** budget write path that must intentionally skip
`assertBudgetUnlocked()`, and burying that exception inside an existing lock-gated dispatcher is
exactly the kind of thing a future "make locking consistent" refactor would silently undo.

## Permissions

- **Permission:** existing `ledger.manage` (`FEATURES.LEDGER_MANAGE`) — unchanged. No new
  `FEATURES` key, no new migration for role bindings.
- **No independent gate.** Unlike every other budget write path in this codebase, the two new
  endpoints below **deliberately do not call `assertBudgetUnlocked()`** (Phase 1 Decision 6,
  user-confirmed: stars/notes stay editable even when the FY is Approve-&-locked). This is the
  single highest-risk regression vector the architect flagged in Phase 2 — see the loud comment
  requirement in API Contract below.

## API Contract

### 1. `PATCH /api/admin/ledger/budgets/annotations` — category-grain star/note (new route)

```
PATCH /api/admin/ledger/budgets/annotations
Body: {
  fundId: string;
  fiscalYear: number;
  categoryId: string;
  flow: 'income' | 'expense';
  starred?: boolean;
  note?: string | null;          // at least one of starred/note required
}
Response 200: { starred: boolean; note: string | null }
Errors: 400 (bad shape; neither starred nor note present; note > 500 chars after trim),
        404 (fund or category not found)
```

**No 409 `locked` — ever.** This route never calls `assertBudgetUnlocked()`. The route file's
header comment must say so explicitly and point at this work-log + DECISION-057, in the same
style `setBudgetLinePendingDelete`'s doc comment explains why *it* dropped the
`has_cause_breakdown` guard — so a future maintainer scans the comment before "fixing" the
omission:

```ts
/**
 * INTENTIONAL: this route never calls assertBudgetUnlocked(). Star/note are
 * working annotations, not budget figures — Phase 1 Decision 6
 * (docs/work-log/2026-07-28-budget-star-notes.md) requires them to stay
 * editable even when the FY budget is Approve-&-locked. Do NOT add a lock
 * check here to "make locking consistent" — that would silently reverse a
 * confirmed product decision. See DECISION-057.
 */
```

Backed by a new query function, `setBudgetCategoryAnnotation(params, tx = db)` in
`ledger-queries.ts`:

1. Look up `fund` (by `fundId`) and `category` (by `categoryId`) — same lookups
   `upsertBudgetLine` already does — 404 if either is missing.
2. Normalize `note`: `undefined` → not being changed; `null` or `""` (after trim) → stored as
   `null` (empty note has exactly one representation, mirroring the `causeLines`-never-`[]`
   discipline elsewhere in this file); otherwise trim and cap-check at `MAX_BUDGET_NOTE_LENGTH`
   (`500`, new export in `src/lib/ledger.ts`, sibling to `MAX_BUDGET_LINE_LABEL_LENGTH`) → 400 if
   over.
3. **The lazy-create upsert — architect's must-honor item, named exactly:**
   ```ts
   const [row] = await tx
     .insert(ledgerBudgets)
     .values({
       entityId: fund.entityId,
       fundId,
       fiscalYear,
       categoryId,
       flow,
       annualAmountCents: 0,           // ONLY here — used solely when no row exists yet
       starred: starred ?? false,
       note: note ?? null,
     })
     .onConflictDoUpdate({
       target: [ledgerBudgets.fundId, ledgerBudgets.fiscalYear, ledgerBudgets.categoryId, ledgerBudgets.flow],
       set: {
         // annualAmountCents is ABSENT here, on purpose — an existing row's
         // real budgeted amount must never be touched by a star/note write.
         ...(starred !== undefined ? { starred } : {}),
         ...(note !== undefined ? { note } : {}),
         updatedAt: new Date(),
       },
     })
     .returning({ starred: ledgerBudgets.starred, note: ledgerBudgets.note });
   ```
   Note the conditional spread on the `set` clause: if the caller only sent `starred` (a star
   click, no note change), the `set` object must not include `note` at all — an unconditional
   `note: note ?? null` in the conflict `set` would silently blank out an existing note every
   time the treasurer only meant to toggle the star. Same logic in reverse for a note-only save.
4. No cause-line-children guard of any kind — this function has no relationship to
   `has_cause_breakdown` (that guard is about numeric-overwrite/cascade hazards on **amount**
   writes; this never touches `annualAmountCents` after the initial insert).

### 2. `PATCH /api/admin/ledger/budgets/cause-lines/annotations` — cause-line-grain star/note (new route)

```
PATCH /api/admin/ledger/budgets/cause-lines/annotations
Body: { id: string; starred?: boolean; note?: string | null }   // at least one required
Response 200: { starred: boolean; note: string | null }
Errors: 400 (bad shape; neither field present; note > 500 chars), 404 (no line for this id)
```

Same "no lock check, ever" doc-comment requirement as route 1. Backed by
`setBudgetCauseLineAnnotation({ id, starred, note }, tx = db)`:

1. Look up the line by `id` → 404 if missing. **No lazy-create** — per the architect's Phase 2
   point 3, a cause line only ever exists once actually created via the existing create-or-update
   route; there is no "un-budgeted cause line" rendered anywhere the way an un-budgeted category
   is.
2. Same note normalization as route 1.
3. Plain conditional `UPDATE`:
   ```ts
   await tx.update(ledgerBudgetLines)
     .set({
       ...(starred !== undefined ? { starred } : {}),
       ...(note !== undefined ? { note } : {}),
       updatedAt: new Date(),
     })
     .where(eq(ledgerBudgetLines.id, id));
   ```
4. No parent lookup, no fund/entity resolution, no lock check — this function has zero
   relationship to `assertBudgetUnlocked` and should not import it.

Both routes gate identically to every other budget write: `auth()` + `hasFeature(session.user.id,
FEATURES.LEDGER_MANAGE)`, 401/403 first, same as `/budgets` and `/budgets/cause-lines`.

## Data Model

**Four columns, two tables.** `src/lib/db/schema.ts`:

```ts
// On ledgerBudgets (near pendingDeleteAt):
// Star/notes (Budget Star & Notes, DECISION-057). Working annotations, NOT
// budget figures — stay editable even when this FY's budget is
// Approve-&-locked (Phase 1 Decision 6). Never appear in any select shared
// with getPhilanthropy() or financial-report-queries.ts (Phase 1 Decision 9 /
// architect's Phase 2 note) — this data is admin-only, scoped to
// getFundReport() and its callers.
starred: boolean("starred").notNull().default(false),
note: text("note"),   // null = no note; "" is never stored (normalized to null)

// On ledgerBudgetLines (near pendingDeleteAt): identical pair, same doc comment.
starred: boolean("starred").notNull().default(false),
note: text("note"),
```

No DB `CHECK` on the 500-char limit — consistent with DECISION-041's precedent (app-code
enforcement only, same as the existing 120-char label cap).

Migration `drizzle/migrations/0068_ledger_budget_star_notes.sql` (next number after 0067):

```sql
-- Budget Star & Notes (DECISION-057). Idempotent column adds; existing rows
-- default to starred=false, note=NULL — no backfill needed.
ALTER TABLE ledger_budgets ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ledger_budgets ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE ledger_budget_lines ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ledger_budget_lines ADD COLUMN IF NOT EXISTS note TEXT;
```

No new index — `starred`/`note` are only ever read alongside a row already being fetched by
`fund_id`/`fiscal_year` (category grain) or `budget_id` (cause-line grain), both already indexed.

`src/lib/ledger.ts` gains `export const MAX_BUDGET_NOTE_LENGTH = 500;`, sibling to the existing
`MAX_BUDGET_LINE_LABEL_LENGTH = 120`.

### `getFundReport` threading (`src/lib/ledger-queries.ts`)

Mirrors the exact `pendingDeleteMap` pattern already in this function (lines 620-646):

- Two new sibling maps, built in the same loop that builds `pendingDeleteMap`:
  `starredMap: Map<string, boolean>` and `noteMap: Map<string, string | null>`, keyed
  `${categoryId}_${flow}`, populated from `budgetRows[i].starred`/`.note`.
- `FundReportCategoryLine` gains:
  ```ts
  starred: boolean;        // starredMap.get(key) ?? false — false when no budget row exists
  note: string | null;     // noteMap.get(key) ?? null
  ```
- `budgetLineRows`'s select (line 584-597) gains `starred: ledgerBudgetLines.starred,
  note: ledgerBudgetLines.note`; `causeLinesFor()`'s returned object shape (line 602-618, 639-646)
  gains the same two fields, threaded through exactly like `pendingDeleteAt` was in the
  restructure. So each `FundReportCategoryLine.causeLines[]` entry becomes:
  `{ id, cause, label, amountCents, pendingDeleteAt, starred, note }`.

**Admin-only boundary (Phase 1 Decision 9, reaffirmed) — nothing to change, only to not break.**
Independently re-verified: `getPhilanthropy()` and `src/lib/financial-report-queries.ts` still
have zero imports of `ledgerBudgets`/`ledgerBudgetLines` (unchanged by B-29). The schema doc
comments above exist specifically so a future refactor that widens `getFundReport`'s select
doesn't casually leak `starred`/`note` into either member-facing path without a maintainer
noticing the comment first.

## Component / Page Plan

No new files. Files modified:

- `src/lib/db/schema.ts`, `drizzle/migrations/0068_ledger_budget_star_notes.sql` — schema.
- `src/lib/ledger.ts` — `MAX_BUDGET_NOTE_LENGTH`.
- `src/lib/ledger-queries.ts` — `setBudgetCategoryAnnotation`, `setBudgetCauseLineAnnotation`,
  `FundReportCategoryLine` widened, `getFundReport`'s two new maps + `causeLines[]` widening.
- `src/app/api/admin/ledger/budgets/annotations/route.ts` — **new file**, `PATCH` only.
- `src/app/api/admin/ledger/budgets/cause-lines/annotations/route.ts` — **new file**, `PATCH`
  only.
- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` — thread `starred`/`note` through into
  `FundSetupItem.budgetEditorLines[]` and `enrichCauseLines()` (both a straight pass-through, no
  new query — same shape-widening-only change B-29 made here for `pendingDeleteAt`).
- `src/components/admin/ledger/guided-budget-setup.tsx` — `FundSetupItem.budgetEditorLines[]`
  type widened; `renderFlowSection`'s `sectionLines` gains the stable star-sort (below).
- `src/components/admin/ledger/budget-editor.tsx` — `BudgetLine` type widened; new
  `renderCategoryAnnotationControls(line, key)`; local `starOverride`/`noteDraftKey` state;
  `showAnnotationControls` prop (default `false`, mirrors `showRemoveControl`'s existing
  opt-in convention so `[fundSlug]/report/page.tsx` — which passes neither today — doesn't
  suddenly grow star/note UI it wasn't asked for).
- `src/components/admin/ledger/budget-cause-editor.tsx` — `BudgetCauseLine`/`Row` types widened;
  per-row star/note controls; stable star-sort within each cause group; `ALL_CAUSES`-style
  export not needed here (no new shared constant).
- `src/components/admin/ledger/budget-print-worksheet.tsx` — `PrintLine`/`PrintCauseLine` types
  widened; star glyph + conditional note row at both grains.

### `BudgetEditor` (`budget-editor.tsx`) — annotation controls

New prop: `showAnnotationControls?: boolean` (default `false`), passed `true` only from
`guided-budget-setup.tsx` (the interactive budgeting page) — **not** from
`[fundSlug]/report/page.tsx`, which today passes neither `showRemoveControl` nor any of the
pending-delete callbacks and stays that way; adding star/note UI there is out of scope (Phase 1
never named that surface).

Two new pieces of local state, mirroring `breakdownOverride`'s existing shadow-then-reconcile
idiom (`override !== undefined ? override : serverValue`):

```ts
// Optimistic star state, shadows line.starred until the next router.refresh()
// reconciles it. Lets sort-to-top happen instantly on click (see the
// stable-sort note below) without waiting for a round trip.
const [starOverride, setStarOverride] = useState<Record<string, boolean>>({});
// Which category row's note editor is open — one at a time, mirrors
// addCauseKey's single-open convention.
const [noteEditKey, setNoteEditKey] = useState<string | null>(null);
const [noteDraft, setNoteDraft] = useState<string>("");
```

`renderCategoryAnnotationControls(line, key)` — a small icon cluster (star toggle button + note
button, each `min-h-[44px] min-w-[44px]`, `onMouseDown={preventMouseDownDefault}` per the
existing per-file convention) rendered next to `categoryName` in **all three** render branches
(pending-delete, in-breakdown, lump-sum) when `showAnnotationControls` is true:

- **Star toggle** — filled/outline star icon; `onClick` optimistically flips `starOverride[key]`,
  fires `PATCH /budgets/annotations { fundId, fiscalYear, categoryId, flow, starred: next }`, on
  failure reverts the override and toasts ("Couldn't save — try again," per Phase 1 Flow 1's
  named failure copy), on success calls `router.refresh()` same as every other write here.
- **Note button** — icon is filled/highlighted when `(noteOverride ?? line.note)` is non-empty,
  outline otherwise (Phase 1's empty-state gap: unfilled by default, reads as "available action").
  Click toggles `noteEditKey === key`; opening seeds `noteDraft` from the current note. Renders an
  inline `<textarea maxLength={500}>` directly under the row (not a modal — Phase 1 Flow 2's
  explicit "never a blocking modal" instruction) with a live `${noteDraft.length}/500` counter
  (red past 500) and two buttons:
  - **Save** (`onMouseDown={preventMouseDownDefault}`, same blur-race defense as everywhere else
    in this file — clicking Save blurs the textarea a moment before the click lands, exactly the
    hazard B-29 spent a whole feature fixing) — PATCHes `note: trimmed || null`; on success closes
    the editor; on failure (network, or a stale 400 if length validation somehow disagrees with
    the client) **keeps the editor open with the typed text intact** and toasts an error — no
    silent loss of typed input, per Phase 1 Flow 2's explicit requirement.
  - **Cancel** — discards the draft, closes the editor, no network call.
  - Deliberately **no autosave on blur** — Phase 1's flow text offered "saves on blur or explicit
    Save button" as either; picking Save-button-only avoids introducing a second instance of the
    exact blur-vs-click race class B-29 just finished fixing (blurring a textarea to click Save
    must not race the click), and the mitigation is the same one-line fix (`onMouseDown`
    preventDefault) rather than a new blur-commit code path this feature would have to invent.

### `renderFlowSection`'s sort-to-top (`guided-budget-setup.tsx`)

```ts
// Stable sort: starred rows first, existing order preserved otherwise
// (Phase 1 Decision 1, user-confirmed). Computed from starOverride-shadowed
// state so a star click reorders instantly — see budget-editor.tsx's comment
// on why this is safe post-B-29 (onMouseDown preventDefault on every
// star/note control already defends against the reorder-under-a-click
// hazard this would otherwise risk).
const sectionLines = [...fund.budgetEditorLines.filter((l) => l.flow === flow)]
  .sort((a, b) => Number(isStarred(b)) - Number(isStarred(a)));
```

`Array.prototype.sort` has been stable since ES2019 in every engine this project targets, so
relative order within the starred and non-starred partitions is preserved for free.

### `BudgetCauseEditor` (`budget-cause-editor.tsx`) — annotation controls + sort

`Row` gains `starred: boolean` and `note: string | null`, seeded from `BudgetCauseLine.starred`/
`.note` in the `useState` initializer (same seeding spot as `pendingDeleteAt`). Because this
component's `rows` array is **local state that does not re-sync from props on every render**
(only mutated by its own commit handlers — confirmed by reading the existing
`useState<Row[]>(() => initialLines.map(...))` lazy initializer), a star toggle here updates
`rows` directly (`setRows(prev => prev.map(r => r.id === rowId ? {...r, starred: next} : r))`)
and fires the PATCH; no separate "override" shadow state is needed at this grain the way
`budget-editor.tsx` needs one, since there's no server-truth prop to reconcile against mid-session.

Per-cause-group render (`groupOrder.map((cause) => { const indices = ... })`): sort `indices` by
`rows[i].starred` (descending) before mapping to rows, same stable-sort rule, scoped to *within
that cause group* (Decision 1's "within each group" — the group here is the cause, not the whole
category).

Star/note icon buttons render in the row's control cluster (alongside the existing trash icon),
in **both** the live and dead (`isRowDead(row)`) render branches — Decision 7, reaffirmed: a row
that's individually pending-delete or mid-hold still shows and allows editing its own star/note.
Note editor: identical inline-textarea-with-Save/Cancel pattern as `budget-editor.tsx`, using a
per-row `noteEditRowId: string | number | null` (row `id` when committed, array index for a
never-saved pending row — though in practice a never-saved row's star/note has nothing to PATCH
against yet; see Edge Cases).

### `BudgetPrintWorksheet` (`budget-print-worksheet.tsx`)

`PrintCauseLine` gains `starred?: boolean; note?: string | null` (optional, mirrors
`pendingDeleteAt?`'s existing optional convention for structural assignability).
`PrintLine` gains `starred: boolean; note: string | null` (non-optional, mirrors
`pendingDeleteAt`'s non-optional convention at this grain — `PrintFund` is fed directly from
`FundSetupItem.budgetEditorLines`, which always has both fields once this ships).

Rendering, at both grains, compact (consistent with B-29's Q4 "compact" resolution — no new
blank hand-annotation lines, no page-count blow-up for the common case of zero stars/notes):

- **Star** — a literal `★ ` prefix character on `line.categoryName` / the cause-line's
  `label || "(generic)"`, print-only static text, no icon component needed.
- **Note** — rendered **only when non-empty** (so a fund with zero notes prints identically to
  today), as one additional compact `<tr>` directly under the row it annotates: small italic gray
  text, `colSpan` matching the row, prefixed `Note: `. This satisfies the re-scoped Decision 8 —
  cause-line notes now print too, since B-29's cause/line rendering makes that possible — without
  duplicating the blank hand-annotation ruled lines (which stay at category-subtotal grain only,
  per B-29's Q4, unchanged by this feature).
- **Exclusion is already correct with zero new code**: pending-delete categories/lines are
  already filtered out of the printout entirely (`FundWorksheet`'s category filter,
  `isCauseLineLive` for cause lines) before star/note ever get a chance to render for them — a
  row about to be purged never reaches the print path, so there's no "starred-but-about-to-be-deleted"
  state to reconcile on paper.

## Implementation Order

1. **Schema** (`database-admin`) — add `starred`/`note` to both tables in `schema.ts`;
   `drizzle/migrations/0068_ledger_budget_star_notes.sql`; run `pnpm db:migrate` locally, confirm
   idempotency by re-running once.
2. **Server logic** (`api-developer`):
   a. `MAX_BUDGET_NOTE_LENGTH` in `ledger.ts`.
   b. `setBudgetCategoryAnnotation` + `setBudgetCauseLineAnnotation` in `ledger-queries.ts`,
      including the conditional-`set`-clause upsert shape named exactly above.
   c. New routes: `budgets/annotations/route.ts`, `budgets/cause-lines/annotations/route.ts` —
      each with the loud "never calls assertBudgetUnlocked" doc comment.
   d. `getFundReport`'s two new maps + `causeLines[]`/`FundReportCategoryLine` widening.
   e. Unit tests named below.
3. **UI** (`ux-developer`) — `page.tsx`'s thread-through; `guided-budget-setup.tsx`'s sort-to-top;
   `budget-editor.tsx`'s `showAnnotationControls` + star/note controls across all three render
   branches; `budget-cause-editor.tsx`'s per-row controls + within-group sort; the print
   worksheet's star glyph + conditional note row at both grains. Mobile 44px tap targets on every
   new control, matching B-29's own standard.

## Edge Cases & Risks

- **The lazy-create upsert's conflict-`set` clause must be built conditionally, not
  unconditionally.** Named exactly in API Contract above — this is the architect's single
  highest-named risk (a star click on an already-$5,000-budgeted category must never zero it,
  and a star-only click must never blank an existing note, or vice versa). QA must include the
  specific regression: star an already-budgeted, already-noted category, toggling only the star,
  and assert both `annualAmountCents` and `note` are byte-for-byte unchanged.
- **The "never calls `assertBudgetUnlocked`" exception is the single highest regression risk in
  this feature**, per the architect. Both new query functions must have zero import of
  `assertBudgetUnlocked`, and the route files' header comments must state the omission is
  intentional, citing DECISION-057 — a future "audit every write path for a missing lock check"
  pass (the kind the 30-day code review runs) must be able to find the justification at the call
  site, not have to reconstruct it from this work-log.
- **Instant client-side reorder is safe *because* of B-29's `onMouseDown` fix, not despite it** —
  every new star/note control gets the same `onMouseDown={preventMouseDownDefault}` treatment
  already applied to every add/remove/restore control in both files. Skipping this on a star
  button specifically would reintroduce, in miniature, the exact blur-vs-click race B-29's entire
  feature existed to fix (a reorder displacing a control out from under an in-flight click).
- **A never-saved (uncommitted) cause line row has nothing to star/note against yet.** A pending
  pre-fill row (`id === null`, the first row of a not-yet-saved breakdown, or a freshly-clicked
  "+ add line item" row before its first blur/Enter commit) has no `ledger_budget_lines.id` to
  PATCH. Recommend: hide the star/note controls on a row until it has a committed `id` (mirrors
  how `requestRemove`'s never-saved branch is a pure local no-op today) — a treasurer who wants to
  flag a brand-new line stars/notes it *after* the first commit, which happens automatically on
  blur/Enter as part of entering the amount, so this is a one-keystroke delay, not a missing
  feature.
- **Un-budgeted category's un-normalized `note: ""`.** Both new query functions normalize a
  trimmed-empty note to `null` before writing — confirmed as a deliberate design choice above, not
  left to each call site to reinvent independently.
- **Concurrent editors (Phase 1 Gap, confirmed no new handling needed).** Last-write-wins, same as
  every other budgeting write path in this codebase (`upsertBudgetLine`,
  `setBudgetCauseLinePendingDelete`, etc.) — no new conflict resolution introduced here.
- **Cause-group headers get no star/note** (see the Phase 1/2 reconciliation section above) — a
  deliberate non-goal, not an oversight; flag as a candidate follow-up only if the treasurer asks
  for it after using this increment.
- **`[fundSlug]/report/page.tsx` gets no star/note UI** — `showAnnotationControls` defaults
  `false` and that caller doesn't opt in, consistent with how it already opts out of
  `showRemoveControl` today. If a future increment wants annotations visible there too, it's a
  one-line prop change, not a design gap.

## Implementer

**Specialist split**, consistent with every prior Ledger budgeting increment (guided budgeting,
B-29):

1. **database-admin** — `schema.ts` + `drizzle/migrations/0068_ledger_budget_star_notes.sql`.
2. **api-developer** — `MAX_BUDGET_NOTE_LENGTH` (`ledger.ts`); `setBudgetCategoryAnnotation` +
   `setBudgetCauseLineAnnotation` (`ledger-queries.ts`); the two new route files; `getFundReport`'s
   widening.
3. **ux-developer** — `page.tsx`'s thread-through; `guided-budget-setup.tsx`'s sort-to-top;
   `budget-editor.tsx`'s and `budget-cause-editor.tsx`'s star/note controls; the print worksheet's
   star glyph + conditional note row.

### Unit tests to write (implementer delivers these — not qa)

- `setBudgetCategoryAnnotation` — lazy-create on an un-budgeted category (asserts
  `annualAmountCents: 0`, `starred`/`note` set correctly); star-only toggle on an
  already-budgeted, already-noted category leaves `annualAmountCents` **and** `note`
  byte-for-byte unchanged (the architect's named risk, directly tested); note-only save leaves
  `starred` unchanged; empty/whitespace-only note normalizes to `null`; note over 500 chars after
  trim → 400; unknown `fundId`/`categoryId` → 404; **no test asserts a 409 `locked`** — confirm
  the function has no path that can produce one (i.e., no `assertBudgetUnlocked` import at all).
- `setBudgetCauseLineAnnotation` — happy path both fields, star-only, note-only (same
  independent-field assertions as above); unknown `id` → 404; note length validation; confirm no
  `assertBudgetUnlocked` import.
- `getFundReport` — a budget row with `starred: true`/`note: "..."` surfaces both on its
  `FundReportCategoryLine`; a cause line with the same surfaces on its `causeLines[]` entry; an
  un-budgeted category's row reports `starred: false, note: null` (not `undefined`, not missing).
- **Admin-only boundary regression** — a small test (or a grep-based check, whichever this
  project's existing convention favors for DECISION-041-style boundaries) confirming
  `getPhilanthropy()` and every export in `financial-report-queries.ts` still contain no
  reference to `starred`/`note`/`ledgerBudgets`/`ledgerBudgetLines`.

---

# Phase 4 — Implementation

## Phase 4 — Implementation (schema) — 2026-07-29

**Owner:** database-admin
**Status:** complete

### Summary

Added `starred boolean not null default false` and `note text` (nullable) to both
`ledger_budgets` and `ledger_budget_lines`, per DECISION-057. Migration applied to the local
Neon DB and confirmed idempotent on re-run. No index, no DB CHECK on note length (app-enforced,
DECISION-041 precedent). Stayed strictly in the schema lane — did not touch
`ledger-queries.ts`, `ledger.ts`, routes, or components.

### What I did

- Read the Phase 3 design doc and DECISION-057 in full before touching `schema.ts`.
- Added `starred`/`note` columns to `ledgerBudgets`, placed after `annualAmountCents` and
  before the existing `pendingDeleteAt` column, with a comment block explaining both fields
  are writable even when the FY budget is locked (per DECISION-057).
- Mirrored the same two columns on `ledgerBudgetLines` in the same position, with a shorter
  comment pointing back to the `ledgerBudgets` rationale.
- Wrote `drizzle/migrations/0068_ledger_budget_star_notes.sql` — four `ALTER TABLE ... ADD
  COLUMN IF NOT EXISTS` statements, mirroring the 0066/0067 style.
- Applied via `pnpm db:migrate`, verified column shape via `psql \d`, then re-ran
  `pnpm db:migrate` a second time and confirmed all four columns produced "already exists,
  skipping" notices (idempotency confirmed).
- Ran `pnpm exec tsc --noEmit` — clean, no output.
- Did **not** run `pnpm db:push` (out of lane per instructions — `schema.ts` and the DB were
  already in sync via the direct migration).

### Outputs

- Schema changes: `src/lib/db/schema.ts` — `ledgerBudgets` (line ~786-791) and
  `ledgerBudgetLines` (line ~825-829) each gained:
  - `starred: boolean("starred").notNull().default(false)`
  - `note: text("note")` (nullable, no default)
- Migration file: `drizzle/migrations/0068_ledger_budget_star_notes.sql` — all four
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements, confirmed idempotent by a second
  `pnpm db:migrate` run (all four produced Postgres NOTICE "already exists, skipping").
- Tables affected: `ledger_budgets`, `ledger_budget_lines` (verified via `psql "$DATABASE_URL"
  -c "\d ledger_budgets"` / `\d ledger_budget_lines`: `starred boolean not null default false`,
  `note text` nullable, no default, on both tables).
- No role bindings or seed rows needed — this feature reuses the existing `ledger.manage`
  permission, no new `FEATURES` key.
- Local apply command already run: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) &&
  pnpm db:migrate`. No `pnpm db:push` needed (schema and migration applied in lockstep).

### Open questions / handoff notes

- **Next agent: api-developer.** Both columns are now live on both tables and available for
  query/write functions.
- `ledgerBudgets.starred` / `ledgerBudgets.note` and `ledgerBudgetLines.starred` /
  `ledgerBudgetLines.note` — no FK changes, no new indexes (DECISION-057 explicitly calls for
  none; neither column participates in a hot filtered read).
- Per DECISION-057: the two new write paths (`setBudgetCategoryAnnotation`,
  `setBudgetCauseLineAnnotation`) must **not** call `assertBudgetUnlocked()` — this is
  intentional (Phase 1 Decision 6), not an oversight to "fix." Route files should carry a loud
  header comment citing DECISION-057 so a future audit pass doesn't silently add the lock
  check.
- Per DECISION-057: the lazy-create upsert for `setBudgetCategoryAnnotation` must put
  `annualAmountCents: 0` only in the insert `.values()`, and build the `onConflictDoUpdate`
  `set` clause conditionally so `starred`/`note` are only included when the caller actually
  sent them — a star-only click must never blank an existing note or zero out a real budgeted
  amount.
- `setBudgetCauseLineAnnotation` has no lazy-create path — a cause line only ever exists once
  actually created, so this is a plain conditional `UPDATE` by `id`.
- Did not touch `ledger-queries.ts`, `ledger.ts`, `getFundReport`, `getPhilanthropy()`, or any
  route/component — left entirely for api-developer / ux-developer per the design's
  admin-only-boundary requirement (starred/note must never leak into
  `financial-report-queries.ts` or `getPhilanthropy()`).

---

## Phase 4 — Implementation (API) — 2026-07-29

**Owner:** api-developer
**Status:** complete

### Summary

Built the server/logic layer per the Phase 3 design and DECISION-057: the pure note
normalizer and length constant in `ledger.ts`, the two conditional-upsert/update write
functions in `ledger-queries.ts` (neither calling `assertBudgetUnlocked`, per Decision 6),
`getFundReport`'s widening to surface `starred`/`note` at both grains, and two new
lock-check-free routes. All Phase 3-named unit tests are written and passing, including the
architect's named landmine regression (star-only toggle never zeroes an existing amount or
blanks an existing note) and a grep-based regression guard proving neither new function
references `assertBudgetUnlocked`. Also independently re-verified the Phase 1/2/3 admin-only
boundary claim in code and found (and corrected in-code, not just in prose) a factual gap in
how that claim was phrased — see Open Questions below.

### What I did

- Read the Phase 3 design doc and DECISION-057 in full, plus the schema handoff notes, before
  writing any code.
- `src/lib/ledger.ts`: added `MAX_BUDGET_NOTE_LENGTH = 500` and the pure `normalizeBudgetNote()`
  helper (trim-only, mirrors `normalizeBudgetLineLabel`'s discipline — null/undefined/whitespace
  normalize to `""`; the DB-touching caller collapses `""` to `null` and enforces the length cap).
- `src/lib/ledger-queries.ts`:
  - Added `setBudgetCategoryAnnotation()` — category-grain star/note write. Lazy-creates the
    `ledger_budgets` row (`annualAmountCents: 0` **only** in `.values()`); the
    `onConflictDoUpdate` `set` clause is built conditionally so `starred`/`note` are included
    **only** when the caller actually sent them. No `assertBudgetUnlocked` import, no lock check
    — loudly commented as intentional (DECISION-057).
  - Added `setBudgetCauseLineAnnotation()` — cause-line-grain star/note write. Plain conditional
    `UPDATE ... WHERE id`, no lazy-create (a cause line only ever exists once actually created).
    Same no-lock-check discipline and comment.
  - Widened `FundReportCategoryLine` (`starred: boolean; note: string | null` at the category
    grain; `starred`/`note` added to every `causeLines[]` entry) and `getFundReport()` itself:
    two new sibling maps (`starredMap`, `noteMap`) built in the same loop as the existing
    `pendingDeleteMap`; `budgetLineRows`'s select and `causeLinesFor()`'s return shape widened
    to carry the same two fields through to each cause line.
  - Updated `getEntityReport()`'s two `FundReportCategoryLine`-shaped push sites (it never
    surfaces budgets) to set `starred: false, note: null` explicitly, satisfying the widened
    type with the same "never surfaces budgets" reasoning it already uses for `budgetCents`/
    `causeLines`/`pendingDeleteAt`.
- Added two new route files, both PATCH-only, both carrying the loud "never calls
  `assertBudgetUnlocked` — see DECISION-057" header comment named in the design:
  - `src/app/api/admin/ledger/budgets/annotations/route.ts`
  - `src/app/api/admin/ledger/budgets/cause-lines/annotations/route.ts`
- Wrote every unit test the Phase 3 design named (see Outputs) in `src/lib/ledger.test.ts` and
  `src/lib/ledger-queries.test.ts`, extending the existing `makeMockTx` harness to capture the
  `set` object passed to `.onConflictDoUpdate(...)` (previously uncaptured) so the conditional-
  upsert landmine could be asserted directly rather than only inferred from the mocked return
  value.
- Independently re-verified the admin-only boundary (Phase 1 Decision 9) in code, not just by
  re-reading the prior phases' prose — see Open Questions for a correction to that prose.
- Ran `pnpm exec tsc --noEmit` (clean), `pnpm test` (741/741 passing, all files), and
  `pnpm build:only` (succeeds; both new routes appear in the route manifest as
  `ƒ /api/admin/ledger/budgets/annotations` and
  `ƒ /api/admin/ledger/budgets/cause-lines/annotations`).
- Did not touch `guided-budget-setup.tsx`, `budget-editor.tsx`, `budget-cause-editor.tsx`, or
  `budget-print-worksheet.tsx` — left entirely for ux-developer.

### Outputs

**Server helpers** — `src/lib/ledger.ts`:
- `MAX_BUDGET_NOTE_LENGTH = 500`
- `normalizeBudgetNote(raw: string | undefined | null): string` — pure, trim-only.

**Query layer** — `src/lib/ledger-queries.ts`:
- `setBudgetCategoryAnnotation(params, tx = db): Promise<SetBudgetAnnotationResult>`
  - `params: { fundId: string; fiscalYear: number; categoryId: string; flow: 'income' | 'expense'; starred?: boolean; note?: string | null }`
  - `SetBudgetAnnotationResult = { ok: true; starred: boolean; note: string | null } | { ok: false; error: string; status: 400 | 404 }` — **no 409 ever**, no `reason` field, no `assertBudgetUnlocked` import.
- `setBudgetCauseLineAnnotation(params, tx = db): Promise<SetBudgetAnnotationResult>`
  - `params: { id: string; starred?: boolean; note?: string | null }` — same result type.
- `getFundReport()` field additions ux-developer will consume:
  - `FundReportCategoryLine.starred: boolean` / `.note: string | null` (category grain; `false`/`null` when no budget row exists for that category/flow — same convention as `budgetCents === null`).
  - `FundReportCategoryLine.causeLines[].starred: boolean` / `.note: string | null` (cause-line grain, added alongside the existing `id`/`cause`/`label`/`amountCents`/`pendingDeleteAt` fields).
  - Both fields are **admin-only** — confirmed in code (see Open Questions) never to reach `getPhilanthropy()` or the member-facing `MonthlyStatementCategoryLine` shape in `financial-report-queries.ts`.

**Routes** — both gated identically: `auth()` → 401 if no session; `hasFeature(session.user.id, FEATURES.LEDGER_MANAGE)` → 403 if missing; then shape validation → 400; then the query function's 400/404. Never a 409.
- `PATCH /api/admin/ledger/budgets/annotations`
  - Body: `{ fundId: string; fiscalYear: number; categoryId: string; flow: 'income' | 'expense'; starred?: boolean; note?: string | null }` (at least one of `starred`/`note` required)
  - Response 200: `{ starred: boolean; note: string | null }`
  - Errors: 400 (bad shape / neither field / note > 500 chars after trim), 404 (fund or category not found)
- `PATCH /api/admin/ledger/budgets/cause-lines/annotations`
  - Body: `{ id: string; starred?: boolean; note?: string | null }` (at least one required)
  - Response 200: `{ starred: boolean; note: string | null }`
  - Errors: 400 (bad shape / neither field / note > 500 chars), 404 (no cause line for this id)

**Schema:** no changes this phase — database-admin's migration `0068_ledger_budget_star_notes.sql` already covers both new columns on both tables.

**Tests added:**
- `src/lib/ledger.test.ts` — `describe("normalizeBudgetNote")`: trim behavior, all-whitespace → `""`, null/undefined → `""`, no case-folding, no throw on over-length input (length enforcement is the caller's job), `MAX_BUDGET_NOTE_LENGTH === 500`.
- `src/lib/ledger-queries.test.ts`:
  - `describe("setBudgetCategoryAnnotation")` — lazy-create insert shape (`annualAmountCents: 0`
    only in `.values()`); **the landmine, directly asserted against the captured
    `onConflictDoUpdate` `set` object**: a star-only call's `conflictSet` has `starred` but
    **not** `annualAmountCents` and **not** `note`; a note-only call's `conflictSet` has `note`
    but not `starred`; empty/whitespace note → `null` in both `.values()` and `conflictSet`;
    501-char note → 400 with zero insert attempted; exactly-500-char boundary passes; neither
    field provided → 400; unknown `fundId`/`categoryId` → 404; a grep-based regression test
    confirming the function's body contains no reference to `assertBudgetUnlocked`.
  - `describe("setBudgetCauseLineAnnotation")` — happy path (both fields); star-only leaves
    `note` absent from the `UPDATE SET`; note-only leaves `starred` absent; empty/whitespace note
    → `null`; 501-char note → 400, zero update attempted; neither field → 400; unknown `id` →
    404; same grep-based `assertBudgetUnlocked` absence guard.
  - `describe("getFundReport — Budget Star & Notes (DECISION-057)")` — a starred/noted category
    row surfaces both fields; a starred/noted cause line surfaces both in `causeLines[]`; an
    un-budgeted category reports `starred: false, note: null` (not `undefined`).
  - `describe("Admin-only boundary — starred/note never leak into member-facing paths")` — two
    grep-based guards (see Open Questions for why this is grep-based rather than "no import").
  - Extended `makeMockTx`'s `InsertCall` type and `onConflictDoUpdate` mock to capture the `set`
    object passed at the call site (previously discarded) — a reusable harness improvement, not
    scoped only to this feature's tests.
- Full suite: `pnpm test` → **741/741 passing** (25 test files). `pnpm exec tsc --noEmit` clean.
  `pnpm build:only` succeeds; both routes confirmed in the build's route manifest.

### Open questions / handoff notes

- **Next agent: ux-developer.** The API surface above is stable and ready to build against —
  `showAnnotationControls` prop, star/note controls in `budget-editor.tsx`/
  `budget-cause-editor.tsx`, the sort-to-top logic in `guided-budget-setup.tsx`, and the print
  worksheet's star glyph/note row, per the Phase 3 Component Plan.
- **Correction to the Phase 1/2/3 admin-only-boundary claim (not a design flaw, just an
  inaccurate "no import" phrasing that should be fixed going forward):** all three prior phases
  stated `financial-report-queries.ts` "queries `ledgerTransactions` only — no import of
  `ledgerBudgets`/`ledgerBudgetLines` anywhere in that file" and treated that as proof of the
  boundary. That's not accurate — `financial-report-queries.ts` **does** `import { getFundReport,
  type FundReportCategoryLine } from "@/lib/ledger-queries"` and uses both directly (it needs
  `actualCents`/`budgetCents` for the Monthly Financial Statement's Twelve-Month/Budget columns).
  The actual boundary that holds — verified in code, now backed by a grep-based regression test
  (`describe("Admin-only boundary...")` above) — is narrower but still sound: `buildLines()` in
  that file maps each `FundReportCategoryLine` to an explicit `MonthlyStatementCategoryLine`
  allowlist (`categoryId`, `categoryName`, `oneMonthCents`, `twelveMonthCents`,
  `annualBudgetCents`, `hasUncashedCheck`) with **no spread operator anywhere** — so `starred`/
  `note` have no path to reach the member-facing output today, but the boundary lives in "no
  spread in `buildLines()`," not in "no import of the budgets tables." Worth a one-line fix to
  Phase 1 Decision 9's phrasing on a future documentation pass; not re-opening the pipeline for
  it since the actual invariant holds and is now test-covered.
- `getPhilanthropy()` was independently re-confirmed clean: its own function body has zero
  reference to `ledgerBudgets`/`ledgerBudgetLines` (it queries `ledgerTransactions` joined to
  `ledgerFunds`/`ledgerCategories` only), now backed by the same grep-based regression test.
- Both new routes and both new query functions carry the loud "INTENTIONAL: never calls
  assertBudgetUnlocked... see DECISION-057" comment at both the route-file header and the
  function-doc-comment level, per the design's requirement that a future "audit every write path
  for a missing lock check" pass can find the justification at the call site.
- `pnpm lint` currently fails on this branch with an unrelated ESLint/`minimatch` ESM-interop
  error (`SyntaxError: The requested module 'minimatch' does not provide an export named
  'default'`) — pre-existing, not caused by any file touched in this phase (confirmed: the error
  fires during ESLint's own config-loading step, before any file is linted). Flagging for
  deployment-engineer's dependency review rather than fixing here, since it's out of this
  feature's lane.

---

## Phase 4 — Implementation (UI) — 2026-07-29

**Owner:** ux-developer
**Status:** complete

### Summary

Built the client UI per the Phase 3 design and DECISION-057: star/note controls on category
rows (`budget-editor.tsx`, all three render branches) and cause-line rows
(`budget-cause-editor.tsx`, both live and dead branches), instant client-side sort-to-top
(`guided-budget-setup.tsx`), and the star glyph + note line on the printable worksheet
(`budget-print-worksheet.tsx`) at both grains. `pnpm exec tsc --noEmit` is clean, `pnpm test`
is 741/741 green (no new tests needed — this phase is UI-only, consuming the already-tested API
surface), and `pnpm build:only` succeeds with no new warnings.

### What I did

- Read the Phase 3 design doc, DECISION-057, and the schema/API handoff notes in full before
  touching any component.
- **`src/components/admin/ledger/budget-editor.tsx`:**
  - `BudgetLine` gains optional `starred?: boolean; note?: string | null;` (optional so
    `[fundSlug]/report/page.tsx`, which doesn't thread these through, keeps compiling
    unchanged).
  - New props `showAnnotationControls?: boolean` (default `false`) and
    `onStarChange?: (key: string, starred: boolean) => void`.
  - Added `StarIcon`/`NoteIcon` (local, mirrors the file's existing `TrashIcon` convention —
    no new shared icon file).
  - Local state: `starOverride` (optimistic star shadow, mirrors `breakdownOverride`'s
    idiom), `noteEditKey`/`noteDraft`/`noteSaving` (one note editor open at a time, mirrors
    `addCauseKey`'s single-open convention).
  - `toggleStar()` — flips `starOverride` and calls `onStarChange` **before** the fetch
    (true optimistic, not after-success like `setPendingDelete`'s existing pattern), PATCHes
    `/api/admin/ledger/budgets/annotations`, reverts both on failure with a toast. Never
    checks `disabled` — the whole point of Decision 6 is these controls stay live when the
    budget is locked.
  - `saveNote()` — Save-button-only (no autosave on blur, per the design's explicit
    reasoning: avoids reintroducing the exact blur-vs-click race class B-29 fixed), keeps the
    editor open with the typed text intact on failure, closes + `router.refresh()`s on
    success. Client-side 500-char guard mirrors `MAX_BUDGET_NOTE_LENGTH` (imported from
    `src/lib/ledger.ts`, not hardcoded).
  - `renderAnnotationControls`/`renderNoteEditor` wired into **all three** render branches
    (pending-delete, in-breakdown, lump-sum) — confirmed by grep that a soft-deleted or
    in-breakdown category still gets working star/note controls, not just the plain
    lump-sum row.
  - `showAnnotationControls` bubbled straight through to the nested `<BudgetCauseEditor>` in
    the in-breakdown branch, so cause-line controls share the same opt-in (see below).
- **`src/components/admin/ledger/budget-cause-editor.tsx`:**
  - `BudgetCauseLine` gains optional `starred?/note?`; `Row` gains non-optional
    `starred: boolean; note: string | null` (local state always has a value), seeded
    `false`/`null` for a never-saved pre-fill row and via `addRowForCause`.
  - New prop `showAnnotationControls?: boolean` (default `false`) — this is what keeps
    `[fundSlug]/report/page.tsx`'s `BudgetEditor` (which never passes it) from suddenly
    showing cause-line star/note controls for a category that happens to already be in
    breakdown mode.
  - `toggleLineStar()`/`saveLineNote()` — same optimistic-star / Save-button-only-note
    pattern as the category grain, PATCHing `/api/admin/ledger/budgets/cause-lines/annotations`
    by `id`. Both are no-ops when `row.id === null` (a never-saved row has nothing to
    address server-side yet — matches the design's named edge case; controls are hidden
    entirely for such a row via `renderLineAnnotationControls`'s own `row.id === null` guard).
  - Within-group sort: `indices` (previously read straight off `rowsByCause.get(cause)`) is
    now a copy, stably sorted starred-first, computed fresh on every render straight from
    `rows[i].starred` — no separate override map needed at this grain because, unlike
    `BudgetEditor`, this component's `rows` is local state that BudgetCauseEditor itself owns
    and mutates directly (confirmed via its own doc comment: `rows` never re-syncs from props
    mid-session), so a star click's `setRows` update is already the source of truth the very
    next render — genuinely instant, no shadow state required.
  - Controls rendered in **both** the live and the dead (`isRowDead`) branches — a
    row that's individually pending-delete or mid-hold still shows and allows editing its
    own star/note (Decision 7, reaffirmed).
- **`src/components/admin/ledger/guided-budget-setup.tsx`:**
  - `FundSetupItem.budgetEditorLines[]` gains non-optional `starred: boolean; note: string |
    null` (this is the page's own server-sourced shape, always present once threaded).
  - New `seedStarOverrides()` companion to `seedLineValues`/`seedPendingDeleteKeys`/
    `seedCauseLinePendingCents` — same re-sync contract (reset in the same `useEffect` keyed
    on `funds`).
  - New lifted state `starOverrides` + `handleStarChange()`, fired by `BudgetEditor`'s
    `onStarChange` the instant a star toggle resolves optimistically (and again with the
    previous value on failure) — this is what makes `renderFlowSection`'s sort-to-top react
    before the round trip completes, not just after the next `router.refresh()`.
  - `renderFlowSection`'s `sectionLines` now sorted stably (starred rows first, existing
    order preserved otherwise) reading from `starOverrides`, not the raw `line.starred` prop
    — this is the mechanism that makes the reorder instant rather than waiting on a server
    round trip.
  - `<BudgetEditor>` now receives `showAnnotationControls={canManage}` (independent of
    `locked`, per Decision 6 — NOT the same gate as `showRemoveControl={canManage && !locked}`)
    and `onStarChange`.
- **`src/app/(dashboard)/admin/ledger/budgeting/page.tsx`:** `enrichCauseLines`'s parameter
  type widened with `starred: boolean; note: string | null;` so the `...cl` spread actually
  surfaces them (a narrower un-widened type would have silently stripped these at the type
  level even though the runtime data already carried them from `getFundReport`); both
  `budgetEditorLines` push sites (income/expense) gain `starred: l.starred, note: l.note,`.
- **`src/components/admin/ledger/budget-print-worksheet.tsx`:** `PrintCauseLine` gains
  optional `starred?/note?`; `PrintLine` gains non-optional `starred: boolean; note: string |
  null`. Category row prints a `★ ` prefix on the name when starred, plus a compact italic
  `Note: …` row directly underneath when non-empty (omitted entirely when there's no note, so
  a fund with zero notes prints identically to before this feature). Cause lines get the same
  treatment — `★ ` prefix on the label, conditional `Note: …` row — which required changing
  the cause-line map from a single `<tr>` to a `<Fragment>` wrapping the line's row plus its
  optional note row. Pending-delete exclusion (category and cause-line grain) is unchanged —
  a row that's already excluded from the printout never reaches the star/note rendering path.
- Ran `pnpm exec tsc --noEmit` (clean), `pnpm test` (741/741, unchanged — no new tests needed
  for this UI-only phase), and `pnpm build:only` (succeeds, no new warnings). Confirmed via
  grep: zero `console.log` in any touched file, zero `window.confirm/alert/prompt`, every new
  button carries `onMouseDown={preventMouseDownDefault}`, every new interactive control has
  `min-h-[44px]` (and `min-w-[44px]` for icon-only buttons).
- Did **not** touch `schema.ts`, `ledger.ts`, `ledger-queries.ts`, either annotations route, or
  any test file — those are api-developer's/database-admin's completed lanes.

### Outputs

- `src/components/admin/ledger/budget-editor.tsx` — `showAnnotationControls`/`onStarChange`
  props; `StarIcon`/`NoteIcon`; `starOverride`/`noteEditKey`/`noteDraft`/`noteSaving` state;
  `toggleStar`/`openNoteEditor`/`closeNoteEditor`/`saveNote`/`renderAnnotationControls`/
  `renderNoteEditor`; wired into all three render branches; `showAnnotationControls` bubbled
  to the nested `BudgetCauseEditor`.
- `src/components/admin/ledger/budget-cause-editor.tsx` — `showAnnotationControls` prop;
  `StarIcon`/`NoteIcon`; `Row.starred`/`.note`; `noteEditRowId`/`noteDraft`/`noteSaving` state;
  `toggleLineStar`/`openLineNoteEditor`/`closeLineNoteEditor`/`saveLineNote`/
  `renderLineAnnotationControls`/`renderLineNoteEditor`; within-group stable star-sort on
  `indices`; controls rendered in both live and dead row branches.
- `src/components/admin/ledger/guided-budget-setup.tsx` — `FundSetupItem.budgetEditorLines[]`
  widened; `seedStarOverrides`; lifted `starOverrides` state + `handleStarChange`;
  `renderFlowSection`'s stable starred-first sort; `showAnnotationControls={canManage}` +
  `onStarChange` passed to `BudgetEditor`.
- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` — `enrichCauseLines`'s parameter type
  widened; `starred`/`note` added to both `budgetEditorLines` push sites.
- `src/components/admin/ledger/budget-print-worksheet.tsx` — `PrintCauseLine`/`PrintLine`
  widened; star glyph + conditional note row at both grains (cause-line rendering changed
  from a bare `<tr>` to a `<Fragment>` to accommodate the optional second row).

### Open questions / handoff notes

- **Next agent: qa.** Everything above is ready for Phase 5 verification.
- **New copy strings the Lions Club may want to refine** (all plain, low-stakes microcopy,
  none member-facing):
  - Star button titles: "Flag for discussion" / "Unflag for discussion".
  - Note button titles: "Add note for discussion" / "Edit note".
  - Note textarea placeholder: "Working note for discussion (not shown to members)…" — this
    phrasing was chosen deliberately to reassure the treasurer at the point of typing that
    this is an internal working note, not something that leaks to the member-facing
    financial reports or philanthropy dashboard.
  - Failure toast: "Couldn't save — try again." (reused verbatim from Phase 1 Flow 1's named
    copy).
- **What a reviewer should click through in the browser:**
  1. On `/admin/ledger/budgeting`, star a category row with a real budgeted amount (e.g.
     $500) — confirm the amount is unchanged after the star toggle and the row instantly
     jumps to the top of its Income/Expense section, before any visible page reload.
  2. Star a category row that has **no** budget entered yet (an "un-budgeted" row rendered
     with `budgetCents: null`) — confirm it can be starred/noted without first entering an
     amount (the lazy-create path), and that doing so does not silently create a visible
     $0.00 in the amount input (it should still show blank/placeholder — verify this reads
     right to a treasurer, not as "oh, it silently budgeted $0").
  3. Add a note, then reload the page (or `router.refresh()` via any other action) — confirm
     the note persists and the note icon renders filled.
  4. Try to type more than 500 characters into a note — confirm the counter turns red and
     Save is disabled at the boundary; confirm the boundary itself (exactly 500) saves fine
     (already unit-tested server-side; this is just the client-side mirror).
  5. Lock the FY budget (Approve & lock), then confirm the star and note controls **remain
     enabled** even though the amount inputs are grayed out — this is the single
     highest-value manual check per Decision 6.
  6. Star/note a cause line inside a category's breakdown — confirm it sorts to the top of
     its own cause group (not the whole category), and that a cause line marked
     individually pending-delete (or mid-Undo-hold) still shows working star/note controls.
  7. Add a brand-new, never-yet-saved cause line ("+ add line item") — confirm it has **no**
     star/note controls until after its first blur/Enter commit (by design — nothing to
     PATCH against yet).
  8. Print the worksheet (or Ctrl/Cmd+P preview) with at least one starred category, one
     starred cause line, and one of each with a note — confirm the ★ glyph and the "Note: …"
     line render correctly and that a fund with zero stars/notes prints identically to
     before this feature (no stray blank note rows).
  9. Confirm `[fundSlug]/report/page.tsx` (a different `BudgetEditor` caller that doesn't
     pass `showAnnotationControls`) shows **no** star/note UI at all, even for a category
     already in breakdown mode — this is the scoping boundary the design was explicit about.
- **UX decisions/tradeoffs made, for the record:**
  - Chose a bubble-up-to-parent pattern for the category-grain sort (BudgetEditor's local
    `starOverride` for the icon fill + `onStarChange` lifting a parallel `starOverrides` map
    into `GuidedBudgetSetup` purely to drive sort order) rather than lifting the entire star
    state out of `BudgetEditor`. This mirrors the codebase's existing dual-state convention
    (`pendingDeleteKeys`/`onPendingDeleteChange`, `causeLinePendingCents`/
    `onCauseLinePendingDeltaChange`) rather than inventing a new one, and avoids `BudgetEditor`
    needing to read sort-relevant state back out of its own parent.
  - At the cause-line grain, no shadow/override state was needed at all — `BudgetCauseEditor`
    already owns `rows` as local, non-re-syncing state (confirmed via that component's own
    doc comment), so a star click's `setRows` is already the instant, single source of truth
    for both the icon and the sort.
  - Deliberately did not add a `noteOverride` shadow — the note icon's filled/outline state
    reads straight from the `line.note`/`row.note` prop, refreshed via the same
    `router.refresh()` every other write in these files already triggers. Unlike the star
    (which needs instant reorder), a note's badge state has no analogous "must be instant"
    requirement per Phase 1 Flow 2, so this keeps the diff smaller without visibly
    regressing anything.
  - Print worksheet's cause-line note row uses `colSpan={4}` (matching the category-grain
    note row) rather than aligning under the label's `colSpan={3}` — this keeps both note
    rows visually consistent as a full-width italic line, which reads better on paper than a
    right-aligned partial-width note.

---

# Phase 5 — Verification (qa)

**Date:** 2026-07-29
**Verified by:** qa
**Status:** complete

## Summary

**Verdict: FAIL.** Every automated gate is green (typecheck, 741/741 Vitest — including the
architect's named landmine test asserted directly against the captured `onConflictDoUpdate` SET
clause — production build with both new routes in the manifest, both routes correctly gated with
`auth()` + `hasFeature(..., FEATURES.LEDGER_MANAGE)`), and 5 of 6 new Playwright e2e tests pass,
covering the landmine at the UI level, cause-line sort-to-top, the never-saved-row-has-no-controls
rule, the soft-deleted-row-still-has-controls rule, the lock-interaction exception, the print
worksheet, and the member-facing boundary. But the 6th e2e test caught a real, reproducible
defect that directly contradicts an explicit requirement from both Phase 1 (Flow 4's failure mode)
and the ux-developer's own Phase 4 manual-click-through item 2: **starring an un-budgeted category
lazy-creates the `ledger_budgets` row correctly and shows no fake amount immediately — but on the
very next page reload, the amount input shows a fabricated "0.00"**, exactly the "oh, it silently
budgeted $0" confusion the design set out to avoid. Root cause: `getFundReport`'s
`budgetMap.get(key) ?? null` only falls back to `null` when the row is *absent*; once the
lazy-create insert lands with `annualAmountCents: 0`, the row exists and `budgetCents` comes back
as the real number `0`, not `null`. `budget-editor.tsx`'s input-seeding logic
(`line.budgetCents !== null ? (line.budgetCents / 100).toFixed(2) : ""`) treats any non-null value
— including a lazily-created `0` — as "0.00". This is a genuine implementation gap, not a
nitpick: a treasurer who stars an un-budgeted category, then reloads the page (which happens
constantly in normal use), sees a number they never entered.

## What I did

- Read the full work-log (Phases 1–4) and DECISION-057 before touching anything.
- Ran the automated gates:
  - `pnpm exec tsc --noEmit` — clean, no output.
  - `pnpm test` — **741/741 passing**, 25 test files. Confirmed the api-developer's named
    landmine test is present and real (not just inferred): `setBudgetCategoryAnnotation` tests in
    `src/lib/ledger-queries.test.ts:1422` (`"THE LANDMINE: a star-only toggle on an
    already-$5,000-budgeted, already-noted category never includes annualAmountCents or note in
    the conflict SET clause..."`) assert directly against the captured `onConflictDoUpdate` `set`
    object (`expect(conflictSet).not.toHaveProperty("annualAmountCents")` /
    `.not.toHaveProperty("note")`), not just against the mocked return value. Also confirmed
    present: the note-only counterpart, empty/whitespace-note normalization, the 500-char
    boundary, 404s, and a grep-based regression guard proving neither
    `setBudgetCategoryAnnotation` nor `setBudgetCauseLineAnnotation`'s body references
    `assertBudgetUnlocked` at all. Confirmed the admin-only-boundary regression tests
    (`ledger-queries.test.ts:1773`) are real: one greps `getPhilanthropy()`'s own function body
    for `ledgerBudgets`/`ledgerBudgetLines` references, the other greps
    `financial-report-queries.ts` for `starred`/`note` references — both pass, both actually read
    the source file rather than asserting against a mock.
  - `pnpm build:only` — succeeds. Confirmed both new routes in the manifest:
    `ƒ /api/admin/ledger/budgets/annotations` and
    `ƒ /api/admin/ledger/budgets/cause-lines/annotations`.
  - `pnpm lint` — fails with `SyntaxError: The requested module 'minimatch' does not provide an
    export named 'default'`, firing during ESLint's own config-loading step before any file is
    linted. Confirmed pre-existing and unrelated to this feature (same failure the api-developer
    already flagged in their Phase 4 handoff for deployment-engineer's dependency review) — not
    treated as this feature's FAIL.
- Read both new route files (`src/app/api/admin/ledger/budgets/annotations/route.ts`,
  `src/app/api/admin/ledger/budgets/cause-lines/annotations/route.ts`) directly, not inferred
  from passing tests. Both call `auth()` → 401, then
  `hasFeature(session.user.id, FEATURES.LEDGER_MANAGE)` → 403, before any shape validation or
  query-function call — same gate as every sibling budget route. Both carry the loud
  "INTENTIONAL: this route never calls assertBudgetUnlocked()... See DECISION-057" header comment
  named in the Phase 3 design.
- Wrote a new Playwright spec, `e2e/budget-star-notes.spec.ts` (532 lines, 6 tests), against the
  Club entity at the dedicated FY2099 fixture year (same isolation pattern as
  `budgeting-restructure.spec.ts`), using the Activity Fund for every starred/noted fixture and
  leaving the Administrative Fund (same entity/FY) completely untouched as the "zero
  stars/notes" control for the print-worksheet check. Ran it against a locally started `pnpm dev`
  server with `.env.local`'s seeded e2e admin credentials (which carry both `ledger.manage` and
  `ledger.approve`, needed to exercise the lock/unlock flow).
  - Hit and fixed two authoring bugs of my own along the way (documented in the spec's own
    comments so a future maintainer doesn't reintroduce them): (1) the Club entity's page renders
    **two** funds at once (unlike `budgeting-restructure.spec.ts`'s single-fund Foundation page),
    and several category names (e.g. "Program supplies") exist in both funds' catalogs — every
    locator had to be scoped to its fund's own card via a new `fundCard()` helper, using a
    dot-relative `.//` xpath rather than a bare `//` (which silently re-searches the whole
    document and ignores the intended scope). (2) My first choice of cause-line fixture category,
    "Program supplies", turns out to have `countsAsGiving: false` in the Activity Fund's own
    catalog — `isCauseEligibleCategory()` requires `flow === 'expense' && countsAsGiving === true`,
    so that category has no "+ Add cause" control **at all**, by design (not a bug) — switched the
    fixture to "Service projects" (`countsAsGiving: true`).
  - Found the reload bug described above via this suite's first test. Confirmed it's real (not a
    locator/flakiness artifact) by directly querying the DB (`ledger_budgets` row for "Vision
    screening" at FY2099 shows `annual_amount_cents: 0, starred: true` — a real row) and by
    reading `getFundReport`'s `budgetMap.get(key) ?? null` and `budget-editor.tsx`'s
    `budgetCents !== null ? ... : ""` seeding logic directly, tracing the exact mechanism.
  - Ran the full 6-test suite twice: once with the failing assertion temporarily disabled (to
    confirm every OTHER mechanism in the suite — sort-to-top at both grains, the
    never-saved-row-has-no-controls rule, the soft-deleted-row-still-has-controls rule, the
    lock/unlock flow, the print worksheet, the member-facing boundary — genuinely works, not
    masked by the one known bug), then with the assertion restored, confirming it fails exactly
    once, exactly where expected (regression-test discipline: failing before the fix is written,
    per this agent's own working principles).
  - Also reran the pre-existing `e2e/budgeting-restructure.spec.ts` (13 tests) afterward to
    confirm my suite's use of the same FY2099/Club-adjacent fixture space didn't disturb it — all
    13 still pass.
  - Cleaned up: deleted every `ledger_budgets` row this suite created for the Club entity at
    FY2099 (cascades to `ledger_budget_lines`), and deleted the `ledger_budget_approvals` row this
    suite's lock/unlock test created for (Club, FY2099) — confirmed via direct query that the
    Club entity's FY2099 is back to zero rows in both tables. Left
    `budgeting-restructure.spec.ts`'s own Foundation-entity FY2099 fixture untouched, per that
    file's own documented convention.
- Ran `pnpm exec vitest run --coverage` scoped to the modules this feature (and the project's
  standing critical-module list) touch.

## Outputs

### Type Check
`pnpm exec tsc --noEmit`: **PASS**

### Unit Tests
`pnpm test`: **PASS**
Total: 741 | Passed: 741 | Failed: 0
Duration: ~0.85s (25 test files)
Failures: none. Landmine test confirmed present and asserting against real captured state:
`src/lib/ledger-queries.test.ts:1422`.

### Production Build
`pnpm build:only`: **PASS**
Notes: both new routes present in the manifest (`/api/admin/ledger/budgets/annotations`,
`/api/admin/ledger/budgets/cause-lines/annotations`); no new warnings.

`pnpm lint`: **FAIL, pre-existing, unrelated** — `minimatch` ESM-interop `SyntaxError` fires during
ESLint's own config load, before any file is linted. Flagged (again) for deployment-engineer's
dependency review, not counted against this feature.

### End-to-End Tests
`pnpm test:e2e -- e2e/budget-star-notes.spec.ts`: **FAIL**
Total: 6 | Passed: 5 | Failed: 1
Duration: ~42s
Failures:
- `e2e/budget-star-notes.spec.ts:117` — "starring an un-budgeted category lazy-creates the row
  without showing a fake amount, and sorts it to the top of its section instantly" — fails at the
  post-reload assertion (`e2e/budget-star-notes.spec.ts:170-172`): expected the amount input's
  value to be `""`, received `"0.00"`. Everything before the reload (lazy-create succeeds,
  amount stays blank immediately, instant sort-to-top) passes.

`e2e/budgeting-restructure.spec.ts` (pre-existing, re-run for regression confidence): **PASS**,
13/13, unaffected by this suite's use of the same fiscal year on a different entity/fund.

### Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| Star an already-$500-budgeted, already-noted category; toggle star/note independently | pass | `e2e/budget-star-notes.spec.ts:175` — amount and note both survive every star/note toggle, in both directions, across a reload. THE landmine, exercised end-to-end. |
| Star/note an un-budgeted category (lazy-create) | **fail** | Blank amount holds immediately after starring, but a page reload shows a fabricated "0.00" — see Summary. |
| FY budget Approve-&-locked: annotation controls stay enabled, amount inputs disabled | pass | `e2e/budget-star-notes.spec.ts:408` — star toggled off and back on twice while locked, both PATCHes returned 200 (never 409); note editor also stayed usable. Unlocked cleanly afterward. |
| Cause-line grain: sort-to-top within its own cause group | pass | `e2e/budget-star-notes.spec.ts:265` — starring "Line B" (not "Line A") moved it above "Line A" instantly, scoped correctly to the Environment cause group, not the whole category. |
| Never-saved cause line has no annotation controls until first commit | pass | Exactly 2 star buttons present with a 3rd blank row on screen; jumps to 3 immediately after that row's first commit. |
| Soft-deleted/held cause line retains working star/note controls | pass | Line C's star button remained visible and functional (200 response) while in the dead/hold state; Undo restored it cleanly before the lock test. |
| Print worksheet: star + note at both grains; zero-annotation fund has no stray rows | pass | `e2e/budget-star-notes.spec.ts:484` — Activity Fund's worksheet section shows `★ Event costs` / `Note: ...` / `★ E2E QA Line B` / cause-line note; Administrative Fund's section (deliberately left untouched) contains neither `★` nor `Note:` anywhere. |
| Star/note never appear on `/members/financial-reports` or `/members/impact` | pass | `e2e/budget-star-notes.spec.ts:515` — page body checked for `★` and both fixture note strings; the api-developer's grep-based Vitest regression (`ledger-queries.test.ts:1773`) independently confirmed real and passing (reads the actual source of `financial-report-queries.ts` and `getPhilanthropy()`'s function body, not a mock). |

### Regression Tests Added
- `e2e/budget-star-notes.spec.ts:117` (the reload assertion at lines 170–172) — guards against:
  a lazy-created un-budgeted category's amount input showing a fabricated "0.00" after a page
  reload, instead of staying blank as Phase 1 Flow 4 and the ux-developer's own Phase 4
  manual-check both require. Written and confirmed failing against the current code (root cause
  traced to `getFundReport`'s `budgetMap.get(key) ?? null` plus `budget-editor.tsx`'s
  `budgetCents !== null` display discriminator, both of which treat a lazily-created `0` exactly
  like a deliberately-entered `0`) — will pass once fixed.
- `e2e/budget-star-notes.spec.ts:175` — "THE LANDMINE (exercised through the UI)" — guards
  against a star-only or note-only PATCH zeroing an existing budgeted amount or blanking an
  existing note, at the UI/integration level (the Vitest suite already guards the same landmine
  at the query-function level; this is the end-to-end companion).

### Coverage on Critical Modules
- `src/lib/events.ts`: 94.73% stmts / 85.54% branch (unchanged by this feature; standing project
  coverage, meets the 90%+ target).
- `src/lib/permissions.ts`: not touched by this feature; no new gap introduced.
- `src/lib/members.ts`: 30.55% stmts (unchanged by this feature; pre-existing gap, outside this
  feature's scope — flagged for the next 7-day coverage sweep, not a Phase 5 blocker here).
- `src/lib/ledger.ts` (touched by this feature — `MAX_BUDGET_NOTE_LENGTH`, `normalizeBudgetNote`):
  **100% stmts / 95.76% branch** for the whole file.
- `src/lib/ledger-queries.ts` (touched by this feature): whole-file coverage is 40.86% stmts, but
  this file is the entire Ledger query layer (4,600+ lines spanning many prior features) — the
  low blanket number is not specific to this feature. The star/note-specific surface
  (`setBudgetCategoryAnnotation`, `setBudgetCauseLineAnnotation`, `getFundReport`'s
  `starred`/`note` widening, the admin-only-boundary grep guards) is thoroughly covered, per the
  specific test names confirmed above.

### Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `PATCH /api/admin/ledger/budgets/annotations` | yes | yes | `FEATURES.LEDGER_MANAGE` — correct: this is the same permission every other budget-amount write path in this module already requires; no new key needed since Decision 6 only changes the *lock* behavior, not who may write. |
| `PATCH /api/admin/ledger/budgets/cause-lines/annotations` | yes | yes | `FEATURES.LEDGER_MANAGE` — same reasoning. |

Both verified by reading the route files directly (see "What I did" above), not inferred from
passing tests. No other protected routes or server actions were added or changed by this feature.

## Open questions / handoff notes

- **Next agent: the implementer (Phase 4 loop-back), specifically ux-developer, with tech-lead
  weighing in briefly first.** This is a FAIL. The failing flow is cited above with exact
  file:line references and the traced root cause.
- **This reads as an implementation gap, not a fresh design-phase problem** — the fix is
  achievable entirely at the display/seeding layer, without touching the schema or the "no flag
  distinguishing lazy-created-$0 from deliberately-budgeted-$0" data-model choice DECISION-057
  already settled. But there is one small product judgment call worth a one-line ruling from
  tech-lead before ux-developer patches it, because the natural fix — treat `budgetCents === 0`
  the same as `budgetCents === null` for *display* purposes (blank input, not "0.00") — is not
  scoped only to the new lazy-create path. `budgetCents !== null` is the *pre-existing*
  discriminator in `budget-editor.tsx` (predates this feature entirely), so today a category a
  treasurer deliberately entered "$0.00" for *also* shows "0.00", not blank. Widening the
  blank-display rule to cover `0` as well as `null` would make a genuinely-entered $0 line look
  identical to an un-budgeted one on every reload — which is arguably fine (a $0 budget and no
  budget are functionally the same line item either way, and this is exactly the equivalence the
  Phase 1 analyst assumed already held when writing "a $0 row... already renders identically to
  today's un-budgeted display" — an assumption that turned out to be false against the actual
  code, which is what let this ship). Recommend: tech-lead confirms "yes, treat 0 and null
  identically for blank-vs-populated display, everywhere this pattern appears" in one line, then
  ux-developer applies it in the one or two places it's needed:
  - `src/components/admin/ledger/budget-editor.tsx` — the `inputs` state initializer
    (`line.budgetCents !== null ? (line.budgetCents / 100).toFixed(2) : ""`) and the equivalent
    branch in `exitBreakdown()`.
  - Worth a quick check (not yet confirmed a bug, just unverified) whether
    `budget-cause-editor.tsx`'s own line-value seeding has the same `!== null` discriminator for a
    cause line's own amount — cause lines don't get lazy-created (per the architect's Phase 2
    point 3), so this may be moot there, but confirm rather than assume.
  - `src/components/admin/ledger/budget-print-worksheet.tsx`'s "New Budget" column
    (`formatBudgetReferenceCents(line.budgetCents)`) has the same `cents === null ? "—" : ...`
    shape and will print "$0.00" instead of "—" for a lazy-created, unstarred-amount row today —
    lower stakes than the interactive input (a printed worksheet is a working document, and a
    starred row showing "$0.00" reads less like "silently budgeted" than an *editable input*
    showing the same), but should get the same fix for consistency if tech-lead's ruling extends
    there.
- **Everything else in this feature is solid and does not need to be re-verified from scratch**
  once the above is fixed — re-run `e2e/budget-star-notes.spec.ts` (all 6 tests; the fix should
  flip test 1 from fail to pass without touching the other 5) plus `pnpm test` and
  `pnpm build:only`, and Phase 5 can re-issue PASS without redoing the manual click-through list.
- **FY2099 fixture hygiene:** the Club entity's FY2099 (`ledger_budgets`, `ledger_budget_lines`,
  `ledger_budget_approvals`) is confirmed clean (0 rows) as of this write-up. The next person to
  run `e2e/budget-star-notes.spec.ts` will recreate the same fixture rows and should re-run the
  same cleanup (`DELETE FROM ledger_budgets WHERE fiscal_year = 2099` scoped to the Club entity's
  funds, plus the matching `ledger_budget_approvals` row) after confirming the fix — don't skip
  it, or the next run (or `budgeting-restructure.spec.ts`'s own Foundation-entity FY2099 fixture,
  which lives alongside it) could get confusing to debug.
- Once this is fixed and Phase 5 re-issues PASS, name **analyst** for Phase 6.

---

## Phase 4 — Implementation (fix, loop-back) — 2026-07-29

**Owner:** full-stack-developer
**Status:** complete

### Summary

Fixed the QA-confirmed defect (star/note-only annotation of an un-budgeted category displaying
a fabricated "0.00" after reload) at the `getFundReport` layer, per the explicit ruling handed
down for this loop-back (not qa's broader suggested fix of treating every `budgetCents === 0`
as `null`). Added a narrow, purely-scoped discriminator function,
`resolveDisplayBudgetCents()`, in `src/lib/ledger.ts`, and wired it into both places
`getFundReport()` computes `budgetCents` in `src/lib/ledger-queries.ts`. Every existing $0
semantic (a genuinely-entered $0 budget line, a deliberate $0 cause-line breakdown, the print
worksheet's normal $0 handling) is unchanged — verified by dedicated unit tests asserting each
case is left alone. The previously-failing e2e regression (`e2e/budget-star-notes.spec.ts:117`)
now passes; `budgeting-restructure.spec.ts` stays 13/13 (see note below on why it needed a
fixture reset first — unrelated to this fix).

### What I did

- Read the full work-log (Phases 1–5) and DECISION-057 before touching any code.
- Rejected qa's broader suggested fix (widen `budget-editor.tsx`'s blank-vs-populated
  discriminator to treat every `budgetCents === 0` as blank, everywhere) in favor of the ruling's
  narrower instruction: fix once at the `getFundReport` layer with a discriminator scoped
  exactly to the annotation-only lazy-create case, so a genuinely-entered $0 line and a $0 cause
  line are provably unaffected.
- Added `resolveDisplayBudgetCents(rawBudgetCents, hasCauseLines, starred, note): number | null`
  to `src/lib/ledger.ts` (sibling to `normalizeBudgetNote`/`MAX_BUDGET_NOTE_LENGTH`, same Budget
  Star & Notes section). Pure function, one branch: returns `null` only when
  `rawBudgetCents === 0 && !hasCauseLines && (starred || note !== null)`; otherwise returns
  `rawBudgetCents` unchanged. Doc comment names the discriminator exactly and states what must
  stay unchanged (genuine $0, $0-with-cause-lines), citing this loop-back and DECISION-057.
- Wired it into both `buildLines()` call sites inside `getFundReport()` in
  `src/lib/ledger-queries.ts` — the normal per-category loop (line ~760) and the defensive
  "budget row with no matching active category" loop (line ~780) — computing `causeLines`,
  `starred`, and `note` once per row, then deriving `budgetCents` via
  `resolveDisplayBudgetCents(rawBudgetCents, causeLines !== null, starred, note)` before it feeds
  both the result object and `budgetVariance()`. `variance` is now derived from the *display*
  `budgetCents`, so an annotation-only row's variance also reads as "—" (null/null) rather than
  `-actualCents` — consistent with treating the row as fully un-budgeted for every display
  purpose, per the ruling's "treat it as un-budgeted for display" language.
- Added a doc-comment note on `FundReportCategoryLine.budgetCents` explaining the two reasons it
  can be `null` (no row at all, or an annotation-only row) and pointing at
  `resolveDisplayBudgetCents`.
- Confirmed by tracing the call graph (not just by re-running tests) that this is a genuine
  single-point fix: `budget-editor.tsx`'s amount-input seeding (`budgetCents !== null ? ... :
  ""`), `guided-budget-setup.tsx`'s `seedLineValues()` (`line.budgetCents ?? 0`, which feeds
  `computeFundLineSums()` for the live Income/Expenses/Banked-used totals), and
  `budget-print-worksheet.tsx`'s `formatBudgetReferenceCents(line.budgetCents)` (the "New
  Budget" print column) all read `FundReportCategoryLine.budgetCents` directly — none of them
  needed a separate patch once `getFundReport` reports `null` for the annotation-only case.
  - Live-totals path specifically confirmed: `seedLineValues()`'s `line.budgetCents ?? 0` turns
    the new `null` back into `0` for the purposes of the running Income/Expenses total — exactly
    the correct contribution for a $0 annotation-only category (no behavior change to the
    totals, only to the interactive input's display and the print column).
  - `budget-editor.tsx`'s `hasExistingRow` (used by `resolveBudgetLineDeleteAction` for the
    trash-icon/blank-and-blur soft-delete gesture) is derived from `budgetCents !== null` too —
    confirmed this now correctly treats an annotation-only row as "nothing to remove yet" (trash
    icon on a blank input is already a no-op), and that typing a real amount into it routes
    through the ordinary amount-write path (`PATCH /budgets`), converting the lazy-created row
    into a real budgeted line — not a bug, the intended behavior.
- Added unit tests at both layers:
  - `src/lib/ledger.test.ts` — new `describe("resolveDisplayBudgetCents")`: the two annotation-
    only shapes (starred-only, note-only, both) return `null`; a genuine $0 (not starred, no
    note) is unchanged at `0`; a $0 category with real cause-line detail is unchanged at `0` even
    when starred/noted; a non-zero real budget is unchanged regardless of starred/note; a truly
    un-budgeted category (`null` in) stays `null`.
  - `src/lib/ledger-queries.test.ts` — five new cases appended to the existing
    `describe("getFundReport — Budget Star & Notes (DECISION-057)")` block, exercised through
    the full `getFundReport()` mock-DB harness (not just the pure function in isolation): the
    starred-only and note-only lazy-create shapes report `budgetCents: null`; a genuine
    deliberately-entered $0 is unchanged at `0`; a $0 category with cause-line detail is
    unchanged at `0` even when starred; a real non-zero budgeted amount is unchanged when
    starred/noted.
- Ran `pnpm exec tsc --noEmit` — clean.
- Ran `pnpm test` — **753/753 passing** (25 files; was 741 before this fix — 7 new pure-function
  tests + 5 new `getFundReport` tests).
- Started `pnpm dev`, ran `pnpm test:e2e -- e2e/budget-star-notes.spec.ts` — **6/6 passing**,
  including the previously-failing assertion at line 117 (amount input now stays blank after
  reload instead of showing "0.00").
- Re-ran `pnpm test:e2e -- e2e/budgeting-restructure.spec.ts` for the B-29 regression check —
  **initially failed at test 2/13** ("Flow 7 — each flow's section renders its own header +
  add-category control independently", expecting the Foundation entity's "Charitable donation
  out" category to still be in lump-sum mode). Root-caused this as **unrelated to this fix**:
  that suite is explicitly documented (its own file-header comment) as non-idempotent — serial,
  each test destructively mutates fixture state the next test depends on, and "there is no
  destructive cleanup path for this data... intentionally left in place, not a cleanup gap." The
  Foundation entity's FY2099 fixture had already been consumed by qa's own Phase 5 run earlier
  today (confirmed via direct DB query: 2 live + 1 soft-deleted cause line already existed under
  "Charitable donation out" before I touched anything), so a second run without a reset was
  guaranteed to fail regardless of any code change. Reset by deleting that entity's FY2099
  `ledger_budgets` (cascades to `ledger_budget_lines`) and `ledger_budget_approvals` rows
  directly via `psql`, then re-ran the suite clean: **13/13 passing** — confirms no regression
  from this fix. Per the suite's own documented convention, did **not** clean up the fresh
  fixture state it left behind after this second run (that's its established, intentional
  behavior, not something this fix should override).
- Cleaned up the Club-entity FY2099 fixture rows my own `e2e/budget-star-notes.spec.ts` run
  created (`ledger_budgets`, cascading to `ledger_budget_lines`, plus the
  `ledger_budget_approvals` row from the lock/unlock test) — confirmed via direct query back to
  0 rows for that entity at FY2099, per this task's explicit instruction and the standing
  convention documented in qa's Phase 5 write-up.
- Ran `pnpm build:only` — succeeds, exit 0, no new warnings or errors.

### Outputs

- `src/lib/ledger.ts` — new `resolveDisplayBudgetCents(rawBudgetCents, hasCauseLines, starred,
  note): number | null`, placed directly after `normalizeBudgetNote` in the existing "Budget
  Star & Notes (DECISION-057)" section. Pure, no DB access.
- `src/lib/ledger-queries.ts`:
  - Import of `resolveDisplayBudgetCents` added.
  - `FundReportCategoryLine.budgetCents`'s doc comment extended to explain the second reason it
    can be `null`.
  - `getFundReport()`'s two `buildLines()` call sites (the normal per-category loop and the
    "budget row with no matching active category" defensive loop) now derive `budgetCents` via
    `resolveDisplayBudgetCents(...)` instead of using the raw `annualAmountCents` value directly;
    `variance` is computed from the resulting display value.
- `src/lib/ledger.test.ts` — new `describe("resolveDisplayBudgetCents")`, 7 tests.
- `src/lib/ledger-queries.test.ts` — 5 new tests appended to the existing
  `describe("getFundReport — Budget Star & Notes (DECISION-057)")` block.
- No schema change, no migration, no route change, no component change — the fix is entirely
  contained to the query layer, per the ruling's "single-point fix" instruction. `budget-
  editor.tsx`, `guided-budget-setup.tsx`, and `budget-print-worksheet.tsx` are unmodified; they
  now display correctly purely because `getFundReport` feeds them a corrected value.
- No new `FEATURES` key, no env var.

### Test results

- `pnpm exec tsc --noEmit`: **PASS** (clean).
- `pnpm test`: **PASS** — 753/753 (25 files).
- `pnpm test:e2e -- e2e/budget-star-notes.spec.ts`: **PASS** — 6/6, including the previously-
  failing assertion at line 117.
- `pnpm test:e2e -- e2e/budgeting-restructure.spec.ts`: **PASS** — 13/13, after a required
  fixture reset unrelated to this fix (see above).
- `pnpm build:only`: **PASS** — exit 0, no new warnings.

### Open questions / handoff notes

- **Next agent: qa**, to re-verify Phase 5 and re-issue a verdict (PASS is expected — every gate
  above is green and the specific failing assertion now passes). qa does not need to redo the
  full manual click-through list from the original Phase 5 write-up; the fix is narrowly scoped
  and every other flow it verified was already unaffected by the bug.
- **The discriminator is intentionally narrow — do not generalize it.** It is scoped to exactly
  one shape (`annualAmountCents === 0`, no cause lines, starred or noted) and must stay that way.
  A genuinely-entered $0 budget line and a $0 category with real cause-line detail both still
  report `budgetCents: 0` everywhere, unchanged — confirmed by dedicated tests in both files
  above. Do not widen this to "treat every 0 as null" in a future refactor.
- **Variance display changed for the annotation-only case specifically**: an annotation-only row
  now shows "—" for variance (both `varianceCents` and `pct` null) instead of `-actualCents`,
  because `variance` is now derived from the corrected `budgetCents`. This is a deliberate,
  in-scope consequence of "surface budgetCents: null" applying uniformly to display, not a
  separate change — flagging so qa doesn't mistake it for a new, unrelated behavior change.
- **`budgeting-restructure.spec.ts`'s FY2099 Foundation fixture was reset once during this fix**
  (a stale, already-consumed fixture from an earlier same-day run, unrelated to this bug) and is
  now dirtied again by this fix's own re-run, per that suite's own documented "intentionally left
  in place" convention. Left as-is — do not clean it up in a future session; that file's own
  header comment explains why.
- **FY2099 fixture hygiene, current state as of this write-up:** Club entity — 0 rows in
  `ledger_budgets`/`ledger_budget_lines`/`ledger_budget_approvals` at FY2099 (cleaned). Foundation
  entity — has its usual `budgeting-restructure.spec.ts` fixture rows under "Charitable donation
  out" at FY2099 (expected, intentional, not a cleanup gap per that file's own docs).
- Everything else from the original Phase 4 (schema/API/UI) and Phase 5 write-ups above stands
  unmodified — this fix did not touch the routes, the schema, the lock-check exception, the
  admin-only boundary, or any UI component.

---

## Phase 5 — Verification (re-verify) — 2026-07-29

**Date:** 2026-07-29
**Verified by:** qa
**Status:** complete

### Summary

**Verdict: PASS.** The `resolveDisplayBudgetCents` discriminator (`src/lib/ledger.ts`), wired
into both `buildLines()` call sites in `getFundReport()` (`src/lib/ledger-queries.ts`), fixes the
previously-failing flow: an annotation-only lazy-created row (`annualAmountCents === 0`, no cause
lines, starred or noted) now reports `budgetCents: null`, so the amount input stays blank on
reload instead of showing a fabricated "0.00." The regression e2e (`e2e/budget-star-notes.spec.ts:117`)
that caught the original bug now passes, along with the other 5 tests in that suite. All four
automated gates are green. Genuine $0 budgets (not starred/noted) and $0-with-cause-line-detail
rows are confirmed byte-for-byte unchanged, both by dedicated unit tests and by re-reading the
discriminator's single narrow branch. No route, schema, or permission-gate change accompanied this
fix, so the Feature-Gate Audit result from the original Phase 5 pass still holds — re-confirmed by
re-reading both route files directly.

### What I did

- Re-read the full work-log — Phase 3 design, original Phase 5 FAIL, and the fix's Phase 4
  write-up — before re-running anything.
- Read `resolveDisplayBudgetCents` directly in `src/lib/ledger.ts` (single branch: returns `null`
  only when `rawBudgetCents === 0 && !hasCauseLines && (starred || note !== null)`; otherwise
  passes `rawBudgetCents` through unchanged) and its two call sites inside `getFundReport()` in
  `src/lib/ledger-queries.ts`, confirming the fix is exactly as narrowly scoped as the fix's own
  handoff notes claim — not inferred from the tests passing.
- Ran the automated gates fresh:
  - `pnpm exec tsc --noEmit` — clean, no output.
  - `pnpm test` — **753/753 passing**, 25 test files (up from 741 pre-fix; the 12 new cases —
    7 in `describe("resolveDisplayBudgetCents")` in `src/lib/ledger.test.ts:2714`, 5 appended to
    `describe("getFundReport — Budget Star & Notes (DECISION-057)")` in
    `src/lib/ledger-queries.test.ts:1768`). Read every new test body directly (not just the names):
    confirmed the annotation-only cases (starred-only, note-only, both) assert `budgetCents:
    null`, and confirmed separately that a genuine deliberately-entered $0 (not starred, no note),
    a $0 category with real cause-line detail (starred or not), and a real non-zero budget
    (starred/noted or not) all assert `budgetCents` **unchanged** at their original value — the
    exact "don't generalize this" boundary the fix's handoff notes call out.
  - `pnpm build:only` — succeeds, exit 0. Both annotation routes still present in the route
    manifest (`ƒ /api/admin/ledger/budgets/annotations`,
    `ƒ /api/admin/ledger/budgets/cause-lines/annotations`); no new warnings.
- Started a local `pnpm dev` server and ran the e2e suites:
  - `pnpm test:e2e -- e2e/budget-star-notes.spec.ts` — **6/6 passing**, including
    `e2e/budget-star-notes.spec.ts:117` (the previously-failing reload assertion) — confirmed the
    amount input now stays blank after reload instead of showing "0.00."
  - `pnpm test:e2e -- e2e/budgeting-restructure.spec.ts` — first run **failed at test 2/13**
    ("Flow 7…") on a stale Foundation-entity FY2099 fixture. Root-caused via direct DB query
    (`ledger_budgets`/`ledger_budget_lines` for `foundation`/FY2099 already had 3 cause lines under
    "Charitable donation out" before this run touched anything) — this is the fixture the
    full-stack-developer's own fix run left behind per that suite's documented "no destructive
    cleanup path, intentionally left in place" convention, not a regression from the fix. Reset it
    (`DELETE FROM ledger_budgets`/`ledger_budget_approvals` scoped to `foundation`/FY2099 via
    direct `psql`), re-ran clean: **13/13 passing**. This confirms the one failure was pre-existing
    fixture staleness, not anything introduced by this fix.
- Spot-confirmed the genuine-$0 and print-worksheet behavior directly in code, not just via the
  unit tests: `budget-print-worksheet.tsx`'s "New Budget" column
  (`formatBudgetReferenceCents(line.budgetCents)`) and `budget-editor.tsx`'s amount-input seeding
  both read `FundReportCategoryLine.budgetCents` — the same field `resolveDisplayBudgetCents`
  populates — so a genuine $0 (which still resolves to `0`, per the unit tests) prints/displays
  exactly as it did before this feature shipped; only the annotation-only shape's display changed.
- Re-read both annotation route files directly (`src/app/api/admin/ledger/budgets/annotations/route.ts`,
  `src/app/api/admin/ledger/budgets/cause-lines/annotations/route.ts`) to confirm the fix touched
  neither — both still call `auth()` then `hasFeature(session.user.id, FEATURES.LEDGER_MANAGE)`
  before any shape validation, unchanged from the original Phase 5 pass.
- FY2099 fixture hygiene: my own re-run of `e2e/budget-star-notes.spec.ts` recreated the Club
  entity's FY2099 fixture (3 `ledger_budgets` rows, cascading `ledger_budget_lines`, plus a
  `ledger_budget_approvals` row from the lock/unlock test) — deleted all of it via direct `psql`
  after the run, confirmed back to 0 rows for the Club entity at FY2099. Left the Foundation
  entity's FY2099 `budgeting-restructure.spec.ts` fixture (1 `ledger_budgets` row under "Charitable
  donation out," recreated by my clean re-run of that suite) in place, per that suite's own
  documented, intentional non-cleanup convention — not a hygiene gap.
- Stopped the local dev server after the e2e runs completed.

### Outputs

#### Type Check
`pnpm exec tsc --noEmit`: **PASS**

#### Unit Tests
`pnpm test`: **PASS**
Total: 753 | Passed: 753 | Failed: 0
Duration: ~0.8s (25 test files)
Failures: none. New cases confirmed present and correctly scoped:
`src/lib/ledger.test.ts:2714` (`describe("resolveDisplayBudgetCents")`, 7 tests) and
`src/lib/ledger-queries.test.ts:1768` (5 tests appended to the existing
`describe("getFundReport — Budget Star & Notes (DECISION-057)")` block).

#### Production Build
`pnpm build:only`: **PASS**
Notes: both annotation routes still present in the manifest; no new warnings; route count
unchanged from the original Phase 5 pass.

#### End-to-End Tests
`pnpm test:e2e -- e2e/budget-star-notes.spec.ts`: **PASS**
Total: 6 | Passed: 6 | Failed: 0
Duration: ~43s
Failures: none. **`e2e/budget-star-notes.spec.ts:117` (previously failing) now passes** — the
amount input for a starred, un-budgeted category stays blank after a page reload instead of
showing a fabricated "0.00."

`pnpm test:e2e -- e2e/budgeting-restructure.spec.ts`: **PASS** (after one required fixture reset,
unrelated to this fix — see below)
Total: 13 | Passed: 13 | Failed: 0
Duration: ~1.0m
Failures: none on the clean run. The first run of the session failed 1/13 (test 2, "Flow 7…") on a
stale Foundation-entity FY2099 fixture left behind by the fix's own prior e2e run — confirmed via
direct DB query and by this suite's own file-header comment, which documents it as
non-idempotent/serial with no destructive cleanup path. Reset the fixture (`DELETE FROM
ledger_budgets`/`ledger_budget_approvals` scoped to `foundation`/FY2099) and re-ran clean: 13/13.
Not a regression from this fix.

### Manual Click-Through / Spot-Checks

| Flow | Result | Notes |
|------|--------|-------|
| Starring an un-budgeted category, reload — amount input stays blank | pass | `e2e/budget-star-notes.spec.ts:117` — the specific regression this re-verify existed to confirm. |
| THE LANDMINE (star/note-only never zeroes an existing amount or blanks an existing note) | pass | `e2e/budget-star-notes.spec.ts:175` — unaffected by this fix, still passing. |
| Genuine deliberately-entered $0 (not starred, no note) still reports/displays `budgetCents: 0` everywhere | pass | Confirmed via `src/lib/ledger.test.ts:2727` and `src/lib/ledger-queries.test.ts` (the "UNCHANGED — still 0" cases); also confirmed by reading `resolveDisplayBudgetCents`'s single branch directly — a non-starred, non-noted $0 never matches the `starred \|\| note !== null` condition. |
| $0 category with real cause-line detail (itemized $0 breakdown), starred or not, still reports `budgetCents: 0` | pass | Confirmed via dedicated unit test (`hasCauseLines: true` short-circuits the discriminator regardless of starred/note). |
| Print worksheet's "New Budget" column reads the same corrected `budgetCents` field, no separate patch needed | pass | Confirmed by reading `budget-print-worksheet.tsx`'s `formatBudgetReferenceCents(line.budgetCents)` call site directly — feeds off the same `FundReportCategoryLine.budgetCents` the fix corrected. |
| Both annotation routes still gated `auth()` + `hasFeature(..., FEATURES.LEDGER_MANAGE)`, unchanged by the fix | pass | Re-read both route files directly; fix touched neither. |

### Regression Tests Added (this re-verify; authored by the fix, confirmed here)
- `src/lib/ledger.test.ts:2714` — `describe("resolveDisplayBudgetCents")`, 7 cases — guards against:
  an annotation-only lazy-created row (starred and/or noted, `annualAmountCents: 0`, no cause
  lines) displaying as a real `0` instead of `null`, while proving a genuine $0, a $0-with-cause-lines,
  and a real non-zero amount are all left untouched by the same function.
- `src/lib/ledger-queries.test.ts:1768` — 5 cases appended to the existing `getFundReport` Budget
  Star & Notes block — same guarantee, exercised through the full `getFundReport()` mock-DB
  harness rather than the pure function in isolation.
- `e2e/budget-star-notes.spec.ts:117` — originally written during the first Phase 5 pass as a
  failing-then-passing regression; now confirmed passing against the fix. Guards against the exact
  user-visible symptom: a treasurer starring an un-budgeted category, reloading, and seeing a
  number they never entered.

### Coverage on Critical Modules
- `src/lib/events.ts`: 94.73% stmts / 85.54% branch (unchanged by this feature; meets the 90%+
  target).
- `src/lib/permissions.ts`: not touched by this feature. Note for the next 7-day coverage sweep:
  this run's `v8` coverage table does not surface `src/lib/permissions.ts` as a row at all (despite
  `src/lib/permissions.test.ts` existing with 14 tests) — likely a reporter/include-pattern quirk
  unrelated to this feature, not a regression introduced here, but worth the coverage owner's
  attention on the next sweep since it can't currently be confirmed at 100% from this report alone.
- `src/lib/members.ts`: 30.55% stmts (unchanged by this feature; pre-existing gap, outside scope).
- `src/lib/ledger.ts` (touched by this fix): **100% stmts / 95.86% branch**, whole file, full suite.
- `src/lib/ledger-queries.ts` (touched by this fix): whole-file blanket number is 40.94% stmts /
  41.88% branch (consistent with the original Phase 5 pass's 40.86% — this file is the entire
  4,600+-line Ledger query layer spanning many prior features; the star/note-specific surface,
  including the new discriminator wiring, is thoroughly covered per the specific test names
  confirmed above).

### Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `PATCH /api/admin/ledger/budgets/annotations` | yes | yes | `FEATURES.LEDGER_MANAGE` — unchanged by this fix; re-confirmed by reading the route file directly. |
| `PATCH /api/admin/ledger/budgets/cause-lines/annotations` | yes | yes | `FEATURES.LEDGER_MANAGE` — same. |

This fix touched no route, no schema, and no permission gate — it is contained entirely to
`src/lib/ledger.ts` (new pure function) and `src/lib/ledger-queries.ts` (`getFundReport`'s two
`buildLines()` call sites). No other protected route or server action was added or changed since
the original Phase 5 pass.

### Verdict: PASS

## Open questions / handoff notes

- **Next agent: analyst, for Phase 6 (shipped vs intent).** This feature is verified end to end:
  typecheck, unit tests (753/753), production build, and both e2e suites are green, including the
  specific regression this loop-back existed to fix.
- **FY2099 fixture hygiene, current state as of this write-up:** Club entity — 0 rows in
  `ledger_budgets`/`ledger_budget_lines`/`ledger_budget_approvals` at FY2099 (cleaned after this
  re-verify's own e2e run). Foundation entity — has its usual `budgeting-restructure.spec.ts`
  fixture rows under "Charitable donation out" at FY2099 (expected, intentional, not a cleanup gap
  per that suite's own file-header convention).
- **`permissions.ts` coverage-reporter gap** (noted above) is worth a look on the next 7-day
  coverage sweep — not blocking this feature's PASS, since `permissions.ts` is untouched by this
  work, but it means the project can't currently *prove* the 100% target from the coverage tool's
  own report.
- Everything else from the original Phase 4 (schema/API/UI) and Phase 5 write-ups, and the fix's
  own Phase 4 write-up, stands unmodified.

---

# Phase 6 — Shipped vs Intent (analyst)

**Owner:** analyst
**Status:** complete

## VERDICT

**SHIP IT**

## ONE-LINE TAKE

> The treasurer can now flag and annotate any category or cause line — budgeted or not — sort
> keeps starred rows on top instantly, the annotations survive an FY lock, and the one real defect
> QA caught (a fabricated "0.00" on reload for an un-budgeted starred row) is fixed with a
> narrowly-scoped, well-tested discriminator that leaves every other $0 case untouched.

## What I Did

- Re-read my own Phase 1 review (verbs, all 6 flows, permissions, all 9 gaps, the 3 user
  confirmations) and DECISION-057 in full.
- Re-read Phases 2–5 in full: the architect's two must-honor items (conditional upsert `set`
  clause; separate non-lock-gated routes), the tech-lead's B-29 reconciliation and API contract,
  both implementer write-ups, the original QA FAIL (with exact root-cause trace), the
  full-stack-developer's fix write-up, and the QA re-verify PASS.
- Independently spot-checked the code rather than taking the phase write-ups on faith:
  - `resolveDisplayBudgetCents` in `src/lib/ledger.ts` — confirmed the single branch is exactly as
    narrow as claimed: `rawBudgetCents === 0 && !hasCauseLines && (starred || note !== null)` →
    `null`, otherwise passthrough. A genuine deliberately-entered $0 and a $0-with-cause-lines
    category cannot hit this branch.
  - Both new route files (`.../budgets/annotations/route.ts`,
    `.../budgets/cause-lines/annotations/route.ts`) — confirmed the loud "INTENTIONAL: never calls
    assertBudgetUnlocked... See DECISION-057" header comment is present verbatim on both, and
    confirmed by reading (not inferring) that both gate `auth()` → 401 then
    `hasFeature(..., FEATURES.LEDGER_MANAGE)` → 403 before any shape validation.
  - `guided-budget-setup.tsx`'s `sectionLines` sort and `budget-cause-editor.tsx`'s within-group
    sort — confirmed the stable starred-first sort reads from client-side `starOverrides`/local
    `rows` state, not a server round trip, so the reorder is genuinely instant.
  - `budget-print-worksheet.tsx` — confirmed the `★ ` prefix and conditional `Note: …` row render
    at both category and cause-line grain, and that a note row is omitted entirely when empty
    (grepped: no unconditional note `<tr>`).
  - Grepped all four touched components for `window.confirm/alert/prompt` (none), `rounded-xl`/
    `rounded-full` (none introduced), and confirmed every new interactive control carries
    `rounded-lg`, `min-h-[44px]` (`min-w-[44px]` on icon-only buttons), and
    `onMouseDown={preventMouseDownDefault}`.

## What's Working

- **The lazy-create-and-fix cycle is a genuine success case for the pipeline, not just a passing
  grade.** The architect named the exact landmine in Phase 2 (conditional-upsert-must-not-touch-
  amount) before a line of code was written, api-developer tested it directly against the captured
  `onConflictDoUpdate` SET object rather than an inferred mock return, QA caught a *second*,
  different bug the design doc hadn't anticipated (the reload-fabricates-"0.00" defect) with a
  targeted e2e test, and the fix was scoped exactly to the one shape that caused it rather than
  over-generalized. This is the pipeline working as designed: a real defect surfaced late, root-
  caused precisely, and fixed without collateral damage — verified independently above, not just
  asserted in the work-log.
- **Instant sort-to-top reads as more polished than what I asked for in Phase 1**, and does not
  compromise anything to get there (see ruling below).
- **The lock-interaction exception is self-documenting at the call site**, exactly per the
  architect's Phase 2 concern — a future "audit every write path for a missing lock check" pass
  will find the justification in the route file itself, not have to reconstruct it from this
  work-log.

## Intent-vs-Shipped Diff

- **Flow 1/2 — star/note a category row.** Phase 1 said: star + note affordances on
  `budget-editor.tsx` category rows, optimistic update, toast-on-failure, never a blocking modal,
  typed note preserved on save failure. Shipped: exactly this, across all three render branches
  (pending-delete / in-breakdown / lump-sum), confirmed by reading `renderAnnotationControls`/
  `renderNoteEditor`'s wiring. **Verdict: matches.**
- **Flow 3 — star/note a cause line.** Phase 1 said: identical affordances at the cause-line
  grain in `budget-cause-editor.tsx`. Shipped: per-row controls in both live and dead
  (`isRowDead`) branches, within-cause-group sort. **Verdict: matches**, and correctly extended
  to cover the B-29 "dead row" state Phase 1 couldn't have named (tech-lead's Phase 3
  reconciliation handled this, reaffirming Decision 7 rather than silently dropping it).
- **Flow 4 — star/note an un-budgeted category (lazy-create, no fabricated $0.00).** Phase 1 said:
  lazy-create a `ledger_budgets` row on first star/note, with the open risk that the lazy-created
  $0 must be indistinguishable from a deliberate $0 only "cosmetically," not literally — Phase 1's
  own text assumed a $0 row "already renders identically to today's un-budgeted display." Shipped:
  the first implementation broke exactly that assumption (QA's FAIL), and the fix
  (`resolveDisplayBudgetCents`) restores it correctly and only for the annotation-only case.
  **Verdict: matches, after one loop-back.** This is the diff working as intended — Phase 1 named
  the risk, QA caught the miss, the fix closed it without widening scope.
- **Flow 6 — lock interaction (notes/stars editable when FY is locked).** Phase 1 Decision 6:
  stars/notes stay live through an Approve-&-lock. Shipped: confirmed by QA's e2e test toggling
  the star twice while locked (both PATCHes returned 200, never 409) and by my own read of both
  route files showing zero `assertBudgetUnlocked` import. **Verdict: matches.**
- **Sort-to-top.** Phase 1 said "persists on next page load" as the baseline, with Decision 1
  confirming sort-to-top was in scope but not specifying timing. Shipped: instant client-side
  reorder, more ambitious than the Phase 1 wording. **Verdict: acceptable drift — ruling below.**
- **Print worksheet.** Phase 1 Decision 8: category-grain stars/notes visible on the worksheet.
  Architect's Phase 2 note had scoped this to category-only because the worksheet had no
  cause-line rendering at the time. Shipped: cause-line stars/notes *also* print, because B-29
  (a separate, intervening feature) added cause-line rendering to the worksheet in the interim.
  **Verdict: acceptable drift** — this is tech-lead correctly re-scoping Decision 8 upward once the
  precondition for the narrower scope no longer held, not scope creep invented mid-implementation.
- **Permission gate.** Phase 1: existing `ledger.manage`, no new `FEATURES` key. Shipped: exactly
  that, on both new routes — confirmed by direct read. **Verdict: matches.**
- **Member-facing boundary (Gap/Decision 9).** Phase 1 said this was "confirmed clear" based on
  `financial-report-queries.ts` having no import of `ledgerBudgets`/`ledgerBudgetLines` — api-
  developer's Phase 4 handoff correctly caught that this phrasing was imprecise (the file *does*
  import `getFundReport`; the real boundary is the explicit allowlist with no spread in
  `buildLines()`) and added a grep-based regression test proving the narrower, accurate boundary
  holds. **Verdict: matches** (the guarantee holds), with a **documentation-accuracy note**, not a
  functional gap — Phase 1 Decision 9's phrasing should be corrected on the next docs pass so a
  future analyst doesn't repeat the same imprecise "no import" claim.
- **Cause-group headers (new B-29 grain).** Tech-lead ruled these get no star/note in this
  increment — a deliberate non-goal, correctly flagged rather than silently omitted, consistent
  with Phase 1 Decision 3's "category rows and cause line rows" (not every grain). **Verdict:
  matches** — nothing in Phase 1 asked for this grain.

## Ruling: instant client-side sort-to-top

**Approved, no reservation.** Phase 1's Flow 1 text ("star persists on next page load; category
may move to top-of-list") was written before B-29 existed and was deliberately conservative because
at Phase 1 time there was no confirmed mitigation for the classic "control moves out from under an
in-flight click" hazard that an instant reorder risks. Tech-lead's design doc makes the sequencing
argument explicit and correct: B-29 already had to solve this exact hazard for its own add/remove/
restore controls (the `onMouseDown={preventMouseDownDefault}` fix), and every new star/note control
in this feature reuses that same defense — confirmed directly in both `budget-editor.tsx` and
`budget-cause-editor.tsx` by grep, every star/note button carries `onMouseDown=
{preventMouseDownDefault}`. Chris approved this explicitly as one of the two decisions flagged for
sign-off, and the shipped mechanism (client-side `starOverrides`/local `rows` state, not a
speculative server race) matches what was approved. Sorting is a strict UX improvement for the
stated meeting-prep use case ("treasurer scans starred items first") with no discovered downside.

## Ruling: star-toggle-never-zeroes-an-amount landmine

**Confirmed closed, at both the unit and e2e layers.** The architect named this as the single
highest-risk regression vector in Phase 2. It is tested at the query layer
(`src/lib/ledger-queries.test.ts:1422`, asserting directly against the captured
`onConflictDoUpdate` `set` object rather than an inferred return value) and at the UI/integration
layer (`e2e/budget-star-notes.spec.ts:175`, "THE LANDMINE," toggling star/note independently on an
already-$500-budgeted, already-noted category and confirming both survive every combination across
a reload). Both tests were read directly, not taken on the work-log's word. This is exactly the
kind of finding a Phase 1/2 adversarial pass exists to prevent from shipping silently, and it's now
guarded at two independent layers.

## Edge Cases

- **Empty state:** pass. A fund/FY with zero stars/notes shows unfilled/outline icons (no banner,
  no clutter) on screen, and prints identically to before this feature — confirmed by QA's
  dedicated e2e assertion checking the Administrative Fund's worksheet section (left deliberately
  un-starred as a control) contains neither `★` nor `Note:` anywhere.
- **Failure microcopy:** pass. "Couldn't save — try again." (Phase 1 Flow 1's named copy, reused
  verbatim) confirmed present at both grains in both components; typed note text is preserved on
  save failure rather than lost, confirmed via `saveNote`'s implementation, not just via the e2e
  suite passing.
- **Permission gate:** pass. Both routes 401 with no session, 403 without `ledger.manage`, gate
  checked before any shape/DB work — confirmed by direct read of both route files, matching QA's
  Feature-Gate Audit on both the original and re-verify passes.
- **Mobile (360px):** pass. Every new control is `min-h-[44px]` (`min-w-[44px]` on icon-only
  buttons) per B-29's own established standard — confirmed by grep across both editor components;
  ux-developer's Phase 4 write-up states this was checked explicitly and QA's manual click-through
  didn't flag a mobile regression.
- **Brand consistency:** pass. No `window.confirm/alert/prompt` introduced (grepped, none found —
  and correctly so: star/note toggles are non-destructive, so `<ConfirmDialog>` was never called
  for here, which is the right call, not an omission). All new buttons use `rounded-lg`; no
  `rounded-xl`/`rounded-full` introduced.

## Non-Blocking Items Confirmed (do not block SHIP)

- **`permissions.ts` coverage-reporter gap** — QA's re-verify pass noted the `v8` coverage tool
  doesn't surface `src/lib/permissions.ts` as a row despite 14 passing tests existing for it. This
  file is untouched by this feature; the gap is a reporter/include-pattern quirk to hand to the
  next 7-day coverage sweep, not something this feature introduced or should hold up on.
- **Pre-existing `pnpm lint` / `minimatch` ESM-interop failure** — fires during ESLint's own
  config-loading step, before any file is linted; confirmed by both api-developer and QA (twice) to
  be unrelated to any file this feature touched. Correctly routed to deployment-engineer's 30-day
  dependency review rather than blocking here.

## Follow-Ups (tracked, non-blocking)

- **Correct Phase 1 Decision 9's phrasing in a future documentation pass.** The claim
  "`financial-report-queries.ts` ... no import of `ledgerBudgets`/`ledgerBudgetLines`" is
  inaccurate (it imports `getFundReport`); the real, now test-covered boundary is "no spread
  operator in `buildLines()`'s explicit allowlist." Low priority — the guarantee holds and is
  regression-tested — but worth fixing so a future analyst doesn't cite the wrong mechanism.
- **Confirm `permissions.ts` coverage visibility on the next 7-day coverage sweep** (qa's own
  flagged item, restated here so it isn't lost between work-logs).
