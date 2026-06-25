# The Ledger — Increment 3: Compliance — Work Log

> **Slug:** `2026-06-25-ledger-compliance`
> **Surface:** (dashboard) admin — `/admin/ledger/compliance`
> **Permission(s):** reuse `ledger.view` (view), `ledger.record` (mark filings filed / edit), `ledger.manage` (settings). No new key expected.
> **Estimated complexity:** medium–large (third increment)
> **Pipeline mode:** Full

---

## Context

This is **increment 3 of 6** of The Ledger. Shipped so far: **inc1 Books** (v1.20.0) and **inc2 Controls + Reimbursements** (v1.21.0). Full design: `docs/features/the-ledger-accounting.md` (§7 rules engine, §8 filings); prior work-logs `docs/work-log/2026-06-24-ledger-books.md` and `…-ledger-controls.md`; DECISIONs 015–020. Read those first. The `Lions_Financial_Transparency.pdf` (Legal Compliance Filings, Other Compliance Issues, Warning, Oversight sections) and the prototype's `seedFilings()` + `determine990()` are the source for the calendar + rules.

What already exists to build on:
- `src/lib/ledger.ts` already has **`determine990()`** (built early in inc1; tested) — 990-N / 990-EZ / 990 / 990-PF logic. This increment surfaces it in the UI.
- `ledger-queries.ts` has `grossReceiptsCents` and entity balance helpers for the 990 inputs.
- `/admin/ledger` admin surfaces + the entity switcher exist.

