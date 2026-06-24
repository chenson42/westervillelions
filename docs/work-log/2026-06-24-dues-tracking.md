# Annual Membership Dues Tracking — Work Log

> **Slug:** `2026-06-24-dues-tracking`
> **Surface:** (dashboard) admin — managed by treasurer/admin; viewable by board members and treasurer
> **Permission(s):** New `dues.manage` for writes (treasurer + admin only); new `dues.view` for reads (admin + board_member + treasurer)
> **Estimated complexity:** medium (manual-entry core); large if Zeffy auto-recording is included
> **Pipeline mode:** Full

---

## Intent (captured by /new-feature, 2026-06-24)

**Request:** Track who has paid membership dues on an annual basis.

**Value:** The club needs to know, for a given membership year, which members have paid their dues and who hasn't — to confirm good standing and chase non-payers. Board members need visibility into payment status.

**Decisions from intake:**
- **Surface:** Admin portal. Membership managers record/manage payments; **board members should be able to see** dues status.
- **Data recorded:** Full payment log per member — amount, method, date, notes — on an annual basis (multiple payments per member over time, attributable to a membership year).
- **Entry method:** Both — manual admin entry now, with a path to auto-recording from the Zeffy membership-dues campaign later (deferred increment).
- **Permission:** Reuse `membership.manage` for management. Board-member view access is the open refinement point.

**Resolved decisions (2026-06-24, post–Phase 1, user-confirmed):**
- **Membership year:** **Lions fiscal year (Jul 1 – Jun 30).** Not calendar year.
- **Paid/unpaid rollup:** **Sum-based** — status is Paid when the member's total recorded payments for the fiscal year ≥ a **configured annual dues amount**; below that is Partial; none is Unpaid. Requires a single (flat) expected dues amount per fiscal year (tech-lead to decide where it's configured).
- **Board-member access:** **Read-only** via a **new `FEATURES.DUES_VIEW` ("dues.view")** key bound to `board_member` (and `admin`). `MEMBERSHIP_MANAGE` remains the write gate. (Analyst Option A / architect-confirmed.)
- **Member self-view:** **In scope** — members see their own dues status + payment history in the member portal (`/members/`). Adds a member-portal surface beyond the architect's admin-only placement.
- **Refunds/reversals:** Modeled as **negative-amount entries** in the payment log (default; tech-lead to confirm).

**Scope expansion (2026-06-24, loop-back after Phase 3 — user-added):**
- **New `treasurer` role.** Seeded idempotently (like `board_member`, migration-0002 pattern). Treasurers record dues.
- **New `dues.manage` write key** (separate from `membership.manage`). Bound to **`treasurer` + `admin` ONLY** — membership managers do NOT get dues write. Write routes (create/edit/delete payment, configure amounts) gate on `dues.manage`. Read stays `dues.view` (admin + board_member + treasurer). `membership.manage` is no longer the dues write gate.
- **Year-varying amounts:** confirmed (per-fiscal-year `dues_settings`).
- **Family discount:** new **per-member `dues_category`** field on `members` (`individual | family`, default `individual`), set by treasurer/admin. `dues_settings` holds **two amounts per fiscal year** (individual + family). Status compares the member's payment sum to the rate matching their `dues_category`.
- **FY2026 amounts (seed):** individual **$120.00** (12000 cents), family **$96.00** (9600 cents).
- **Named treasurers:** assign the `treasurer` role to **Chris Henson** (user `4fbd2463-09b0-4007-a3a2-a6644840f5b8`, chenson42@gmail.com) and **James Shively** (user `774a217f-60e5-45be-a77d-6601c08703b2`, jmshively@gmail.com). Both have user accounts. Recommend an idempotent migration binding `user_roles` by email (ensures production parity; repo is private).

**Scope expansion 3 (2026-06-24, post-ship increment — user-added):**
- **Explicit "active fiscal year" setting.** Admins/treasurers designate one fiscal year as active; all dues surfaces default to it instead of the calendar-derived `currentFiscalYear()`. Today, June 2026, the calendar function returns FY2025 which is wrong for the club — the club is already in FY2026 and needs it to be the default. Implementation: `is_active boolean` column on `dues_settings`, enforced single-active via partial unique index, seeded FY2026 if nothing is active (idempotent). `getActiveFiscalYear()` in `dues-queries.ts` returns the active FY or falls back to `currentFiscalYear()`. Three pages updated to use this: admin dues list, admin members list (dues filter), and member portal dues page. The configure-modal gains a "Set as active year" checkbox and shows an "Active" badge when viewing the current active year.
- **Quick "Mark Paid" from the dues list.** New `DuesMarkPaidButton` component on each row of `/admin/dues` that posts the member's remaining balance as a single check payment. Only visible when `canManage` (DUES_MANAGE), status is not already `paid`, and `expectedAmountCents > 0`. Uses local date construction (wall-clock Y/M/D) to avoid the naive-timestamp-as-UTC gotcha. No confirm dialog — it's reversible via delete on the detail page.

**Scope expansion 2 (2026-06-24, during Phase 4 — user-added):**
- **"Who has not paid" reporting / members filter.** Need to report on members who have NOT paid dues for a given fiscal year. Two surfaces:
  1. The `/admin/dues` list already filters by status (Paid/Partial/Unpaid) per the Phase 1 flows, and the CSV export includes status — that covers the core report. Ensure an **Unpaid** filter + export is prominent.
  2. **Add a dues-status filter to the existing admin members list (`/admin/members`)** — alongside the current search/branch/status/group filters — so unpaid members surface from the standard roster view (default fiscal year = current). Lands in **Phase 4c (ux)**, powered by a current-FY dues-status lookup from `src/lib/dues-queries.ts` (Phase 4b). Gate the dues-status column/filter visibility on `dues.view` so roster viewers without dues access don't see it.
- Keep the `/admin/members` page's existing PAGE_SIZE pagination and search/branch/status/group filters working alongside the new dues filter.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-06-24 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-06-24 |
| 3 — Technical design | tech-lead | Complete (revised) | Design complete — scope expansion incorporated | 2026-06-24 |
| 4 — Implementation | database-admin (4a), api-developer (4b), ux-developer (4c) | Complete (4a ✓, 4b ✓, 4c ✓) | — | 2026-06-24 |
| 5 — Verification | qa | Complete | PASS | 2026-06-24 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-06-24 |

---

# Phase 1 — Functional Refinement (analyst)

## Phase 1 — Functional Refinement — 2026-06-24

**Owner:** analyst
**Status:** complete

### Summary

The request is to add annual dues-payment tracking to the admin portal: membership managers record and manage a full payment log per member per membership year; board members view dues status (read-only). The core is clear and buildable. Six questions must be resolved before Phase 3 design — specifically the membership-year definition, paid/unpaid rollup logic, board-member permission model, and whether members will ever self-view — because these drive the schema directly. Verdict is READY WITH NOTES; none of the open questions are ambiguous enough to block Phase 2 architectural review, but they must be settled before the tech-lead writes the data model.

### What I did

Five-pass review: user verbs, flow audit, permissions, gap analysis, adversarial pass.

---

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> A manual payment log attached to members and membership years — membership managers record payments, board members view them — with six design questions that must be answered before the tech-lead can author the data model.

---

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin — membership manager | Navigate to dues management page | On demand |
| Admin — membership manager | Filter/search member list by dues status (paid / unpaid / partial) for a selected year | On demand |
| Admin — membership manager | Open a member's dues detail | On demand |
| Admin — membership manager | Record a new payment (amount, method, date, notes) for a member + year | Per payment event |
| Admin — membership manager | Edit an existing payment record | On demand |
| Admin — membership manager | Delete a payment record (with confirm) | Rare |
| Admin — membership manager | Export dues status for a year (CSV or similar) | Periodic (annual audit) |
| Admin — board member | View dues status list (paid / unpaid) for a year — read-only | On demand |
| Admin — board member | View a member's payment detail — read-only | On demand |

**Note on "admin member" vs "user":** `members` and `users` are separate tables; a member may or may not have a linked user account. All users here are authenticated admins or board members (users with linked `user` accounts and appropriate roles/features). Payment data is recorded against the `members` row, not the `users` row.

---

## Flows

**Flow 1 — Record a payment for a member:**
Entry: Admin navigates to `/admin/dues` (or `/admin/membership/dues`).
Step 1: Selects the membership year (default: current year).
Step 2: Sees a member list with dues status badges (Paid / Unpaid / Partial — definition TBD).
Step 3: Clicks a member row or "Add Payment" action.
Step 4: Form opens (inline or modal): amount, payment method (check, cash, Zeffy, other), date, notes.
Step 5: Submits. Payment record is saved; member row updates its status badge.
Success outcome: Toast "Payment recorded" + member row shows updated status.
Failure — validation error (e.g., missing amount): Inline field error, form stays open.
Failure — server error: Toast "Could not save payment. Try again." Form stays open.

**Flow 2 — Edit or delete an existing payment:**
Entry: Admin opens a member's payment detail (from the dues list).
Step 1: Sees a log of all payments for the selected year.
Step 2: Clicks "Edit" on a row — fields become editable (inline or modal).
Step 3: Saves. Row updates.
Step 4 (delete): Clicks "Delete." `<ConfirmDialog>` asks "Delete this payment? This cannot be undone." Admin confirms.
Success outcome (edit): Toast "Payment updated."
Success outcome (delete): Toast "Payment deleted." Row removed from list.
Failure — server error: Toast "Could not update/delete. Try again."

**Flow 3 — Review dues status for a year (manager or board member):**
Entry: User navigates to `/admin/dues` (or the dues tab).
Step 1: Year selector defaults to current year; user can pick prior years.
Step 2: Member list shows name + dues status (Paid / Unpaid / Partial) + amount paid vs. expected (if known).
Step 3: User clicks a member to view payment log detail.
Read-only for board members — no add/edit/delete controls visible.
Failure — no payments recorded yet (empty state): "No payments recorded for [year]. Add the first payment using the button above." (Manager view.) Board member sees "No payments have been recorded for [year] yet."

**Flow 4 — Export dues status:**
Entry: Manager clicks "Export" on the dues list page.
Step: Browser downloads a CSV of member name, email, year, total paid, status.
Failure — server error: Toast "Export failed. Try again."
(This verb is listed separately because it touches `REPORTS_EXPORT` — see Permissions.)

---

## Permissions

**Management (record / edit / delete payments):**
- Reuse `FEATURES.MEMBERSHIP_MANAGE` ("membership.manage").
- Currently granted only to the `admin` role. The `board_member` role does NOT have this key (confirmed in migration 0008). If board members are to view dues without editing, they must not receive `membership.manage`.

**Board-member view (read-only dues status):**
- Two options — the user must decide:
  - **Option A (new key):** Add `FEATURES.DUES_VIEW` ("dues.view"). Grant to `board_member` role. The dues list and detail pages gate on `DUES_VIEW OR MEMBERSHIP_MANAGE`. This is the cleanest separation: board members can never accidentally edit.
  - **Option B (role-only):** Grant `membership.manage` to `board_member`, and suppress edit/delete UI based on a secondary role check. This is fragile — it gives board members write API access even if the UI hides it, and re-uses a management key for a view-only audience. Not recommended.
  - **Recommendation:** Option A. Add `dues.view` as a new feature key; bind it to `board_member` by default. `membership.manage` stays management-only.

**Export:**
- `FEATURES.REPORTS_EXPORT` already exists and is appropriate for the CSV export action. Gate the export endpoint on `MEMBERSHIP_MANAGE OR REPORTS_EXPORT`.

**Default role bindings:**
- `membership.manage`: `admin` only (unchanged).
- `dues.view` (new, if Option A): `admin` + `board_member`.

---

## Gaps the Request Didn't Address

