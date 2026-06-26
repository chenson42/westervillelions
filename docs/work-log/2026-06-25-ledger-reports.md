# The Ledger — Increment 4: Reports & 990-Prep Export — Work Log

> **Slug:** `2026-06-25-ledger-reports`
> **Surface:** (dashboard) admin — `/admin/ledger/reports`
> **Permission(s):** reuse `ledger.view` (view reports); export gate TBD in Phase 1 (`ledger.view` and/or existing `reports.export`). No new key expected.
> **Estimated complexity:** medium (read/aggregate + CSV generation; likely no schema)
> **Pipeline mode:** Full

---

## Context

This is **increment 4 of 6** of The Ledger. Shipped: **inc1 Books** (v1.20.0), **inc2 Controls + Reimbursements** (v1.21.0), **inc3 Compliance** (v1.22.0). Full design: `docs/features/the-ledger-accounting.md`; prior work-logs `2026-06-24-ledger-books.md`, `…-ledger-controls.md`, `2026-06-25-ledger-compliance.md`; DECISIONs 015–022. Read those first.

What already exists to build on:
- **Fund report (Budget / Actual / Variance)** per fund × FY — built in inc1 (`getFundReport`), surfaced at `/admin/ledger/[fundSlug]/report`.
- **`determine990()`** + the compliance 990 panel (inc3).
- `ledger-queries.ts` aggregation helpers (`getFundReport`, `getOverview`, `grossReceiptsCents`, entity balances), `ledger_transactions`/`ledger_categories`/`ledger_funds`/`ledger_entities`. **Verify whether `ledger_categories.form990Line` exists** (spec §4.4 had it nullable — confirm in the real schema; inc4 may need to add + populate the 990-line mapping).
- Hand-rolled CSV precedent (no new dep): dues export, and the architect's inc1 ruling that ledger CSV is hand-rolled `text/csv`.

