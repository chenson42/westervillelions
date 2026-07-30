# Budget Permissions + Budget Committee Role — Work Log

> **Slug:** `2026-07-29-budget-permissions`
> **Surface:** `(dashboard) admin` — `/admin/ledger/budgeting`, `/admin/roles`, plus the admin sidebar nav. No public or member-portal surface.
> **Permission(s):** New `FEATURES.BUDGET_VIEW` (`budget.view`) and `FEATURES.BUDGET_EDIT` (`budget.edit`). Existing `FEATURES.LEDGER_APPROVE` (`ledger.approve`) continues to gate lock/approve — no new approve key.
> **Estimated complexity:** medium (no schema/tables; touches a permissions migration, 3 API route gates, 1 page gate, and the admin sidebar nav component's single-feature-per-item model, which needs widening).
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-29 |
| 2 — Architectural review | architect | Skipped (explicit) | — | 2026-07-29 |
| 3 — Technical design | full-stack-developer | Complete | Design complete | 2026-07-29 |
| 4 — Implementation | full-stack-developer | Complete | complete | 2026-07-29 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## Open Questions — RESOLVED (Chris, 2026-07-29)

1. **No `budget.approve` key.** Lock/adopt a budget stays on the board's existing `ledger.approve`.
2. **Budget Committee role ALSO gets `ledger.view`** (Chris chose broader ledger context). Final `budget_committee` bindings: `budget.view` + `budget.edit` + `ledger.view`.
3. **Permissions role only** — no member-portal Group, no Google Group sync for Budget Committee.
4. **Seed James Shively (`jmshively@gmail.com`) into `budget_committee`** in the migration (explicit intent, even though the `treasurer` binding already grants him budget access).

Final role→key bindings to implement:
- `admin`: budget.view ✓ / budget.edit ✓ (already has via ledger.manage; bind explicitly too)
- `treasurer`: budget.view ✓ / budget.edit ✓
- `board_member`: budget.view ✓ / budget.edit — (view only)
- `budget_committee` (NEW): budget.view ✓ / budget.edit ✓ / ledger.view ✓ — seed jmshively@gmail.com

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

There is a real, verified permission gap — a treasurer who is not also `board_member`/`admin` cannot open the budgeting page at all today — and the fix is two additive `FEATURES` keys plus a new `Budget Committee` role, bound so that nobody who has budget access today loses it.

## Grounding — verified against the live database, not just the migrations

I queried the production/dev Neon DB directly (`role_features` join) rather than trusting the migration history alone, since role bindings can be edited live via `/admin/roles` without a matching migration file. The live state matches the migrations exactly:

| Role | `ledger.view` | `ledger.record` | `ledger.manage` | `ledger.approve` |
|------|:---:|:---:|:---:|:---:|
| admin | ✓ | ✓ | ✓ | ✓ |
| treasurer | ✓ | ✓ | — | — |
| board_member | ✓ | — | — | ✓ |

**This confirms the bug Chris is reacting to.** `ledger.manage` — the key that currently gates *all* budget building/editing — is bound only to `admin`. The `treasurer` role has no budget access whatsoever today, and `board_member` gets read-only access (via `ledger.approve` admitting the page) but cannot edit a single line.

Checking actual user role assignments: `chenson42@gmail.com` (Chris) holds `admin, board_member, member, treasurer` — so his own account already has full budget access via `admin`, which is why the gap wasn't obvious from his own login. `jmshively@gmail.com` (James Shively, the other treasurer) holds only `board_member, treasurer` — **no `admin`**. Today, James can open `/admin/ledger/budgeting` (via `board_member`'s `ledger.approve`) but cannot edit a single budget line, add a category, or annotate — he can only lock/unlock. He is, in effect, the treasurer who cannot build the budget he's responsible for. That is exactly "we don't have permissions for the budget."

## Pass 1 — User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin | Create the "Budget Committee" role in `/admin/roles` (or confirm it's seeded) | one-time |
| Admin | Toggle `budget.view` / `budget.edit` checkboxes for a role (Treasurer, Budget Committee, Board Member) in `/admin/roles` | on demand |
| Admin | Assign a user to the `Budget Committee` role in `/admin/users` or `/admin/roles` | on demand |
| Signed-in member with `budget.view` or `budget.edit` | Navigate to `/admin/ledger/budgeting` (nav link or direct URL) | per session |
| Signed-in member with `budget.edit` | Add/edit/remove a budget line amount, add a category, add/remove a cause-line breakdown, star/note a line | per session |
| Signed-in member with `budget.view` only | View funds, categories, budget lines, prior-year reference columns, and the print worksheet — no write controls rendered | per session |
| Signed-in member with `ledger.approve` (unchanged) | Lock/approve or unlock the budget | per fiscal-year cycle |