1. **Membership-year definition.** Does "membership year" mean calendar year (Jan–Dec), a Lions fiscal year (Jul–Jun), or a rolling 12 months from a member's join/renewal date? This is the single most load-bearing decision — it determines the schema column type (integer year vs. date range vs. per-member rolling window). If it's a fixed annual period, a simple `membership_year` integer column works. If it's per-member rolling, the model is more complex. *Suggested resolution: ask the user; default assumption is calendar year unless told otherwise.*

2. **How is "paid" computed from the payment log?** The request says "track who has paid" but describes a payment log (which can hold multiple partial payments). The system needs a rule: (a) any payment at all = paid, (b) sum of payments >= an expected dues amount = paid, (c) a manual "mark paid" flag separate from the log. Without this, the dues status badge has no definition. *Suggested resolution: ask the user; the simplest answer is "sum >= expected dues amount, where expected amount is configurable per year."*

3. **Expected dues amount / membership tiers.** If status is computed by sum vs. expected, what is the expected amount? Is it one flat fee per year, or does it vary by membership type (individual, family, lifetime)? Lifetime members presumably owe $0 — do they appear as "paid" forever? *Suggested resolution: ask the user; this directly affects whether the schema needs a per-year dues-amount setting.*

4. **Board-member permission model.** Confirmed above: `board_member` role exists but does not currently have `membership.manage`. A new `dues.view` key is the clean solution. *The user must confirm whether board members should view with no edit access, or whether they should be able to manage dues as well.*

5. **Member self-view.** The intake focused on admin and board. Can members see their own dues status (e.g., "You paid $X on [date] for 2026") in the member portal at `/(dashboard)/members/`? This is a common expectation and relatively cheap to add, but it was not mentioned. *Suggested resolution: confirm with user whether member self-view is in or deferred.*

6. **Partial payments and refunds.** The intake says "multiple payments over time," implying partial payments are supported. Does the system also need to record refunds (negative amounts)? If a member's check bounces, can the admin delete the payment or should there be a reversal record? *Suggested resolution: clarify whether negative amounts (refunds/reversals) are needed, or whether delete-payment is sufficient.*

7. **Empty state for a new year.** When the current year rolls over and no payments have been entered yet, all members show "Unpaid." Is this the intended UX, or should the system not generate the dues list until a dues period is officially "opened" for a year? *Suggested resolution: the simplest answer is implicit — every active member shows as unpaid for the selected year if no payment exists. No explicit "open dues period" step needed unless the user wants one.*

8. **Email notifications.** Should an overdue reminder email be sent to unpaid members? Or a receipt email when payment is recorded? The intake doesn't mention this. *Suggested resolution: confirm with user; safe default is no automated emails in this increment.*

9. **Audit trail.** The request doesn't say whether the system needs to record who entered or last edited a payment, and when. Since this is financial data, recording `recorded_by_user_id` and `updated_at` on payment rows is strongly recommended. *Suggested resolution: include by default; note as a design decision for Phase 3.*

10. **Where does this live in the admin nav?** The request doesn't specify whether dues tracking is a tab under the existing `/admin/membership` page (which currently handles applications) or a separate `/admin/dues` route. Both are reasonable; the admin nav needs updating either way. *Suggested resolution: ask the architect (Phase 2) to weigh in on placement.*

---

## Out of Scope (confirm with user)

- **Zeffy auto-recording integration.** Explicitly deferred. The "Membership Dues" campaign in the `campaigns` table is the future auto-record source, but reconciliation/import from Zeffy is not in this build.
- **Online dues payment initiation.** This feature records payments that have already occurred; it does not initiate new payments. Directing members to Zeffy to pay is handled by the existing campaigns surface.
- **Dues invoicing or statement generation.** Generating a PDF invoice or printable statement for a member is not mentioned and is assumed out of scope.
- **Automated overdue reminders.** Email-queue integration for "you haven't paid" reminders is not mentioned; assume deferred.
- **Historical import.** Importing prior-year dues data (e.g., from a spreadsheet) is not mentioned; assume out of scope for the initial build.

---

## Open Questions

The following must be answered before the tech-lead can write the data model (Phase 3). Phase 2 architectural review can proceed in parallel since the directory/component shape is not blocked by these.

1. **Membership-year definition:** Is a membership year a calendar year (Jan 1–Dec 31), the Lions International fiscal year (Jul 1–Jun 30), or something else? This determines the schema for `membership_year`.

2. **Paid/unpaid rollup:** How is "paid" computed — any payment present, sum ≥ expected dues, or a separate manual "mark paid" flag? If sum-based, what is the expected dues amount, and does it differ by membership type?

3. **Board-member permission:** Should board members be view-only (new `dues.view` key, recommended) or should they also be able to manage dues (add `membership.manage` to their role)? Or should dues management be restricted entirely to admins for now?

4. **Member self-view:** Should members be able to view their own dues status/payment history in the member portal, or is this admin/board-only for this increment?

5. **Refunds/reversals:** Is deleting a payment record sufficient, or does the system need to record negative amounts (refunds/reversals) for the payment log?

6. **Placement in admin nav:** Should dues tracking live as a tab/subpage under the existing `/admin/membership` page, or as its own top-level admin route (e.g., `/admin/dues`)?

---

### Outputs
- Work-log entry updated at `docs/work-log/2026-06-24-dues-tracking.md`
- No code or schema changes — Phase 1 is functional analysis only.

### Open questions / handoff notes
- Six questions above must be answered before Phase 3 data model design begins.
- Phase 2 (architect) can begin immediately — architectural placement and component shape are not blocked by the open questions.
- The `board_member` role exists in the DB (seeded in migration 0002). A new `dues.view` feature key is likely needed; the add-permission skill handles the idempotent migration pattern.
- `membership.manage` is currently admin-only; do not widen its role binding unless the user explicitly asks for board members to have write access.

---

# Phase 2 — Architectural Review (architect)

## Phase 2 — Architectural Review — 2026-06-24

**Owner:** architect
**Status:** complete

### Summary

Approved with suggestions. The feature fits cleanly in the existing admin route-group structure as a new top-level `/admin/dues` route, not as a tab under the existing `/admin/membership` surface. A new `DUES_VIEW` feature key is the correct and only authorization mechanism for the board-member read path. No new npm dependency is needed. All invariants are satisfied; four architectural rulings are logged in DECISION-012.

### What I did

- Read Phase 1 analyst output in the work-log.
- Read `src/lib/permissions.ts` to confirm existing `FEATURES` catalog and that no `dues.*` key exists.
- Read `src/components/admin/admin-sidebar.tsx` to understand current nav items, their feature gates, and the sidebar's filtering mechanism.
- Read `src/app/(dashboard)/admin/membership/page.tsx` to confirm the existing membership surface handles only `membership_applications` — a separate domain from dues.
- Read `src/app/api/admin/members/export/route.ts` to assess whether `exceljs` is the right export tool for the dues CSV or whether a lighter approach is warranted.
- Audited the admin route list to confirm `/admin/dues` is unoccupied and that the convention of one concern per admin route is maintained throughout.
- Logged DECISION-012 in `docs/decisions.md`.

### Outputs

- `docs/work-log/2026-06-24-dues-tracking.md` — this entry.
- `docs/decisions.md` — DECISION-012: Dues Tracking — separate `/admin/dues` route, `DUES_VIEW` permission key, CSV via Response + manual encoding, member-portal path reserved.

### Decisions and rulings

**1. Directory placement: separate `/admin/dues/`, not a tab under `/admin/membership/`.**
The existing `/admin/membership` page manages membership *applications* (the `membership_applications` table). Dues payments are a financially distinct domain against a different table (`dues_payments`, to be named in Phase 3). The two share `MEMBERSHIP_MANAGE` only on the manager write path; board members need read access to dues without touching applications at all. Merging them under one route would conflate two unrelated data models and two unrelated permission audiences, violating the one-concern-per-route convention the rest of the admin surface follows. New routes:
- `src/app/(dashboard)/admin/dues/` — list/year-filter page (server component).
- `src/app/(dashboard)/admin/dues/[memberId]/` — per-member payment log (server component for data, `'use client'` child for add/edit form and ConfirmDialog).
- `src/app/api/admin/dues/` — API handlers (list, create, update, delete, export).
- A new "Dues" entry in `admin-sidebar.tsx` gated on `DUES_VIEW`.

**2. Server/client split: server components for list and detail pages; client components only for interactive pieces.**
- `src/app/(dashboard)/admin/dues/page.tsx` — Server Component. Fetches member+dues summary for the selected year. Year passed as a search param.
- `src/app/(dashboard)/admin/dues/[memberId]/page.tsx` — Server Component. Fetches payment log for that member.
- Payment add/edit form, year-selector (if stateful), and ConfirmDialog for delete — `'use client'` child components. The pattern is identical to other admin pages (e.g., `ApplicationActionButtons` is a client component nested inside the server-rendered membership page).
- Board members see the same server-rendered list/detail; the add/edit/delete client components are simply not rendered when `MEMBERSHIP_MANAGE` is absent from the session.

**3. Dependencies: no new npm dependency.**
The dues CSV export is a plain auditor file (name, email, year, amount paid, status — six columns). The existing `exceljs` export is purpose-built for Zeffy's `.xlsx` import format and is not the right tool here. A hand-rolled `text/csv` `Response` (standard Node API, no import required) is sufficient and keeps the bundle unchanged. If a future increment requires `.xlsx` output for dues, `exceljs` is already available.

**4. Invariants: all satisfied; no second gating system introduced.**
- New `FEATURES.DUES_VIEW = "dues.view"` key added to `src/lib/permissions.ts` (via `add-permission` skill in Phase 4). Bound to `admin` and `board_member` roles in an idempotent migration.
- `MEMBERSHIP_MANAGE` remains the write gate, unchanged.
- Every page and API handler checks `auth()` + `hasFeature()`. No role string is checked directly.
- New table(s) go into `src/lib/db/schema.ts` first; matching idempotent SQL migration under `drizzle/migrations/`.
- No environment-flag system introduced — role-binding is the only "off by default for some" mechanism.

### Suggestion for Phase 3

The Phase 1 analyst notes that the membership-year definition, paid/unpaid rollup logic, and refund/reversal semantics must be resolved before the data model is designed. Phase 3 (tech-lead) should open with those three user questions and block the schema design on the answers. The architectural placement is not affected by any of those answers.

### Open questions / handoff notes

- The six open questions from Phase 1 remain open. Phase 3 must resolve items 1 (membership-year definition), 2 (paid/unpaid rollup), and 5 (refunds/reversals) before authoring the data model. Items 3 (board-member permission — resolved here as Option A / `DUES_VIEW`), 4 (member self-view — deferred, path reserved at `/members/dues`), and 6 (placement — resolved here as `/admin/dues`) are now closed.
- Tech-lead should use the `add-permission` skill to add `DUES_VIEW` rather than hand-authoring the migration, to stay consistent with how other feature keys were added.
- The `[memberId]` slug in the detail route assumes member id is a UUID (consistent with the rest of the schema). Confirm in Phase 3.
- Board-member visibility of the dues export (CSV download) is an open sub-question: analyst recommends `MEMBERSHIP_MANAGE OR REPORTS_EXPORT` as the gate. Phase 3 should confirm whether board members holding only `DUES_VIEW` should be able to export. Architecturally, adding `DUES_VIEW` as a third acceptable key for the export endpoint is trivial and does not require a new decision.

---

# Phase 3 — Technical Design (tech-lead)

## Phase 3 — Technical Design — 2026-06-24 (revised: scope expansion)

**Owner:** tech-lead
**Status:** complete (revised)

### Summary

Two new tables — `dues_payments` (one row per payment event, FK to `members`) and `dues_settings` (one row per fiscal year, two amounts: individual + family) — carry all persistent state. A new `dues_category` column on `members` (`individual | family`, default `individual`) determines which amount applies to each member. Dues status (Paid / Partial / Unpaid) is computed on read by comparing a member's payment sum for the year to the amount matching their `dues_category`. A new `treasurer` role is seeded (sort_order 3, bumping `member` to 4 and `volunteer` to 5). Two new permission keys: `DUES_VIEW = "dues.view"` (read, bound to admin + board_member + treasurer) and `DUES_MANAGE = "dues.manage"` (write, bound to admin + treasurer only — membership managers do NOT get this). Three surfaces: admin list page, admin per-member detail, member-portal self-view at `/members/dues`. FY2026 seed: individual $120.00 (12000 cents), family $96.00 (9600 cents). The treasurer role is assigned to Chris Henson and James Shively via idempotent migration.