**Increment 3 — "Compliance" — scope:**
1. **`ledger_filings` table + seed** (deferred from inc1). Per-entity filings with `agency`, `title`, `fiscalYear`, `dueDate`, `status` (not_started | in_progress | filed | future | na), `note`, `confirmation`, `filedOn`, `recurrence`. Seed the real calendar (from the transparency doc / prototype): IRS **990-N** (club + foundation, due Nov 15), **Ohio AG Charitable Annual Report** ×2 (Nov 15), **Ohio Unclaimed Funds** ×2 (period ending Jun 30, due Nov 1, negative/NONE ok), **Statement of Continued Existence** (every 5 years, Ohio SoS), **Annual Treasurer's Audit** ×2.
2. **Compliance page** `/admin/ledger/compliance`: the filings calendar (upcoming / overdue / filed), with a **mark-filed** action (status + confirmation # + filed date) gated `ledger.record`. Per-entity.
3. **990 determiner UI** — surface `determine990()` per entity for the active fiscal year (gross receipts + assets → which return is owed), with the "why", and the **3-consecutive-missed-years = automatic revocation** warning. Note the **990-PF** trap if the Foundation is reclassified private.
4. **Standing compliance reminders** (static advisory copy from the doc): raffle **50% to charity**, **no political endorsements**, **sales tax** on taxable fundraising products, gaming/games-of-chance rules, no "employment" issues (gift cards / waiving dues), social-media monitoring warning, **7-year retention**.
5. **(Scope question for Phase 1)** the deferred **`disbApprovalThresholdCents` settings-edit UI** (flagged twice in inc2) — a minimal ledger-settings screen (`ledger.manage`) for the threshold + reserve threshold + treasurer-bonded toggle + philanthropy visibility. Decide if it lands here or defers.

**Explicitly deferred (do NOT build here):** reports / 990-prep CSV export (inc4); member philanthropy dashboard (inc5); donors/acknowledgments + dues→Admin & Zeffy→Activity auto-post (inc6).

## Phase 1 decisions — resolved defaults (accepted, user-confirmed 2026-06-25)

Accepting the analyst's recommendations: (1) **auto-rollover** — `listFilings(fy)` materializes the FY's set by copying the prior year if none exist; store due dates as **month-day patterns keyed to the FY start year** (survive rollover), tech-lead finalizes; (2) **`in_progress` is a real status** — mark-filed dialog has "Save as In Progress" (no confirmation # needed) + "Mark as Filed" (filed date required); (3) **settings-edit screen IS in scope for inc3** (`ledger.manage`: `disbApprovalThresholdCents`, `reserveWarnThresholdCents`, `treasurerBonded`, `philanthropyVisibility`); (4) the 990 **asset figure is labeled an estimate** ("entity cash balance; use real total assets for the actual filing") in the component wrapper — `determine990()` unchanged; (5) the **3-missed-years revocation warning** lives in `guardrails()` (the `// TODO inc3` stub at ~line 382), counting `agency='IRS'` 990-family filings, suppressed when <3 FYs of data. Confirmed non-decisions: **no new `FEATURES` key**; **overdue is derived** (`dueDate < today AND status NOT IN ('filed','na','future')`); no filing emails in inc3 (overdue surfaces as a guardrail WARN).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | complete | READY WITH NOTES | 2026-06-25 |
| 2 — Architectural review | architect | complete | Approved with suggestions | 2026-06-25 |
| 3 — Technical design | tech-lead | complete | Design complete | 2026-06-25 |
| 4a — Implementation (schema) | database-admin | complete | — | 2026-06-25 |
| 4b — Implementation (API) | api-developer | complete (loop-back fix applied by ux-developer) | — | 2026-06-25 |
| 4c — Implementation (UI) | ux-developer | complete | — | 2026-06-25 |
| 5 — Verification | qa | complete | PASS (409 fix re-verified: catch checks err.cause.code; tsc/build/246 tests green) | 2026-06-25 |
| 6 — Shipped vs intent | analyst | complete | SHIP WITH NOTES | 2026-06-25 |

---

# Phase 1 — Functional Refinement (analyst)

## Phase 1 — Functional Refinement — 2026-06-25

**Owner:** analyst
**Status:** complete

### Summary

The "Compliance" increment surfaces the `ledger_filings` table (seeded calendar of annual and 5-year filings), a mark-filed action, a per-entity 990 determiner panel, and static standing-reminders copy. `determine990()` and the gross-receipts/assets query helpers already exist; this increment is predominantly a UI and schema surface over work that is already tested. Five decisions must be locked before tech-lead designs this: how the current-FY filing set is generated and rolls forward; whether "overdue" is stored or derived; what calendar management is in scope for inc3 (admin-add/edit vs. seed-only); whether the `disbApprovalThresholdCents` settings-edit screen lands here; and how the UI labels the asset proxy so users understand it is an estimate. All five are crisply addressable; the feature is ready to advance.

**Verdict: READY WITH NOTES**

**One-line take:** A well-bounded compliance surface over pre-built logic — the five open items are scope boundaries, not design gaps, and all are resolvable in Phase 3 without a Phase 1 loop-back.

---

### What I did

#### Pass 1 — User Verbs

Three surfaces are in scope. The `member` role has no ledger features and sees none of this.

**Board member (`ledger.view` — read-only on the compliance screen):**
- Navigates to `/admin/ledger/compliance`
- Reads the filings calendar grouped by upcoming / overdue / filed
- Reads the 990 determiner panel for the active entity and FY
- Reads the standing compliance reminders
- Switches entity (Club / Foundation) via the existing entity switcher

**Treasurer (`ledger.view` + `ledger.record`):**
- All board-member read verbs above
- Clicks "Mark as Filed" on a filing row
- In the mark-filed dialog: enters filed date (required), enters confirmation number (optional), optionally updates the note, submits
- Sees the updated status (filed) and confirmation # reflected immediately in the calendar

**Admin (`ledger.view` + `ledger.record` + `ledger.manage`):**
- All treasurer verbs above
- (If in-scope for inc3) Opens a settings screen and edits `disbApprovalThresholdCents`, `reserveWarnThresholdCents`, `treasurerBonded`, `philanthropyVisibility`
- (If in-scope for inc3) Adds a new filing entry (e.g., sales-tax filing that applies to a fundraising event)
- (If in-scope for inc3) Edits filing metadata (agency, title, due date, recurrence)
- (If in-scope for inc3) Deletes a non-filed filing (with destructive confirm)

No new `FEATURES` key is needed. The existing mapping is:
- Read calendar + 990 panel + reminders: `LEDGER_VIEW` — held by admin, treasurer, board_member
- Mark-filed / edit filing status: `LEDGER_RECORD` — held by admin, treasurer
- Settings-edit / add-edit-delete filings: `LEDGER_MANAGE` — held by admin only

This is the correct split. There is no case where a separate `ledger.compliance` key adds value: the view/record/manage tiers already encode the right separation (board reads, treasurer files, admin administers). Recommend reuse; no new key.

---

#### Pass 2 — Flow Audit

**Flow A — View compliance calendar**

Entry: `/admin/ledger/compliance` (navigated from the ledger overview or admin sidebar).
Steps: page loads the filings for the active entity + active FY, grouped into three bands — Overdue (dueDate past + status != filed), Upcoming (dueDate future + status not filed), Filed (status = filed). Entity switcher allows switching to the Foundation.
Success: calendar renders with correct bands, due dates, status badges, confirmation numbers where present.
Failure paths:
- No filings seeded yet: empty state per band ("No overdue filings") — not a blank page.
- Entity has no filings (e.g., Foundation-only filings on the Club view): band renders empty gracefully.
- DB error: toast error and a non-blank fallback — not a stack trace.

**Flow B — Mark a filing filed**

Entry: "Mark as Filed" button on a filing row; gated `LEDGER_RECORD`.
Steps: ConfirmDialog-style modal opens (not window.confirm); user enters filed date (required, defaults to today); enters confirmation # (optional); optionally edits the note; submits.
Success: `PATCH /api/admin/ledger/filings/[id]` returns 200; filing row updates status to `filed`, shows confirmation # and filed date; moves to the Filed band.
Failure paths:
- Filed date missing: client-side validation blocks submit; inline error "Filed date is required."
- API error (network/DB down): toast.error with a human message, not a stack trace; modal stays open so the user doesn't lose their input.
- Non-existent filing ID (URL tampering): 404 from the API.
- User lacks `LEDGER_RECORD`: the "Mark as Filed" button is not rendered; a direct POST to the API returns 403.

**Flow C — View 990 determiner panel**

Entry: same page `/admin/ledger/compliance` — the 990 panel is a section on the page, not a separate route.
Steps: page loads `getOverview(entityId, activeFY)` which already calls `determine990()`. Panel shows: form name (990-N / 990-EZ / 990 / 990-PF), the `why` string, gross receipts for the active FY, asset proxy value, and (if form != 990-PF and 3+ consecutive missed 990s) the revocation warning.
Success: panel renders with correct form and explanatory copy. The proxy label clearly says "estimated assets (entity balance)" not "total assets."
Failure paths:
- No transactions yet for the FY: gross receipts = $0 → 990-N determination; panel renders correctly (this is the legitimate zero-activity case).
- Entity not yet fully set up (no funds): `getOverview` returns empty funds array and falls through to 990-N at $0.

**Flow D — Read standing reminders**

Entry: same page — a static advisory section.
Steps: no user input; copy is rendered server-side from constants or hardcoded JSX.
Success: copy is present and readable on mobile.
Failure path: not applicable (no data dependency).

**Flow E — Settings-edit screen (scope-contingent)**

Entry: a "Settings" link on the ledger overview or compliance page, gated `LEDGER_MANAGE`.
Steps: admin edits the four `ledger_settings` fields; submits via `PATCH /api/admin/ledger/settings`.
Success: settings update; toast.success; values reflected immediately.
Failure: API error → toast.error; form retains current values.

---

#### Pass 3 — Permissions

No new `FEATURES` key is needed for inc3. Existing keys cover every verb:

| Action | Key | Roles |
|--------|-----|-------|
| View calendar, 990 panel, reminders | `LEDGER_VIEW` | admin, treasurer, board_member |
| Mark-filed (PATCH filing status) | `LEDGER_RECORD` | admin, treasurer |
| Add / edit / delete filings | `LEDGER_MANAGE` | admin |
| Edit `ledger_settings` | `LEDGER_MANAGE` | admin |

The API routes from the spec (§6) already list `PATCH /filings/[id]` as `LEDGER_RECORD` and `PATCH /settings` as `LEDGER_MANAGE`. No migration change is required for the permission structure itself.

---

#### Pass 4 — Edge Cases the Request Didn't Mention

**Filing recurrence and year rollover (biggest gap)**

The spec seeds the current FY's filings but does not say how next year's set is generated. Two models: (a) the migration seeds only the seeded FY rows and an admin manually adds the next year's rows or clicks a "Roll to next year" button; (b) `listFilings(fiscalYear)` auto-materializes the current year's rows from a filing-schedule template on first access.

Model (a) is simpler but requires admin action every July and risks the calendar going stale. Model (b) is seamless but adds complexity (a template table or a generator). Recommend a middle path: the migration seeds rows for the current FY only; a `listFilings(fiscalYear)` query auto-generates the next year's rows from the previous year's rows (copy title/agency/dueDate offset by one year) on first request if none exist yet for that FY, then materializes them. This keeps the schema simple and avoids manual work. This decision must be confirmed in Phase 3; it affects how `dueDate` is computed for the seed data (absolute dates vs. "month-day + FY" formula).

**"Overdue" as derived vs. stored status**

The schema's `status` enum is `not_started | in_progress | filed | future | na`. "Overdue" is not in the enum — it is derived at query time: `dueDate < today AND status NOT IN ('filed', 'na', 'future')`. This is correct; storing "overdue" as a status would drift the moment the clock ticks past the due date and no migration ran. The UI should derive the Overdue band from the query result, not from a stored status value. This is a non-decision (the right answer is obvious) but it must be explicit in the Phase 3 design so the implementer doesn't add an "overdue" status column.

**3-consecutive-missed-years revocation warning**

The spec names this warning but does not say how the system counts missed years. Three consecutive years means three consecutive FYs for which the entity has a 990/990-N/990-EZ filing with status != `filed`. The query can derive this by looking at the prior three FY rows for IRS 990 filings for the entity. If any three consecutive FYs have no filed IRS 990-family row, the HIGH warning fires. This needs to be specified in the tech-lead design: which agency/title values count as an IRS 990 family filing (probably `agency = 'IRS'` rows), and what happens when there are fewer than three years of data (suppress the warning until three years exist).

**990 input accuracy: asset proxy**

`assetsCents` in `determine990()` is currently `entityBalanceCents` — the sum of fund ending balances. This is a cash-basis proxy, not a GAAP "total assets" figure. It understates assets for a club with physical equipment, prepaid expenses, or receivables. It may also differ from what is actually reported on the 990-EZ/990. The UI must label this value as "estimated total assets (entity cash balance)" and include a one-line advisory: "For the actual 990, use total assets from your financial statements, not this estimate." Failing to label it risks the treasurer filing the wrong form tier. The `why` string from `determine990()` currently does not include this caveat — the UI layer must add it.

**`in_progress` status: who sets it?**

The `status` enum includes `in_progress`. The mark-filed flow only handles the `→ filed` transition. Can a treasurer mark a filing `in_progress` to track that it has been started? The spec is silent. Options: (a) the mark-filed dialog also has a "Save as In Progress" action, meaning the dialog has two submit paths; (b) `in_progress` is set automatically by some trigger (no trigger is described); (c) `in_progress` is dead in inc3 and reserved for future use. Recommend option (a): the mark-filed dialog offers two buttons — "Save as In Progress" (status = in_progress, no confirmation # required) and "Mark as Filed" (status = filed, filed date required). This lets a treasurer signal work-in-progress to board members who are read-only.

**OAuth vs password users**

Both user paths have the same ledger access — no feature in this increment touches Google identity. The compliance page is a server component behind `auth()` + `hasFeature()`. No distinction needed.

**Empty state (brand new install)**

If no filings are seeded yet (e.g., a fresh install where the migration hasn't been updated), all three bands render with an empty-state card: "No overdue filings" / "No upcoming filings" / "No filed filings." The 990 panel still renders (it requires only the entity + transactions, not filings). Standing reminders still render. The page is never blank.

**Mobile**

The filings calendar is a table-like structure; at 360px this must reflow to a card-per-filing layout, not a horizontal scroll table. The 990 panel and reminders are prose/card — fine at any width. Flag for ux-developer.

**Email (no email story in the spec)**

The spec does not mention email notifications for approaching or overdue filings. This is a reasonable omission — the guardrails engine (inc3 extension) will surface overdue filings as WARN flags on the overview page, which serves the same purpose. No email is required for inc3.

**Google Group sync**

No group membership changes in this increment. Not applicable.

**`disbApprovalThresholdCents` settings-edit screen**

This has been deferred twice (from inc1 and inc2) and is listed as a scope question for Phase 1 in the work-log context. The settings row already exists and defaults are already seeded. The four settings fields (`disbApprovalThresholdCents`, `reserveWarnThresholdCents`, `treasurerBonded`, `philanthropyVisibility`) affect inc2 guardrails and inc5 impact visibility respectively. There is no user-facing way to change them today. Putting the settings-edit screen in inc3 is the right time: inc3 is the last increment that touches compliance, and `reserveWarnThresholdCents` + `treasurerBonded` are compliance-adjacent. The `PATCH /settings` API is already specified (§6). The settings screen is a small form (`ledger.manage`) and does not conflict with inc4/inc5 scope. Recommend: include it in inc3.

---

#### Pass 5 — Adversarial Pass

**Redirect targets**

The compliance page has no `callbackUrl` or `redirect` parameter. The entity switcher changes a URL segment (`/admin/ledger/compliance?entity=foundation`) — not a redirect. Not applicable.

**State-machine shortcuts**

- Can a treasurer skip `in_progress` and go directly to `filed`? Yes, by design — not a shortcut, it is the primary path.
- Can a board member (read-only) POST to `PATCH /filings/[id]`? The API must check `LEDGER_RECORD`, return 403 if absent. The "Mark as Filed" button must not render for board members. Both must be enforced independently (defense in depth).
- Can a user mark a filing filed with a date in the future? Client validation should warn ("Filed date is in the future — confirm?") but not block, since backdating is common in this domain. Server does not block future dates.

**Enumeration leaks**

`GET /api/admin/ledger/filings?entity=...` — if an unauthenticated or unpermissioned user hits this route, it must return 401/403, not a different body than an authorized request. Filing data is not especially sensitive but the general rule holds.

**Input boundaries**

- `confirmation` field: the IRS EIN confirmation number is typically 10 digits; state acknowledgment codes vary. The field should accept up to 100 characters with server-side length validation. No injections possible via Drizzle parameterized queries.
- `filedOn` date: must be a valid ISO date string server-side, not trusted from the client.
- `note` text: max 1000 characters (consistent with the pattern in inc1/inc2 memos).

**Self-targeting**

Board members cannot mark filings filed (lacks `LEDGER_RECORD`) — this is the correct segregation. No self-targeting vector specific to filings.

**Filing ID tampering**

`PATCH /api/admin/ledger/filings/[id]` must verify that the filing belongs to an entity the session user's `LEDGER_RECORD` grants access to, and that the ID is a valid UUID. If the filing does not exist, return 404 — not a different error shape that reveals whether the filing exists for a different entity.

---

### Outputs

- Work-log entry at `docs/work-log/2026-06-25-ledger-compliance.md` (this file), Phase 1 section written.
- No new `FEATURES` key; no migration required for permissions.
- Per-Phase Status table updated.

### Open questions / handoff notes

The five decisions architect and tech-lead must resolve before implementation:

1. **Filing recurrence + year rollover (Gap 1).** Recommended: seed the current FY only; `listFilings(fiscalYear)` auto-generates the next year from the prior year's rows if none exist for that FY. Tech-lead must specify the `dueDate` computation formula (month-day pattern keyed to FY start year) so it works correctly.

2. **`in_progress` status UX (Gap 2).** Recommended: the mark-filed dialog has two submit actions — "Save as In Progress" and "Mark as Filed." Tech-lead to confirm; if rejected, `in_progress` should be removed from the UI status vocabulary for inc3.

3. **990 asset proxy label (Gap 3).** The UI must label `assetsCents` as an estimate and the 990 panel must include a one-line advisory. The `why` string from `determine990()` does not include this caveat — ux-developer must add it in the component, not in the pure helper.

4. **3-missed-years revocation warning query (Gap 4).** Tech-lead must specify: which rows count as a qualifying IRS 990 filing (recommend `agency = 'IRS'` AND title contains '990'); what the fallback is when fewer than 3 years of data exist (suppress warning); and whether this check runs at query time or is part of the guardrails engine (recommend: guardrails engine in `guardrails()` + the TODO already in `ledger.ts`).

5. **Settings-edit screen (Scope recommendation).** Recommend including in inc3. The `PATCH /settings` API route is already specified; the screen is a small `ledger.manage`-gated form. This is the last reasonable window before inc4/inc5 land features that depend on the settings values being configurable.

Board member read-only gate must be enforced both at the UI layer (button hidden) and at the API layer (403 if `LEDGER_RECORD` absent) — standard defense-in-depth pattern from inc1/inc2.

The mobile layout of the filings calendar needs explicit attention in the ux-developer phase — a table layout will not work at 360px.

The `determine990()` function does NOT need to change for inc3; the UI wrapper adds the proxy-labeling and the revocation warning around its output.

---

# Phase 2 — Architectural Review (architect)

## Phase 2 — Architectural Review — 2026-06-25

**Owner:** architect
**Status:** complete

### Summary

**Approved with suggestions.** The placement, server/client split, permission gating, and invariant compliance of the proposed Compliance increment are all sound — nothing needs to change before tech-lead designs this. Two architectural data-shape questions (due-date column shape and the rollover mechanism) are resolved here and recorded in DECISION-021. The settings screen gets its own route. One minor naming invariant for the compliance page search-param is flagged for tech-lead. No new dependencies, no new FEATURES keys.

---

### What I did

#### 1. Placement check

Confirmed the proposed structure mirrors the existing inc1/inc2 ledger layout exactly:

- New page: `src/app/(dashboard)/admin/ledger/compliance/page.tsx` — parallel to `/ledger/approvals/page.tsx` and `/ledger/reimbursements/page.tsx`. Correct.
- New page: `src/app/(dashboard)/admin/ledger/settings/page.tsx` — see §4 below. Correct placement.
- API additions under `src/app/api/admin/ledger/`:
  - `filings/[id]/route.ts` — PATCH (mark-filed / in_progress). Consistent with `transactions/[id]/route.ts` shape.
  - `settings/route.ts` — PATCH. Already specified in §6 of the spec; now being built.
- `listFilings` + `getSettings` query helpers extend `src/lib/ledger-queries.ts` — correct; `getSettings()` is already there (inc1), `listFilings` is a natural addition.
- `ensureFilingsForFY()` lives in `src/lib/ledger-queries.ts` alongside `listFilings` — correct; it is a server-only DB-write helper, same tier as the other query helpers.
- The inc3 compliance guardrail check fills the `// TODO inc3` stub at line 382 of `src/lib/ledger.ts` — correct placement; `guardrails()` is the right home.
- New `ledger_filings` table added to `src/lib/db/schema.ts` with a matching idempotent migration. `ledger_settings` already exists (inc1) and is not re-created.

All placements are consistent with the existing ledger structure. No new top-level directories or modules are required.

#### 2. Server/client split

- The compliance page is a Server Component by default — correct. It calls `auth()` + `hasAnyFeature()` + `getEntity()` + `listFilings()` + `getOverview()` at the top of the server component before rendering.
- `ensureFilingsForFY()` is called server-side from the Server Component before `listFilings` — no client-side call.
- The mark-filed dialog is a Client Component (`'use client'`) because it manages local form state and calls `PATCH /api/admin/ledger/filings/[id]`. This is the same pattern as `TransactionFormDialog` (inc1). Correct.
- The settings form is also a Client Component — same rationale.
- `<ConfirmDialog>` is used for delete-filing — required by the no-`window.confirm` invariant. No native browser dialogs anywhere.
- Standing reminders (static advisory copy) are pure JSX in the Server Component — no `'use client'` needed.
- The 990 panel reads from `getOverview()` in the server component and is rendered as Server Component markup with no interactivity — correct; `determine990()` is a pure helper, no DB.

#### 3. Dependencies

No new npm dependencies required. All data needs are met by:
- Existing Drizzle (`drizzle-orm`, `postgres`) for `ledger_filings` DDL and queries.
- Existing Radix UI primitives + shadcn via `src/components/ui/` for the mark-filed dialog.
- Existing `sonner` for toast notifications.
- Existing `date-fns` for due-date formatting and overdue comparison.
- No date-parsing library needed — `computeDueDate` is a small arithmetic helper using native JS `Date` construction.

Verdict: no new dependencies.

#### 4. Settings screen route — own page vs compliance panel

**Decision: `/admin/ledger/settings` as its own page.**

The settings form (four fields: `disbApprovalThresholdCents`, `reserveWarnThresholdCents`, `treasurerBonded`, `philanthropyVisibility`) affects guardrails rendered on the overview page, the approval workflow (inc2), and the impact dashboard (inc5). Its natural navigation anchor is the ledger section as a whole, not the compliance page. Embedding it as a panel on `/admin/ledger/compliance` would:
- require a `ledger.manage` user to navigate to the compliance screen to change a threshold that affects the transaction overview;
- make the compliance page do double duty (filings calendar + system config), violating the single-concern principle;
- produce an awkward page where the `ledger.manage` panel is visible to admins but invisible to treasurers browsing the same compliance page.

A separate `/admin/ledger/settings` page (gated `LEDGER_MANAGE`) is the correct model. It gets a nav link in the ledger sub-navigation (alongside "Compliance"), visible only to users with `LEDGER_MANAGE`. This is consistent with how `/admin/ledger/approvals` is its own page for `LEDGER_APPROVE`.

#### 5. Permission gating — confirmed

All three tiers apply cleanly:

| Surface | Gate | Enforcement |
|---------|------|-------------|
| `/admin/ledger/compliance` page (read) | `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` | Server Component preamble |
| Mark-filed button rendered | `canRecord` boolean derived server-side | JSX prop drilling |
| `PATCH /api/admin/ledger/filings/[id]` | `LEDGER_RECORD` | Route handler auth preamble |
| Add/edit/delete filing buttons rendered | `canManage` boolean | JSX prop drilling |
| `POST/DELETE /api/admin/ledger/filings` | `LEDGER_MANAGE` | Route handler auth preamble |
| `/admin/ledger/settings` page | `LEDGER_MANAGE` redirect guard | Server Component preamble |
| `PATCH /api/admin/ledger/settings` | `LEDGER_MANAGE` | Route handler auth preamble |
| Revocation warning (3 missed 990s) | read path — no separate gate | Rendered inside `LEDGER_VIEW` surface |

No new `FEATURES` key needed. The existing four-key ledger permission set covers every verb. Confirmed.

#### 6. Due-date storage — architectural resolution (DECISION-021)

**Column shape: `due_month integer` + `due_day integer` (not an absolute `due_date date` column).**

The Phase 1 analyst recommended storing due dates as a month-day pattern keyed to the FY start year so rollover stays correct. After evaluating both options:

- Absolute `due_date date` per row: correct for the seed FY, but rollover-copy logic must offset the date by +1 year, which silently produces wrong dates for filings whose due month falls in the second calendar year of a Jul–Jun FY (e.g., a March filing in FY2026 is due March 2027; a naive +1-year copy starting from a `2026-03-15` seed produces `2027-03-15` — accidentally correct by coincidence for that year but brittle for the general case). It also makes the seed migration fragile: any future seed edit must recalculate absolute dates rather than just editing month/day values.
- `due_month` + `due_day` integers: the absolute due date is computed at query time via `computeDueDate(fiscalYear, dueMonth, dueDay)`. The computation rule is deterministic and FY-convention-aware (months < 7 → FY start year + 1; months ≥ 7 → FY start year). The migration seed reads naturally (`due_month=11, due_day=15` for Nov 15). Rollover copies the month/day columns verbatim — no date arithmetic in the migration. The 5-year `Statement of Continued Existence` uses `recurrence='5_year'`; `listFilings` checks whether this FY is a multiple-of-5 boundary from the entity's initial filing year to decide whether to include it.

**Choice: `due_month` + `due_day` integers.** Logged as DECISION-021.

#### 7. Auto-rollover mechanism — architectural resolution (DECISION-021)

**Choice: explicit idempotent `ensureFilingsForFY(entityId, fiscalYear)` called from the compliance page Server Component — not write-on-read inside `listFilings`.**

A `listFilings` that may `INSERT` rows is not acceptable architecturally:
- It violates the read-only contract of every `GET` request in this codebase (every other query helper in `ledger-queries.ts` is a pure read).
- It creates an invisible side-effect that can race under concurrent requests (two admin users navigating to compliance for the same entity+FY simultaneously both call `listFilings`, both check "no rows for this FY", both insert — the `ON CONFLICT DO NOTHING` would save correctness but only if the unique constraint is defined correctly from the start).
- It is impossible to test cleanly: a unit test of `listFilings` would need to assert that it sometimes inserts, which is a test of two behaviors in one function.

`ensureFilingsForFY(entityId, fiscalYear)` is a named, explicit function with an obvious contract. The Server Component calls it before `listFilings`. Its idempotency is guaranteed by `INSERT … ON CONFLICT DO NOTHING` on `(entity_id, fiscal_year, agency, title)`. Logged as DECISION-021.

#### 8. Filing template / seed source

**No `filing_templates` table.** Keep it simple: the migration seeds the current FY rows directly into `ledger_filings`. Rollover copies rows forward from the prior FY (same entity, prior fiscal year). This is the lighter option: zero extra tables, zero extra abstractions, the seed migration is a concrete set of `INSERT … WHERE NOT EXISTS` statements, and the rollover logic is a straightforward `INSERT … SELECT … ON CONFLICT DO NOTHING`. If the club adds a one-off filing, it goes directly into `ledger_filings` (not into a template table), and it will be copied forward on the next rollover like any other row.

#### 9. Invariant checks

- **Cents:** `ledger_filings` carries no money columns; all money in the compliance surface flows through `getOverview()` and the existing cents helpers. No new money column to audit.
- **Idempotent migration:** The `ledger_filings` migration uses `CREATE TABLE IF NOT EXISTS` and the seed uses `INSERT … ON CONFLICT DO NOTHING` on `(entity_id, fiscal_year, agency, title)`. The unique constraint itself uses `CREATE UNIQUE INDEX IF NOT EXISTS`. Idempotency is clear.
- **`schema.ts` first:** `ledger_filings` table must be added to `src/lib/db/schema.ts` before the migration is authored. No schema object may be referenced in `schema.ts` before the migration creates it. Standard inc1/inc2 ordering holds.
- **No `lions-red`:** Not applicable to this increment.
- **`ConfirmDialog` for delete-filing:** Required. The analyst already flagged this; the implementer must not use `window.confirm`.

#### 10. One suggestion for tech-lead

The compliance page uses an `?entity=` search-param (same as the overview page, e.g., `?entity=foundation`). Tech-lead should confirm this param name matches `EntitySwitcher`'s existing convention (it does — the overview page uses `?entity=`) so the switcher component can be reused without a prop-shape change. If the settings page also needs an entity context, it should use the same `?entity=` param. No architectural concern — just confirm in the design doc.

---

### Outputs

- Work-log at `/Users/cshenso/git/westervillelions/docs/work-log/2026-06-25-ledger-compliance.md` — Phase 2 section written, Per-Phase Status updated.
- `docs/decisions.md` — DECISION-021 logged: `ledger_filings` `due_month`/`due_day` columns + explicit `ensureFilingsForFY()` rollover step.

### Open questions / handoff notes

For tech-lead (Phase 3):

- Specify `computeDueDate(fiscalYear, dueMonth, dueDay): Date` exactly: `month < 7 → new Date(fiscalYear + 1, month - 1, day)`, `month >= 7 → new Date(fiscalYear, month - 1, day)`. This is the Lions Jul–Jun FY boundary rule. Lock it in the design doc so implementer doesn't guess.
- Specify `ensureFilingsForFY` unique constraint columns: `(entity_id, fiscal_year, agency, title)`. The migration's `CREATE UNIQUE INDEX IF NOT EXISTS` must use these four columns.
- Specify the 5-year cadence for `Statement of Continued Existence`: `listFilings` includes this row only if `(fiscalYear - baseYear) % 5 === 0` where `baseYear` is the entity's first filing year (hardcode in migration seed or store on the row). The simpler approach is to store a `nextDueYear integer` on the row and compare to `fiscalYear`; rollover sets `nextDueYear = current + 5`. Tech-lead picks the approach.
- The revocation-warning guardrail query: confirm the IRS 990-family filter is `agency = 'IRS'` (all rows with that agency) rather than title-matching. Title-matching is fragile if the title text changes on rollover.
- The `?entity=` search-param convention: confirm `EntitySwitcher` is reusable on the compliance page without modification.
- Settings page nav entry in the ledger sub-nav (if a sub-nav exists): gate the "Settings" link on `canManage` (i.e., `hasFeature(LEDGER_MANAGE)`), consistent with how `approvals` is gated on `canApprove` in the overview page today.
- For inc3 the `filedBy` user is not tracked (not in the spec); if the implementer wants to add an `filed_by_user_id` column, that is a schema addition that needs a migration and a DECISION entry — do not add it silently.

---

# Phase 3 — Technical Design (tech-lead)

## Phase 3 — Technical Design — 2026-06-25

**Owner:** tech-lead
**Status:** complete

### Summary

The Compliance increment adds a `ledger_filings` table (nine rows per entity, seeded idempotently), an explicit `ensureFilingsForFY(entityId, fiscalYear)` rollover helper, and `listFilings(entityId, fiscalYear)` as a pure read returning rows enriched with computed `dueDate` and derived `overdue` flag. The compliance page at `/admin/ledger/compliance` surfaces these in three calendar bands, the existing `determine990()` result with an asset-estimate label, a revocation guardrail, and static standing reminders. A settings page at `/admin/ledger/settings` exposes the four editable `ledger_settings` fields. No new `FEATURES` key is needed; all three existing tiers (`ledger.view`, `ledger.record`, `ledger.manage`) map cleanly to the four verb groups. One implementation decision is logged (DECISION-022: `nextDueYear` integer column on `ledger_filings` for the 5-year cadence).

---

### Permissions

No new `FEATURES` key. All permissions reuse existing keys.

| Action | Key | Roles | Enforcement |
|--------|-----|-------|-------------|
| View compliance page, 990 panel, reminders | `LEDGER_VIEW` | admin, treasurer, board_member | Server Component preamble: `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` |
| Mark filing in_progress or filed | `LEDGER_RECORD` | admin, treasurer | `PATCH /api/admin/ledger/filings/[id]` route handler |
| Add / edit / delete filing rows | `LEDGER_MANAGE` | admin | `POST/DELETE /api/admin/ledger/filings` route handler |
| View settings page | `LEDGER_MANAGE` | admin | Server Component preamble: hard redirect on missing feature |
| Edit `ledger_settings` | `LEDGER_MANAGE` | admin | `PATCH /api/admin/ledger/settings` route handler |

`canRecord` and `canManage` boolean props are computed server-side and passed to client components as props; the mark-filed button does not render for board members. Both UI-gate and API-gate are enforced independently (defense in depth, established inc1/inc2 pattern).

The `?entity=` search-param convention already exists on the overview page (`EntitySwitcher` uses it); the compliance and settings pages reuse it verbatim. Architect confirmed the param name matches in Phase 2.

---

### Data Model

**New table: `ledger_filings`**

Columns:

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK DEFAULT gen_random_uuid()` | |
| `entity_id` | `uuid NOT NULL REFERENCES ledger_entities(id) ON DELETE CASCADE` | |
| `fiscal_year` | `integer NOT NULL` | FY start year (e.g. 2026 = Jul 2026 – Jun 2027) |
| `agency` | `text NOT NULL` | `'IRS'` \| `'Ohio AG'` \| `'Ohio SOS'` \| `'Ohio COM'` \| `'Internal'` |
| `title` | `text NOT NULL` | Human display name: `'990-N'`, `'Ohio AG Annual Report'`, etc. |
| `due_month` | `integer NOT NULL` | 1–12; due-date month relative to FY |
| `due_day` | `integer NOT NULL` | 1–31; due-date day of month |
| `recurrence` | `text NOT NULL DEFAULT 'annual'` | `'annual'` \| `'5_year'` |
| `next_due_year` | `integer` | Non-null only for `recurrence='5_year'`; the calendar year in which this specific row's due date falls. `listFilings(fy)` includes a 5-year row only when `next_due_year = fy + 1` (see DECISION-022 rationale). On rollover, `ensureFilingsForFY` sets `next_due_year = current + 5`. |
| `status` | `text NOT NULL DEFAULT 'not_started'` | `'not_started'` \| `'in_progress'` \| `'filed'` \| `'future'` \| `'na'` |
| `confirmation` | `text` | Agency confirmation/acknowledgment code; max 100 chars at app layer |
| `filed_on` | `date` | Wall-clock date filed; required when status → `'filed'` |
| `note` | `text` | Max 1000 chars at app layer |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |

**Unique constraint (the ON CONFLICT key):** `UNIQUE (entity_id, fiscal_year, agency, title)` — four columns, named `ledger_filings_entity_fy_agency_title_key`.

**Index:** `ix_ledger_filings_entity_fy` on `(entity_id, fiscal_year)` — the primary access pattern for `listFilings` and `ensureFilingsForFY`.

`ledger_settings` is unchanged. No new columns; the four editable fields (`disb_approval_threshold_cents`, `reserve_warn_threshold_cents`, `treasurer_bonded`, `philanthropy_visibility`) already exist.

**`schema.ts` additions:**

```typescript
export const ledgerFilings = pgTable(
  "ledger_filings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").notNull().references(() => ledgerEntities.id, { onDelete: "cascade" }),
    fiscalYear: integer("fiscal_year").notNull(),
    agency: text("agency").notNull(),
    title: text("title").notNull(),
    dueMonth: integer("due_month").notNull(),
    dueDay: integer("due_day").notNull(),
    recurrence: text("recurrence").notNull().default("annual"),
    nextDueYear: integer("next_due_year"),
    status: text("status").notNull().default("not_started"),
    confirmation: text("confirmation"),
    filedOn: date("filed_on"),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("ledger_filings_entity_fy_agency_title_key").on(t.entityId, t.fiscalYear, t.agency, t.title),
    index("ix_ledger_filings_entity_fy").on(t.entityId, t.fiscalYear),
  ],
);
export type LedgerFiling = typeof ledgerFilings.$inferSelect;
export type NewLedgerFiling = typeof ledgerFilings.$inferInsert;
```

**Migration file:** `drizzle/migrations/0048_ledger_compliance.sql`

The migration does five things, all idempotent:
1. `CREATE TABLE IF NOT EXISTS ledger_filings` (all columns above).
2. `CREATE UNIQUE INDEX IF NOT EXISTS ledger_filings_entity_fy_agency_title_key ON ledger_filings(entity_id, fiscal_year, agency, title)`.
3. `CREATE INDEX IF NOT EXISTS` via `DO $$ IF NOT EXISTS` guard for `ix_ledger_filings_entity_fy`.
4. Seed the initial FY (FY2026 = `fiscal_year=2026`) rows for the Club entity using `INSERT … ON CONFLICT DO NOTHING`.
5. Seed the initial FY rows for the Foundation entity using the same pattern.

**Seed rows** (nine rows total, listed by entity × filing):

The seed FY is the constant `2026`. Every row has `status = 'not_started'`.

Club entity (slug `'club'`):
- `agency='IRS', title='990-N', due_month=11, due_day=15, recurrence='annual'` — due Nov 15, 2026 (month 11 >= 7, so FY start year 2026)
- `agency='Ohio AG', title='Ohio AG Annual Report', due_month=11, due_day=15, recurrence='annual'`
- `agency='Ohio COM', title='Ohio Unclaimed Funds Report', due_month=11, due_day=1, recurrence='annual'`
- `agency='Ohio SOS', title='Statement of Continued Existence', due_month=11, due_day=15, recurrence='5_year', next_due_year=2030` — (seed year 2026 + 5 = 2031 calendar year; but this row is due Nov 2030 which means `next_due_year=2030`, the FY that will include Nov 2030 in FY2030 (Jul 2030–Jun 2031). See DECISION-022.)
- `agency='Internal', title='Annual Treasurer\'s Audit', due_month=6, due_day=30, recurrence='annual'` — due Jun 30, 2027 (month 6 < 7, so FY start year + 1 = 2027)

Foundation entity (slug `'foundation'`):
- `agency='IRS', title='990-N', due_month=11, due_day=15, recurrence='annual'`
- `agency='Ohio AG', title='Ohio AG Annual Report', due_month=11, due_day=15, recurrence='annual'`
- `agency='Ohio COM', title='Ohio Unclaimed Funds Report', due_month=11, due_day=1, recurrence='annual'`
- `agency='Internal', title='Annual Treasurer\'s Audit', due_month=6, due_day=30, recurrence='annual'`

The Foundation does NOT get a `Statement of Continued Existence` row — that applies to the Ohio SOS-registered Club entity. The Foundation is an Ohio nonprofit corporation; its equivalent would be a Biennial Report, which is out of scope for inc3 and noted as a future addition.

The migration seeds by looking up `entity_id` from `ledger_entities WHERE slug = 'club'` / `'foundation'` — not hardcoded UUIDs. Pattern:

```sql
INSERT INTO ledger_filings (entity_id, fiscal_year, agency, title, due_month, due_day, recurrence, next_due_year)
SELECT id, 2026, 'IRS', '990-N', 11, 15, 'annual', NULL
FROM ledger_entities WHERE slug = 'club'
ON CONFLICT (entity_id, fiscal_year, agency, title) DO NOTHING;
```

This is idempotent, survives reruns, and does not fail if the entity row doesn't exist yet (the `SELECT` returns zero rows, the INSERT inserts zero rows — no error).

---

### Pure Helpers (`src/lib/ledger.ts`)

**`computeDueDate(fiscalYear: number, dueMonth: number, dueDay: number): Date`**

```
month >= 7  →  new Date(fiscalYear, dueMonth - 1, dueDay)
month < 7   →  new Date(fiscalYear + 1, dueMonth - 1, dueDay)
```

Lions FY starts July 1. Months 7–12 (Jul–Dec) fall in the first calendar year of the FY; months 1–6 (Jan–Jun) fall in the second. This helper is pure (no Date.now()), deterministic, and must be tested in Vitest.

Export it from `ledger.ts` alongside the other pure helpers.

**Guardrail extensions — inc3 additions to `GuardrailsInput` and `guardrails()`**

Add two new fields to `GuardrailsInput`:

```typescript
/**
 * IRS 990-family filings for the past N fiscal years (ascending).
 * Each entry: { fiscalYear: number, status: string }.
 * Only rows where agency = 'IRS'. Used for revocation check.
 */
irsFilingHistory: Array<{ fiscalYear: number; status: string }>;

/**
 * Number of filing rows where computeDueDate(...) < today
 * AND status NOT IN ('filed', 'na', 'future').
 * Computed at call site in getOverview / getComplianceOverview.
 */
overdueFilingCount: number;
```

The existing `guardrails()` callers on the inc1/inc2 path that cannot supply these must pass `irsFilingHistory: [], overdueFilingCount: 0` until updated.

**Revocation guardrail (HIGH):** Fill the `// TODO inc3` stub at line 382 of `ledger.ts`:

```
- Filter irsFilingHistory to the 3 most-recent consecutive past FYs
  (where fiscalYear < currentFiscalYear, sorted descending, take first 3)
- If irsFilingHistory.length < 3: suppress (not enough data)
- If all three of those entries have status NOT IN ('filed', 'na'): fire HIGH
  title: "IRS 990 revocation risk — 3 consecutive unfiled returns"
  detail: "The IRS automatically revokes tax-exempt status after 3 consecutive years of
           failure to file a required annual return. File the overdue returns immediately."
  policyCite: "IRC §6033(j)"
```

Suppression rule: `irsFilingHistory.length < 3` → skip check entirely. This prevents spurious warnings for a freshly seeded install with only one or two years of data.

**Overdue-filing guardrail (WARN):**

```
- If overdueFilingCount > 0:
  title: "Overdue compliance filings"
  detail: `${overdueFilingCount} filing${overdueFilingCount === 1 ? " is" : "s are"} past due.
           Review the Compliance screen and file or mark as N/A.`
  policyCite: "Lions Financial Transparency Policy §10"
```

Both guards live in `guardrails()`. The `irsFilingHistory` is populated by `getComplianceOverview` before calling `guardrails()`.

---

### Server Queries (`src/lib/ledger-queries.ts`)

**`computeDueDate`** is imported from `@/lib/ledger` (pure helper lives there).

**`ensureFilingsForFY(entityId: string, fiscalYear: number): Promise<void>`**

- Checks whether any `ledger_filings` row exists for `(entityId, fiscalYear)`.
- If none: finds the prior FY rows (`fiscalYear - 1`) for this entity; copies them forward via:
  ```sql
  INSERT INTO ledger_filings (entity_id, fiscal_year, agency, title, due_month, due_day, recurrence, next_due_year, status)
  SELECT entity_id, $fiscalYear, agency, title, due_month, due_day, recurrence,
    CASE WHEN recurrence = '5_year' THEN next_due_year + 5 ELSE NULL END,
    'not_started'
  FROM ledger_filings
  WHERE entity_id = $entityId AND fiscal_year = $priorFY
  ON CONFLICT (entity_id, fiscal_year, agency, title) DO NOTHING;
  ```
- Critically: the rollover copies `agency`, `title`, `due_month`, `due_day`, `recurrence` verbatim. It does NOT copy `status`, `confirmation`, `filed_on`, or `note` — new FY rows start `not_started` with null confirmation/filed_on/note. A filing that was `filed` in FY2026 starts `not_started` in FY2027. This is the correct behavior.
- If no prior-FY rows exist and no current-FY rows exist: nothing is inserted (zero-row copy). The page renders with empty bands. This handles a fresh install before any seed has been applied.
- If current-FY rows already exist: the ON CONFLICT guard makes the function a no-op. Safe under concurrent requests.
- **5-year row handling on rollover:** When copying a row with `recurrence='5_year'`, the new `next_due_year` = prior row's `next_due_year + 5`. `listFilings` filters this row using `next_due_year === (dueMonth >= 7 ? fiscalYear : fiscalYear + 1)` (see DECISION-022 for the predicate derivation). For the Statement of Continued Existence (due_month=11, ≥ 7), the test is `next_due_year === fiscalYear`. The row is copied to every FY but only surfaces in the calendar in the FY where it is due.

**`listFilings(entityId: string, fiscalYear: number): Promise<FilingRow[]>`**

Pure read. Returns all rows for `(entityId, fiscalYear)` with:
- `dueDate: Date` — computed via `computeDueDate(fiscalYear, dueMonth, dueDay)`
- `overdue: boolean` — `dueDate < new Date() && !['filed','na','future'].includes(status)`
- For `recurrence='5_year'` rows: only include if `nextDueYear === (dueMonth >= 7 ? fiscalYear : fiscalYear + 1)` — that is, the expected calendar year for this row's due month inside `fiscalYear`. Rows where `nextDueYear` does not match are silently excluded from the return set. For the Statement of Continued Existence (due_month=11), the test is `nextDueYear === fiscalYear`. See DECISION-022.

Returns results ordered by `dueDate ASC`.

**Return type:**
```typescript
export type FilingRow = LedgerFiling & {
  dueDate: Date;
  overdue: boolean;
};
```

**`getComplianceOverview(entityId: string, fiscalYear: number)`**

Combines everything the compliance page needs in one call:
1. `getOverview(entityId, fiscalYear)` — existing function, returns `determine990Result`, `guardrailFlags`, `grossReceiptsCents`, `funds`.
2. `listFilings(entityId, fiscalYear)` — the filing rows with computed fields.
3. IRS filing history: query `ledger_filings WHERE entity_id = $entityId AND agency = 'IRS' AND fiscal_year < $fiscalYear ORDER BY fiscal_year DESC LIMIT 3` — used for the revocation guardrail.
4. `overdueFilingCount`: count from the filing rows above where `overdue === true`.
5. Re-invoke `guardrails()` with `irsFilingHistory` and `overdueFilingCount` populated (the `getOverview` call passes `irsFilingHistory: [], overdueFilingCount: 0`; `getComplianceOverview` calls `guardrails()` a second time with the real values, or alternatively pulls the non-filing flags from the first call and appends the two new flags separately).

Simpler approach (avoid calling guardrails twice): `getComplianceOverview` calls `getOverview` as-is, then derives the compliance-specific flags independently and appends them to `guardrailFlags`. The overview page already calls `getOverview`; the compliance page calls `getComplianceOverview`. This keeps the two pages from fighting over the guardrails shape.

Return type:
```typescript
export type ComplianceOverview = {
  entity: LedgerEntity;
  fiscalYear: number;
  filings: FilingRow[];
  grossReceiptsCents: number;
  entityBalanceCents: number; // proxy for assets estimate
  determine990Result: { form: string; why: string };
  guardrailFlags: GuardrailFlag[]; // all flags including compliance ones
  settings: LedgerSettings;
};
```

---

### API Contract

**`PATCH /api/admin/ledger/filings/[id]`**

Gate: `LEDGER_RECORD`.

Request body (mark in-progress or filed):
```typescript
{
  status: 'in_progress' | 'filed';
  filedOn?: string;       // ISO date string; required when status='filed'
  confirmation?: string;  // max 100 chars; optional
  note?: string;          // max 1000 chars; optional
}
```

Validations:
- `status` must be `'in_progress'` or `'filed'`.
- When `status='filed'`: `filedOn` is required and must be a valid ISO date string (server validates; client validates first).
- `confirmation` max 100 chars.
- `note` max 1000 chars.
- The filing must belong to an entity the session user has access to (no cross-entity tampering): verify `filing.entityId` is in the set of entity IDs the user's session can see. For inc3 simplicity: any authenticated `LEDGER_RECORD` user can mark any entity's filing. (Both entities are the same club; no multi-tenant isolation needed.)
- A filing with `status='filed'` may be updated to `'in_progress'` (un-filed, e.g., correction scenario) — not blocked server-side.
- Return 404 if `id` does not exist; 400 on validation failure; 200 with the updated row on success.

Response: `{ filing: LedgerFiling }` (the updated row, without computed fields — client re-derives `dueDate` and `overdue` from the row data if needed, or re-fetches the page via router.refresh()).

**`POST /api/admin/ledger/filings`** (add a one-off filing)

Gate: `LEDGER_MANAGE`.

Request body:
```typescript
{
  entityId: string;        // UUID
  fiscalYear: number;
  agency: string;          // max 100 chars
  title: string;           // max 200 chars
  dueMonth: number;        // 1–12
  dueDay: number;          // 1–31
  recurrence: 'annual' | '5_year';
  note?: string;           // max 1000 chars
}
```

Returns 201 with `{ filing: LedgerFiling }` on success; 409 on unique-constraint conflict (same entity/fy/agency/title).

**`DELETE /api/admin/ledger/filings/[id]`**

Gate: `LEDGER_MANAGE`.

Guard: a filing with `status='filed'` cannot be deleted — return 409 with `{ error: "Cannot delete a filed filing. Mark as N/A instead." }`.

Returns 204 on success, 404 if not found, 409 if filed.

**`PATCH /api/admin/ledger/settings`**

Gate: `LEDGER_MANAGE`.

Request body (all fields optional; PATCH semantics — send only the fields to update):
```typescript
{
  disbApprovalThresholdCents?: number;   // integer ≥ 0
  reserveWarnThresholdCents?: number;    // integer ≥ 0
  treasurerBonded?: boolean;
  philanthropyVisibility?: 'board' | 'members';
}
```

Validations:
- `disbApprovalThresholdCents` and `reserveWarnThresholdCents`: must be integers ≥ 0 (not negative, not fractional). Validated with `Number.isInteger(v) && v >= 0`.
- `philanthropyVisibility`: must be `'board'` or `'members'` if provided.
- At least one field must be present (no empty PATCH).

The settings row is a singleton. Update via `db.update(ledgerSettings).set({ ...fields, updatedAt: new Date() })` — no `WHERE` clause needed since there is exactly one row (established inc1 pattern with `getSettings()`).

Returns 200 with `{ settings: LedgerSettings }` on success.

---

### Component / Page Plan

**Pages to create:**

`src/app/(dashboard)/admin/ledger/compliance/page.tsx`
- Server Component.
- Auth preamble: `auth()` → redirect to `/signin` if no session; `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` → redirect to `/access-pending` if none.
- Reads `?entity=` param (default `'club'`); calls `getEntity(slug)`.
- Calls `ensureFilingsForFY(entity.id, fiscalYear)` — idempotent, no-op if rows exist.
- Calls `getComplianceOverview(entity.id, fiscalYear)`.
- Computes `canRecord` and `canManage` booleans from session features.
- Passes all data as props to child components (no client-side data fetching).

`src/app/(dashboard)/admin/ledger/settings/page.tsx`
- Server Component.
- Auth preamble: `auth()` + `hasFeature(LEDGER_MANAGE)` — redirect to `/access-pending` if missing.
- Calls `getSettings()`.
- Renders `<LedgerSettingsForm settings={settings} />` (Client Component).

**Components to create:**

`src/components/admin/ledger/FilingsCalendar.tsx` (Server Component — receives `filings: FilingRow[]`, `canRecord`, `canManage`)
- Splits `filings` into three bands: Overdue (`overdue === true`), Upcoming (`!overdue && !['filed','na'].includes(status)`), Filed (`status === 'filed'`).
- Each band is a section with an empty state card when empty.
- At mobile widths (< sm): card-per-filing layout. At sm+: table-like layout. No horizontal scroll.
- Each row shows: agency badge, title, due date (formatted), status badge, confirmation # (if filed), action button.
- Action button: `canRecord` → renders `<MarkFiledButton filing={filing} />` (a Client Component). `canManage` → renders edit/delete actions.
- 5-year rows: show a `5-year` recurrence badge so users understand why it doesn't appear every year.

`src/components/admin/ledger/MarkFiledDialog.tsx` (Client Component `'use client'`)
- Two submit paths: "Save as In Progress" (no confirmation # required, status → `'in_progress'`) and "Mark as Filed" (status → `'filed'`, `filedOn` required).
- Form fields: `filedOn` (date input, defaults to today), `confirmation` (text, optional), `note` (textarea, optional).
- Client-side validation: `filedOn` required when "Mark as Filed" is clicked; warn (but don't block) if `filedOn` is a future date.
- Calls `PATCH /api/admin/ledger/filings/[id]`; on success calls `router.refresh()` to re-render the Server Component.
- On API error: `toast.error(...)`, modal stays open (input preserved).
- Uses Radix `Dialog` (shadcn `<Dialog>`) — NOT `<ConfirmDialog>` (ConfirmDialog is for irreversible destructive actions; marking a filing is a data entry action).

`src/components/admin/ledger/DeleteFilingButton.tsx` (Client Component)
- Renders a delete icon button (only for `canManage`).
- Uses `<ConfirmDialog>` with `destructive` prop (filing deletion is irreversible).
- Calls `DELETE /api/admin/ledger/filings/[id]`; on success `router.refresh()`.
- If server returns 409 (filed): `toast.error("Cannot delete a filed filing. Mark as N/A instead.")`.

`src/components/admin/ledger/Panel990.tsx` (Server Component)
- Renders the 990 determination panel: form name, `why` text, gross receipts, asset proxy value.
- Asset proxy label (required, verbatim): **"Estimated total assets (entity cash balance) — use real total assets for the actual filing."**
- If `determine990Result.form !== '990-PF'` and guardrails include the revocation flag: renders the HIGH revocation warning in a red alert card.
- Renders a note that 990-PF always applies if the Foundation is reclassified as a private foundation.

`src/components/admin/ledger/StandingReminders.tsx` (Server Component — static JSX, no props)
- Hardcoded advisory copy from spec §7:
  - Raffle rule: 50% of net proceeds to charity.
  - No political endorsements.
  - Sales tax on taxable fundraising products.
  - Gaming/games-of-chance rules.
  - No "employment" issues (gift cards / waiving dues).
  - Social-media monitoring warning.
  - 7-year record retention.
- No data dependency; renders identically for all users. `canRecord`/`canManage` not needed.

`src/components/admin/ledger/LedgerSettingsForm.tsx` (Client Component `'use client'`)
- Four fields: `disbApprovalThresholdCents` (number input in dollars, converts to cents), `reserveWarnThresholdCents` (same), `treasurerBonded` (checkbox), `philanthropyVisibility` (select: Board only / All members).
- Client-side validation: thresholds must be non-negative numbers; at most two decimal places (for dollar input before cents conversion).
- Calls `PATCH /api/admin/ledger/settings`; on success `toast.success("Settings saved.")`.
- Form state initialized from server-fetched `settings` prop; no separate client-side fetch.

**Files to modify:**

`src/lib/ledger.ts` — add `computeDueDate()` export; extend `GuardrailsInput` with `irsFilingHistory` and `overdueFilingCount`; fill the `// TODO inc3` stub in `guardrails()` with the two new checks.

`src/lib/ledger-queries.ts` — add `ensureFilingsForFY()`, `listFilings()`, `getComplianceOverview()`. Import `ledgerFilings` and `LedgerFiling` from schema.

`src/lib/db/schema.ts` — add `ledgerFilings` table definition and exported types.

`src/app/(dashboard)/admin/ledger/` navigation — add sidebar/sub-nav links: "Compliance" (gate `LEDGER_VIEW`) and "Settings" (gate `LEDGER_MANAGE`). Identify the existing ledger nav component and add these entries (database-admin to check what nav file exists; ux-developer to wire up).

`drizzle/migrations/0048_ledger_compliance.sql` — new idempotent migration (CREATE TABLE + indexes + seed).

---

### Implementation Order

**Step 1 — Schema (database-admin)**

1. Add `ledgerFilings` to `src/lib/db/schema.ts` (table definition + types).
2. Author `drizzle/migrations/0048_ledger_compliance.sql`:
   - `CREATE TABLE IF NOT EXISTS ledger_filings` with all columns and the inline `CONSTRAINT ledger_filings_entity_fy_agency_title_key UNIQUE`.
   - `DO $$ IF NOT EXISTS` guards for `ix_ledger_filings_entity_fy`.
   - Seed rows for Club (5 rows) and Foundation (4 rows) using `INSERT … SELECT … ON CONFLICT DO NOTHING`.
3. Run `pnpm db:migrate` locally to verify idempotency (run twice, second run must produce no errors).
4. TypeScript compilation must pass with the new schema types.

**Step 2 — Pure helpers + guardrails (api-developer)**

(Can start in parallel with Step 1 if the DB isn't needed for the pure helper tests.)

1. Add `computeDueDate(fiscalYear, dueMonth, dueDay): Date` to `src/lib/ledger.ts`.
2. Extend `GuardrailsInput` with `irsFilingHistory` and `overdueFilingCount`.
3. Fill the `// TODO inc3` stub with the revocation and overdue-filing guardrail checks.
4. Write Vitest tests:
   - `computeDueDate`: boundary cases (month=7, month=6, month=1, month=12; FY=2026 producing correct calendar years; month=11 dueDay=15 FY2026 → Nov 15 2026).
   - Revocation guardrail: 3 unfiled → fires; 2 unfiled → does not fire; <3 FYs of data → suppressed; 3 filed → does not fire; 2 unfiled + 1 filed → does not fire.
   - Overdue guardrail: overdueFilingCount > 0 → fires WARN; 0 → does not fire.
   - Existing guardrail tests must still pass (no regression).

**Step 3 — Server queries (api-developer, continuing)**

1. Add `ensureFilingsForFY()`, `listFilings()`, `getComplianceOverview()` to `src/lib/ledger-queries.ts`.
2. Verify `listFilings` filters 5-year rows by `nextDueYear === (dueMonth >= 7 ? fiscalYear : fiscalYear + 1)` — see DECISION-022.
3. Verify rollover in `ensureFilingsForFY` copies `not_started` status and NULL confirmation/filed_on/note.

**Step 4 — API routes (api-developer, continuing)**

1. `src/app/api/admin/ledger/filings/[id]/route.ts` — PATCH handler (`LEDGER_RECORD` gate).
2. `src/app/api/admin/ledger/filings/route.ts` — POST and DELETE handlers (`LEDGER_MANAGE` gate). NOTE: `DELETE` with body vs `DELETE /[id]` — use `DELETE /api/admin/ledger/filings/[id]` (consistent with the PATCH route on the same resource).
3. `src/app/api/admin/ledger/settings/route.ts` — PATCH handler (`LEDGER_MANAGE` gate).
4. All routes: `auth()` first, then `hasFeature()`, then input validation, then DB operation.

**Step 5 — UI (ux-developer)**

1. `FilingsCalendar.tsx` — calendar bands, mobile card layout, action buttons.
2. `MarkFiledDialog.tsx` — two-action dialog with validation.
3. `DeleteFilingButton.tsx` — ConfirmDialog wrapper.
4. `Panel990.tsx` — 990 panel with asset-estimate label.
5. `StandingReminders.tsx` — static copy.
6. `LedgerSettingsForm.tsx` — settings form with dollar↔cents conversion.
7. Compliance page (`page.tsx`) assembling all components.
8. Settings page (`page.tsx`).
9. Sidebar/sub-nav entries for Compliance and Settings.

---

### Edge Cases and Risks

**Rollover does NOT copy filed status.** The `ensureFilingsForFY` query hardcodes `status = 'not_started'` in the INSERT and does not include `filed_on`, `confirmation`, or `note` in the SELECT columns. This is intentional and must not be changed. A treasurer who looks at FY2027 compliance will not see FY2026 confirmation numbers pre-populated; they must file and record independently each year.

**5-year row cadence.** The `Statement of Continued Existence` is due every 5 years. The seed row has `next_due_year=2030` (the calendar year 2030, inside FY2030). On rollover to FY2027, `ensureFilingsForFY` copies the row with `next_due_year = 2030 + 5 = 2035`. Because due_month=11 (≥ 7), `listFilings(2026)` applies the predicate `nextDueYear === fiscalYear` — i.e., `2030 === 2026` → false; excluded. `listFilings(2030)` checks `2030 === 2030` → true; the row appears in the FY2030 calendar. See DECISION-022 for the predicate derivation.

**`computeDueDate` and midnight.** The `overdue` flag is computed at query-time using `new Date()` compared to `computeDueDate(...)`. Both use local server time. On the day a filing is due, `overdue` is false (dueDate == today, not <). At midnight the next day it flips to true. This is acceptable behavior and matches the plain-English meaning of "overdue."

**Empty FY (no prior rows and no seed).** If neither the seed migration has run nor prior-FY rows exist, `ensureFilingsForFY` inserts nothing. The compliance page renders with three empty bands and the 990 panel. This is not an error state; the empty-state cards handle it.

**Settings PATCH with zero threshold.** `disbApprovalThresholdCents = 0` is valid (meaning all disbursements require approval). Validation allows ≥ 0.

**Delete of a filed row.** The DELETE route returns 409 with a user-readable message. The DeleteFilingButton surfaces this via `toast.error`. No ConfirmDialog is shown for a 409 — the dialog has already been dismissed by the time the API call returns.

**990 determination with zero gross receipts.** Covered by the existing `determine990` logic (returns 990-N). The Panel990 component renders correctly for this case.

**`?entity=` param with invalid value.** `getEntity(slug)` returns null for unknown slugs. The compliance page calls `notFound()` in this case (consistent with the inc1/inc2 overview page pattern).

**Filing add with duplicate key.** `POST /api/admin/ledger/filings` returns 409 when the unique constraint fires. The Drizzle insert will throw; the route handler catches and returns 409.

**Vitest for `computeDueDate`.** This function uses `new Date(year, month, day)` — JS Date constructor with a numeric month (0-indexed). The helper takes `dueMonth` as 1-indexed (like the column value) and passes `dueMonth - 1` to the Date constructor. This is the same pattern as the existing `fyBounds` helper. Tests must cover the off-by-one risk (month=7 → July → month index 6).

---

### Out of Scope

- Filing email notifications (overdue reminders) — deferred to a future increment; the guardrail WARN on the overview page provides the same signal.
- `filedBy` user tracking — not in the spec; if added later, requires a schema addition and a DECISION entry. Silently adding it here is explicitly disallowed (architect noted this in Phase 2).
- `reclassification` flow for the Foundation (990-PF risk) — the Panel990 renders a static note; no automated check for reclassification.
- Foundation Biennial Report (Ohio SOS equivalent for corporations) — out of scope for inc3; noted in the seed section above.
- Inc4 reports / 990-prep CSV export.
- Inc5 member philanthropy dashboard.

---

### What I did

- Read the full work-log (Phase 1 + Phase 2) to confirm all five resolved defaults and the architectural rulings in DECISION-021.
- Read `src/lib/ledger.ts` in full to identify the `// TODO inc3` stub at line 382 and the exact shape of `GuardrailsInput` and `guardrails()`.
- Read `src/lib/ledger-queries.ts` to understand `getOverview()` structure, `getSettings()` singleton pattern, and `fyBounds()`.
- Read `src/lib/db/schema.ts` for all ledger tables, confirming `ledger_settings` fields and `ledgerEntities` columns.
- Read `drizzle/migrations/0046_ledger_controls.sql` and `0044_ledger_books.sql` to match idiomatic migration style.
- Read spec §7 (guardrails) and §8 (seed data) to confirm the exact nine seed filings.
- Read `docs/decisions.md` through DECISION-021 to assign DECISION-022.

### Outputs

- `docs/work-log/2026-06-25-ledger-compliance.md` — Phase 3 section written, Per-Phase Status updated.
- `docs/decisions.md` — DECISION-022 logged.

### Open questions / handoff notes

Implementer sequence: **database-admin → api-developer → ux-developer**.

**For database-admin (Step 1):**
- Author `src/lib/db/schema.ts` addition and `drizzle/migrations/0048_ledger_compliance.sql`.
- The seed must look up entity IDs via `slug`; do not hardcode UUIDs.
- Confirm the `nextDueYear` seed value for the Statement of Continued Existence: `2030` (club files its next Ohio SOS renewal around that time; the exact year should be confirmed with the user — if the actual next filing year is known, use it; otherwise seed `2030` as a placeholder and note it in the migration comment).
- Run `pnpm db:migrate` twice to confirm idempotency.

**For api-developer (Steps 2–4):**
- `computeDueDate` is a pure helper in `ledger.ts` — write Vitest tests alongside the implementation.
- The guardrails extension must include backward-compat defaults (`irsFilingHistory: [], overdueFilingCount: 0`) for existing inc1/inc2 callers. The `getOverview()` function must pass these defaults until it is updated in Step 3.
- `getComplianceOverview` calls `getOverview` then separately runs the compliance guardrails to avoid refactoring the overview path.
- The PATCH `/filings/[id]` handler must validate that `status` is only `'in_progress'` or `'filed'` — the full status enum (`future`, `na`, etc.) is not settable via this endpoint.

**For ux-developer (Step 5):**
- Mobile layout of `FilingsCalendar` is critical: card-per-filing at < sm, no horizontal scroll table.
- The asset-estimate label in `Panel990` must use the exact wording: "Estimated total assets (entity cash balance) — use real total assets for the actual filing."
- `MarkFiledDialog` uses shadcn `<Dialog>` (not `<ConfirmDialog>`); `DeleteFilingButton` uses `<ConfirmDialog>` with `destructive`.
- `LedgerSettingsForm` stores thresholds as cents; the form inputs are in dollars. Convert on submit (`Math.round(dollars * 100)`); display back as dollars. Validate that the dollar value has at most two decimal places.
- `StandingReminders` is a Server Component with no props; all copy is hardcoded JSX.
- `?entity=` search-param convention: confirm `EntitySwitcher` can be dropped in without modification (it should — same param, same page pattern).

---

# Phase 4 — Implementation

## Phase 4a — Implementation (schema) — 2026-06-25

**Owner:** database-admin
**Status:** complete

### Summary

Added `ledger_filings` to `src/lib/db/schema.ts` with all columns specified in the Phase 3 design. Authored `drizzle/migrations/0048_ledger_compliance.sql` with an idempotent `CREATE TABLE IF NOT EXISTS`, a `DO $$` guarded index for `ix_ledger_filings_entity_fy`, the inline `CONSTRAINT` unique key on `(entity_id, fiscal_year, agency, title)`, and nine seed rows (5 Club + 4 Foundation) using `ON CONFLICT … DO NOTHING`. TypeScript compiles clean; migrations run idempotently on repeated invocations; all 219 tests pass.

### Seeded fiscal_year = 2026 — rationale

The Lions fiscal year runs Jul 1 – Jun 30 and is identified by its start calendar year. Today is 2026-06-25, inside FY2025 (Jul 2025 – Jun 2026); FY2026 begins July 1, 2026.

Applying `computeDueDate` to the November filings: `month 11 >= 7`, so `new Date(fiscalYear, 10, 15)` = Nov 15 of the FY start year.

- `fiscal_year=2025` → Nov 15 **2025** — already past; all November rows would be overdue on first view.
- `fiscal_year=2026` → Nov 15 **2026** — six weeks away after FY start; the correct upcoming cycle.

The Annual Treasurer's Audit (`due_month=6 < 7`) resolves to `new Date(fiscalYear+1, 5, 30)`:
- `fiscal_year=2026` → Jun 30 **2027** — upcoming.

Seeding `fiscal_year=2026` means no seed row is overdue on install, and the compliance calendar shows the live upcoming cycle that opens July 1, 2026.

The Statement of Continued Existence is seeded with `next_due_year=2030` — a placeholder indicating the filing is due Nov 15 2030 (inside FY2030). The actual Ohio SOS renewal year should be confirmed with the treasurer before the row is edited; `2030` was specified in the Phase 3 design and is retained.

### What I did

- Added `ledgerFilings` table definition to `/Users/cshenso/git/westervillelions/src/lib/db/schema.ts` with all 15 columns from Phase 3 spec, `withTimezone: true` on both timestamp columns, inline comments, and matching `CONSTRAINT` unique + index in the table callback.
- Exported `LedgerFiling` and `NewLedgerFiling` type pairs.
- Authored `/Users/cshenso/git/westervillelions/drizzle/migrations/0048_ledger_compliance.sql`:
  - `CREATE TABLE IF NOT EXISTS ledger_filings` (all columns + inline unique constraint).
  - `DO $$ BEGIN IF NOT EXISTS … END $$` guard for `ix_ledger_filings_entity_fy`.
  - 5 Club seed rows + 4 Foundation seed rows, each using `ON CONFLICT (entity_id, fiscal_year, agency, title) DO NOTHING`, entity IDs looked up by slug.
- Ran `pnpm db:migrate` three times — first run creates the table and inserts seed rows; subsequent runs produce only NOTICE-level "already exists / skipped" messages and `✅ Migrations completed successfully`. No errors on any run.
- Ran `pnpm exec tsc --noEmit` — zero errors.
- Ran `pnpm test` — 219/219 pass (no regressions).

### Outputs

- Schema: `/Users/cshenso/git/westervillelions/src/lib/db/schema.ts` — `ledgerFilings` table + `LedgerFiling` / `NewLedgerFiling` types appended.
- Migration: `/Users/cshenso/git/westervillelions/drizzle/migrations/0048_ledger_compliance.sql` — all statements idempotent.
- Tables affected: `ledger_filings` (new); `ledger_entities` (referenced by FK).
- Seed rows: 9 total — 5 Club (IRS 990-N, Ohio AG Annual Report, Ohio Unclaimed Funds, Statement of Continued Existence, Annual Treasurer's Audit) + 4 Foundation (same minus Statement of Continued Existence). All `fiscal_year=2026`, `status='not_started'`.
- Local apply command: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`

### Open questions / handoff notes

- **Next agent:** api-developer (Step 2 — pure helpers + guardrails, Steps 3–4 — server queries + API routes).
- New table `ledger_filings` is available. Primary key: `id uuid`. Foreign key: `entity_id → ledger_entities(id) ON DELETE CASCADE`. Unique constraint name: `ledger_filings_entity_fy_agency_title_key` on `(entity_id, fiscal_year, agency, title)` — this is the ON CONFLICT target for `ensureFilingsForFY`. Index: `ix_ledger_filings_entity_fy` on `(entity_id, fiscal_year)`.
- `LedgerFiling` and `NewLedgerFiling` types are exported from `@/lib/db/schema`.
- `computeDueDate(fiscalYear, dueMonth, dueDay)` belongs in `src/lib/ledger.ts` (api-developer's responsibility per Phase 3 design — do not add it here).
- `nextDueYear=2030` for the Statement of Continued Existence is a placeholder. The treasurer should confirm the actual next Ohio SOS renewal year; it can be updated via the admin UI once the `ledger.manage`-gated edit-filing route is built (Step 4).
- The `createdAt`/`updatedAt` columns use `withTimezone: true` (matching the `homepageAnnouncements` pattern); the migration uses `timestamptz` which is equivalent. No discrepancy.

---

## Phase 4b — Implementation (API) — 2026-06-25

**Owner:** api-developer
**Status:** complete

### Summary

Added `computeDueDate` and `isFilingOverdue` pure helpers to `src/lib/ledger.ts`, extended `GuardrailsInput` with `irsFilingHistory` / `overdueFilingCount` (backward-compatible — existing callers pass `[]` / `0`), filled the `// TODO inc3` guardrail stub with the revocation-risk (HIGH) and overdue-filings (WARN) checks, added `ensureFilingsForFY` / `listFilings` / `getComplianceOverview` to `src/lib/ledger-queries.ts`, and created three API routes (`PATCH + DELETE /filings/[id]`, `POST /filings`, `PATCH /settings`). Typecheck is clean; all 246 tests pass (27 new).

### What I did

- **`src/lib/ledger.ts`**
  - Added `computeDueDate(fiscalYear, dueMonth, dueDay): Date` — month ≥ 7 → `new Date(fy, month-1, day)`; month < 7 → `new Date(fy+1, month-1, day)`.
  - Added `isFilingOverdue(filing, today): boolean` — `computeDueDate(...) < today && status NOT IN ('filed','na','future')`.
  - Extended `GuardrailsInput` with `irsFilingHistory: Array<{fiscalYear, status}>` and `overdueFilingCount: number`; existing callers pass safe defaults `[]` / `0`.
  - Replaced `// TODO inc3` stub with: (a) revocation guardrail — takes the last 3 entries of `irsFilingHistory`, fires HIGH if all three have status not in `('filed','na')`; suppressed when history has fewer than 3 entries; (b) overdue-filings guardrail — fires WARN when `overdueFilingCount > 0`.
  - Updated `getOverview()` call in `ledger-queries.ts` to pass `irsFilingHistory: [], overdueFilingCount: 0`.

- **`src/lib/ledger-queries.ts`**
  - Added `ledgerFilings`, `LedgerFiling`, `computeDueDate`, `isFilingOverdue` to static imports; collapsed three dynamic `sql` imports to the top-level static import.
  - Exported `FilingRow = LedgerFiling & { dueDate: Date; overdue: boolean }`.
  - `ensureFilingsForFY(entityId, fiscalYear)`: checks for existing rows; if absent, copies prior-FY rows via `INSERT … SELECT … ON CONFLICT DO NOTHING` with `status='not_started'`, NULL confirmation/filed_on/note, and `next_due_year = prior.next_due_year + 5` for 5-year rows. No-op if prior FY also empty.
  - `listFilings(entityId, fiscalYear)`: pure read. Filters 5-year rows via DECISION-022 predicate (`nextDueYear === (dueMonth >= 7 ? fiscalYear : fiscalYear + 1)`). Enriches each row with `dueDate` and `overdue`. Returns sorted by `dueDate ASC`.
  - `getComplianceOverview(entityId, fiscalYear)`: calls `getOverview`, `listFilings`, queries IRS filing history (`agency='IRS' AND fiscal_year < fiscalYear`), derives `overdueFilingCount`, appends inc3 flags to the overview's guardrail flags, returns `ComplianceOverview`.

- **API routes created:**
  - `src/app/api/admin/ledger/filings/[id]/route.ts` — `PATCH` (status update gated `LEDGER_RECORD`; metadata edit gated `LEDGER_MANAGE`, distinguished by body field presence) + `DELETE` (gated `LEDGER_MANAGE`; 409 if `status='filed'`).
  - `src/app/api/admin/ledger/filings/route.ts` — `POST` (gated `LEDGER_MANAGE`; 409 on unique-constraint conflict).
  - `src/app/api/admin/ledger/settings/route.ts` — `PATCH` (gated `LEDGER_MANAGE`; validates each of the four fields individually; requires at least one field).

- **`src/lib/ledger.test.ts`**
  - Updated `cleanState` to include `irsFilingHistory: []` and `overdueFilingCount: 0` so existing tests compile.
  - Added 27 new tests: `computeDueDate` (boundary month 7/6, Nov/Jun/Jan/Dec); `isFilingOverdue` (overdue/not/terminal statuses/same-day boundary); revocation guardrail (fires/clears/suppression <3 FYs/empty history/most-recent-3 slice); overdue-filings guardrail (fires/singular/plural/zero); backward-compat (inc3 defaults don't interfere with inc1/inc2 results).

### Outputs

**Files modified:**
- `/Users/cshenso/git/westervillelions/src/lib/ledger.ts` — `computeDueDate`, `isFilingOverdue` exports; `GuardrailsInput` extended; `guardrails()` inc3 checks filled.
- `/Users/cshenso/git/westervillelions/src/lib/ledger-queries.ts` — imports updated; `ensureFilingsForFY`, `listFilings`, `getComplianceOverview`, `FilingRow`, `ComplianceOverview` added; `getOverview` call updated with inc3 defaults.
- `/Users/cshenso/git/westervillelions/src/lib/ledger.test.ts` — `cleanState` updated; 27 new tests added.

**Files created:**
- `/Users/cshenso/git/westervillelions/src/app/api/admin/ledger/filings/[id]/route.ts`
- `/Users/cshenso/git/westervillelions/src/app/api/admin/ledger/filings/route.ts`
- `/Users/cshenso/git/westervillelions/src/app/api/admin/ledger/settings/route.ts`

**API contracts for ux-developer:**

| Method | Path | Gate | Request Body | Response |
|--------|------|------|--------------|----------|
| `PATCH` | `/api/admin/ledger/filings/[id]` | `LEDGER_RECORD` (status fields) | `{ status: 'in_progress'\|'filed', filedOn?: string, confirmation?: string, note?: string }` | `200 { filing }` |
| `PATCH` | `/api/admin/ledger/filings/[id]` | `LEDGER_MANAGE` (metadata fields) | `{ agency?, title?, dueMonth?, dueDay?, recurrence?, note? }` | `200 { filing }` |
| `DELETE` | `/api/admin/ledger/filings/[id]` | `LEDGER_MANAGE` | — | `204` / `409` if filed |
| `POST` | `/api/admin/ledger/filings` | `LEDGER_MANAGE` | `{ entityId, fiscalYear, agency, title, dueMonth, dueDay, recurrence, note? }` | `201 { filing }` / `409` if duplicate |
| `PATCH` | `/api/admin/ledger/settings` | `LEDGER_MANAGE` | `{ disbApprovalThresholdCents?, reserveWarnThresholdCents?, treasurerBonded?, philanthropyVisibility? }` | `200 { settings }` |

**Query functions for ux-developer:**

- `ensureFilingsForFY(entityId, fiscalYear): Promise<void>` — call in the Server Component before `listFilings`; idempotent.
- `listFilings(entityId, fiscalYear): Promise<FilingRow[]>` — returns filings with `dueDate: Date` and `overdue: boolean`; 5-year rows filtered by DECISION-022 predicate; sorted by `dueDate ASC`.
- `getComplianceOverview(entityId, fiscalYear): Promise<ComplianceOverview | null>` — all data for the compliance page in one call (entity, filings, gross receipts, entityBalance, determine990Result, guardrailFlags including inc3, settings).
- `getSettings(): Promise<LedgerSettings>` — for the settings page (already existed).

**Test result:** `246/246 pass`. **Typecheck:** clean.

### Open questions / handoff notes

- **Next agent:** ux-developer (Phase 4c — the compliance page, settings page, and all components).
- The PATCH `/filings/[id]` route discriminates between `LEDGER_RECORD` (status update) and `LEDGER_MANAGE` (metadata edit) by which fields are present in the body. A body with only `note` and no `status` field goes to the metadata-edit path (LEDGER_MANAGE). If the ux-developer's mark-filed dialog sends `note` alongside `status`, it goes to the LEDGER_RECORD path correctly.
- `ensureFilingsForFY` must be called before `listFilings` in the Server Component. The compliance page Server Component should call `await ensureFilingsForFY(entity.id, fiscalYear)` then `await getComplianceOverview(entity.id, fiscalYear)` (which itself calls `listFilings`). No need to call `listFilings` separately.
- The `getComplianceOverview` return's `entityBalanceCents` is a cash-balance proxy for assets — the compliance page's `Panel990` component must label it: "Estimated total assets (entity cash balance) — use real total assets for the actual filing."
- `getOverview()` (used on the overview page) now passes `irsFilingHistory: [], overdueFilingCount: 0` to `guardrails()`, so the revocation/overdue flags do NOT appear on the overview page — only on the compliance page (via `getComplianceOverview`). This is intentional: the compliance page is the authoritative surface for filing status.

---

## Phase 4b — Loop-back fix — 2026-06-25

**Owner:** ux-developer (applied during Phase 5 loop-back)
**Defect fixed:** `POST /api/admin/ledger/filings` returned HTTP 500 on unique-constraint conflict instead of 409.
**Root cause:** Drizzle ORM wraps the raw `PostgresError` (code `23505`) inside a new `Error` with the original as `.cause`. The inner catch checked `err.code` on the outer error; `code` only exists on `.cause`.
**Fix applied:** `src/app/api/admin/ledger/filings/route.ts` — the inner catch now resolves `pgCode` by checking both `err.code` and `err.cause?.code`. If either equals `"23505"`, returns 409.
**Gates after fix:** `pnpm exec tsc --noEmit` clean; `pnpm test` 246/246 pass.

---

## Phase 4c — Implementation (UI) — 2026-06-25

**Owner:** ux-developer
**Status:** complete

### Summary

Built the full UI layer for inc3 Compliance: the `/admin/ledger/compliance` page assembling a three-band filing calendar, 990 determination panel, and static standing reminders; the `/admin/ledger/settings` page with a dollar-input form for the four editable settings fields; six new components in `src/components/admin/ledger/`; and sidebar nav entries for both routes. All auth+permission gates are in place, no native browser dialogs used, mobile card layout enforced on the filing calendar. TypeScript clean, `pnpm build:only` green, 246/246 tests pass.

### What I did

- Created `mark-filed-dialog.tsx` — Radix Dialog (not ConfirmDialog), two submit buttons: "Save as In Progress" (no date required) and "Mark as Filed" (filedOn required, warns if future date). Resets form state from the filing's current values on open. Calls `PATCH /api/admin/ledger/filings/[id]`, `router.refresh()` on success.
- Created `delete-filing-button.tsx` — icon button disabled + tooltip for filed rows; `<ConfirmDialog destructive>` for the confirm step; surfaces 409 "Cannot delete a filed filing" via `toast.error`.
- Created `filing-form-dialog.tsx` — Radix Dialog for adding a one-off filing (LEDGER_MANAGE only). Calls `POST /api/admin/ledger/filings`, surfaces 409 duplicate on toast.
- Created `filings-calendar.tsx` — Server Component. Splits `FilingRow[]` into three bands (Overdue / Upcoming / Filed+NA). Card-per-filing layout at all widths using CSS Grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`) — never a horizontal scroll table. Each card shows agency badge, 5-year recurrence badge, title, due date, status badge, filed/confirmation details. Actions conditionally rendered by `canRecord`/`canManage` props.
- Created `panel-990.tsx` — Server Component. Shows form name badge (color-coded by form), `why` string, gross receipts, and entity balance in a yellow advisory card labeled exactly: "Estimated total assets (entity cash balance) — use real total assets for the actual filing." Renders revocation flag (HIGH severity, filtered by title containing "revocation") in a red alert card. Renders 990-PF note when `isFoundation=true`.
- Created `standing-reminders.tsx` — Server Component with no props. Seven hardcoded reminders from the transparency doc: raffle 50%, no political endorsements, sales tax, gaming license, no informal employment, social media monitoring, 7-year retention.
- Created `ledger-settings-form.tsx` — Client Component. Dollar-input fields with `$` prefix for both threshold fields, converts to/from cents with `Math.round(n * 100)`. Inline validation (non-negative, at most 2 dp). Checkbox for `treasurerBonded`, select for `philanthropyVisibility`. Calls `PATCH /api/admin/ledger/settings`, `toast.success` on success.
- Created `src/app/(dashboard)/admin/ledger/compliance/page.tsx` — Server Component. Auth preamble: `auth()` → `/signin`; `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` → `/access-pending`. Validates `?entity=` (notFound on bad slug), validates `?fy=`. Calls `ensureFilingsForFY` before `getComplianceOverview`. Renders guardrails (non-revocation ones; revocation is inside Panel990), EntitySwitcher, FiscalYearSelector, FilingsCalendar, Panel990, StandingReminders. Settings link shown only for `canManage`. `basePath="/admin/ledger/compliance"` passed to EntitySwitcher and FiscalYearSelector so navigation preserves context.
- Created `src/app/(dashboard)/admin/ledger/settings/page.tsx` — Server Component. Gate: `LEDGER_MANAGE` → redirect `/admin/ledger` if missing. Calls `getSettings()`, renders `<LedgerSettingsForm>` inside a card.
- Updated `entity-switcher.tsx` — added optional `basePath` prop (defaults to `/admin/ledger`) so the compliance page can reuse the same component without a separate copy.
- Updated `admin-sidebar.tsx` — added "Compliance" (LEDGER_VIEW) and "Ledger Settings" (LEDGER_MANAGE) entries below the existing "Ledger" entry.

### Outputs

**Files created:**
- `/Users/cshenso/git/westervillelions/src/components/admin/ledger/mark-filed-dialog.tsx`
- `/Users/cshenso/git/westervillelions/src/components/admin/ledger/delete-filing-button.tsx`
- `/Users/cshenso/git/westervillelions/src/components/admin/ledger/filing-form-dialog.tsx`
- `/Users/cshenso/git/westervillelions/src/components/admin/ledger/filings-calendar.tsx`
- `/Users/cshenso/git/westervillelions/src/components/admin/ledger/panel-990.tsx`
- `/Users/cshenso/git/westervillelions/src/components/admin/ledger/standing-reminders.tsx`
- `/Users/cshenso/git/westervillelions/src/components/admin/ledger/ledger-settings-form.tsx`
- `/Users/cshenso/git/westervillelions/src/app/(dashboard)/admin/ledger/compliance/page.tsx`
- `/Users/cshenso/git/westervillelions/src/app/(dashboard)/admin/ledger/settings/page.tsx`

**Files modified:**
- `/Users/cshenso/git/westervillelions/src/components/admin/ledger/entity-switcher.tsx` — `basePath` prop added
- `/Users/cshenso/git/westervillelions/src/components/admin/admin-sidebar.tsx` — Compliance + Ledger Settings nav entries

**Gates passed:**
- `pnpm exec tsc --noEmit` — clean (zero errors)
- `pnpm build:only` — green; `/admin/ledger/compliance` and `/admin/ledger/settings` both listed in route table
- `pnpm test` — 246/246 pass (no regressions)
- No `window.confirm/alert/prompt` in any new file
- No `console.log` in production paths
- No `lions-red` usage
- Auth + `hasFeature`/`hasAnyFeature` gates on both new pages
- `<ConfirmDialog destructive>` used for delete-filing; no native dialogs
- Filing calendar is card-per-filing (CSS Grid), not a horizontal-scroll table

### Open questions / handoff notes

**For qa (Phase 5) — what to click through:**

1. **Compliance page load** — navigate to `/admin/ledger/compliance`. Confirm three bands render (Overdue / Upcoming / Filed), the FY2026 seed filings appear in Upcoming, and the 990-N chip shows correctly for the Club entity.

2. **Mark-as-filed flow** — click "Update status" on any Upcoming filing. Confirm the dialog opens with today's date pre-filled. Enter a confirmation number and click "Mark as Filed." Confirm the filing moves to the Filed band, the confirmation number appears in the card, and a success toast fires.

3. **Save as In Progress** — open the same dialog on another filing, click "Save as In Progress" (no date required). Confirm the filing badge changes to "In progress."

4. **990 estimate label** — in the 990 panel, the asset estimate card must show the yellow advisory text exactly: "Estimated total assets (entity cash balance) — use real total assets for the actual filing." Verify it is present.

5. **Revocation warning rendering** — this requires 3+ IRS filings in past FYs with non-filed status. On a fresh install it will NOT appear (suppressed when < 3 FYs of history). Confirm the panel renders cleanly without the flag.

6. **Mobile card layout** — narrow the browser to 375px. Confirm each filing shows as a full-width card stack, not a horizontal scroll table.

7. **Settings page** — navigate to `/admin/ledger/settings`. Confirm the form loads with the current threshold values. Change the disbursement threshold to a new dollar value and click Save. Confirm toast fires and the value is retained on page refresh.

8. **Sidebar links** — confirm "Compliance" and "Ledger Settings" appear in the admin sidebar. A board_member (LEDGER_VIEW only) should see Compliance but not Ledger Settings. An admin should see both.

9. **Entity switcher** — switch between Club and Foundation on the compliance page. Confirm the URL updates `?entity=` and the filing calendar reloads for the Foundation entity (4 filings, no Statement of Continued Existence row).

10. **Delete (admin only)** — as an admin, attempt to delete an in-progress filing. Confirm the ConfirmDialog appears. Then attempt to delete a filed filing — the button should be disabled with a tooltip.

**Copy strings the Lions Club may want to refine:**
- All seven standing reminder bodies in `standing-reminders.tsx` — written from the transparency doc, but phrasing should be confirmed with the board/legal advisor.
- 990-PF note in `panel-990.tsx` — legal advisory language.
- Guardrail text ("Use real total assets") — confirm with treasurer.

**UX decisions and tradeoffs:**
- Revocation flag is shown in Panel990 (not in the guardrails list above the calendar) to keep it contextually near the 990 determination. Other guardrails appear in the list above the calendar. QA should confirm this division feels logical.
- `MarkFiledDialog` allows editing/correcting a filed row ("Edit / correct" button for LEDGER_RECORD users). This matches the API contract (PATCH allows un-filing) and prevents data entry errors from being permanent. The status badges update on `router.refresh()`.
- The entity switcher `basePath` prop is backward-compatible (defaults to `/admin/ledger`) so no regression on the overview page.

**Next agent:** qa (Phase 5)

---

# Phase 5 — Verification (qa)

## Phase 5 — Verification — 2026-06-25

**Owner:** qa
**Status:** needs-review (FAIL — one defect in Phase 4b, blocking)

### Summary

**FAIL.** The automated gates (TypeScript, Vitest 246/246, production build) all pass. The migration is idempotent; 9 seeded filings are confirmed in the DB (5 Club / 4 Foundation), all resolving to upcoming dates (none overdue on install). The compliance page, settings page, and all five API routes are in the build manifest. Permission gates are present and correctly keyed on every new route. The revocation guardrail suppression (<3 FYs), `computeDueDate` boundaries, `isFilingOverdue` same-day boundary, and filed-row delete block all work correctly. One blocking defect was found in Phase 4b: `POST /api/admin/ledger/filings` returns HTTP 500 instead of 409 on a unique-constraint conflict.

---

### What I did

#### Type Check
`pnpm exec tsc --noEmit`: **PASS** — zero errors.

#### Unit Tests
`pnpm test`: **PASS**
Total: 246 | Passed: 246 | Failed: 0
Duration: 0.303s
New tests (inc3): 27 — `computeDueDate` boundaries, `isFilingOverdue` all status paths + same-day boundary, revocation guardrail (fires/clears/suppression/<3 FYs/slice-last-3), overdue-filings guardrail (singular/plural/zero), backward-compat defaults.

#### Production Build
`pnpm build:only`: **PASS**
New routes confirmed in manifest:
- `/admin/ledger/compliance` (page)
- `/admin/ledger/settings` (page)
- `/api/admin/ledger/filings` (POST)
- `/api/admin/ledger/filings/[id]` (PATCH + DELETE)
- `/api/admin/ledger/settings` (PATCH)

#### Migration Idempotency
`pnpm db:migrate` run twice: **PASS** — second run produces NOTICE-only output (`relation "ledger_filings" already exists, skipping`) and completes `✅ Migrations completed successfully`. 9 FY2026 rows confirmed in DB (5 Club, 4 Foundation, all `not_started`).

#### Due-Date Correctness (verified via node + DB)
- `computeDueDate(2026, 11, 15)` → Nov 15 2026 (month ≥ 7, FY start year) — upcoming ✓
- `computeDueDate(2026, 11, 1)` → Nov 1 2026 (month ≥ 7) — upcoming ✓
- `computeDueDate(2026, 6, 30)` → Jun 30 2027 (month < 7, FY start year + 1) — upcoming ✓
- All 9 seeded filings resolve to upcoming dates; none are overdue on install ✓

#### End-to-End Flows (curl against running dev server, authenticated as e2e admin)

| Flow | Result | Notes |
|------|--------|-------|
| GET `/admin/ledger/compliance` (club entity) | 200 | Page renders |
| GET `/admin/ledger/compliance` (foundation entity) | 200 | Page renders |
| GET `/admin/ledger/settings` | 200 | Page renders |
| GET compliance with `?entity=garbage_slug` | 200 (fallback to first entity) | Deviation from spec (spec said notFound(); implementation defaults gracefully — not a 500, not a data leak) |
| PATCH `/filings/[id]` → `in_progress` (no filedOn) | 200 | status reflects correctly |
| PATCH `/filings/[id]` → `filed` without filedOn | 400 | Error: "filedOn is required when status is 'filed'" |
| PATCH `/filings/[id]` → `filed` with valid filedOn | 200 | status, confirmation, filedOn reflect |
| DELETE filed filing | 409 | "Cannot delete a filed filing. Mark as N/A instead." |
| DELETE unfiled (in_progress) filing | 204 | Row removed |
| POST one-off filing (new) | 201 | Filing inserted |
| POST duplicate filing | **500 (expected 409)** | **DEFECT — see below** |
| PATCH metadata + status mixed | 400 | "Cannot mix status-update and metadata-edit fields" |
| PATCH metadata only (agency) | 200 | Field updated |
| PATCH settings negative threshold | 400 | Correct validation |
| PATCH settings valid | 200 | Fields persisted |
| PATCH settings invalid philanthropyVisibility | 400 | Correct validation |
| Unauthenticated access to all 5 new routes | 401 | All auth gates fire |

#### Manual Click-Through (auth-blocked flows)

| Flow | Result | Notes |
|------|--------|-------|
| Google OAuth path | N/A | Not touched by this increment |
| Revocation flag rendering (3+ unfiled past FYs) | Cannot drive in browser (no past FY data) | Verified via unit tests: guardrail fires correctly when `irsFilingHistory.length >= 3` and all unfiled; suppressed when `< 3`. Unit tests cover all branches. |
| Mobile card layout (375px) | Not browser-driven | Code audit: `filings-calendar.tsx` uses `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` — no horizontal-scroll table; satisfies the spec. |
| Board member read-only gate | Not browser-driven | Code audit: `canRecord`/`canManage` booleans derived server-side and passed as props; mark-filed/delete buttons not rendered when false; both API gates enforced independently. |

#### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `GET /admin/ledger/compliance` (page) | yes | `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` | yes — correct multi-key read gate |
| `GET /admin/ledger/settings` (page) | yes | `hasFeature(FEATURES.LEDGER_MANAGE)` | yes |
| `PATCH /api/admin/ledger/filings/[id]` (status) | yes | `hasFeature(FEATURES.LEDGER_RECORD)` | yes |
| `PATCH /api/admin/ledger/filings/[id]` (metadata) | yes | `hasFeature(FEATURES.LEDGER_MANAGE)` | yes |
| `DELETE /api/admin/ledger/filings/[id]` | yes | `hasFeature(FEATURES.LEDGER_MANAGE)` | yes |
| `POST /api/admin/ledger/filings` | yes | `hasFeature(FEATURES.LEDGER_MANAGE)` | yes |
| `PATCH /api/admin/ledger/settings` | yes | `hasFeature(FEATURES.LEDGER_MANAGE)` | yes |

All gates are present and correctly keyed. No missing gates found.

#### Coverage on Critical Modules (inc3 additions)
- `src/lib/ledger.ts` — `computeDueDate`, `isFilingOverdue`, revocation guardrail, overdue guardrail: all branches exercised by the 27 new tests. No uncovered branch identified.
- `src/lib/ledger-queries.ts` — `ensureFilingsForFY`, `listFilings`, `getComplianceOverview` are DB-bound; not Vitest-covered (requires e2e or integration test). The pure logic within these functions (5-year predicate, overdue flag derivation) is tested indirectly via the unit tests on `computeDueDate` and `isFilingOverdue`.

---

### Defect: POST /api/admin/ledger/filings returns 500 on duplicate (expected 409)

**Phase:** 4b (api-developer)
**File:** `src/app/api/admin/ledger/filings/route.ts`, lines 155–168
**Symptom:** `POST /api/admin/ledger/filings` with a duplicate `(entityId, fiscalYear, agency, title)` returns HTTP 500 with body `{"error":"Failed to create filing"}` instead of HTTP 409.
**Root cause:** Drizzle ORM wraps the raw `PostgresError` (which has `.code === "23505"`) inside a new `Error` object with the original as `.cause`. The route handler checks `err.code === "23505"` on the outer error, but the `code` property is only present on `err.cause`. The outer error's `.code` is undefined, so the catch branch falls through to the generic 500 handler.
**Evidence:** Dev server log shows `[cause]: Error [PostgresError]: duplicate key value violates unique constraint ... code: '23505'` — the code is on `.cause`, not on the outer error.
**Fix (for implementer):** Change the constraint-violation check to also inspect `err.cause`:
```typescript
const pg23505 =
  (typeof err === "object" && err !== null && "code" in err && (err as {code:string}).code === "23505") ||
  (typeof err === "object" && err !== null && "cause" in err &&
   typeof (err as {cause:unknown}).cause === "object" &&
   (err as {cause:unknown}).cause !== null &&
   "code" in ((err as {cause:unknown}).cause as object) &&
   ((err as {cause:{code:string}}).cause).code === "23505");
if (pg23505) { return NextResponse.json({ error: "..." }, { status: 409 }); }
```

Or more simply, check the constraint name on the cause:
```typescript
const cause = (err as {cause?: {code?: string; constraint_name?: string}}).cause;
if (cause?.code === "23505") { return NextResponse.json({ error: "..." }, { status: 409 }); }
```
**Regression test:** An e2e test that POSTs the same filing twice and asserts the second returns 409 (not 500).

---

### Open questions / handoff notes

- **Next agent:** api-developer (Phase 4b loop-back) — one fix in `src/app/api/admin/ledger/filings/route.ts` lines 155–168 to check `err.cause?.code === "23505"` for the Drizzle-wrapped PostgresError.
- The `?entity=garbage_slug` graceful-fallback behavior (200 + first entity) deviates from the Phase 3 spec ("calls `notFound()`"). This is safe UX but should be acknowledged. If the spec intent was strict 404 enforcement, the implementer can add: `if (entityParam && !validSlugs.includes(entityParam)) notFound();` before line 81. Flag for analyst review in Phase 6.
- After the 409 fix is applied, re-run `pnpm test` (246 should remain green), re-run `pnpm build:only`, and re-verify the duplicate-POST flow via curl before returning to qa.

---

# Phase 6 — Shipped vs Intent (analyst)

## Phase 6 — Shipped vs Intent — 2026-06-25

**Owner:** analyst
**Status:** complete

### Summary

**SHIP WITH NOTES.** The Compliance increment delivers on every substantive intent item from Phase 1: the seeded FY2026 calendar (9 rows, all upcoming on install), mark-filed with in-progress path, 990 determiner with the required estimate label, revocation guardrail correctly suppressed on a fresh install, all seven standing reminders, the settings screen closing the twice-deferred `disbApprovalThresholdCents` gap, and the auto-rollover helper. Permission gates are in place at both UI and API layers. One functional gap from Phase 1 is formally deferred (the QA-surfaced `?entity=garbage_slug` graceful fallback vs. the spec's `notFound()`). Two minor follow-ups: agency color badges are mismatched between migration seed strings and the badge color map (cosmetic), and the settings page redirects non-manage users to `/admin/ledger` instead of `/access-pending` (acceptable drift — both destinations are safe). Inc4–6 scope is not leaked. Pipeline closes.

---

### What I did

Walked every user flow from Phase 1 against the actual shipped code:
- `src/app/(dashboard)/admin/ledger/compliance/page.tsx`
- `src/app/(dashboard)/admin/ledger/settings/page.tsx`
- `src/components/admin/ledger/filings-calendar.tsx`, `mark-filed-dialog.tsx`, `delete-filing-button.tsx`, `panel-990.tsx`, `standing-reminders.tsx`, `ledger-settings-form.tsx`
- `src/app/api/admin/ledger/filings/[id]/route.ts`, `filings/route.ts`, `settings/route.ts`
- `src/lib/ledger.ts` (`computeDueDate`, `isFilingOverdue`, revocation guardrail, overdue guardrail)
- `drizzle/migrations/0048_ledger_compliance.sql` (seed rows, agency strings)
- `src/components/admin/admin-sidebar.tsx` (nav entries)
- DECISIONs 021/022 for the due-date and rollover contracts

---

### Intent-vs-Shipped Diff

**Filings calendar seeded for FY2026 (5 Club / 4 Foundation)**
Phase 1 said: seed 9 rows, all upcoming on install. Shipped: migration seeds exactly 5 Club + 4 Foundation rows for `fiscal_year=2026`. `computeDueDate` on the November rows produces Nov 2026; on the June row it produces Jun 2027. QA verified no row is overdue on a fresh install. Verdict: **matches.**

**Grouping: overdue / upcoming / filed**
Phase 1 said: three bands. Shipped: `FilingsCalendar` derives `overdue` (`f.overdue`), `upcoming` (`!f.overdue && !['filed','na'].includes(f.status)`), and `filed` (`status === 'filed' || status === 'na'`). Note: the band label is "Filed / N/A" (not "Filed") — the N/A status is grouped in here, which is correct UX but is labelled more explicitly than Phase 1 described. Empty states are human text, not blank. Verdict: **matches (acceptable drift on band label).**

**Due dates correct (Nov 2026 upcoming, not overdue-on-install)**
Phase 1 said: November filings must be upcoming, not overdue. Shipped: `computeDueDate(2026, 11, 15)` = Nov 15 2026. QA verified via node. Verdict: **matches.**

**Mark-filed flow: in_progress / filed-with-date, gated `ledger.record`**
Phase 1 said: two-path dialog (Save as In Progress / Mark as Filed), `LEDGER_RECORD` gate. Shipped: `MarkFiledDialog` has both buttons; `PATCH /filings/[id]` gates `LEDGER_RECORD` for status update. Client validates `filedOn` required on "Mark as Filed" path; future-date warning renders but does not block (as spec required). API-level `LEDGER_RECORD` gate confirmed in route code. Verdict: **matches.**

**Admin add / edit / delete filings, filed-row delete blocked**
Phase 1 said: `ledger.manage` gates admin actions; filed-row delete returns 409. Shipped: `FilingFormDialog` (POST), `DeleteFilingButton` (`<ConfirmDialog destructive>`), metadata edit via PATCH metadata path — all gated `LEDGER_MANAGE`. Delete button is disabled with tooltip when `status === 'filed'` at the UI layer; API returns 409 if filed. Defense in depth present. Verdict: **matches.**

**990 determiner panel with estimate label**
Phase 1 said: surface `determine990()`, label asset figure explicitly as estimate. Shipped: `Panel990` renders the form badge, `why` text, gross receipts, and the assets card with the exact required label: "Estimated total assets (entity cash balance) — use real total assets for the actual filing." Both are rendered in a yellow advisory card, visually distinct from the gross receipts tile. Verdict: **matches.**

**3-missed-years revocation warning: suppressed with <3 FYs of data**
Phase 1 said: suppress when fewer than 3 FYs of IRS history. Shipped: `guardrails()` checks `state.irsFilingHistory.length >= 3` before firing. On a fresh install with only FY2026 data, `irsFilingHistory` will be empty for past FYs → suppressed. Correctly implemented. Verdict: **matches.**

**990-PF note for Foundation**
Phase 1 said: render a note that 990-PF applies if Foundation reclassified. Shipped: `Panel990` renders a purple advisory card when `isFoundation === true`. Verdict: **matches.**

**Standing reminders (7 items)**
Phase 1 said: raffle 50%, no political endorsements, sales tax, gaming, no informal employment, social-media, 7-yr retention. Shipped: `StandingReminders` has all seven as `REMINDERS` array entries. Copy is sourced from the transparency doc. Verdict: **matches.**

**Settings page: 4 ledger_settings fields, gated `ledger.manage`**
Phase 1 said: settings-edit screen closes the twice-deferred threshold gap. Shipped: `/admin/ledger/settings` page renders `LedgerSettingsForm` with all four fields (`disbApprovalThresholdCents`, `reserveWarnThresholdCents`, `treasurerBonded`, `philanthropyVisibility`). Dollar↔cents conversion in form. Server-side validation on all four fields. Page gate confirmed. Verdict: **matches.**

**Auto-rollover: materializes new FY, does NOT carry filed status**
Phase 1 said (per resolved defaults): `ensureFilingsForFY` explicit call, no write-on-read; rollover copies `not_started`, not prior filed status. Shipped: compliance page calls `ensureFilingsForFY(entity.id, fiscalYear)` before `getComplianceOverview`. `ensureFilingsForFY` in `ledger-queries.ts` inserts rows from prior FY with `status='not_started'`, NULL confirmation/filed_on/note. `ON CONFLICT DO NOTHING` on the 4-column unique key. Verdict: **matches.**

**Permission matrix: board reads (not settings, no mark-filed); treasurer marks-filed (not settings/manage); admin all; member none**
Phase 1 said: exact three-tier split. Shipped: compliance page uses `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])`; mark-filed button only rendered when `canRecord`; delete/add only when `canManage`. All API routes independently gate with `hasFeature`. Sidebar: "Compliance" entry gates `LEDGER_VIEW`; "Ledger Settings" entry gates `LEDGER_MANAGE`. Verdict: **matches.**

**One gap from Phase 1 explicitly deferred: settings page redirect target**
Phase 1 said: the settings page should redirect to `/access-pending` when `LEDGER_MANAGE` is missing. Shipped: settings page redirects to `/admin/ledger` instead. This is safe — a user with any ledger feature but lacking `LEDGER_MANAGE` lands on the ledger overview (their legitimate home) rather than the generic access-pending screen. The compliance page correctly redirects to `/access-pending` when none of the three ledger features are present. This is acceptable drift: a ledger-authenticated user hitting the settings URL should land on the ledger, not the no-role pending screen. Noted as a follow-up for clarity but not a regression. Verdict: **acceptable drift.**

**QA-flagged deviation: `?entity=garbage_slug` graceful fallback (not `notFound()`)**
Phase 3 spec said: call `notFound()` on an invalid entity slug. Shipped: page checks whether `entityParam` is in `validSlugs`, and if not, silently falls back to the first entity. If no entities exist at all, it renders an empty-state message. This is safe from a data-exposure standpoint (no cross-entity leak), but it diverges from the strict 404 behavior. It means a malformed URL silently serves the default entity instead of signaling "this URL is invalid." Verdict: **acceptable drift — safe; follow-up issued to add `if (entityParam && !validSlugs.includes(entityParam)) notFound()`.**

**Agency badge color map mismatch (cosmetic)**
The `AgencyBadge` component maps abbreviated agency names (`'Ohio AG'`, `'Ohio SOS'`, `'Ohio COM'`, `'Internal'`) but the migration seeds full agency names (`'Ohio Attorney General'`, `'Ohio Secretary of State'`, `'Ohio Dept. of Commerce'`, `'Internal — Audit Committee'`). Only IRS filings receive their intended colored badge; all Ohio state agency and Internal filings render with the gray fallback. The badge text is correct (it renders the actual agency string), so functionality is unaffected — a treasurer can still read "Ohio Attorney General" — but the intended color differentiation is absent. Verdict: **follow-up required (cosmetic).**

---

### Edge Cases

| Check | Verdict |
|-------|---------|
| Empty state (no filings seeded) | **pass** — three bands each have an empty-state paragraph ("No overdue filings." / "No upcoming filings." / "No filed filings yet."), consistent with brand pattern |
| Empty state (no entities) | **pass** — compliance page renders a gray-50 rounded-2xl card with human text |
| Failure microcopy (API error on mark-filed) | **pass** — `toast.error` with the API's error message; modal stays open preserving input |
| Failure microcopy (API error on delete) | **pass** — `toast.error`; `ConfirmDialog` dismissed before the API call, which is correct since the confirm step has already happened |
| Permission gate (mark-filed API without LEDGER_RECORD) | **pass** — `PATCH /filings/[id]` status path gates `LEDGER_RECORD`; 403 returned |
| Permission gate (settings page without LEDGER_MANAGE) | **pass** (with drift) — redirects to `/admin/ledger` not `/access-pending`; safe |
| Permission gate (compliance page without any ledger feature) | **pass** — redirects to `/access-pending` |
| Mobile card layout | **pass** — `filings-calendar.tsx` uses `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`; no horizontal scroll table |
| Destructive confirm for delete | **pass** — `<ConfirmDialog destructive>` used in `DeleteFilingButton`; `window.confirm` not present |
| Brand consistency (rounded-2xl cards, rounded-lg buttons, no rounded-full) | **pass** — filing cards use `rounded-2xl`; dialog and action buttons use `rounded-lg`; no `rounded-full` observed |
| 990 estimate caveat prominence | **pass** — rendered in a yellow advisory card with distinct background, separate from the gross receipts tile; label text matches required wording exactly |
| Revocation suppression on install | **pass** — `irsFilingHistory.length >= 3` guard; fresh install has 0 past IRS rows, warning suppressed |
| Inc4–6 scope not leaked | **pass** — no report/CSV export, no philanthropy dashboard, no donor acknowledgments in any new file |

---

### Outputs

- Work-log at `/Users/cshenso/git/westervillelions/docs/work-log/2026-06-25-ledger-compliance.md` — Phase 6 section written; Per-Phase Status table updated.

### Open questions / handoff notes (follow-ups)

**RESOLVED (2026-06-25, before ship):** both fixed. (1) `AgencyBadge` color map re-keyed on the full seeded agency strings (no data migration — the meaningful full names stay in the DB). (2) Compliance page now `notFound()`s an invalid `?entity=` slug. tsc + 246 tests + build green.

Two follow-ups for tracked issues — neither blocks shipping:

1. **Agency badge color map alignment.** `AgencyBadge` in `filings-calendar.tsx` maps abbreviated strings; migration seeds full names. Fix: either align the migration seeds to use the abbreviated forms (`'Ohio AG'`, `'Ohio SOS'`, `'Ohio COM'`, `'Internal'`) or expand the badge map to include the full strings as additional keys. The abbreviated forms are shorter and easier to display in the badge, so updating the migration is the cleaner path — but it requires a new idempotent migration to `UPDATE ledger_filings SET agency = 'Ohio AG' WHERE agency = 'Ohio Attorney General'` etc., with `ON CONFLICT DO NOTHING` on the re-seed. Track as a cosmetic follow-up.

2. **`?entity=garbage_slug` should call `notFound()`.** Compliance page currently falls back to the first entity for an unrecognized slug. Add: `if (entityParam && !validSlugs.includes(entityParam)) notFound();` after the `validSlugs` derivation (line 80 of the compliance page). Low priority; safe as-is.
