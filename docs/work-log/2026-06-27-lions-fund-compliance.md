# Lions Fund-Compliance Guardrails — Work Log

> **Slug:** `2026-06-27-lions-fund-compliance`
> **Surface:** (dashboard) admin — The Ledger overview/guardrails
> **Permission(s):** existing `ledger.view` covers viewing guardrails; existing `ledger.record`/`ledger.manage` cover any remediation
> **Estimated complexity:** medium
> **Pipeline mode:** Full — touches the two-fund firewall invariant and the guardrail engine

---

## Origin

Web research (2026-06-27) against Lions Clubs International published financial governance — the **Standard Club Constitution Article VII §3(g)** and LCI Board Policy / Club Treasurer guidance on the administrative-vs-activities two-fund rule. The Ledger already enforces the core rule (two funds + Activity→Admin firewall + IRS 990 family). Research surfaced three completeness gaps relative to LCI's documented requirements. User directive: "lets do all three."

**The three enhancements:**

1. **Activity-fund holding-period aging guardrail (the clearest LCI gap).** LCI guidance: public funds *"must be returned to public use"* within *"a reasonable length of time — usually considered to be one year,"* unless earmarked for a specific project. We have no guardrail for Activity/Charitable balances sitting undisbursed past ~1 year. Add a WARN guardrail for aged public-fund balances.

2. **Direct-to-admin public income detection.** The firewall catches *transfers* Activity→Admin, but a public-sourced donation recorded *directly as income into the Administrative fund* bypasses it. Add a WARN when public/fundraising-categorized income lands in a `kind='administrative'` fund.

3. **Art VII §3(g) citation precision.** The firewall flag cites the internal "Lions Financial Transparency Policy §6." Add the authoritative external authority — **Standard Club Constitution Art. VII §3(g)** — to the `policyCite` so a treasurer can point an auditor at the constitutional text.

**Sources:**
- LCI Standard Club Constitution & By-Laws (Art. VII §3(g))
- LCI Board Policy Manual, Chapter VII
- Lions of 5M9 — "Understanding Club Expenses" (admin vs. activities funds)
- MD19 Treasurer's Handbook 2025-2026

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-06-27 |
| 2 — Architectural review | architect | Complete | Approved | 2026-06-27 |
| 3 — Technical design | tech-lead | Complete (revised 2026-07-20 — Bug 2 loop-back; see "Phase 3 — Revised Design") | Design complete | 2026-06-27, revised 2026-07-20 |
| 4 — Implementation | database-admin → api-developer → ux-developer | Complete — Bug 1 (UI) fixed 2026-07-20 by ux-developer; Bug 2 (aged-fund balance gate) fixed 2026-07-20 by api-developer per revised Phase 3 design | — | 2026-07-20 |
| 5 — Verification | qa | Complete (re-verified 2026-07-20 — both bugs confirmed fixed) | PASS | 2026-07-20 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-07-20 |

---

# Phase 1 — Functional Refinement (analyst)

## Phase 1 — Functional Refinement — 2026-06-27

**Owner:** analyst
**Status:** complete

### Summary

Three guardrail enhancements to The Ledger: (1) a WARN flag for public-fund balances that have sat undisbursed past ~1 year, (2) a WARN flag when fundraising-categorized income is posted directly into an Administrative fund rather than transferred through Activity/Charitable, and (3) a copy-only citation upgrade adding Art. VII §3(g) to the existing firewall flag. Enhancements 1 and 3 are pure additions to the `guardrails()` pure function and the `GuardrailsInput` type in `src/lib/ledger.ts`, with the aggregation hook in `getOverview()` in `src/lib/ledger-queries.ts`. Enhancement 2 requires a product decision on how to identify "public-sourced" administrative income before the design can be locked. All three surface only to the Admin on the Ledger overview page; no new permission key is needed.

**Verdict: READY WITH NOTES**

**One-line take:** Three targeted guardrail additions that close LCI compliance gaps, the meatiest of which (aging) has one unresolved product decision (earmark modeling) and one configurable-vs-hardcoded question (1-year threshold) that must be answered before the tech-lead designs it.

---

### What I did

**Pass 1 — User Verbs**

Single user surface: **Admin** at `/(dashboard)/admin/ledger`. The guardrail engine is purely server-side; there is no interactive flow — the treasurer reads flagged alerts and takes remediation action outside the system.

User verbs:
- Admin views the Ledger overview page and reads guardrail alert badges (existing verb — guardrails surface here today).
- Admin navigates to Settings (`/admin/ledger/settings`) to adjust the aging threshold if it becomes configurable (new verb, conditional on open question OQ-1).
- Admin reviews individual fund transactions to understand what triggered the aging or public-income flag, and corrects/reclassifies records (existing verb — already possible today).

No new user-facing form, modal, or action is introduced by these three enhancements. All three are purely additive guardrail reads.

**Pass 2 — Flow Audit**

There is no new user flow. The existing display flow is:

Entry: Admin loads `/admin/ledger` (or `/admin/ledger/compliance`) → `getOverview()` runs → `guardrails(state)` runs as a pure function → `guardrailFlags` array is returned → page renders flag cards.

Success: New flags appear in the "Guardrail Alerts" section with severity badge, title, detail text, and `policyCite` string. No flag appears when checks are clear.

Failure (compute errors): If `getOverview()` throws, the page already has its own error boundary at the Next.js level; no new failure path is introduced.

Failure (false positive): A correctly-held fund triggers the aging flag because no earmark mechanism exists. The treasurer sees a WARN they cannot dismiss without taking action. This is the principal risk — addressed in gaps below.

**Pass 3 — Permissions**

No new `FEATURES` key is needed. All three enhancements are:
- Read-only guardrail output — surfaced on the existing Ledger overview page, already gated by `LEDGER_VIEW` (or `LEDGER_RECORD` / `LEDGER_MANAGE` via `hasAnyFeature`).
- If the aging threshold becomes a configurable setting in `ledger_settings`, it would be edited on `/admin/ledger/settings`, which is already gated by `LEDGER_MANAGE`.

No permission changes required.

**Pass 4 — Edge Cases**

- **Empty-state (no transactions):** `getOverview()` already returns early with `guardrailFlags: []` when there are no funds. The new checks must guard against zero-transaction fund states (no divide-by-zero, no spurious fire on a $0 balance with $0 income).
- **New install / first FY:** The aging check measures income that is older than ~1 year. In the first year of Ledger use, no income row will be old enough to trigger. The check is naturally safe for new installs.
- **FY boundary:** Guardrails run against a specific FY's transactions. The aging check must be clear on whether it looks at the oldest unspent income date across *all* FYs or only within the selected FY's window. Because `allTxns` in `getOverview()` is already bounded to the selected FY, a cross-FY oldest-income query would require additional DB work. This is a design question for the tech-lead (see Gap G-2).
- **Both entities (Club and Foundation):** The aging check applies to Activity, Charitable, and Scholarship funds regardless of entity. The direct-to-admin detection applies only to Administrative funds — both entities can theoretically have an Administrative fund, but today only the Club entity has one. The check should be entity-agnostic.
- **Configurable threshold in `ledger_settings`:** The existing `reserveWarnThresholdCents` field is the precedent for configurable guardrail thresholds. A new `holdingPeriodWarnDays` (or equivalent) column would follow the same pattern — admin edits via Settings page, `getSettings()` fetches it, `guardrails()` receives it in the `settings` object. Schema change required.
- **Mobile:** Guardrail flags render as full-width `rounded-2xl` cards today — this pattern already works at 360px.
- **Brand consistency:** The existing guardrail card pattern (`bg-red-50`/`bg-yellow-50`/`bg-gray-50` with `rounded-2xl`) is correct and should be reused with no change.

**Pass 5 — Adversarial Pass**

- **No redirect parameters:** No URL query params are involved in guardrail reads. No open-redirect surface.
- **No self-targeting:** These are read-only flags. No user action is gated behind them.
- **Enumeration leaks:** None. The guardrail output is server-computed and only reaches the authenticated Admin session.
- **Input boundaries:** The `guardrails()` function is a pure function. New inputs (`oldestPublicIncomeDays`, `adminPublicIncomeCount`) must be non-negative integers. The aggregation in `getOverview()` must not pass negative or `NaN` values — the tech-lead must add defensive guards in the aggregation layer.
- **False-positive as an adversarial risk (Enhancement 1):** If the aging flag fires whenever any public-fund balance has been held longer than 1 year regardless of legitimate earmarking, a treasurer who has been properly saving for a multi-year project will see a persistent WARN they cannot resolve without remediating data or ignoring the flag. An ignored guardrail is worse than no guardrail. The earmark question in OQ-2 must be answered before implementation.
- **False-positive as an adversarial risk (Enhancement 2):** Administrative income categories today are: Club dues, Meals, Tail-twisting, Misc. All four are member-sourced, not public donations. A treasurer could create a custom category name that sounds public (e.g., "Community donation") and assign it to the Admin fund — the category-allowlist approach would flag this correctly; the `fundKind`-on-category approach would not without a schema addition. The distinction matters for the tech-lead's design.

---

### Outputs — Enhancement-by-Enhancement

#### Enhancement 1: Activity-fund holding-period aging guardrail

**What is measured:** The age of the oldest *undisbursed* public-fund income — specifically, the date of the oldest posted income transaction in a fund of kind `activity`, `charitable`, or `scholarship`, where the fund's current balance is positive (there is undisbursed money remaining).

**Why this definition:** LCI says "public funds must be returned to public use within a reasonable length of time — usually considered to be one year." The proxy is: if money came in more than 1 year ago and there is still a positive balance, some of that money may be held too long. Using the oldest income transaction date is conservative (better to warn early) and requires no new data model.

**What "fund kind" counts as public:** Activity, Charitable, Scholarship. Administrative is explicitly excluded (it holds member dues, not public funds). This matches the existing `isGiving()` logic in `ledger.ts`.

**The threshold:** The LCI standard is ~1 year. The question is whether this should be hardcoded as 365 days or configurable via a new `ledger_settings` column (e.g., `holdingPeriodWarnDays` defaulting to 365). Given the existing `reserveWarnThresholdCents` precedent, making it configurable is the correct pattern. See OQ-1.

**Cross-FY scope:** The current `getOverview()` query is bounded to a single FY's transactions. To find the oldest income transaction across all prior FYs, a separate query would be needed. The simpler approach: check the oldest income transaction for each public fund across *all posted, non-transfer income rows* for that fund — not limited to the currently selected FY. This requires a new query in `getOverview()`. The tech-lead must decide whether this cross-FY query is acceptable or whether the check is FY-scoped. See OQ-3.

**Earmarking:** LCI explicitly allows holding funds longer when earmarked for a specific project. There is no earmark concept in the current schema. The options for v1:
  - Option A (recommended for v1): No earmark model. Fire the WARN and include in the `detail` text: "If these funds are earmarked for a specific project, note the project name in the fund's memo or an upcoming board minute." This is honest about the limitation.
  - Option B (out of scope for v1): Add an `earmarked` boolean or a `earmarkNote` text column to `ledger_funds`. This is a meaningful schema change. Defer to a follow-up.
  - The risk of Option A is false positives for clubs that properly hold project funds. A WARN severity (not HIGH) reduces the urgency, but repeated WARN noise will train the treasurer to ignore guardrails. See OQ-2.

**New `GuardrailsInput` fields needed:**
```
/** Number of public funds (activity/charitable/scholarship) whose oldest posted
 *  income transaction date is more than holdingPeriodWarnDays ago AND whose
 *  current balance is positive.
 */
agedPublicFunds: number;
```

**New `ledger_settings` field needed (if configurable):**
```
holdingPeriodWarnDays: integer, default 365
```

**Severity:** WARN (not HIGH — the LCI rule uses "usually" and allows earmark exceptions).

---

#### Enhancement 2: Direct-to-admin public income detection

**The gap:** The two-fund firewall detects transfers from Activity→Admin. It does not detect a fundraising receipt posted *directly as income into the Administrative fund* — this bypasses the firewall entirely.

**How to recognize "public-sourced" income:**

The seeded administrative income categories for the Club are: Club dues, Meals, Tail-twisting, Misc. These are all member-sourced. The Activity income categories that represent public money are: Rudolph Run, White Cane, Pancake Breakfast, Public donations, Sponsorships, Interest.

Two approaches:

**Option A — Category allowlist (recommended):** Add a boolean column `isAdminPermitted` (or `adminSafe`) to `ledger_categories`. Seed the four existing Admin income categories with `adminSafe = true`. Any income transaction posted to an Administrative fund using a category marked `adminSafe = false` (or that lacks the field — i.e., a category belonging to a different `fundKind`) triggers the WARN. This is schema-light and survives custom categories as long as the admin marks them correctly.

**Option B — FundKind mismatch on category:** The `ledger_categories` table already has a `fundKind` column. A category with `fundKind = 'activity'` should never appear as income in a fund with `kind = 'administrative'`. Detect this mismatch: income transaction in an `administrative` fund using a category whose `fundKind` is not `'administrative'`. This requires no schema change and is the lowest-false-positive option, *but* it requires that the category is correctly typed — which it would be for all seeded categories. However, a custom category that the admin creates under the wrong fundKind would be missed.

**Option C — Party-based detection:** No. The `party` field is free text and cannot reliably distinguish public from member income.

**Recommended approach:** Option B (fundKind mismatch) for v1. It requires no schema change, uses existing data, and has near-zero false-positive risk for seeded categories. Its one limitation — custom categories assigned to the wrong fundKind — is an existing data-quality issue, not a new one. If Option B proves insufficient after shipping, add Option A's `adminSafe` flag as a follow-up.

**Dues must not trigger:** Club dues auto-post to the Administrative fund via the `duesPaymentId` linkage. The dues transaction uses the "Club dues" category with `fundKind = 'administrative'` — it would correctly pass the Option B check (same fundKind as the fund).

**New `GuardrailsInput` fields needed:**
```
/** Count of posted income transactions in an Administrative fund where the
 *  transaction's category has fundKind != 'administrative'.
 */
adminPublicIncomeCount: number;
```

**Severity:** WARN (same as the firewall transfer check — same policy violation, different pathway).

---

#### Enhancement 3: Art VII §3(g) citation on the firewall flag

**Scope:** Copy-only. The existing firewall guardrail's `policyCite` field currently reads:
```
"Lions Financial Transparency Policy §6 — Two-Fund Firewall"
```
Change to:
```
"Standard Club Constitution Art. VII §3(g); Lions Financial Transparency Policy §6 — Two-Fund Firewall"
```

No behavior change. No schema change. No new inputs. The existing test for the firewall flag checks that the flag fires and has the right severity — the `policyCite` string is not typically under test, so a test update may or may not be needed (QA to confirm).

Consider whether to apply the same upgrade to the negative-fund-balance flag (Check 6) since that also cites only the internal policy. Likely out of scope for this work, but document the question.

---

### Gaps

- **G-1 (Enhancement 2, category resolution in `getOverview()`):** `getOverview()` fetches all transactions for a FY in one query but does not currently fetch category metadata. To implement Option B, the aggregation layer needs to know each transaction's category's `fundKind`. This either requires joining `ledger_categories` into the transactions query, or a separate batch fetch of categories by ID from the already-fetched transactions. The tech-lead must decide which is cleaner — both are N+1-free given the approach.

- **G-2 (Enhancement 1, cross-FY scope of oldest income date):** The aging check cannot work correctly if limited to the currently selected FY's transactions (a 2-year-old income row from FY2024 is invisible to the FY2026 overview query). A fund-level "oldest posted income date" either needs a separate cross-FY query in `getOverview()`, or a denormalized field on `ledger_funds` (`oldestPostedIncomeDate`, maintained on insert/delete). The former is simpler but adds a query; the latter is faster but needs a new column and maintenance logic. This is a tech-lead design decision.

- **G-3 (Enhancement 1, positive-balance condition):** The aging check should only fire when the fund has a positive balance AND old income. A fund that received $5,000 two years ago but has spent it all should not fire. The `GuardrailsInput` shape passes `funds[].balanceCents` — the aggregation can filter to only include a fund in `agedPublicFunds` when both conditions hold: `balanceCents > 0` AND `oldestIncomeDays > threshold`. Make this explicit in the tech-lead design.

- **G-4 (Enhancement 2, uncategorized transactions):** A transaction posted to an Administrative fund with no `categoryId` (`null`) cannot be checked by Option B. Today the WARN for income-without-party fires on these rows anyway, so they are already flagged. The public-income check should explicitly exclude `categoryId IS NULL` rows from the count — not flag them, and not silently clear them. Document this in the design.

---

### Open Questions for the user

- **OQ-1 (Product decision, Enhancement 1):** Should the 1-year aging threshold be configurable by the treasurer in Ledger Settings (adds a new `holdingPeriodWarnDays` column and a settings field), or hardcoded at 365 days? Configurable is more flexible but adds schema work. Hardcoded is simpler. Recommendation: configurable, defaulting to 365, following the `reserveWarnThresholdCents` precedent.

- **OQ-2 (Product decision, Enhancement 1):** Should v1 ship the aging guardrail without an earmark mechanism (the flag fires for all positive-balance public funds older than the threshold, with a note in the detail text suggesting the treasurer document earmarks in board minutes)? Or should we defer Enhancement 1 until earmarking is designed? The no-earmark v1 is simpler but risks training the treasurer to ignore WARN noise for clubs with legitimate multi-year projects. Recommendation: ship v1 without earmarks, with a clear follow-up ticket for earmark support. The WARN severity keeps it non-urgent.

- **OQ-3 (Technical boundary, Enhancement 1):** The aging check must look at income transactions older than 1 year regardless of what FY is selected in the overview. Confirm this is the intended behavior — i.e., the check is entity-level and time-anchored to today, not FY-scoped. If yes, the tech-lead adds a small cross-FY query. If no (FY-scoped only), the check has a meaningful gap for multi-year projects.

- **OQ-4 (Scope, Enhancement 3):** Should the citation upgrade also apply to the negative-fund-balance flag (Check 6) and the reserves-threshold flag (Check 4), both of which currently cite only the internal transparency policy? Or is the citation upgrade strictly limited to the firewall flag for this work?

---

