# Budget Line Add/Remove + Approve/Lock — Work Log

> **Slug:** `2026-07-27-ledger-budget-approve`
> **Surface:** (dashboard) admin — `/admin/ledger/budgeting`
> **Permission(s):** existing `FEATURES.LEDGER_MANAGE` (add/remove lines), existing `FEATURES.LEDGER_APPROVE` (approve/lock, unlock/amend) — no new key needed
> **Estimated complexity:** medium (new schema, new API surface, new UI, page-gate rework)
> **Pipeline mode:** Full — schema-touching (approve/lock needs new persistent state keyed by (entity, fiscalYear); `ledger_budgets` is per-line, not per-year). Runs the specialist split: architect → tech-lead → database-admin → api-developer → ux-developer → qa.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-27 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-07-27 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-07-27 |
| 4 — Implementation (schema) | database-admin | Complete | — | 2026-07-27 |
| 4 — Implementation (server) | api-developer | Complete | — | 2026-07-27 |
| 4 — Implementation (client) | ux-developer | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

Chuck's two-sentence ask ("add/remove lines," "lock it in") is really two features hiding a bigger gap than he named: there is currently **no way to create a budget category at all** in this codebase (only migrations seed them), and the approve/lock page-gate design will silently exclude board members who hold `LEDGER_APPROVE` but not `LEDGER_MANAGE` unless the existing single-gate page structure is reworked.

## Files Read

- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx`
- `src/components/admin/ledger/guided-budget-setup.tsx`
- `src/components/admin/ledger/budget-editor.tsx`
- `src/lib/ledger-queries.ts` (`upsertBudgetLine`, lines ~560–650)
- `src/app/api/admin/ledger/budgets/route.ts` (PATCH)
- `src/app/api/admin/ledger/transactions/[id]/approve/route.ts` (board-minute + self-approval precedent)
- `src/app/api/admin/ledger/reimbursements/[id]/route.ts` (approve precedent, second instance)
- `src/lib/db/schema.ts` (`ledgerBudgets` L772, `ledgerCategories` L565, `ledgerTransactions.boardMinute` L684)
- `src/lib/fiscal-year.ts`
- `src/lib/permissions.ts` (`FEATURES.LEDGER_*`)
- `drizzle/migrations/0047_ledger_approve_permission.sql` (role bindings: `ledger.approve` → `admin`, `board_member`)
- Confirmed by grep: **no** admin route or page anywhere manages `ledgerCategories` CRUD. Categories are only ever inserted by SQL migrations (`0044_ledger_books.sql`, `0049_ledger_990_lines.sql`, `0053_ledger_category_counts_as_giving.sql`).

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (LEDGER_MANAGE) | Create a new budget category (name + flow) scoped to the fund being edited | Occasional, mostly at year-start |
| Admin (LEDGER_MANAGE) | Set/clear a dollar target for a category+flow for the target fiscal year | Per-line, during budget season |
| Admin (LEDGER_APPROVE) | Review the entity's full proposed budget (all funds, one FY) and lock it in with a board-minute reference | Once per fiscal year per entity, normally |
| Admin (LEDGER_APPROVE) | Unlock/amend a previously-approved budget, with a reason, then re-approve | Rare — mid-year budget amendment |

Note: today's page (`budgeting/page.tsx` L33-34) gates the **entire page** on `LEDGER_MANAGE` and redirects to `/access-pending` otherwise. If approve/lock is gated on `LEDGER_APPROVE` (a distinct feature, per `0047_ledger_approve_permission.sql` bound to `admin` + `board_member`, not necessarily the same people who hold `LEDGER_MANAGE`), **a board member with only `LEDGER_APPROVE` cannot even load this page today.** This must be reworked to a two-tier gate (view/approve vs. edit), mirroring the comment already in the code contrasting this page against the "view-or-manage" pattern used by `[fundSlug]/report/page.tsx`.

## Flows

**Flow 1 — Add a budget line (new category):**
Entry: `/admin/ledger/budgeting?entity=…&fy=…`, a fund's card, "+ Add category" affordance (new) → Step: treasurer types a category name and picks income/expense (fund/fundKind is already implied by which fund card they're in — no dropdown needed) → Step: submit → Outcome success: new `ledgerCategories` row created (`isActive: true`, default `countsAsGiving: true`, `sortOrder` appended to end), new row appears in `BudgetEditor` with an empty amount field ready to type into.
- Failure: empty name → inline "Category name is required." Duplicate name (case-insensitive) within the same entity+fundKind+flow → 409, "A category named '…' already exists for this fund." Network/DB error → toast "Could not create category. Try again." (matching existing toast microcopy convention in this file).

**Flow 2 — Add a budget line (existing, uncategorized-for-this-year category):**
This is **already fully supported today** — every active category for the fund+flow renders as a row in `BudgetEditor` regardless of whether it has a target yet; typing an amount and blurring calls `PATCH /budgets` and upserts. No new capability needed here — worth naming explicitly so Phase 3 doesn't rebuild it.

**Flow 3 — Remove a budget line:**
Entry: an existing row in `BudgetEditor` → Step: treasurer clears the dollar field to blank and blurs/presses Enter → Outcome success: `PATCH /budgets` with `annualAmountCents: null` deletes the `ledger_budgets` row (already implemented, `BudgetEditor` L64-68). The category itself, and any actuals recorded against it, are untouched — matches the locked decision ("remove a line" = drop the target, not the category).
- **Gap:** this already works, but it is not visually an explicit "remove" action — it's "type nothing, click away," with no confirm and no visual difference between "never budgeted" and "just removed." If Chuck's ask implies a visible affordance (a "Remove" control, not a silent blank-and-blur), that's new UI, not new backend. Recommend tech-lead decide whether to add an explicit remove control (with `ConfirmDialog`, since it wipes a stored number a treasurer may have spent time on) or keep the current blank-to-delete UX and just message it more clearly. Flagging as open question below.
- Failure: invalid amount typed then cleared — no failure path distinct from today's.

**Flow 4 — Approve/lock a year's budget:**
Entry: `/admin/ledger/budgeting` for a given `(entity, fiscalYear)`, a new "Approve Budget" action (page-level, not per-fund — see Permissions/granularity note) → Step: reviewing user (LEDGER_APPROVE) sees a summary — all funds for that entity/FY, each fund's balance-advisory badge (already computed by `computeBudgetBalanceStatus`, currently presentation-only) — → Step: enters a required board-minute reference (mirrors `ledgerTransactions.boardMinute` / `approve-dialog.tsx` pattern exactly) → Step: confirms → Outcome success: budget for that `(entity, fiscalYear)` is marked locked; all fund cards for that FY switch to read-only (inputs disabled, "Add category" hidden, seed buttons hidden); a "Locked — approved by {name} on {date}, board minute {ref}" banner appears.
- Failure: missing board-minute → inline "Board minute reference is required" (mirrors existing 400 microcopy). Attempting to load `/budgets` PATCH or seed against a locked FY server-side → 409 "This budget is locked. Unlock it to make changes." (not a silent no-op, not a stack trace).

**Flow 5 — Unlock/amend a locked budget:**
Entry: locked-budget banner, "Unlock to amend" action (LEDGER_APPROVE) → Step: enters a reason/board-minute for the amendment → Step: confirms via `ConfirmDialog` → Outcome success: budget unlocked, editor becomes editable again, an unlock record (who/when/why) is retained even after re-approval overwrites the current-state approval fields.
- Failure: same validation pattern as approve (reason required).

## Permissions

- **Add/remove line, create category:** existing `FEATURES.LEDGER_MANAGE` — same gate as today's `PATCH /budgets`. No new key.
- **Approve/lock, unlock/amend:** existing `FEATURES.LEDGER_APPROVE` — reuses the exact precedent already in this codebase for transaction and reimbursement approval (`ledgerTransactions.approve`, `ledgerReimbursements` approve route), both of which already require a `boardMinute` string and are bound to `admin` + `board_member` (`drizzle/migrations/0047_ledger_approve_permission.sql`). **Recommendation:** do not create `LEDGER_ADOPT` or similar — reusing `LEDGER_APPROVE` is both simpler and semantically right: a board vote to adopt the year's budget is the same class of action as a board vote to approve a disbursement.
- **Default roles:** unchanged — `admin`, `board_member` already hold `LEDGER_APPROVE`; treasurer (or whoever holds `LEDGER_MANAGE`) unchanged.
- Unlike the transaction-approval precedent, I do **not** recommend a self-approval block (the transactions route blocks `session.user.id === txn.recordedByUserId`). Budget adoption is a board vote about a plan, not a single person moving money — Chuck, as treasurer+president, plausibly holds both `LEDGER_MANAGE` and `LEDGER_APPROVE` and is the natural person to record the board's vote after the fact. Flagging this as an explicit open question rather than deciding it silently, since it's a real internal-controls judgment call, not a UI detail.

## Gaps the Request Didn't Address

- **No category-creation surface exists anywhere in the app.** Categories are seed-only today (SQL migrations). "Add a line" for a genuinely new category is not a small UI tweak — it's the first-ever runtime path for creating a `ledgerCategories` row. This is the single biggest gap in the request and needs explicit sign-off on scope (minimal inline create: name + flow, fund/fundKind implied by context — vs. a full category-management surface with editable `form990Line`, `sortOrder`, `countsAsGiving`, deactivation). Recommend scoping to the minimal inline-create for this feature and treating full category CRUD as backlog.
- **Empty-fund case breaks the only affordance that would let a treasurer add a first line.** `guided-budget-setup.tsx` L414 only renders `<BudgetEditor>` when `fund.budgetEditorLines.length > 0`. A fund with zero active categories today has **no editor at all** — so an "Add category" control must exist as its own persistent element (not appended inside `BudgetEditor`'s row list), or a brand-new fund can never get its first budget line.
- **Page gate excludes `LEDGER_APPROVE`-only users.** Covered above under User Verbs — the current single-gate (`LEDGER_MANAGE`-or-`/access-pending`) structure must become a two-tier gate (view/approve if either feature; edit only if `LEDGER_MANAGE`) or a board member can never reach the Approve button.
- **Lock enforcement must live in one place, not be duplicated.** Two existing write paths already touch `ledger_budgets` (`PATCH /budgets`, `POST /budgets/seed`), both routed through the shared `upsertBudgetLine` core (`ledger-queries.ts` L611, explicitly built as "one source of truth," architect Ruling 1). The new add-line/remove-line/category-create paths should also route through (or gate identically to) that shared core so the lock check is written once. Flagging for tech-lead/architect, not designing it myself.
- **"Remove a line" has no visible affordance today** — it's an implicit side effect of blanking an input, not a discoverable action. Confirm with Chuck whether that's sufficient or whether an explicit "Remove" control (with `ConfirmDialog`, per brand guideline for destructive actions) is expected.
- **Balance advisory at approval time.** `computeBudgetBalanceStatus` is explicitly presentation-only today (comment: "never gates a write" — architect Ruling 4). Recommend the approve action **shows** each fund's balance badge as a final check but does **not** block locking on a "Needs review" status — consistent with existing precedent. Confirm this reading with Chuck since "lock it in" could be read as "only once it balances."
- **Unlock audit trail.** Existing approval precedents (`ledgerTransactions`, `ledgerReimbursements`) store only current-state approval fields (single `approvedByUserId`/`approvedAt`/`boardMinute`), no history table. Recommend matching that convention for v1 (current-state fields on a new lock/approval record) but adding `unlockedByUserId`/`unlockedAt`/`unlockReason` fields alongside so at least the most recent unlock is visible — not a full multi-event log unless Chuck wants one.
- **Duplicate/near-duplicate category names.** No uniqueness constraint exists on `ledgerCategories.name` (only an index on entity+fundKind+flow, not unique). New inline-create should reject an exact case-insensitive duplicate name within the same entity+fundKind+flow scope server-side, not just rely on the treasurer noticing.

## Out of Scope (confirm with user)

- Full category management (edit name, `form990Line`, `sortOrder`, `countsAsGiving`, deactivate a category) — this feature only needs enough to create one inline while budgeting.
- Consolidated rollup / YTD pacing (B-15, explicitly deferred per the request context).
- Multi-event lock/unlock audit log (vs. current-state-only fields) — recommend deferring unless Chuck asks.
- A self-approval block on budget lock (mirroring the transaction-approval precedent) — recommend NOT building this unless Chuck confirms he wants separation of duties enforced between whoever built the budget and whoever locks it.

## Open Questions

1. **Approval granularity:** lock per `(entity, fiscalYear)` covering all funds at once (my recommendation, matching how the guided-setup page already scopes by entity+FY and how a board votes to "adopt the club's budget"), or per-fund? Please confirm.
2. **Self-lock:** should the person who built the budget (LEDGER_MANAGE) be blocked from also being the one who locks it (LEDGER_APPROVE), the way transaction self-approval is blocked today? Given you hold both roles, this materially affects your own workflow.
3. **Remove-line affordance:** is today's "blank the field and it disappears from the budget" behavior good enough, or do you want an explicit "Remove line" button/confirm?
4. **Category-create scope:** inline create with just name + flow (fund/kind implied by context, everything else defaulted), or do you also need to set `form990Line` / `countsAsGiving` at creation time?
5. **Balance-at-lock:** should locking a fund that's currently flagged "Needs review" by the balance advisory be blocked, warned-and-allowed (my recommendation, consistent with the existing presentation-only invariant), or is "lock it in" specifically meant to force balancing first?
6. **Unlock reason:** does the amendment need its own board-minute reference (separate vote to reopen), or is a free-text reason enough?

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** The shape Phase 1 converged on is structurally sound and fits the codebase's grain — no new FEATURES key, no new top-level module, reuse of the existing board-minute/approve pattern. Suggestions below (all non-blocking) concern where lock-enforcement lives, category-create placement, and one migration-numbering note for tech-lead.

## Files Read

- `docs/work-log/2026-07-27-ledger-budget-approve.md` (Phase 1, full)
- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` — current single-gate (`LEDGER_MANAGE`-only, explicit comment contrasting itself against the report page's view-or-manage pattern)
- `src/app/(dashboard)/admin/ledger/[fundSlug]/report/page.tsx` L45-60 — `hasAnyFeature([VIEW, RECORD, MANAGE])` page gate precedent
- `src/app/(dashboard)/admin/ledger/reimbursements/page.tsx` L56-73 — the exact two-tier pattern this feature should copy: `hasAnyFeature([...])` for page admission, then separate `canApprove`/`canRecord` booleans gating individual controls
- `src/lib/permissions-server.ts` — confirmed `hasAnyFeature()` already exists (L86), no new helper needed
- `src/lib/db/schema.ts` L539-797 — `ledgerFunds`, `ledgerCategories`, `ledgerTransactions` (approval trio + `boardMinute`), `ledgerBudgets`
- `src/app/api/admin/ledger/budgets/route.ts` (PATCH) and `.../budgets/seed/route.ts` — both gate on `LEDGER_MANAGE` and funnel through `upsertBudgetLine`
- `src/lib/ledger-queries.ts` L558-680 — `upsertBudgetLine` shared core, explicitly built as "one source of truth" (architect Ruling 1, prior increment)
- `src/app/api/admin/ledger/transactions/[id]/approve/route.ts` — board-minute + self-approval-block pattern (current-state columns, no event log)
- `src/app/api/admin/ledger/reimbursements/[id]/route.ts` — second instance of the same current-state approval pattern, confirms it's a convention, not a one-off
- `src/components/admin/ledger/budget-editor.tsx` — blank-to-delete UX (Flow 3), confirms no explicit remove control today
- `src/components/admin/ledger/guided-budget-setup.tsx` L414 — confirms the empty-fund gap analyst flagged (`BudgetEditor` only renders when `budgetEditorLines.length > 0`)
- `src/lib/permissions.ts` — full `FEATURES` catalog, confirms `LEDGER_MANAGE`/`LEDGER_APPROVE` already exist and no new key is warranted
- `drizzle/migrations/` directory listing — latest is `0061_members_membership_status.sql`; next migration is `0062`
- Grepped for a generic audit-log table to potentially reuse for lock/unlock history — none exists; `google_group_sync_log` is sync-specific only

## Ruling 1 — New schema for approve/lock

**New table: `ledgerBudgetApprovals`**, one row per `(entityId, fiscalYear)`, unique-constrained on that pair (mirrors `ledgerBudgets`' own compound-unique convention). Shape:

```typescript
export const ledgerBudgetApprovals = pgTable(
  "ledger_budget_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").notNull().references(() => ledgerEntities.id, { onDelete: "cascade" }),
    fiscalYear: integer("fiscal_year").notNull(),
    status: text("status").notNull().default("unlocked"), // 'locked' | 'unlocked'
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at"),
    boardMinute: text("board_minute"),
    unlockedByUserId: uuid("unlocked_by_user_id").references(() => users.id, { onDelete: "set null" }),
    unlockedAt: timestamp("unlocked_at"),
    unlockReason: text("unlock_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("ledger_budget_approvals_entity_year_key").on(t.entityId, t.fiscalYear)],
);
```

**Ruled: single status-flip row, last-state-wins — not an append-only event log.** Locking sets `status='locked'` + the approval trio; unlocking sets `status='unlocked'` + the unlock trio. Neither clears the other, so the most recent lock and most recent unlock are both visible simultaneously (satisfies analyst's "at least the most recent unlock is visible" recommendation) without a second table or list UI.

This is a direct precedent match, not a novel choice: `ledgerTransactions` (approval columns) and `ledgerReimbursements` (submit/approve/reject/pay) both model approval state as nullable current-state columns on the row itself — never as a separate event-log table — and I confirmed by grep there is **no** generic audit-log table in this schema to reuse (`google_group_sync_log` exists but is sync-specific). An event log would be a second table + list query + list UI for an action that, per Phase 1's own cadence estimate, fires once a year per entity, rarely twice. Logged as **DECISION-043** in `docs/decisions.md` since this is a new top-level table shape, not just an implementation detail.

**Confirmed:** goes in `schema.ts` first, then an idempotent migration. Next available migration number is `0062` (latest on disk is `0061_members_membership_status.sql`) — tech-lead should confirm this hasn't shifted if other work lands first, since migration files are numbered by convention, not auto-assigned.

## Ruling 2 — Lock enforcement (server-side)

**Every write path touching `ledger_budgets` or `ledger_categories` for a given `(entityId, fiscalYear)` must reject when that pair is locked, and the check must live in exactly one place.** Enumerated write paths:

1. `PATCH /api/admin/ledger/budgets` — existing, routes through `upsertBudgetLine`.
2. `POST /api/admin/ledger/budgets/seed` — existing, loops calls into `upsertBudgetLine` inside one transaction.
3. **New** add-line / create-category endpoint — must check lock before creating the category or upserting its first budget line.
4. **New** remove-line endpoint (if Phase 3 adds an explicit one distinct from blank-to-delete PATCH) — same check.
5. Any future category-edit path that would change `ledgerCategories` rows feeding a locked fiscal year's budget.

**Ruling: add `assertBudgetUnlocked(entityId: string, fiscalYear: number)` to `ledger-queries.ts`, and call it from inside `upsertBudgetLine` itself** (not separately in each route handler) — this is the same "one source of truth" discipline the prior increment already established for `upsertBudgetLine` being the single write core (architect Ruling 1, referenced in Phase 1 notes). Concretely:

- `upsertBudgetLine` calls `assertBudgetUnlocked` before its existing `validateBudgetLineInput` check (or folds the lock check into that same validation pass) and returns a `409` shape consistent with its existing `UpsertBudgetLineResult` (`{ ok: false, error: "This budget is locked. Unlock it to make changes.", status: 409 }`) — this automatically covers PATCH, seed, and the new add-line path for free, since all three already funnel through this function.
- The new category-create endpoint must call `assertBudgetUnlocked` explicitly before inserting the `ledgerCategories` row (category creation itself doesn't go through `upsertBudgetLine`, only the budget line that follows it does) — **this is the one call site that needs its own explicit guard**, since it's not naturally covered by the shared core.
- Do **not** rely on UI-only disabling (hiding inputs, disabling the "Add category" button) as the enforcement mechanism — that's already flagged correctly in Phase 1 as a gap, and the codebase's existing convention (e.g., `ledgerTransactions.approvedAt` guard blocking edits to approved transactions) is always server-side-first.

This is the load-bearing invariant of the whole feature — a locked budget that can still be silently edited via a stale tab or a direct API call defeats the entire point of "lock it in."

## Ruling 3 — The two-tier gate rework

**Confirmed: rework `budgeting/page.tsx` to `hasAnyFeature([FEATURES.LEDGER_MANAGE, FEATURES.LEDGER_APPROVE])` for page admission, then branch UI by individual `hasFeature()` checks.** This is not a novel pattern — it's the exact structure already live in two other ledger pages:

- `[fundSlug]/report/page.tsx` L55-60: `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` gates page admission; `BudgetEditor` itself is only rendered for `LEDGER_MANAGE` holders (per its own doc comment: "Only shown to users with LEDGER_MANAGE").
- `reimbursements/page.tsx` L64-73: `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE, LEDGER_APPROVE])` gates the page, then `canApprove = hasFeature(LEDGER_APPROVE)` and `canRecord = hasFeature(LEDGER_RECORD)` are computed separately and used to conditionally render the Approve/Reject/Pay dialogs per row.

Budgeting should follow this exactly: `canManage = hasFeature(LEDGER_MANAGE)` controls add-line/create-category/remove-line/seed affordances; `canApprove = hasFeature(LEDGER_APPROVE)` controls the Approve/Lock and Unlock affordances; the page itself is reachable by either. Note the *removal* of the page's current doc comment (L27-29 today) explicitly arguing against a view-or-manage split for this page — that comment's premise (only `LEDGER_MANAGE` holders have any reason to be here) is exactly what this feature invalidates, so it should be rewritten, not left stale next to contradicting code.

## Ruling 4 — Category creation placement

**Inline on the budgeting page, scoped to the fund card being edited — not a separate category-management surface.** Rationale:

- Locked decision 5 already scopes the create form to the minimum viable fields (`name`, `flow`, fund kind, `countsAsGiving`, optional `form990Line`, auto `sortOrder`) — this is deliberately not full category CRUD (no edit, no deactivate), which argues against standing up a whole new admin surface for it.
- Fund/fundKind context is already implied by which fund card the treasurer is looking at (Phase 1, Flow 1) — an inline affordance keeps that context free; a separate surface would require re-selecting fund/entity/kind, reintroducing exactly the friction the inline design avoids.
- Endpoint: **new** `POST /api/admin/ledger/categories`, gated `LEDGER_MANAGE`, calling `assertBudgetUnlocked` (Ruling 2) before inserting. This is a new route file, not an addition to the existing `budgets` route — categories and budget-lines are different resources with different validation (uniqueness-by-name-scope vs. amount validation), and keeping them as separate route files matches how `ledgerCategories` and `ledgerBudgets` are already separate tables with separate concerns in `ledger-queries.ts`.
- **Do not over-build:** no category list/edit/deactivate UI in this increment. If a future increment needs full category management (analyst's "Out of Scope" list already names this), it gets its own admin surface then, informed by real usage of this minimal inline form — don't speculatively build the management surface now.

## Ruling 5 — Reuse vs. new endpoints (map)

| Capability | Endpoint | Status |
|---|---|---|
| Create category | `POST /api/admin/ledger/categories` | **New** — gated `LEDGER_MANAGE`, calls `assertBudgetUnlocked` |
| Add a line (existing category) | `PATCH /api/admin/ledger/budgets` | **Existing**, unchanged — already handles this (Flow 2, Phase 1) |
| Add a line (new category) | `POST /categories` then `PATCH /budgets` (two calls from the client, or the categories route can accept an optional inline budget amount and chain internally — tech-lead's call) | Reuses `upsertBudgetLine` core either way |
| Remove a line | `PATCH /api/admin/ledger/budgets` with `annualAmountCents: null` | **Existing**, unchanged — Phase 1 confirms this already works server-side; only the UI affordance (explicit "Remove" button + `ConfirmDialog`) is new, no new route |
| Approve/lock | `POST /api/admin/ledger/budget-approvals` (or `.../budgets/approve` — tech-lead names it) | **New**, gated `LEDGER_APPROVE`, mirrors `transactions/[id]/approve/route.ts`'s board-minute validation almost verbatim |
| Unlock | `POST /api/admin/ledger/budget-approvals/unlock` (or a `PATCH` on the same resource) | **New**, gated `LEDGER_APPROVE`, same validation shape with `unlockReason` in place of `boardMinute` |

The approve/unlock routes should copy `transactions/[id]/approve/route.ts`'s structure closely (session → feature check → fetch current state → status guard → validate body → update), **except** per locked decision 2, do **not** port the self-approval block (`session.user.id === recordedByUserId`) — that check doesn't apply here since there is no "recorder" role distinct from "approver" for a whole-year budget adoption, and Chuck (who plausibly holds both `LEDGER_MANAGE` and `LEDGER_APPROVE`) is the expected common case, not an edge case to defend against.

## Ruling 6 — Invariant compliance checklist

- **Idempotent migration:** new `CREATE TABLE IF NOT EXISTS ledger_budget_approvals`, matching `schema.ts`, plus the `ledger_budget_approvals_entity_year_key` unique constraint guarded the same way other migrations guard indexes/constraints (`DO $$ ... END $$` or `IF NOT EXISTS` on the constraint name). database-admin owns the exact SQL.
- **Gates:** confirmed above (Rulings 2, 3) — `LEDGER_MANAGE` for add/remove/create-category, `LEDGER_APPROVE` for approve/lock/unlock, enforced both at the page level (two-tier) and independently in every route handler (never rely on the page gate alone).
- **Server/client boundary:** `budgeting/page.tsx` stays a Server Component computing `canManage`/`canApprove` and passing them as props; `BudgetEditor`, the new category-create form, and the new approve/unlock controls are Client Components (existing pattern — `BudgetEditor` is already `"use client"`). No violation risk here; flagging only because it's the standing rule.
- **ConfirmDialog:** required for (a) the explicit remove-line control (locked decision 4 — this wipes a stored number), (b) lock/approve (a deliberate, hard-to-undo action even though unlock exists), and (c) unlock (reopens a board-approved budget). None of these may use `window.confirm`.
- **Two-fund discipline:** approve/lock is a metadata flag on `(entityId, fiscalYear)` — it never touches `ledgerTransactions`, never moves money, never crosses fund boundaries. No risk identified.
- **`LEDGER_APPROVE` binding:** already bound to `admin` + `board_member` via `drizzle/migrations/0047_ledger_approve_permission.sql` — no new migration needed for the permission binding itself, only for the new table.

## Ruling 7 — Implementer split

**Confirmed: database-admin → api-developer → ux-developer**, in that order:

1. **database-admin:** `ledgerBudgetApprovals` in `schema.ts`, the idempotent migration (`0062_ledger_budget_approvals.sql` or next available number), and the `assertBudgetUnlocked()` helper in `ledger-queries.ts` (schema-adjacent shared logic, reasonable for database-admin to own alongside the table it reads).
2. **api-developer:** `POST /categories`, the approve and unlock routes, wiring `assertBudgetUnlocked` into `upsertBudgetLine`, and the category-create call site's explicit lock check (Ruling 2).
3. **ux-developer:** inline "+ Add category" affordance per fund card (including the empty-fund case — Phase 1's Gap 2, `guided-budget-setup.tsx` L414 needs a persistent "Add category" element even when `budgetEditorLines.length === 0`), the explicit "Remove line" control with `ConfirmDialog`, the Approve/Lock and Unlock UI with `ConfirmDialog`, and the two-tier gate rework in `budgeting/page.tsx` (Ruling 3).

This is a schema-touching feature per the work-log header's own pipeline-mode note — full specialist split is correct; full-stack-developer would not be appropriate given the new table + multiple new routes + gate rework.

## Suggestions (non-blocking)

1. Tech-lead should decide the exact route path/method for approve and unlock (`POST .../budget-approvals` vs. nesting under `/budgets/`) — I've named a reasonable default in Ruling 5 but this is an implementation-level naming call, not architectural.
2. Confirm the migration number (`0062`) is still free when database-admin actually writes it — other work may land first.
3. Consider whether the create-category response should optionally accept an inline `annualAmountCents` to save the client a second round-trip (Ruling 5) — tech-lead's call, not blocking.

## Open questions / handoff notes for tech-lead

- Exact request/response shapes for the two new approve/unlock routes and the category-create route.
- Whether `POST /categories` chains an initial budget-line upsert in the same request or leaves that to a follow-up `PATCH /budgets` call from the client.
- Confirm the rewritten doc comment in `budgeting/page.tsx` (replacing the now-stale "manage-only" rationale) reads clearly for the next person who touches this file.

---

# Phase 3 — Technical Design (tech-lead)

## Files Read

- `docs/work-log/2026-07-27-ledger-budget-approve.md` (Phases 1–2, full)
- `docs/decisions.md` DECISION-043 (approvals-table shape ruling)
- `src/lib/db/schema.ts` L501-797 (`ledgerEntities`, `ledgerFunds`, `ledgerCategories`, `ledgerBudgets`) and L960-981 (`ledgerReimbursements` current-state approval-trio precedent)
- `src/lib/ledger-queries.ts` L558-720 (`upsertBudgetLine`, `DrizzleTransaction` type), L237-253 (`getCategories`), L1436-1495 (`getPendingApprovals` — `leftJoin(users)` display-name pattern)
- `src/lib/ledger.ts` L996-1230 (`computeBudgetBalanceStatus`, `validateBudgetLineInput`, `decideSeedWriteAction` — the established "extract a pure, DB-free function so it's unit-testable" convention)
- `src/lib/ledger.test.ts` (test file conventions — flat `describe`/`it` per pure function, no DB mocking)
- `src/app/api/admin/ledger/budgets/route.ts` (PATCH — existing add/remove-line contract, unchanged)
- `src/app/api/admin/ledger/budgets/seed/route.ts` (confirms every write loops through `upsertBudgetLine` inside one `db.transaction()`)
- `src/app/api/admin/ledger/transactions/[id]/approve/route.ts` (approve-route structure to mirror, minus the self-approval block)
- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` (current single-gate Server Component)
- `src/components/admin/ledger/guided-budget-setup.tsx` L413-423 (confirmed: `BudgetEditor` — and therefore the only place a category row can currently appear — is gated on `fund.budgetEditorLines.length > 0`; a zero-category fund renders no editor and today has no other affordance)
- `src/components/admin/ledger/budget-editor.tsx` (blank-to-delete UX, `onInputChange` callback)
- `src/app/(dashboard)/admin/ledger/reimbursements/page.tsx` L56-73 (two-tier gate precedent to copy: `hasAnyFeature` for admission, separate `canApprove`/`canRecord` booleans)
- `drizzle/migrations/` listing — latest on disk is `0061_members_membership_status.sql`; `0062` confirmed free

## Summary

Two additions to the existing Guided Budgeting surface (`/admin/ledger/budgeting`), both scoped exactly per the locked decisions and architect rulings: (A) creating a genuinely new budget category inline, plus an explicit remove-line control, both funneling through the existing `upsertBudgetLine` core; and (B) a new `ledgerBudgetApprovals` table recording lock/unlock state per `(entityId, fiscalYear)`, enforced by a single `assertBudgetUnlocked()` guard called from inside `upsertBudgetLine` and explicitly from the new category-create route. No new `FEATURES` key — `LEDGER_MANAGE` gates add/remove/create-category, `LEDGER_APPROVE` gates approve/lock/unlock, exactly as scoped in Phase 1/2.

### Key invariant — budget buckets ARE ledger buckets

"Add a line" creates or reuses a real `ledgerCategories` row via `POST /categories`; there is deliberately **no budget-only bucket type**. This is load-bearing: budget-vs-actual measurement (`getFundReport`) matches actual transactions to budget targets by `categoryId`, so a budget bucket that did not exist as a ledger category could never be compared against actuals. Any future change must preserve this — a budget line must always resolve to a category the ledger also records transactions against. A category created here becomes available for transaction entry everywhere (intended: you budget for a new initiative, then spending lands in the same bucket and the report lines up).

## Data Model

New table, `src/lib/db/schema.ts`, placed directly after `ledgerBudgets` (L797):

```typescript
// Budget approve/lock state — one row per (entityId, fiscalYear), unique-
// constrained on that pair. Single status-flip row (DECISION-043), NOT an
// event log: locking sets the approval trio + status='locked'; unlocking
// sets the unlock trio + status='unlocked'. Neither clears the other, so
// the most recent lock and most recent unlock are both visible at once.
export const ledgerBudgetApprovals = pgTable(
  "ledger_budget_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => ledgerEntities.id, { onDelete: "cascade" }),
    fiscalYear: integer("fiscal_year").notNull(), // start year, e.g. 2026 = FY2026 — same convention as ledgerBudgets.fiscalYear (L782)
    // App-layer valid values: 'locked' | 'unlocked'. No DB CHECK constraint —
    // consistent with ledger_transactions.status / ledger_reimbursements.status
    // (DECISION-041 precedent: enforce in application code, not a DB object
    // schema.ts has no builder for).
    status: text("status").notNull().default("unlocked"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at"),
    boardMinute: text("board_minute"),
    unlockedByUserId: uuid("unlocked_by_user_id").references(() => users.id, { onDelete: "set null" }),
    unlockedAt: timestamp("unlocked_at"),
    unlockReason: text("unlock_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("ledger_budget_approvals_entity_year_key").on(t.entityId, t.fiscalYear),
    index("ix_ledger_budget_approvals_entity").on(t.entityId),
  ],
);

export type LedgerBudgetApproval = typeof ledgerBudgetApprovals.$inferSelect;
export type NewLedgerBudgetApproval = typeof ledgerBudgetApprovals.$inferInsert;
```

No changes to `ledgerBudgets` or `ledgerCategories` — both already carry every column this feature needs (`ledgerCategories` already has `countsAsGiving`, `form990Line`, `sortOrder`, `isActive`; `ledgerBudgets` already supports delete-by-null-amount).

### Migration `drizzle/migrations/0062_ledger_budget_approvals.sql`

```sql
-- Budget approve/lock state (DECISION-043). One row per (entity_id, fiscal_year).
CREATE TABLE IF NOT EXISTS ledger_budget_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES ledger_entities(id) ON DELETE CASCADE,
  fiscal_year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'unlocked',
  approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMP,
  board_minute TEXT,
  unlocked_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  unlocked_at TIMESTAMP,
  unlock_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ledger_budget_approvals_entity_year_key'
  ) THEN
    ALTER TABLE ledger_budget_approvals
      ADD CONSTRAINT ledger_budget_approvals_entity_year_key UNIQUE (entity_id, fiscal_year);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_ledger_budget_approvals_entity ON ledger_budget_approvals (entity_id);
```

Every statement is idempotent (`IF NOT EXISTS` on the table and index; guarded `DO $$` block for the named unique constraint — `CREATE TABLE ... UNIQUE(...)` inline isn't idempotent-safe across re-runs the way a guarded `ADD CONSTRAINT` is, matching the pattern other migrations already use for named constraints). No CHECK constraint on `status`, matching DECISION-041's precedent.

## Lock Helper + Enforcement

`src/lib/ledger-queries.ts` (database-admin owns this alongside the table):

```typescript
export type LockCheckResult = { ok: true } | { ok: false; error: string; status: 409 };

/**
 * Every write touching ledger_budgets or ledger_categories for a given
 * (entityId, fiscalYear) must reject when that pair is locked. Called from
 * inside upsertBudgetLine (covers PATCH /budgets, POST /budgets/seed, and the
 * add-line path for free) and explicitly from POST /categories (category
 * creation doesn't go through upsertBudgetLine — architect Ruling 2).
 */
export async function assertBudgetUnlocked(
  entityId: string,
  fiscalYear: number,
  tx: DrizzleTransaction | typeof db = db,
): Promise<LockCheckResult> {
  const rows = await tx
    .select({ status: ledgerBudgetApprovals.status })
    .from(ledgerBudgetApprovals)
    .where(
      and(
        eq(ledgerBudgetApprovals.entityId, entityId),
        eq(ledgerBudgetApprovals.fiscalYear, fiscalYear),
      ),
    )
    .limit(1);
  if (isBudgetLocked(rows[0] ?? null)) {
    return {
      ok: false,
      error: "This budget is locked. Unlock it to make changes.",
      status: 409,
    };
  }
  return { ok: true };
}

export async function getBudgetApproval(
  entityId: string,
  fiscalYear: number,
): Promise<
  (LedgerBudgetApproval & { approvedByName: string | null; unlockedByName: string | null }) | null
> {
  const approvedByUser = alias(users, "approvedByUser");
  const unlockedByUser = alias(users, "unlockedByUser");
  const rows = await db
    .select({
      ...getTableColumns(ledgerBudgetApprovals),
      approvedByName: approvedByUser.name,
      unlockedByName: unlockedByUser.name,
    })
    .from(ledgerBudgetApprovals)
    .leftJoin(approvedByUser, eq(ledgerBudgetApprovals.approvedByUserId, approvedByUser.id))
    .leftJoin(unlockedByUser, eq(ledgerBudgetApprovals.unlockedByUserId, unlockedByUser.id))
    .where(
      and(
        eq(ledgerBudgetApprovals.entityId, entityId),
        eq(ledgerBudgetApprovals.fiscalYear, fiscalYear),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
```

`isBudgetLocked()` (new pure helper, `src/lib/ledger.ts`, next to `validateBudgetLineInput`):

```typescript
export function isBudgetLocked(approval: { status: string } | null | undefined): boolean {
  return approval?.status === "locked";
}
```

This is the single source of truth for "is this budget locked" — used by `assertBudgetUnlocked` (server enforcement) **and** by `budgeting/page.tsx` (deciding read-only rendering), so the page can never disagree with the write-side guard about lock state.

**Call sites:**
1. `upsertBudgetLine` (`ledger-queries.ts` L611) — after `validateBudgetLineInput` passes (so a bad fundId/categoryId/amount still returns its existing 400/404 first) and *before* the delete/insert branch, call `const lock = await assertBudgetUnlocked(fund.entityId, fiscalYear, tx); if (!lock.ok) return lock;`. This one call site covers `PATCH /budgets` (existing add-existing-category + remove-line), `POST /budgets/seed` (loops calls to `upsertBudgetLine` inside its own `db.transaction()` — confirmed by reading the route, no changes needed there), and the add-line-after-create-category client flow, since all three already funnel through this function. `UpsertBudgetLineResult`'s type gains `status: 400 | 404 | 409` to accommodate the new branch.
2. `POST /api/admin/ledger/categories` — explicit call to `assertBudgetUnlocked(entityId, fiscalYear, undefined)` after basic shape validation, before the uniqueness check and insert. `fiscalYear` travels in the request body purely to drive this check (not persisted on `ledgerCategories`, which has no FY column).

**Error/HTTP shape:** `409 { error: "This budget is locked. Unlock it to make changes." }` — identical string both call sites use, matching the copy Phase 1 already specified for this exact failure.

**Read side:** `budgeting/page.tsx` calls `getBudgetApproval(entity.id, targetFY)` directly (Server Component, no new GET route — DECISION-044) and passes `locked = isBudgetLocked(approval)` plus the full `approval` row (for the "Locked — approved by {name} on {date}, board minute {ref}" banner) down to `GuidedBudgetSetup`.

## API Contracts

### `POST /api/admin/ledger/categories` (new; gate: `LEDGER_MANAGE`)

```
Body:
{
  entityId: string;
  fiscalYear: number;       // 2000-2100; used only for the lock check, not persisted
  fundKind: 'administrative' | 'activity' | 'charitable' | 'scholarship';
  flow: 'income' | 'expense';
  name: string;             // required, trimmed, non-empty
  countsAsGiving?: boolean; // default true (matches schema default)
  form990Line?: string;     // optional, trimmed
}

Response 200: { id, name, fundKind, flow, sortOrder, countsAsGiving, form990Line, isActive: true }
```

Validation order: session → `hasFeature(LEDGER_MANAGE)` → shape checks (entityId/fiscalYear/fundKind/flow present and well-typed; `fundKind` must match an existing active fund of that kind for the entity, via `getFunds(entityId)` — rejects a `fundKind` string that doesn't correspond to any real fund, since the UI only ever offers the kind of the fund card the treasurer is looking at) → `assertBudgetUnlocked(entityId, fiscalYear)` (409 if locked) → fetch `getCategories(entityId, { fundKind, flow })` for (a) the case-insensitive duplicate-name check and (b) `sortOrder` assignment → insert.

- **Duplicate name:** 409 `{ error: "A category named '…' already exists for this fund." }` — case-insensitive compare against the fetched active categories, matching Phase 1 Flow 1's specified microcopy exactly.
- **`sortOrder`:** `nextCategorySortOrder(existing.map(c => c.sortOrder))` = `max + 1`, or `0` if the fund+flow has no categories yet.
- Per DECISION-044, this endpoint never accepts an amount — the category is created bare and appears as an empty-amount row in `BudgetEditor`; the treasurer's next keystroke goes through the existing `PATCH /budgets` unchanged.

### `POST /api/admin/ledger/budget-approvals` (new; gate: `LEDGER_APPROVE`) — approve/lock

```
Body: { entityId: string; fiscalYear: number; boardMinute: string; }
Response 200: { entityId, fiscalYear, status: 'locked', approvedByUserId, approvedAt, boardMinute }
```

Mirrors `transactions/[id]/approve/route.ts`'s structure (session → feature check → fetch current state → status guard → validate body → write) **without** the self-approval block (locked decision — budget adoption is a board vote about a plan, not a disbursement one person moves).

- 400 — `fiscalYear` out of `[2000, 2100]`, or `boardMinute` missing/blank after trim (reuses the shared `validateRequiredTrimmedText` helper below; matches existing "boardMinute is required" 400 microcopy).
- 404 — `entityId` doesn't resolve via `getEntityById`.
- 409 — current row (via `getBudgetApproval`) already has `status: 'locked'` → `{ error: "This budget is already locked. Unlock it to make changes and re-approve." }` (DECISION-044 — forces the explicit unlock step rather than silently overwriting the approval trio).
- Write: `insert(ledgerBudgetApprovals).values({ entityId, fiscalYear, status: 'locked', approvedByUserId: session.user.id, approvedAt: new Date(), boardMinute, updatedAt: new Date() }).onConflictDoUpdate({ target: [entityId, fiscalYear], set: { status: 'locked', approvedByUserId, approvedAt, boardMinute, updatedAt } })` — the unlock trio is left untouched by this write (DECISION-043: neither action clears the other).

### `POST /api/admin/ledger/budget-approvals/unlock` (new; gate: `LEDGER_APPROVE`)

```
Body: { entityId: string; fiscalYear: number; unlockReason: string; }
Response 200: { entityId, fiscalYear, status: 'unlocked', unlockedByUserId, unlockedAt, unlockReason }
```

- 400 — `unlockReason` missing/blank after trim.
- 404 — `entityId` not found.
- 409 — no `ledgerBudgetApprovals` row exists yet, or existing `status !== 'locked'` → `{ error: "This budget is not currently locked." }` (can't unlock something never approved).
- Write: `onConflictDoUpdate` setting `status: 'unlocked', unlockedByUserId: session.user.id, unlockedAt: new Date(), unlockReason, updatedAt: new Date()` — approval trio untouched.

### `PATCH /api/admin/ledger/budgets` and `POST /api/admin/ledger/budgets/seed` — unchanged contracts

Both already funnel every write through `upsertBudgetLine`, so both inherit `assertBudgetUnlocked` for free with **no request/response shape change** — only a new possible `409` in the existing error-handling branch (`if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })`, PATCH route L82-84, already generic over `result.status`). Verified: the seed route's per-line loop (L178-188) calls `upsertBudgetLine(..., tx)` inside its `db.transaction()`, so a lock check that fires mid-loop rolls back the whole seed atomically — no partial-seed-then-reject state is possible.

## Component Plan

**`src/app/(dashboard)/admin/ledger/budgeting/page.tsx`** (rework, Ruling 3):
- Gate: `hasAnyFeature([LEDGER_MANAGE, LEDGER_APPROVE])` for admission (redirect `/access-pending` otherwise); `canManage = hasFeature(LEDGER_MANAGE)`, `canApprove = hasFeature(LEDGER_APPROVE)` computed separately and passed as props.
- Replace the stale "manage-only, no view-or-manage fallback" doc comment (L27-29) — its premise is exactly what this feature invalidates.
- Fetch `approval = await getBudgetApproval(entity.id, targetFY)`; pass `locked = isBudgetLocked(approval)` and `approval` down.

**`GuidedBudgetSetup`** (`src/components/admin/ledger/guided-budget-setup.tsx`, extend):
- New props: `canManage: boolean`, `canApprove: boolean`, `locked: boolean`, `approval: { approvedByName, approvedAt, boardMinute, unlockedByName, unlockedAt, unlockReason } | null`.
- **Locked-state banner:** shown whenever `locked` — "Locked — approved by {approvedByName ?? 'Unknown'} on {approvedAt formatted}, board minute: {boardMinute}." Uses the existing `bg-lions-gold/10` informational tone already used elsewhere on this page (`balanceBadgeClass("info")`), not a warning color.
- **Read-only rendering when `locked`:** hide "Seed all funds" / "Seed this fund" / "Overwrite…" buttons, hide the new "+ Add category" affordance and the new remove-line control, and pass a `disabled` prop through to `BudgetEditor` (new optional prop — when true, every input renders `disabled` and the component skips its `PATCH` call entirely; this is UI-only defense-in-depth, the 409 from the server is the actual enforcement per architect Ruling 2).
- **"+ Add category" control**, rendered per fund card whenever `canManage && !locked`, **outside** the `fund.budgetEditorLines.length > 0` conditional (fixes the empty-fund gap — a fund with zero categories today renders no `BudgetEditor` at all and therefore has no way to ever get a first line). Two-step UI: a `<select>` of the fund's *unbudgeted* active categories (categories from `getCategories(entityId, { fundKind, flow })` not already present in `budgetEditorLines`, computed server-side and passed down per fund/flow) with an "Add" button that calls `PATCH /budgets` directly (Flow 2 — already works, zero new backend), plus a "+ New category…" link that expands an inline form (name input, flow already fixed to the section it's rendered under, submit → `POST /categories` → on success, `router.refresh()` so the new bare category appears as a fresh `BudgetEditor` row).
- **Explicit remove control:** a trash-icon button per `BudgetEditor` row (income and expense sections), shown whenever `canManage && !locked`. Opens `<ConfirmDialog title="Remove this budget line?" description="This removes the {$amount} target for {category name}. The category and any recorded activity are not affected." confirmLabel="Remove" destructive onConfirm={...} />`, confirming calls the existing `PATCH /budgets` with `annualAmountCents: null` (no new endpoint — Ruling 5). This requires `BudgetEditor` to accept an optional `onRemove?: (categoryId, flow) => void` prop (or the remove button lives in the parent, next to each rendered line, reusing `BudgetEditor`'s existing `lines` prop to know what to render) — ux-developer's call on exact prop wiring, but must not duplicate `BudgetEditor`'s own commit logic.
- **Approve panel**, shown whenever `canApprove` (independent of `canManage`, satisfying the Phase 1 gap about `LEDGER_APPROVE`-only board members): a board-minute text input + "Approve & Lock" button opening `<ConfirmDialog destructive={false} title="Lock FY{targetFY} budget?" description="..." onConfirm={...} />` calling `POST /budget-approvals`. Displays every fund's current `computeBudgetBalanceStatus` badge (already computed per-fund in this component) as a pre-lock summary, purely advisory — never disables the Approve button (locked decision: warn-not-block).
- **Unlock control**, shown whenever `canApprove && locked`: a reason textarea + `<ConfirmDialog destructive title="Unlock FY{targetFY} budget?" ... onConfirm={...} />` calling `POST /budget-approvals/unlock`.
- Reuses the existing `formatDollars`, `computeBudgetBalanceStatus`, `ConfirmDialog`, `BudgetEditor` — no new formatting helper needed.

**Brand/UX compliance:** all new cards `bg-white rounded-2xl shadow-sm overflow-hidden` (informational, non-interactive shells) matching the existing fund cards on this page; buttons `rounded-lg` (primary `bg-lions-blue` / secondary outlined) per the existing seed buttons already on this component; no `window.confirm`/`alert`/`prompt` anywhere — every destructive or hard-to-undo action (remove line, lock, unlock) goes through `ConfirmDialog`; locked-state banner uses `lions-gold`-tinted informational styling, never `lions-red` (undefined in theme).

## Edge Cases & Risks

- **Locking an empty or partial budget:** allowed. No minimum-line-count check anywhere in the approve route — matches the locked "warns, does not block" decision and Phase 1's confirmed reading of `computeBudgetBalanceStatus` as presentation-only.
- **Duplicate category name:** rejected 409 at `POST /categories`, case-insensitive, scoped to `(entityId, fundKind, flow)` — matches Phase 1 Flow 1 microcopy.
- **Removing a line whose category has recorded actuals:** allowed unchanged — the remove only deletes the `ledgerBudgets` row; `ledgerCategories` and every `ledgerTransactions` row referencing that `categoryId` are untouched and still appear on reports (report queries read actuals from `ledgerTransactions`, budget targets from `ledgerBudgets` — independent tables, confirmed by `getFundReport`'s existing separate joins).
- **Empty-fund case:** fixed per Component Plan above — "+ Add category" now renders unconditionally (when `canManage && !locked`), not nested inside `budgetEditorLines.length > 0`. A brand-new fund with zero categories can get its first line.
- **Locking then attempting any write:** every write path returns `409` from `assertBudgetUnlocked` — verified covered for `PATCH /budgets`, `POST /budgets/seed` (via `upsertBudgetLine`), and `POST /categories` (explicit call). No path bypasses this.
- **Unlock without reason:** 400, rejected by `validateRequiredTrimmedText`.
- **FY rollover:** no special handling needed — `getBudgetApproval` returns `null` for a `(entityId, fiscalYear)` pair with no row, and `isBudgetLocked(null)` is `false`, so next year's budget starts unlocked by default with zero migration/backfill needed.
- **Concurrent lock + edit (race):** a `PATCH /budgets` and a `POST /budget-approvals` landing in the same instant could both read "unlocked" before either commits, since `assertBudgetUnlocked`'s read and the eventual write aren't wrapped in a single serializable transaction across the two separate requests. Accepted risk given this action's cadence (Phase 1: "once per fiscal year per entity, normally") — matches the existing seed endpoint's precedent of using `db.transaction()` only to make *its own* multi-line write atomic, not to serialize against every other endpoint. If this becomes a real incident, the fix is a `SELECT ... FOR UPDATE` on the approval row inside a transaction — not something to build speculatively now.

## Unit Tests (implementer delivers in Phase 4, `src/lib/ledger.test.ts`)

Every piece of new logic worth testing is DB-free per the established convention (`validateBudgetLineInput`, `decideSeedWriteAction`) — three new pure helpers extracted specifically for testability, plus one existing pattern reused:

1. **`isBudgetLocked`** — new `describe("isBudgetLocked")`:
   - `it("returns false when no approval row exists (null)")` — `isBudgetLocked(null)` → `false`.
   - `it("returns false when status is 'unlocked'")` → `isBudgetLocked({ status: "unlocked" })` → `false`.
   - `it("returns true when status is 'locked'")` → `isBudgetLocked({ status: "locked" })` → `true`.

2. **`validateCategoryCreateInput`** (new pure helper, `src/lib/ledger.ts`, factoring the shape/uniqueness checks the `POST /categories` route needs so they're testable without a DB) — `describe("validateCategoryCreateInput")`:
   - `it("rejects an empty name")` — `name: ""` → `{ ok: false, status: 400 }`.
   - `it("rejects a whitespace-only name")` — `name: "   "` → `{ ok: false, status: 400 }`.
   - `it("rejects flow values other than income/expense")` → `{ ok: false, status: 400 }`.
   - `it("rejects a case-insensitive duplicate name against existingNames")` — `name: "Club Dues"`, `existingNames: ["club dues"]` → `{ ok: false, status: 409 }`.
   - `it("accepts a valid, unique name")` → `{ ok: true }`.

3. **`nextCategorySortOrder`** (new pure helper) — `describe("nextCategorySortOrder")`:
   - `it("returns 0 for an empty fund+flow (first category)")` — `nextCategorySortOrder([])` → `0`.
   - `it("returns max + 1 for existing sortOrders")` — `nextCategorySortOrder([0, 2, 5])` → `6`.
   - `it("handles a single existing category")` — `nextCategorySortOrder([3])` → `4`.

4. **`validateRequiredTrimmedText`** (new small shared pure helper replacing the inline trim/length checks the transactions-approve route already duplicates ad hoc — reused by both the new approve route's `boardMinute` and the new unlock route's `unlockReason`) — `describe("validateRequiredTrimmedText")`:
   - `it("rejects undefined")` → `{ ok: false }`.
   - `it("rejects an empty string")` → `{ ok: false }`.
   - `it("rejects a whitespace-only string")` → `{ ok: false }`.
   - `it("trims and accepts a valid string")` — `"  Board voted 5-0  "` → `{ ok: true, value: "Board voted 5-0" }`.
   - `it("truncates (does not reject) a string longer than maxLen")` — matches the existing `transactions/[id]/approve` convention of `slice(0, BOARD_MINUTE_MAX_LEN)` rather than rejecting an over-length board minute.

The approve/unlock routes' actual DB writes (the `onConflictDoUpdate` upsert, the 404/409 status-lookup branches) are integration-shaped, not unit-tested here — consistent with this codebase's standing convention that Vitest covers pure functions only; qa's Phase 5 manual click-through covers the end-to-end approve/unlock/re-lock flow.

## Implementation Order

1. **database-admin:** Add `ledgerBudgetApprovals` to `src/lib/db/schema.ts` (placed after `ledgerBudgets`, per Data Model above); write `drizzle/migrations/0062_ledger_budget_approvals.sql`; add `assertBudgetUnlocked()` and `getBudgetApproval()` to `src/lib/ledger-queries.ts`; add `isBudgetLocked()`, `validateCategoryCreateInput()`, `nextCategorySortOrder()`, `validateRequiredTrimmedText()` to `src/lib/ledger.ts`. Run `pnpm db:migrate` locally against `.env.local` and confirm the table exists.
2. **api-developer:** Wire `assertBudgetUnlocked` into `upsertBudgetLine` (the one call site covering PATCH + seed + add-line); build `POST /api/admin/ledger/categories/route.ts`; build `POST /api/admin/ledger/budget-approvals/route.ts` (approve) and `POST /api/admin/ledger/budget-approvals/unlock/route.ts` (unlock), both per the API Contracts section, both without a self-approval block. Write the four unit-test groups named above.
3. **ux-developer:** Rework `budgeting/page.tsx`'s gate to two-tier (`canManage`/`canApprove`) and wire `getBudgetApproval`/`isBudgetLocked`; extend `GuidedBudgetSetup` with the locked-state banner, read-only rendering, "+ Add category" (fixing the empty-fund case), the explicit remove-line control, the Approve panel, and the Unlock control — all per Component Plan above, all `ConfirmDialog`-gated where destructive/hard-to-undo.

## Notable Design Calls Logged

- **DECISION-044** (`docs/decisions.md`): route names (`/budget-approvals`, `/budget-approvals/unlock`), no chained category+amount write on `POST /categories`, lock state read via `getBudgetApproval()` direct query rather than a new GET route, and re-approving an already-locked FY returns 409 instead of silently overwriting the prior approval.

## Open questions / handoff notes

- **Implementer: database-admin first**, then **api-developer**, then **ux-developer** — per Implementation Order above. This is schema-touching (new table) with a real new API surface and a page-gate rework, so the specialist split applies, not full-stack-developer.
- `BudgetEditor`'s exact prop shape for the new remove control is left to ux-developer's judgment (Component Plan flags the tradeoff: extend `BudgetEditor` itself vs. render the trash button in the parent alongside it) — either is fine as long as it doesn't duplicate `BudgetEditor`'s existing commit-on-blur logic.
- qa (Phase 5): the manual click-through must cover the full lock/unlock cycle — lock with a partial budget (confirm it's allowed with only a warning badge), attempt a `PATCH /budgets` against a locked FY via a stale tab (confirm 409, not a silent no-op), unlock, re-edit, re-lock — plus a `LEDGER_APPROVE`-only test account confirming they can reach the page and see the Approve panel without holding `LEDGER_MANAGE`.

---

# Phase 4 — Implementation

## Phase 4 — database-admin (schema) — 2026-07-27

**Owner:** database-admin
**Status:** complete

### Summary

Added `ledgerBudgetApprovals` exactly per the Phase 3 Data Model / DECISION-043 / DECISION-044, wrote the idempotent migration, added `assertBudgetUnlocked()` + `getBudgetApproval()` to `ledger-queries.ts`, wired the lock guard into `upsertBudgetLine` (covering PATCH /budgets, POST /budgets/seed, and the future add-line path for free), and added the four pure helpers the design assigned to this step in `ledger.ts`. Typecheck is clean and all 516 existing Vitest tests stay green (no new tests written here — Phase 3 assigns the four new `describe` blocks to api-developer).

### What I did

- Added `ledgerBudgetApprovals` table to `src/lib/db/schema.ts`, placed directly after `ledgerBudgets` (matching the Data Model section verbatim): `id`, `entityId` (FK → `ledgerEntities`, cascade), `fiscalYear`, `status` (text, default `'unlocked'`, no CHECK constraint per DECISION-041), approval trio (`approvedByUserId` FK → `users` set-null, `approvedAt`, `boardMinute`), unlock trio (`unlockedByUserId` FK → `users` set-null, `unlockedAt`, `unlockReason`), `createdAt`/`updatedAt`. Unique constraint on `(entityId, fiscalYear)` named `ledger_budget_approvals_entity_year_key`, plus `ix_ledger_budget_approvals_entity` index on `entityId`. Exported `LedgerBudgetApproval` / `NewLedgerBudgetApproval` types.
- Wrote `drizzle/migrations/0062_ledger_budget_approvals.sql` — confirmed `0062` was still the next free number (`0061_members_membership_status.sql` was latest on disk). `CREATE TABLE IF NOT EXISTS`, a guarded `DO $$ ... END $$` block checking `pg_constraint` before `ADD CONSTRAINT` for the named unique constraint, and `CREATE INDEX IF NOT EXISTS`. Every statement is safe to re-run on every deploy.
- Added to `src/lib/ledger-queries.ts`:
  - `assertBudgetUnlocked(entityId: string, fiscalYear: number, tx: DrizzleTransaction | typeof db = db): Promise<LockCheckResult>` where `LockCheckResult = { ok: true } | { ok: false; error: string; status: 409 }`. Accepts the same optional tx handle convention as `upsertBudgetLine`.
  - `getBudgetApproval(entityId: string, fiscalYear: number): Promise<BudgetApprovalWithNames | null>` — left-joins `users` twice (aliased `approvedByUser`/`unlockedByUser`) for `approvedByName`/`unlockedByName`, returns `null` when no row exists.
  - Wired `assertBudgetUnlocked` into `upsertBudgetLine`: the call happens after `validateBudgetLineInput` passes (so a bad fundId/categoryId/amount still returns its existing 400/404 first) and before the delete/insert branch. Widened `UpsertBudgetLineResult`'s status union from `400 | 404` to `400 | 404 | 409`.
  - Added imports: `ledgerBudgetApprovals`/`LedgerBudgetApproval` from `@/lib/db/schema`, `getTableColumns` from `drizzle-orm`, `alias` from `drizzle-orm/pg-core`, `isBudgetLocked` from `@/lib/ledger`.
- Added four pure helpers to `src/lib/ledger.ts` (after `decideSeedWriteAction`, matching the file's section-header convention):
  - `isBudgetLocked(approval: { status: string } | null | undefined): boolean` — `approval?.status === "locked"`.
  - `nextCategorySortOrder(existingSortOrders: number[]): number` — `0` for empty, else `max + 1`.
  - `validateCategoryCreateInput(input: { name: string; flow: string; existingNames: string[] }): { ok: true } | { ok: false; error: string; status: 400 | 409 }` — empty/whitespace name → 400 "Category name is required."; `flow` not `income`/`expense` → 400; case-insensitive duplicate against `existingNames` → 409 "A category named '…' already exists for this fund."
  - `validateRequiredTrimmedText(value: string | null | undefined, maxLen: number = 500): { ok: true; value: string } | { ok: false }` — rejects null/undefined/empty/whitespace-only; trims and truncates (does not reject) text longer than `maxLen`, matching `transactions/[id]/approve/route.ts`'s existing `slice(0, BOARD_MINUTE_MAX_LEN)` convention.
- Confirmed by reading `src/app/api/admin/ledger/budgets/seed/route.ts` that its per-line loop (`upsertBudgetLine(..., tx)` inside `db.transaction()`) already funnels through the guarded function.
- Ran `pnpm exec tsc --noEmit` (clean) and `pnpm test` (516/516 passed, 17 test files) after all changes.

### Outputs

- `src/lib/db/schema.ts` — new `ledgerBudgetApprovals` table + `LedgerBudgetApproval`/`NewLedgerBudgetApproval` types, placed after `ledgerBudgets`.
- `drizzle/migrations/0062_ledger_budget_approvals.sql` — new migration, every statement idempotent (`CREATE TABLE IF NOT EXISTS`, guarded `DO $$` block for the named unique constraint via `pg_constraint` lookup, `CREATE INDEX IF NOT EXISTS`).
- `src/lib/ledger-queries.ts` — `assertBudgetUnlocked()`, `getBudgetApproval()` (+ `LockCheckResult`, `BudgetApprovalWithNames` types), `upsertBudgetLine` now calls the lock guard and its result type includes `409`.
- `src/lib/ledger.ts` — `isBudgetLocked()`, `nextCategorySortOrder()`, `validateCategoryCreateInput()` (+ `CategoryCreateValidationInput`/`Result` types), `validateRequiredTrimmedText()` (+ `RequiredTrimmedTextResult` type).
- No new role bindings/seed rows needed — `LEDGER_MANAGE`/`LEDGER_APPROVE` already exist and are already bound (migration `0047`); this migration only creates the new table.
- Local apply command (not run here — no `DATABASE_URL` in this environment): `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate && pnpm db:push`.

### Open questions / handoff notes

- **Next agent: api-developer**, per Phase 3 Implementation Order step 2.
- **New table available:** `ledgerBudgetApprovals` (`ledger_budget_approvals`) — one row per `(entityId, fiscalYear)`, unique on that pair. FK `entityId → ledgerEntities.id` (cascade delete). No FK/column changes to `ledgerBudgets` or `ledgerCategories` — the "budget buckets ARE ledger buckets" invariant is untouched; category creation still must go through a real `ledgerCategories` row (api-developer's `POST /categories` route).
- **Helpers ready to consume:** `assertBudgetUnlocked(entityId, fiscalYear, tx?)` and `getBudgetApproval(entityId, fiscalYear)` in `ledger-queries.ts`; `isBudgetLocked`, `nextCategorySortOrder`, `validateCategoryCreateInput`, `validateRequiredTrimmedText` in `ledger.ts`. `upsertBudgetLine` already enforces the lock — PATCH /budgets inherits the 409 automatically since it already does generic `if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })`.
- **Gap found, not mine to fix — flagging for api-developer:** `src/app/api/admin/ledger/budgets/seed/route.ts`'s per-line loop (~L178-188) calls `await upsertBudgetLine(..., tx)` and **discards the return value entirely** — no `.ok` check anywhere in that file today (confirmed by grep). Now that `upsertBudgetLine` can return `{ ok: false, status: 409 }` when the FY is locked, seeding a locked budget will silently "succeed" with a 200 response and fake `seededCount`/`overwrittenCount` numbers, while zero rows are actually written. The transaction itself stays consistent (no partial writes — Phase 3's atomicity claim holds), but the response lies to the caller. api-developer should add a `result.ok` check inside the loop that aborts the transaction (throw, so `db.transaction()` rolls back) and returns 409 with the shared error string, mirroring the PATCH route's existing pattern.
- **Explicit lock call site still needed:** `POST /api/admin/ledger/categories` (new route, api-developer's to build) must call `assertBudgetUnlocked(entityId, fiscalYear)` explicitly before the uniqueness check/insert — category creation doesn't route through `upsertBudgetLine`, so it isn't covered by the wiring above (Phase 3 Data Model / Ruling 2).
- **`validateRequiredTrimmedText` maxLen:** left as a parameter (default 500, matching `BOARD_MINUTE_MAX_LEN`) rather than hardcoded, so the unlock route can pass a different cap for `unlockReason` if api-developer/tech-lead wants one; otherwise the default applies to both call sites.
- Did not run `pnpm db:migrate` / `pnpm db:push` against a live DB — no `DATABASE_URL` available in this environment. api-developer (or whoever has `.env.local`) should run the local apply command above before/while building the routes, so `getBudgetApproval`/`assertBudgetUnlocked` have a real table to query against during manual testing.

---

## Phase 4 — api-developer (server) — 2026-07-27

**Owner:** api-developer
**Status:** complete

### Summary

Built the three new route handlers named in the Phase 3 design exactly per the API Contracts section — `POST /categories`, `POST /budget-approvals` (approve/lock), `POST /budget-approvals/unlock` — all consuming database-admin's `assertBudgetUnlocked`/`getBudgetApproval` and the four pure helpers without modification. Fixed the flagged critical bug in the seed route (discarded `upsertBudgetLine` result masking a locked-FY 409 as a fake 200). Delivered all four named `describe` blocks in `src/lib/ledger.test.ts` (16 new tests). Typecheck and full test suite are green.

### What I did

- **`src/app/api/admin/ledger/categories/route.ts`** (new) — `POST`, gate `LEDGER_MANAGE`. Validation order matches the design exactly: session → `hasFeature(LEDGER_MANAGE)` → shape checks (entityId/fiscalYear/fundKind/flow/countsAsGiving/form990Line) → `getEntityById` (404) → `fundKind` must match an active fund of that kind for the entity via `getFunds(entityId)` (400 if not) → `assertBudgetUnlocked(entityId, fiscalYear)` (409 if locked) → `getCategories(entityId, {fundKind, flow})` feeds both the case-insensitive duplicate check and `nextCategorySortOrder` → insert a real `ledgerCategories` row (`isActive: true`, `countsAsGiving` defaults `true`, `form990Line` optional). Per DECISION-044, never accepts or writes an amount — this is the only new category-creation path in the app, preserving "budget buckets ARE ledger buckets."
- **`src/app/api/admin/ledger/budget-approvals/route.ts`** (new) — `POST`, gate `LEDGER_APPROVE`. Validates `entityId`/`fiscalYear`/`boardMinute` (via the shared `validateRequiredTrimmedText`), 404s on unknown entity, then reads current state via `getBudgetApproval` — if already `locked` (via `isBudgetLocked`), returns 409 "This budget is already locked. Unlock it to make changes and re-approve." per DECISION-044 (no silent overwrite). Otherwise `insert(...).onConflictDoUpdate({ target: [entityId, fiscalYear], set: {...} })` sets `status: 'locked'` + the approval trio (`approvedByUserId` = current session user, `approvedAt`, `boardMinute`); the unlock trio is untouched. **No self-approval block**, per the locked decision (budget adoption is a board vote, not a disbursement one person moves — Chuck plausibly holds both `LEDGER_MANAGE` and `LEDGER_APPROVE`).
- **`src/app/api/admin/ledger/budget-approvals/unlock/route.ts`** (new) — `POST`, gate `LEDGER_APPROVE`. Validates `entityId`/`fiscalYear`/`unlockReason` (required, via `validateRequiredTrimmedText`), 404s on unknown entity, then reads current state — if not currently locked (`!isBudgetLocked(current)`, which also covers "no row exists yet"), returns 409 "This budget is not currently locked." Otherwise upserts `status: 'unlocked'` + the unlock trio (`unlockedByUserId`, `unlockedAt`, `unlockReason`); approval trio untouched.
- **Fixed the flagged bug** in `src/app/api/admin/ledger/budgets/seed/route.ts`: the per-line loop now checks `upsertBudgetLine`'s return value. On `!writeResult.ok` (currently only the lock-check 409, but written generically for any future non-ok result), it throws a new `SeedLockedError(message, status)` from inside the `db.transaction()` callback, which rolls back every write from that seed request — no partial-seed-then-reject state. The outer `catch` block special-cases `SeedLockedError` and returns its `status`/`message` verbatim instead of falling through to the generic 500. Verified by reasoning through the transaction semantics (Postgres transaction + Drizzle: an uncaught throw inside the callback rolls back), not by a live DB run (no `DATABASE_URL` in this environment — same constraint database-admin noted).
- Added the four named `describe` blocks to `src/lib/ledger.test.ts`, matching the Phase 3 spec's exact case list verbatim: `isBudgetLocked` (null/unlocked/locked → 3 tests), `validateCategoryCreateInput` (empty name/whitespace name/bad flow/case-insensitive duplicate/valid → 5 tests), `nextCategorySortOrder` (empty→0/[0,2,5]→6/[3]→4 → 3 tests), `validateRequiredTrimmedText` (undefined/empty/whitespace/trim+accept/truncate-not-reject over maxLen → 5 tests). 16 new tests total.
- Ran `pnpm exec tsc --noEmit` (clean) and `pnpm test` (532/532 passed, 17 test files — 516 prior + 16 new).
- Ran `pnpm lint` — pre-existing, unrelated environment failure: ESLint 9.39.2's flat-config loader throws `SyntaxError: The requested module 'minimatch' does not provide an export named 'default'` while loading `eslint.config`'s `@eslint/eslintrc` compat layer, before linting any file. Reproduces on a clean checkout with none of this change's files touched — a dependency-version mismatch (`minimatch`'s ESM/CJS export shape vs. what `@eslint/eslintrc` expects), not something introduced here. Flagging for deployment-engineer's 30-day dependency review rather than fixing in scope, since it's an environment/tooling issue, not an application bug.

### Outputs

**New routes:**

1. `POST /api/admin/ledger/categories` — gate `LEDGER_MANAGE`
   - Body: `{ entityId: string; fiscalYear: number; fundKind: 'administrative'|'activity'|'charitable'|'scholarship'; flow: 'income'|'expense'; name: string; countsAsGiving?: boolean; form990Line?: string }`
   - 200: `{ id, name, fundKind, flow, sortOrder, countsAsGiving, form990Line, isActive: true }`
   - 400: bad shape, unmatched `fundKind` for the entity, or `validateCategoryCreateInput` rejects name/flow
   - 401/403: auth/feature
   - 404: entity not found
   - 409: locked FY, or case-insensitive duplicate name — `"A category named '…' already exists for this fund."`

2. `POST /api/admin/ledger/budget-approvals` — gate `LEDGER_APPROVE` (approve/lock)
   - Body: `{ entityId: string; fiscalYear: number; boardMinute: string }`
   - 200: `{ entityId, fiscalYear, status: 'locked', approvedByUserId, approvedAt, boardMinute }`
   - 400: bad `fiscalYear`, missing/blank `boardMinute`
   - 401/403/404 as above
   - 409: already locked — `"This budget is already locked. Unlock it to make changes and re-approve."`

3. `POST /api/admin/ledger/budget-approvals/unlock` — gate `LEDGER_APPROVE`
   - Body: `{ entityId: string; fiscalYear: number; unlockReason: string }`
   - 200: `{ entityId, fiscalYear, status: 'unlocked', unlockedByUserId, unlockedAt, unlockReason }`
   - 400: bad `fiscalYear`, missing/blank `unlockReason`
   - 401/403/404 as above
   - 409: not currently locked (includes never-approved) — `"This budget is not currently locked."`

**Unchanged contracts (inherit the 409 automatically, no shape change):** `PATCH /api/admin/ledger/budgets`, `POST /api/admin/ledger/budgets/seed` (seed also gets the bug fix above).

**Files touched:**
- `src/app/api/admin/ledger/categories/route.ts` (new)
- `src/app/api/admin/ledger/budget-approvals/route.ts` (new)
- `src/app/api/admin/ledger/budget-approvals/unlock/route.ts` (new)
- `src/app/api/admin/ledger/budgets/seed/route.ts` (bug fix — result-check + rollback + `SeedLockedError`)
- `src/lib/ledger.test.ts` (16 new tests across 4 `describe` blocks)

No schema changes, no new `FEATURES` key (design confirmed none needed) — nothing further for database-admin.

### Open questions / handoff notes

- **Next agent: ux-developer**, per Phase 3 Implementation Order step 3.
- All three new routes are ready to consume as-is; no deviation from the Phase 3 API Contracts section.
- `budgeting/page.tsx` still needs the two-tier gate rework (`hasAnyFeature([LEDGER_MANAGE, LEDGER_APPROVE])` for admission, `canManage`/`canApprove` computed separately) and to call `getBudgetApproval(entity.id, targetFY)` + `isBudgetLocked(approval)` directly (Server Component, no new GET route — DECISION-044) — none of that is built yet, only the API surface it depends on.
- `GuidedBudgetSetup` needs: the locked-state banner, read-only rendering when locked, the "+ Add category" affordance (fixing the empty-fund gap, rendered outside the `budgetEditorLines.length > 0` conditional), the explicit remove-line control (`ConfirmDialog`, calls existing `PATCH /budgets` with `annualAmountCents: null` — no new endpoint), the Approve panel (calls `POST /budget-approvals`), and the Unlock control (calls `POST /budget-approvals/unlock`) — all per Phase 3's Component Plan.
- The seed-route bug fix changes only the *behavior* on a locked FY (409 instead of a fake 200) — its success-path response shape (`priorFiscalYear`, `targetFiscalYear`, `funds[]`) is unchanged, so no UI relying on that shape needs updating.
- Reminder for qa (Phase 5, already noted in Phase 3): manual click-through must include locking a partial budget (allowed, warning-only), a stale-tab `PATCH /budgets` against a locked FY (confirm 409), unlock, re-edit, re-lock, and a seed-against-locked-FY attempt (confirm 409 with zero rows written, not a partial seed) — the last case is new coverage this bug fix makes meaningful to test.
- The `pnpm lint` failure noted above is environment-level (ESLint/minimatch ESM mismatch), not caused by this change — worth a heads-up to whichever agent runs `/pre-push` next so it isn't mistaken for a regression introduced here.

---

# Phase 6 — Shipped vs Intent (analyst)

Pending.