Every verb above names its surface and role explicitly — no "the user" ambiguity in the request once resolved.

## Pass 2 — Flow Audit

**Flow 1 — Admin grants budget access to a role**
Entry: `/admin/roles` → select a role (e.g., Treasurer) → step: toggle "Budget: View" and/or "Budget: Edit" checkboxes → step: Save.
Success: `role_features` updated; toast confirms; every user holding that role gains the capability.
Failure: existing `/admin/roles` save-failure handling applies (not new to this feature) — toast error, no partial write.
**Gap (see below):** no in-app microcopy tells the admin that the grant won't take effect for an already-signed-in user until they sign out and back in.

**Flow 2 — Treasurer/Budget Committee member views the budgeting page**
Entry: signed-in, `budget.view` or `budget.edit` (or existing `ledger.manage`/`ledger.approve`) → clicks "Budgeting" in the sidebar (Treasury group) or hits the URL directly.
Success: page renders funds/categories/budget lines for the current entity + fiscal year; write controls appear only if `canManage` (now `ledger.manage` OR `budget.edit`) is true.
Failure: no `budget.view`/`budget.edit`/`ledger.manage`/`ledger.approve` → redirect to `/access-pending` (existing pattern, unchanged).
**Gap (see below):** the sidebar nav item itself is gated on a single feature (`ledger.manage` today) — a `budget.view`/`budget.edit`-only holder can load the page by URL but will not see it in the nav unless that's fixed.

**Flow 3 — Budget Committee member edits a budget line**
Entry: on the budgeting page, `canManage` true → clicks a category row's amount field → step: types a new annual amount → step: saves (PATCH `/api/admin/ledger/budgets`).
Success: line updates in place; running totals recompute.
Failure: 403 if the gate is misconfigured (not expected once bound correctly); 409 `{ reason: 'locked' }` if the budget is locked for that FY — existing, unchanged microcopy ("This budget is locked...").

**Flow 4 — Board member locks/approves the budget (unchanged)**
Entry: `ledger.approve` holder → Approve/Lock panel → enters board minute text → confirms.
Success: budget locked; pending-delete purge runs atomically.
Failure: 409 if already locked ("already locked... unlock to make changes"), 400 if board minute is blank.
This flow is untouched by this feature — `budget.edit` does **not** grant lock/approve.

## Pass 3 — Permissions

- **New keys:** `FEATURES.BUDGET_VIEW` = `"budget.view"`, `FEATURES.BUDGET_EDIT` = `"budget.edit"`.
- **No new approve key.** Lock/approve stays on the existing `FEATURES.LEDGER_APPROVE`, unchanged, board-only. See "Resolved Question 1" below for rationale.
- **Default roles:** see "Resolved Question 5" — full bindings table.

## Pass 4 — Edge Cases the Request Didn't Mention