### Out of scope (confirming)

- Adding an earmark data model (new column on `ledger_funds` or a separate `ledger_fund_earmarks` table) — this is a follow-up if OQ-2 is answered "defer."
- Any UI change to display the aging flag differently from existing flags — the current flag card component is sufficient.
- Extending the firewall to catch Admin→Activity transfers (the reverse direction) — not mentioned in LCI sources and out of scope.
- Per-fund override settings for the aging threshold — global threshold only for v1.

### Open questions / handoff notes for the architect

- Enhancement 2, Option B requires `ledger_categories` metadata at guardrail-compute time — architect should confirm whether the transactions query in `getOverview()` should JOIN categories or whether a separate batch fetch is cleaner given the existing N+1-avoidance pattern.
- Enhancement 1 needs the cross-FY oldest-income query confirmed as acceptable (G-2). If the architect rules it out, the fallback is a denormalized `ledger_funds.oldestPostedIncomeDateCents` column — flag this as a schema decision.
- No new npm dependencies are expected. No new routes or directories are expected. All changes are confined to `src/lib/ledger.ts`, `src/lib/ledger-queries.ts`, `src/lib/db/schema.ts` (if configurable threshold), and `drizzle/migrations/` (if schema change). The architect should confirm no structural review is needed beyond these files.

---

### User Decisions on Open Questions (2026-06-27)

Resolved by the user before Phase 2:

- **OQ-1 → Configurable.** Add a `holdingPeriodWarnDays` column to `ledger_settings` (default 365), edited on `/admin/ledger/settings`, following the `reserveWarnThresholdCents` precedent. Schema change + idempotent migration required.
- **OQ-2 → Ship v1 without earmarks, WARN severity.** The aging flag fires for any public-fund (kind ∈ activity/charitable/scholarship) balance with unspent income older than the threshold. Detail text instructs the treasurer to document earmarked multi-year projects in board minutes. **Earmark support is a tracked follow-up** (own work-log entry later), not part of this work.
- **OQ-3 → Across all fiscal years.** The aging check is time-anchored to today and looks at the oldest unspent public income regardless of selected FY. The tech-lead adds the cross-FY oldest-income query to `getOverview()` (or the denormalized-column fallback in G-2 if the architect rules the query out).
- **OQ-4 → §3(g) cite on the firewall flag AND the new direct-to-admin flag (Enhancement 2) only.** Both are governed by Standard Club Constitution Art. VII §3(g). Do **not** alter the negative-fund-balance or reserves-threshold cites — §3(g) does not govern those.

---

## Phase 2 — Architectural Review — 2026-06-27

**Owner:** architect
**Status:** complete

### Summary

Approved. All three enhancements are structurally confined to `src/lib/ledger.ts`, `src/lib/ledger-queries.ts`, `src/lib/db/schema.ts`, and `drizzle/migrations/`. No new directory, route, permission key, or npm dependency is introduced. The two open architectural questions (G-1 and G-2 from Phase 1) are ruled on below with specific implementation directives. The `holdingPeriodWarnDays` schema addition is additive and follows the established `reserveWarnThresholdCents` precedent exactly.

### What I did

**Read in full:**
- `docs/work-log/2026-06-27-lions-fund-compliance.md` (Phase 1 output + user decisions)
- `src/lib/ledger-queries.ts` (all 2098 lines — `getOverview()`, `getFundReport()`, `getEntityReport()`, `get990Prep()`)
- `src/lib/ledger.ts` (`GuardrailsInput`, `guardrails()`, all existing checks)
- `src/lib/db/schema.ts` — `ledgerCategories`, `ledgerSettings`, `ledgerTransactions` table definitions
- `docs/decisions.md` — next available decision number confirmed as DECISION-027

**Checked all architecture invariants:**
1. Directory placement — no new directories; all changes inside existing modules. Clear.
2. Server/client boundary — `ledger-queries.ts` and `ledger.ts` are server-only; `guardrails()` is a pure function with no DB access. No `'use client'` change needed. Clear.
3. Permission gating — no new `FEATURES` key required; all three enhancements surface on the existing Ledger overview, gated by `LEDGER_VIEW` (confirmed with Phase 1). Clear.
4. Migration idempotency — one new `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` needed for `holdingPeriodWarnDays`. Pattern is idempotent. Clear.
5. Schema-first invariant — `src/lib/db/schema.ts` must be updated before the migration is authored. Flagged for the tech-lead.
6. No new dependencies — confirmed; existing `drizzle-orm` `inArray`, `gte`, `lt`, `sql`, `eq` operators are sufficient for both new queries.

**Ruled on G-1 (Enhancement 2 — category `fundKind` at compute time):**

The correct approach is a bounded batch fetch: after `allTxns` is fetched, collect the distinct `categoryId` values that appear on income rows belonging to administrative funds, then fetch those category rows in a single `inArray` query. Build a `Map<categoryId, fundKind>` and use it in the TypeScript aggregation. This is NOT a JOIN on `allTxns`.

Rationale: The `allTxns` query is a flat fetch already used for six distinct aggregation purposes; widening it with a LEFT JOIN on categories bloats every row for a check relevant to a small subset. The file's established N+1-avoidance pattern (see `getFundReport()` step 3, `getEntityReport()` step 5) is exactly "fetch the category set once in a separate query, then merge in TypeScript." The inline SQL JOIN in `get990Prep()` is a counter-precedent but appropriate there — it is a single SQL aggregate, not a TypeScript pass. Follow the TypeScript-aggregation-path precedent here. One bounded extra round-trip is acceptable; unbounded N+1 is not.

**Ruled on G-2 (Enhancement 1 — cross-FY oldest-income query):**

Use a dedicated cross-FY aggregate query added to `getOverview()`. The denormalized-column fallback (a `ledger_funds.oldestPostedIncomeDate` column maintained on every income write/update/delete) is rejected.

Rationale: the denormalized column touches four distinct write paths (record income, approve pending income, reject income, hard-delete income). A maintenance bug on any one path silently corrupts the guardrail — the most important kind of bug to avoid in a compliance feature. The cross-FY query is a single `SELECT fund_id, MIN(txn_date) FROM ledger_transactions WHERE flow='income' AND status='posted' AND fund_id IN (<public-fund-ids>) GROUP BY fund_id` with no FY bound, returning O(N-funds) aggregate rows — fast and always correct. The balance-positive condition is applied in TypeScript using already-computed `fundSummaries[].endingCents`, not in SQL, matching G-3's specification.

**Confirmed scope boundaries:**
- `CLAUDE.md` two-fund firewall documentation: the direct-to-admin income check (Enhancement 2) extends the firewall's *detection surface* but does not change the structural rule. No edit to `CLAUDE.md` is required — the new guardrail check is self-describing in `src/lib/ledger.ts`. The tech-lead may add a brief inline comment in `guardrails()` noting the two detection pathways.
- Enhancement 3 (citation copy change) is contained entirely inside the `policyCite` string on the existing firewall flag in `guardrails()`. No schema change, no migration, no type change.

**Logged DECISION-027** — covers both architectural rulings and their rationale, scoped to this feature.

### Outputs

- `docs/decisions.md` — DECISION-027 added (architect-owned, cross-FY query ruling + category-batch-fetch ruling)
- No code files touched (review phase only)

### Open questions / handoff notes for the tech-lead

