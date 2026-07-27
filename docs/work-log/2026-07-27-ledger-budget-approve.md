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
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
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

Pending.

---

# Phase 4 — Implementation

Pending.

---

# Phase 5 — Verification (qa)

Pending.

---

# Phase 6 — Shipped vs Intent (analyst)

Pending.