- **OAuth-vs-password:** Not applicable as a differentiator — `features` are derived from role bindings identically regardless of sign-in method. No gap here.
- **Access-pending surface:** Confirmed handled — a member with only `budget.view`/`budget.edit` and no other feature will *not* land on `/access-pending`; they'll be routed straight past it to the budgeting page. Fine as-is.
- **JWT staleness (real gap, pre-existing, worth surfacing here):** I checked `src/lib/auth/index.ts` — the session's `features` array is baked into the JWT at sign-in and only reloaded when `trigger === "update"` fires. It does **not** re-check the DB on every request (that 60-second cache lives in `permissions-server.ts` and is a separate, server-side-only mechanism used by route handlers — the *session* itself is longer-lived). Practically: if Chris grants James `budget.edit` while James is already signed in, James will not see the new access until he signs out and back in. This is an existing platform-wide behavior (not introduced by this feature), and I found no in-app microcopy anywhere that tells an admin this after a grant. **Suggested resolution:** out of scope to fix broadly in this feature, but the `/admin/roles` save-success toast should say "James Shively will see this after their next sign-in" (one string, low cost) — or defer and just make sure Chris knows to tell James to re-login after this ships.
- **Email queue:** N/A — this feature sends no email.
- **Google Group sync:** N/A — permissions/roles here are unrelated to committee-membership Google Group sync; the "Budget Committee" *role* is a permissions role, not a member-portal *group/committee* (`/members/groups`) — confirm this distinction with Chris (see Open Questions) since the word "committee" could be read either way.
- **Empty state:** Already handled by the existing page — "No ledger entities found" / "No funds configured for this entity" empty states are untouched by this change.
- **Failure microcopy:** Existing 403/409 messages are adequate and unchanged; no new failure paths introduced beyond a straightforward feature-gate check.
- **Mobile (360px):** No UI changes are needed for the view-only case — the page already renders read-only at 360px for today's `ledger.approve`-only board members (`canManage=false` collapses controls). Confirmed no new component work required for the "view" tier.
- **Brand consistency:** No new components — this is purely a gating change plus a `/admin/roles` checkbox (existing UI pattern) and a new role row (existing UI pattern). No new cards/buttons/dialogs to review against the style guide.
- **Sidebar nav single-feature limitation (real gap, load-bearing):** `src/components/admin/admin-sidebar.tsx` models `NavItem.requiredFeature` as a single `string`, filtered via `userFeatures.includes(item.requiredFeature)`. The "Budgeting" item is currently gated on `ledger.manage` alone — meaning **board members with `ledger.approve` already can't see the nav link today**, even though the page itself admits them. If we bind `budget.view`/`budget.edit` without widening this component, Treasurer and Budget Committee holders will be able to load the page by direct URL but won't see it in navigation — an undiscoverable feature. **This must be resolved in Phase 3/4**, not deferred: either widen `NavItem.requiredFeature` to `string | string[]` with an "any of" filter, or accept `requiredFeature` as an array uniformly. Flagging this now because it's exactly the kind of gap a request like Chris's ("we need view and edit capabilities") doesn't mention but will visibly break if skipped.

## Pass 5 — Adversarial Pass

- **Redirect targets:** N/A — no callback/redirect params in this flow.
- **State-machine shortcuts:** A `budget.view`-only user hitting the budgeting page cannot skip to edit — every write path (PATCH `/api/admin/ledger/budgets`, `/budgets/seed`, `/budgets/annotations`) is server-side gated independently of what the page renders; a view-only user forging a PATCH request still hits the 403 (once the API-route gate is updated to check `budget.edit` OR `ledger.manage` — confirm this is done in Phase 4, not just the page-level check). This is the standard defense-in-depth pattern already used elsewhere in the ledger and must be preserved here.
- **Enumeration leaks:** N/A — no new resource-existence surface.
- **Input boundaries:** N/A — no new input fields; existing amount/category/fiscal-year validation in `upsertBudgetLine`/`setBudgetLinePendingDelete` is unchanged.
- **Self-targeting:** A Budget Committee member cannot grant themselves `ledger.approve` or additional roles through this feature — role/feature assignment itself remains gated by `FEATURES.ADMIN_ROLES`, untouched. Confirmed: `budget.edit` does not let a user lock/approve their own budget, and does not let them touch `/admin/roles`.

## Permissions

- **Permission(s):** New `FEATURES.BUDGET_VIEW` (`budget.view`), `FEATURES.BUDGET_EDIT` (`budget.edit`). Existing `FEATURES.LEDGER_APPROVE` unchanged for lock/approve.
- **Default roles:** see full binding table below.

## Resolved Scoping Questions

**1. New keys — minimal set.**
Add exactly two: `BUDGET_VIEW` (`budget.view`) and `BUDGET_EDIT` (`budget.edit`). Do **not** add a `budget.approve`. Lock/approve stays on the existing `LEDGER_APPROVE`, which today governs both budget-lock and disbursement/reimbursement approval as a single "board authority" concept (see the `budget-approvals/route.ts` header comment: "budget adoption is a board vote about a plan... unlike transactions/[id]/approve there is no self-approval block to enforce"). Splitting it into its own key isn't something the request asked for, and doing so would let a future role approve budgets without being trusted for disbursement approval — a real policy question, not an accidental byproduct. Flagged as an explicit **out-of-scope-to-confirm** item below rather than silently declining it.