- **Schema-first:** Add `holdingPeriodWarnDays integer NOT NULL DEFAULT 365` to `ledgerSettings` in `src/lib/db/schema.ts` before authoring the migration. The migration must be `ALTER TABLE ledger_settings ADD COLUMN IF NOT EXISTS holding_period_warn_days integer NOT NULL DEFAULT 365`.
- **`getSettings()` fallback:** The hardcoded fallback object in `getSettings()` (lines 225–233 of `ledger-queries.ts`) must be updated to include `holdingPeriodWarnDays: 365` when the column is added, or `getSettings()` will return an incomplete object on a fresh install before the migration runs.
- **`GuardrailsInput` additions:** Two new fields: `agedPublicFunds: number` (count of public funds where `endingCents > 0` AND `oldestIncomeDays > holdingPeriodWarnDays`) and `adminPublicIncomeCount: number` (count of posted income rows in an administrative fund where category's `fundKind != 'administrative'`, excluding `categoryId IS NULL` per analyst G-4). Both are non-negative integers; the aggregation layer must guard against `NaN` and negative values.
- **Query placement:** Both new queries belong in `getOverview()`, not `getComplianceOverview()`. The compliance page calls `getOverview()` internally — the new flags will propagate automatically.
- **Null `categoryId` handling (G-4):** Income rows with `categoryId IS NULL` must be excluded from `adminPublicIncomeCount`. They are already caught by the `incomeWithoutParty` guardrail; double-flagging them would be noise.
- **`getSettings()` thread through `guardrails()`:** The `settings` object passed to `guardrails()` currently carries `{ reserveWarnThresholdCents, treasurerBonded, retentionYears }`. It must be extended to include `holdingPeriodWarnDays`. The tech-lead must update the type and both call sites (`getOverview()` and any test stubs).
- **Unit tests:** The `guardrails()` pure function must have tests for both new checks. The cross-FY query in `getOverview()` should have an integration test or a spy verifying it is called with no FY bound.
- **Enhancement 3 policyCite change:** Change the firewall flag's `policyCite` from `"Lions Financial Transparency Policy §6 — Two-Fund Firewall"` to `"Standard Club Constitution Art. VII §3(g); Lions Financial Transparency Policy §6 — Two-Fund Firewall"`. The new direct-to-admin flag (Enhancement 2) should use the same combined cite. No other flags are changed (OQ-4 ruling).

---

## Phase 3 — Technical Design — 2026-06-27

**Owner:** tech-lead
**Status:** complete

### Summary

Three targeted additions to the guardrail engine in `src/lib/ledger.ts` and its data aggregation layer in `src/lib/ledger-queries.ts`. The feature adds one new `ledger_settings` column (`holdingPeriodWarnDays`), two new `GuardrailsInput` fields (`agedPublicFunds`, `adminPublicIncomeCount`), two new queries inside `getOverview()`, two new checks in `guardrails()`, and one copy-only `policyCite` change to the existing firewall flag. No new route, directory, permission, or dependency is introduced. The Settings page form and PATCH route get a single new integer field wired end-to-end.

---

### Technical Design: Lions Fund-Compliance Guardrails (inc7)

#### Permissions

No new `FEATURES` key. All three enhancements surface on the existing Ledger overview and settings pages:

- Reading guardrails: `LEDGER_VIEW` (or `hasAnyFeature` including `LEDGER_RECORD` / `LEDGER_MANAGE`) — no change.
- Editing the threshold: `LEDGER_MANAGE` — enforced at the existing `/api/admin/ledger/settings` PATCH route and at the `/admin/ledger/settings` page level — no change.

#### Data Model

**`src/lib/db/schema.ts` — `ledgerSettings` table**

Add one column after `retentionYears`:

```ts
holdingPeriodWarnDays: integer("holding_period_warn_days").notNull().default(365),
```

The `LedgerSettings` inferred type picks this up automatically (no manual type edit needed beyond the table definition).

**Migration: `drizzle/migrations/0052_ledger_compliance_guardrails.sql`**

```sql
-- idempotent: safe to re-run on every deploy
ALTER TABLE ledger_settings
  ADD COLUMN IF NOT EXISTS holding_period_warn_days integer NOT NULL DEFAULT 365;
```

No seed data change needed — `DEFAULT 365` covers both new installs and the existing singleton row on the first deploy (Postgres fills the default on `ADD COLUMN`).

**`getSettings()` fallback object** (lines 224–233 of `ledger-queries.ts`): add `holdingPeriodWarnDays: 365` to the fallback literal so the function return type stays consistent with the updated `LedgerSettings` inferred type and the compiler remains happy.

#### New `GuardrailsInput` Fields

Add to the `GuardrailsInput` type in `src/lib/ledger.ts`, after `syncStaleTxns`, in a new `// inc7 fields` block:

```ts
// ---------------------------------------------------------------------------
// inc7 fields — Lions Fund-Compliance Guardrails.
// Callers on earlier paths pass 0 until updated.
// ---------------------------------------------------------------------------

/**
 * Count of public funds (kind ∈ 'activity' | 'charitable' | 'scholarship')
 * where (a) the fund's endingCents > 0 AND (b) the oldest posted income
 * transaction across ALL fiscal years for that fund is more than
 * settings.holdingPeriodWarnDays days old relative to today.
 *
 * Must be a non-negative integer. Computed in getOverview() via a dedicated
 * cross-FY MIN(txn_date) aggregate query (DECISION-027).
 */
agedPublicFunds: number;

/**
 * Count of posted income transactions belonging to a fund of kind='administrative'
 * where the transaction's category has fundKind != 'administrative'.
 * Rows with categoryId IS NULL are excluded (they are caught by incomeWithoutParty).
 *
 * Must be a non-negative integer. Computed in getOverview() via a bounded
 * batch fetch of category rows for the relevant categoryIds (DECISION-027).
 */
adminPublicIncomeCount: number;
```

Both fields are required (not optional) in `GuardrailsInput`. The `cleanState` baseline in `ledger.test.ts` must add `agedPublicFunds: 0, adminPublicIncomeCount: 0`.

**Non-negative contract:** `getOverview()` must guard both values before passing them:

```ts
agedPublicFunds: Math.max(0, agedPublicFundsRaw),
adminPublicIncomeCount: Math.max(0, adminPublicIncomeCountRaw),
```

#### Queries in `getOverview()`

Both new queries run after `allTxns` is fetched and `fundSummaries` is built. They are placed in a new `// inc7 guardrail inputs` comment block immediately before the `guardrails({...})` call.

**Query A — Cross-FY oldest posted income date per public fund (Enhancement 1)**

```ts
// inc7 — Query A: oldest posted income date per public fund (cross-FY, no FY bound)
const publicFundIds = funds
  .filter((f) => ["activity", "charitable", "scholarship"].includes(f.kind))
  .map((f) => f.id);

const oldestIncomeRows = publicFundIds.length > 0
  ? await db
      .select({
        fundId: ledgerTransactions.fundId,
        oldestDate: sql<string>`MIN(${ledgerTransactions.txnDate})`,
      })
      .from(ledgerTransactions)
      .where(
        and(
          inArray(ledgerTransactions.fundId, publicFundIds),
          eq(ledgerTransactions.flow, "income"),
          eq(ledgerTransactions.status, "posted"),
        ),
      )
      .groupBy(ledgerTransactions.fundId)
  : [];
```

This query has **no FY bound** — it runs across all fiscal years to find the oldest posted income per public fund. When `publicFundIds` is empty (no public funds yet), the query is skipped and `oldestIncomeRows` is `[]`.

**TypeScript aggregation for `agedPublicFunds`:**

```ts
const today = new Date();
const oldestDateByFundId = new Map<string, string>(
  oldestIncomeRows.map((r) => [r.fundId, r.oldestDate]),
);

const agedPublicFundsRaw = fundSummaries.filter((fs) => {
  if (!["activity", "charitable", "scholarship"].includes(fs.fund.kind)) return false;
  if (fs.endingCents <= 0) return false;   // balance-positive filter (G-3)
  const oldestDateStr = oldestDateByFundId.get(fs.fund.id);
  if (!oldestDateStr) return false;         // no income ever recorded — not aged
  const oldestDate = new Date(oldestDateStr);
  const ageDays = (today.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > settings.holdingPeriodWarnDays;
}).length;
```

**Query B — Admin-fund income category batch fetch (Enhancement 2)**

```ts
// inc7 — Query B: batch-fetch categories for admin-fund income rows (DECISION-027)
const adminFundIds = funds
  .filter((f) => f.kind === "administrative")
  .map((f) => f.id);

// Collect distinct categoryIds on posted income rows in admin funds (exclude null)
const adminIncomeCategoyIds = new Set<string>();
for (const txn of allTxns) {
  if (
    txn.flow === "income" &&
    txn.status === "posted" &&
    adminFundIds.includes(txn.fundId) &&
    txn.categoryId !== null
  ) {
    adminIncomeCategoyIds.add(txn.categoryId);
  }
}

const categoryFundKindMap = new Map<string, string>();
if (adminIncomeCategoyIds.size > 0) {
  const categoryRows = await db
    .select({ id: ledgerCategories.id, fundKind: ledgerCategories.fundKind })
    .from(ledgerCategories)
    .where(inArray(ledgerCategories.id, Array.from(adminIncomeCategoyIds)));
  for (const row of categoryRows) {
    categoryFundKindMap.set(row.id, row.fundKind);
  }
}
```

**TypeScript aggregation for `adminPublicIncomeCount`:**

```ts
const adminPublicIncomeCountRaw = allTxns.filter((txn) => {
  if (txn.flow !== "income" || txn.status !== "posted") return false;
  if (!adminFundIds.includes(txn.fundId)) return false;
  if (txn.categoryId === null) return false;   // G-4: exclude uncategorized
  const catFundKind = categoryFundKindMap.get(txn.categoryId);
  // If category wasn't fetched (e.g., category was deleted), skip — don't false-positive
  if (catFundKind === undefined) return false;
  return catFundKind !== "administrative";
}).length;
```

**Thread-through to `guardrails()` call:**

The `settings` object passed to `guardrails()` at line ~636 of `getOverview()` must be extended:

```ts
settings: {
  reserveWarnThresholdCents: settings.reserveWarnThresholdCents,
  treasurerBonded: settings.treasurerBonded,
  retentionYears: settings.retentionYears,
  holdingPeriodWarnDays: settings.holdingPeriodWarnDays,   // inc7: new
},
```

Update the `settings` object type inside `GuardrailsInput` accordingly:

```ts
settings: {
  reserveWarnThresholdCents: number;
  treasurerBonded: boolean;
  retentionYears: number;
  holdingPeriodWarnDays: number;  // inc7
};
```

#### Two New Guardrail Checks in `guardrails()`

Add both checks after the `syncStaleTxns` block, in a new `// inc7 checks` comment section.

**Check A — Aged public fund balances (Enhancement 1)**

```ts
// Check: aged public-fund balances — undisbursed public money held past the threshold (WARN) — inc7
if (state.agedPublicFunds > 0) {
  const n = state.agedPublicFunds;
  flags.push({
    severity: "warn",
    title: `Public fund${n === 1 ? "" : "s"} holding undisbursed balance past ${state.settings.holdingPeriodWarnDays}-day threshold`,
    detail:
      `${n} public fund${n === 1 ? "" : "s"} ${n === 1 ? "has" : "have"} a positive balance and ` +
      `the oldest posted income is more than ${state.settings.holdingPeriodWarnDays} days old. ` +
      `LCI guidance requires public funds to be returned to public use within a reasonable time — ` +
      `usually one year. If any of these funds are earmarked for a specific multi-year project, ` +
      `document the project name and expected disbursement date in the board meeting minutes.`,
    policyCite: "LCI Board Policy Manual Ch. VII — Public Fund Disbursement",
  });
}
```

**Check B — Direct-to-admin public income (Enhancement 2)**

```ts
// Check: public-sourced income posted directly to an Administrative fund (WARN) — inc7
if (state.adminPublicIncomeCount > 0) {
  const n = state.adminPublicIncomeCount;
  flags.push({
    severity: "warn",
    title: "Public-category income posted directly to Administrative fund",
    detail:
      `${n} posted income transaction${n === 1 ? "" : "s"} in the Administrative fund ` +
      `${n === 1 ? "uses a category" : "use categories"} associated with public/activity funds. ` +
      `Public donations and fundraising proceeds must be deposited into an Activity or Charitable fund, ` +
      `not the Administrative fund. Review and reclassify these transactions.`,
    policyCite: "Standard Club Constitution Art. VII §3(g); Lions Financial Transparency Policy §6 — Two-Fund Firewall",
  });
}
```

**Enhancement 3 — `policyCite` change on the existing firewall check**

In the existing firewall violation block (around line 507 of `ledger.ts`), change:

```ts
policyCite: "Lions Financial Transparency Policy §6 — Two-Fund Firewall",
```

to:

```ts
policyCite: "Standard Club Constitution Art. VII §3(g); Lions Financial Transparency Policy §6 — Two-Fund Firewall",
```

No other `policyCite` strings are changed.

#### Component / Page Plan

**Files to modify:**

1. `src/lib/db/schema.ts` — add `holdingPeriodWarnDays` column to `ledgerSettings`.
2. `drizzle/migrations/0052_ledger_compliance_guardrails.sql` — `ADD COLUMN IF NOT EXISTS`.
3. `src/lib/ledger.ts` — add `agedPublicFunds` + `adminPublicIncomeCount` to `GuardrailsInput`; add `holdingPeriodWarnDays` to the `settings` sub-type; add the two new guardrail checks; update the firewall `policyCite`.
4. `src/lib/ledger-queries.ts` — add `holdingPeriodWarnDays: 365` to `getSettings()` fallback; add Query A + Query B + their TypeScript aggregation inside `getOverview()`; thread `holdingPeriodWarnDays` through the `settings` object passed to `guardrails()`.
5. `src/components/admin/ledger/ledger-settings-form.tsx` — add a `holdingPeriodWarnDays` integer input field (days, not dollars — no `$` prefix, no `* 100` conversion). State: `const [holdingDays, setHoldingDays] = useState(settings.holdingPeriodWarnDays)`. Validation: must be a positive integer (`> 0`). Passes `holdingPeriodWarnDays: holdingDays` (integer) in the PATCH body.
6. `src/app/api/admin/ledger/settings/route.ts` — add `holdingPeriodWarnDays` to the PATCH handler's validation block: `typeof v === "number" && Number.isInteger(v) && v > 0`. Add it to the `SettingsUpdate` partial type and the update payload.
7. `src/lib/ledger.test.ts` — update `cleanState` to add `agedPublicFunds: 0, adminPublicIncomeCount: 0` to `GuardrailsInput`; add `holdingPeriodWarnDays: 365` to `cleanState.settings`; add the new test cases (see Unit Tests below).

**No new pages, no new components, no new routes.**

The Settings page (`src/app/(dashboard)/admin/ledger/settings/page.tsx`) passes `settings` to `LedgerSettingsForm` — the new column is picked up through the `LedgerSettings` inferred type with no change needed to `page.tsx`.

#### Implementation Order

1. **Schema** — `database-admin` agent:
   - Add `holdingPeriodWarnDays` column to `ledgerSettings` in `src/lib/db/schema.ts`.
   - Author `drizzle/migrations/0052_ledger_compliance_guardrails.sql` with the idempotent `ADD COLUMN IF NOT EXISTS`.
   - Update the `getSettings()` fallback object in `ledger-queries.ts` to include `holdingPeriodWarnDays: 365`.

2. **API / guardrail logic** — `api-developer` agent:
   - Extend `GuardrailsInput` type in `ledger.ts` (two new fields + `settings.holdingPeriodWarnDays`).
   - Add Enhancement 3 `policyCite` change to the existing firewall flag.
   - Add the two new guardrail check blocks to `guardrails()`.
   - Add Query A (cross-FY oldest income) and Query B (admin-fund category batch fetch) to `getOverview()` in `ledger-queries.ts`.
   - Thread `holdingPeriodWarnDays` into the `settings` object passed to `guardrails()`.
   - Add `holdingPeriodWarnDays` validation + update support to `src/app/api/admin/ledger/settings/route.ts`.
   - Deliver all required unit tests (see below).

3. **UI** — `ux-developer` agent:
   - Add the `holdingPeriodWarnDays` integer input field to `src/components/admin/ledger/ledger-settings-form.tsx`.
   - Wire state, validation, and PATCH body.

#### Unit Tests (Phase-4 deliverables — implementer delivers, not QA)

All tests go in `src/lib/ledger.test.ts` under the existing `describe("guardrails", ...)` block. The `api-developer` delivers these as part of step 2.

The `cleanState` baseline must be updated first:

```ts
// cleanState additions
settings: {
  ...
  holdingPeriodWarnDays: 365,   // inc7
},
agedPublicFunds: 0,             // inc7
adminPublicIncomeCount: 0,      // inc7
```

**Enhancement 1 — aged public funds:**

- `"does NOT fire aged-funds warn when agedPublicFunds is 0"` — pass `cleanState`, confirm no flag with title matching `/aged|holding/i`.
- `"fires WARN when agedPublicFunds is 1"` — set `agedPublicFunds: 1`; confirm one WARN flag whose `title` matches `/holding.*threshold/i` and `detail` includes the word "minutes" (board-minutes instruction).
- `"fires WARN when agedPublicFunds is greater than 1 (plural noun)"` — set `agedPublicFunds: 3`; confirm one WARN flag whose `title` contains "funds" (plural).
- `"aged-funds detail text includes the configured holdingPeriodWarnDays value"` — set `agedPublicFunds: 1`, `settings.holdingPeriodWarnDays: 180`; confirm flag `detail` contains "180".
- `"does NOT fire aged-funds warn when agedPublicFunds is 0 even if holdingPeriodWarnDays is very small"` — `agedPublicFunds: 0`, `holdingPeriodWarnDays: 1`; confirm no flag.

**Enhancement 2 — direct-to-admin public income:**

- `"does NOT fire admin-public-income warn when adminPublicIncomeCount is 0"` — `cleanState`; no flag with title matching `/administrative fund/i`.
- `"fires WARN when adminPublicIncomeCount is 1"` — set `adminPublicIncomeCount: 1`; confirm one WARN flag whose `title` matches `/public-category income/i` and `policyCite` contains `"Art. VII §3(g)"`.
- `"fires WARN when adminPublicIncomeCount is greater than 1 (plural noun)"` — set `adminPublicIncomeCount: 4`; confirm one WARN flag whose `detail` contains "4 posted income transactions".
- `"admin-public-income flag does NOT fire when adminPublicIncomeCount is 0 (dues scenario)"` — `adminPublicIncomeCount: 0`; confirm no `warn` flag matching the title; this is the dues-not-flagged case. (The count computation in `getOverview()` never increments for dues because the "Club dues" category has `fundKind = 'administrative'`; this test confirms the guardrail respects the count, not the category logic.)

**Enhancement 3 — firewall policyCite:**

- `"two-fund firewall flag policyCite includes Art. VII §3(g)"` — set `firewallViolations: 1`; find the HIGH firewall flag; assert `flag.policyCite` contains `"Art. VII §3(g)"` and also contains `"Two-Fund Firewall"`.

**cleanState regression:**

- `"cleanState with inc7 fields still returns no flags"` — confirm `guardrails(cleanState)` returns `[]` after adding the new fields to cleanState.

#### Edge Cases and Risks

- **Zero-transaction public fund:** `publicFundIds` contains a fund with no income rows — `MIN(txn_date)` returns no row for it; `oldestDateByFundId.get(fs.fund.id)` returns `undefined`; the TS filter returns `false`. Safe.
- **$0 balance with old income (spent-down fund):** The `fs.endingCents <= 0` guard in the TS aggregation ensures a fund that received and spent public money will not fire. The query returns the oldest income date regardless; the balance-positive check in TypeScript is the final gate.
- **FY boundary / new install:** The cross-FY query naturally returns nothing for a fresh install (no transactions); `oldestIncomeRows` is empty; `agedPublicFunds` is 0. No spurious WARNs.
- **Empty `publicFundIds` / empty `adminFundIds`:** Both queries are guarded with `if (publicFundIds.length > 0)` / `if (adminIncomeCategoyIds.size > 0)` before executing. The DB is never called with an empty `inArray`.
- **Deleted category on admin-fund income row:** `categoryFundKindMap.get(txn.categoryId)` returns `undefined`; the TS filter returns `false`. We skip rather than flag — conservative false-negative is better than a false positive from a data inconsistency.
- **`adminFundIds.includes(txn.fundId)`:** This is an O(N) scan inside a loop. For the typical club (1–2 admin funds, < 200 transactions in memory), the performance cost is negligible. If fund counts grow materially, replace with `new Set(adminFundIds)`.
- **`NaN` guard:** `settings.holdingPeriodWarnDays` arrives from the DB as an integer and from the fallback as `365`. The PATCH route validates it as `Number.isInteger(v) && v > 0`. No `NaN` path exists, but the `Math.max(0, ...)` wrapper on the count values is a final safety net.
- **False-positive on dues:** Dues income rows have `categoryId` pointing to the "Club dues" category, whose `fundKind = 'administrative'`. The TS filter `catFundKind !== "administrative"` returns `false`, so dues never increment `adminPublicIncomeCount`. This is confirmed by the "dues scenario" unit test.

#### Out of Scope

- Earmark data model (`ledger_fund_earmarks` table or `earmarkNote` column on `ledger_funds`) — tracked as a follow-up feature once the v1 WARN noise is observed in practice.
- Per-fund override of the aging threshold — global setting only.
- Citation upgrade for the negative-balance flag or reserves-threshold flag (OQ-4 ruling: only the firewall flag and the new direct-to-admin flag get the §3(g) cite).
- Any UI change to how guardrail flags are rendered — the existing flag card component is reused as-is.

---

### What I did

- Read `src/lib/ledger.ts` in full (confirmed exact `GuardrailsInput` type, `guardrails()` checks, `cleanState` shape in the test file).
- Read `src/lib/ledger-queries.ts` lines 210–700 (confirmed `getSettings()` fallback object, `getOverview()` query strategy, `getFundReport()`/`getEntityReport()` batch-fetch precedent).
- Read `src/lib/db/schema.ts` `ledgerSettings` table (confirmed exact column names: `reserveWarnThresholdCents`, `treasurerBonded`, `retentionYears`, `disbApprovalThresholdCents`; no `holdingPeriodWarnDays` yet).
- Read `src/components/admin/ledger/ledger-settings-form.tsx` and `src/app/api/admin/ledger/settings/route.ts` (confirmed form pattern and PATCH validation shape).
- Read `src/lib/ledger.test.ts` (confirmed `cleanState` shape and test naming convention).
- Confirmed next migration number: `0052` (last was `0051_ledger_donors.sql`).

### Outputs

- `docs/work-log/2026-06-27-lions-fund-compliance.md` — this Phase 3 section.
- No code files touched (design phase only).

### Open questions / handoff notes

- Use **database-admin** for step 1: schema column + migration + `getSettings()` fallback. Deliverable: `schema.ts` updated, `0052_ledger_compliance_guardrails.sql` authored, `getSettings()` fallback updated.
- Use **api-developer** for step 2: `GuardrailsInput` extension, two new guardrail checks, Enhancement 3 `policyCite` change, both `getOverview()` queries + TS aggregation, PATCH route update, and all required unit tests. Deliverable: all logic complete + tests passing.
- Use **ux-developer** for step 3: `ledger-settings-form.tsx` new integer field. Deliverable: `holdingPeriodWarnDays` input wired with state, validation, and PATCH body.
- The api-developer must add `agedPublicFunds: 0, adminPublicIncomeCount: 0, settings.holdingPeriodWarnDays: 365` to `cleanState` in `ledger.test.ts` before the new test cases compile — this is a prerequisite for the existing test suite to pass.

---

## Phase 4 — Implementation (schema) — 2026-06-27

**Owner:** database-admin
**Status:** complete

### Summary

Added `holdingPeriodWarnDays integer NOT NULL DEFAULT 365` to the `ledgerSettings` table in `schema.ts`, authored the idempotent migration `0052_ledger_compliance_guardrails.sql`, and updated the `getSettings()` fallback object in `ledger-queries.ts` to include the new field. Typecheck passes clean. Migration confirmed idempotent: run twice locally — second run emitted Postgres NOTICE code 42701 ("column already exists, skipping") and completed successfully.

### What I did

- Added `holdingPeriodWarnDays: integer("holding_period_warn_days").notNull().default(365)` to `ledgerSettings` in `src/lib/db/schema.ts`, after `retentionYears`, matching the column declaration style of the surrounding integer columns.
- Created `drizzle/migrations/0052_ledger_compliance_guardrails.sql` with a single idempotent `ALTER TABLE ledger_settings ADD COLUMN IF NOT EXISTS holding_period_warn_days integer NOT NULL DEFAULT 365` statement.
- Added `holdingPeriodWarnDays: 365` to the hardcoded fallback literal in `getSettings()` in `src/lib/ledger-queries.ts`, matching the existing fallback key ordering and format.
- Ran `pnpm exec tsc --noEmit` — no errors.
- Applied the migration locally twice via `pnpm db:migrate` — both runs succeeded; second run confirmed idempotency via NOTICE 42701.

### Outputs

- `src/lib/db/schema.ts` — `holdingPeriodWarnDays` column added to `ledgerSettings` table
- `drizzle/migrations/0052_ledger_compliance_guardrails.sql` — new migration (single idempotent `ADD COLUMN IF NOT EXISTS` statement; confirmed re-runnable)
- `src/lib/ledger-queries.ts` — `getSettings()` fallback updated with `holdingPeriodWarnDays: 365`
- Local apply command: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`

### Open questions / handoff notes

- **Next agent: api-developer**
- New column available: `holding_period_warn_days` in the `ledger_settings` table. Drizzle TypeScript field name: `holdingPeriodWarnDays` (integer, `NOT NULL`, `DEFAULT 365`).
- The `LedgerSettings` inferred type (from `typeof ledgerSettings.$inferSelect`) now carries `holdingPeriodWarnDays: number` — no manual type edit needed, Drizzle picks it up automatically.
- The `settings` sub-object passed to `guardrails()` inside `getOverview()` must be extended to include `holdingPeriodWarnDays: settings.holdingPeriodWarnDays`. The Phase 3 design shows the exact shape (see "Thread-through to `guardrails()` call" section).
- The `GuardrailsInput` `settings` sub-type must add `holdingPeriodWarnDays: number` (Phase 3, "Update the `settings` object type inside `GuardrailsInput`").
- The `cleanState` baseline in `ledger.test.ts` must add `agedPublicFunds: 0, adminPublicIncomeCount: 0` to the top-level fields and `holdingPeriodWarnDays: 365` inside `settings` before the new test cases will compile.
- All api-developer deliverables are fully specified in the Phase 3 design above (queries, TS aggregation, two new `guardrails()` checks, Enhancement 3 `policyCite` change, PATCH route update, unit tests).

---

## Phase 4 — Implementation (API) — 2026-06-27

**Owner:** api-developer
**Status:** complete

### Summary

Extended `GuardrailsInput` with two new fields and `settings.holdingPeriodWarnDays`; added both new guardrail checks (aged public-fund balances WARN, direct-to-admin public income WARN); upgraded the firewall flag's `policyCite` to include Art. VII §3(g); added Query A (cross-FY MIN aggregate) and Query B (admin-fund category batch fetch) to `getOverview()`; wired `holdingPeriodWarnDays` into the PATCH settings route with proper validation; and delivered all 11 named unit tests. Typecheck clean, 304 tests pass, production build clean.

### What I did

- Added `holdingPeriodWarnDays: number` to the `settings` sub-type in `GuardrailsInput` in `src/lib/ledger.ts`.
- Added `agedPublicFunds: number` and `adminPublicIncomeCount: number` top-level fields to `GuardrailsInput` with full JSDoc and DECISION-027 references.
- Added two new guardrail checks in `guardrails()` (inc7 comment block): Check A (aged public-fund balances — WARN, policyCite "LCI Board Policy Manual Ch. VII — Public Fund Disbursement") and Check B (direct-to-admin public income — WARN, policyCite includes Art. VII §3(g) and Two-Fund Firewall).
- Updated Enhancement 3: changed existing firewall `policyCite` from `"Lions Financial Transparency Policy §6 — Two-Fund Firewall"` to the combined `"Standard Club Constitution Art. VII §3(g); Lions Financial Transparency Policy §6 — Two-Fund Firewall"`.
- Added Query A (cross-FY `MIN(txn_date)` aggregate with no FY bound) and its TypeScript aggregation to `getOverview()` in `src/lib/ledger-queries.ts` — produces `agedPublicFunds` count.
- Added Query B (bounded batch fetch of `ledgerCategories` for admin-fund income categoryIds) and its TypeScript aggregation — produces `adminPublicIncomeCount` count. Both follow the DECISION-027 batch-fetch precedent established by `getFundReport()`/`getEntityReport()`.
- Threaded `holdingPeriodWarnDays: settings.holdingPeriodWarnDays` into the `settings` object passed to `guardrails()`.
- Added `holdingPeriodWarnDays` field validation and update support to `PATCH /api/admin/ledger/settings` (validation: `Number.isInteger(v) && v > 0`; returns 400 on invalid).
- Updated `cleanState` and `cleanStateInc3` in `ledger.test.ts` to include `agedPublicFunds: 0, adminPublicIncomeCount: 0` and `settings.holdingPeriodWarnDays: 365`.
- Fixed one pre-existing test inline `settings` literal (the "multiple simultaneous flags" test) that was missing `holdingPeriodWarnDays`.
- Wrote all 11 named unit tests (2 describe blocks for Enhancement 1 + Enhancement 2, 1 for Enhancement 3, 1 regression block) — all passing.

### Outputs

- `src/lib/ledger.ts` — `GuardrailsInput` extended; two new guardrail checks added; firewall `policyCite` upgraded; file header and JSDoc updated.
- `src/lib/ledger-queries.ts` — Query A + Query B + TS aggregation added to `getOverview()`; `guardrails()` call extended with new fields.
- `src/app/api/admin/ledger/settings/route.ts` — `holdingPeriodWarnDays` added to `SettingsUpdate` type and validation block.
- `src/lib/ledger.test.ts` — `cleanState` and `cleanStateInc3` updated; 11 new tests added in 4 describe blocks.

**API contract for ux-developer:**

`PATCH /api/admin/ledger/settings`
- Auth: session required (`401` if not authenticated)
- Permission: `FEATURES.LEDGER_MANAGE` (`403` if missing)
- New accepted body field: `holdingPeriodWarnDays?: number` — must be a positive integer (`> 0`). Returns `400` with `{ error: "holdingPeriodWarnDays must be a positive integer" }` on invalid input.
- Response `200`: `{ settings: LedgerSettings }` — `LedgerSettings` now includes `holdingPeriodWarnDays: number`.

No schema changes in this phase (schema done by database-admin in the prior increment).

### Test names and pass count

All 304 tests passing (11 new inc7 tests + 293 pre-existing):

New tests added:
- `guardrails — aged public-fund balances (inc7)`:
  - "does NOT fire aged-funds warn when agedPublicFunds is 0"
  - "fires WARN when agedPublicFunds is 1"
  - "fires WARN when agedPublicFunds is greater than 1 (plural noun)"
  - "aged-funds detail text includes the configured holdingPeriodWarnDays value"
  - "does NOT fire aged-funds warn when agedPublicFunds is 0 even if holdingPeriodWarnDays is very small"
- `guardrails — direct-to-admin public income (inc7)`:
  - "does NOT fire admin-public-income warn when adminPublicIncomeCount is 0"
  - "fires WARN when adminPublicIncomeCount is 1"
  - "fires WARN when adminPublicIncomeCount is greater than 1 (plural noun)"
  - "admin-public-income flag does NOT fire when adminPublicIncomeCount is 0 (dues scenario)"
- `guardrails — firewall policyCite upgrade (inc7)`:
  - "two-fund firewall flag policyCite includes Art. VII §3(g)"
- `guardrails — cleanState regression (inc7)`:
  - "cleanState with inc7 fields still returns no flags"

### Open questions / handoff notes

**Next agent: ux-developer**

The only remaining piece of the feature is the Settings form field in `src/components/admin/ledger/ledger-settings-form.tsx`. Specifically:

- Add a `holdingPeriodWarnDays` integer input field (days — no `$` prefix, no `* 100` conversion; the DB stores days directly as an integer).
- State: `const [holdingDays, setHoldingDays] = useState(settings.holdingPeriodWarnDays)`.
- Validation: must be a positive integer (`> 0`). Show an inline error if the value is `<= 0` or non-integer.
- PATCH body: pass `holdingPeriodWarnDays: holdingDays` (integer, not a string) in the JSON body alongside any other updated fields.
- The `settings` prop already carries `holdingPeriodWarnDays: number` from the `LedgerSettings` type — no page-level change needed.
- The Settings page (`src/app/(dashboard)/admin/ledger/settings/page.tsx`) passes `settings` to `LedgerSettingsForm` — no change needed there.
- The `SettingsUpdate` type in the route now includes `holdingPeriodWarnDays`, and the PATCH route validates and persists it.
- Label suggestion: "Public fund holding period (days)" or similar; place it near the reserve threshold field since both are guardrail thresholds.
- No divergence from Phase 3 design. All named unit tests were delivered and are passing.

---

## Phase 4 — Implementation (UI) — 2026-07-20

**Owner:** ux-developer
**Status:** complete

### Summary

Added the `holdingPeriodWarnDays` integer input to `src/components/admin/ledger/ledger-settings-form.tsx`, placed directly below the reserve warning threshold field since both are guardrail thresholds. The field is edited and submitted as a plain integer (no `$` prefix, no cents conversion), matching the DB column which stores days directly. State, validation, and the PATCH body follow the same idioms as the two existing dollar-threshold fields in this form. Typecheck passes clean. `pnpm lint` could not run — pre-existing environment issue unrelated to this change (see notes below).

### What I did

- Read the Phase 3 design and the api-developer's Phase 4 handoff notes at the end of this work-log to confirm the exact contract: `PATCH /api/admin/ledger/settings` accepts `holdingPeriodWarnDays?: number`, validated server-side as `Number.isInteger(v) && v > 0`, 400 on invalid, `LEDGER_MANAGE` gated.
- Read `src/components/admin/ledger/ledger-settings-form.tsx` in full to match its existing state/validation/dirty-tracking idiom before writing any code.
- Added `const [holdingDays, setHoldingDays] = useState(settings.holdingPeriodWarnDays);` alongside the other settings state declarations.
- Added a `holdingDays` branch to `validate()`: `!Number.isInteger(holdingDays) || holdingDays <= 0` sets `e.holdingDays` to an inline error, following the same `Record<string, string>` error-map pattern used by `disb`/`reserve`.
- Added `holdingPeriodWarnDays: holdingDays` (a number, not a string) to the PATCH request body in `handleSubmit`, alongside the existing fields.
- Added the new field's markup: a labeled `<div>` with helper text explaining the aged public-fund guardrail and the ~365-day LCI guidance, a plain `type="number"` input (no `$` affix, `min={1}` `step={1}`, `inputMode="numeric"`), and an inline error paragraph — same visual pattern as the dollar fields but without the `$`-prefix wrapper `<div className="relative">`, since there's no currency symbol to overlay.
- On change, the input parses to `NaN` when cleared (so the field can be emptied while typing) rather than coercing to `0`; `value` renders `""` when `Number.isNaN(holdingDays)` so React doesn't fight the browser's number-input state. `validate()` catches the `NaN` case via `!Number.isInteger(holdingDays)`.
- Updated the file's top JSDoc comment to note that `holdingPeriodWarnDays` is stored and edited directly as an integer of days, distinguishing it from the cents-backed dollar fields.
- Ran `pnpm exec tsc --noEmit` — clean, no errors.
- Attempted `pnpm lint` — failed with `ERR_MODULE_NOT_FOUND: Cannot find package '@eslint/eslintrc'` from `eslint.config.mjs`. Ran `pnpm install` to rule out a stale local install; the error persists (`node_modules/@eslint` doesn't exist locally). This is a pre-existing environment/dependency-resolution issue, not something introduced by this change — `@eslint/eslintrc` is not a direct dependency in `package.json` and is presumably expected to be hoisted transitively. Flagging for qa/deployment-engineer since it blocks a normal lint run in this checkout; it did not block typecheck or block reasoning about correctness of this diff.

### Outputs

- `src/components/admin/ledger/ledger-settings-form.tsx` — added `holdingDays` state, validation branch, PATCH body field, and the new "Public fund holding period (days)" input with helper text, placed between the reserve threshold field and the treasurer-bonded checkbox.
- No other files touched. No page-level change was needed (`settings` prop already carries `holdingPeriodWarnDays: number` per the schema/API work in prior Phase 4 sub-phases).

### Open questions / handoff notes

**Next agent: qa**

- Click-through: `/admin/ledger/settings` as a user with `LEDGER_MANAGE` — confirm the new "Public fund holding period (days)" field renders with the default value (365 on a fresh install), that entering `0` or a decimal (e.g. `1.5`) shows the inline error "Enter a whole number of days greater than 0." and blocks submit, that clearing the field also blocks submit with the same error, and that a valid positive integer (e.g. `180`) saves successfully and the toast confirms.
- Confirm on reload that the saved value persists (i.e., the PATCH round-trip and `getSettings()` read-back both reflect the new number) — this exercises the full stack delivered across all three Phase 4 sub-phases.
- Confirm the guardrail on `/admin/ledger` (or the compliance page) actually reacts to a changed threshold — e.g., lowering `holdingPeriodWarnDays` to a very small number against a club with existing aged public-fund income should surface the new WARN flag from api-developer's Enhancement 1 check. This is the natural end-to-end smoke test tying UI, API, and guardrail logic together.
- No new copy strings need Lions Club review beyond the label/helper text already in the diff; both are factual/explanatory rather than brand voice-sensitive, but flag to the club if they'd like softer phrasing.
- Known gap for qa/deployment-engineer to weigh in on: `pnpm lint` is broken in this checkout independent of this feature (`@eslint/eslintrc` module not found, even after `pnpm install`). Worth a dependency-review look since it blocks the normal Phase 4 lint gate for every agent, not just this one.

---

## Phase 5 — Verification (qa) — 2026-07-20

**Owner:** qa
**Status:** complete

### Summary

**Verdict: FAIL.** Typecheck, all 304 unit tests, and the production build all pass clean, and the migration is confirmed idempotent. But end-to-end click-through against a running dev server surfaced two real defects that the unit-test suite, by construction, could not catch: (1) the Settings form's decimal-rejection validation is dead code — `parseInt("1.5", 10)` silently truncates to `1` and saves it, so the promised inline error never fires; (2) the aged-public-fund WARN (Enhancement 1) does not fire when a treasurer is viewing the fiscal year that is *currently selected by default* if the fund's aged public income landed in a prior FY and the fund has had zero transactions in the selected FY — which is precisely the "old money sitting untouched" scenario the guardrail exists to catch. Bug 2 traces to a design-level mismatch introduced in Phase 3, not an implementation slip: the design calls for `agedPublicFunds` to be "entity-level and time-anchored to today, not FY-scoped" (OQ-3 resolution, DECISION-027), and Query A (the cross-FY `MIN(txn_date)` query) is correctly cross-FY — but the balance-positive gate (G-3) reuses `fs.endingCents` from `fundSummaries`, which is computed only from `allTxns` bound to the *currently selected* FY window. The result: a fund with real, aged, undisbursed public money produces `endingCents = 0` (and is silently excluded) whenever the selected FY has no transactions for that fund. Both bugs are reproduced below with exact steps; both must go back to the implementer before this feature ships. Bug 2 is the more serious of the two — it defeats the primary use case of the entire enhancement.

### What I did

**1. Read Phase 3 design, all three Phase 4 sub-phase sections, and the ux-developer's "For QA" handoff notes in full** before touching any gate.

**2. Static verification (all pass):**
- `pnpm exec tsc --noEmit` — clean, no output, exit 0.
- `pnpm test` — 304/304 passing. Confirmed by name (via `grep -n "describe("`) that all four inc7 describe blocks exist: `guardrails — aged public-fund balances (inc7)`, `guardrails — direct-to-admin public income (inc7)`, `guardrails — firewall policyCite upgrade (inc7)`, `guardrails — cleanState regression (inc7)`. Read the test bodies directly (`src/lib/ledger.test.ts:1053-1155`) — they match the Phase 3 design's 11 named tests exactly.
- `pnpm build:only` — `✓ Compiled successfully in 7.3s`, exit 0, full route table printed with no errors/warnings.
- Migration audit: read `drizzle/migrations/0052_ledger_compliance_guardrails.sql` — single statement, `ALTER TABLE ledger_settings ADD COLUMN IF NOT EXISTS holding_period_warn_days integer NOT NULL DEFAULT 365`. Idempotent. Confirmed by observation: starting the local dev server re-ran all migrations and emitted Postgres NOTICE 42701 ("column ... already exists, skipping") for this migration, consistent with the database-admin's earlier double-run report.
- Code-read diff audit of every changed file (`src/lib/ledger.ts`, `src/lib/ledger-queries.ts`, `src/app/api/admin/ledger/settings/route.ts`, `src/lib/db/schema.ts`, `src/components/admin/ledger/ledger-settings-form.tsx`) against the Phase 3 design — all match the design's exact code blocks (queries, aggregation, checks, validation, migration).

**3. Feature-gate audit** — read the route/page files directly (not inferred from tests):
- `src/app/api/admin/ledger/settings/route.ts` PATCH handler: `auth()` present (`session.user.id` checked, 401 if absent), `hasFeature(session.user.id, FEATURES.LEDGER_MANAGE)` present (403 if absent). Correct key — this is a mutation endpoint.
- `src/app/(dashboard)/admin/ledger/settings/page.tsx`: `auth()` + `hasFeature(session.user.id, FEATURES.LEDGER_MANAGE)` present, gates the whole settings page.
- `src/app/(dashboard)/admin/ledger/page.tsx` (overview surface — where the new guardrail flags render): `auth()` + `hasAnyFeature(..., [FEATURES.LEDGER_VIEW, ..., FEATURES.LEDGER_MANAGE])` present.
- No new route was added by this feature; the existing PATCH route gained one new validated field. No gate regressions found.

**4. Dev-server smoke test.** Started `pnpm dev`, confirmed `Ready in 211ms` and the idempotent-migration NOTICE.
- `curl -X PATCH /api/admin/ledger/settings` unauthenticated → `401 {"error":"Unauthorized"}`. Confirmed.
- `curl /admin/ledger/settings` and `curl /admin/ledger` unauthenticated → `307` redirect to `/signin?callbackUrl=...`. Confirmed.
- Invalid-body validation (`0`, `-1`, `1.5` when authenticated) — verified by code read of the PATCH handler (`typeof v !== "number" || !Number.isInteger(v) || v <= 0` → 400) and confirmed live for `0` via the browser click-through below. This logic is correct on the **server side** — the bug is client-side (see Bug 1).
- Authenticated click-through via a temporary Playwright spec (`e2e/qa-verify-ledger-settings.spec.ts`, written for this verification, run once, then deleted — not left in the repo since it exercises a scenario the app doesn't yet handle correctly) using `e2e/helpers/auth.ts` (`signInAsAdmin`) and the `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` already seeded in `.env.local`:
  - `/admin/ledger/settings` loads; "Public fund holding period (days)" field renders with persisted value `365`. **Confirmed.**
  - Entering `0` and submitting shows "Enter a whole number of days greater than 0." and blocks submit. **Confirmed.**
  - Entering `1.5` and submitting: **expected** the same inline error per the ux-developer's own handoff note; **actual** — no error appears, the form submits, and the value silently saves as `1`. **Bug 1 — see below.**
  - `/admin/ledger` (default entity="club", default FY=current) renders without error; existing "Reserves below minimum threshold" flag renders correctly.
  - Lowering `holdingPeriodWarnDays` to `30` and viewing `/admin/ledger?entity=foundation` (the entity that owns the Charitable Fund, which has $500 of posted income dated 2026-06-01 — 49+ days before "today," well past a 30-day threshold, and zero expense activity, i.e. genuinely aged and undisbursed) — **expected** the new WARN to fire; **actual** — it does not fire, because the default page load lands on the current FY (FY2026, Jul 2026–Jun 2027) and the fund's transactions are all dated in FY2025 (Jul 2025–Jun 2026). **Bug 2 — see below.**
  - Re-ran the identical scenario with `&fy=2025` (the FY that actually contains the transactions) — the WARN fires correctly: `"Public fund holding undisbursed balance past 30-day threshold" / "Charitable Fund"`, and the entity balance correctly reads `$500.00` (vs. `$0.00` shown under the FY2026 default view). This isolates the bug precisely to the FY-scoping of the balance-positive gate, not the guardrail logic itself.
  - All settings mutations made during this smoke test were restored to their original values (`holdingPeriodWarnDays: 365`) directly against the local Neon DB in `.env.local` before finishing — confirmed via a final read-back query.

**5. Lint diagnosis (`pnpm lint` — pre-existing, not caused by this feature, per the ux-developer's flag).**
- Root cause part 1 (fixed): `eslint.config.mjs` imports `@eslint/eslintrc` directly (`import { FlatCompat } from "@eslint/eslintrc";`) for `eslint-config-next`'s legacy-config bridge, but `@eslint/eslintrc` was never declared as a direct `devDependency` — it only existed as a transitive dependency inside the pnpm store (`node_modules/.pnpm/@eslint+eslintrc@3.3.3`), and pnpm's strict linking does not expose transitive packages at the top-level `node_modules/@eslint/`. This is a one-liner: added `"@eslint/eslintrc": "^3.3.3"` to `package.json` devDependencies (alphabetically placed) and ran `pnpm install`. This resolved the original `ERR_MODULE_NOT_FOUND`.
- Root cause part 2 (NOT a one-liner — documented, not fixed): after the above fix, `pnpm lint` still fails with a **different** error: `SyntaxError: The requested module 'minimatch' does not provide an export named 'default'`, thrown from inside `@eslint/eslintrc`'s `override-tester.js`, which does `import minimatch from "minimatch"` (a CJS-style default import). This project's `package.json` has a deliberate `pnpm.overrides` pin, `"minimatch": "^10"`, added on 2026-05-27 (`docs/reviews/2026-05-27-dependencies.md`, `docs/reviews/2026-05-27-security.md`) to close three high-severity ReDoS CVEs transitively pulled in via `googleapis`. Minimatch v10 is ESM-only and does not provide a `default` export, which breaks `@eslint/eslintrc`'s legacy CJS-interop import. **I did not touch the `minimatch` override** — downgrading it to satisfy `eslint-config-next`'s legacy bridge would reopen a documented, intentional CVE fix, which is out of scope for a QA lint diagnosis and not a one-liner. This is now a real, narrowly-scoped dependency conflict (not a missing-package issue) between a security-driven override and ESLint's legacy flat-config compatibility shim (`FlatCompat`). Flagging for **deployment-engineer** as part of the next 30-day dependency review: the durable fix is almost certainly replacing `eslint.config.mjs`'s `FlatCompat`/`@eslint/eslintrc` bridge to `eslint-config-next` with a native flat-config equivalent (removing the legacy dependency chain entirely) rather than chasing `minimatch` compatibility. Ran `pnpm exec tsc --noEmit` again after the `package.json` edit to confirm no regression — still clean.
- This lint gap is unrelated to the two functional bugs above and does not change the FAIL verdict either way — the verdict is already FAIL on functional grounds.

### Outputs

- `package.json` — added `"@eslint/eslintrc": "^3.3.3"` to `devDependencies` (one-liner fix for the `ERR_MODULE_NOT_FOUND` half of the pre-existing lint breakage).
- `pnpm-lock.yaml` — updated by `pnpm install` to reflect the new direct devDependency.
- No other source files modified by qa. The temporary Playwright spec used for the authenticated click-through (`e2e/qa-verify-ledger-settings.spec.ts`) and three temporary DB-inspection scripts (`scripts/qa-tmp-*.ts`) were deleted after use — they are not part of the permanent test suite because they exercise a scenario (aged-funds WARN across FY boundaries) the app does not yet handle correctly; a permanent regression test should be added by the implementer alongside the fix, per this project's regression-test discipline (failing test before the fix).
- All local DB settings mutations made during the smoke test were reverted (`holdingPeriodWarnDays` restored to `365` on the local Neon DB referenced by `.env.local`).
- Dev server started for this verification was stopped; port 3000 confirmed free.

### Type Check
`pnpm exec tsc --noEmit`: **PASS**

### Unit Tests
`pnpm test`: **PASS**
Total: 304 | Passed: 304 | Failed: 0
Duration: ~362ms
Failures: none

### Production Build
`pnpm build:only`: **PASS**
Notes: `✓ Compiled successfully in 7.3s`. Full route table printed, including all existing `/api/admin/ledger/*` routes; no new routes added by this feature (only a field added to the existing settings PATCH). No unused-export warnings observed.

### End-to-End Tests
`pnpm test:e2e`: **Not run as the standing suite** — no ledger-specific spec exists yet in `e2e/`. A temporary spec was written, run, and deleted for this verification (see "What I did" §4). **Manual/scripted click-through: FAIL** (2 bugs found; see below).

### Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| `/admin/ledger/settings` loads with persisted `holdingPeriodWarnDays` | pass | Renders `365` (fresh-install default, unchanged at time of check). |
| Reject `holdingPeriodWarnDays = 0` | pass | Inline error shown, submit blocked. |
| Reject `holdingPeriodWarnDays = 1.5` (decimal) | **FAIL** | No error shown; `parseInt("1.5", 10)` truncates to `1` and silently saves. See Bug 1. |
| Valid save + reload persistence (`180` → reload → `180`) | pass (verified for the `0`/valid-value path; not separately re-verified for `180` after isolating Bug 1, since the underlying PATCH round-trip was already confirmed working via the `1`-truncation save) | — |
| PATCH unauthenticated → 401 | pass | `curl` confirmed. |
| Pages unauthenticated → redirect to `/signin` | pass | 307 to `/signin?callbackUrl=...` confirmed for both `/admin/ledger` and `/admin/ledger/settings`. |
| `/admin/ledger` renders without error (authenticated) | pass | Existing "Reserves below minimum threshold" flag renders; page has no application error. |
| Aged-funds WARN fires when threshold is lowered below existing aged public income, viewed under the FY that actually contains the aged income (`&fy=2025`) | pass | Confirms the guardrail *logic* itself (Query A + Check A) is correct when given the right FY window. |
| Aged-funds WARN fires when threshold is lowered below existing aged public income, viewed under the **default/current** FY (no `&fy=` param) | **FAIL** | Does not fire. See Bug 2 — this is the realistic, unguarded path a treasurer will actually hit. |
| `pnpm lint` | FAIL (pre-existing, partially remediated) | See Lint Diagnosis above; not blocking this verdict, but documented in full. |

### Regression Tests Added

None added to the permanent suite yet — per this project's discipline, the regression test for each bug should be written by the implementer alongside the fix (failing-then-passing), not by qa in isolation from the fix. The temporary Playwright spec used to find and confirm both bugs (now deleted) can be recreated verbatim by the next agent from the reproduction steps below; recommend it (or an equivalent) be added permanently to `e2e/` once both fixes land, plus a `getOverview()`-level test or a `ledger-queries` unit-style coverage for the FY-boundary case (Bug 2) if a testable seam can be isolated without a live DB.

**Bug 1 — decimal input silently truncated instead of rejected.**
- Repro: on `/admin/ledger/settings`, set the "Public fund holding period (days)" input to `1.5`, submit.
- Expected (per Phase 3 design + ux-developer's own QA handoff note): inline error "Enter a whole number of days greater than 0.", submit blocked.
- Actual: no error; form submits; `holdingPeriodWarnDays` saves as `1`.
- Root cause: `src/components/admin/ledger/ledger-settings-form.tsx`, the `onChange` handler for `#holding-period-days` — `const parsed = e.target.value === "" ? NaN : parseInt(e.target.value, 10);`. `parseInt("1.5", 10)` returns `1`, a value that passes `Number.isInteger(holdingDays) && holdingDays > 0` in `validate()`. The decimal portion is silently discarded before validation ever sees it.
- Fix direction (for the implementer, not applied by qa): parse with `Number(e.target.value)` (or check for a `.` in the raw string) so a non-integer numeric string produces a value `validate()` can actually reject, e.g. `const parsed = e.target.value === "" ? NaN : Number(e.target.value);` — `Number("1.5")` is `1.5`, and `Number.isInteger(1.5)` is `false`, so the existing `validate()` branch would then correctly fire.
- Loop-back: **Phase 4 (ux-developer)** — this is a straightforward implementation defect in the diff ux-developer delivered, not a design-level problem. The Phase 3 design never specified the parsing implementation; `parseInt` was ux-developer's choice.

**Bug 2 — aged-public-fund WARN silently fails to fire for the primary target scenario (fund with aged income and zero activity in the currently-viewed FY).**
- Repro: entity "Foundation," Charitable Fund has 3 posted income transactions all dated `2026-06-01`/`2026-06-10` (FY2025: Jul 2025–Jun 2026), summing to $500, and zero expense transactions ever. Lower `holdingPeriodWarnDays` to `30` (well under 49+ days aged). Load `/admin/ledger?entity=foundation` **with no `&fy=` param** (i.e., the default landing view, which resolves to the current calendar FY, FY2026).
- Expected (per Phase 1 G-3, Phase 2 DECISION-027, Phase 3 OQ-3 resolution: "the check is entity-level and time-anchored to today, not FY-scoped"): the WARN fires — the fund's real balance is $500, positive, and its oldest income is far past the 30-day threshold.
- Actual: the WARN does not fire. The page shows the fund's balance as `$0.00` for FY2026 (correct — the fund had no FY2026 activity) but the guardrail incorrectly treats this FY-window balance as the fund's true balance.
- Confirmed by isolating variables: identical scenario with `&fy=2025` (the FY that actually contains the transactions) correctly fires the WARN and correctly shows the fund/entity balance as `$500.00`.
- Root cause: `src/lib/ledger-queries.ts`, inside `getOverview()`. Query A (`oldestIncomeRows`) is correctly cross-FY (`SELECT ... WHERE fundId IN (...) AND flow='income' AND status='posted'` — no `txnDate` bound). But the balance-positive gate in the same block, `if (fs.endingCents <= 0) return false;`, reads `fs.endingCents` from `fundSummaries`, which is built earlier in `getOverview()` from `allTxns` — and `allTxns` **is** bound to `[start, end)` of the FY passed into the function (`gte(ledgerTransactions.txnDate, start), lt(ledgerTransactions.txnDate, end)` at `ledger-queries.ts` ~line 524-530). `fund.openingBalanceCents` (used as the base for `endingCents`) is a static per-fund field, not a rolled-forward true balance — so for a fund with real aged money but zero transactions in the *selected* FY, `endingCents` computes to whatever the stale `openingBalanceCents` happens to be (here, `0`), not the fund's actual current balance.
- Why this is a design flaw, not an implementation slip: the Phase 3 design's own edge-case note ("$0 balance with old income (spent-down fund): The `fs.endingCents <= 0` guard ... ensures a fund that received and spent public money will not fire") conflates two different scenarios that happen to produce the same `endingCents <= 0` symptom — a fund that was *actually spent down* (correct, should not fire) and a fund that merely has *no transactions in the currently-selected FY* (incorrect exclusion — the fund may still hold real, aged, undisbursed money). `fundSummaries`/`fs.endingCents` cannot distinguish these two cases because it is fundamentally an FY-window calculation, not a cumulative balance. The design needed a second cross-FY query (parallel to Query A) computing each public fund's true current balance — e.g., `SUM(income) - SUM(expense)` with no FY bound, or `fund.openingBalanceCents` plus all-time posted income/expense — to gate on, rather than reusing the FY-scoped `fundSummaries`.
- Loop-back: **Phase 3 (tech-lead)** — the fix requires a design change (a genuinely cross-FY balance figure for the gate, not just a cross-FY oldest-income-date query), which is outside qa's remit to redesign. Recommend the tech-lead add a Query C (or extend Query A to also return `SUM(amountCents)` by flow, grouped by fund, with no FY bound) and re-derive the balance-positive gate from that cross-FY total rather than `fs.endingCents`. This also means the "positive-balance condition" language in G-3/Phase 3 needs a one-line correction: it should say "the fund's true cumulative balance," not the FY-scoped `fundSummaries.endingCents`.
- Impact if shipped as-is: **high** for a WARN-severity compliance guardrail whose entire purpose is to catch aged, undisbursed public money. The bug's failure mode is specifically silent non-detection in the most common real-world viewing pattern (an admin lands on `/admin/ledger` with no query params, which always resolves to the current FY) whenever the aged fund has been dormant for the current FY — which is exactly what "money sitting untouched for over a year" looks like in the data. The guardrail will reliably fail to protect against the compliance risk it was built for unless the treasurer manually pages back through every prior FY for every entity.

### Coverage on Critical Modules

- `src/lib/ledger.ts`: not independently re-measured this session (no `--coverage` run); the 11 new inc7 unit tests exercise every new branch in `guardrails()` (both `if` blocks, singular/plural noun branches, `policyCite` content) — branch coverage on the new code is effectively complete at the `guardrails()` level. The *aggregation* logic that feeds `guardrails()` (Query A/B in `getOverview()`, `src/lib/ledger-queries.ts`) has **no unit-level coverage** — it is DB-bound and was only exercised by qa's manual click-through, which is exactly what surfaced Bug 2. This is a real coverage gap: `getOverview()`'s FY-scoping interaction with the new aggregation was untested by any layer until this manual pass.
- `src/lib/permissions.ts`: unchanged by this feature; not touched, not re-measured.
- `src/lib/members.ts`: unchanged by this feature; not touched, not re-measured.

### Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|------------------------------|----------------------------|
| `PATCH /api/admin/ledger/settings` | yes | yes | `FEATURES.LEDGER_MANAGE` — correct (mutation endpoint) |
| `/admin/ledger/settings` (page) | yes | yes | `FEATURES.LEDGER_MANAGE` — correct (edit surface) |
| `/admin/ledger` (page — renders the new guardrail flags) | yes | yes (`hasAnyFeature` incl. `LEDGER_VIEW`) | `FEATURES.LEDGER_VIEW` (or `LEDGER_RECORD`/`LEDGER_MANAGE`) — correct (read-only guardrail surface, no new PII exposed) |

No new route or server action was introduced by this feature — only one new field added to an already-gated PATCH route, and two new read-only fields threaded through an already-gated overview page. No gate regressions found.

### Verdict: FAIL

Two functional defects, cited above with exact repro steps and root cause:
1. **Bug 1** (`src/components/admin/ledger/ledger-settings-form.tsx`) — decimal input silently truncated instead of rejected. Loop back to **Phase 4 (ux-developer)**.
2. **Bug 2** (`src/lib/ledger-queries.ts`, `getOverview()`) — aged-public-fund WARN fails to fire under the default/current-FY view when the fund's aged income and zero current-FY activity is exactly the scenario the guardrail exists to catch. This is a design defect, not an implementation slip. Loop back to **Phase 3 (tech-lead)** to redesign the balance-positive gate as a genuinely cross-FY figure, then back through Phase 4 (api-developer) to implement the corrected query.

Typecheck, unit tests, and the production build are all clean, and the migration is idempotent — those gates alone would have signed off a feature with a guardrail that doesn't guard. This is the exact scenario the manual click-through step exists to catch.

### Open questions / handoff notes

- **Next agent: tech-lead** (Bug 2 is a design-level fix; per pipeline rules, loop back to the earliest phase where the failure originated). Tech-lead should revise the Phase 3 design's balance-positive gate to use a true cross-FY fund balance (new Query C, or extend Query A to also aggregate `SUM(amountCents)` by flow with no FY bound) instead of `fundSummaries[].endingCents`, and re-hand to **api-developer** to implement.
- **api-developer** (after tech-lead's revised design) should also fix Bug 1 while back in this file's neighborhood, or hand Bug 1 specifically to **ux-developer** if the specialist split is preferred — either is small enough (`parseInt` → `Number` in one `onChange` handler) that either agent could take it.
- Both bugs need permanent regression tests written by the implementer *before* the fix, watched to fail, then watched to pass, per this project's regression-test discipline — not retrofitted by qa after the fact. Suggested test shape for Bug 2: a `getOverview()`-level integration test (or, if a pure-function seam can be extracted, a unit test on a new pure aggregation helper) using two fixtures — a fund with aged income and zero current-FY activity (should fire) vs. a fund that was aged-and-then-fully-spent-down even within the current FY window (should not fire) — the current test suite has no coverage that distinguishes these two cases.
- `pnpm lint` is now closer to working (the `ERR_MODULE_NOT_FOUND` half is fixed) but still fails on a `minimatch`/`@eslint/eslintrc` ESM-interop conflict rooted in the intentional 2026-05-27 CVE-driven `minimatch: ^10` override. Recommend **deployment-engineer** take this up in the next 30-day dependency review — likely fix is replacing the `FlatCompat`/`@eslint/eslintrc` legacy bridge in `eslint.config.mjs` with a native ESLint 9 flat-config equivalent for `eslint-config-next`, removing the legacy dependency chain rather than chasing `minimatch` compatibility.
- Do not re-run Phase 6 (analyst) until qa re-verifies both fixes and issues a fresh PASS.

---

## Phase 4 — Bug-1 fix (UI, loop-back from Phase 5) — 2026-07-20

**Owner:** ux-developer
**Status:** complete

### Summary

Fixed the Bug 1 defect QA reported: the `#holding-period-days` `onChange` handler in `src/components/admin/ledger/ledger-settings-form.tsx` parsed input with `parseInt(value, 10)`, which silently truncates a decimal string (`"1.5"` → `1`) before `validate()`'s `Number.isInteger` check ever sees it, so the promised "reject non-integer" inline error never fired and the truncated integer saved instead. Swapped `parseInt` for `Number` in that one handler so the fractional value survives into state and the existing validation branch catches it.

### Root cause

`parseInt("1.5", 10)` returns `1` — a value that trivially satisfies `Number.isInteger(holdingDays) && holdingDays > 0` in `validate()`. The truncation happens at parse time, before validation runs, so the integer-only rule had nothing left to reject. This was an implementation choice inside the handler, not a gap in the Phase 3 design (the design never specified `parseInt` vs `Number`) — confirmed as a straightforward Phase 4 implementation defect per QA's diagnosis.

### The fix

`src/components/admin/ledger/ledger-settings-form.tsx`, `#holding-period-days` `onChange`:

```ts
onChange={(e) => {
  // Use Number(), not parseInt(), so a decimal like "1.5" is preserved
  // as 1.5 rather than silently truncated to 1 — validate()'s
  // Number.isInteger check below is what actually rejects it.
  const parsed = e.target.value === "" ? NaN : Number(e.target.value);
  setHoldingDays(parsed);
  setErrors((p) => ({ ...p, holdingDays: "" }));
}}
```

`Number("1.5")` is `1.5`, so `Number.isInteger(1.5)` is `false` and the existing `validate()` branch (`e.holdingDays = "Enter a whole number of days greater than 0."`) now fires correctly and blocks submit. Kept the field's existing `number`-typed state (rather than switching to a raw-string state) since `Number()` alone was sufficient to unblock validation and this is the smaller diff against the form's existing idioms.

Verified behaviorally (by inspection, matching the existing test matrix QA already ran):
- `""` (cleared field) → `Number("")` is `0` in general, but the handler explicitly short-circuits the empty case to `NaN` before calling `Number()`, so clearing the field still produces `NaN` → displays as empty via the existing `Number.isNaN(holdingDays) ? "" : holdingDays` render guard. Unchanged from before.
- `"180"` → `Number("180")` is `180`, an integer, passes validation, PATCH body sends `holdingPeriodWarnDays: 180` as a number. Unchanged from before.
- `"1.5"` → `Number("1.5")` is `1.5`, fails `Number.isInteger`, inline error shows, submit is blocked — this is the bug that's now fixed.
- Round-trip: initial state (`useState(settings.holdingPeriodWarnDays)`) and the PATCH payload shape are untouched by this change.

### Other numeric fields checked (no fix needed)

Confirmed the disbursement-approval and reserve-warning dollar fields do **not** share this bug: both parse via `parseDollars()`, which uses `parseFloat(val)`, not `parseInt`. `parseFloat` preserves decimals — correct and expected for dollar-and-cents input (`"500.55"` parses to `500.55`, not truncated to `500`). Those fields' `validate()` branches additionally enforce a `/^\d+(\.\d{1,2})?$/` regex for at-most-two-decimal-places, which is the intended constraint for currency, not an integer constraint. No change made to `parseDollars()` or the dollar-field handlers — the truncation defect was isolated to the one `parseInt` call on the integer-days field.

### Outputs

- `src/components/admin/ledger/ledger-settings-form.tsx` — `onChange` handler for `#holding-period-days` changed from `parseInt(e.target.value, 10)` to `Number(e.target.value)`.
- `pnpm exec tsc --noEmit` — clean, no errors.

### Open questions / handoff notes

- Bug 1 is fixed; Bug 2 (`src/lib/ledger-queries.ts`, `getOverview()` FY-scoped balance gate) is a separate, concurrent loop-back to tech-lead/api-developer per QA's report — not touched here.
- QA's regression-test discipline note (line 984 above) still applies: a permanent regression test for Bug 1 (submit `"1.5"`, assert inline error + no PATCH call) has not been added in this pass — my task scope was the handler fix, typecheck, and this work-log entry only. Recommend qa add it during Phase 5 re-verification, or flag back to ux-developer if a Playwright/RTL spec is wanted before that.
- Next agent: qa, once Bug 2's fix also lands, to re-run Phase 5 verification on both fixes together.

---

## Phase 3 — Revised Design (loop-back from Phase 5) — 2026-07-20

**Owner:** tech-lead
**Status:** complete

### Summary

QA's Bug 2 traced correctly to a design defect, not an implementation slip: the aged-public-fund balance-positive gate reused `fundSummaries[].endingCents`, which is scoped to whichever fiscal year is currently selected in `getOverview()`, while the oldest-income lookup (Query A) is genuinely cross-FY. A fund with a real, positive, aged balance whose only transactions fall outside the selected FY window reads as `endingCents = 0` and is silently excluded — exactly the "old money sitting untouched" case the guardrail exists to catch. This revision replaces the balance source with a true cross-FY figure computed with the *same balance semantics* the rest of the ledger already uses (`fund.openingBalanceCents + all-time posted income − all-time posted expense`, via the existing canonical `fundBalanceCents()` function — no second definition of "balance" is introduced), and extracts the gating logic into a new exported pure function, `countAgedPublicFunds()`, so it is unit-testable without a live DB. `GuardrailsInput` and `guardrails()` are unchanged — the fix is entirely upstream, in `getOverview()`'s aggregation layer. Logged as **DECISION-028** (corrects one sentence of DECISION-027's Ruling B; the rest of DECISION-027 stands).

### What I did

- Re-read Phase 3 (original), the Phase 4 API section, and QA's Phase 5 FAIL report (Bug 2) in full, including QA's own diagnosis and recommended fix direction.
- Read the current state of `getOverview()` in `src/lib/ledger-queries.ts` (lines 485–740) to confirm exactly how `fundSummaries[].endingCents` is computed: `fund.openingBalanceCents + incomeCents − expenseCents`, where `incomeCents`/`expenseCents` are reduced from `allTxns`, itself fetched with a hard FY bound (`gte(txnDate, start), lt(txnDate, end)`). Confirmed this is the same formula as the file-level canonical `fundBalanceCents(openingCents, postedTxns)` in `src/lib/ledger.ts` — but `getOverview()` currently reimplements the arithmetic by hand rather than calling that function.
- Read `src/lib/db/schema.ts`'s `ledgerFunds` table: confirmed `openingBalanceCents` is a **single static seed value on the fund row**, not a per-FY figure ("Placeholder opening balance — set actual value via admin UI under LEDGER_MANAGE"). This confirms the correct cross-FY balance is `openingBalanceCents + SUM(all-time posted income) − SUM(all-time posted expense)` — the same formula, just without the FY bound — and rules out needing any new "fund starting point per FY" concept.
- Read `fundBalanceCents()` and its existing unit tests (`describe("fundBalanceCents", ...)`, `src/lib/ledger.test.ts:28`) — confirmed it already accepts `Array<FlowRow>` (`{ flow, amountCents }`) and is exactly the semantics-safe function to reuse, rather than re-deriving `+`/`−` arithmetic a second time. Confirmed it is already imported into `ledger-queries.ts` (line 45) but never actually called there today — this fix is also the first real call site.
- Confirmed via `grep` that no test file in this repo exercises `getOverview()` (no DB-mocking test infra exists for `ledger-queries.ts`). This matches QA's own note that the aggregation layer "has no unit-level coverage" and explains why the bug reached a live click-through before being caught. Concluded the correct fix is not "invent DB-mock integration tests under loop-back pressure" but "extract the gate into a pure function with a real unit-test seam," consistent with how `guardrails()` itself is already tested.
- Confirmed the existing cross-FY oldest-income query (Query A) is untouched and already correct per QA's own isolation test (`&fy=2025` fires correctly) — the fix is additive (a new companion query + a new pure function), not a rewrite of Query A.

### Outputs

- `docs/decisions.md` — **DECISION-028** added (corrects DECISION-027's Ruling B balance-source detail; full rationale and impact there).
- `docs/work-log/2026-06-27-lions-fund-compliance.md` — this section, plus the Per-Phase Status table updated (Phase 3 → Complete, revised; Phase 4 → In progress; Phase 5 FAIL retained as history).
- No `src/` files touched — design only, per this loop-back's scope.

---

### Revised Design: cross-FY balance gate for the aged-public-fund guardrail

#### 1. `getOverview()` query change — new companion aggregate (Query A2)

Query A (oldest posted income date per public fund, no FY bound) is **unchanged** — it is already correct. Add a new companion query immediately after it, in `src/lib/ledger-queries.ts`, inside the existing `// inc7 guardrail inputs` block:

```ts
// inc7 (revised 2026-07-20, Bug 2 fix) — Query A2: cross-FY posted income/expense
// totals per public fund, no FY bound. Companion to Query A. Together they let us
// compute each public fund's TRUE life-to-date balance — NOT fs.endingCents, which
// is scoped to the currently-selected FY and was the root cause of QA's Bug 2
// (2026-07-20): a fund whose only transactions fall outside the selected FY window
// read as endingCents = 0 and was silently excluded from the aged-funds count even
// though it held a real, positive, aged balance. See DECISION-028.
const crossFyTotalsRows = publicFundIds.length > 0
  ? await db
      .select({
        fundId: ledgerTransactions.fundId,
        flow: ledgerTransactions.flow,
        totalCents: sql<string>`COALESCE(SUM(${ledgerTransactions.amountCents}), 0)`,
      })
      .from(ledgerTransactions)
      .where(
        and(
          inArray(ledgerTransactions.fundId, publicFundIds),
          eq(ledgerTransactions.status, "posted"),
          inArray(ledgerTransactions.flow, ["income", "expense"]),
        ),
      )
      .groupBy(ledgerTransactions.fundId, ledgerTransactions.flow)
  : [];

const incomeTotalByFundId = new Map<string, number>();
const expenseTotalByFundId = new Map<string, number>();
for (const row of crossFyTotalsRows) {
  const cents = Number(row.totalCents);
  if (row.flow === "income") incomeTotalByFundId.set(row.fundId, cents);
  else if (row.flow === "expense") expenseTotalByFundId.set(row.fundId, cents);
}
```

This is bounded to `publicFundIds` (same batch-fetch discipline as DECISION-027's Ruling A/B — not an unbounded scan) and adds exactly one DB round-trip, consistent with `getOverview()`'s existing pattern of a handful of bounded queries per call.

#### 2. TypeScript aggregation change — reuse `fundBalanceCents()`, don't re-derive arithmetic

Replace the old inline block:

```ts
const agedPublicFundsRaw = fundSummaries.filter((fs) => {
  if (!["activity", "charitable", "scholarship"].includes(fs.fund.kind)) return false;
  if (fs.endingCents <= 0) return false; // balance-positive filter (G-3)
  const oldestDateStr = oldestDateByFundId.get(fs.fund.id);
  if (!oldestDateStr) return false;
  const oldestDate = new Date(oldestDateStr);
  const ageDays = (today.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > settings.holdingPeriodWarnDays;
}).length;
```

with:

```ts
// inc7 (revised) — build cross-FY facts per public fund, using fundBalanceCents()
// (the same canonical balance function used elsewhere in the ledger) so this
// figure can never disagree with how a "balance" is defined anywhere else.
const agedPublicFundFacts = funds
  .filter((f) => publicFundIds.includes(f.id))
  .map((f) => ({
    fundKind: f.kind,
    crossFyBalanceCents: fundBalanceCents(f.openingBalanceCents, [
      { flow: "income", amountCents: incomeTotalByFundId.get(f.id) ?? 0 },
      { flow: "expense", amountCents: expenseTotalByFundId.get(f.id) ?? 0 },
    ]),
    oldestPostedIncomeDate: oldestDateByFundId.get(f.id) ?? null,
  }));

const agedPublicFundsRaw = countAgedPublicFunds(
  agedPublicFundFacts,
  settings.holdingPeriodWarnDays,
);
```

`fundBalanceCents` must be added to the existing `import { ... } from "@/lib/ledger"` block in `ledger-queries.ts` if not already present at call-site scope (it is already imported at line 45 today but unused — this is its first real call site). The unused-import lint warning this was presumably silencing goes away as a side effect.

#### 3. New pure function — `countAgedPublicFunds()` in `src/lib/ledger.ts`

Add near `guardrails()` (after `deriveAckType()`, before `guardrails()`), following the file's existing pure-function style (`fundBalanceCents`, `entityBalanceCents`, `grossReceiptsCents`):

```ts
// ---------------------------------------------------------------------------
// countAgedPublicFunds
// ---------------------------------------------------------------------------

export type AgedPublicFundFact = {
  fundKind: string;
  /** True life-to-date balance: openingBalanceCents + all-time posted income
   *  − all-time posted expense, with NO fiscal-year bound. Callers must NOT
   *  pass an FY-scoped balance here (see DECISION-028 / 2026-07-20 Bug 2). */
  crossFyBalanceCents: number;
  /** ISO date string ('YYYY-MM-DD') of the oldest posted income transaction
   *  for this fund across ALL fiscal years, or null if none exists. */
  oldestPostedIncomeDate: string | null;
};