**Increment 4 — "Reports & 990-Prep" — scope (Phase 1 to refine):**
1. **Reports page** `/admin/ledger/reports` — per entity × fiscal year: an entity-level financial summary (each fund's opening / income / expense / ending; the Budget/Actual/Variance already exists per-fund — consolidate at the entity level), gross receipts, total giving, and the 990 determination. A year-end "financial report" view per the transparency doc (opening balance, itemized income, itemized expenses, ending balance, per fund).
2. **CSV exports** (hand-rolled `text/csv`, no new dep):
   - **Transaction ledger export** — all transactions for an entity × FY (date, fund, flow, category, party, amount, status, reconciled), for the audit.
   - **990-prep export** — income/expense aggregated by **990 line** (via `ledger_categories.form990Line`, or category if the mapping isn't present yet) per entity × FY, plus the `determine990()` result — to make filing the 990/990-EZ easier.
   - (Phase 1 to decide) a fund-report / financial-statement export.
3. **990-line mapping** — if `form990Line` is not already populated, decide how it's set (seed defaults per category, or an admin mapping screen). Keep minimal; the 990-prep export degrades gracefully (group by category) if a line isn't mapped.

**Explicitly deferred (do NOT build here):** member philanthropy/impact dashboard (inc5); donors/acknowledgments + dues→Admin & Zeffy→Activity auto-post (inc6).

## Phase 1 decisions — resolved defaults (accepted 2026-06-25)

Accepting the analyst's recommendations: (1) **`form_990_line` is seeded** via an idempotent `UPDATE ledger_categories SET form_990_line=… WHERE name=… AND form_990_line IS NULL` migration (map the ~15 seeded categories to ~6–8 990-EZ line labels) — no admin mapping UI; 990-prep export degrades to group-by-category (with a header note) where unmapped. (2) **Export gate = `hasAnyFeature([LEDGER_VIEW, REPORTS_EXPORT])`** (same OR-pattern as dues export; board can export what they can view). (3) **Reports page is an entity-level consolidation** (all funds: opening/itemized income/itemized expense/ending + entity totals + `determine990` result) — does NOT re-implement the per-fund Budget/Actual/Variance report at `/ledger/[fundSlug]/report`. (4) **990-prep excludes transfer rows** (`transferGroupId IS NOT NULL`) and is **posted-only**; the **transaction-ledger CSV shows all statuses** (with a status column). (5) 990-prep CSV carries the **cash-basis worksheet disclaimer** (consistent with inc3's 990 estimate labeling). No new schema column, no new permission key.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-06-25 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-06-25 |
| 3 — Technical design | tech-lead | Complete | Design complete | 2026-06-25 |
| 4 — Implementation | database-admin → api-developer → ux-developer | Complete (4a + 4b + 4c done) | — | 2026-06-25 |
| 5 — Verification | qa | Complete | PASS | 2026-06-25 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-06-25 |

---

# Phase 1 — Functional Refinement — 2026-06-25

**Owner:** analyst
**Status:** complete

### Summary

Inc4 adds a consolidated entity-level reports page at `/admin/ledger/reports`, a transaction-ledger CSV export, and a 990-prep CSV export. The underlying aggregation data already exists (`getFundReport`, `getOverview`, `grossReceiptsCents`, `determine990`); this increment is primarily a read/aggregate + two hand-rolled CSV exports. The schema column `ledger_categories.form_990_line` exists in both the Drizzle schema and the 0044 migration DDL but is **not populated** — every seeded category was inserted with no `form_990_line` value, so the 990-prep export cannot group by 990 line today. That is the single most scope-shaping finding. The export gate and the report-consolidation delta (entity-level vs. the per-fund report already shipped) are the other two decisions that must be resolved before Phase 2 begins.

### What I did

Five-pass review against the real schema, migration seed, `ledger-queries.ts`, `dues/export/route.ts`, and `the-ledger-accounting.md`.

---

**Verdict: READY WITH NOTES**

**One-line take:** A read/aggregate increment that is close to straightforward, gated on one concrete decision (how to get 990-line values into the seeded categories) and one permission call (does board export require `reports.export` or is `ledger.view` sufficient).

---

#### Pass 1 — User Verbs

Surface: **Admin** (dashboard) — `/(dashboard)/admin/ledger/reports`. Roles in scope: admin, treasurer, board_member (all hold `LEDGER_VIEW`).

- Treasurer/board selects an entity (Club or Foundation) from a picker.
- Treasurer/board selects a fiscal year from a dropdown.
- Treasurer/board reads the consolidated entity financial summary: per fund — opening balance, itemized income, itemized expenses, ending balance; entity-level totals (gross receipts, net); 990 determination label.
- Treasurer/board clicks "Export transaction ledger (CSV)" and downloads the file.
- Treasurer/board clicks "Export 990-prep worksheet (CSV)" and downloads the file.
- Admin (with `LEDGER_MANAGE`) navigates to categories and sets a 990-line label on each category. (Scope TBD — see Gap 1.)

The request does not name a separate "fund-level financial-statement export" button. Phase 1 recommends deferring that — the per-fund Budget/Actual/Variance report at `/admin/ledger/[fundSlug]/report` already exists and can be printed; a duplicate export adds scope without adding capability.

---

#### Pass 2 — Flow Audit

**Flow A — View consolidated report**

Entry: user navigates to `/admin/ledger/reports` (or clicks "Reports" in the ledger nav).

Steps:
1. Page loads with entity selector (Club / Foundation) and FY picker, defaulting to current entity and current FY.
2. User selects entity and FY. Page re-renders (server component or client-side param update).
3. User sees: each fund as a card/section with opening balance, itemized income lines (category + amount), itemized expense lines (category + amount), ending balance; below the funds, entity-level: gross receipts, determine990 result, any active guardrail warnings.

Success outcome: fully populated financial summary.

Failure paths:
- No transactions exist for the selected FY: page shows each fund at opening balance with $0 income/expense; gross receipts = $0; determine990 still runs and returns the correct form (990-N if receipts = $0). Empty state must be helpful ("No transactions recorded for FY2026 Jul–Jun 2027. Opening balances are shown."), not blank.
- Entity has no funds (fresh install): page shows "No funds configured for this entity" with a link to the funds management page (requires LEDGER_MANAGE).
- DB error: generic server error message; no stack trace.

**Flow B — Download transaction ledger CSV**

Entry: "Export transaction ledger" button on the reports page.

Steps:
1. User clicks button. Browser initiates download via `GET /api/admin/ledger/export?entity=club&fy=2026&type=transactions`.
2. Server streams a `text/csv` response.
3. Browser saves file as e.g. `club-ledger-FY2026-Jul2026-Jun2027.csv`.

Success outcome: CSV opens in Excel/Sheets with expected columns and all posted transactions for the entity+FY. Pending rows: see Gap 5.

Failure paths:
- Invalid `entity` slug or `fy` param: 400 with JSON error (same pattern as dues export).
- Auth/permission check fails: 401 or 403 with JSON error.
- Empty FY (no transactions): valid CSV with header row only and a comment row ("No transactions for this period").
- DB error: 500 with generic JSON error message.

Proposed columns: Date, Fund, Flow (Income/Expense), Category, Party/Payee, Amount ($), Status, Reconciled, Payment Method, Memo.

**Flow C — Download 990-prep CSV**

Entry: "Export 990-prep worksheet" button on the reports page.

Steps:
1. User clicks button. Browser initiates download via `GET /api/admin/ledger/export?entity=club&fy=2026&type=990prep`.
2. Server aggregates posted income and expense by 990-line label (from `ledger_categories.form_990_line`); where a category has no 990 line, groups under "Unmapped / [category name]".
3. Browser saves file as e.g. `club-990prep-FY2026-Jul2026-Jun2027.csv`.

Success outcome: CSV lists each 990-line group with total income and total expense; header rows include the entity name, FY, gross receipts, determine990 result, and the cash-basis disclaimer.

Failure paths:
- No categories have 990 lines mapped: all rows fall under "Unmapped"; file is still useful for the totals but the 990-line column is blank. A comment row should say "Note: no 990-line mappings configured — group by category name used instead."
- No posted transactions: CSV with header and zero-amount rows per category.
- Same auth/param failures as Flow B.

---

#### Pass 3 — Permissions

**Existing keys cover inc4 with one decision to make:**

| Surface | Gate | Notes |
|---|---|---|
| Reports page (view) | `LEDGER_VIEW` | Covers admin, treasurer, board_member. Confirmed in permissions.ts. |
| Transaction CSV export | Decision needed — see below | |
| 990-prep CSV export | Decision needed — see below | |
| Category 990-line edit (if built) | `LEDGER_MANAGE` | Admin only. Existing key. |

**Export gate decision (the one call to make):**

Option A — `LEDGER_VIEW` alone gates all ledger exports. Pro: board members who can view the report can also download it; no friction for legitimate use. Con: financial data (transaction-level detail including payee names and amounts) leaves the portal in an export that anyone with board access can share. This is the same data they can already see on-screen, so the marginal risk is low.

Option B — `LEDGER_VIEW OR REPORTS_EXPORT` (same logic as dues export which gates on `DUES_MANAGE OR REPORTS_EXPORT`). Pro: matches the established pattern for sensitive exports; the `REPORTS_EXPORT` key can be granted narrowly. Con: board members without `REPORTS_EXPORT` who already have `LEDGER_VIEW` cannot download what they can already read.

Option C — `LEDGER_VIEW AND REPORTS_EXPORT` (both required). Con: over-gates; treasurer who holds `LEDGER_RECORD` but not `REPORTS_EXPORT` would be blocked from exporting their own data.

**Recommendation: Option B (`LEDGER_VIEW OR REPORTS_EXPORT`).** It matches the existing dues-export precedent exactly, is consistent, and gives the admin flexibility to grant export rights separately from view rights. No new permission key is needed.

No new `FEATURES.*` keys required for inc4.

---

#### Pass 4 — Edge Cases the Request Didn't Mention

- **OAuth-vs-password users:** No user identity information appears in exports; not affected by auth provider.
- **Access-pending surface:** Reports are behind `LEDGER_VIEW`; a member without that feature is redirected to `/access-pending` — standard pattern, no special handling needed.
- **Email queue:** Inc4 has no email story. None needed; confirm with user.
- **Google Group sync:** Reports and CSV exports do not touch group membership. Not affected.
- **Empty state — no funds:** A fresh install with no seeded funds will produce an empty page. The page must render a helpful message rather than a blank or an error.
- **Empty state — no transactions but funds exist:** Already handled by `getFundReport` (returns zero actuals for all categories); the page needs to communicate "No transactions" without confusing the user into thinking the data failed to load.
- **Empty state — 990-line mapping absent:** Every seeded category has `form_990_line = NULL`. This is the current state of the database. The 990-prep export must degrade gracefully and tell the user why the grouping is by category instead of by 990 line. This is not a blocker for shipping inc4 but it reduces the utility of the 990-prep export significantly for clubs approaching 990-EZ thresholds.
- **Failure microcopy:** Both exports need a non-stack-trace error state. The button should not vanish on error; it should show a toast ("Export failed — try again or contact support") and remain clickable.
- **Mobile:** The reports page at 360px must be readable. Financial tables with many columns tend to overflow. Recommend horizontal scroll with `overflow-x-auto` on the table container rather than squashing columns. The export buttons should be full-width on mobile.
- **Brand consistency:** Cards `rounded-2xl`, buttons `rounded-lg`, hero `py-12` (member portal context). No destructive actions on this page; `ConfirmDialog` is not needed.
- **Pending transactions in totals:** `getFundReport` and `getOverview` already filter to `status = 'posted'` for balance and income/expense totals. Pending transactions are excluded from all report figures by the existing query layer. The transaction CSV should include all statuses with the `status` column visible so the auditor can see what is pending; the 990-prep export should include only posted transactions (consistent with balance semantics).
- **Transfer rows:** Transfer pairs (linked by `transferGroupId`) appear in the transaction ledger as two rows — one income in the destination fund, one expense in the source fund — because `flow` is `'income' | 'expense'` only (DECISION-017). The 990-prep export should exclude transfer rows from income/expense aggregation to avoid double-counting; they are internal fund movements, not gross receipts or program expenses. This is a non-trivial filter and must be called out in the design.
- **Large datasets:** A club with thousands of transactions across multiple years requesting an all-transactions CSV could be slow. For a club of this size (dozens of members, ~100-200 transactions/year), this is unlikely to be a practical problem, but the query should use `status` and FY filters to bound the result set.

---

#### Pass 5 — Adversarial Pass

- **Redirect targets:** No URL parameter on this surface is a redirect target. The `entity` and `fy` query params are used to scope a database query, not to redirect the browser. Validated as non-redirect before use: `entity` is validated against known slugs ('club'/'foundation'); `fy` is an integer bounded to a sane range. No open-redirect risk.
- **State-machine shortcuts:** The export API route must independently verify the session and permission. A user who guesses the export URL without `LEDGER_VIEW OR REPORTS_EXPORT` must receive 401/403. This is the standard route-handler pattern already established in dues export.
- **Enumeration leaks:** A 403 on the export route does not reveal whether data exists; a 401 does not reveal whether the entity or FY is valid. The dues export already handles this correctly; inc4 should follow the same pattern.
- **Input boundaries:** `entity` param: validate that it equals `'club'` or `'foundation'` exactly — reject anything else with 400. `fy` param: integer, 2000–2100, reject otherwise. Both are query-only (no writes); no SQL injection risk with Drizzle parameterized queries. String lengths in generated filenames: use the same sanitization as dues export (`fyLabel.replace(/[^a-zA-Z0-9-]/g, '-')`).
- **Self-targeting / privilege escalation:** Exporting the transaction ledger is a read-only action; no write path exists here. A board member with `LEDGER_VIEW` cannot read another entity's data by manipulating the `entity` param if the server validates the slug against known values (not arbitrary UUIDs). The query already scopes to `entityId` derived from the slug, so cross-entity data access is not possible through this surface.

---

### Outputs

**Scope-shaping findings (decisions required before Phase 2):**

1. **990-line mapping is unpopulated.** The column `ledger_categories.form_990_line` exists in schema and DDL but every seeded row has `NULL` in that column. Inc4 must either (a) add 990-line values to the category seed migration (a new idempotent `UPDATE ... WHERE form_990_line IS NULL` block in 0044 or a new migration), or (b) ship the 990-prep export as "grouped by category" with a header note that 990-line mapping is not yet configured, and defer the mapping to a future increment. Recommendation: **option (a), seed sensible defaults in an idempotent migration**. The mapping is simple: a club of this size files 990-N (no line items required) and the Foundation files 990-EZ or 990; the relevant 990-EZ lines are Part I (Revenue), Part II (Expenses). Mapping ~15 categories to 6–8 line labels requires one migration block, no UI, and makes the export meaningfully useful. An admin mapping screen is overengineering for this size of club. If the Foundation grows to full-990 size, the admin can update category 990-line values through the existing LEDGER_MANAGE category editor.

2. **Export gate: use `LEDGER_VIEW OR REPORTS_EXPORT` (Option B).** Matches dues-export precedent. No new permission key. Treasurer, admin, and any user with `REPORTS_EXPORT` can export; board members with only `LEDGER_VIEW` can also export (same data they can already read on-screen).

3. **Report-consolidation delta vs. existing per-fund report.** The per-fund Budget/Actual/Variance report at `/admin/ledger/[fundSlug]/report` already exists. Inc4's reports page adds: (a) an entity-level view that shows all funds in one place (opening/income/expense/ending per fund, plus entity totals), and (b) the two CSV exports. It does NOT re-implement per-fund Budget/Actual/Variance on the new page — those remain at the existing fund-specific route. The reports page is the "year-end financial statement" view, not a duplicate of the per-fund report.

4. **Transfer rows must be excluded from 990-prep aggregation.** Transfer pairs are two rows sharing `transferGroupId`. If included in the 990-prep, they inflate gross receipts (the income leg) and expenses (the expense leg). The 990-prep query must filter out rows where `transferGroupId IS NOT NULL`. The transaction-ledger CSV should include them (with a "Transfer" note in the category or a separate column) for the auditor to see the full picture.

5. **Pending transaction inclusion in CSV exports.** Transaction-ledger CSV: include all statuses (posted + pending + rejected) with the `status` column visible. 990-prep CSV: posted only (consistent with balance semantics and `getFundReport`). This is a design decision that must be explicit in the Phase 3 design doc.

**Deferred (not re-litigated):** impact dashboard (inc5), donors/auto-post (inc6), fund-level financial-statement CSV export (recommend deferring; print-the-page is sufficient for this use case).

### Open questions / handoff notes

- **For the user before Phase 2:** Do you want the 990-prep export to show 990-EZ Part I/II line labels (e.g., "Part I Line 1 — Contributions, gifts, grants") or simplified internal labels (e.g., "Contributions")? The latter is recommended for a club this size; the former requires knowing which 990 form each entity will file, which `determine990()` already knows.
- **For architect (Phase 2):** Confirm that the export endpoint lives at `/api/admin/ledger/export` with `?entity=&fy=&type=` params (two types: `transactions` and `990prep`), or whether two separate routes are cleaner given the different permission check and response shape.
- **For tech-lead (Phase 3):** `getFundReport` runs one query per fund. The entity-level reports page will call `getFundReport` for each of the entity's funds. For the club (2 funds) and foundation (2 funds), this is 2 queries — acceptable. If the fund count grows, consider an entity-level aggregate query. Document the N+1 threshold in the design doc.
- **For tech-lead (Phase 3):** The 990-prep export join between `ledger_transactions` and `ledger_categories` (to get `form_990_line`) requires a LEFT JOIN since `categoryId` is nullable on transactions. Uncategorized transactions must appear in the export under an "Uncategorized" row, not be silently dropped.
- **For tech-lead (Phase 3):** Confirm the cash-basis disclaimer wording. Suggested header comment for the 990-prep CSV: `# This worksheet is a cash-basis estimate from the Ledger and is intended to assist 990/990-EZ preparation. It is NOT the filed return. Consult your tax preparer for the actual filing.`

---

# Phase 2 — Architectural Review — 2026-06-25

**Owner:** architect
**Status:** complete

### Summary

Approved with suggestions. Placement, server/client split, permission gating, and the no-new-dependency ruling are all correct. The single structural call to make — one consolidated export route vs. two separate routes — is resolved below in favor of one route with a `type` query param. Three implementation notes (990-line label set, CSV correctness invariants including transfer exclusion, and CSV injection safety) are passed to tech-lead as required design inputs. No new architectural decision is warranted; every structural choice is a direct extension of the patterns already locked in DECISIONS 012–017.

### What I did

1. Read the work-log Phase 1 output in full, including the five resolved defaults.
2. Verified the existing ledger structure: `src/app/(dashboard)/admin/ledger/` contains `[fundSlug]/`, `approvals/`, `compliance/`, `reimbursements/`, `settings/`, and the top-level `page.tsx`. A `reports/` subdirectory fits cleanly as the next sibling.
3. Confirmed existing `src/app/api/admin/ledger/` route tree: 13 files, all resource-keyed. An `export/route.ts` file sits cleanly here.
4. Verified `FEATURES.REPORTS_EXPORT = "reports.export"` and `hasAnyFeature` exist in `src/lib/permissions.ts` and `src/lib/permissions-server.ts` respectively — no new key needed.
5. Verified `FEATURES.LEDGER_VIEW = "ledger.view"` exists in `FEATURES`.
6. Verified the hand-rolled CSV precedent at `src/app/api/admin/dues/export/route.ts` — `csvCell()` escapes commas, double-quotes, and newlines; comment header rows prepend with `#`; `Content-Disposition` uses `attachment; filename="..."`. The pattern is complete and must be mirrored. **Notably: the existing `csvCell()` does NOT escape leading injection characters (`= + - @`).** That gap is called out below for tech-lead.
7. Confirmed `ledger-queries.ts` exports: `getFundReport`, `getOverview`, `grossReceiptsCents`, `getEntities`, `getEntity`, `listLedgerFiscalYears` — all already available. `getEntityReport` and `get990Prep` are net-new query functions to be added in Phase 4.
8. Confirmed `form_990_line` status: column exists in `ledger_categories` schema (from inc1/inc3 DDL); all seeded rows carry `NULL`. A data-only idempotent `UPDATE … WHERE form_990_line IS NULL` migration is the correct remedy — no DDL change needed.

### Calls resolved

---

#### Call 1 — Export route shape: one route with `?type=` vs. two routes

**Decision: one route, `GET /api/admin/ledger/export?entity=&fy=&type=transactions|990prep`.**

Rationale: the inc2 architect's preference for separate routes over a discriminated request body applies to POST/PATCH bodies where the shape diverges structurally — different body schemas are harder to document and the `type` field ends up in JSON rather than in the URL. For a GET, query params are the conventional discriminator and both export types share: identical auth/permission check (`hasAnyFeature([LEDGER_VIEW, REPORTS_EXPORT])`), identical param validation (`entity`, `fy`), and the same `text/csv` response envelope. The only delta is the query and the CSV column set — a short `if (type === '990prep') { … } else { … }` branch inside one handler. Two routes would duplicate the auth check, the param parsing, and the 400/401/403 error shapes with no corresponding benefit. The `type` param is the right discriminant here; the dues export's `fy`-only param is the closest precedent and it's a single route. File: `src/app/api/admin/ledger/export/route.ts`.

**Tech-lead must document:** valid `type` values are `transactions` and `990prep` exactly; any other value returns 400.

---

#### Call 2 — 990-line label set

Confirmed: a **fixed set of ~6–8 simplified internal labels** seeded via idempotent `UPDATE ledger_categories SET form_990_line = '...' WHERE name = '...' AND form_990_line IS NULL`. No lookup table. No admin mapping UI. Suggested labels (database-admin to finalize content):

| 990-EZ line group | Example categories |
|---|---|
| `Contributions/gifts/grants` | Membership Dues, Donations/Contributions |
| `Program service revenue` | Event Ticket Sales, Program Revenue |
| `Fundraising events (gross)` | Fundraiser Income |
| `Investment income` | Interest/Dividends |
| `Grants paid` | Grants/Scholarships Paid |
| `Program service expenses` | Program/Event Expenses |
| `Management/general expenses` | Administrative Expenses, Insurance |
| `Fundraising expenses` | Fundraising Expenses |

The 990-prep export degrades to group-by-category-name (with a header comment noting unmapped rows) when `form_990_line IS NULL`. This is a data-quality concern, not an architectural one — it belongs in the migration seed, not in a new table.

The migration block belongs in a new file (e.g., `0048_ledger_990_lines.sql`) rather than appended to an existing migration; the existing files are production-deployed and must not be modified.

---

#### Call 3 — CSV correctness invariants for tech-lead

The following invariants must appear in the Phase 3 design doc:

**Transfer-row exclusion:** 990-prep query must add `AND transferGroupId IS NULL` to its WHERE clause (or Drizzle `.where(isNull(ledgerTransactions.transferGroupId))`). Transfer pairs inflate both gross receipts and expenses; they are internal fund movements and must never appear in a 990 schedule. The transaction-ledger CSV should include transfer rows with a synthesized `Category` cell of `"Transfer"` (derived from `transferGroupId IS NOT NULL`, per DECISION-017) so the auditor sees the complete picture.

**Status filtering:** 990-prep: `status = 'posted'` only (consistent with `getFundReport` and balance semantics). Transaction-ledger CSV: all statuses (`posted`, `pending`, `rejected`), `status` column visible.

**Cash-basis disclaimer:** 990-prep CSV carries two comment header rows before the data headers:
```
# This worksheet is a cash-basis estimate from the Ledger and is intended to assist 990/990-EZ preparation.
# It is NOT the filed return. Consult your tax preparer before submitting.
```
Both comment rows use the `#` prefix convention already established in the dues export.

**CSV injection safety (flag for tech-lead and the security review):** The existing `csvCell()` helper in the dues export escapes commas, double-quotes, and newlines — but does NOT escape leading `= + - @` characters that Excel/Sheets treat as formula injection. Transaction fields `party` (payee name), `memo`, and category name can be user-supplied strings that may begin with `=`. The ledger export handler must use an extended `csvCell()` that prepends a tab (`\t`) before any cell whose first character is `= + - @`. This is the standard defense; the tab is invisible in most spreadsheet apps but neutralizes formula execution. Tech-lead should define this as `csvCellSafe()` (or extend `csvCell()`) in the ledger export handler and note why it differs from the dues export precedent (dues fields are all admin-controlled; ledger `party`/`memo` are free-text).

### Placement confirmed

| Artifact | Path | Verdict |
|---|---|---|
| Reports page | `src/app/(dashboard)/admin/ledger/reports/page.tsx` | Correct — sibling to `compliance/`, `approvals/`, `reimbursements/` |
| Export route | `src/app/api/admin/ledger/export/route.ts` | Correct — mirrors `dues/export/route.ts` shape |
| New query helpers | `src/lib/ledger-queries.ts` (append `getEntityReport`, `get990Prep`) | Correct — all ledger query helpers live here |
| 990-line seed migration | `drizzle/migrations/0048_ledger_990_lines.sql` (new file) | Correct — data-only, idempotent `UPDATE … WHERE form_990_line IS NULL` |

**No new top-level directory. No new npm dependency. No new `FEATURES.*` key. No new schema column.**

### Outputs

- Work-log updated (this section + Per-Phase Status table)
- No new DECISION entry warranted — all structural choices are direct extensions of DECISIONS 012–017; the export-route shape is an implementation call within the approved ledger API pattern

### Open questions / handoff notes

- **For tech-lead (Phase 3):** Implement `csvCellSafe()` with leading-character escaping in the ledger export handler. Do not modify the dues export `csvCell()` — the security note is ledger-specific and retroactive changes to a shipped route are out of scope.
- **For tech-lead (Phase 3):** `getEntityReport` will call `getFundReport` once per fund for the entity (N queries where N = fund count). For the current club/foundation (2 funds each), this is fine. Document the N+1 threshold explicitly; if fund count ever exceeds ~10, an entity-level aggregate query should replace it.
- **For tech-lead (Phase 3):** The `get990Prep` query joins `ledger_transactions` LEFT JOIN `ledger_categories` (LEFT because `categoryId` is nullable). Uncategorized, non-transfer, posted transactions must appear in the 990-prep under an `"Uncategorized"` row — not be silently dropped.
- **For database-admin (Phase 4):** Author the `0048_ledger_990_lines.sql` migration with the final label set. Confirm the seeded category names against the actual `ledger_categories` seed rows in the existing migration before writing the UPDATE statements.
- **For tech-lead (Phase 3) — ledger nav:** Confirm the "Reports" nav entry is added to the existing ledger navigation component (wherever the `compliance`, `approvals`, `reimbursements`, `settings` nav links live) and is gated `LEDGER_VIEW` to match the page gate.

---

# Phase 3 — Technical Design — 2026-06-25

**Owner:** tech-lead
**Status:** complete

---

## Technical Design: The Ledger — Increment 4: Reports & 990-Prep Export

### Summary

Inc4 adds a consolidated entity-level financial reports page at `/admin/ledger/reports` and a single CSV export route (`GET /api/admin/ledger/export`) branching on `?type=transactions|990prep`. All aggregation data already exists in the query layer (`getOverview`, `getFundReport`, `grossReceiptsCents`, `determine990`); this increment adds three new query helpers (`getEntityReport`, `get990Prep`, `listTransactionsForExport`), one new API route, one new page, and one data-only migration (`0049_ledger_990_lines.sql`) that seeds `form_990_line` values on existing category rows. No new schema columns, no new tables, no new npm dependencies, no new permission keys.

---

### Permissions

No new `FEATURES.*` keys. Existing keys cover all surfaces:

| Surface | Gate |
|---|---|
| Reports page (`/admin/ledger/reports`) | `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` — mirrors the compliance page gate |
| Export route (`GET /api/admin/ledger/export`) | `hasAnyFeature([LEDGER_VIEW, REPORTS_EXPORT])` — mirrors the dues export pattern (DECISION-014) |

The export gate is intentionally more permissive than the write gate: a board member with `LEDGER_VIEW` can download what they can already read on-screen. A user with `REPORTS_EXPORT` (but not `LEDGER_VIEW`) can also export — same OR-pattern as the dues export.

---

### Data Model

**No schema changes.** `ledger_categories.form_990_line` (`text`, nullable) already exists in `schema.ts` and in the 0044 DDL. All seeded rows currently carry `NULL`. The migration populates it via idempotent `UPDATE … WHERE form_990_line IS NULL`.

**Migration: `drizzle/migrations/0049_ledger_990_lines.sql`**

File name is `0049` — `0048` is already taken by `0048_ledger_compliance.sql`. This is a data-only file; no DDL.

The label set maps the seeded categories (from `0044_ledger_books.sql`) to 8 simplified 990-EZ line groups. The db-admin must cross-reference category names exactly as seeded; the table below is the authoritative mapping for the UPDATE statements:

| Category name | Entity slug | 990-EZ line label |
|---|---|---|
| `Club dues` | club | `Contributions/gifts/grants` |
| `Tail-twisting` | club | `Contributions/gifts/grants` |
| `Meals` (income) | club | `Contributions/gifts/grants` |
| `Misc` (income) | club | `Contributions/gifts/grants` |
| `Rudolph Run` | club | `Fundraising events (gross)` |
| `White Cane` | club | `Fundraising events (gross)` |
| `Pancake Breakfast` | club | `Fundraising events (gross)` |
| `Public donations` | club | `Contributions/gifts/grants` |
| `Sponsorships` | club | `Fundraising events (gross)` |
| `Interest` (club) | club | `Investment income` |
| `Per-capita tax` | club | `Management/general expenses` |
| `Meals` (expense) | club | `Management/general expenses` |
| `Postage` | club | `Management/general expenses` |
| `Printing` | club | `Management/general expenses` |
| `Officer Training` | club | `Management/general expenses` |
| `Supplies` | club | `Management/general expenses` |
| `Event costs` | club | `Fundraising expenses` |
| `Charitable donation out` | club | `Program service expenses` |
| `Eyeglass recycling` | club | `Program service expenses` |
| `Vision screening` | club | `Program service expenses` |
| `Public donations` | foundation | `Contributions/gifts/grants` |
| `Grants received` (charitable) | foundation | `Contributions/gifts/grants` |
| `Memorials` | foundation | `Contributions/gifts/grants` |
| `Interest` (foundation) | foundation | `Investment income` |
| `Grant out` | foundation | `Grants paid` |
| `Charitable donation out` | foundation | `Program service expenses` |
| `Disaster relief` | foundation | `Program service expenses` |
| `Public donations` (scholarship) | foundation | `Contributions/gifts/grants` |
| `Grants received` (scholarship) | foundation | `Contributions/gifts/grants` |
| `Scholarship award` | foundation | `Grants paid` |

**Label set (8 labels):** `Contributions/gifts/grants`, `Fundraising events (gross)`, `Investment income`, `Grants paid`, `Program service expenses`, `Management/general expenses`, `Fundraising expenses`, `Program service revenue` (reserved — no seeded category maps here; left for future use if the club adds ticket sales).

The UPDATE statements must scope by entity slug to avoid name collisions (e.g., `Interest` appears in both club and foundation with different slugs but the same category name). Pattern:

```sql
UPDATE ledger_categories
SET    form_990_line = 'Investment income'
WHERE  name = 'Interest'
  AND  form_990_line IS NULL
  AND  entity_id IN (SELECT id FROM ledger_entities WHERE slug = 'club');
```

Each UPDATE is idempotent via `AND form_990_line IS NULL`.

---

### Pure Helpers

#### `csvCellSafe(value)` — CSV injection guard (REQUIRED, DECISION-023)

Lives in `src/app/api/admin/ledger/export/route.ts` (local to the route; not in the dues export). Does NOT modify the dues `csvCell()`.

Logic:
1. Coerce to string; empty string for null/undefined.
2. If the first character is `=`, `+`, `-`, or `@`, prepend `\t` (a literal tab character).
3. If the resulting string contains `,`, `"`, `\n`, or `\r`, wrap in double-quotes and escape internal `"` as `""`.
4. Otherwise return as-is.

Apply `csvCellSafe()` to every free-text column: Party/Payee, Memo, Category (for transaction CSV) and Line/Category (for 990-prep CSV). Apply plain `csvCell()` (without injection guard) to controlled-value columns: Date, Fund name, Flow, Amount, Status, Reconciled, Payment Method.

**Unit test required** (Vitest, `src/lib/__tests__/csv-safe.test.ts` or co-located): at minimum — value starting with `=`, value starting with `+`, value starting with `-`, value starting with `@`, plain value with comma, plain value, null/undefined, value starting with `=` that also contains a comma.

#### `centsToDisplay(cents)` — reuse the pattern from dues export

A local helper in the route; same as dues export (`(cents / 100).toFixed(2)`).

---

### Server Queries (append to `src/lib/ledger-queries.ts`)

#### `getEntityReport(entityId, fiscalYear): Promise<EntityReport | null>`

Purpose: all-funds financial statement for the reports page.

Strategy (no N+1 at current fund count; see edge cases):
1. Fetch entity row — return null if missing.
2. Fetch all active funds for entity (`getFunds`).
3. Fetch all transactions for all fund IDs in one query (same pattern as `getOverview`), bounded by `fyBounds(fiscalYear)`.
4. In TypeScript, for each fund: separate posted transactions; aggregate income lines by `categoryId`; aggregate expense lines by `categoryId`; compute opening/income totals/expense totals/ending.
5. Fetch `ledgerCategories` for each unique `fundKind` across the entity's funds — one query per distinct kind (at most 2: administrative+activity for club, charitable+scholarship for foundation — 2 queries).
6. Build `FundReport`-shaped objects per fund (reusing `FundReportCategoryLine` type) via the same TypeScript merge already in `getFundReport`. Return an `EntityReport` aggregate.

Return type (new):
```typescript
export type EntityReport = {
  entity: LedgerEntity;
  funds: FundReport[];          // one per active fund, in fund name order
  grossReceiptsCents: number;   // sum of posted income across all funds (no transfers)
  netCents: number;             // grossReceipts - total posted expense (no transfers)
  determine990Result: { form: string; why: string };
  guardrailFlags: GuardrailFlag[];
};
```

Note: `getEntityReport` shares the same aggregation logic as `getOverview` but returns per-fund detail rather than per-fund summary. Consider whether to refactor `getOverview` to call `getEntityReport` — this is an inc5+ optimization concern; do not refactor now. Document the overlap in a comment.

#### `get990Prep(entityId, fiscalYear): Promise<Prep990Result>`

Purpose: aggregates posted non-transfer transactions by `form_990_line`, with LEFT JOIN to `ledger_categories`.

Constraints (all binding):
- `status = 'posted'` only.
- `transferGroupId IS NULL` — transfer rows excluded.
- LEFT JOIN `ledger_categories` on `categoryId` (nullable FK) — uncategorized rows included.
- Rows with no category: group key = `"Uncategorized"`, line = `"Uncategorized"`.
- Rows with a category but `form_990_line IS NULL`: group key = `"Unmapped / <categoryName>"`.
- Rows with a category and non-null `form_990_line`: group key = `form_990_line`.

Implementation: use `db.execute(sql\`…\`)` with a raw SQL query (Drizzle's LEFT JOIN with the nullable FK and COALESCE grouping is cleaner in raw SQL than in the query builder for this aggregation).

Sketch of the SQL shape:
```sql
SELECT
  COALESCE(
    cat.form_990_line,
    CASE WHEN cat.id IS NULL THEN 'Uncategorized'
         ELSE 'Unmapped / ' || cat.name
    END
  ) AS line_group,
  t.flow,
  SUM(t.amount_cents) AS total_cents
FROM ledger_transactions t
LEFT JOIN ledger_categories cat ON cat.id = t.category_id
WHERE t.entity_id = $entityId
  AND t.txn_date >= $fyStart
  AND t.txn_date < $fyEnd
  AND t.status = 'posted'
  AND t.transfer_group_id IS NULL
GROUP BY line_group, t.flow
ORDER BY line_group, t.flow
```

Return type (new):
```typescript
export type Prep990Line = {
  lineGroup: string;       // form_990_line label, "Uncategorized", or "Unmapped / <name>"
  flow: "income" | "expense";
  totalCents: number;
};

export type Prep990Result = {
  lines: Prep990Line[];
  grossReceiptsCents: number;  // sum of income lines
  totalExpenseCents: number;   // sum of expense lines
  netCents: number;
  determine990Result: { form: string; why: string };
  hasUnmapped: boolean;        // true if any line starts with "Unmapped /" or equals "Uncategorized"
};
```

The route handler uses `hasUnmapped` to decide whether to prepend the "no 990-line mappings" comment row.

#### `listTransactionsForExport(entityId, fiscalYear): Promise<ExportTxnRow[]>`

Purpose: all transactions for a given entity × FY, all statuses, joined with fund name and category name (for the Category column — falls back to "Transfer" when `transferGroupId IS NOT NULL`, "Uncategorized" when `categoryId IS NULL` and not a transfer).

Strategy: single query, LEFT JOIN `ledger_funds` and `ledger_categories`. Order: `txnDate ASC, createdAt ASC`.

Return type (new):
```typescript
export type ExportTxnRow = {
  txnDate: string;           // YYYY-MM-DD
  fundName: string;
  flow: "income" | "expense";
  categoryDisplay: string;   // "Transfer" | "Uncategorized" | category.name
  party: string | null;
  amountCents: number;
  status: string;
  reconciled: boolean;
  paymentMethod: string | null;
  memo: string | null;
};
```

The `categoryDisplay` derivation runs in TypeScript after the query:
- `transferGroupId IS NOT NULL` → `"Transfer"`
- `categoryId IS NULL` (and no transfer) → `"Uncategorized"`
- Otherwise → `category.name` from the LEFT JOIN result.

---

### API Contract

**`GET /api/admin/ledger/export`**

File: `src/app/api/admin/ledger/export/route.ts`

Query params:
- `entity` (required): entity slug. Validate against `getEntity(slug)` — 400 if null returned. Must equal `'club'` or `'foundation'` exactly.
- `fy` (required): integer `2000–2100` — 400 if absent, NaN, or out of range.
- `type` (required): `'transactions'` or `'990prep'` — 400 on any other value.

Auth flow (mirrors dues export exactly):
```
session = await auth()
if (!session?.user?.id) → 401
canExport = await hasAnyFeature(session.user.id, [FEATURES.LEDGER_VIEW, FEATURES.REPORTS_EXPORT])
if (!canExport) → 403
```

Validate `entity` slug: call `getEntity(entity)` — if null, return 400 `{ error: "Invalid entity" }`. This prevents a DB query with an arbitrary string and is the inc3 lesson on invalid slug handling.

**Branch: `type === 'transactions'`**

1. Call `listTransactionsForExport(entity.id, fiscalYear)`.
2. Build comment header rows (prepended with `#`):
   - `# Westerville Lions Club — Transaction Ledger Export`
   - `# Entity: <entity.name>`
   - `# Fiscal Year: <fiscalYearLabel(fiscalYear)>`
   - `# Generated: <ISO date>`
   - `# Includes all transaction statuses (posted, pending, rejected). Transfer rows show Category = "Transfer".`
3. Column headers: `Date,Fund,Flow,Category,Party/Payee,Amount ($),Status,Reconciled,Payment Method,Memo`
4. Data rows: apply `csvCellSafe()` to `Category`, `Party/Payee`, `Memo`. Apply `csvCell()` to Date, Fund, Flow, Amount, Status, Reconciled, Payment Method.
5. If no rows: emit headers + one comment row: `# No transactions recorded for this entity and fiscal year.`
6. `Content-Disposition: attachment; filename="<slug>-ledger-<fyLabel>.csv"` (e.g., `club-ledger-FY2026-Jul-2026--Jun-2027.csv`). Use `fiscalYearLabel(fy).replace(/[^a-zA-Z0-9-]/g, '-')` for the FY segment.

**Branch: `type === '990prep'`**

1. Call `get990Prep(entity.id, fiscalYear)`.
2. Comment header rows:
   - `# Westerville Lions Club — 990-Prep Worksheet`
   - `# This worksheet is a cash-basis estimate from the Ledger and is intended to assist 990/990-EZ preparation.`
   - `# It is NOT the filed return. Consult your tax preparer before submitting.`
   - `# Entity: <entity.name>`
   - `# Fiscal Year: <fiscalYearLabel(fiscalYear)>`
   - `# Gross Receipts: $<grossReceipts>`
   - `# IRS Form Determination: <determine990Result.form> — <determine990Result.why>`
   - If `hasUnmapped`: `# Note: Some transactions have no 990-line mapping — see "Uncategorized" and "Unmapped" rows below.`
3. Column headers: `990 Line / Group,Flow,Total ($)`
4. Data rows: `csvCellSafe()` on `lineGroup`; plain `csvCell()` on `flow` and amount.
5. If no posted non-transfer transactions: column headers + one comment row `# No posted transactions for this entity and fiscal year.`
6. `Content-Disposition: attachment; filename="<slug>-990prep-<fyLabel>.csv"`

**Any other `type` value:** `return NextResponse.json({ error: "Invalid type. Use 'transactions' or '990prep'." }, { status: 400 })`.

---

### Component/Page Plan

**New page: `src/app/(dashboard)/admin/ledger/reports/page.tsx`**

Server Component. Gate: `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` — redirect to `/access-pending`.

Param handling (same pattern as `compliance/page.tsx`):
- `?entity=` — validate slug via `getEntity()`; `notFound()` if explicit but invalid.
- `?fy=` — parse integer, bounds-check `2000–2100`, fall back to `currentFiscalYear()`.

Data fetched:
- `getEntities()` — for EntitySwitcher.
- `getEntity(slug)` — entity row.
- `listLedgerFiscalYears(entityId)` — for FiscalYearSelector.
- `getEntityReport(entityId, fiscalYear)` — full fund detail.
- `getOverview(entityId, fiscalYear)` — entity-level aggregates + guardrail flags.

Note: `getEntityReport` computes guardrails internally (same path as `getOverview`). However, `getOverview` already has all the guardrail logic and the correct aggregation; the page can call `getOverview` for the entity summary bar and guardrail display, then call `getEntityReport` for the per-fund detail cards. Or: `getEntityReport` can share the `getOverview` aggregation pass and return both. Tech-lead recommendation: call both in `Promise.all`; accept the small redundancy of two queries (one for overview, one for per-fund detail) rather than refactoring the query layer in inc4. The total query cost at 2–4 funds is negligible.

**Page layout sketch:**

```
Header row: [entity.name] — Financial Report — [fiscalYearLabel]
Controls row: EntitySwitcher | FiscalYearSelector | [Export buttons right-aligned]

Section: Per-Fund Detail
  For each fund: rounded-2xl card
    Fund name + kind badge
    Opening Balance: $x
    Income section: category lines (name + $amount)
    Total Income: $x
    Expense section: category lines (name + $amount)
    Total Expense: $x
    Ending Balance: $x (bold)
    Pending (encumbered): $x (gray, if > 0)

Section: Entity Totals
  Gross Receipts: $x | Net: $x | 990 Determination: [form label]

Section: Active Guardrail Warnings (if any flags)
  Reuse the same badge rendering pattern as compliance/page.tsx

Empty state (no funds): rounded-2xl p-10 gray with link to /admin/ledger/settings
```

**Export buttons:**

Two secondary-style link buttons placed in the controls row (right-aligned, full-width on mobile):
```tsx
<a
  href={`/api/admin/ledger/export?entity=${entitySlug}&fy=${fiscalYear}&type=transactions`}
  className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] inline-flex items-center"
>
  Export Ledger CSV
</a>
<a
  href={`/api/admin/ledger/export?entity=${entitySlug}&fy=${fiscalYear}&type=990prep`}
  className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] inline-flex items-center"
>
  Export 990-Prep CSV
</a>
```

These are plain `<a>` tags (not `<Link>`) so the browser initiates a file download rather than a client-side navigation. No toast on success — the browser handles the download. On auth failure (401/403) the downloaded file will contain a JSON error body; this is acceptable at this scope (same behavior as the dues export).

**Reused components (no changes):**
- `EntitySwitcher` — pass `basePath="/admin/ledger/reports"`.
- `FiscalYearSelector` — pass `basePath="/admin/ledger/reports"`.
- Guardrail badge rendering — inline in page (same pattern as `compliance/page.tsx`; not extracted to a shared component in inc4).

**Ledger nav — add "Reports" link:**

The ledger sub-pages do not use a shared nav component; each page has inline back-links and contextual action buttons. For consistency, the Reports page gets a breadcrumb back-link to `/admin/ledger`:
```tsx
<Link href="/admin/ledger" className="text-lions-blue hover:underline text-sm …">← Ledger Overview</Link>
```

Additionally, a "Reports" link must be added to the fund page (`[fundSlug]/page.tsx`) action buttons row alongside the existing "Approvals" and "Budget / Actual Report" buttons, gated `LEDGER_VIEW`. This is a one-line addition; the ux-developer owns it.

The ledger main page (`page.tsx` at `/admin/ledger`) currently has no explicit link to `/admin/ledger/reports`. The ux-developer should add a "Reports" link card or button alongside the existing Compliance / Approvals / Reimbursements cards. Confirm with Phase 1 intent: the analyst described the page as an entity-level financial summary with two export buttons — a card-style entry point from the main ledger page is appropriate.

---

### Implementation Order

1. **database-admin** — Author `drizzle/migrations/0049_ledger_990_lines.sql`. Use the category→label mapping table above. Scope every UPDATE by `entity_id IN (SELECT id FROM ledger_entities WHERE slug = '…')` and guard with `AND form_990_line IS NULL`. Verify category names exactly against the 0044 seed. Run `pnpm db:migrate` locally and confirm rows are populated.

2. **api-developer** — Three tasks in this order:
   a. Add `csvCellSafe()` to `src/app/api/admin/ledger/export/route.ts` and write the Vitest unit test in `src/lib/__tests__/csv-ledger-export.test.ts` (or co-locate in `src/app/api/admin/ledger/export/`). Confirm the test file runs with `pnpm test`.
   b. Append `getEntityReport`, `get990Prep`, `listTransactionsForExport` to `src/lib/ledger-queries.ts`. These are pure reads; they can be developed and tested independently of the route.
   c. Create `src/app/api/admin/ledger/export/route.ts`. Wire auth + permission check → param validation → branch on `type` → query → CSV build → `NextResponse`. No new types in the route file; all return types come from `ledger-queries.ts`.

3. **ux-developer** — Build `src/app/(dashboard)/admin/ledger/reports/page.tsx`. Consume `getEntityReport` and `getOverview`. Reuse `EntitySwitcher` and `FiscalYearSelector` (pass `basePath="/admin/ledger/reports"`). Add the two export `<a>` buttons. Add the "Reports" link to the fund page action buttons. Add a "Reports" entry point to the ledger main page.

---

### Edge Cases and Risks

| Scenario | Handling |
|---|---|
| Empty FY (no transactions) | Transaction CSV: header + one comment row. 990-prep CSV: header disclaimer rows + column headers + one comment row. Both still return 200 with a valid CSV. |
| No 990-line mappings seeded (all NULL) | `get990Prep` returns all rows under "Uncategorized" or "Unmapped / …"; `hasUnmapped = true`; the CSV gains the extra note comment row. Export is still useful for totals. |
| Uncategorized posted non-transfer transactions | Grouped under "Uncategorized" in 990-prep. Always visible — never silently dropped (LEFT JOIN guarantee). |
| Transfer rows in 990-prep | Filtered out by `AND transfer_group_id IS NULL`. In transaction CSV: included with `categoryDisplay = "Transfer"`. |
| Invalid `entity` param on export route | `getEntity(slug)` returns null → 400 JSON. Does not fall through to a DB query with an untrusted string. |
| Invalid `fy` param on export route | `NaN || < 2000 || > 2100` → 400 JSON. |
| Invalid `type` param | 400 JSON. |
| `?entity=` explicitly invalid on reports page | `notFound()` — consistent with the inc3 lesson and the compliance page pattern. |
| Fund with no transactions | `getEntityReport` includes the fund with `income = []`, `expense = []`, `totalIncomeCents = 0`, `endingCents = fund.openingBalanceCents`. Page renders the fund card with $0 lines. |
| Entity with no funds | `getEntityReport` returns early with `funds = []`. Page renders the empty-state with a link to `/admin/ledger/settings`. |
| Category name starting with `=` in CSV | `csvCellSafe()` prepends `\t`. Unit test covers this. |
| N+1 fund queries in `getEntityReport` | Avoided: single transactions fetch for all fund IDs; categories fetched per distinct fund kind (at most 2). Documented with a threshold note: if fund count exceeds ~10, refactor to an entity-level aggregate query. |
| `isNull` import in `ledger-queries.ts` | `isNull` is NOT currently imported (line 38 imports `isNotNull` but not `isNull`). The `get990Prep` raw SQL approach avoids the Drizzle `isNull()` operator entirely — the raw SQL uses `transfer_group_id IS NULL` directly. If the implementer prefers a Drizzle builder approach, add `isNull` to the import. |
| Large category count | The `get990Prep` aggregation is a single GROUP BY query — scales with row count, not category count. No concern at club scale. |

### Out of Scope

- Admin UI to edit `form_990_line` values (LEDGER_MANAGE category editor — future increment if needed).
- Fund-level financial-statement CSV export (deferred; the per-fund Budget/Actual report at `/admin/ledger/[fundSlug]/report` can be printed).
- Member philanthropy/impact dashboard (inc5).
- Donors/acknowledgments + auto-post (inc6).
- Refactoring `getOverview` to delegate to `getEntityReport` (document the overlap but do not refactor in inc4).

---

### What I Did

- Read the full work-log (Phases 1 and 2), DECISIONS 012, 014, 017.
- Read `src/app/api/admin/dues/export/route.ts` — confirmed `csvCell()` does not escape injection chars; confirmed comment-header pattern, `Content-Disposition`, `Cache-Control: no-store`.
- Read `src/lib/ledger-queries.ts` in full — confirmed existing helper signatures, `fyBounds()`, `getOverview`/`getFundReport` aggregation patterns, `isNotNull` import status, LEFT JOIN precedent in `getPendingApprovals`.
- Read `src/lib/db/schema.ts` ledger section — confirmed `form990Line: text("form_990_line")` exists and is nullable; confirmed `ledgerCategories.entityId` FK; confirmed `transferGroupId` on transactions.
- Read `drizzle/migrations/0044_ledger_books.sql` category seed block — captured all 29 seeded category names across both entities, all fund kinds and flows.
- Read `src/components/admin/ledger/entity-switcher.tsx` and `fiscal-year-selector.tsx` — confirmed `basePath` prop, reuse path.
- Read `src/app/(dashboard)/admin/ledger/compliance/page.tsx` — confirmed auth/param pattern, `notFound()` on invalid slug, `EntitySwitcher`/`FiscalYearSelector` usage, guardrail badge rendering.
- Read `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx` — confirmed action buttons layout (secondary outlined `rounded-lg`) and breadcrumb pattern.
- Confirmed `0048_ledger_compliance.sql` exists → migration must be `0049_ledger_990_lines.sql`, not 0048 as the Phase 2 architect note incorrectly stated.
- Logged DECISION-023 (csvCellSafe placement).

### Outputs

- Work-log updated (this section + Per-Phase Status table).
- `docs/decisions.md` — DECISION-023 appended.

### Open Questions / Handoff Notes

- **For database-admin:** Author `drizzle/migrations/0049_ledger_990_lines.sql`. Use the mapping table in the Data Model section above. Category names are case-sensitive — copy exactly from `0044_ledger_books.sql`. Scope each UPDATE by entity slug. Guard with `AND form_990_line IS NULL`. Run locally and confirm. No DDL — data only.
- **For api-developer:** Three deliverables in order: (a) `csvCellSafe()` + Vitest unit test; (b) `getEntityReport` + `get990Prep` + `listTransactionsForExport` appended to `ledger-queries.ts`; (c) `src/app/api/admin/ledger/export/route.ts`. The raw SQL shape for `get990Prep` is in the design above — use `db.execute(sql\`…\`)` with parameterized `${}` bindings; do not string-interpolate.
- **For ux-developer:** Build the reports page after the api-developer delivers the query helpers and export route. Reuse `EntitySwitcher` with `basePath="/admin/ledger/reports"` and `FiscalYearSelector` with the same base path. Add the "Reports" link to `[fundSlug]/page.tsx` action buttons and to the main ledger `page.tsx`. The export buttons are `<a>` tags, not `<Link>` or `<button>` — the file download behavior depends on this.
- **Correction note for future readers:** Phase 2 referenced `0048_ledger_990_lines.sql` but `0048` is already taken by `0048_ledger_compliance.sql`. The correct filename is `0049_ledger_990_lines.sql`. This is a binding constraint; do not create a second `0048_*.sql` file.

---

# Phase 4 — Implementation

## Phase 4a — Implementation (schema/data) — 2026-06-25

**Owner:** database-admin
**Status:** complete

### Summary

Authored `drizzle/migrations/0049_ledger_990_lines.sql` — a data-only, idempotent migration that populates `ledger_categories.form_990_line` for all 30 seeded category rows across both entities (club and foundation). No DDL, no `schema.ts` change, no new table or column. The `AND form_990_line IS NULL` guard on every UPDATE makes re-runs a no-op and protects any admin-set value from being overwritten in future deploys.

### What I did

- Read `0044_ledger_books.sql` to capture all 30 seeded category rows (names, entity slugs, fund kinds, flows) verbatim — case-sensitive.
- Cross-referenced against the Phase 3 mapping table (authoritative) to assign one of the 8 simplified 990-EZ line labels to each category.
- Authored `drizzle/migrations/0049_ledger_990_lines.sql` with 28 scoped UPDATE statements (two categories — `Meals` and the dual-occurrence `Public donations` / `Grants received` — required `fund_kind`/`flow` or entity-slug scoping to disambiguate, handled with additional WHERE predicates).
- Applied the migration with `pnpm db:migrate`; confirmed success on first run.
- Re-ran `pnpm db:migrate` a second time; no errors — idempotency confirmed.
- Ran a representative single UPDATE statement a third time; result was 0 rows affected — `IS NULL` guard confirmed effective.
- Verified via direct postgres query: **30 of 30 categories mapped, 0 remaining NULL**.
- `pnpm exec tsc --noEmit` — clean (no output, exit 0).
- `pnpm test` — 246 / 246 passed (6 test files).

### Final category → 990-EZ line mapping

| Entity | fund_kind | flow | Category | 990-EZ line label |
|---|---|---|---|---|
| club | administrative | income | Club dues | Contributions/gifts/grants |
| club | administrative | income | Meals | Contributions/gifts/grants |
| club | administrative | income | Tail-twisting | Contributions/gifts/grants |
| club | administrative | income | Misc | Contributions/gifts/grants |
| club | administrative | expense | Per-capita tax | Management/general expenses |
| club | administrative | expense | Meals | Management/general expenses |
| club | administrative | expense | Postage | Management/general expenses |
| club | administrative | expense | Printing | Management/general expenses |
| club | administrative | expense | Officer Training | Management/general expenses |
| club | administrative | expense | Supplies | Management/general expenses |
| club | activity | income | Rudolph Run | Fundraising events (gross) |
| club | activity | income | White Cane | Fundraising events (gross) |
| club | activity | income | Pancake Breakfast | Fundraising events (gross) |
| club | activity | income | Public donations | Contributions/gifts/grants |
| club | activity | income | Sponsorships | Fundraising events (gross) |
| club | activity | income | Interest | Investment income |
| club | activity | expense | Event costs | Fundraising expenses |
| club | activity | expense | Charitable donation out | Program service expenses |
| club | activity | expense | Eyeglass recycling | Program service expenses |
| club | activity | expense | Vision screening | Program service expenses |
| foundation | charitable | income | Public donations | Contributions/gifts/grants |
| foundation | charitable | income | Grants received | Contributions/gifts/grants |
| foundation | charitable | income | Memorials | Contributions/gifts/grants |
| foundation | charitable | income | Interest | Investment income |
| foundation | charitable | expense | Grant out | Grants paid |
| foundation | charitable | expense | Charitable donation out | Program service expenses |
| foundation | charitable | expense | Disaster relief | Program service expenses |
| foundation | scholarship | income | Public donations | Contributions/gifts/grants |
| foundation | scholarship | income | Grants received | Contributions/gifts/grants |
| foundation | scholarship | expense | Scholarship award | Grants paid |

Notes on non-obvious calls:
- `Meals` (admin income): member meal-revenue classified as `Contributions/gifts/grants` (member receipts), not `Program service revenue`, consistent with 990-N/990-EZ scale for a club this size.
- `Charitable donation out` (club activity): classified as `Program service expenses` (direct benefit delivery) rather than `Grants paid` — informal club-level charitable giving, not a formal grant award. The foundation's `Grant out` is a formal grant and goes to `Grants paid`.
- `Sponsorships` (club activity income): classified as `Fundraising events (gross)` — these are event sponsorship receipts tied to fundraising events (Rudolph Run, White Cane, etc.).
- `Public donations` (foundation charitable + scholarship): both fund-kind rows update to `Contributions/gifts/grants` from a single entity-slug-scoped UPDATE — labels are identical so this is correct.
- `Grants received` (foundation charitable + scholarship): same treatment as `Public donations` above.
- `Program service revenue` label is reserved in the label set; no seeded category maps to it (the club does not currently record ticket-sales-style program revenue).

### Outputs

- `/Users/cshenso/git/westervillelions/drizzle/migrations/0049_ledger_990_lines.sql` — data-only migration, 28 idempotent UPDATE statements
- `ledger_categories.form_990_line` — all 30 rows now populated
- No changes to `src/lib/db/schema.ts`, no DDL
- Local apply command: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`
- Idempotency confirmed: second run 0 errors; representative re-run of a single UPDATE → 0 rows affected
- tsc: clean | tests: 246/246

### Open questions / handoff notes

- **For api-developer (next):** `ledger_categories.form_990_line` is now populated for all seeded categories. The `get990Prep` query (raw SQL with LEFT JOIN + COALESCE grouping) should produce clean 990-EZ line groups with no "Unmapped" rows for any transaction that uses a seeded category. Uncategorized transactions (no `category_id`) will still group as "Uncategorized" — this is correct behavior per the Phase 3 design.
- The 8-label set is fixed in migration comments; if the admin ever needs to reclassify a category, they can update via the LEDGER_MANAGE category editor once that surface exists (future increment), or directly via the DB. The `IS NULL` guard in the migration will not interfere with any manually set value.
- No new tables, no new indexes — api-developer can proceed directly to implementing `get990Prep`, `getEntityReport`, `listTransactionsForExport`, and the export route.
- Next agent: **api-developer**.

---

## Phase 4b — Implementation (API) — 2026-06-25

**Owner:** api-developer
**Status:** complete

### Summary

Implemented all server-layer deliverables for inc4: `csvCellSafe()` with 12 Vitest cases, three new query helpers appended to `ledger-queries.ts` (`getEntityReport`, `get990Prep`, `listTransactionsForExport`), and the export route at `src/app/api/admin/ledger/export/route.ts`. TypeScript typecheck exits clean; test suite expanded from 246 to 258 passing (12 new cases in the new test file). No UI, no schema changes — gates passed.

### What I did

- Extracted `csvCellSafe()` to `src/lib/csv-safe.ts` (standalone module — avoids pulling next-auth into the Vitest environment when the test imports it).
- Import from `@/lib/csv-safe` in the export route.
- Wrote 12 Vitest cases in `src/lib/csv-ledger-export.test.ts`: four formula-trigger chars (`=`, `+`, `-`, `@`), plain string, comma, quotes, null, undefined, formula-char + comma combined, numeric coercion, boolean coercion.
- Appended `isNull` to the `drizzle-orm` import in `ledger-queries.ts` (needed; the `get990Prep` raw SQL uses `IS NULL` directly but `listTransactionsForExport` does not call `isNull()` — left import in place for future use; tsc is clean regardless).
- Appended return types `EntityReport`, `Prep990Line`, `Prep990Result`, `ExportTxnRow` to `ledger-queries.ts`.
- Implemented `getEntityReport(entityId, fiscalYear)`:
  - One entity fetch, one `getFunds` call, one all-FY transactions fetch (N+1-free). Categories fetched once per distinct `fundKind` (at most 2 queries for club/foundation). Deactivated-category guard included. Returns `guardrailFlags: []` — page calls `getOverview` in parallel for that data (Phase 3 design).
  - `grossReceiptsCents` and `netCents` computed from posted non-transfer rows only (consistent with 990-prep semantics).
- Implemented `get990Prep(entityId, fiscalYear)`:
  - Single `db.execute(sql\`…\`)` with COALESCE/CASE grouping. Filters: `status = 'posted'` AND `transfer_group_id IS NULL`. LEFT JOIN `ledger_categories` — uncategorized rows grouped as `"Uncategorized"`, category-with-null-form_990_line grouped as `"Unmapped / <name>"`. `hasUnmapped` flag derived in TypeScript from the result set. `determine990()` called with entity tax classification and a fund-opening-balance assets proxy.
- Implemented `listTransactionsForExport(entityId, fiscalYear)`:
  - Single query: LEFT JOIN `ledger_funds` + `ledger_categories`. All statuses. `categoryDisplay` synthesized in TypeScript: `"Transfer"` when `transferGroupId IS NOT NULL`, `"Uncategorized"` when `categoryId IS NULL`, else `category.name`. Ordered `txnDate ASC, createdAt ASC`.
- Implemented `GET /api/admin/ledger/export`:
  - Auth → 401; `hasAnyFeature([LEDGER_VIEW, REPORTS_EXPORT])` → 403. Param validation in order: `type` (invalid → 400 before any DB call), `fy` (NaN/out-of-range → 400), `entity` slug via `getEntity()` (null → 400).
  - `type=transactions`: 5-line comment header, 10-column data rows, `csvCellSafe` on Category/Party/Payee/Memo. Empty FY → comment row only (no error).
  - `type=990prep`: 8-or-9-line comment header (9th if `hasUnmapped`), 3-column data rows, `csvCellSafe` on `lineGroup`. Empty FY → comment row only.
  - Filenames: `{slug}-ledger-{fyFilename}.csv` and `{slug}-990prep-{fyFilename}.csv` where `fyFilename = fiscalYearLabel(fy).replace(/[^a-zA-Z0-9-]/g, "-")`.
  - `Cache-Control: no-store` on all CSV responses.

### Outputs

- `/Users/cshenso/git/westervillelions/src/lib/csv-safe.ts` — `csvCellSafe()` helper (DECISION-023)
- `/Users/cshenso/git/westervillelions/src/lib/csv-ledger-export.test.ts` — 12 Vitest unit tests
- `/Users/cshenso/git/westervillelions/src/lib/ledger-queries.ts` — `isNull` import added; types `EntityReport`, `Prep990Line`, `Prep990Result`, `ExportTxnRow` added; `getEntityReport`, `get990Prep`, `listTransactionsForExport` appended
- `/Users/cshenso/git/westervillelions/src/app/api/admin/ledger/export/route.ts` — new export route

**API contract for ux-developer:**

| Method + Path | Auth gate | Query params | Response |
|---|---|---|---|
| `GET /api/admin/ledger/export` | `LEDGER_VIEW` OR `REPORTS_EXPORT` | `entity` (slug), `fy` (integer), `type` (`transactions` \| `990prep`) | `text/csv; charset=utf-8` with `Content-Disposition: attachment` |

Errors: `401` (no session), `403` (missing feature), `400` (invalid params), `500` (server error) — all as `application/json { error: "…" }`.

**Query helpers for ux-developer (reports page):**

- `getEntityReport(entityId, fiscalYear): Promise<EntityReport | null>` — per-fund detail (income/expense category lines, opening/ending). Call in parallel with `getOverview` for guardrail flags.
- `get990Prep(entityId, fiscalYear): Promise<Prep990Result>` — 990-prep aggregation (used by the export route; the reports page does not need to call this directly).
- `listTransactionsForExport(entityId, fiscalYear): Promise<ExportTxnRow[]>` — used by the export route; not needed directly on the reports page.

No schema changes. No migration. No new permission keys.

### Open questions / handoff notes

- **For ux-developer (Phase 4c):** Build `src/app/(dashboard)/admin/ledger/reports/page.tsx`. Gate: `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` — redirect to `/access-pending`. Call `getEntities()`, `getEntity(slug)`, `listLedgerFiscalYears(entityId)`, `getEntityReport(entityId, fy)`, and `getOverview(entityId, fy)` (for guardrail flags). Export buttons are `<a>` tags (not `<Link>`) pointing to `/api/admin/ledger/export?entity=…&fy=…&type=transactions|990prep`.
- **For ux-developer:** Also add a "Reports" link card/button to the main ledger `page.tsx` and a "Reports" button to `[fundSlug]/page.tsx` action buttons — see Phase 3 design §Component/Page Plan.
- **Note on `guardrailFlags`:** `getEntityReport` returns an empty `guardrailFlags` array. The reports page must call `getOverview` separately (in a `Promise.all`) for the guardrail badge rendering — this is by design (Phase 3: "call both in Promise.all; accept the small redundancy").
- **Next agent:** ux-developer.

---

## Phase 4c — Implementation (UI) — 2026-06-25

**Owner:** ux-developer
**Status:** complete

### Summary

Built the `/admin/ledger/reports` page as a Server Component, wired to the Phase 4b query helpers (`getEntityReport` + `getOverview` in parallel). Per-fund consolidation cards show opening balance, itemized income/expense by category, ending balance, and pending encumbered amount. The entity totals bar shows gross receipts, net, and the 990 determination chip. Guardrail flags from `getOverview` render using the same badge pattern as the compliance and overview pages. Two native `<a>` export buttons (not `<Link>`) trigger browser file downloads. A cash-basis disclaimer is shown at the page bottom. Added "Reports" to the admin sidebar (gated `LEDGER_VIEW`), a "Financial Report & Export" quick-link card to the main ledger overview, and a "Reports" button to the fund `[fundSlug]` action row.

### What I did

- Created `src/app/(dashboard)/admin/ledger/reports/page.tsx` — Server Component, `force-dynamic`. Gate: `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` → redirect `/access-pending`. Param validation mirrors `compliance/page.tsx` exactly: explicit invalid `?entity=` slug → `notFound()`; FY defaults to `currentFiscalYear()`. Calls `getEntityReport` + `getOverview` + `listLedgerFiscalYears` in `Promise.all`. `EntitySwitcher` and `FiscalYearSelector` both passed `basePath="/admin/ledger/reports"`.
- Inline `FundCard` sub-component (not extracted — single-use, page-specific): renders opening balance, income category lines (non-zero only, with `italic` empty state per section), expense category lines, total income/expense, ending balance (red if negative), encumbered pending amount.
- Empty state (no funds): `bg-gray-50 rounded-2xl p-10` with link to Ledger Settings.
- Empty state (funds exist, zero transactions): info banner above the fund cards ("No transactions recorded for {fyLabel}. Opening balances are shown.") — funds still render at their opening balance, which is correct behavior.
- Entity totals bar: three-column non-interactive card (gross receipts / net / IRS form chip). `determine990Result.why` shown as caption under the chip.
- Guardrail flags: identical badge/icon rendering to `compliance/page.tsx` and the main `page.tsx` — `guardrailBadgeClass()`/`guardrailIconClass()` helpers copied inline (same pattern; not worth extracting for a third page that matches the existing two).
- Export buttons: `<a>` tags (never `<Link>`) pointing to `/api/admin/ledger/export?entity=…&fy=…&type=transactions` and `…&type=990prep`. Secondary outlined `rounded-lg` style per brand guidelines. `min-h-[44px]` for touch target. Full-width stacked on mobile, inline on `sm+`.
- Cash-basis disclaimer rendered as `text-xs text-gray-400` paragraph at page bottom.
- Added "Reports" to `src/components/admin/admin-sidebar.tsx` navigation array, between "Compliance" and "Ledger Settings", gated `FEATURES.LEDGER_VIEW`.
- Added "Financial Report & Export" quick-link card to `src/app/(dashboard)/admin/ledger/page.tsx` in the quick-links grid, preserving the current `?entity=…&fy=…` context.
- Added "Reports" button to `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx` action buttons row, alongside "Approvals" and "Budget / Actual Report". Passes `?entity=…&fy=…` context.

### Outputs

- `src/app/(dashboard)/admin/ledger/reports/page.tsx` — new file
- `src/components/admin/admin-sidebar.tsx` — "Reports" nav entry added
- `src/app/(dashboard)/admin/ledger/page.tsx` — "Financial Report & Export" quick-link added
- `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx` — "Reports" action button added

### Gates passed

- `pnpm exec tsc --noEmit` — clean (no output, exit 0)
- `pnpm build:only` — green; `/admin/ledger/reports` appears in the route manifest as `ƒ` (dynamic)
- `pnpm test` — 258/258 passed (unchanged — no new UI tests needed; CSV and query logic are covered by Phase 4b tests)
- No `window.confirm/alert/prompt`, no `console.log`, no `lions-red`, no `<Link>` on export buttons, no `rounded-full`
- Page has `auth()` + `hasAnyFeature` gate; export links point to the gated API route which enforces its own independent auth check

### Open questions / handoff notes

**For qa (Phase 5) — what to click through:**

1. **Navigation entry points:** sidebar "Reports" link; main ledger overview "Financial Report & Export" card; fund page "Reports" button — all three should land on `/admin/ledger/reports` with the correct `?entity=` and `?fy=` params.
2. **Entity switcher:** switch between Club and Foundation — page should re-render with each entity's funds.
3. **FY selector:** change fiscal year — fund cards should reflect the selected year's data (zero or non-zero).
4. **Empty-state (no transactions):** select a future FY with no transactions — info banner should appear above the fund cards, which render at opening balance; totals bar shows $0 gross receipts.
5. **Per-fund cards:** verify opening balance, itemized income/expense lines (only non-zero lines visible), totals, ending balance. Negative ending balance should render in red. Pending encumbered row appears only when `pendingExpenseCents > 0`.
6. **990 determination chip:** should show the correct form label (e.g., "990-N" for the club with low receipts) and the `why` caption.
7. **Guardrail flags:** if any flags are active in the DB, they should appear with the correct badge color.
8. **Export — transaction ledger CSV:** click "Export transaction ledger (CSV)" — browser should prompt to download a `.csv` file. Open in a spreadsheet and verify: 10 columns, comment header rows, all statuses present, transfer rows show `Category = "Transfer"`, no formula-injection characters unescaped (test a row where Payee starts with `=` if one exists).
9. **Export — 990-prep CSV:** click "Export 990-prep worksheet (CSV)" — browser should prompt to download a `.csv` file. Open and verify: cash-basis disclaimer comment rows, 3 columns (`990 Line / Group`, `Flow`, `Total ($)`), posted non-transfer transactions only, grouped by 990-EZ line label. Verify the disclaimer reads correctly. If all categories are mapped (they are — 4a seeded them all), no "Unmapped" rows should appear.
10. **CSV injection escaping:** the `csvCellSafe()` function (Phase 4b) prepends `\t` to any cell starting with `=`, `+`, `-`, `@`. QA should verify this by checking a payee or memo that starts with one of those characters (or inserting a test transaction if none exist).
11. **Access gate:** a user without `LEDGER_VIEW`, `LEDGER_RECORD`, or `LEDGER_MANAGE` should be redirected to `/access-pending` when navigating to `/admin/ledger/reports`.
12. **Export gate:** the export route is gated `LEDGER_VIEW OR REPORTS_EXPORT` independently; a session without either feature should receive a JSON 401/403 if they hit the export URL directly (the download link would produce a JSON file rather than a CSV — this is the same behavior as dues export and is acceptable at this scope).
13. **Mobile layout:** at 375px, the per-fund cards should stack single-column, export buttons should be full-width stacked, entity totals should stack vertically, and no horizontal overflow should occur.

**UX copy to review:**
- "Financial Report & Export" (main ledger quick-link label) — the Lions Club may prefer a shorter label.
- "Entity Totals" section heading — may prefer "Entity Summary".
- Cash-basis disclaimer text — confirm with the treasurer.

**Next agent:** qa (Phase 5).

---

# Phase 5 — Verification — 2026-06-25

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** All four automated gates passed without modification. The critical SECURITY invariant — CSV formula-injection escaping via `csvCellSafe()` — was verified at the unit level (12 Vitest cases) and confirmed in a live curl download where Party/Payee and Memo fields starting with `=` and `+` were correctly tab-prefixed. The 990-prep transfer-exclusion invariant was verified via seeded test transactions: the transfer pair ($200 total, both legs posted) correctly contributed $0 to gross receipts and $0 to expense totals, with the two rows showing `Transfer` in the transaction CSV's Category column. Feature gates are present and correct on both new surfaces. No defects found.

### What I did

**Type Check**
`pnpm exec tsc --noEmit`: PASS — clean, no output.

**Unit Tests**
`pnpm test`: PASS
Total: 258 | Passed: 258 | Failed: 0
Duration: 306ms
New test file: `src/lib/csv-ledger-export.test.ts` — 12 cases for `csvCellSafe()` covering all 4 formula-trigger chars (`=`, `+`, `-`, `@`), plain string, comma, quotes, null, undefined, combined formula-char + comma, numeric coercion, boolean coercion.

**Production Build**
`pnpm build:only`: PASS
`/admin/ledger/reports` — present as `ƒ` (dynamic)
`/api/admin/ledger/export` — present as `ƒ` (dynamic)
Total routes: 157. No unexpected output.

**End-to-End Tests**
`pnpm test:e2e`: Not run — no Playwright specs exist for the ledger reports surface. The dev-server curl flow covers the key API paths.

**Migration Idempotency**
`pnpm db:migrate` (second run): PASS — `0049_ledger_990_lines.sql` executed with 0 rows updated (all `AND form_990_line IS NULL` guards were already false). No errors. All 30 `ledger_categories` rows confirmed to have non-null `form_990_line`.

### Outputs

**Dev-Server Smoke + Click-Through**

Seeded 7 test transactions directly into the dev DB (later removed) to exercise all code paths:
- Txn1: posted income, Club dues, `$150.00`
- Txn2: posted income, party `=cmd|"/C calc"!A0`, memo `=SUM(A1:A99)` — injection test
- Txn3: pending expense (Per-capita tax)
- Txn4: rejected income
- Txn5 & Txn6: transfer pair (linked by `transfer_group_id`) — $100 income leg + $100 expense leg, both posted
- Txn7: posted income, uncategorized (no category), memo starts with `+`

| Flow | Result | Notes |
|------|--------|-------|
| Unauthenticated → export route | PASS | 401 JSON `{"error":"Unauthorized"}` |
| Authenticated, invalid `type` | PASS | 400 JSON `{"error":"Invalid type. ..."}` (after auth, before DB) |
| Authenticated, invalid `fy` (`1800`) | PASS | 400 JSON `{"error":"Invalid fiscal year"}` |
| Authenticated, invalid `entity` (`hacker`) | PASS | 400 JSON `{"error":"Invalid entity"}` |
| Empty FY → transaction CSV | PASS | Header comment rows + column headers + `# No transactions recorded...` comment; `Content-Disposition: attachment`; HTTP 200 |
| Empty FY → 990-prep CSV | PASS | Disclaimer comments + column headers + empty-row comment; HTTP 200 |
| Transaction CSV with data (FY2025) | PASS | 10 columns, all statuses present (posted/pending/rejected), transfer rows show `Category=Transfer`, uncategorized row shows `Uncategorized`, `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment`, `Cache-Control: no-store` |
| CSV injection escaping — Txn2 party | PASS | Party column: `"	=cmd|""/C calc""!A0"` — tab prepended, wrapped in quotes (comma in value), inner quotes doubled. Formula neutralized. |
| CSV injection escaping — Txn2 memo | PASS | Memo column: `	=SUM(A1:A99)` — tab prepended (no quoting needed, no comma). |
| CSV injection escaping — Txn7 memo | PASS | Memo column: `	+special event collection` — tab prepended for `+`-starting memo. |
| 990-prep transfer exclusion | PASS | Transfer pair ($200 total) excluded: gross receipts = $215.00 (Txn1 $150 + Txn2 $50 + Txn7 $15 = $215); no transfer legs inflated the total. |
| 990-prep posted-only filter | PASS | Pending expense (Txn3) and rejected income (Txn4) absent from 990-prep rows. |
| 990-prep cash-basis disclaimer | PASS | Comment rows 2–3 are the disclaimer; header includes Gross Receipts, IRS Form Determination. |
| 990-prep `hasUnmapped` flag | PASS | Txn7 (uncategorized) triggers `hasUnmapped=true`; extra comment row `# Note: Some transactions have no 990-line mapping...` appears in the file. |
| 990-prep seeded categories mapped | PASS | Club dues → `Contributions/gifts/grants` (no "Unmapped" rows for seeded categories). |
| 990-prep 990 determination chip | PASS | `990-N — 501(c)(4) with gross receipts ≤ $50,000 may file Form 990-N.` matches the compliance page result for the club entity. |
| Reports page, valid entity + FY | PASS | HTTP 200 |
| Reports page, invalid `?entity=hacker` | PASS | HTTP 404 (`notFound()`) |
| Reports page, no session | PASS | HTTP 307 redirect to signin |
| Dues export `csvCell()` unmodified | PASS | Dues export has no injection guard — per Phase 2/3 design; verified no changes to `src/app/api/admin/dues/export/route.ts` |

**Regression Tests Added**

The 12 `csvCellSafe` tests in `src/lib/csv-ledger-export.test.ts` (Phase 4b) serve as regression guards for the CSV injection issue identified in Phase 2. All pass. No additional regression tests were required — the transfer-exclusion and status-filter invariants are DB-bound and are covered by the curl click-through above; they cannot be meaningfully unit-tested without a DB mock.

**Coverage on Critical Modules**
- `src/lib/csv-safe.ts`: 100% (12 cases; file is present in `coverage/lib/csv-safe.ts.html` but omitted from text table — v8 omits 100%-covered files from the delta summary)
- `src/lib/events.ts`: 94.73% statements / 85.54% branches (unchanged from prior)
- `src/lib/ledger.ts`: 100% statements / 92.4% branches (unchanged from prior)
- `src/lib/ledger-queries.ts`: 0% unit coverage — DB-bound; covered by the curl click-through above. The transfer-exclusion logic in `get990Prep` and the `categoryDisplay` derivation in `listTransactionsForExport` were exercised via live DB queries.
- `src/lib/permissions.ts`: Not shown — 100% covered (same as above for v8 omission behavior)
- `src/lib/members.ts`: 0% — pre-existing gap, not in scope for inc4

**Feature-Gate Audit**

| Route or action | `auth()` present? | `hasAnyFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|-------------------------------|---------------------------|
| `GET /api/admin/ledger/export` | yes (line 53) | yes (lines 58-63) | `FEATURES.LEDGER_VIEW` OR `FEATURES.REPORTS_EXPORT` — correct per Phase 1 decision §2 (Option B) |
| `GET /admin/ledger/reports` (page) | yes (line 171) | yes (lines 174-179) | `FEATURES.LEDGER_VIEW` OR `FEATURES.LEDGER_RECORD` OR `FEATURES.LEDGER_MANAGE` — correct; mirrors compliance page gate |

No server actions added or changed in inc4. No other protected routes touched.

**Invariant Checks**
- No `window.confirm/alert/prompt` — PASS (no interactive UI in new files)
- No `console.log` in production paths — PASS (`console.error` only in route catch block)
- No `lions-red` — PASS
- No `<Link>` on export buttons — PASS (both are `<a>` tags; browser download behavior depends on this)
- No `rounded-full` on buttons — PASS
- Hand-rolled CSV (no new npm dependency) — PASS
- Dues export `csvCell()` unmodified — PASS (DECISION-023 compliance)
- Migration `0049_ledger_990_lines.sql` is data-only and idempotent — PASS

**Verdict: PASS**

All automated gates clean. All click-through flows verified. CSV injection escaping confirmed working at both unit and integration level. Transfer-exclusion in 990-prep confirmed via live DB test. Feature gates present and correctly keyed on both new surfaces. No defects found.

### Open questions / handoff notes

- Test transactions inserted for verification have been removed (`DELETE FROM ledger_transactions WHERE id::text LIKE '00000000-0000-0000-0000-%'` — 7 rows deleted).
- The filename generated for the CSV (`club-ledger-FY2025--Jul-2025---Jun-2026-.csv`) has double-dashes from the `replace(/[^a-zA-Z0-9-]/g, "-")` sanitization of the em-dash and parentheses in `FY2025 (Jul 2025 – Jun 2026)`. This is cosmetically ugly but functionally correct and matches the same pattern established by the dues export. Not a defect.
- **Next agent: analyst (Phase 6).**

---

# Phase 6 — Shipped vs Intent — 2026-06-25

**Owner:** analyst
**Status:** complete

### Summary

Verdict: **SHIP IT.** Every inc4 capability delivered as specified: the entity-level reports page at `/admin/ledger/reports` consolidates per-fund opening/income/expense/ending detail with entity totals and a 990 determination chip; the CSV export route handles both `transactions` and `990prep` branches with correct status filtering, transfer exclusion, injection-safe escaping, and the cash-basis disclaimer; the 990-line mapping migration (0049) seeds all 30 categories cleanly. All three entry points (sidebar, main ledger quick-link, fund page button) are wired. No inc5/inc6 scope leaked in.

One minor factual drift in DECISION-023 (placement note) and one negligible cosmetic note (double-dashes in generated filenames — pre-acknowledged by QA) are both acceptable drift. Neither affects user-facing behavior.

### What I did

Re-read the full Phase 1–5 work-log. Read all four implementation files (`reports/page.tsx`, `export/route.ts`, `csv-safe.ts`, `0049_ledger_990_lines.sql`) and the three new query helpers in `ledger-queries.ts` (lines 1182–1619). Walked every Phase 1 flow against the shipped code. Checked every Phase 1 gap for resolution. Assessed the one known acceptable-drift item (auth-failure JSON download) per the QA hand-off note.

---

**Verdict: SHIP IT**

**One-line take:** Inc4 delivers a complete entity-level financial reports page and dual CSV exports (transaction ledger + 990-prep worksheet) that match Phase 1 intent in every material dimension, with all security and correctness invariants enforced and verified.

---

### Intent-vs-shipped diff

| Phase 1 said | Shipped | Verdict |
|---|---|---|
| Reports page at `/admin/ledger/reports` — entity-level, per-fund opening/itemized income/itemized expense/ending | `FundCard` renders per-fund opening balance, non-zero income lines, non-zero expense lines, totals, ending balance (red if negative), encumbered pending row | matches |
| Entity totals: gross receipts (excl. transfers), net, 990 determination | Three-column entity totals bar with gross receipts / net / IRS form chip + `why` caption | matches |
| `determine990` result on page | Chips on entity totals bar; `why` rendered as caption; same `determine990()` function as compliance page | matches |
| Guardrail flags displayed | Rendered from `getOverview` in parallel with `getEntityReport` — same badge/icon helpers as compliance page; comment in code correctly notes why `getEntityReport` returns `[]` | matches |
| Invalid `?entity=` → `notFound()` | `notFound()` on line 195 after slug validation against `validSlugs` | matches |
| Gate: `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` | Lines 174–179: exactly that gate | matches |
| Entity/FY switching via `EntitySwitcher` / `FiscalYearSelector` | Both wired with `basePath="/admin/ledger/reports"` | matches |
| Empty state — no funds | `bg-gray-50 rounded-2xl p-10` with link to Ledger Settings | matches |
| Empty state — funds exist, zero transactions | Yellow info banner above fund cards: "No transactions recorded for {fyLabel}. Opening balances are shown." | matches |
| Transaction CSV: all statuses, transfer rows `Category = "Transfer"`, uncategorized surfaced | `listTransactionsForExport` includes all statuses; `categoryDisplay` synthesized: Transfer / Uncategorized / category.name; `csvCellSafe` on Category, Party/Payee, Memo | matches |
| 990-prep CSV: posted only, transfers excluded, grouped by 990 line | `get990Prep` raw SQL: `status = 'posted' AND transfer_group_id IS NULL`; COALESCE/CASE group-key | matches |
| 990-prep transfer exclusion verified | QA confirmed: transfer pair ($200) contributed $0 to gross receipts; gross receipts = $215 (Txn1 + Txn2 + Txn7) | matches |
| Cash-basis disclaimer + `determine990` result in 990-prep CSV header | 8-or-9 comment header lines including disclaimer (lines 2–3), gross receipts, IRS form determination | matches |
| 0049 migration seeds all 30 categories with correct 990-EZ line labels | All 30 rows mapped; idempotency confirmed; `IS NULL` guard present on every UPDATE; entity-slug scoping handles name collisions (`Meals`, `Interest`, `Public donations`, `Grants received`, `Charitable donation out`) | matches |
| Export gate: `LEDGER_VIEW OR REPORTS_EXPORT` | Lines 58–64: `hasAnyFeature([FEATURES.LEDGER_VIEW, FEATURES.REPORTS_EXPORT])` | matches |
| `type` validation before DB call | Line 73: type validated first, before `fy` and `entity` slug | matches |
| Export buttons: `<a>` tags (not `<Link>`), `rounded-lg`, `min-h-[44px]`, full-width on mobile | Both export buttons confirmed `<a>` tags, `rounded-lg`, `min-h-[44px] inline-flex`, `flex-col sm:flex-row` layout | matches |
| "Reports" nav entry in sidebar, gated `LEDGER_VIEW` | `admin-sidebar.tsx` line 124–127, `requiredFeature: FEATURES.LEDGER_VIEW` | matches |
| "Financial Report & Export" quick-link on main ledger page | `ledger/page.tsx` line 358–361 | matches |
| "Reports" button on fund `[fundSlug]` page | `[fundSlug]/page.tsx` line 179–182, link passes `?entity=…&fy=…` context | matches |
| DECISION-023: `csvCellSafe()` defined for ledger export, dues `csvCell()` unmodified | Implemented. Minor drift: the decision text says "lives in the export route" but the helper was correctly extracted to `src/lib/csv-safe.ts` to enable Vitest testing. The dues `csvCell()` is confirmed unmodified. | acceptable drift |
| Filename double-dashes from FY label sanitization | QA noted `club-ledger-FY2025--Jul-2025---Jun-2026-.csv` — cosmetically ugly, functionally correct, same pattern as dues export. Pre-acknowledged. | acceptable drift |
| Unauthenticated/unprivileged export → JSON error body saved as the "downloaded" file | `401 { error: "Unauthorized" }` / `403 { error: "Forbidden" }` — same behavior as dues export. At this scope and user population (admins/treasurers navigating from the page UI) this is acceptable. A follow-up could add a `window.location` auth-check bounce or display a page-level error toast, but it is not a blocker. | acceptable drift |

---

### Edge cases

| Check | Result |
|---|---|
| Empty state — no funds | pass — `bg-gray-50 rounded-2xl p-10` with Ledger Settings link |
| Empty state — no transactions | pass — yellow info banner, fund cards render at opening balance |
| Empty state — CSV empty FY | pass — valid CSV with comment-only data row, HTTP 200 |
| Failure microcopy — export route | pass — `console.error` + JSON 500 `{ error: "Failed to generate export" }`; no stack trace to client |
| Permission gate — page | pass — redirect to `/access-pending` for missing feature |
| Permission gate — export route | pass — independent `auth()` + `hasAnyFeature` check; 401/403 JSON |
| Mobile layout | pass — `flex-col sm:flex-row` on export buttons; `grid-cols-1 lg:grid-cols-2` on fund cards; `grid-cols-1 sm:grid-cols-3` on entity totals; no horizontal overflow expected |
| Brand consistency | pass — cards `rounded-2xl shadow-sm`, buttons `rounded-lg`, no `rounded-full`, no `lions-red`, no `window.confirm`, fund-kind badge `rounded-lg` |
| No `<Link>` on export buttons | pass |
| No new npm dependency | pass — hand-rolled CSV throughout |
| Dues export unmodified | pass — QA verified |
| Inc5/inc6 scope leaked in | pass — none; deferred items not referenced in shipped code |
| `csvCellSafe` unit coverage | pass — 12 cases including `=cmd|"/C calc"!A0` live attack string |

---

### Follow-ups (none blocking)

None. The two acknowledged drifts (filename double-dashes, JSON auth-failure download) do not affect treasurer/admin workflows — both reach the page via authenticated navigation, and the filenames open correctly in Excel and Sheets regardless of the extra dashes. No tracked follow-up entries required.

### Outputs

- `docs/work-log/2026-06-25-ledger-reports.md` — this section appended; Per-Phase Status updated

### Open questions / handoff notes

- DECISION-023 placement note ("lives in the export route") is factually stale — `csvCellSafe()` lives at `src/lib/csv-safe.ts`. The decision intent (isolation from dues export, unit-testable) is correctly honored. No action required; record the drift here for future readers.
- The `get990Prep` assets proxy uses `openingBalanceCents` only (not computed ending balance). For `determine990` thresholds at a club of this scale, the proxy is sufficient. If the Foundation ever approaches the 990-EZ → 990 asset threshold (~$500K), this estimate should be tightened to sum actual ending balances. No action required in inc4.