**2. Gating migration on the budgeting page — ADDITIVE, not replacing.**
- Page admission (`canAccess`): `hasAnyFeature([LEDGER_MANAGE, LEDGER_APPROVE, BUDGET_VIEW, BUDGET_EDIT])` — a strict superset of today's gate. Nobody who has access today loses it.
- Edit controls (`canManage`): `hasAnyFeature([LEDGER_MANAGE, BUDGET_EDIT])` — same superset logic. `LEDGER_MANAGE` holders (admin) are unaffected.
- Lock/approve (`canApprove`): **unchanged** — `hasFeature(LEDGER_APPROVE)` only. `budget.edit` alone never unlocks the Approve/Lock panel.
- A `budget.view`-only holder gets exactly the read-only experience `ledger.approve`-only board members already get today (`editorDisabled = locked || !canManage` renders true) — this UI state is already built and proven in production, so there's no new "view-only" UI to design.
- **API routes that must change their gate from `hasFeature(LEDGER_MANAGE)` to `hasAnyFeature([LEDGER_MANAGE, BUDGET_EDIT])`:**
  - `PATCH /api/admin/ledger/budgets`
  - `POST /api/admin/ledger/budgets/seed`
  - the annotations route (`/api/admin/ledger/budgets/annotations`)
- **API routes that stay on `LEDGER_APPROVE`, unchanged:** `POST /api/admin/ledger/budget-approvals`, `POST /api/admin/ledger/budget-approvals/unlock`.
- **Sidebar nav (`admin-sidebar.tsx`):** must be widened so the "Budgeting" item admits any of `[LEDGER_MANAGE, LEDGER_APPROVE, BUDGET_VIEW, BUDGET_EDIT]` — today it's hard-gated to `LEDGER_MANAGE` alone (a pre-existing gap that already hides the link from board members; this feature is the forcing function to fix it). This requires widening `NavItem.requiredFeature` from `string` to accept multiple values.

**3. Budget Committee role — minimal binding.**
Bind `budget.view` + `budget.edit` only. **Not** `ledger.view`, `ledger.record`, `ledger.manage`, or `ledger.approve`. Verified the budgeting page itself doesn't separately gate on `ledger.view` to show fund/category actuals — `canAccess` is the only check the page performs before rendering everything, including prior-year actuals — so Budget Committee members see full budget-vs-actual context on the budgeting page without needing `ledger.view`. They will **not** see the general Ledger Overview, Reports, Reconciliation, Compliance, or Donors pages (all gated on `ledger.view`/`ledger.record`) — that's a deliberate scope boundary matching the literal request ("budget committee," not "full ledger committee"), but it's exactly the kind of assumption Chris should confirm (see Open Questions).
No lock/approve for Budget Committee — reserved for `board_member` (and `admin`), preserving the existing "board votes to adopt" invariant.

**4. Where `budget.view` fits for members generally — committee/board/treasurer-scoped, not general membership.**
Do not bind `budget.view` to the base `member` role. This mirrors the existing precedent that `ledger.view` itself is `admin`/`treasurer`/`board_member`-only, never general-member. In-progress, pre-approval budget figures are a different kind of artifact than the two already-shipped member-facing financial surfaces (`/members/financial-reports` — read-only, reconciled, board-approved monthly statements; `/members/impact` — giving totals). Recommend keeping raw budget planning data out of the general roster by default.

**5. Migration / backward-compat — exact bindings (one idempotent migration, following the `add-permission` skill / `0045_ledger_permissions.sql` pattern):**