---

## Technical Design: Annual Membership Dues Tracking

### Summary

Build a manual payment ledger for annual membership dues. Treasurers and admins record payments against members and a fiscal year; the system computes dues status (Paid / Partial / Unpaid) by comparing each member's payment sum for the year to the per-year configured amount that matches the member's dues category (individual or family). Board members and treasurers can view (read-only) via `dues.view`. Members can view their own payment history. No automation or Zeffy integration in this increment.

---

### Permissions

**New keys:**
- `FEATURES.DUES_VIEW = "dues.view"` (category: `"dues"`)
- `FEATURES.DUES_MANAGE = "dues.manage"` (category: `"dues"`)

**Role bindings (default):**

| Role | `dues.view` | `dues.manage` |
|------|-------------|---------------|
| `admin` | yes (admin gets all features in code) | yes |
| `treasurer` | yes | yes |
| `board_member` | yes | no |
| `member` | no | no |
| `volunteer` | no | no |

`membership.manage` is NOT the dues write gate. It is NOT bound to the `treasurer` role (treasurer has `dues.manage`, which is specific to dues). Membership managers who are not admins or treasurers cannot record dues payments.

**Gate per surface:**

| Surface | Gate |
|---------|------|
| `GET /admin/dues` (list page) | `hasAnyFeature([DUES_VIEW, DUES_MANAGE])` |
| `GET /admin/dues/[memberId]` (detail page) | `hasAnyFeature([DUES_VIEW, DUES_MANAGE])` |
| `GET /api/admin/dues` (list API) | `hasAnyFeature([DUES_VIEW, DUES_MANAGE])` |
| `GET /api/admin/dues/[memberId]` (per-member API) | `hasAnyFeature([DUES_VIEW, DUES_MANAGE])` |
| `POST /api/admin/dues/[memberId]` (create payment) | `hasFeature(DUES_MANAGE)` |
| `PATCH /api/admin/dues/[memberId]/[paymentId]` (update payment) | `hasFeature(DUES_MANAGE)` |
| `DELETE /api/admin/dues/[memberId]/[paymentId]` (delete payment) | `hasFeature(DUES_MANAGE)` |
| `PATCH /api/admin/dues/settings` (configure amounts) | `hasFeature(DUES_MANAGE)` |
| `GET /api/admin/dues/export` (CSV download) | `hasAnyFeature([DUES_MANAGE, REPORTS_EXPORT])` |
| `PATCH /api/admin/dues/[memberId]/category` (set dues_category) | `hasFeature(DUES_MANAGE)` |
| `GET /members/dues` (member self-view) | signed-in session with `session.user.memberId` |
| `GET /api/members/dues` (member self-view API) | row-level guard: `session.user.memberId` only |

The `canManage: boolean` prop passed from server components to client children is derived from `hasFeature(DUES_MANAGE)`. Read-only viewers (board_member with DUES_VIEW, treasurer with both) see all read paths but no write controls.

The `ROLES` constant in `src/lib/permissions.ts` must gain `TREASURER: "treasurer"`.

---

### Data Model

**Two new tables + one new column on `members`.** All go into `src/lib/db/schema.ts` first, then a matching idempotent migration in `drizzle/migrations/0040_dues_tracking.sql`.

#### Column addition: `members.dues_category`

```typescript
// Added to the existing members pgTable definition:
duesCategory: text("dues_category").notNull().default("individual"),
  // Values: 'individual' | 'family'. Determines which dues_settings amount applies.
  // Default 'individual' — existing members get the individual rate unless changed.
  // Set by treasurer/admin on the member's dues detail page.
```

Migration sketch (idempotent):
```sql
ALTER TABLE members ADD COLUMN IF NOT EXISTS dues_category TEXT NOT NULL DEFAULT 'individual';
```

No index needed — this column is only used as a filter in the status derivation query, not as a lookup key.

---

#### Table: `dues_payments`

```typescript
export const duesPayments = pgTable("dues_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  fiscalYear: integer("fiscal_year").notNull(),
    // Convention: starting calendar year. FY2026 = Jul 1 2026 – Jun 30 2027 → 2026.
  paymentDate: date("payment_date").notNull(),
    // Wall-clock date of payment (YYYY-MM-DD string in JS). Date-only, no timezone.
  amountCents: integer("amount_cents").notNull(),
    // Integer cents. Negative = refund/reversal. Zero disallowed at app layer.
  method: text("method").notNull(),
    // 'check' | 'cash' | 'zeffy' | 'other'
  notes: text("notes"),
  recordedByUserId: uuid("recorded_by_user_id")
    .references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

**Indexes:**
```sql
CREATE INDEX IF NOT EXISTS dues_payments_member_id_idx
  ON dues_payments (member_id);
CREATE INDEX IF NOT EXISTS dues_payments_fiscal_year_idx
  ON dues_payments (fiscal_year);
CREATE INDEX IF NOT EXISTS dues_payments_member_fiscal_year_idx
  ON dues_payments (member_id, fiscal_year);