/**
 * Counts public funds (kind ∈ 'activity' | 'charitable' | 'scholarship') that
 * have BOTH a positive cross-FY balance AND an oldest posted income
 * transaction older than `thresholdDays` relative to `now`.
 *
 * Pure function — no DB access — so the FY-scoping class of bug (DECISION-028)
 * has a real unit-test seam independent of getOverview()'s FY-windowed fetch.
 * Callers filter or don't filter to public-fund-kind facts before calling this;
 * the kind check here is defensive, not load-bearing, for whichever they choose.
 *
 * @param funds         Cross-FY per-fund facts (see AgedPublicFundFact).
 * @param thresholdDays settings.holdingPeriodWarnDays.
 * @param now           Injectable "now" for deterministic tests; defaults to `new Date()`.
 */
export function countAgedPublicFunds(
  funds: Array<AgedPublicFundFact>,
  thresholdDays: number,
  now: Date = new Date(),
): number {
  return funds.filter((f) => {
    if (!["activity", "charitable", "scholarship"].includes(f.fundKind)) return false;
    if (f.crossFyBalanceCents <= 0) return false;
    if (!f.oldestPostedIncomeDate) return false;
    const ageDays =
      (now.getTime() - new Date(f.oldestPostedIncomeDate).getTime()) / (1000 * 60 * 60 * 24);
    return ageDays > thresholdDays;
  }).length;
}
```

#### 4. `GuardrailsInput` / `guardrails()` — no change

`guardrails()`'s signature, the `agedPublicFunds: number` field, and its 5 existing unit tests (`describe("guardrails — aged public-fund balances (inc7)", ...)`) are **unchanged**. The defect and its fix are entirely upstream of `guardrails()` — it still receives a correctly-computed flat count. Do not touch `ledger.test.ts`'s existing Enhancement-1 `guardrails()` tests as part of this fix.

#### 5. Named unit tests the api-developer must deliver

All new tests go in `src/lib/ledger.test.ts` in a new `describe("countAgedPublicFunds", ...)` block, placed near the existing `describe("fundBalanceCents", ...)` block (both are DB-independent pure-function tests). These are in addition to — not replacing — the existing 5 `guardrails()` Enhancement-1 tests, which stay as-is.

1. `"returns 0 for an empty funds array"`
2. `"excludes a public fund with no oldestPostedIncomeDate (null) even when crossFyBalanceCents is positive"` — no income ever recorded; must not fire.
3. `"excludes a public fund whose oldestPostedIncomeDate is younger than thresholdDays"`
4. `"excludes a public fund whose crossFyBalanceCents is <= 0 even though its oldestPostedIncomeDate is old"` — the legitimate spent-down-fund case (G-3's original intent, now correctly gated on the cross-FY figure instead of the FY-scoped one).
5. `"counts a public fund whose crossFyBalanceCents is positive AND oldestPostedIncomeDate is older than thresholdDays"`
6. `"excludes an administrative-kind fund even when balance/date conditions are met"` — kind filter is load-bearing.
7. **Bug 2 regression — required:** `"counts a fund as aged using its cross-FY balance even when that balance would read $0 under an FY-scoped view (regression: QA Bug 2, 2026-07-20)"` — fixture: `crossFyBalanceCents: 50000` (matching QA's exact $500 repro figure), `oldestPostedIncomeDate` dated 49+ days before a fixed `now` with `thresholdDays: 30` (matching QA's exact repro numbers: Charitable Fund, $500, 49+ days aged, 30-day threshold). Assert `countAgedPublicFunds([...], 30, now) === 1`. The test's docstring/comment must state explicitly that this fixture represents a fund whose *old, buggy* FY-scoped `fundSummaries[].endingCents` would have been `0` (all transactions in a prior FY) — the point of the test is that `countAgedPublicFunds()` has no way to receive or be fooled by that FY-scoped figure, because its input contract only accepts a cross-FY fact.
8. `"counts multiple qualifying funds and returns their total as an integer"` — mixed fixture: 2 qualifying, 1 excluded by kind, 1 excluded by balance; assert count is exactly `2`.
9. `"boundary: ageDays exactly equal to thresholdDays does not fire; one day over does"` — exercises the `>` (strict) comparison at the boundary, using the injectable `now` parameter for determinism.

No DB-mocking integration test for `getOverview()` itself is required for this loop-back — no such test infrastructure exists anywhere in this codebase today (confirmed by search), and inventing one under loop-back pressure is out of proportion to this bug. The pure-function extraction is the fix for the coverage gap; end-to-end confirmation that `getOverview()` wires the new query and fact-building correctly is qa's job in Phase 5 re-verification (repeat QA's own Bug 2 click-through: Foundation entity, Charitable Fund, $500 posted income dated in a prior FY, `holdingPeriodWarnDays` lowered below the age, viewed with **no** `&fy=` param — the WARN must now fire on the default/current-FY view, not just under `&fy=2025`).

#### 6. Edge cases (updated from original design)

- **Spent-down fund (legitimate non-fire):** unchanged in spirit from the original G-3 note, but now correctly evaluated against the cross-FY figure — a fund that received $5,000 two years ago and has since spent all of it nets to `crossFyBalanceCents <= 0` across all time, not just within one FY window, so it still correctly does not fire.
- **Fund with aged income entirely outside the selected FY (the bug):** now correctly fires, because `crossFyBalanceCents` no longer depends on which FY is selected.
- **Zero-transaction public fund:** `incomeTotalByFundId`/`expenseTotalByFundId` both default to `0` via `?? 0`; `fundBalanceCents(f.openingBalanceCents, [{income:0},{expense:0}])` reduces to `f.openingBalanceCents`. If that's `0` and no income row exists, `oldestPostedIncomeDate` is `null` and the fund is excluded regardless. Safe.
- **Negative opening balance with no income:** still excluded by the `oldestPostedIncomeDate === null` check regardless of the balance sign.
- **New Query A2 empty-array guard:** guarded by `publicFundIds.length > 0`, same as Query A and Query B — the DB is never called with an empty `inArray`.

#### 7. Out of scope (confirmed, unchanged from original design plus one addition)

- The negative-fund-balance check (Check 6) and the reserves-threshold check (Check 4) continue to use `fundSummaries[].endingCents` (FY-scoped) deliberately — those checks are legitimately about the currently-selected FY's position, not a life-to-date figure, and are not part of this bug or this fix.
- No change to Query A, Query B, `adminPublicIncomeCount`, or the Enhancement 2/3 code paths — Bug 2 is isolated to Enhancement 1's balance gate only.
- Not mandating a refactor of the FY-scoped `fundSummaries` computation (which still hand-rolls `opening + income − expense` instead of calling `fundBalanceCents()`) to also use the canonical function — that's a reasonable follow-up cleanup, not required to fix this bug, and out of scope for this loop-back.
- Not building general DB-mocking integration-test infrastructure for `ledger-queries.ts` as part of this fix (see §5) — flagged instead as a candidate for qa's next 7-day test-coverage review, since `getOverview()` remains untested at the query-wiring level after this fix, same as before.

### Open questions / handoff notes

- **Next agent: api-developer.** Implement exactly the design in this section: Query A2 in `getOverview()`, the `fundBalanceCents()`-based fact-building, the new `countAgedPublicFunds()` export in `ledger.ts`, and all 9 named unit tests in `ledger.test.ts`. `GuardrailsInput`/`guardrails()` need no changes — do not touch them beyond what's already shipped.
- After api-developer's fix lands, hand back to **qa** for Phase 5 re-verification of **both** bugs together (Bug 1 already fixed by ux-developer, above) — repeat the exact click-through QA used to find Bug 2 (Foundation entity, Charitable Fund, $500 aged income, lowered threshold, default/current-FY view with no `&fy=` param) and confirm the WARN now fires without needing `&fy=2025`.
- Do not re-run Phase 6 (analyst) until qa issues a fresh PASS covering both bugs.

---

## Phase 4 — Bug-2 fix (API, loop-back) — 2026-07-20

**Owner:** api-developer
**Status:** complete

### Summary

Implemented the revised Phase 3 design (DECISION-028) exactly. The aged-public-fund balance-positive gate no longer reads `fundSummaries[].endingCents` (which is bound to whichever FY window `getOverview()` was called with). It now uses a genuinely cross-FY life-to-date balance built from a new companion aggregate query (Query A2) and the existing canonical `fundBalanceCents()` function, and the gating decision itself was extracted into a new exported pure function, `countAgedPublicFunds()`, in `src/lib/ledger.ts`. `GuardrailsInput` and `guardrails()` are untouched, as the design specified — the fix is entirely upstream in `getOverview()`'s aggregation layer. All 9 named unit tests are written and passing; typecheck is clean; the full suite is 313/313 (304 pre-existing + 9 new).

### Root cause (restated for the record)

`getOverview()`'s Query A (`MIN(txn_date)` per public fund, no FY bound) was always correct. But the balance-positive filter next to it reused `fs.endingCents` from `fundSummaries`, which `getOverview()` computes from `allTxns` — a query hard-bound to `[start, end)` of the *currently selected* fiscal year. A public fund whose only transactions fall in a prior FY (e.g., a Charitable Fund with $500 posted income dated in FY2025, viewed under the FY2026 default) reads `endingCents = 0` under that FY window and was silently excluded from the aged-funds count, even though the fund genuinely held $500 of aged, undisbursed public money. This is the exact scenario QA reproduced live.

### What I did

- Added `countAgedPublicFunds()` (and its `AgedPublicFundFact` input type) to `src/lib/ledger.ts`, placed immediately before `GuardrailsInput`/`guardrails()`, following the file's existing pure-function JSDoc style (`fundBalanceCents`, `entityBalanceCents`). Takes an array of per-fund cross-FY facts (`fundKind`, `crossFyBalanceCents`, `oldestPostedIncomeDate`), a threshold, and an injectable `now` (defaults to `new Date()`), and returns the count. No DB access — pure and directly unit-testable.
- In `src/lib/ledger-queries.ts`'s `getOverview()`:
  - Added Query A2 immediately after (unchanged) Query A: `SELECT fund_id, flow, SUM(amount_cents) FROM ledger_transactions WHERE fund_id IN (<publicFundIds>) AND status='posted' AND flow IN ('income','expense') GROUP BY fund_id, flow` — no FY bound, bounded to `publicFundIds` (same batch-fetch discipline as DECISION-027), guarded by `publicFundIds.length > 0` before executing.
  - Built `incomeTotalByFundId`/`expenseTotalByFundId` maps from Query A2's rows.
  - Replaced the old inline `fundSummaries.filter(...)` block with: build `agedPublicFundFacts` (one entry per public fund) using `fundBalanceCents(fund.openingBalanceCents, [syntheticIncomeRow, syntheticExpenseRow])` for `crossFyBalanceCents` and `oldestDateByFundId.get(fund.id) ?? null` for `oldestPostedIncomeDate`; then call `countAgedPublicFunds(agedPublicFundFacts, settings.holdingPeriodWarnDays)` to produce `agedPublicFundsRaw`.
  - Removed the now-unused `const today = new Date();` (its only call site was the deleted inline filter).
  - Added `countAgedPublicFunds` and `type AgedPublicFundFact` to the existing `@/lib/ledger` import block.
  - Updated the `// inc7 guardrail inputs` comment block to reference DECISION-028 alongside DECISION-027, and reworded Query A's comment since the balance-positive logic now lives in Query A2 + `countAgedPublicFunds()`, not inline next to Query A.
  - Query B (`adminPublicIncomeCount`), the PATCH settings route, and Enhancement 2/3 code paths were **not touched** — out of scope per the design (Bug 2 is isolated to Enhancement 1's balance gate).
- Added all 9 named unit tests to `src/lib/ledger.test.ts` in a new `describe("countAgedPublicFunds", ...)` block, placed directly after `describe("entityBalanceCents", ...)` and before `describe("grossReceiptsCents", ...)` (both are DB-independent pure-function blocks, per the design's placement instruction). Added `countAgedPublicFunds` and `type AgedPublicFundFact` to the test file's import block. Did **not** touch the existing 5 `guardrails — aged public-fund balances (inc7)` tests or `cleanState` — per the design, `guardrails()`'s contract is unchanged.
- Ran `pnpm exec tsc --noEmit` — clean, no errors.
- Ran `pnpm test` — 313/313 passing (304 pre-existing + 9 new). Confirmed by name via `vitest run --reporter=verbose` that all 9 new tests execute under the `countAgedPublicFunds` describe block, and that the 5 pre-existing `guardrails — aged public-fund balances (inc7)` tests, the 4 other inc7 `guardrails()` describe blocks, and the full pre-existing suite are unaffected.

### Outputs

- `src/lib/ledger.ts` — new exported `countAgedPublicFunds()` function + `AgedPublicFundFact` type, placed before `GuardrailsInput`. No change to `GuardrailsInput`, `guardrails()`, or any existing test in this file.
- `src/lib/ledger-queries.ts` — new Query A2 (cross-FY `SUM(amountCents)` by `fund_id, flow`, bounded to `publicFundIds`, posted-only, no FY bound) added to `getOverview()`; `agedPublicFundsRaw` now computed via `countAgedPublicFunds()` fed by `fundBalanceCents()`-derived per-fund cross-FY facts, instead of the old inline `fs.endingCents` filter; `fundBalanceCents` import (already present but previously unused in this file) now has its first real call site; `countAgedPublicFunds`/`AgedPublicFundFact` added to the `@/lib/ledger` import block. No change to Query B, the `guardrails()` call's field list, or any other section of `getOverview()`.
- `src/lib/ledger.test.ts` — new `describe("countAgedPublicFunds", ...)` block with 9 named tests (including the Bug 2 regression test using QA's exact repro figures: $500 balance, 49+ days aged income, 30-day threshold); import block extended with `countAgedPublicFunds`/`AgedPublicFundFact`.
- No schema change. No migration. `src/components/` untouched (Bug 1 already fixed by ux-developer).

### Test names and pass count

`pnpm exec tsc --noEmit`: **PASS** (clean, no errors)
`pnpm test`: **313/313 passing** (304 pre-existing + 9 new; 0 failures)

New tests added — `describe("countAgedPublicFunds", ...)` in `src/lib/ledger.test.ts`:
1. "returns 0 for an empty funds array"
2. "excludes a public fund with no oldestPostedIncomeDate (null) even when crossFyBalanceCents is positive"
3. "excludes a public fund whose oldestPostedIncomeDate is younger than thresholdDays"
4. "excludes a public fund whose crossFyBalanceCents is <= 0 even though its oldestPostedIncomeDate is old"
5. "counts a public fund whose crossFyBalanceCents is positive AND oldestPostedIncomeDate is older than thresholdDays"
6. "excludes an administrative-kind fund even when balance/date conditions are met"
7. "counts a fund as aged using its cross-FY balance even when that balance would read $0 under an FY-scoped view (regression: QA Bug 2, 2026-07-20)" — reproduces QA's exact scenario: `crossFyBalanceCents: 50_000` ($500), `oldestPostedIncomeDate` 49 days before a fixed `now`, `thresholdDays: 30`.
8. "counts multiple qualifying funds and returns their total as an integer"
9. "boundary: ageDays exactly equal to thresholdDays does not fire; one day over does"

All 5 pre-existing `guardrails — aged public-fund balances (inc7)` tests, and the rest of the pre-existing 304-test suite, remain unmodified and passing.

### Open questions / handoff notes

**Next agent: qa**

- Phase 5 re-verification should cover **both** bugs together (Bug 1 fixed by ux-developer earlier on 2026-07-20; Bug 2 fixed here). Repeat the exact click-through QA used to find Bug 2: Foundation entity, Charitable Fund with $500 posted income dated in a prior FY, `holdingPeriodWarnDays` lowered below the age, viewed on the **default/current-FY view with no `&fy=` param**. The WARN must now fire without needing `&fy=2025`. Also re-confirm the `&fy=2025` path still fires (it always worked; should be unaffected) and that a genuinely spent-down fund (aged income, but fully disbursed across all time) still does **not** fire, now gated on the cross-FY figure rather than the old FY-scoped one.
- No DB-mocking integration test for `getOverview()` itself was added, per the design's explicit scope note (§5): no such test infrastructure exists anywhere in this codebase, and the pure-function extraction is the intended fix for the coverage gap. `getOverview()` remains untested at the query-wiring level — flagged by the Phase 3 revision as a candidate for qa's next 7-day test-coverage review, not something added under this loop-back.
- Bug 1 (decimal input truncation in `ledger-settings-form.tsx`) was already fixed by ux-developer in the prior work-log section — not re-touched here.
- Once qa issues a fresh PASS covering both bugs, hand to **analyst** for Phase 6 (shipped-vs-intent).

---

## Phase 5 — Re-verification (qa) — 2026-07-20

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** Both loop-back bugs are confirmed fixed by live re-verification, not just by reading the diffs. Typecheck, all 313 unit tests (304 pre-existing + 9 new `countAgedPublicFunds` tests, including the required Bug-2 regression test), and the production build all pass clean. The critical live re-check reproduced the original FAIL scenario exactly — Foundation entity, Charitable Fund with $500 of posted income dated in a prior FY (FY2025: 2026-06-01/2026-06-10), `holdingPeriodWarnDays` lowered to 30, loaded with **no `&fy=` param** (the default/current-FY view, FY2026) — and the aged-public-fund WARN now fires. It also still fires under the explicit `&fy=2025` path, and a synthetic fully-disbursed public fund (aged $200 income fully offset by a $200 expense, net cross-FY balance $0) correctly does **not** fire, confirmed by the flag's own count text reading "1 public fund has a positive balance" (i.e., only the genuinely aged Charitable Fund, not the disbursed Scholarship Fund). Bug 1 (decimal truncation on the Settings form) is confirmed fixed: `1.5`, `0`, and an empty field all now show the inline "whole number of days" error and block submit; a valid integer (`400`) saves and survives a reload. All test data and settings were restored to their prior state (`holdingPeriodWarnDays` back to 365, synthetic Scholarship Fund transactions deleted). The pre-existing font-CSP console noise on `/admin/ledger` was confirmed unrelated to this feature by reproducing the identical noise on an unrelated page (`/members`).

### What I did

**1. Read in full** the prior Phase 5 FAIL report (exact repro steps, root-cause diagnosis for both bugs), the Phase 3 Revised Design (DECISION-028, `countAgedPublicFunds()`, Query A2), the Phase 4 Bug-1 fix (ux-developer, `parseInt` → `Number`), and the Phase 4 Bug-2 fix (api-developer, cross-FY balance gate + pure-function extraction).

**2. Static gates (all pass):**
- `pnpm exec tsc --noEmit` — clean, no output, exit 0.
- `pnpm test` — **313/313 passing.** Confirmed by direct grep that `describe("countAgedPublicFunds", ...)` exists (`src/lib/ledger.test.ts:176`) and that the required Bug-2 regression test is present and correctly named: `"counts a fund as aged using its cross-FY balance even when that balance would read $0 under an FY-scoped view (regression: QA Bug 2, 2026-07-20)"` (`src/lib/ledger.test.ts:243`).
- `pnpm build:only` — `✓ Compiled successfully in 6.9s`, exit 0, full route table printed, no errors/warnings in build output (checked with a grep for `error|fail|warn`).
- Migration re-check: `\d ledger_settings` in psql confirms `holding_period_warn_days integer NOT NULL DEFAULT 365` is live in the local Neon DB; starting `pnpm dev` re-ran all migrations and emitted the expected idempotent NOTICE (42701, "column already exists, skipping") for `0052_ledger_compliance_guardrails.sql`.

**3. Live re-verification setup.** Inspected the local DB directly via psql rather than assuming fixture state:
- Confirmed `ledger_settings.holding_period_warn_days = 365` (untouched baseline) before starting.
- Found the Charitable Fund (`Westerville Lions Foundation` entity) already had 3 posted income rows totaling $500, dated `2026-06-01` and `2026-06-10` — this is FY2025 (Jul 2025–Jun 2026) under a Jul–Jun fiscal-year convention, while "today" in this environment is `2026-07-20` (FY2026). This is the exact scenario from the original FAIL report, already present in the DB from the prior QA session — reused it rather than fabricating new data, to match the original repro as closely as possible.
- The Scholarship Fund and Activity Fund had zero transactions, so I inserted a synthetic pair into the Scholarship Fund (a public fund) to construct the "fully disbursed" condition: `income` $200 on `2026-06-01`, `expense` $200 on `2026-06-15`, both `posted` — aged (49+ days) but net-zero cross-FY balance. This directly tests condition (b) of the task: aged income + zero cross-FY balance must NOT fire.
- Set `ledger_settings.holding_period_warn_days = 30` (below the ~49-day age of the existing income) via direct SQL.
- Started `pnpm dev` in the background; confirmed `Ready in 226ms` and the expected idempotent migration NOTICE.

**4. Live click-through** via temporary Playwright specs (`e2e/qa-reverify-ledger-guardrails.spec.ts` and `e2e/qa-reverify-ledger-settings-form.spec.ts`), run once via `pnpm exec dotenv -e .env.local -- playwright test ...` (the `test:e2e` script's env-loading prefix — a bare `pnpm exec playwright test` does not pick up `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`, which cost one failed run before I switched to the correct invocation), then deleted — not left in the repo, consistent with the prior QA session's practice, since some assertions target scenario-specific synthetic data that isn't part of the permanent fixture set.
  - `GET /admin/ledger?entity=foundation` (**no `&fy=` param** — the default/current-FY view): body text contains `"holding undisbursed balance"` → **WARN PRESENT.** This is the exact scenario that failed in the original Phase 5 report. **Now fires correctly.**
  - `GET /admin/ledger?entity=foundation&fy=2025`: **WARN PRESENT** — confirms the explicit-FY path, which always worked, is unaffected by the fix.
  - `GET /admin/ledger?entity=foundation` (default view) — flag detail text read verbatim: **"1 public fund has a positive balance"** — confirms exactly one fund (the genuinely-aged Charitable Fund) is counted, and the synthetic fully-disbursed Scholarship Fund (aged income, net-zero cross-FY balance) is correctly excluded. This directly verifies condition (b) from the task.
  - `GET /admin/ledger` (Club entity, default state): no non-CSP console errors; page renders. Confirmed the one console-error signal present (`fonts.googleapis.com` stylesheet blocked by CSP `style-src`) is **pre-existing and unrelated to this feature** by reproducing the identical error text on an unrelated page (`/members`) with no ledger code in its render path.
  - `/admin/ledger/settings`: entering `1.5` and submitting shows the inline `"Enter a whole number of days greater than 0."` error and blocks submit — **Bug 1 confirmed fixed.** Entering `0` and entering an empty string both also show the same error and block submit. Entering `400` and submitting persists across a full page reload (`input.inputValue()` reads back `"400"`); then restored to `365`, reloaded again, confirmed `"365"` reads back.

**5. Cleanup (verified, not assumed):**
- Deleted the two synthetic Scholarship Fund transactions (`DELETE FROM ledger_transactions WHERE memo = 'QA TEMP - fully disbursed scenario'` — 2 rows removed, confirmed by `RETURNING`) and confirmed the fund has zero transactions again.
- Confirmed `ledger_settings.holding_period_warn_days = 365` via a direct read-back query (the settings-form test's own final "restore to 365" step already drove this through the real UI/PATCH path, so the direct-SQL setup change and the UI-driven restoration both converged on the same value).
- Deleted both temporary Playwright spec files (`e2e/qa-reverify-ledger-guardrails.spec.ts`, `e2e/qa-reverify-ledger-settings-form.spec.ts`) and the Playwright `test-results`/`playwright-report` output directories.
- Killed the `pnpm dev` process started for this verification; confirmed port 3000 is free.
- `git status --short` after cleanup shows only the feature's own tracked/untracked changes — no stray QA artifacts left in the working tree.

### Outputs

- No permanent source files modified by this re-verification pass — confirmed fixes only, per the loop-back's scope (the implementers already delivered the fixes and their permanent unit tests in the prior Phase 4 sections).
- `docs/work-log/2026-06-27-lions-fund-compliance.md` — this section, plus the Per-Phase Status table (Phase 5 → PASS, Phase 6 → Ready).
- Temporary artifacts created and removed during this session (not present in the final tree): `e2e/qa-reverify-ledger-guardrails.spec.ts`, `e2e/qa-reverify-ledger-settings-form.spec.ts`, two synthetic `ledger_transactions` rows in the local Neon DB (Scholarship Fund).

### Type Check
`pnpm exec tsc --noEmit`: **PASS**

### Unit Tests
`pnpm test`: **PASS**
Total: 313 | Passed: 313 | Failed: 0
Duration: ~254ms
Failures: none
Confirmed present: `describe("countAgedPublicFunds", ...)` (9 tests) including the mandatory regression test `"counts a fund as aged using its cross-FY balance even when that balance would read $0 under an FY-scoped view (regression: QA Bug 2, 2026-07-20)"`.

### Production Build
`pnpm build:only`: **PASS**
Notes: `✓ Compiled successfully in 6.9s`. Full route table printed; no new routes added by this feature. No errors or warnings in build output.

### End-to-End Tests
`pnpm test:e2e`: **Not run as the standing suite** — no ledger-specific spec exists yet in `e2e/` (flagged again below as a coverage gap). Two temporary specs were written, run, and deleted for this re-verification (see "What I did" §4).

### Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| Bug 2: aged-funds WARN fires on **default view** (no `&fy=`), Foundation entity, Charitable Fund, $500 aged income (FY2025), threshold 30 | **pass** | Exact repro of original FAIL. Body text contains "holding undisbursed balance". This is the headline fix. |
| Bug 2: aged-funds WARN still fires under `&fy=2025` | pass | Confirms the always-correct path is unaffected. |
| Bug 2: fully-disbursed public fund (aged $200 income, $200 expense, net $0 cross-FY balance) does NOT inflate the count | pass | Flag detail reads "1 public fund has a positive balance" — only the genuinely aged Charitable Fund counted; synthetic Scholarship Fund correctly excluded. |
| `/admin/ledger` (Club entity, default state) renders with no non-CSP console errors | pass | One console signal present (Google Fonts stylesheet CSP block) confirmed pre-existing/site-wide via baseline check on `/members`. |
| Bug 1: `holdingPeriodWarnDays = 1.5` → inline error, submit blocked | **pass** | "Enter a whole number of days greater than 0." shown; no silent truncation. |
| Bug 1: `holdingPeriodWarnDays = 0` → inline error, submit blocked | pass | — |
| Bug 1: `holdingPeriodWarnDays = ""` (empty) → inline error, submit blocked | pass | — |
| Bug 1: `holdingPeriodWarnDays = 400` → saves, persists after reload | pass | `input.inputValue()` reads back "400" after a full page reload. |
| Restore `holdingPeriodWarnDays` to 365, confirm persisted | pass | Read back as "365" after reload, driven through the real UI/PATCH path. |
| Migration idempotency (`0052_ledger_compliance_guardrails.sql`) | pass | NOTICE 42701 on `pnpm dev` startup, consistent with prior sessions. |

### Regression Tests Added

None added by qa in this pass — both required regression tests were already delivered by the implementers per this project's discipline (failing-then-passing owned by the fixer, not qa):
- Bug 1: no permanent Playwright/RTL regression test exists yet for the decimal-truncation UI bug specifically (the ux-developer's Bug-1 fix section flagged this as a nomination for qa to add during re-verification, but the temporary spec used here is scenario-specific to this session's synthetic data conventions, not a durable fixture-independent spec — see Open Questions below).
- Bug 2: `"counts a fund as aged using its cross-FY balance even when that balance would read $0 under an FY-scoped view (regression: QA Bug 2, 2026-07-20)"` — `src/lib/ledger.test.ts:243` — guards against: the aged-public-fund gate silently reading an FY-scoped balance (`fundSummaries[].endingCents`) instead of a true cross-FY balance, which caused the WARN to never fire for funds with aged income entirely outside the currently-selected fiscal year. Confirmed present and passing as part of the 313/313 suite.

### Coverage on Critical Modules

- `src/lib/ledger.ts`: the new `countAgedPublicFunds()` pure function has full branch coverage via its 9 dedicated unit tests (empty array, null date, too-young date, non-positive balance, qualifying case, kind filter, the Bug-2 regression fixture, multi-fund count, and the exact-boundary case). `guardrails()`'s inc7 checks retain their 11 pre-existing tests, unchanged by this loop-back.
- `src/lib/ledger-queries.ts`: `getOverview()`'s new Query A2 (cross-FY income/expense totals) and its wiring into `countAgedPublicFunds()` remain **DB-bound with no unit-level coverage** — same gap noted in the original FAIL report and explicitly acknowledged as out of scope for this loop-back (Phase 3 Revised Design §7: "Not building general DB-mocking integration-test infrastructure ... flagged instead as a candidate for qa's next 7-day test-coverage review"). This pass's live click-through is the only coverage this query wiring has; it passed under all three tested conditions (default view, explicit FY, fully-disbursed fund), but a code or future refactor to `getOverview()` could silently regress this again without a DB-mocked test catching it. Nominating this for the next 7-day test-coverage review, as the prior design doc already flagged.
- `src/lib/permissions.ts`: unchanged by this feature; not touched, not re-measured.
- `src/lib/members.ts`: unchanged by this feature; not touched, not re-measured.

### Feature-Gate Audit (mandatory before PASS)

Re-confirmed by reading the route file directly (not inferred from tests) since this loop-back touched aggregation logic upstream of the gated routes:

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|------------------------------|----------------------------|
| `PATCH /api/admin/ledger/settings` | yes | yes | `FEATURES.LEDGER_MANAGE` — correct (mutation endpoint). Server-side validation (`typeof v !== "number" \|\| !Number.isInteger(v) \|\| v <= 0` → 400) independently rejects `1.5` regardless of the client-side fix — confirmed by reading `src/app/api/admin/ledger/settings/route.ts` lines 105–114. |
| `/admin/ledger/settings` (page) | yes | yes | `FEATURES.LEDGER_MANAGE` — correct (edit surface), unchanged by this loop-back. |
| `/admin/ledger` (page — renders the new guardrail flags, now backed by the corrected cross-FY aggregation) | yes | yes (`hasAnyFeature` incl. `LEDGER_VIEW`) | `FEATURES.LEDGER_VIEW` (or `LEDGER_RECORD`/`LEDGER_MANAGE`) — correct; no new PII exposed by the corrected balance figure — it is the same fund-level balance concept, just computed correctly across FYs instead of incorrectly within one. |

No new route or server action was introduced by either bug fix. No gate regressions found.

### Verdict: PASS

Both defects from the prior FAIL are confirmed fixed by live reproduction of the exact original failing scenario, not just by code inspection:
1. **Bug 1** — decimal input now correctly rejected client-side with the promised inline error; server-side validation was already correct and remains an independent backstop.
2. **Bug 2** — the aged-public-fund WARN now fires under the default/current-FY view (the realistic, unguarded path a treasurer will actually hit) using a genuinely cross-FY balance figure, while continuing to fire under an explicit prior-FY view and correctly staying silent for a fund that is aged but truly spent down.

Typecheck, all 313 unit tests, and the production build are clean. The migration remains idempotent. All settings and test data touched during this verification were restored to their prior state.

### Open questions / handoff notes

- **Next agent: analyst**, for Phase 6 (shipped-vs-intent). This feature is ready to close the pipeline pending that review.
- **Nominate for the next 7-day test-coverage review (qa, self-flagged):** `getOverview()`'s Query A2 / cross-FY aggregation wiring has no DB-mocked unit or integration coverage — it is currently protected only by manual/scripted click-through (this session's and the original FAIL session's). This is the second time in this feature's history that a bug specifically in `getOverview()`'s query-to-guardrail wiring reached only a live click-through before being caught. Worth a real look at introducing DB-mocking test infrastructure for `ledger-queries.ts`, not just deferring it feature-by-feature.
- **Nominate for a future small follow-up (not blocking Phase 6):** a permanent, fixture-independent Playwright regression test for Bug 1 (submit a non-integer string on `/admin/ledger/settings`, assert the inline error and that no PATCH request fires) does not exist in the permanent `e2e/` suite yet. The temporary spec used in this session is a reasonable starting point but was written against this session's specific synthetic-data setup for Bug 2 and isn't a clean drop-in.
- `pnpm lint` status is unchanged from the prior Phase 5 report (partially remediated `@eslint/eslintrc` fix already landed in `package.json`; the deeper `minimatch`/ESM-interop conflict with the intentional CVE-driven `minimatch: ^10` override is still unresolved and was not touched in this pass). Still nominated for **deployment-engineer**'s next 30-day dependency review, per the original note.

---

## Phase 6 — Shipped vs Intent (analyst) — 2026-07-20

**Owner:** analyst
**Status:** complete

### Summary

Re-read the full pipeline history (Phase 1 through the Phase 5 re-verification PASS) and independently spot-checked the shipped code against both the original Phase 1 intent and the loop-back-revised design. All three enhancements, the settings-field addition, and both bug fixes match what was promised — including the subtle case that mattered most: the aged-fund balance gate is now genuinely cross-FY (DECISION-028), which is what Phase 1's OQ-3 resolution and G-3 actually asked for ("time-anchored to today, not FY-scoped"), not a regression from it. No scope was silently added or dropped relative to the user's OQ-1–OQ-4 decisions. Two QA-nominated coverage gaps (no DB-level test on the Query A2 wiring; no permanent Playwright regression for the Bug-1 UI fix) are legitimate residual risk, not shipped-vs-intent defects — they were explicitly scoped out of the loop-back by the tech-lead's revised design (§7 "out of scope"), not overlooked. I'm converting both into tracked follow-ups rather than letting them evaporate as free-floating QA notes.

**Verdict: SHIP WITH NOTES**

**One-line take:** All three LCI compliance-gap guardrails shipped exactly as scoped, the one real design defect found in QA was traced to its root and fixed correctly (not papered over), and the residual risk is contained to test-infrastructure gaps that were consciously deferred rather than missed.

### What I did

**Verified each Phase 1 commitment against the live source, not just the work-log narrative:**

- `src/lib/ledger.ts` — confirmed `countAgedPublicFunds()` (line 364) and the two new `GuardrailsInput` fields (`agedPublicFunds` line 452, `adminPublicIncomeCount` line 462) exist exactly as the revised design specifies. Confirmed the Check-A WARN (`state.agedPublicFunds > 0`, line 647) and Check-B WARN (`state.adminPublicIncomeCount > 0`, line 663) are present with WARN severity per the user's OQ-2 decision (no HIGH-severity aging flag).
- `grep`'d every `policyCite` string in the file (13 total) — confirmed only two carry "Art. VII §3(g)": the firewall flag (line 586) and the new direct-to-admin flag (line 673). All other flags (negative-balance, reserves-threshold, IRC §6033(j), etc.) retain their original internal-policy-only cites, untouched — this is an exact match to the user's OQ-4 ruling ("§3(g) cite on the firewall flag AND the new direct-to-admin flag only... do not alter the negative-fund-balance or reserves-threshold cites").
- `src/lib/ledger-queries.ts` — confirmed Query A (cross-FY oldest income date, unchanged since the original design), Query A2 (cross-FY income/expense totals, added in the Bug-2 fix), and Query B (admin-fund category batch fetch) all exist and are wired as documented. Confirmed `fundBalanceCents()` — the same canonical balance function used elsewhere in the ledger — is the actual source of `crossFyBalanceCents`, not a second hand-rolled arithmetic path. This matters: it means the aged-fund gate can't quietly disagree with what "balance" means anywhere else in The Ledger.
- `src/lib/db/schema.ts` / `drizzle/migrations/0052_ledger_compliance_guardrails.sql` — confirmed `holdingPeriodWarnDays integer NOT NULL DEFAULT 365` on `ledgerSettings` and a single idempotent `ADD COLUMN IF NOT EXISTS` statement. Matches OQ-1's "configurable, defaulting to 365" decision exactly.
- `src/components/admin/ledger/ledger-settings-form.tsx` — confirmed the Bug-1 fix (`Number(e.target.value)` instead of `parseInt`) is live at the `#holding-period-days` `onChange` handler, and that the field's markup uses `rounded-lg` inputs consistent with the rest of the form (brand-consistency check — no `window.confirm`, no destructive action on this read/edit-only settings surface, so `<ConfirmDialog>` is correctly not invoked here).
- `src/app/api/admin/ledger/settings/route.ts` — confirmed server-side validation (`Number.isInteger(v) && v > 0`, 400 on invalid) independently backstops the client-side fix — a belt-and-suspenders check that matters because client-side validation alone is never sufficient.
- Ran `pnpm test` myself: **313/313 passing**, confirming the state QA reported in the Phase 5 re-verification is still the state of the repo at Phase 6 time (no drift between QA's PASS and this review).
- Checked `docs/decisions.md` — confirmed DECISION-027 (original cross-FY query + category-batch-fetch rulings) and DECISION-028 (the Bug-2 correction) are both logged, with DECISION-028 explicitly noted as correcting one sentence of DECISION-027 rather than silently overwriting it. Decision trail is intact and honest about what changed and why.

**Walked each Phase 1 flow/enhancement against what shipped:**

1. **Enhancement 1 (aged-fund WARN).** Phase 1 asked for: WARN severity, configurable `holdingPeriodWarnDays` (default 365), no earmark mechanism in v1, detail text pointing the treasurer to document earmarks in board minutes, and — per OQ-3 — a check "time-anchored to today, not FY-scoped." All five match. The QA loop-back on Bug 2 (the balance gate reading an FY-scoped `endingCents` instead of a true cross-FY balance) was in fact a violation of OQ-3, not of some new requirement — and the fix (DECISION-028's `countAgedPublicFunds()` + Query A2, gated on `fundBalanceCents()`-derived cross-FY totals) restores exactly the OQ-3 intent. Confirmed live by QA firing the WARN under the default/current-FY view with no `&fy=` param, and confirmed it stays silent for a synthetic fully-disbursed fund. No earmark model was added — matches OQ-2's "ship v1 without earmarks" decision, and the earmark follow-up remains correctly un-implemented and tracked as its own future work-log entry.
2. **Enhancement 2 (direct-to-admin public income WARN).** Shipped as designed: Option B (category `fundKind` mismatch), WARN severity, dues correctly excluded (confirmed by the dedicated "dues scenario" unit test), uncategorized (`categoryId IS NULL`) rows correctly excluded per G-4. Matches Phase 1 exactly.
3. **Enhancement 3 (§3(g) citation).** Copy-only change, applied to exactly the two flags OQ-4 specified, no other flag touched, no schema/behavior change. Matches exactly.
4. **Settings UI.** The holding-period field exists, is a plain integer (days, no `$`/cents conversion, correctly distinguished from the dollar-threshold fields), rejects `0`, rejects decimals (post-Bug-1-fix), rejects empty, and persists across reload. Matches the Phase 3 component plan and the user's OQ-1 decision.
5. **Scope discipline.** No earmark data model, no per-fund threshold override, no citation upgrade on the negative-balance/reserves flags, no UI change to the flag-card component — all four "out of scope" items from Phase 1 and the Phase 3 design remain out of scope in the shipped code. Nothing was silently added beyond what was designed (no extra flags, no extra settings fields, no extra routes).

### Outputs

- `docs/work-log/2026-06-27-lions-fund-compliance.md` — this Phase 6 section; Per-Phase Status table Phase 6 row updated to `Complete | SHIP WITH NOTES | 2026-07-20`.
- No code files touched — Phase 6 is review-only.
- Verified (not just read) via `pnpm test` (313/313 passing) and direct `grep`/`Read` of `src/lib/ledger.ts`, `src/lib/ledger-queries.ts`, `src/lib/db/schema.ts`, `drizzle/migrations/0052_ledger_compliance_guardrails.sql`, `src/components/admin/ledger/ledger-settings-form.tsx`, `src/app/api/admin/ledger/settings/route.ts`, and `docs/decisions.md`.

### Edge cases

- **Empty state (no funds/no transactions):** pass — both new queries are guarded by `publicFundIds.length > 0` / `adminIncomeCategoyIds.size > 0`; a fresh install produces `agedPublicFunds: 0` and `adminPublicIncomeCount: 0` with no spurious flags. Confirmed by design read and the "cleanState regression" unit test.
- **Failure microcopy:** not applicable — this is a read-only guardrail surface plus one settings PATCH; no new error/failure UI was introduced beyond the existing inline validation error, which reads as plain English ("Enter a whole number of days greater than 0."), not a stack trace.
- **Permission gate:** pass — QA's feature-gate audit (repeated in both the FAIL and PASS passes) confirmed `LEDGER_VIEW`/`hasAnyFeature` gates the overview page and `LEDGER_MANAGE` gates the settings page and PATCH route, with 401/307 confirmed live for unauthenticated requests. No new `FEATURES` key was needed or added, matching Phase 1's Pass 3 conclusion.
- **Mobile:** not independently re-verified at 360px in this Phase 6 pass — Phase 1 called this low-risk (reusing the existing full-width `rounded-2xl` flag-card pattern and a single new form field matching the existing dollar-field layout), and no agent in the pipeline flagged a mobile-specific defect. Treating as pass-by-inheritance rather than independently confirmed; noting the gap here rather than silently assuming it.
- **Brand consistency:** pass — `rounded-lg` on the new input and unchanged `rounded-2xl` flag cards; no `window.confirm`/`alert`/`prompt` introduced (none needed — no destructive action on this surface).

### Follow-ups (tracked — SHIP WITH NOTES)

1. **No DB-level unit/integration coverage for `getOverview()`'s Query A2 cross-FY wiring.** This is the second time in this feature's lifecycle that a real bug lived specifically in the query-to-guardrail wiring inside `getOverview()` and was only caught by a live manual click-through, not by any automated test. The pure-function extraction (`countAgedPublicFunds()`) fixed the *testability* of the gating logic, but the aggregation query itself (`ledger-queries.ts` Query A / Query A2, lines ~639–716) remains untested at the DB level. Action: raise this in the next 7-day test-coverage review (qa-owned) as a candidate for introducing DB-mocking or a lightweight integration-test harness for `ledger-queries.ts`, not deferred feature-by-feature again. Context for whoever picks this up: no DB-mocking infrastructure exists anywhere in this codebase today (confirmed by the tech-lead's Phase 3 revision search) — this would be a new investment, not a gap-fill in an existing pattern.
2. **No permanent Playwright regression test for the Bug-1 decimal-input UI fix.** `src/components/admin/ledger/ledger-settings-form.tsx`'s `#holding-period-days` field now correctly rejects non-integer input (`Number(e.target.value)` instead of `parseInt`), confirmed live by QA twice, but no fixture-independent spec was added to the permanent `e2e/` suite — only temporary specs written and deleted during QA sessions. Action: a small follow-up ticket to add one Playwright spec asserting: submit `"1.5"` on `/admin/ledger/settings` → inline error shown, no PATCH request fires (can assert via network interception or by re-checking the persisted value after reload). Low effort, closes a real (if narrow) regression-detection gap on a form field with a demonstrated history of a silent-truncation bug.
3. **(Pre-existing, not new — carried forward, not blocking) `pnpm lint` is still broken** on a `minimatch`/`@eslint/eslintrc` ESM-interop conflict rooted in the intentional 2026-05-27 CVE-driven `minimatch: ^10` override. QA partially remediated this (`@eslint/eslintrc` added as a direct devDependency) but the deeper conflict remains. Already nominated for deployment-engineer's next 30-day dependency review by QA in both Phase 5 passes; restating here only so it isn't lost between work-log entries. Not a defect of this feature — flagging for continuity.

None of these three block shipping: the functional guardrails work, were verified live against the exact failing scenario twice, and the coverage gaps were consciously and explicitly scoped out of the loop-back (not discovered late or hidden). They represent real residual risk worth tracking, which is exactly what SHIP WITH NOTES is for.

### Open questions / handoff notes

- Pipeline closed for this feature at SHIP WITH NOTES. No further phase work is required to ship.
- The three follow-ups above should each get their own lightweight tracking (a line in the next test-coverage review for #1 and #2; #3 already has a home in the dependency review). None warrants its own full six-phase work-log entry — they're small, well-scoped, and don't touch product intent.
- The earmark-support follow-up from OQ-2 (Phase 1) remains open and un-scheduled — it was deliberately deferred to "its own work-log entry later," and nothing in this pipeline run started that entry. Surfacing here so it isn't forgotten between now and whenever WARN-fatigue from clubs with legitimate multi-year projects makes it worth prioritizing.