| Role | `budget.view` | `budget.edit` |
|------|:---:|:---:|
| admin | ✓ (explicit bind, matches existing convention even though admin auto-gets-all-features) | ✓ |
| treasurer | ✓ | ✓ |
| board_member | ✓ | — (no change to board_member's edit capability — they remain approve/lock-only, exactly as today) |
| budget_committee (**new role**) | ✓ | ✓ |

The critical backward-compat check: every user who can edit budgets today (`admin`, via `ledger.manage`) keeps that ability — the new gates are additive ORs, nothing is removed from any existing check. The actual *behavior change* is additive too: `treasurer` and the new `budget_committee` role gain edit access they don't have today; `board_member` gains nothing new (stays view+approve, no edit) — matching the request's literal ask (treasurer needs to edit; board approves) without silently expanding board authority.

New role: `budget_committee` — description "Budget Committee — builds and proposes the annual budget," inserted with a `sort_order` after `treasurer` (bumping `member`/`volunteer` down by one, following the precedent set in `0040_dues_tracking.sql` when `treasurer` was added).

## Gaps the Request Didn't Address

- **Sidebar nav is single-feature-gated.** Without widening `admin-sidebar.tsx`'s `NavItem.requiredFeature` model, `budget.view`/`budget.edit` holders (and today's `board_member`s) can load the page by URL but won't see it in navigation. Must be fixed in the same increment, not deferred — an undiscoverable nav item defeats the point of granting the permission. See Pass 4.
- **JWT/session staleness after a grant.** Existing platform behavior, not new — but nobody currently tells the granting admin that the grantee needs to re-sign-in. Recommend a one-line toast addition on `/admin/roles` save; low cost, real UX payoff given this feature's whole point is "let James edit the budget" and he won't be able to until he logs out/in.
- **"Committee" naming ambiguity.** The request says "budget committee role" — I've treated this as a permissions `Role` (bound in `/admin/roles`), not a member-portal `Group`/committee (`/members/groups`, which syncs to a Google Group). If Chris actually wants a Google-Group-backed committee that members see under Groups *and* a permissions role, that's two features, not one — flagged as an open question below rather than assumed.
- **Defense-in-depth on write routes.** Confirmed each budget-mutating API route independently re-checks the feature server-side (not just the page's client-visible controls) — this must remain true after the gate is widened to `hasAnyFeature([LEDGER_MANAGE, BUDGET_EDIT])`; Phase 4 should not accidentally leave any of the three write routes on the old single-feature check.

## Out of Scope (confirm with user)

- **Splitting budget lock/approve into its own `budget.approve` key**, decoupled from `ledger.approve` (disbursement/reimbursement approval). Recommended default is "no" (see Resolved Question 1) — confirm that's acceptable, or say if you want Budget Committee (or some other role) to be able to lock a budget without also being able to approve reimbursements.
- **Whether Budget Committee also needs `ledger.view`** to browse the general Ledger Overview/Reports/Reconciliation/Compliance/Donors pages, beyond the budgeting page itself. Recommended default is "no" (budgeting-page-only) — confirm, or widen the binding.
- **Whether "Budget Committee" should also exist as a member-portal Group/committee** (synced to a Google Group, visible under `/members/groups`), separate from the permissions Role this Phase 1 review scopes. Treated these as two different concepts here.

## Open Questions

- Is "Budget Committee" purely a permissions role for granting `budget.view`/`budget.edit`, or does it also need a member-facing committee/Group presence? (See "Out of Scope" above.)
- Should Budget Committee be able to lock/approve a budget on its own, or does that stay board-only via `ledger.approve` as recommended?
- Should Budget Committee see the broader Ledger (`ledger.view`) for context, or strictly budgeting-page-only as recommended?
- Any specific named users to bind to the new `budget_committee` role in the seed migration (mirroring how `0040_dues_tracking.sql` email-keyed Chris and James into `treasurer`), or should the role ship empty and be assigned later via `/admin/users`?

---

# Phase 2 — Architectural Review (architect)

## SKIPPED — explicit notation

Skipped by explicit instruction from the orchestrating session, which
directed full-stack-developer to implement directly per this work-log's
already-resolved Phase 1 spec. Justification for why the skip is safe: no new
directories, no new npm dependencies, no new tables — this is two additive
`FEATURES` keys, one idempotent migration following the exact
`0045_ledger_permissions.sql` / `0040_dues_tracking.sql` pattern, an additive
`hasAnyFeature([...])` OR on existing gates (page + 3 API routes), and a
type-widening of `NavItem.requiredFeature` from `string` to `string | string[]`
in an existing client component. No invariant in CLAUDE.md is touched or
changed — permissions remain the only gating mechanism, migrations remain
idempotent, server/client boundaries are unchanged. If qa or analyst
(Phases 5/6) surface a structural concern, loop back here.

---

# Phase 3 — Technical Design (tech-lead role, executed by full-stack-developer)

## Summary

Add two additive `FEATURES` keys (`budget.view`, `budget.edit`) and a new
`budget_committee` role so a treasurer or budget-committee member who isn't
also `admin`/`board_member` can actually build and edit the annual budget —
today only `admin` (via `ledger.manage`) can edit, and `board_member` (via
`ledger.approve`) can only lock/unlock. Every gate this touches is widened
with an OR, never narrowed: the page's admission check, the page's edit-
controls flag, all three budget-mutating API routes, and the sidebar nav item
(which today hides "Budgeting" from anyone without `ledger.manage` — a
pre-existing gap board members already hit). No `budget.approve` key is
introduced; lock/adopt stays on `ledger.approve`, board-only, untouched.

## Permissions

- Permission keys: `budget.view` (`FEATURES.BUDGET_VIEW`), `budget.edit`
  (`FEATURES.BUDGET_EDIT`).
- Default role bindings (exact, per Chris's LOCKED spec):
  | Role | budget.view | budget.edit | ledger.view |
  |------|:---:|:---:|:---:|
  | admin | ✓ | ✓ | (already has) |
  | treasurer | ✓ | ✓ | (already has) |
  | board_member | ✓ | — | (already has) |
  | budget_committee (NEW) | ✓ | ✓ | ✓ (new bind) |
- `jmshively@gmail.com` (James Shively) seeded into `budget_committee` in the
  migration, email-keyed and idempotent (mirrors the `treasurer` seed in
  `0040_dues_tracking.sql`).

## API Contract

No new routes. Three existing write routes widen their gate from
`hasFeature(session.user.id, FEATURES.LEDGER_MANAGE)` to
`hasAnyFeature(session.user.id, [FEATURES.LEDGER_MANAGE, FEATURES.BUDGET_EDIT])`:
- `PATCH /api/admin/ledger/budgets` (amount write / pending-delete toggle)
- `POST /api/admin/ledger/budgets/seed`
- `PATCH /api/admin/ledger/budgets/annotations` (star/note)

None of these three routes has a GET handler — the budgeting page reads via
server-side query functions (`getFundReport` etc.), not an API route, so
there is no separate "read" gate to widen on these files; the page-level read
gate is the Server Component check in `budgeting/page.tsx`.

`budget-approvals/route.ts` and `budget-approvals/unlock/route.ts` are
untouched, per spec — they stay `LEDGER_APPROVE`-only.

## Data Model

No schema changes. `features` / `roles` / `role_features` / `user_roles` rows
only, via one idempotent SQL migration.

## Component / Page Plan

- No new pages or components.
- Files to modify:
  - `src/lib/permissions.ts` — two new `FEATURES` keys + descriptions
  - `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` — widen `canAccess`
    and `canManage`
  - `src/app/api/admin/ledger/budgets/route.ts` — widen PATCH gate
  - `src/app/api/admin/ledger/budgets/seed/route.ts` — widen POST gate
  - `src/app/api/admin/ledger/budgets/annotations/route.ts` — widen PATCH gate
  - `src/components/admin/admin-sidebar.tsx` — widen `NavItem.requiredFeature`
    to `string | string[]` (any-of filter), widen the Budgeting item

## Implementation Order

1. `FEATURES` entries in `src/lib/permissions.ts`
2. Migration `drizzle/migrations/0069_ledger_budget_permissions.sql` (features
   + role + role_features + user_roles seed)
3. Widen the 3 API route gates
4. Widen the budgeting page gate
5. Widen the sidebar nav-item model + the Budgeting item
6. Unit tests for the 3 widened routes

## Edge Cases & Risks

- **Nav single-feature model** — fixed by widening `requiredFeature` to
  `string | string[]`; existing single-feature items pass unchanged through
  the same filter logic (wrapped in a 1-element array).
- **JWT/session staleness** — pre-existing, cross-cutting platform behavior
  (not fixed here): a role grant doesn't take effect for an already-signed-in
  user until they sign out/in. James Shively needs to re-login after this
  ships to see `budget_committee`'s new access.
- **Cause-line sub-routes** (`budgets/cause-lines/*`) — RESOLVED (Chris/orchestrator, post-agent):
  the four routes (`cause-lines/route.ts`, `.../group`, `.../collapse`, `.../annotations`)
  were widened from `hasFeature(LEDGER_MANAGE)` to `hasAnyFeature([LEDGER_MANAGE, BUDGET_EDIT])`
  to match the Pass-1 verb list (which explicitly puts "add/remove a cause-line breakdown"
  under `budget.edit`). Doc-comment "Gate:" lines updated accordingly. TSC passes.
  Note for qa: no dedicated permission tests exist for the cause-lines routes yet — add
  budget.edit-can / unauthorized-cannot coverage.
- **sort_order for `budget_committee`** — inserted at 6 (after volunteer),
  not interleaved into the existing admin/board_member/treasurer/member/
  volunteer sequence, to avoid UPDATE-bumping every existing role's
  sort_order in an idempotent migration. This is a judgment call, not spec'd
  by Chris; flagged for confirmation in Phase 6.

## Implementer

full-stack-developer (this session) — small, tightly coupled, additive-only
change across permissions.ts + 1 migration + 1 page + 3 routes + 1 client
component; splitting into database-admin/api-developer/ux-developer would add
handoff overhead disproportionate to the change size.

---

# Phase 4 — Implementation

## Files Created

- `drizzle/migrations/0069_ledger_budget_permissions.sql` — inserts
  `budget.view`/`budget.edit` features, creates `budget_committee` role,
  binds features to roles, seeds James Shively into `budget_committee`
- `src/app/api/admin/ledger/budgets/seed/route.test.ts` — permission-gate
  unit tests (401 / 403 / gate-passes-through)
- `src/app/api/admin/ledger/budgets/annotations/route.test.ts` —
  permission-gate unit tests (401 / 403 / 200 with `BUDGET_EDIT`-only)

## Files Modified

- `src/lib/permissions.ts` — added `FEATURES.BUDGET_VIEW` (`"budget.view"`),
  `FEATURES.BUDGET_EDIT` (`"budget.edit"`), and matching
  `FEATURE_DESCRIPTIONS` entries ("View budgets" / "Create and edit budget
  line items")
- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` — `canAccess` widened
  to `hasAnyFeature([LEDGER_MANAGE, LEDGER_APPROVE, BUDGET_VIEW, BUDGET_EDIT])`;
  `canManage` changed from `hasFeature(LEDGER_MANAGE)` to
  `hasAnyFeature([LEDGER_MANAGE, BUDGET_EDIT])`. `canApprove` untouched
  (`hasFeature(LEDGER_APPROVE)` only — no `budget.approve` key exists).
- `src/app/api/admin/ledger/budgets/route.ts` — PATCH gate widened from
  `hasFeature(LEDGER_MANAGE)` to `hasAnyFeature([LEDGER_MANAGE, BUDGET_EDIT])`
  (+ doc-comment update)
- `src/app/api/admin/ledger/budgets/seed/route.ts` — POST gate widened the
  same way (+ doc-comment update)
- `src/app/api/admin/ledger/budgets/annotations/route.ts` — PATCH gate
  widened the same way (+ doc-comment update)
- `src/components/admin/admin-sidebar.tsx` — `NavItem.requiredFeature`
  widened from `string` to `string | string[]`; the visibility filter now
  wraps a single string in a 1-element array and does `.some()` (any-of);
  the "Budgeting" nav item now requires
  `[LEDGER_MANAGE, LEDGER_APPROVE, BUDGET_VIEW, BUDGET_EDIT]` instead of
  `LEDGER_MANAGE` alone (this also fixes the pre-existing gap where
  `board_member`s with `ledger.approve` could reach the page by URL but never
  saw it in the nav). The "Membership"→"Applications" rename made earlier in
  this file was left untouched, as instructed.
- `src/app/api/admin/ledger/budgets/route.test.ts` — mocks switched from
  `hasFeature` to `hasAnyFeature`; added a new describe block asserting 401
  (no session), 403 (neither feature), and 200 (gate passes when
  `hasAnyFeature` resolves true, i.e. a `BUDGET_EDIT`-only holder can write)

## Schema Changes

- None (no `schema.ts` changes — `features`/`roles`/`role_features`/
  `user_roles` are existing tables, row-seeded only).
- Migration file: `drizzle/migrations/0069_ledger_budget_permissions.sql`
  (idempotent — every INSERT guarded by `WHERE NOT EXISTS`).

## Test Results

- `pnpm exec tsc --noEmit` — PASS, no errors.
- `pnpm test` (full Vitest suite) — PASS, 27 test files / 762 tests, 0
  failures. Includes the 3 new/extended budget-route permission test files
  and the pre-existing `src/lib/permissions.test.ts` (FEATURES/
  FEATURE_DESCRIPTIONS catalog-completeness tests, which pass unmodified
  against the two new keys since `BUDGET_VIEW`/`BUDGET_EDIT` both got
  matching description entries).
- `budget-approvals/route.test.ts` (lock/approve) — untouched, still green;
  confirms the approve/lock path was not disturbed.
- Did NOT run `pnpm build:only` or commit/push, per instructions.

## Implementer Notes

- **Migration bindings exactly as specified** — verified against the live
  schema (`features(name, category, description)`,
  `roles(name, description, sort_order)`, `role_features(role_id,
  feature_id)`, `user_roles(user_id, role_id)`) by reading
  `0045_ledger_permissions.sql` and `0040_dues_tracking.sql` rather than
  guessing (per instructions). No deviation from the locked role→key table.
- **`budget_committee` sort_order = 6** (after volunteer=5), not interleaved
  into the admin/board_member/treasurer/member/volunteer sequence. This
  avoids UPDATE-bumping every existing role's `sort_order` (the pattern
  `0040_dues_tracking.sql` used when inserting `treasurer` at position 3).
  Not explicitly spec'd by Chris — flagged for Phase 6 confirmation, easy to
  change with a follow-up migration if a different position is wanted.
  Reference: `docs/decisions.md` was not amended for this — it's a purely
  cosmetic ordering choice, not a policy decision, so I didn't log a new
  DECISION entry for it.
- **Cause-line sub-routes intentionally NOT widened** —
  `src/app/api/admin/ledger/budgets/cause-lines/route.ts` (and its
  `annotations`/`collapse`/`group` siblings) still gate on `LEDGER_MANAGE`
  only. The task named exactly three routes to widen
  (`budgets/route.ts`, `budgets/seed/route.ts`,
  `budgets/annotations/route.ts`); the cause-lines family was out of that
  explicit list, so I left it alone rather than re-litigating scope. This
  means a `budget.edit`-only holder (no `ledger.manage`) can add/edit a
  budget line's lump-sum amount and star/note it, and seed next year's
  budget, but cannot break a category down into cause/beneficiary lines or
  collapse/group them — a real but narrow capability gap worth a follow-up
  ticket if Budget Committee members need that too.
- **No GET handlers existed on any of the three routes** — confirmed by
  reading each file in full before editing, so "read handlers should accept
  BUDGET_VIEW" had nothing to attach to on these three files; the read gate
  lives entirely in the Server Component (`budgeting/page.tsx`), which I did
  widen.
- **Test style matches existing hermetic patterns** — new test files mock
  `@/lib/auth`, `@/lib/permissions-server`, and `@/lib/ledger-queries` (plus
  `@/lib/db`/`@/lib/db/schema`/`@/lib/ledger` for the seed route, which
  imports more) rather than importing the real modules, consistent with the
  existing `route.test.ts` and `budget-approvals/route.test.ts` header
  comments explaining why (`@/lib/db` throws at import time without
  `DATABASE_URL`). The seed/annotations permission tests deliberately don't
  re-prove the full seed/annotation business logic (that's out of scope for
  a permission-gate change and already implicitly covered by
  `ledger-queries.test.ts`); they assert the gate 401s, 403s, and — when it
  passes — that the request reaches the first piece of real business logic
  (`getEntityById` / `setBudgetCategoryAnnotation`).

## Open questions / handoff notes for qa (Phase 5)

- **Manual click-through to nominate:** sign in as a user who holds only
  `treasurer` (not `admin`/`board_member`) — confirm they now see
  "Budgeting" in the sidebar, can open `/admin/ledger/budgeting`, and can
  edit a line (previously they'd have hit `/access-pending`, since
  `treasurer` had no ledger-budget-relevant feature at all before this).
- Confirm a `board_member`-only session still sees Budgeting (now via
  `LEDGER_APPROVE` explicitly listed in the nav array) and still gets a
  read-only page (`canManage` false, `editorDisabled` true) — this is the
  existing, unchanged experience, just now also nav-visible.
- Confirm a hypothetical `budget.view`-only holder (no other ledger/budget
  feature) reaches the page read-only and gets 403 on PATCH
  `/api/admin/ledger/budgets` if they forge a write request directly — the
  three widened routes reject on `hasAnyFeature` false.
- James Shively (`jmshively@gmail.com`) will not see his new
  `budget_committee` access until he signs out and back in (JWT/session
  staleness, pre-existing platform behavior, not fixed here) — worth a heads
  up to Chris, not a qa blocker.
- Nominate **qa** for Phase 5 (typecheck/build/manual click-through already
  partially covered above; qa should still run its own build verification
  since I was told not to run `pnpm build:only`).

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
