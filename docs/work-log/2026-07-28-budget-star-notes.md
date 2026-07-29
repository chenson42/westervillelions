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
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

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
