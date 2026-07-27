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
| 2 — Architectural review | architect | Pending | — | — |
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

Pending.

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