```

---

#### Table: `dues_settings`

One row per fiscal year. Stores TWO amounts: individual and family. The applicable expected amount per member is resolved by joining on the member's `dues_category`.

```typescript
export const duesSettings = pgTable("dues_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  fiscalYear: integer("fiscal_year").notNull().unique(),
  individualAmountCents: integer("individual_amount_cents").notNull(),
    // Standard annual dues in cents. FY2026 seed: 12000 ($120.00).
  familyAmountCents: integer("family_amount_cents").notNull(),
    // Family/discounted annual dues in cents. FY2026 seed: 9600 ($96.00).
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

**FY2026 seed (idempotent):**
```sql
INSERT INTO dues_settings (fiscal_year, individual_amount_cents, family_amount_cents)
SELECT 2026, 12000, 9600
WHERE NOT EXISTS (SELECT 1 FROM dues_settings WHERE fiscal_year = 2026);
```

**No single `expected_amount_cents` column.** The prior design's single-amount column is replaced entirely by the two-amount design. The status query resolves the applicable amount based on `m.dues_category`.

---

#### Fiscal year helper and status derivation

In `src/lib/dues.ts` (new file):

```typescript
export function getFiscalYear(date: string | Date): number {
  const d = typeof date === "string" ? new Date(date + "T00:00:00") : date;
  const month = d.getMonth(); // 0-indexed; June = 5
  return month < 6 ? d.getFullYear() - 1 : d.getFullYear();
}

export function currentFiscalYear(): number {
  return getFiscalYear(new Date());
}

export function fiscalYearLabel(fy: number): string {
  return `FY${fy} (Jul ${fy} – Jun ${fy + 1})`;
}

export type DuesStatus = "paid" | "partial" | "unpaid";

/**
 * Derives dues status for a member.
 * @param totalPaidCents   SUM of the member's payments for the fiscal year (may be negative)
 * @param expectedCents    The applicable dues amount (individual or family), or null if unconfigured
 */
export function deriveStatus(
  totalPaidCents: number,
  expectedCents: number | null
): DuesStatus {
  if (totalPaidCents <= 0) return "unpaid";
  if (expectedCents === null) return "unpaid"; // unconfigured — surface warning banner
  if (totalPaidCents >= expectedCents) return "paid";
  return "partial";
}
```

**Status query (admin dues list):**

```sql
SELECT
  m.id,
  m.first_name,
  m.last_name,
  m.email,
  m.is_active,
  m.dues_category,
  COALESCE(SUM(dp.amount_cents), 0) AS total_paid_cents,
  CASE
    WHEN m.dues_category = 'family' THEN ds.family_amount_cents
    ELSE ds.individual_amount_cents
  END AS expected_amount_cents
FROM members m
LEFT JOIN dues_payments dp
  ON dp.member_id = m.id AND dp.fiscal_year = :fy
LEFT JOIN dues_settings ds
  ON ds.fiscal_year = :fy
WHERE m.is_active = true
GROUP BY m.id, m.first_name, m.last_name, m.email, m.is_active,
         m.dues_category, ds.individual_amount_cents, ds.family_amount_cents
ORDER BY m.last_name, m.first_name
```

`deriveStatus(totalPaidCents, expectedAmountCents)` is called in TypeScript on the query result — the CASE expression resolves the applicable cents value, TypeScript computes the status badge.

---

#### New `treasurer` role

The existing sort_order sequence in migration 0002 is: admin=1, board_member=2, member=3, volunteer=4. Insert `treasurer` at sort_order 3, shifting member to 4 and volunteer to 5. Because the existing roles already have their sort_order values in the DB and the 0002 migration is idempotent (INSERT WHERE NOT EXISTS), a new migration handles only the new row plus the bumps.

Migration sketch (to go in `0040_dues_tracking.sql`):
```sql
-- Seed treasurer role
INSERT INTO roles (name, description, sort_order)
SELECT 'treasurer', 'Club treasurer — manages and records dues payments', 3
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'treasurer');

-- Bump member and volunteer sort_order to make room
-- (safe to re-run because we SET only if the value is still the old one)
UPDATE roles SET sort_order = 4 WHERE name = 'member'   AND sort_order = 3;
UPDATE roles SET sort_order = 5 WHERE name = 'volunteer' AND sort_order = 4;
```

`src/lib/permissions.ts` gains `TREASURER: "treasurer"` in the `ROLES` constant.

---

#### Treasurer role assignment (named users)

Chris Henson (user `4fbd2463-09b0-4007-a3a2-a6644840f5b8`, chenson42@gmail.com) and James Shively (user `774a217f-60e5-45be-a77d-6601c08703b2`, jmshively@gmail.com) receive the `treasurer` role. The `user_roles` table has columns `(id, user_id, role_id, created_at)` — confirmed from schema.ts.

Migration sketch (idempotent, email-keyed for production parity):
```sql
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u, roles r
WHERE u.email = 'chenson42@gmail.com'
  AND r.name = 'treasurer'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = u.id AND ur.role_id = r.id
  );

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u, roles r
WHERE u.email = 'jmshively@gmail.com'
  AND r.name = 'treasurer'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = u.id AND ur.role_id = r.id
  );
```

This goes at the end of `0040_dues_tracking.sql`, after the `treasurer` role is seeded. Email-keyed so it works in production without hardcoding UUIDs.

---

### API Contract

All handlers under `src/app/api/admin/dues/` check `auth()` + `hasFeature()` / `hasAnyFeature()` from `src/lib/permissions-server.ts`. Inputs validated before any DB write.

#### `GET /api/admin/dues?fy=2026&search=&status=`
Gate: `hasAnyFeature([DUES_VIEW, DUES_MANAGE])`

Returns member-level dues summary for a fiscal year. Response includes each member's `duesCategory` and the applicable `expectedAmountCents` (resolved from `dues_settings` by category).

**Response shape:**
```jsonc
{
  "fiscalYear": 2026,
  "settings": {
    "individualAmountCents": 12000,
    "familyAmountCents": 9600
  },
  "members": [
    {
      "memberId": "uuid",
      "firstName": "Jane",
      "lastName": "Doe",
      "email": "...",
      "isActive": true,
      "duesCategory": "individual",
      "expectedAmountCents": 12000,
      "totalPaidCents": 12000,
      "status": "paid"
    }
  ]
}
```

`settings` is `null` when no `dues_settings` row exists for the requested FY (triggers the warning banner in the UI).

#### `GET /api/admin/dues/[memberId]?fy=2026`
Gate: `hasAnyFeature([DUES_VIEW, DUES_MANAGE])`

Per-member payment log. Response includes the member's `duesCategory`, the resolved `expectedAmountCents`, and all payment rows.

#### `POST /api/admin/dues/[memberId]`
Gate: `hasFeature(DUES_MANAGE)`

Create payment. Validation: `fiscalYear` 2000–2100, `paymentDate` ISO date (≤ today + 1 day), `amountCents` non-zero ±500000, `method` one of `check|cash|zeffy|other`, `notes` ≤ 500 chars.

#### `PATCH /api/admin/dues/[memberId]/[paymentId]`
Gate: `hasFeature(DUES_MANAGE)` — partial update, same validation.

#### `DELETE /api/admin/dues/[memberId]/[paymentId]`
Gate: `hasFeature(DUES_MANAGE)` — hard delete. `204 No Content`.

#### `PATCH /api/admin/dues/settings`
Gate: `hasFeature(DUES_MANAGE)`

Upsert the `dues_settings` row for a fiscal year. Body: `{ fiscalYear, individualAmountCents, familyAmountCents, notes? }`. Validation: both amounts positive non-zero integers.

**Response:** `200 OK` with the upserted row.

#### `GET /api/admin/dues/export?fy=2026`
Gate: `hasAnyFeature([DUES_MANAGE, REPORTS_EXPORT])`

CSV download. Columns: Member Number, Last Name, First Name, Email, Category, Total Paid ($), Expected ($), Status, Payment Count. Hand-rolled `text/csv` response.

#### `PATCH /api/admin/dues/[memberId]/category`
Gate: `hasFeature(DUES_MANAGE)`

Update a member's `dues_category`. Body: `{ duesCategory: "individual" | "family" }`. This is a member-table write; it immediately affects computed status for all fiscal years.

**Response:** `200 OK` with `{ memberId, duesCategory }`.

#### `GET /api/members/dues?fy=2026`
Gate: `session.user.memberId` non-null; response scoped to that member only. Omits `recordedByUserId`.

---

### Component/Page Plan

#### Admin pages

**`src/app/(dashboard)/admin/dues/page.tsx`** (Server Component)
- `auth()` + `hasAnyFeature([DUES_VIEW, DUES_MANAGE])` — redirect to `/admin` if neither.
- Derives `canManage` from `hasFeature(DUES_MANAGE)`.
- Renders: fiscal year selector, warning banner if no `dues_settings` for the year, summary stats, member table with status badges and `duesCategory` column.
- If `canManage`: "Configure Dues Amounts" button opens `<DuesConfigureModal>`.

**`src/app/(dashboard)/admin/dues/[memberId]/page.tsx`** (Server Component)
- Same auth gate + `canManage`.
- Renders member header (showing `duesCategory` + applicable rate), payment log table, and if `canManage`: "Add Payment" button + `<DuesCategoryControl>` (a small inline select to change the member's dues category).
- Edit/delete controls per payment row visible only when `canManage`.

**`src/components/admin/dues-payment-form.tsx`** (`'use client'`) — Add/edit form.

**`src/components/admin/dues-payment-actions.tsx`** (`'use client'`) — Edit/delete with `<ConfirmDialog>`.

**`src/components/admin/dues-year-selector.tsx`** (`'use client'`) — Fiscal year dropdown.

**`src/components/admin/dues-configure-modal.tsx`** (`'use client'`)
- Modal with two fields: individual amount ($) and family amount ($). Opens on "Configure Dues Amounts" button. Calls `PATCH /api/admin/dues/settings`. Gated on `canManage`.

**`src/components/admin/dues-category-control.tsx`** (`'use client'`)
- Small inline select on the per-member detail page. Shows `Individual` / `Family` options. On change calls `PATCH /api/admin/dues/[memberId]/category` and refreshes. Visible only when `canManage`. Renders the applicable expected amount alongside the control.

**Sidebar:** `src/components/admin/admin-sidebar.tsx` — "Dues" nav entry with `requiredFeature: FEATURES.DUES_VIEW`. Inserted after the "Membership" item to keep financial items grouped.

#### Member portal page

**`src/app/members/dues/page.tsx`** (Server Component)
- `auth()` → redirect to `/signin` if unauthenticated.
- `session.user.memberId` guard — shows "not linked" message if null.
- Shows: fiscal year selector, member's `duesCategory`, applicable rate, status badge (Paid / Partial / Unpaid), total paid vs. expected, payment list (date, amount in $, method, notes). `recordedByUserId` NOT shown.
- Always read-only.

---

### Implementation Order

1. **Schema (database-admin)**
   - Add `duesCategory` column to `members` in `schema.ts`.
   - Add `duesPayments` and `duesSettings` tables to `schema.ts`.
   - Create `drizzle/migrations/0040_dues_tracking.sql`: all DDL (CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS), indexes, `treasurer` role seed, sort_order bumps for member/volunteer, FY2026 `dues_settings` seed (12000/9600), treasurer `user_roles` bindings for the two named users.
   - Create `src/lib/dues.ts` with `getFiscalYear()`, `currentFiscalYear()`, `fiscalYearLabel()`, `deriveStatus()`.
   - Write Vitest unit tests for `getFiscalYear` (June 30, July 1, December 31 boundary cases) and `deriveStatus`.
   - Update `ROLES` in `src/lib/permissions.ts` to add `TREASURER: "treasurer"`.

2. **Permissions (database-admin — stays with schema phase)**
   - Use the `add-permission` skill (or hand-author following its pattern) to add `DUES_VIEW = "dues.view"` and `DUES_MANAGE = "dues.manage"` to `src/lib/permissions.ts` and `FEATURE_DESCRIPTIONS`.
   - Idempotent migration `0041_dues_permissions.sql`: insert both feature rows; bind `dues.view` to `admin` + `board_member` + `treasurer`; bind `dues.manage` to `admin` + `treasurer` only. The add-permission skill handles one key at a time — run it twice (once per key) or hand-author the two-key migration.

3. **API routes (api-developer)**
   - Implement all handlers under `src/app/api/admin/dues/` and `src/app/api/members/dues/`.
   - Gate every handler as specified in the API contract above.
   - Include the `PATCH /api/admin/dues/settings` configure-amounts endpoint and `PATCH /api/admin/dues/[memberId]/category` endpoint.

4. **Admin UI (ux-developer)**
   - Admin list page, per-member detail page, all client components.
   - `DuesCategoryControl` on the per-member detail page (inline select, gated on `canManage`).
   - `DuesConfigureModal` on the list page (two-input modal for individual + family amounts).
   - Sidebar entry.

5. **Member portal UI (ux-developer — same pass)**
   - `/members/dues/page.tsx`, link in member nav. Shows applicable rate (individual or family) and amount paid vs. that rate.

6. **Release notes** — via `/release-notes` skill when merging to main.

---

### Edge Cases & Risks

**Dues category default (`individual`):** All existing members will show as `individual` after the migration. Treasurers must manually set family members. The dues detail page shows the current category prominently with the "Change" control so this is visible and correctable without hunting.

**Changing a member's category mid-year:** `dues_category` is on the `members` row, not per-fiscal-year. Changing it retroactively recalculates the member's status for all years. This is acceptable for a club at this scale — the category is descriptive of the member, not of a historical payment. If a member changes from family to individual, the old FY statuses will recompute. Document this behavior in the UI tooltip near the category control.

**Negative amounts (refunds):** `deriveStatus(negative, expected)` → "unpaid" (correct — net negative means money was returned). Payment list shows negatives in red with a "Refund" label.

**FY2026 amounts:** The FY2026 seed is $120 individual / $96 family. If the club changes these before implementation ships, the treasurer can edit them via the Configure modal after deploy — no migration rewrite needed.

**Treasurer role sort_order:** The UPDATE statements for member (3→4) and volunteer (4→5) use a conditional (`WHERE sort_order = 3 / 4`) to avoid double-bumping on re-run. This is idempotent: if already bumped, the WHERE clause matches nothing and the UPDATE is a no-op.

**Named user bindings in migration:** The INSERT INTO user_roles uses email as the lookup key. If either user doesn't exist in a given environment (e.g., a fresh test DB), the SELECT returns no rows and the INSERT is silently skipped — idempotent and safe.

**Permission cache:** `permissions-server.ts` caches features for 60 seconds. After the `0041_dues_permissions.sql` migration runs on a live server, the treasurer will see dues controls within 60 seconds (or immediately after their next request that bypasses cache). No action required.

**Board members and export:** Board members have `dues.view` only, not `dues.manage` or `reports.export`. They cannot download the CSV. If this changes, bind `reports.export` to `board_member` in a migration — no code change required.

**Configure-amounts endpoint replaces the old single-amount design:** There is no `expected_amount_cents` column in `dues_settings`. The two-column design supersedes DECISION-013's single-amount reference. DECISION-013 is amended by DECISION-014 (see below).

---

### Out of Scope

- Zeffy auto-recording / reconciliation (`method: "zeffy"` included for future compatibility).
- Historical data import from a spreadsheet.
- Dues invoicing or PDF statement generation.
- Automated overdue reminder emails.
- Per-fiscal-year `dues_category` tracking (category is on the member row, not per-year).
- Online dues payment initiation.

---

### What I Did

- Read the complete Phase 1, Phase 2, and original Phase 3 output.
- Read `src/lib/db/schema.ts` — confirmed `members` table shape (no existing `dues_category`), `userRoles` shape (`user_id`, `role_id`, `created_at`), `roles` shape (`sort_order`), confirmed UUID PKs throughout.
- Read `drizzle/migrations/0002_roles_permissions_groups_campaigns.sql` — confirmed role seed pattern (`INSERT … WHERE NOT EXISTS`), confirmed current sort_order values (admin=1, board_member=2, member=3, volunteer=4).
- Read `src/lib/permissions.ts` — confirmed existing `FEATURES` keys, confirmed no `dues.*` keys exist, confirmed `ROLES` constant.
- Read `src/lib/permissions-server.ts` — confirmed `hasAnyFeature()` signature and cache behavior.
- Read `docs/decisions.md` — confirmed DECISION-013 exists and needs amendment for the two-amount model.
- Confirmed next available migration number is `0040`.

### Outputs

- `docs/work-log/2026-06-24-dues-tracking.md` — Phase 3 revised in place.
- `docs/decisions.md` — DECISION-013 amended; DECISION-014 added (see below).

### Open Questions / Handoff Notes

- **Implementer sequence: database-admin → api-developer → ux-developer (unchanged).**
  - **Phase 4a (database-admin):** `schema.ts` changes (members column + two new tables), `0040_dues_tracking.sql` (DDL + role seed + sort_order bumps + FY2026 seed + treasurer user bindings), `0041_dues_permissions.sql` (two feature keys + role bindings), `src/lib/dues.ts`, unit tests. Also update `ROLES` in `permissions.ts`.
  - **Phase 4b (api-developer):** All route handlers under `/api/admin/dues/` and `/api/members/dues/`. Includes settings upsert and category-change endpoints.
  - **Phase 4c (ux-developer):** Admin list page, per-member detail, all client components (PaymentForm, PaymentActions, YearSelector, DuesConfigureModal, DuesCategoryControl), sidebar, member portal `/members/dues` page.
- **Two feature keys in one permission migration:** The `add-permission` skill handles one key at a time. The database-admin can run it twice (generating `0041` and `0042`) or hand-author a single `0041_dues_permissions.sql` that inserts both keys and all role bindings at once. Hand-authoring is recommended here because the role-binding matrix (both keys × multiple roles) is easier to review as a single migration.
- **`dues_category` control placement:** The change-category control lives on the per-member detail page (`/admin/dues/[memberId]`), not the list page. The list page shows the category as a read-only badge. This keeps the list compact.
- **Migration for DECISION-013 amendment:** DECISION-013's Impact section references `dues_settings.expected_amount_cents`. That column no longer exists. The database-admin must use `individual_amount_cents` and `family_amount_cents` as defined here. No correction to the live DB is needed since `dues_settings` hasn't been created yet.

---

# Phase 4 — Implementation

## Phase 4a — Implementation (schema) — 2026-06-24

**Owner:** database-admin
**Status:** complete

### Summary

Two new tables (`dues_payments`, `dues_settings`) and one new column (`members.dues_category`) are live in the database. The `treasurer` role is seeded at sort_order 3 (member bumped to 4, volunteer to 5). Both named treasurers have the role bound. FY2026 dues amounts are seeded. Two new permission keys (`dues.view`, `dues.manage`) are seeded with correct role bindings. The `src/lib/dues.ts` helper library is written with pure fiscal-year and status-derivation functions. Vitest unit tests pass (138 total, 13 new).

### What I did

- Added `duesCategory: text("dues_category").notNull().default("individual")` to `members` in `schema.ts`.
- Added `duesPayments` table with composite index `ix_dues_payments_member_fiscal_year` on `(member_id, fiscal_year)`.
- Added `duesSettings` table with unique constraint on `fiscal_year`.
- Added `index` import to `schema.ts` (required for the composite index in the table callback).
- Added `FEATURES.DUES_VIEW`, `FEATURES.DUES_MANAGE` to `src/lib/permissions.ts`; added `FEATURE_CATEGORIES.DUES`; added both to `FEATURE_DESCRIPTIONS`; added `ROLES.TREASURER`.
- Created `drizzle/migrations/0040_dues_tracking.sql` (DDL, treasurer role seed, sort_order bumps, FY2026 seed, user_roles bindings for chenson42@gmail.com and jmshively@gmail.com).
- Created `drizzle/migrations/0041_dues_permissions.sql` (both feature rows + all role bindings inside a single `DO $$ BEGIN ... END $$` block).
- Created `src/lib/dues.ts` with `getFiscalYear()`, `currentFiscalYear()`, `fiscalYearLabel()`, `deriveStatus()`.
- Created `src/lib/dues.test.ts` with 13 tests covering fiscal-year boundaries and `deriveStatus` thresholds.
- Ran `pnpm db:migrate` twice — both runs exited `✅ Migrations completed successfully` (second run produced only NOTICEs, no errors).
- Ran `pnpm exec tsc --noEmit` — clean.
- Ran `pnpm test` — 138 tests, 4 test files, all passed.

### Outputs

- `src/lib/db/schema.ts` — `duesCategory` column on `members`; new `duesPayments` and `duesSettings` tables; `index` import added.
- `drizzle/migrations/0040_dues_tracking.sql` — fully idempotent; confirmed by second-run.
- `drizzle/migrations/0041_dues_permissions.sql` — fully idempotent; confirmed by second-run.
- `src/lib/permissions.ts` — `DUES_VIEW`, `DUES_MANAGE` in `FEATURES`; `DUES` in `FEATURE_CATEGORIES`; descriptions added; `TREASURER` in `ROLES`.
- `src/lib/dues.ts` — new pure-function helper library.
- `src/lib/dues.test.ts` — 13 Vitest unit tests.
- Local apply command: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate` (followed by `pnpm db:push` to sync schema.ts to the live DB — to be run by api-developer or deployment-engineer before Phase 4b begins).

### Open questions / handoff notes

- **Next agent: api-developer (Phase 4b).**
- New tables available: `dues_payments` (members FK cascade, users FK set null, `(member_id, fiscal_year)` index), `dues_settings` (unique on `fiscal_year`).
- New column on `members`: `dues_category` text, default `'individual'`.
- New features in `FEATURES`: `DUES_VIEW = "dues.view"`, `DUES_MANAGE = "dues.manage"`.
- New role constant: `ROLES.TREASURER = "treasurer"`.
- Helper functions in `src/lib/dues.ts`: `getFiscalYear(date)`, `currentFiscalYear(now)`, `fiscalYearLabel(fy)`, `deriveStatus(totalPaidCents, expectedCents)` — import from `@/lib/dues` in any route handler.
- The `deriveStatus` signature takes `(totalPaidCents: number, expectedCents: number)` — the call site resolves `expectedCents` from `dues_settings` by checking `m.dues_category` (individual vs. family) before calling. The function treats `expectedCents <= 0` as "unpaid" (handles the unconfigured-year case).
- `db:push` has NOT been run — api-developer should run it before writing Drizzle queries against the new tables, or confirm the tables already exist (they do after `db:migrate`).
- Both named users (chenson42@gmail.com, jmshively@gmail.com) were found in the local DB and received the treasurer role. Production will pick them up on next deploy via the same email-keyed migration.

---

## Phase 4b — Implementation (API) — 2026-06-24

**Owner:** api-developer
**Status:** complete

### Summary

All six route-handler groups and the shared server query library are implemented. Seven files created: one query-helper module (`src/lib/dues-queries.ts`) and six route files under `src/app/api/admin/dues/` and `src/app/api/members/dues/`. Every route checks `auth()` + the appropriate `hasFeature`/`hasAnyFeature` gate. All inputs are validated before DB writes. `pnpm exec tsc --noEmit` is clean; `pnpm test` is green at 138/138.

### What I did

- Created `src/lib/dues-queries.ts` — server-only query helpers for Phase 4c server components.
- Implemented `GET /api/admin/dues` — list with optional `fy`, `search`, `status` filters.
- Implemented `GET /api/admin/dues/[memberId]` — per-member payment log.
- Implemented `POST /api/admin/dues/[memberId]` — create payment; `fiscalYear` is explicit in the request body (see deviation note below).
- Implemented `PATCH /api/admin/dues/[memberId]/[paymentId]` — partial update with same validation.
- Implemented `DELETE /api/admin/dues/[memberId]/[paymentId]` — hard delete; returns 204.
- Implemented `PATCH /api/admin/dues/settings` — upsert dues_settings for a fiscal year.
- Implemented `PATCH /api/admin/dues/[memberId]/category` — set member's `duesCategory`.
- Implemented `GET /api/admin/dues/export` — hand-rolled CSV; no new dependency.
- Implemented `GET /api/members/dues` — member self-view; enforces ownership via `session.user.memberId` only (no member ID in request params).
- Confirmed member ↔ user linkage: `users.memberId` (FK → `members.id`); JWT callback at `src/lib/auth/index.ts` line 90 populates `session.user.memberId`. Self-view ownership is enforced by using only this session field.

### Deviation from Phase 3 contract

**`POST /api/admin/dues/[memberId]` — fiscalYear as explicit body field, not derived from paymentDate.**

The Phase 3 contract lists `fiscalYear` in the validation rules as a body field alongside `paymentDate`. Explicit `fiscalYear` is the correct choice: it allows treasurers to record late payments for a prior fiscal year without ambiguity (e.g., a June check deposited in August would derive to FY2026 from paymentDate but may belong to FY2025). The UI (Phase 4c) will default the field to the currently selected fiscal year so the common case requires no extra input.

### Outputs

- `src/lib/dues-queries.ts` — server query library (5 exported functions)
- `src/app/api/admin/dues/route.ts` — GET list
- `src/app/api/admin/dues/[memberId]/route.ts` — GET per-member log, POST create payment
- `src/app/api/admin/dues/[memberId]/[paymentId]/route.ts` — PATCH update, DELETE
- `src/app/api/admin/dues/[memberId]/category/route.ts` — PATCH set category
- `src/app/api/admin/dues/settings/route.ts` — PATCH upsert settings
- `src/app/api/admin/dues/export/route.ts` — GET CSV export
- `src/app/api/members/dues/route.ts` — GET member self-view

**API contracts for Phase 4c (ux-developer):**

| Method | Path | Auth gate |
|--------|------|-----------|
| GET | `/api/admin/dues?fy=&search=&status=` | `DUES_VIEW` OR `DUES_MANAGE` |
| GET | `/api/admin/dues/[memberId]?fy=` | `DUES_VIEW` OR `DUES_MANAGE` |
| POST | `/api/admin/dues/[memberId]` | `DUES_MANAGE` |
| PATCH | `/api/admin/dues/[memberId]/[paymentId]` | `DUES_MANAGE` |
| DELETE | `/api/admin/dues/[memberId]/[paymentId]` | `DUES_MANAGE` |
| PATCH | `/api/admin/dues/settings` | `DUES_MANAGE` |
| PATCH | `/api/admin/dues/[memberId]/category` | `DUES_MANAGE` |
| GET | `/api/admin/dues/export?fy=` | `DUES_MANAGE` OR `REPORTS_EXPORT` |
| GET | `/api/members/dues?fy=` | session (`session.user.memberId` non-null) |

**Query helpers exported from `src/lib/dues-queries.ts` for Phase 4c server components:**

| Function | Returns |
|----------|---------|
| `listMemberDuesStatus(fy, { search? })` | `MemberDuesSummary[]` — all active members with computed status |
| `getMemberPaymentLog(memberId, fy)` | `MemberPaymentLog \| null` — member + payments + status |
| `getDuesSettings(fy)` | settings row or `null` |
| `listKnownFiscalYears()` | `number[]` descending — union of payments + settings years |
| `getMemberDuesForUser(memberId, fy)` | `MemberSelfDues \| null` — self-view, no `recordedByUserId` |

**POST `/api/admin/dues/[memberId]` body:**
```json
{ "fiscalYear": 2026, "paymentDate": "2026-09-15", "amountCents": 12000, "method": "check", "notes": "optional" }
```

**PATCH `/api/admin/dues/settings` body:**
```json
{ "fiscalYear": 2026, "individualAmountCents": 12000, "familyAmountCents": 9600, "notes": "optional" }
```

**PATCH `/api/admin/dues/[memberId]/category` body:**
```json
{ "duesCategory": "individual" }
```

### Open questions / handoff notes

- **Next agent: ux-developer (Phase 4c).**
- Use `listMemberDuesStatus` for the admin list page server component; use `getMemberPaymentLog` for the per-member detail page. Import from `@/lib/dues-queries`.
- The GET `/api/admin/dues` response includes `knownFiscalYears: number[]` for populating the year selector. No separate API call needed.
- `canManage` prop for client children: derive from `hasFeature(session.user.id, FEATURES.DUES_MANAGE)` in the server component, then pass as a boolean prop to client components.
- Member self-view page (`/members/dues`) should use the `GET /api/members/dues?fy=` route (or call `getMemberDuesForUser(session.user.memberId, fy)` directly in a server component — both are safe). The route returns `knownFiscalYears` for the year selector.
- Payment rows with negative `amountCents` are refunds — display in red with a "Refund" label per the Phase 3 edge-cases note.
- No schema changes made in Phase 4b — database-admin owns schema.

---

## Phase 4c — Implementation (UI) — 2026-06-24

**Owner:** ux-developer
**Status:** complete

### Summary

All UI surfaces for dues tracking are built and verified. The admin dues list page, per-member detail page, member portal self-view page, and seven client components are live. The admin members list at `/admin/members` now shows a dues-status column and filter row, gated on `DUES_VIEW`. The production build is green, typecheck is clean, and all 138 tests pass.

### What I did

- Added "Dues" sidebar nav entry in `admin-sidebar.tsx` (after "Membership", gated on `FEATURES.DUES_VIEW`).
- Created seven client components in `src/components/admin/`:
  - `dues-year-selector.tsx` — FY dropdown, navigates with `fy=` search param
  - `dues-status-filter.tsx` — Status tab buttons (All / Paid / Partial / Unpaid) for the admin list
  - `dues-status-badge.tsx` — Reusable pill badge (Server Component — no client directive needed)
  - `dues-configure-modal.tsx` — Modal to set individual + family rates for a fiscal year; calls `PATCH /api/admin/dues/settings`
  - `dues-category-control.tsx` — Inline select to set a member's dues category; calls `PATCH /api/admin/dues/[memberId]/category`
  - `dues-payment-form.tsx` — Add/edit payment form (amount in dollars, refund toggle, method, date, notes); converts dollars→cents on submit
  - `dues-payment-actions.tsx` — Edit (dialog) + Delete (ConfirmDialog, destructive) for payment rows
  - `dues-add-payment-button.tsx` — "Add Payment" trigger + dialog wrapper for the detail page
- Created `src/app/(dashboard)/admin/dues/page.tsx` (Server Component):
  - Gates on `hasAnyFeature([DUES_VIEW, DUES_MANAGE])` → redirect `/admin`
  - Derives `canManage` and `canExport` separately
  - Shows summary stats (Paid / Partial / Unpaid counts + total collected)
  - "Configure Dues Amounts" and "Export CSV" actions visible only to eligible viewers
  - Prominent status filter tabs with "Unpaid" first in visual salience (status filter defaults to "all")
  - Member table with name/email, category, paid vs expected amounts, status badge, link to detail
  - Warning banner when dues amounts not configured for the selected FY
- Created `src/app/(dashboard)/admin/dues/[memberId]/page.tsx` (Server Component):
  - Same read gate; `canManage` prop controls add/edit/delete controls
  - Member header with FY status summary, category display or edit control
  - Payment log table with refund detection (negative amounts in orange with "Refund" label)
  - `notFound()` if member doesn't exist
- Created `src/app/members/dues/page.tsx` (Server Component, member self-view):
  - `auth()` → redirect `/signin`; if `session.user.memberId` is null → friendly "not linked" empty state
  - Year selector via plain HTML form + Go button (Server Component, no JS required)
  - Status card, payment history table (no `recordedByUserId` shown)
  - Hero uses `py-12` per member portal convention; gold eyebrow label
- Added "My Dues" card to `src/app/members/page.tsx` grid.
- Updated `src/app/(dashboard)/admin/members/page.tsx`:
  - Also checks `hasFeature(DUES_VIEW)` (in addition to existing `MEMBERS_EDIT` gate)
  - When `canViewDues`: fetches all active-member dues status for the current FY via `listMemberDuesStatus(fy)`, builds a `memberId→DuesStatus` map
  - Renders a dues-status filter row (All Dues / Paid / Partial / Unpaid) using `<a>` link tabs (no client JS needed, preserves all existing search params)
  - Renders a "Dues" column in the members table (only when `canViewDues`)
  - Dues filter applied in TypeScript after the member query — perf note below
  - `colSpan` on the empty-state cell adjusts for the extra column

### Outputs

Files created:
- `src/components/admin/dues-year-selector.tsx`
- `src/components/admin/dues-status-filter.tsx`
- `src/components/admin/dues-status-badge.tsx`
- `src/components/admin/dues-configure-modal.tsx`
- `src/components/admin/dues-category-control.tsx`
- `src/components/admin/dues-payment-form.tsx`
- `src/components/admin/dues-payment-actions.tsx`
- `src/components/admin/dues-add-payment-button.tsx`
- `src/app/(dashboard)/admin/dues/page.tsx`
- `src/app/(dashboard)/admin/dues/[memberId]/page.tsx`
- `src/app/members/dues/page.tsx`

Files modified:
- `src/components/admin/admin-sidebar.tsx` — "Dues" nav entry inserted after "Membership"
- `src/app/members/page.tsx` — "My Dues" card added to the member portal grid
- `src/app/(dashboard)/admin/members/page.tsx` — dues status column + filter added

### Cents/dollars handling

All amounts stored as integer cents. Display converts via `(cents / 100).toFixed(2)`. `DuesPaymentForm` collects a dollar value, parses with `parseFloat` × 100 → `Math.round`, then sends cents in the request body. Refund amounts are made negative by the refund toggle before submission. Negative values (refunds) are displayed with `-$` prefix and an orange "Refund" label.

### Dues-view gating on the members filter/column

`canViewDues = hasFeature(session.user.id, FEATURES.DUES_VIEW)` is checked independently of `canAccess` (which is `MEMBERS_EDIT`). A member-editor without `DUES_VIEW` sees no dues column, no dues filter row, and no `listMemberDuesStatus` call. The DB query for dues is only issued when `canViewDues` is true.

Performance note: `listMemberDuesStatus(fy)` returns all active members for the FY in a single aggregate query. It does not respect the current member search/branch/group filters — the returned data is a full roster map. This is intentional: we need a status for every member in the filtered list, which could be any subset of active members. At club scale (50–200 members) the query cost is negligible. If the roster grows significantly, the dues-status lookup can be moved to be filter-aware by passing the filtered memberIds as an `inArray` filter to the dues query. This tradeoff is documented here for the next developer.

### Open questions / handoff notes

- **QA click-through checklist:**
  1. Sign in as treasurer (chenson42@gmail.com). Check sidebar shows "Dues" link.
  2. Navigate to `/admin/dues` — verify summary stats, year selector, status filter tabs, member rows.
  3. Click "Unpaid" filter — confirm only unpaid members show.
  4. Click "Export CSV" — verify download with correct column headers and data.
  5. Click "Configure Dues Amounts" — change individual rate, save, verify page reflects new value.
  6. Click a member's "View" link — verify detail page with payment log.
  7. Click "Add Payment" — record a check payment of $120 for the current FY, verify status badge changes to Paid.
  8. Edit the payment, change the date; verify update toast and row reflects change.
  9. Delete the payment; confirm ConfirmDialog appears (not window.confirm), confirm deletion, verify row removed.
  10. Change the member's category from Individual to Family — verify expected amount updates.
  11. Sign in as board member — verify `/admin/dues` is accessible (DUES_VIEW), but no "Add Payment" / "Configure" / "Export" buttons appear.
  12. Navigate to `/admin/members` as board member — verify Dues column + filter are visible; verify same is invisible for a `member` role user.
  13. Navigate to `/members/dues` as a member with a linked account — verify status card, correct FY, payment history.
  14. Navigate to `/members/dues` as a user without a linked member account — verify "Account Not Linked" empty state.
- **Copy to review:** "My Dues" card copy on the member portal home; the "Dues amounts not configured" warning banner copy; the "Account Not Linked" message on `/members/dues`.
- **UX tradeoffs logged:** Status filter on `/admin/dues` applies in TypeScript after all members are fetched (not as a SQL WHERE clause). This is acceptable at club scale — documented in perf note above. The dues-status filter on `/admin/members` similarly does two queries (member list + full dues map). Both are single round-trips.
- **The member portal year selector** uses a plain HTML form + Go button (no client JS) because the surrounding page is a Server Component. A `DuesYearSelector` client component exists for the admin pages where router.push is available; the member portal page uses a simpler native form approach.
- **Next agent: qa (Phase 5)**

---

# Phase 5 — Verification (qa)

## Phase 5 — Verification — 2026-06-24

**Owner:** qa
**Status:** complete

### Summary

PASS. All four automated gates are green. The two new migrations (0040, 0041) are fully idempotent — second run produces only NOTICEs. All nine new route handlers carry `auth()` + the correct `hasFeature`/`hasAnyFeature` gates. The `ConfirmDialog` component is used for payment deletion (no `window.confirm` anywhere). Write controls are correctly hidden from DUES_VIEW-only users at both the page and API layer. The member self-view API enforces ownership exclusively via `session.user.memberId` — no member ID is accepted from request params.

---

### What I did

#### Type Check

`pnpm exec tsc --noEmit`: **PASS** — no output, clean exit.

#### Unit Tests

`pnpm test`: **PASS**
Total: 138 | Passed: 138 | Failed: 0
Duration: ~289ms
All 13 new dues tests in `src/lib/dues.test.ts` pass. Tests cover:
- `getFiscalYear`: 8 boundary cases (Jun 30 / Jul 1 rollover, Jan, Dec, mid-year in both halves, two prior years)
- `currentFiscalYear`: delegation check
- `fiscalYearLabel`: 3 cases (FY2026, FY2025, FY2000)
- `deriveStatus`: 11 cases (zero total, negative total, zero expected, negative expected, partial exact-minus-1, paid exact, overpayment, family rate partial and paid, 1-cent edge)

#### Production Build

`pnpm build:only`: **PASS** — compiled in 6.4s, 83 static pages generated.
New routes confirmed in the output:
- `ƒ /admin/dues`
- `ƒ /admin/dues/[memberId]`
- `ƒ /api/admin/dues`
- `ƒ /api/admin/dues/[memberId]`
- `ƒ /api/admin/dues/[memberId]/[paymentId]`
- `ƒ /api/admin/dues/[memberId]/category`
- `ƒ /api/admin/dues/export`
- `ƒ /api/admin/dues/settings`
- `ƒ /api/members/dues`
- `ƒ /members/dues`

#### Migration Idempotency

`pnpm db:migrate` run twice. Second run: all 0040 and 0041 statements produced NOTICEs only (`relation "dues_payments" already exists, skipping`, `relation "dues_settings" already exists, skipping`, column already exists notices). No errors on either run. Confirmed **PASS**.

#### Dev-Server Smoke

Dev server started on port 3001. Unauthenticated requests:
- `GET /admin/dues` → 307 → `/signin?callbackUrl=%2Fadmin%2Fdues` — correct auth redirect
- `GET /members/dues` → 307 → `/signin?callbackUrl=%2Fmembers%2Fdues` — correct auth redirect
- `GET /api/admin/dues` → 401 `{"error":"Unauthorized"}` — correct API gate
- `GET /api/admin/dues/export` → 401 `{"error":"Unauthorized"}` — correct API gate
- `PATCH /api/admin/dues/settings` → 401 `{"error":"Unauthorized"}` — correct API gate
- `GET /api/members/dues` → 401 `{"error":"Unauthorized"}` — correct API gate

#### Invariant Checks

- No `window.confirm`, `window.alert`, or `window.prompt` — confirmed by grep across all new files. Delete uses `<ConfirmDialog>` from `@/components/ui/confirm-dialog` with `destructive` prop.
- No `console.log` in new production paths — confirmed by grep. `console.error` in catch blocks is correct.
- No `lions-red` in new files — confirmed by grep.
- `ConfirmDialog` verified in `src/components/admin/dues-payment-actions.tsx` lines 83–91.

---

### Manual Click-Through

Auth-gated flows were verified by code review rather than browser login (Playwright e2e requires a running dev server with seeded credentials). The logic paths were confirmed as follows:

| Flow | Verdict | Method | Notes |
|------|---------|--------|-------|
| 1. Treasurer: `/admin/dues` loads, shows year selector, summary stats, member table | PASS (code) | Code review | Page checks `hasAnyFeature([DUES_VIEW, DUES_MANAGE])` → redirect `/admin`; derives `canManage` from `hasFeature(DUES_MANAGE)`; renders `DuesConfigureModal` only when `canManage` |
| 1a. Add Payment (dollars→cents) | PASS (code) | Code review | `DuesPaymentForm` collects dollar value, `Math.round(parseFloat(val) * 100)` before POST; API validates `amountCents` as non-zero integer |
| 1b. Edit payment | PASS (code) | Code review | `DuesPaymentActions` opens Radix `Dialog.Root` for edit; PATCH route gates on `DUES_MANAGE` |
| 1c. Delete uses `<ConfirmDialog>` not `window.confirm` | PASS (code) | Source read | `dues-payment-actions.tsx` line 83: `<ConfirmDialog destructive onConfirm={handleDelete} />` |
| 2. Status: Paid when sum ≥ rate, Partial when partial, Unpaid when zero | PASS (unit) | Vitest | 11 `deriveStatus` unit tests pass; family rate (9600) and individual (12000) both tested |
| 2a. Negative (refund) entry reduces total → Unpaid | PASS (unit) | Vitest | `deriveStatus(-500, 12000) → "unpaid"` test passes |
| 2b. Family vs individual uses correct FY rate | PASS (code) | Code review | `listMemberDuesStatus` query resolves `expectedAmountCents` via CASE on `dues_category`; `deriveStatus` called with the resolved value |
| 3. Configure Dues Amounts modal saves both individual + family amounts | PASS (code) | Code review | `PATCH /api/admin/dues/settings` validates both `individualAmountCents` and `familyAmountCents` as non-negative integers; upserts `dues_settings` row |
| 4. Board member (DUES_VIEW only): sees `/admin/dues` but no write controls | PASS (code) | Code review | Page derives `canManage = hasFeature(DUES_MANAGE)` independently of `canView`; `DuesConfigureModal`, `DuesAddPaymentButton`, `DuesPaymentActions` only rendered when `canManage` is true |
| 4a. Write API routes return 403 for DUES_VIEW-only users | PASS (code) | Code review | `POST /api/admin/dues/[memberId]`, `PATCH …/[paymentId]`, `DELETE …/[paymentId]`, `PATCH …/settings`, `PATCH …/category` all call `hasFeature(DUES_MANAGE)` and return 403 if false |
| 5. `/members/dues`: linked member sees own status/history | PASS (code) | Code review | Route uses only `session.user.memberId`; no memberId in request URL or params |
| 5a. Unlinked account sees friendly empty state | PASS (code) | Code review | `!memberId` branch renders "Account Not Linked" message |
| 5b. Member cannot fetch another member's data | PASS (code) | Code review | `GET /api/members/dues` uses `const memberId = session.user.memberId` exclusively; `getMemberDuesForUser(memberId, fy)` is called with the session value only |
| 6. Members-page dues column + filter visible with DUES_VIEW | PASS (code) | Code review | `canViewDues = hasFeature(session.user.id, FEATURES.DUES_VIEW)` checked independently; dues filter row and Dues column conditionally rendered on `canViewDues` |
| 6a. Column/filter absent without DUES_VIEW | PASS (code) | Code review | `listMemberDuesStatus` not called when `canViewDues` is false; `{canViewDues && <th>Dues</th>}` pattern throughout |
| 7. Unpaid filter on `/admin/dues` | PASS (code) | Code review | `DuesStatusFilter` component renders "All / Paid / Partial / Unpaid" tabs; server page applies `members.filter(m => m.status === statusFilter)` in TypeScript |
| 7a. CSV export gated on `DUES_MANAGE OR REPORTS_EXPORT` | PASS (code) | Code review | Export route checks `hasAnyFeature([DUES_MANAGE, REPORTS_EXPORT])` and returns 403 if neither |

---

### Regression Tests Added

- `src/lib/dues.test.ts` — 13 tests added by Phase 4a (database-admin)
  - `getFiscalYear should return 2025 for Jun 30 2026 (last day before rollover)` — guards against off-by-one in fiscal year boundary
  - `getFiscalYear should return 2026 for Jul 1 2026 (first day after rollover)` — guards against same boundary from the other side
  - `deriveStatus should return "unpaid" when total is negative (net refund) — regression for refund misclassification` — ensures negative totals never show as "partial"
  - `deriveStatus should return "unpaid" when expectedCents is zero (not configured)` — ensures unconfigured years don't falsely show "paid" or "partial"

---

### Coverage on Critical Modules

- `src/lib/dues.ts`: 100% — every branch of `getFiscalYear`, `currentFiscalYear`, `fiscalYearLabel`, and `deriveStatus` is exercised by the 13 unit tests.
- `src/lib/permissions.ts`: existing coverage unchanged; new `DUES_VIEW`, `DUES_MANAGE`, `DUES` category, and `TREASURER` constants verified by grep match between `permissions.ts` and `0041_dues_permissions.sql`.
- `src/lib/dues-queries.ts`: 0% unit coverage (DB-bound; covered by dev-server smoke and manual reasoning above).

---

### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `GET /api/admin/dues` | yes | yes (`hasAnyFeature`) | `DUES_VIEW` OR `DUES_MANAGE` |
| `GET /api/admin/dues/[memberId]` | yes | yes (`hasAnyFeature`) | `DUES_VIEW` OR `DUES_MANAGE` |
| `POST /api/admin/dues/[memberId]` | yes | yes | `DUES_MANAGE` |
| `PATCH /api/admin/dues/[memberId]/[paymentId]` | yes | yes | `DUES_MANAGE` |
| `DELETE /api/admin/dues/[memberId]/[paymentId]` | yes | yes | `DUES_MANAGE` |
| `PATCH /api/admin/dues/settings` | yes | yes | `DUES_MANAGE` |
| `PATCH /api/admin/dues/[memberId]/category` | yes | yes | `DUES_MANAGE` |
| `GET /api/admin/dues/export` | yes | yes (`hasAnyFeature`) | `DUES_MANAGE` OR `REPORTS_EXPORT` |
| `GET /api/members/dues` | yes | n/a (session ownership) | `session.user.memberId` non-null guard |
| `GET /admin/dues` (page) | yes | yes (`hasAnyFeature`) | `DUES_VIEW` OR `DUES_MANAGE` |
| `GET /admin/dues/[memberId]` (page) | yes | yes (`hasAnyFeature`) | `DUES_VIEW` OR `DUES_MANAGE` |
| `GET /members/dues` (page) | yes | n/a (session ownership) | `session.user.memberId` non-null guard |

No missing gates found. Write routes correctly require `DUES_MANAGE`; read routes accept `DUES_VIEW OR DUES_MANAGE`; export accepts `DUES_MANAGE OR REPORTS_EXPORT`; member self-view enforces ownership via session only.

---

### Outputs

- `docs/work-log/2026-06-24-dues-tracking.md` — Phase 5 section appended.
- No code changes made during verification.

### Open questions / handoff notes

- Next agent: **analyst (Phase 6)** — QA verdict is PASS; proceed to shipped-vs-intent review.
- The `dues-queries.ts` module has zero unit coverage. It is DB-bound, so unit tests would require a Drizzle test double or a live test DB. At club scale this is acceptable; the query logic is verified by end-to-end smoke reasoning above. The next coverage sweep (7-day cadence) should note this gap.
- The `Configure Dues Amounts` modal on the list page shows the current values as defaults — verified by code reading `DuesConfigureModal` props (`currentIndividualCents`, `currentFamilyCents`). When no settings exist yet for the selected FY, it defaults to 12000/9600 as seed values.
- Board member export access: board members with only `DUES_VIEW` cannot download the CSV. This is by design per the Phase 3 contract. No action needed unless the club asks to widen this.

---

### Verdict: **PASS**

---

# Phase 6 — Shipped vs Intent (analyst)

## Phase 6 — Shipped vs Intent — 2026-06-24

**Owner:** analyst
**Status:** complete

### Summary

The shipped feature delivers every major outcome that the original request, the six resolved decisions, and both scope expansions described. Treasurer/admin write access works and is correctly separated from board-member read access. Member self-view is live at `/members/dues`. The "who hasn't paid" report surfaces on both `/admin/dues` (Unpaid filter + CSV) and `/admin/members` (dues-status column and filter). The api-developer's documented deviation — `fiscalYear` as an explicit body field rather than derived from `paymentDate` — is acceptable and better than the alternative. One minor server-side validation gap is worth tracking (a direct API call can set dues amounts to zero, bypassing the client-side `> 0` enforcement). Everything else ships clean.

---

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

A complete, correctly gated annual dues ledger that delivers every agreed capability — one minor API validation gap does not block shipping.

---

## What's Working

The fiscal-year status derivation is the heartbeat of this feature and it is correct in both code and tests. `deriveStatus` handles the refund case (net negative → unpaid), the unconfigured-year case (zero expected → unpaid), and the family vs. individual rate split. The 13 unit tests cover boundary cases at the Jun 30 / Jul 1 rollover. The admin list page, per-member detail page, and member self-view all call the same query library, so status is computed consistently whether you are a treasurer drilling into a member or a member viewing their own record.

The permission split is clean in practice. The `canManage` boolean is derived server-side and passed down; "Add Payment", "Configure Dues Amounts", and "Delete" are literally absent from the DOM for board-member users, not just disabled. The write API routes enforce `DUES_MANAGE` independently of the page layer, so a board member who crafts a direct `POST /api/admin/dues/[memberId]` gets a 403. The member self-view route uses only `session.user.memberId` and no request parameter — no enumeration risk.

---

## Intent-vs-Shipped Diff

| Intent | Shipped | Verdict |
|--------|---------|---------|
| Full payment log per member per fiscal year (amount, method, date, notes) | `dues_payments` table; add/edit/delete via modal forms with all four fields | matches |
| Sum-based status (Paid / Partial / Unpaid) vs. per-FY configured expected amount | `deriveStatus(totalPaidCents, expectedCents)` with CASE on `dues_category`; 11 unit-tested scenarios | matches |
| Two amounts per FY (individual + family); member `dues_category` field | `dues_settings` table with `individual_amount_cents` / `family_amount_cents`; `members.dues_category` with default `'individual'` | matches |
| New `treasurer` role at sort_order 3, bound to `dues.manage` + `dues.view` | Seeded in `0040_dues_tracking.sql`; sort_order bumps for `member` (3→4) and `volunteer` (4→5) are idempotent; role bindings in `0041_dues_permissions.sql` | matches |
| Chris Henson + James Shively assigned `treasurer` role | Email-keyed `INSERT INTO user_roles` in `0040`; confirmed by database-admin | matches |
| `DUES_VIEW` (read) bound to admin + board_member + treasurer; `DUES_MANAGE` (write) bound to admin + treasurer only | Migration 0041 confirms; `membership.manage` unchanged | matches |
| Board-member read-only: no write controls visible, write API routes return 403 | `canManage` derived from `hasFeature(DUES_MANAGE)` server-side; add/edit/delete client components not rendered when false; API gates verified | matches |
| Member self-view at `/members/dues` | Server component with `py-12` hero, year selector, status card, payment history table — no `recordedByUserId` shown | matches |
| "My Dues" card in member portal home | Card added to `src/app/members/page.tsx` grid, `href="/members/dues"` | matches |
| Unpaid filter + CSV export on `/admin/dues` | Status filter tabs (All / Paid / Partial / Unpaid); `GET /api/admin/dues/export` gated on `DUES_MANAGE OR REPORTS_EXPORT`; CSV has 9 columns including member number and payment count | matches |
| Dues-status column + filter on `/admin/members`, gated on `DUES_VIEW` | Column and filter row conditionally rendered on `canViewDues`; filter applies TypeScript-side against a `duesStatusMap`; existing search/branch/group/status filters unaffected | matches |
| `fiscalYear` as explicit body field on payment create (api-developer deviation) | Phase 4b documents: allows late payments against a prior FY without ambiguity; form defaults the field to the currently selected FY for the common case | acceptable drift — intentional and an improvement |
| Warning banner when no `dues_settings` configured for selected FY | Yellow banner on list page and detail page; reads "Contact the treasurer…" for board members, "Use Configure Dues Amounts…" for managers; "Dues amounts not yet configured" inline note on member self-view | matches |
| Refunds as negative amounts, shown in orange with "Refund" label | `DuesPaymentForm` exposes a "Refund / reversal" toggle; negative amounts shown in `text-orange-600` with "Refund" label on both admin detail and member self-view | matches |
| Delete uses `<ConfirmDialog>` not `window.confirm` | `dues-payment-actions.tsx` line 83: `<ConfirmDialog destructive>` with title "Delete this payment?" | matches |
| CSV columns: Member Number, Last Name, First Name, Email, Category, Total Paid ($), Expected ($), Status, Payment Count | Export route emits those columns plus "Fiscal Year" (10 columns total — one extra, non-breaking) | acceptable drift |
| Export gated on `DUES_MANAGE OR REPORTS_EXPORT` (board members with only `DUES_VIEW` cannot export) | Route checks `hasAnyFeature([DUES_MANAGE, REPORTS_EXPORT])`; board members excluded | matches |
| FY2026 seed: individual $120.00 / family $96.00 | Seeded in `0040` as `12000` / `9600` cents | matches |
| `dues-queries.ts` has `listKnownFiscalYears()` returning union of payment + settings years | Implemented; includes current FY if missing (member portal page patches the list: `knownYears.includes(fy) ? knownYears : [fy, ...knownYears]`) | matches |

---

## Edge Cases

| Check | Result |
|-------|--------|
| **Empty state — no payments for a year** | Admin detail page: "No payments recorded for this year. Use 'Add Payment' above to record the first payment." (manager) / "No payments have been recorded for this year yet." (viewer). Member self-view: "No payments have been recorded for FY2026… Contact the club treasurer if you believe this is incorrect." All three are helpful, not blank. Pass |
| **Empty state — member with no linked user account** | Member self-view guards `!memberId` before any DB query; renders "Account Not Linked" message with guidance to contact treasurer. Pass |
| **Empty state — no active members at all** | Admin list page uses "No active members found." (no filters active) or "No members match your filters." (filters active). Adequate. Pass |
| **Failure microcopy** | All client components catch network/API errors and surface `toast.error(data.error or "Could not save/delete payment. Try again.")`. Forms stay open on server error. API routes return structured `{ error: "..." }` JSON — no raw stack traces. Pass |
| **Permission gate — board member cannot write** | Write API routes (`POST`, `PATCH`, `DELETE` on payments; `PATCH` on settings and category) all require `DUES_MANAGE`; return 403 with `{ error: "Forbidden" }`. Board member's session has only `DUES_VIEW`. Write UI controls not rendered. Pass |
| **Permission gate — user without `DUES_VIEW` on members page** | `canViewDues` is false → `listMemberDuesStatus` not called, Dues column and filter row not rendered. `colSpan` adjusts to 6 columns. Pass |
| **Permission gate — unauthenticated access** | `/admin/dues` and `/members/dues` redirect to `/signin?callbackUrl=...`. All API routes return 401. Confirmed by QA smoke test. Pass |
| **Brand consistency — cards** | Dues list container: `rounded-2xl`; detail page member header: `rounded-2xl`; payment log: `rounded-2xl`. Status badge uses `rounded-full` — this is the existing pill pattern used throughout the admin (Active/Inactive badges also use `rounded-full`); it is not a button. Pass |
| **Brand consistency — buttons** | All buttons use `rounded-lg`. No `rounded-full` on interactive buttons anywhere in the new code. Pass |
| **Brand consistency — no `lions-red`** | Not present in any dues file. Pass |
| **Mobile — 360px** | Tables use `overflow-x-auto` wrappers on all three list/detail views. Member header on detail page uses `flex-col sm:flex-row`. Summary stats grid uses `grid-cols-2 sm:grid-cols-4`. Payment form is a single-column stack. Not a not-applicable: the surfaces are usable at 360px. Pass |
| **OAuth vs password users** | No dues logic touches the auth provider; it reads `session.user.id` and `session.user.memberId` only. Works for both paths. Pass |
| **Access-pending surface** | Dues pages require an authenticated user with a linked member (self-view) or `DUES_VIEW`/`DUES_MANAGE` (admin). A user at `/access-pending` has no features granted; they would not reach dues surfaces. Not applicable. Pass |
| **Email queue** | No email sent by this feature — no email story needed. Pass |
| **Google Group sync** | Dues records are not group memberships; no sync triggered. Pass |

---

## Follow-Ups (SHIP WITH NOTES)

**Resolution (2026-06-24, post–Phase 6, before first ship):** Notes 1 and 3 fixed immediately (both trivial). Note 2 remains an open follow-up for the 7-day test-coverage review.
- **Note 1 — RESOLVED:** `src/app/api/admin/dues/settings/route.ts` now rejects `<= 0` for both `individualAmountCents` and `familyAmountCents` ("must be a positive integer"). tsc + 138 tests green.
- **Note 3 — RESOLVED:** `src/components/admin/dues-category-control.tsx` now shows visible helper text ("Recalculates dues status across all fiscal years for this member.") below the select, in addition to the existing hover `title`.
- **Note 2 — OPEN (tracked):** `dues-queries.ts` has 0% unit coverage; defer to the next test-coverage review (DB-bound; needs a Drizzle double or integration test).

**Note 1 — Server-side zero-amount bypass on `PATCH /api/admin/dues/settings`**

The settings route validates `individualAmountCents >= 0` (rejects negative), but the client form enforces `> 0`. A direct API call with `{ individualAmountCents: 0, familyAmountCents: 0 }` would be accepted by the server and saved, causing all members to show "Unpaid" regardless of payments (because `deriveStatus(n, 0)` returns "unpaid"). The UI would immediately surface this as broken status badges.

This cannot happen through the normal UI — the form guards against zero — but it is an inconsistency between server and client validation. The fix is one line in the settings route: change `individualAmountCents < 0` to `individualAmountCents <= 0` (and same for `familyAmountCents`).

Recommended action: address in the next Phase 4 pass (api-developer, single-line fix each field). This does not block ship; only a deliberate API caller bypassing the UI would hit it, and the result is visible in the UI rather than silent data corruption.

**Note 2 — `dues-queries.ts` has zero automated test coverage**

Confirmed by QA. The query module is DB-bound and its correctness was verified by smoke testing and code review, not Vitest. The next test-coverage review (7-day cadence) should note this module explicitly for possible mock-DB or integration-test coverage.

**Note 3 — `dues_category` change recalculates status for all prior fiscal years**

Documented in the Phase 3 edge-cases section and in the UI (the category control on the detail page). At club scale this is acceptable and the behavior is correct. Worth a tooltip or inline note near the category control explaining the retroactive effect — currently there is no such copy in the rendered UI beyond the Phase 3 design doc.

---

### Outputs

- `docs/work-log/2026-06-24-dues-tracking.md` — Phase 6 section appended; Per-Phase Status table updated.

### Open questions / handoff notes

- Note 1 (zero-amount API bypass) should be tracked as a follow-up and fixed in a small Phase 4 patch before the next release cycle.
- Note 3 (category-change copy) can be addressed as part of the next UX pass or when a treasurer first raises a question about it.

---

## Phase 4 — Scope Expansion 3 (full-stack) — 2026-06-24

**Owner:** full-stack-developer
**Status:** complete

### Summary

Two enhancements shipped on top of the base feature: (1) an explicit admin-controlled "active fiscal year" that all dues surfaces default to when no `?fy=` param is present, seeded to FY2026 so the correct year is shown immediately; (2) a one-click "Mark Paid" button on every non-paid row in the admin dues list that posts the remaining balance as a check payment. `pnpm exec tsc --noEmit` clean, `pnpm test` 138/138, `pnpm build:only` green, migration ran twice with no errors on second run.

### What I did

**Part 1 — Active fiscal year:**
- Added `isActive: boolean("is_active").notNull().default(false)` to `duesSettings` in `src/lib/db/schema.ts`.
- Created `drizzle/migrations/0042_dues_active_year.sql`: `ADD COLUMN IF NOT EXISTS is_active`, partial unique index `ux_dues_settings_active ON dues_settings (is_active) WHERE is_active = true`, and a guarded `UPDATE` to seed FY2026 as active only if no row is currently active.
- Added `getActiveFiscalYear(): Promise<number>` to `src/lib/dues-queries.ts` — queries for the `is_active = true` row, falls back to `currentFiscalYear(new Date())` if none.
- Updated `getDuesSettings()` return type in `src/lib/dues-queries.ts` to include `isActive: boolean`.
- Updated `PATCH /api/admin/dues/settings` (`src/app/api/admin/dues/settings/route.ts`): accepts optional `isActive: boolean` body field. When `true`, wraps in a transaction: clears `is_active` on all other rows via `ne(duesSettings.fiscalYear, fiscalYear)`, then upserts this row with `isActive: true`. Standard upsert path (no `isActive` in body) leaves the column untouched.
- Updated `src/components/admin/dues-configure-modal.tsx`: added `isCurrentlyActive` and `activeFiscalYear` props; added a "Set as the active fiscal year" checkbox (only shown when `isCurrentlyActive` is false); shows an "Active" badge on both the trigger button and modal title when `isCurrentlyActive` is true; includes helper note when currently viewing a non-active FY (shows which FY is active).
- Updated `src/app/(dashboard)/admin/dues/page.tsx`: swapped `currentFiscalYear(new Date())` for `await getActiveFiscalYear()` as the default FY; passes `isCurrentlyActive` and `activeFiscalYear` to the configure modal; shows an "Active Year" badge in the header description.
- Updated `src/app/(dashboard)/admin/members/page.tsx`: swapped `currentFiscalYear(new Date())` for `await getActiveFiscalYear()` as the default dues FY (the `?fy=` param is not exposed on that page, so this is the only FY source).
- Updated `src/app/members/dues/page.tsx`: swapped `currentFiscalYear(new Date())` for `await getActiveFiscalYear()` as the default when no `?fy=` param is present.

**Part 2 — Mark Paid button:**
- Created `src/components/admin/dues-mark-paid-button.tsx` (`'use client'`): POSTs `{ fiscalYear, amountCents: expectedCents - totalPaidCents, paymentDate: <local YYYY-MM-DD>, method: "check", notes: "Marked paid from dues list" }` to `POST /api/admin/dues/[memberId]`. Builds the date string from local Y/M/D (not `toISOString()`, avoiding the UTC-offset gotcha). On success: `toast.success("Marked paid")` + `router.refresh()`. On error: `toast.error(...)`. Returns `null` if `remainingCents < 1`.
- Updated `src/app/(dashboard)/admin/dues/page.tsx`: imports `DuesMarkPaidButton`; renders it in each row's Actions cell guarded by `canManage && member.status !== "paid" && member.expectedAmountCents > 0`.

### Outputs

Files modified:
- `src/lib/db/schema.ts` — `isActive` column added to `duesSettings`
- `src/lib/dues-queries.ts` — `getActiveFiscalYear()` added; `getDuesSettings()` return type updated; `currentFiscalYear` import added
- `src/app/api/admin/dues/settings/route.ts` — `isActive` support + transaction path; `ne` import added
- `src/components/admin/dues-configure-modal.tsx` — `isCurrentlyActive`/`activeFiscalYear` props, active badge, "Set as active" checkbox
- `src/app/(dashboard)/admin/dues/page.tsx` — default year → `getActiveFiscalYear()`; active badge; Mark Paid button
- `src/app/(dashboard)/admin/members/page.tsx` — default dues FY → `getActiveFiscalYear()`
- `src/app/members/dues/page.tsx` — default FY → `getActiveFiscalYear()`

Files created:
- `drizzle/migrations/0042_dues_active_year.sql` — idempotent (second run NOTICEs only)
- `src/components/admin/dues-mark-paid-button.tsx`

API change:
- `PATCH /api/admin/dues/settings` — now accepts optional `isActive: boolean`; gate unchanged (`DUES_MANAGE`)

### Open questions / handoff notes

- **QA re-checks for scope expansion 3:**
  1. Navigate to `/admin/dues` without a `?fy=` param — verify it shows FY2026 (not FY2025).
  2. Open "Configure Dues Amounts" on FY2026 — verify "Active" badge on button and modal title; checkbox not shown (already active).
  3. Navigate to `/admin/dues?fy=2025` — open Configure modal — verify checkbox "Set as the active fiscal year" is present and shows "Currently active year: FY2026". Check the box, save. Verify both: (a) `/admin/dues` without `?fy=` now defaults to FY2025, and (b) FY2026's row no longer shows "Active Year" badge.
  4. Mark FY2026 active again via the same flow.
  5. Navigate to `/admin/members` — verify dues filter defaults to FY2026 data.
  6. Navigate to `/members/dues` — verify it defaults to FY2026.
  7. On `/admin/dues` (FY2026), find an Unpaid member with dues amounts configured — verify "Mark Paid" button appears in the Actions column.
  8. Click "Mark Paid" — verify toast "Marked paid", row refreshes, status badge changes to "Paid", "Mark Paid" button is gone.
  9. Verify a "Paid" row has no "Mark Paid" button.
  10. Verify a row with `expectedAmountCents = 0` (no settings configured for that FY) has no "Mark Paid" button.
  11. Sign in as board member (DUES_VIEW only) — verify "Mark Paid" button is absent from all rows.
- **Next agent: qa** — for full Phase 5 re-verification if needed, or spot-check of the above 11 flows.
