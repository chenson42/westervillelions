# Decisions Log

Architectural and implementation decisions for the Westerville Lions Club website. Newest first. Each decision is numbered; the number does not change once assigned.

## Format

Each decision uses this shape:

```markdown
## DECISION-NNN: [One-line title]

**Status:** Resolved | Superseded by DECISION-MMM | Under review
**Date:** YYYY-MM-DD

**Decision:** [What we decided.]

**Rationale:** [Why we decided it — the tradeoff named out loud.]

**Impact:** [What changes in the codebase as a result; any follow-ups.]

---
```

- **Architectural decisions** (new top-level directories, new npm dependencies, structural changes) are owned by the architect agent.
- **Implementation decisions** (data shape, API surface, where logic lives, library choice within already-approved deps) are owned by the tech-lead agent.

Both kinds live in this single file, newest first. Numbers are assigned in order and never reused.

---

## DECISION-032: Ledger Dashboard — implementation-level calls from Phase 3 design (error boundary, mobile table pattern, EntitySwitcher non-reuse, uncashed-checks flow scoping, fund-name guardrail widen)

**Status:** Resolved
**Date:** 2026-07-20

**Decision:**

Phase 3 technical design for the Ledger Dashboard (work-log: `docs/work-log/2026-07-20-ledger-dashboard.md`) resolved five implementation-level questions Phase 2 left open:

1. **Error boundary: inline `try/catch` in `page.tsx`, not `error.tsx`.** This codebase has zero existing `error.tsx` files; introducing one would be a first-of-its-kind Client Component boundary for a single page's static failure card, cutting against the Server-Component-by-default invariant for no interactivity gained (retry is a plain `<Link>` re-navigation). `try/catch` wraps each of the page's three DB-fetching phases individually, rendering a shared `LoadErrorCard()`. Correctness trap documented for the implementer: `redirect()` throws internally and must never sit inside one of these `try` blocks.
2. **Uncashed-checks list reuses the Approvals page's `overflow-x-auto` table pattern, not a stacked card list.** Confirmed by reading `src/app/(dashboard)/admin/ledger/approvals/page.tsx` (L111–113) — this is the established convention for tabular admin-ledger lists, already solving the same mobile-overflow problem Phase 1 Gap #5 raised. Matching it beats inventing a second, inconsistent pattern.
3. **`EntitySwitcher` is not reused for the dashboard's entity-card row.** It's a Client Component implementing a single-select tab toggle (`router.push`, one active entity); the dashboard needs always-show-both stat cards with no active/selected concept. A new Server Component (`dashboard-entity-card.tsx`) is cleaner than gutting `EntitySwitcher`'s interaction model and forcing an unneeded client boundary onto the dashboard. `EntitySwitcher` is unchanged and stays in use on the per-entity detail view.
4. **Uncashed-checks query scoped to `flow='expense'`, not just `paymentMethod='check'`.** "Uncashed checks" is a check-writer's-eye-view concept (checks the club wrote that a payee hasn't cashed); a `flow='income'` check-tagged row (an incoming check payment) is a different concept and would carry the wrong meaning if it ever appeared unreconciled in this list. The dev-DB spot-check found the one existing `check`/`income` row is already reconciled, so this doesn't change today's output — it's forward-looking correctness.
5. **Aged-public-fund guardrail detail text gains fund names via an additive, optional field**, not a breaking change to `AgedPublicFundFact`/`GuardrailsInput`. `fundName` is optional on `AgedPublicFundFact` (the 11 existing `countAgedPublicFunds` test literals don't set it and keep compiling); `agedPublicFundNames?: string[]` is a new optional `GuardrailsInput` field; a private `isAgedPublicFund()` predicate is shared between `countAgedPublicFunds()` and the new `agedPublicFundNames()` so the count and the name list can never disagree — same reuse discipline `fundBalanceCents()` established under DECISION-028/029.

**Rationale:**

Each of these follows the same underlying principle: match this codebase's own established precedent (Approvals table, `fundBalanceCents()` reuse, additive/optional field conventions already used throughout `GuardrailsInput`) rather than introduce a new pattern, even where introducing one wouldn't be wrong in isolation. The error-boundary and `EntitySwitcher` calls both protect the Server-Component-by-default invariant from a plausible but unnecessary client-boundary creep.

**Impact:**

- `src/lib/ledger.ts` — `AgedPublicFundFact.fundName?: string`, private `isAgedPublicFund()`, new `agedPublicFundNames()`, `GuardrailsInput.agedPublicFundNames?: string[]`, `guardrails()` detail-string change, new `daysSinceTxnDate()`.
- `src/lib/ledger-queries.ts` — `EntityOverview` widened (`syncStaleTxns`, `unreconciledPriorMonth`); new `getDashboard()` and its exported types (`DashboardData`, `DashboardEntitySummary`, `EntityTaggedGuardrailFlag`, `UncashedCheckRow`).
- `src/app/(dashboard)/admin/ledger/page.tsx` and four new files under `src/components/admin/ledger/` — see full component plan in the work-log.
- No schema change. No new `FEATURES` key.
- Full design: `docs/work-log/2026-07-20-ledger-dashboard.md`, Phase 3 — Technical Design.

---

## DECISION-031: Ledger Dashboard — same route (searchParams-keyed), new `getDashboard()` query function rather than widening `getOverview()`

**Status:** Resolved
**Date:** 2026-07-20

**Decision:**

Phase 2 architectural review for the Ledger Dashboard feature (work-log: `docs/work-log/2026-07-20-ledger-dashboard.md`). Two rulings:

**Ruling A — Route structure.** `/admin/ledger` stays a single `page.tsx`, keyed by `searchParams`: no `entity` param renders the new two-entity dashboard; `?entity=<slug>&fy=<year>` renders the existing per-entity detail view, unchanged. No new nested route (`/admin/ledger/[entitySlug]`). Every existing internal link in this surface (fund cards, reimbursements, reports, fund-report quick links) already passes `entity=`/`fy=` explicitly and needs zero changes. The admin sidebar's "Ledger" item already points at bare `/admin/ledger` — under this ruling it lands on the dashboard, exactly the desired top-of-nav UX, for free. `[fundSlug]` stays a genuinely nested route because a fund is a distinct sub-resource; dashboard-vs-detail is a view-mode toggle on the same resource, correctly modeled as a query param per Next.js App Router convention.

**Ruling B — Query-layer shape.** A new `getDashboard()` function in `src/lib/ledger-queries.ts`, not an extension of `EntityOverview`/`getOverview()`. `getOverview()` is single-entity and FY-scoped by contract; the dashboard needs a different shape (both entities' summaries, a cross-entity uncashed-checks list, cross-entity audit-item counts) that would break `EntityOverview`'s single-entity contract for every existing consumer if bolted on. `getDashboard()` composes two `getOverview()` calls (current FY per entity, in parallel via `Promise.all`, matching the page's existing batch-fetch style) plus one new cross-entity query for unreconciled check-method transactions. Separately, `EntityOverview` gets a minimal *additive* widen — `syncStaleTxns` and `unreconciledPriorMonth`, both already computed inside `getOverview()` but not returned (Phase 1 Gap #4) — since exposing already-computed per-entity fields is compatible with the existing contract, unlike making the function itself cross-entity.

**Rationale:**

`getOverview()` is already ~300 lines and has been the subject of two correctness bug fixes in the preceding 24 hours (DECISION-028, DECISION-029), both rooted in logic — guardrail inputs, cross-FY rollforward — accreting inline inside one DB-bound function with no unit-test seam. Adding a third responsibility (cross-entity dashboard aggregation) would repeat the exact anti-pattern DECISION-028's rationale named as the root cause. A dedicated `getDashboard()` keeps `getOverview()`'s single-entity contract stable, gives the new cross-entity aggregation its own seam, and follows the batch-fetch discipline established in DECISION-027 Ruling A (one new query, not N+1).

**Impact:**

- `src/lib/ledger-queries.ts` — new `getDashboard()` function; `EntityOverview` type widened with `syncStaleTxns: number` and `unreconciledPriorMonth: number`.
- `src/app/(dashboard)/admin/ledger/page.tsx` — branches on presence/validity of the `entity` searchParam; no new route file.
- No schema change. Structured `checkNumber` column (Phase 1 Gap #1) stays explicitly out of scope for this feature — a `treasurer-todo.md` follow-up item, not a migration riding along with this work.
- Full design: `docs/work-log/2026-07-20-ledger-dashboard.md`, Phase 2 — Architectural Review.

---

## DECISION-030: Philanthropy/impact reporting counts TRUE GIFTS only — fundraising-overhead and operational spend excluded via a new per-category `counts_as_giving` flag, with conservative null-inclusion

**Status:** Resolved
**Date:** 2026-07-20

**Decision:**

`/members/impact` (all-time/current-FY giving totals, giving by cause, giving by fiscal year, recent named gifts) previously counted every posted, non-transfer expense row on an `activity`/`charitable`/`scholarship` fund as philanthropic giving. That predicate over-counted: fundraising event costs, general operations, and insurance & bonding are real expenses against public/charitable funds but are not gifts given to a cause — they are the overhead of running the club/Foundation. A new `ledger_categories.counts_as_giving` boolean (`NOT NULL DEFAULT true`) marks categories whose spend is operational/fundraising overhead; `false` excludes a category's transactions from philanthropy reporting even though the transaction otherwise satisfies the existing giving-eligible fund-kind rule. Three categories were flagged `false` on migration: `Fundraising event costs`, `Operations`, `Insurance & bonding` (all entities, expense flow).

The giving predicate — duplicated by design at two synced sites, `isGiving()` (`src/lib/ledger.ts`) and the SQL `WHERE` clause inside `getPhilanthropy()` (`src/lib/ledger-queries.ts`) — was extended at both sites with the same rule: `categoryCountsAsGiving !== false` (helper) / `counts_as_giving IS NOT FALSE`-equivalent via `LEFT JOIN` + `OR(isNull, = true)` (SQL). A **null or missing flag stays INCLUDED** — a transaction with no `categoryId`, or whose category has never had the flag set explicitly to `false`, is not silently dropped from the report; it keeps appearing under "Other community support." Only an explicit `false` excludes a row.

**Rationale:** The conservative null-inclusion choice was deliberate, not an oversight. `categoryId` is nullable on `ledger_transactions` (`onDelete: 'set null'`), so uncategorized or since-recategorized public-fund expenses exist and will continue to exist. Defaulting an unset/unknown flag to *exclude* would silently shrink the giving total every time a category went uncategorized or a category row was deleted — the opposite failure mode from the one this decision fixes, and harder to notice because it fails quiet rather than loud. Requiring an explicit `false` means every exclusion is a deliberate, auditable act (a migration UPDATE or a future admin toggle), never an accident of missing data.

Only surfaces that need the "true gift" meaning were touched. `determine990()` and `get990Prep()` were audited and left untouched — the 990 needs actual expense totals (operations, insurance, and fundraising costs all belong on the return), which is the opposite of what this refinement excludes; narrowing the predicate there would corrupt compliance math. `getDonor()`'s `givingHistory` (money donors give *to* the club, `flow='income'`) is a different, unrelated concept from `isGiving()` (money the club/Foundation gives *out*, `flow='expense'`) and was not touched.

**Impact:**
- `src/lib/db/schema.ts` — `ledgerCategories.countsAsGiving: boolean("counts_as_giving").notNull().default(true)`.
- `drizzle/migrations/0053_ledger_category_counts_as_giving.sql` — idempotent `ADD COLUMN IF NOT EXISTS` + guarded `UPDATE` flagging the three named categories false across all entities.
- `src/lib/ledger.ts` — `isGiving(row, fundKind, categoryCountsAsGiving?)` gains a 3rd optional parameter; existing call shape (2-arg) unaffected.
- `src/lib/ledger-queries.ts` — `getPhilanthropy()`'s two queries (aggregate fold + recent-named-gifts) both gain a `LEFT JOIN` to `ledger_categories` and the `counts_as_giving` filter.
- `src/lib/ledger-impact.test.ts` — 5 new `isGiving()` cases covering explicit `false`/`true`/`null`/omitted, and `false` stacked with an already-disqualifying fund kind.
- Dev-DB giving total: $86,682.64 → $61,999.54 (−$24,683.10 across 43 excluded transactions).
- Full work-log: `docs/work-log/2026-07-20-impact-true-gifts.md`.

---

## DECISION-029: Ledger fund opening/ending balances rolled forward past their static seed for any FY after the fund's first

**Status:** Resolved
**Date:** 2026-07-20

**Decision:**

Bug fix (display-side counterpart to DECISION-028). `getOverview()`, `getFundReport()`, and `getEntityReport()` in `src/lib/ledger-queries.ts` all computed a fund's `openingCents` for the selected FY as the raw `fund.openingBalanceCents` seed — a static value anchored once at the fund's inception (e.g. 6/30/2024) and never itself mutated — and `endingCents` as `openingCents + <selected-FY posted income> − <selected-FY posted expense>`. For any FY after the fund's first, this silently dropped every prior fiscal year's net activity from both figures. Seeded with 276 real transactions spanning FY2024-25 and FY2025-26 (`scripts/import-quicken-ledger.ts`, 2026-07-20), the bug became visible for the first time: `/admin/ledger` showed the club's Administrative Fund at $19,090.10 (the raw seed) instead of the true $16,134.12, Activity at $0.00 instead of $84.52, and the Foundation's Charitable Fund at $28,569.30 instead of $4,836.57.

**Fix:** each affected function now runs a companion "pre-FY rollforward" query — `SELECT fund_id, flow, SUM(amount_cents) FROM ledger_transactions WHERE status='posted' AND txn_date < <FY start> GROUP BY fund_id, flow`, unbounded below, posted-only — and feeds the result into a new pure function, `rolledForwardOpeningCents(seedCents, preFyTxns)` in `src/lib/ledger.ts`. That function filters defensively to `status === 'posted'` (belt-and-suspenders with the SQL WHERE clause, same defense-in-depth posture as the DECISION-026 Ruling 3 unique index) and delegates the actual summation to the existing canonical `fundBalanceCents()` — no second, hand-rolled balance formula, matching the reuse discipline DECISION-028 established. `endingCents` is then `rolledForwardOpening + <selected-FY posted income> − <selected-FY posted expense>`, unchanged in shape from before.

**Call sites fixed:** `getOverview()` (one companion query, batched across all of the entity's funds), `getFundReport()` (one companion query, single fund), `getEntityReport()` (one companion query, batched across all of the entity's funds — mirrors `getOverview()`'s shape exactly). **Call sites already correct / unaffected:** `getComplianceOverview()`, `get990Prep()`, and the `entityBalance` sums inside `getEntityReport()`/`getOverview()` all derive their entity-level balance by summing `fundSummaries[].endingCents` or `fundReports[].endingCents` — once the three primary functions were fixed, these derived sums became correct automatically with no code change. The `agedPublicFunds` guardrail path (Query A2 + `countAgedPublicFunds()`, DECISION-028) was already cross-FY-correct by construction and was not touched.

**Behavioral note:** `entityBalanceCents` fed into `guardrails()` (Check 4 — reserves below threshold — and Check 6 — negative fund balance, per-fund) now reflects the TRUE rolled-forward balance rather than a FY-scoped delta-only figure. This is a correctness fix, not a meaning change: both checks' intent was always "is the club's real money low or negative right now," and the FY-scoped figure was silently wrong for any FY after a fund's first.

**Rationale:** Reusing `fundBalanceCents()` rather than hand-rolling a third balance formula keeps every "balance" in the codebase provably identical in arithmetic (same discipline DECISION-028 established for the cross-FY aged-funds figure). Filtering defensively inside `rolledForwardOpeningCents()` even though the SQL query already filters to `status='posted'` follows the project's established defense-in-depth pattern (DECISION-026 Ruling 3) and — unlike the SQL-only alternative — gives this money-figure computation a real Vitest seam, since `ledger-queries.ts` functions have no DB-mocking test infrastructure in this codebase (same gap DECISION-028's rationale names).

**Impact:**
- `src/lib/ledger.ts` — new exported `rolledForwardOpeningCents(seedCents, preFyTxns)`.
- `src/lib/ledger-queries.ts` — new pre-FY rollforward query + `rolledForwardOpeningCents()` call in `getOverview()`, `getFundReport()`, `getEntityReport()`. `FundReport`/`FundSummary` type doc comments updated to describe the rolled-forward `openingCents` contract.
- `src/lib/ledger.test.ts` — new `describe("rolledForwardOpeningCents", ...)` block: first-FY regression, later-FY rollforward with the real repro numbers, pre-FY pending/rejected exclusion, zero-seed fund, multi-row netting.
- No schema change, no new routes.
- Full work-log: `docs/work-log/2026-07-20-ledger-balance-rollforward.md`.

---

## DECISION-028: Lions Fund-Compliance Guardrails — aged-public-fund gate corrected to a true cross-FY balance; gating logic extracted into a testable pure function

**Status:** Resolved (corrects part of DECISION-027)
**Date:** 2026-07-20

**Decision:**

QA's Phase 5 verification (2026-06-27 work-log, Bug 2) found that the aged-public-fund WARN silently fails to fire whenever a public fund's aged, undisbursed income falls entirely in a fiscal year other than the one currently selected in `getOverview()`. Root cause: the balance-positive gate reused `fundSummaries[].endingCents`, which DECISION-027's Ruling B explicitly (and incorrectly) specified as the balance source: *"The balance-positive condition is applied in the TypeScript aggregation, not SQL, using the already-computed `fundSummaries[].endingCents`."* That field is bound to the FY window passed into `getOverview()` — it is not the fund's true balance. This decision corrects that one sentence of DECISION-027. Ruling A (category batch-fetch) and the rest of Ruling B (dedicated query over a denormalized column) are unaffected and stand.

**Corrected design:**

1. **New companion aggregate query in `getOverview()`** (`src/lib/ledger-queries.ts`), alongside the existing (unchanged, already-correct) Query A: a `SELECT fund_id, flow, SUM(amount_cents) FROM ledger_transactions WHERE fund_id IN (<publicFundIds>) AND status='posted' AND flow IN ('income','expense') GROUP BY fund_id, flow` — no FY bound, bounded to public fund IDs only (same bounded-batch discipline as DECISION-027).
2. **Reuse the existing canonical balance function**, `fundBalanceCents(openingCents, postedTxns)` (already defined in `src/lib/ledger.ts`, already unit-tested, already imported into `ledger-queries.ts` but previously unused there) — called once per public fund with two synthetic `FlowRow` entries built from the new query's per-flow sums. This guarantees the cross-FY figure uses **exactly** the same arithmetic as every other balance in the system; no second, hand-rolled definition of "balance" is introduced.
3. **New exported pure function `countAgedPublicFunds()`** in `src/lib/ledger.ts`, alongside `guardrails()`. Takes an array of per-fund cross-FY facts (`fundKind`, `crossFyBalanceCents`, `oldestPostedIncomeDate`), a threshold, and an injectable `now`, and returns the count. `getOverview()` builds this fact array from the fund rows + the new query + the existing (unchanged) Query A, and calls this function instead of inline-filtering `fundSummaries`.
4. **`GuardrailsInput` / `guardrails()` signature is unchanged.** The bug and its fix are entirely upstream of `guardrails()`, which still receives a flat `agedPublicFunds: number` count. No change to the pure gating function or its existing 5 unit tests.

**Rationale:**

The extraction into `countAgedPublicFunds()` is the direct fix for the coverage gap QA flagged: the original aggregation lived inline inside `getOverview()`, a DB-bound function with no unit-test seam in this codebase (confirmed: no test file exercises `getOverview()` today), so the FY-scoping defect had no layer capable of catching it before a live click-through. A pure function taking plain data and returning a count can be — and now is — unit tested directly with fixture data that reproduces QA's exact scenario (a fund whose cross-FY balance is positive but whose FY-scoped view would read $0), closing the gap at the layer where it actually belongs rather than asking QA to invent DB-mocking infrastructure under loop-back pressure.

**Impact:**

- `src/lib/ledger-queries.ts` — new companion query in `getOverview()`; `agedPublicFundsRaw` computation rewritten to call `countAgedPublicFunds()`.
- `src/lib/ledger.ts` — new exported `countAgedPublicFunds()` function and its input type, placed near `guardrails()`.
- `src/lib/ledger.test.ts` — new `describe("countAgedPublicFunds", ...)` block, including a named regression test for the exact FY-scoping failure QA reproduced. No change to the existing `guardrails()` Enhancement-1 tests.
- No schema change. No change to `GuardrailsInput`'s shape or `guardrails()`'s existing tests.
- Full design: `docs/work-log/2026-06-27-lions-fund-compliance.md`, "Phase 3 — Revised Design (loop-back from Phase 5) — 2026-07-20."

---

## DECISION-027: Lions Fund-Compliance Guardrails — cross-FY aging query approach and Enhancement 2 category-fundKind resolution strategy

**Status:** Resolved
**Date:** 2026-06-27

**Decision:**
Two architectural rulings for the Lions Fund-Compliance Guardrails feature (work-log: `docs/work-log/2026-06-27-lions-fund-compliance.md`):

**Ruling A — Enhancement 2 (direct-to-admin public income): resolve category `fundKind` via a single batch fetch before the aggregation pass, not a JOIN on `allTxns`.**

`getOverview()` currently fetches all FY transactions in one query and then aggregates in TypeScript. To compute `adminPublicIncomeCount` (income rows in an administrative fund where the category's `fundKind != 'administrative'`), the aggregation loop needs `fundKind` for each transaction's `categoryId`. The cleanest approach consistent with the file's existing N+1-avoidance pattern:

1. After fetching `allTxns`, collect the distinct `categoryId` values that appear on income rows in administrative funds.
2. Fetch those category rows in a single `inArray` query (at most one extra round-trip; category sets are small — typically < 20 rows per entity).
3. Build a `Map<categoryId, fundKind>` and use it in the existing TypeScript aggregation pass.

This is preferred over joining categories into the `allTxns` query because: (a) `allTxns` is already used for multiple aggregation purposes and adding a LEFT JOIN would widen every row for a check that only applies to a small subset; (b) the precedent in `getFundReport()` and `getEntityReport()` is exactly this pattern — fetch categories separately, merge in TypeScript; (c) the category set for an entity is bounded and small enough that a batch fetch is cheap and idiomatic. The `get990Prep()` SQL approach (inline LEFT JOIN) is a counter-precedent but is appropriate there because the entire function is a single SQL GROUP BY — not a TypeScript aggregation pass.

**Ruling B — Enhancement 1 (aging guardrail): use a dedicated cross-FY aggregate query, not a denormalized column.**

The aging check needs the oldest posted income date for each public fund (kind ∈ activity/charitable/scholarship) across all fiscal years, where the fund's current balance is positive. The two options were:

- Option 1: A small dedicated SQL query added to `getOverview()` — one extra DB round-trip, computes `MIN(txn_date)` per fund over all posted income rows with no FY bound, filtered to public funds.
- Option 2: A denormalized `ledger_funds.oldest_posted_income_date` column maintained on every insert/update/delete of an income transaction.

**Ruling: use Option 1 (dedicated query).** Rationale: a denormalized column (Option 2) introduces a write-time maintenance obligation that spans every income transaction mutation path (record, approve, reject, hard-delete) — four distinct touch points, each requiring the column to be recalculated. A bug in any one of those paths silently corrupts the guardrail. Option 1 is a single read-time query that is always correct by definition. The performance cost is one additional DB query per `getOverview()` call, which is acceptable — `getOverview()` already runs multiple round-trips (entity, funds, settings, transactions) and this query returns O(N-funds) aggregate rows, not O(N-transactions) data.

**Correctness of the "unspent" proxy:** The metric is "oldest posted income date on a fund where the current balance is positive." This is a conservative proxy — a fund with $0 net balance but old income and old offsetting expenses will NOT fire (correct: the money was spent). A fund with any positive balance AND old income will fire. This matches the analyst's G-3 specification. The query is: `SELECT fund_id, MIN(txn_date) as oldest_income_date FROM ledger_transactions WHERE flow='income' AND status='posted' AND fund_id IN (<public-fund-ids>) GROUP BY fund_id`. The balance-positive condition is applied in the TypeScript aggregation, not SQL, using the already-computed `fundSummaries[].endingCents`.

**Rationale:**
The N+1-free discipline in `ledger-queries.ts` is worth preserving — but N+1 means unbounded per-row round-trips, not "more than two queries." A bounded batch fetch (Ruling A) and a single aggregate query (Ruling B) both stay within the spirit of the file's documented strategy. Denormalized columns that mirror computed values across multiple write paths are a consistent source of drift bugs and are the wrong tool when a read-time query is fast and correct.

**Impact:**
- `getOverview()` in `src/lib/ledger-queries.ts` gains one new batch-fetch for category `fundKind` (Ruling A) and one new cross-FY aggregate query for oldest income date (Ruling B).
- `GuardrailsInput` in `src/lib/ledger.ts` gains two new fields: `agedPublicFunds: number` and `adminPublicIncomeCount: number`.
- `ledger_settings` in `src/lib/db/schema.ts` gains `holdingPeriodWarnDays: integer` (default 365). A matching idempotent migration is required.
- No new npm dependencies, routes, or directories. All changes are confined to `src/lib/ledger.ts`, `src/lib/ledger-queries.ts`, `src/lib/db/schema.ts`, and `drizzle/migrations/`.

---

## DECISION-026: `deriveAckType()` — quid-pro-quo type takes precedence over written-ack when both thresholds are met; `amountCents` on `ledgerAcknowledgments` is immutable after creation; DB-level unique index on `donation_txn_id` is defense-in-depth

**Status:** Resolved
**Date:** 2026-06-26

**Decision:**
Three implementation-level rulings for the Ledger inc6a acknowledgment feature:

1. **`deriveAckType` precedence when both thresholds are met.** When a gift is both ≥ $250 (written-ack threshold) AND carries a quid-pro-quo FMV ≥ $75 (disclosure threshold), the derived type is `'quid_pro_quo_75'`, not `'written_ack_250'`. Rationale: the quid-pro-quo disclosure obligation is stricter — it requires itemizing the FMV of goods/services received. A `written_ack_250` letter that omits the quid-pro-quo FMV would be legally insufficient. Using `'quid_pro_quo_75'` when both apply ensures the treasurer records the FMV. Manual override (`typeOverride`) allows the treasurer to change the type when the auto-derived result is wrong.

2. **`amountCents` on `ledgerAcknowledgments` is immutable after creation.** The `PATCH /api/admin/ledger/transactions/[id]/acknowledge` (mark-sent) route does not accept `amountCents` in the request body. The column is copied from the linked transaction at ack-creation time and never updated. If the underlying transaction's amount is corrected after the ack is created, the ack retains the amount that was acknowledged — which is the legally correct amount to state in the letter. A note is surfaced in the UI if the ack amount diverges from the current transaction amount (a simple display-layer comparison; no structural enforcement needed).

3. **Unique index on `ledgerAcknowledgments(donationTxnId)` as defense-in-depth.** The API already enforces one-ack-per-transaction at the application layer, but a DB-level unique index (`CREATE UNIQUE INDEX IF NOT EXISTS ix_ledger_acks_unique_txn ON ledger_acknowledgments(donation_txn_id)`) provides a second line of defense against race conditions (two simultaneous POST requests for the same transaction). The index is included in `0051_ledger_donors.sql`. The application-layer check returns a user-readable 409 before the DB constraint would trigger, so the raw `DatabaseError` from the constraint is a backstop, not the primary error path.

**Rationale:**
Ruling 1 flows from IRS Pub 1771: a quid-pro-quo contribution over $75 requires disclosure of the FMV of goods/services. A written acknowledgment alone is insufficient if goods/services were provided. Erring on the side of the stricter type is the only correct default.

Ruling 2 is the standard approach for legal acknowledgment records: the letter states what was received by the organization at the time the relationship was recorded, not a later-revised figure. Allowing the ack amount to drift with transaction edits would make the record misleading.

Ruling 3 is consistent with the existing unique-constraint pattern on `ledger_transactions(dues_payment_id)` (DECISION-025). Small implementation cost, prevents a hard-to-debug data integrity issue.

**Impact:**
- `src/lib/ledger.ts` — `deriveAckType(amountCents, quidProQuoValueCents)` returns `'quid_pro_quo_75'` when `quidProQuoValueCents >= 7500`, regardless of whether `amountCents >= 25000`.
- `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts` (PATCH) — no `amountCents` field accepted.
- `drizzle/migrations/0051_ledger_donors.sql` — includes `CREATE UNIQUE INDEX IF NOT EXISTS ix_ledger_acks_unique_txn ON ledger_acknowledgments(donation_txn_id)`.
- Vitest tests for `deriveAckType` must include the case: $300 gift + $75 quid-pro-quo → `'quid_pro_quo_75'`.

---

## DECISION-025: Dues↔Ledger coupling — same-transaction-atomic via `src/lib/dues-ledger-sync.ts`; `sync_stale` marker for reconciled-conflict

**Status:** Resolved
**Date:** 2026-06-26

**Decision:**
Six structural rulings for the Ledger inc 6a dues↔ledger auto-post feature:

1. **Helper module:** `src/lib/dues-ledger-sync.ts` (new file). Exports `syncDuesCreate(tx, payment)`, `syncDuesUpdate(tx, paymentId, patch)`, `syncDuesDelete(tx, paymentId)`. Accepts a Drizzle transaction client `tx`, never `db` directly — callers must wrap in `db.transaction()`.

2. **Atomicity:** The three dues API routes (`POST`, `PATCH`, `DELETE` on `/api/admin/dues/[memberId]`) wrap their existing DB write + the sync helper call in a single `db.transaction()`. The dues write and the ledger write either both commit or both roll back. Exception: if `getAdministrativeFundId()` returns null (configuration error — Administrative fund not seeded), the sync call throws; the catch block inside the transaction logs the error and sets a `syncFailed: true` flag on the response body without re-throwing, so the dues write still commits. This is the one best-effort carve-out: a dues payment without a ledger row is recoverable; a rolled-back dues payment is data loss.

3. **Idempotency:** `ledger_transactions` gains a `dues_payment_id uuid UNIQUE REFERENCES dues_payments(id) ON DELETE SET NULL` column. The unique constraint enforces one ledger row per dues payment. `ON DELETE SET NULL` (not CASCADE) is required: a hard-deleted dues payment must not cascade-delete a possibly-reconciled ledger row.

4. **Reconciled-conflict marker:** `ledger_transactions` gains a `sync_stale boolean NOT NULL DEFAULT false` column. When a dues payment is edited (PATCH) or deleted (DELETE) and its linked ledger row has `reconciled = true`, the sync helper sets `sync_stale = true` on the ledger row without modifying any other financial fields. The dues change proceeds. The dues API returns `{ syncStale: true }` in the response body. The `sync_stale` flag is surfaced in `guardrails()` (`src/lib/ledger.ts`) as a WARN-severity flag fed by a `syncStaleTxns` count added to `getOverview()` in `ledger-queries.ts`.

5. **Dependency direction:** Dues feature → ledger schema. `src/lib/dues-ledger-sync.ts` imports from `src/lib/db/schema.ts` (ledger tables) and `src/lib/ledger-queries.ts` (fund lookup). The ledger feature does not import from the dues feature. This direction is correct: the ledger is core infrastructure (shipped v1.20.0); dues is a feature that posts income to it.

6. **`donor_id` column on `ledger_transactions`:** A nullable `donor_id uuid REFERENCES ledger_donors(id) ON DELETE SET NULL` column is added to `ledger_transactions` to link Foundation income transactions to a donor record (independent of the acknowledgment). The acknowledgment table (`ledger_acknowledgments`) also carries `donor_id` for direct ack-to-donor linkage.

**Rationale:**
Same-transaction-atomic is the correct default for financial writes. The two alternatives considered were: (a) best-effort fire-and-forget (dues write commits first; ledger insert attempted after) — rejected because a crash between the two writes leaves dues recorded without a ledger entry, a silent discrepancy; (b) ledger-first (insert ledger row first, dues payment second) — rejected because failure-mode semantics are harder to reason about and the dues payment is the authoritative record. Atomic-with-catch satisfies both the data-integrity requirement and the practical requirement that a configuration error not block dues recording.

Placing the helper in `dues-ledger-sync.ts` rather than inside `ledger-queries.ts` isolates the cross-feature concern: the ledger query layer should not know about dues payments, and the dues routes should not know about ledger internals. The sync module is the explicit seam.

`ON DELETE SET NULL` on the `dues_payment_id` FK (rather than CASCADE) is required because a reconciled ledger transaction is part of the club's audited financial record; it must not be silently removed because someone deleted its source dues payment. `sync_stale` provides the signal for the treasurer to resolve the discrepancy manually.

**Impact:**
- New file: `src/lib/dues-ledger-sync.ts`.
- `src/lib/db/schema.ts` — `ledgerTransactions` gains `duesPaymentId` (uuid, unique, nullable, FK → dues_payments ON DELETE SET NULL) and `syncStale` (boolean, NOT NULL DEFAULT false) and `donorId` (uuid, nullable, FK → ledger_donors ON DELETE SET NULL).
- New tables in `schema.ts`: `ledgerDonors`, `ledgerAcknowledgments`.
- New idempotent migration: `drizzle/migrations/0051_ledger_donors_acks_dues_sync.sql` (or next sequential number — database-admin assigns).
- `src/app/api/admin/dues/[memberId]/route.ts` (POST) — wrapped in `db.transaction()`, calls `syncDuesCreate`.
- `src/app/api/admin/dues/[memberId]/[paymentId]/route.ts` (PATCH, DELETE) — wrapped in `db.transaction()`, calls `syncDuesUpdate` / `syncDuesDelete`.
- `src/lib/ledger.ts` — new `syncStaleTxns` input to `guardrails()`; new WARN flag.
- `src/lib/ledger-queries.ts` — `getOverview()` adds `syncStaleTxns` count.
- New API routes: `src/app/api/admin/ledger/donors/route.ts`, `src/app/api/admin/ledger/donors/[id]/route.ts`, `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts`.
- New proxy route: `src/app/api/admin/ledger/acknowledgments/[id]/letter/route.ts`.
- New admin pages: `src/app/(dashboard)/admin/ledger/donors/` (list + detail with ack tab or sub-route — tech-lead decides per Suggestion 1).

---

## DECISION-024: `isGiving()` definition — fund-kind+flow+transfer-check only; null-party rows excluded from recent gifts

**Status:** Resolved
**Date:** 2026-06-26

**Decision:**
Two implementation-level rulings for the Ledger inc5 Impact Dashboard:

1. **`isGiving()` uses fund-kind + flow + transfer-check only — no category keyword matching.** The pure helper in `src/lib/ledger.ts` defines "giving" as: `flow === 'expense'` AND `transferGroupId === null` AND `fund.kind IN ('activity', 'charitable', 'scholarship')`. Category keywords (donation/grant/scholarship/vision/relief/screening) mentioned in the feature doc are NOT part of the definition. The SQL giving predicate in `getPhilanthropy()` in `src/lib/ledger-queries.ts` uses the same three-condition rule. Both definitions carry a cross-reference comment requiring sync.

2. **Null-`party` rows are excluded from the "Recent named gifts" section.** The `getPhilanthropy()` recent-gifts query adds `AND party IS NOT NULL` so that giving rows without a named recipient do not produce "Unnamed recipient: $X" entries. These rows are fully captured in all-time, current-FY, by-cause, and by-FY totals — only the named-recipients display excludes them.

**Rationale:**

_Category keywords:_ The feature doc lists category keywords as a secondary gate on `isGiving()`. However, categories are free text entered by the treasurer — any keyword list will silently miss transactions with unexpected category names (e.g., "youth program" vs. "Youth Programs"). The fund-kind gate (`kind IN ('activity','charitable','scholarship')`) is deterministic: it enforces the Administrative fund exclusion at the domain boundary and is identical in the pure helper and the SQL predicate. Adding keyword matching on top would diverge: the pure helper would need to check `categoryName`, which is not on the transaction row itself (it requires a join), making the helper no longer "pure." Keeping the rule to fund-kind+flow+transfer-check makes the helper fully testable without DB access and the SQL predicate fully consistent.

_Null party in recent gifts:_ A "Recent named gifts" section has user value when it names specific recipients ("$2,000 to Westerville Food Pantry"). A null-party entry adds no value and would require a placeholder ("Unnamed recipient") that confuses members. The aggregate sections (by-cause, by-FY, all-time total) capture every giving dollar including those without a named payee. Excluding null-party rows from only the recent-gifts display is the minimal change that keeps the section meaningful.

**Impact:**
- `src/lib/ledger.ts` — `isGiving(row, fundKind)` checks `row.flow`, `row.transferGroupId`, and `fundKind` only. No `categoryName` or keyword matching.
- `src/lib/ledger-queries.ts` — `getPhilanthropy()` SQL predicate: `status='posted' AND transfer_group_id IS NULL AND flow='expense' AND fund.kind IN ('activity','charitable','scholarship')`.
- `getPhilanthropy()` recent-gifts query adds `AND party IS NOT NULL`.
- Vitest tests include a case confirming that `isGiving()` returns true for an `administrative` fund → false (the exclusion is a fund-kind check, not a status or category check).

---

## DECISION-023: `csvCellSafe()` for ledger CSV export — injection guard lives in the export route, not in a shared util; dues `csvCell()` left unchanged

**Status:** Resolved
**Date:** 2026-06-25

**Decision:**
The ledger CSV export route (`src/app/api/admin/ledger/export/route.ts`) defines its own `csvCellSafe()` helper that extends the dues `csvCell()` logic with a leading-character injection guard: if a cell value's first character is `=`, `+`, `-`, or `@`, a tab character (`\t`) is prepended before any quoting step. This guards against spreadsheet formula injection (CVE-class: CSV injection). The existing `csvCell()` in `src/app/api/admin/dues/export/route.ts` is NOT modified. A Vitest unit test for `csvCellSafe()` is required before the export route ships.

The `csvCellSafe()` helper is applied to every free-text column (Category, Party/Payee, Memo in the transaction CSV; Line/Group and any category-derived label in the 990-prep CSV). Controlled-value columns (Date, Fund, Flow, Amount, Status, Reconciled, Payment Method) use a plain `csvCell()` inline (no injection guard needed — values are server-generated enums or formatted numbers).

**Rationale:**
Placing `csvCellSafe()` in the export route rather than extracting it to a shared util avoids pulling ledger-specific security logic into a file shared by unrelated exports. The dues export fields are all admin-controlled (no free-text from untrusted input); the ledger `party` and `memo` fields are free-text entered by treasurers and could contain `=` or `+`. The two helpers have different correctness requirements. Retroactively patching `csvCell()` in the dues export is out of scope for inc4; that surface will be caught in the next security review. The tab-prepend approach is the standard published defense (OWASP CSV Injection); it is invisible in most spreadsheet apps under normal rendering.

**Impact:**
- New local function `csvCellSafe()` in `src/app/api/admin/ledger/export/route.ts`.
- New Vitest unit test file (location: co-located or in `src/lib/__tests__/csv-ledger-export.test.ts`); minimum 8 cases (see Phase 3 design doc).
- `src/app/api/admin/dues/export/route.ts` — no change.
- Security review must audit whether `csvCell()` in the dues export should also be upgraded; flagged for the next 30-day security review.

---

## DECISION-022: `ledger_filings` 5-year cadence stored as `next_due_year integer`; `listFilings` includes a 5-year row only when `nextDueYear === fiscalYear + 1`

**Status:** Resolved
**Date:** 2026-06-25

**Decision:**
The `Statement of Continued Existence` (Ohio SOS, every 5 years) and any future `recurrence='5_year'` filing row is controlled by a `next_due_year integer` column on `ledger_filings`. The value is the **calendar year** in which `due_month/due_day` falls for the next required filing (e.g., `next_due_year=2030` means the filing is due `due_month/due_day` in calendar year 2030, which is inside FY2030 for a Lions Jul–Jun FY).

`listFilings(entityId, fiscalYear)` includes a `recurrence='5_year'` row only when `nextDueYear === fiscalYear + 1`. (The `+1` maps a FY start-year to the second calendar year that falls inside it, where months 1–6 land — Nov 15 of FY2029 = Nov 15 2029. Wait — Nov is month 11 ≥ 7, so it lands in the *first* calendar year of the FY. Nov of FY2029 = Nov 2029 = `fiscalYear + 0`. So the correct test for "does this row's due date fall inside `fiscalYear`?" is `nextDueYear === fiscalYear` for months ≥ 7 and `nextDueYear === fiscalYear + 1` for months < 7. Because the Statement of Continued Existence is due Nov 15 (month 11 ≥ 7), the correct test is `nextDueYear === fiscalYear`. `listFilings(2029)` includes the row when `next_due_year = 2029`.)

**Correction on filter predicate:** After applying `computeDueDate` logic (month ≥ 7 → same calendar year as FY start; month < 7 → FY start + 1), the test is:
- Month ≥ 7 (like Nov): `next_due_year === fiscalYear`
- Month < 7: `next_due_year === fiscalYear + 1`

Simplest implementation: `listFilings` computes the expected calendar year for the row's due month (`dueMonth >= 7 ? fiscalYear : fiscalYear + 1`) and compares to `nextDueYear`. Rows that do not match are excluded from the returned set.

On rollover, `ensureFilingsForFY` sets `next_due_year = prior.nextDueYear + 5`. The new row is a copy in the DB for every FY, but surfaces only in the FY where the computed calendar year matches.

**Rationale:**
Two simpler alternatives were considered:
- (a) Store a boolean `isDueThisFY` — requires updating the column every year, which adds write complexity to the rollover and is fragile if a year is skipped.
- (b) Compute the due year entirely from the seed year: `(fiscalYear - seedFY) % 5 === 0` — requires storing the `seedFY` on the row or hardcoding it in the query helper. It also makes the query helper dependent on knowing the original seed year, which would break if the entity's filings are ever re-seeded.

Storing `next_due_year` as an explicit column is the smallest, most self-contained approach: the value is always correct for the row at hand, rollover is a `+5` arithmetic operation, and the filter in `listFilings` is a single equality check. No external seed-year constant needed.

**Impact:**
- `ledger_filings` has a `next_due_year integer` column (nullable for `recurrence='annual'` rows; non-null for `recurrence='5_year'`).
- `listFilings` filters 5-year rows: `row.nextDueYear === (row.dueMonth >= 7 ? fiscalYear : fiscalYear + 1)`.
- `ensureFilingsForFY` sets `next_due_year = CASE WHEN recurrence = '5_year' THEN next_due_year + 5 ELSE NULL END` in the rollover INSERT.
- Migration seed for the Statement of Continued Existence seeds `next_due_year = 2030` (placeholder — the actual next Ohio SOS renewal year should be confirmed with the treasurer before the migration goes to production).

---

## DECISION-021: `ledger_filings` due-date storage — `dueMonth` + `dueDay` integers; rollover is an explicit idempotent `ensureFilingsForFY()` step, not write-on-read

**Status:** Resolved
**Date:** 2026-06-25

**Decision:**
Two data-shape rulings for the `ledger_filings` table in Ledger inc3 (Compliance):

1. **Due-date column shape:** Store `due_month integer NOT NULL` (1–12) and `due_day integer NOT NULL` (1–31) on `ledger_filings` in place of an absolute `due_date date` column. The absolute due date for display and overdue-check purposes is computed at query time as `make_date(fiscal_year_start_year + 1 if due_month < fy_start_month else fiscal_year_start_year, due_month, due_day)` — for the Lions Jul–Jun FY, months 1–6 land in the fiscal-year's second calendar year and months 7–12 land in the first. `listFilings(entityId, fiscalYear)` materializes each row's `dueDate` from these two columns. The seed data records real month/day pairs (e.g., IRS 990-N: `due_month=11, due_day=15`; Ohio Unclaimed Funds: `due_month=11, due_day=1`). The 5-year `Statement of Continued Existence` carries `recurrence='5_year'`; `listFilings` computes its next due-year at query time by finding the nearest multiple-of-5 boundary from the entity's first filing year.

2. **Auto-rollover mechanism:** The FY materialization is NOT a write-on-read side-effect inside `listFilings`. Instead, a dedicated `ensureFilingsForFY(entityId, fiscalYear)` server-action/helper inserts the next FY's rows (by copying the prior year's `agency`, `title`, `due_month`, `due_day`, `recurrence` and assigning `status = 'not_started'`) if none exist for that FY. This function is idempotent (`INSERT … ON CONFLICT DO NOTHING` keyed on `(entity_id, fiscal_year, agency, title)`). It is called: (a) once as an idempotent seed step in the migration for the current FY; (b) explicitly on first navigation to the compliance page when no rows exist for the requested FY (a server component calls it before rendering). `listFilings` is a pure read; it never inserts.

**Rationale:**

_Due-date shape:_ Storing an absolute `date` per row (e.g., `2026-11-15`) is correct for the seed FY but drifts on rollover — a copy that bumps the year field by 1 works for most rows but silently produces wrong dates for any filing that crosses the calendar-year boundary inside a Jul–Jun FY (e.g., a March filing in FY2026 is March 2027, not March 2026). The month/day column pair + FY-aware computation is deterministic, rollover-safe, and makes the seed data readable without requiring date arithmetic in the migration.

_Rollover mechanism:_ A write-on-read `listFilings` is architecturally problematic: (a) it violates the convention that `GET` requests on this codebase are side-effect-free — a `SELECT` that may do an `INSERT` is invisible to callers, difficult to test, and can produce duplicate-insert races under concurrent requests; (b) the existing codebase has no precedent for write-on-read query helpers, and introducing one would require special-casing in the API route middleware (no read-lock, no idempotency guard). An explicit `ensureFilingsForFY()` call in the server component is consistent with the `getSettings()` + singleton-upsert pattern already in `ledger-queries.ts`, is trivially testable, and its idempotency is provable from the `ON CONFLICT DO NOTHING` clause.

**Impact:**
- `ledger_filings` schema: `due_date date` column replaced by `due_month integer NOT NULL` + `due_day integer NOT NULL`. No `due_date` column in `schema.ts` or the migration.
- New computed-field helper in `src/lib/ledger-queries.ts`: `computeDueDate(fiscalYear, dueMonth, dueDay): Date` (exported; pure).
- `listFilings(entityId, fiscalYear)` returns rows enriched with a computed `dueDate: Date` property — it never inserts.
- New `ensureFilingsForFY(entityId, fiscalYear)` in `src/lib/ledger-queries.ts` (or a co-located `actions.ts`): idempotent INSERT … ON CONFLICT DO NOTHING.
- The compliance page server component calls `ensureFilingsForFY` before `listFilings`.
- Migration seed rows use `due_month` / `due_day` integer pairs.
- Tech-lead must specify the `computeDueDate` boundary rule (month < 7 → FY start year + 1, month ≥ 7 → FY start year) in the Phase 3 design doc. The 5-year cadence for `Statement of Continued Existence` is handled by a separate `nextDueYear` computation, also in tech-lead's design.

---

## DECISION-020: Receipt storage is pluggable via a `ReceiptStorage` interface; proxy routes stream content; store an opaque key, not a provider URL

**Status:** Resolved
**Date:** 2026-06-25

**Decision:**
Receipt file storage is exposed through a **`ReceiptStorage` interface** (three methods: `save`, `read`, `delete`) with two concrete adapters selected at runtime by environment:

- **`VercelBlobStorage`** (default in production): wraps `@vercel/blob`. Blobs are written under `receipts/<uuid>/<sanitized-name>` with `access: 'public'` but UUID-namespaced. The adapter is lazy-imported (`import()`) inside its module file so that local dev never loads the `@vercel/blob` package.
- **`LocalReceiptStorage`** (default when `BLOB_READ_WRITE_TOKEN` is absent): writes files under a `.receipt-store/` directory in the repo root (added to `.gitignore`). Reads and streams from disk. Requires zero configuration — no env var, no Vercel account.

Selection rule: `getReceiptStorage()` checks `process.env.BLOB_READ_WRITE_TOKEN`; if set, returns a `VercelBlobStorage` instance; otherwise returns a `LocalReceiptStorage` instance.

**Column rename:** `ledger_reimbursements.receipt_url` is renamed to `receipt_storage_key` (`text NOT NULL`). The column stores an opaque, provider-neutral key (e.g., `receipts/<uuid>/<filename>`) — not a full Vercel Blob URL. This is provider-agnostic and works identically for both adapters.

**Proxy routes stream bytes, not redirect.** `GET /api/members/reimbursements/[id]/receipt` and `GET /api/admin/ledger/reimbursements/[id]/receipt` call `getReceiptStorage().read(key)`, then return the raw bytes with `Content-Type: <contentType>` and `Content-Disposition: inline`. They do NOT redirect to any storage URL. The storage URL/path is never sent to the browser. This works identically for Vercel Blob and local-filesystem, and is strictly more private than a redirect.

**Upload route** returns `{ key: string }` (not `{ url: string }`). The key is stored in `receipt_storage_key`. The browser never learns the underlying blob URL or local path.

**`isBlobUrl()` is removed.** Because the upload route returns an opaque key (not a URL) and the column stores that key, there is no external-URL injection surface to validate. The Blob URL allow-list check on PATCH is replaced by a format check: the key must match the pattern `receipts/<uuid>/<filename>` and must exist in the storage (the read call returns null if not).

**`BLOB_READ_WRITE_TOKEN`** is required only in production. It is absent locally, and local dev needs no storage config at all.

**Rationale:**
DECISION-018 mandated Vercel Blob as the production storage provider — this decision does not change that. It adds a pluggability layer that fixes two problems DECISION-018 left open: (1) the original design required `BLOB_READ_WRITE_TOKEN` in local dev even though Vercel Blob cannot be used locally without network access and a real Blob store; (2) the redirect-based proxy model exposed the Vercel Blob CDN URL to the browser for the duration of the browser fetch, creating a window where the URL could be intercepted and reused without auth. Streaming the bytes from the server through the proxy closes that window and makes the two adapters behaviorally identical. The local adapter costs zero production-runtime overhead (never loaded) and zero configuration.

The `ReceiptStorage` interface also future-proofs the design: swapping to Cloudflare R2 or S3 in a future increment is a new adapter module, not a rewrite of upload/proxy routes.

**Impact:**
- New module: `src/lib/receipt-storage/index.ts` (interface + `getReceiptStorage()` factory + re-exports).
- New module: `src/lib/receipt-storage/vercel-blob.ts` (VercelBlobStorage adapter).
- New module: `src/lib/receipt-storage/local.ts` (LocalReceiptStorage adapter).
- `.receipt-store/` added to `.gitignore`.
- `src/lib/blob.ts` is **not created** (superseded by the receipt-storage module).
- `ledger_reimbursements.receipt_url` is **renamed** to `receipt_storage_key text NOT NULL` in migration `0046_ledger_controls.sql` and in `schema.ts`.
- Upload route returns `{ key }` instead of `{ url }`.
- Proxy routes (`GET .../receipt`) stream bytes via `getReceiptStorage().read(key)` instead of redirecting.
- `isBlobUrl()` helper is not needed and is not created.
- Refines DECISION-018.

---

## DECISION-019: Receipt file-type validation — hand-rolled magic-byte check, no `file-type` npm package

**Status:** Resolved
**Date:** 2026-06-25

**Decision:**
The receipt upload handler in `src/app/api/members/reimbursements/upload/route.ts` validates file type via a **hand-rolled magic-byte inspection** of the first 8 bytes of the uploaded buffer. No additional npm package (`file-type` or otherwise) is added. Supported formats and their byte signatures:

| Format | Bytes checked |
|--------|--------------|
| PDF | `25 50 44 46` (first 4: `%PDF`) |
| JPEG | `FF D8 FF` (first 3) |
| PNG | `89 50 4E 47 0D 0A 1A 0A` (all 8) |

If the buffer does not match any of these signatures, the handler returns 400. Content-Type from the request header is used as a hint for the error message only — the magic bytes are the authoritative check.

**Rationale:**
The `file-type` npm package (~50 KB, MIT, ESM-only) would work correctly for this use case. However, this project must validate exactly three MIME types (PDF, JPEG, PNG). The magic bytes for all three fit in a trivial 10-line helper function. Adding a dependency for three byte comparisons introduces: (1) a package to audit at every `pnpm audit` run; (2) ESM-only compatibility surface to manage in a Next.js App Router project; (3) ongoing maintenance cost if the package releases breaking changes. The hand-rolled check is simpler, has zero maintenance surface, is fully transparent to the reader, and is correct for the use case. The dependency evaluation criteria prefer the option already available — in this case, Node.js `Buffer` comparison — when it solves the problem adequately.

**Impact:**
- No new npm package.
- The magic-byte logic lives in `src/lib/blob.ts` (the `uploadReceipt` helper). It is unit-testable with a three-case Vitest test (valid PDF, valid JPEG, invalid content).
- If a future increment requires a broader set of supported file types (e.g., Word docs, spreadsheets), this decision should be revisited and `file-type` evaluated at that time.

---

## DECISION-018: Receipt file storage for ledger reimbursements — Vercel Blob with server-minted signed URLs

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
Receipt files for `ledger_reimbursements` are stored in **Vercel Blob** (`@vercel/blob` npm package, new dependency). Blobs are uploaded server-side from the receipt-upload route handler (never from the browser directly to Blob), minted with `put(path, stream, { access: 'public' })` but placed under a UUID path that is not guessable. All receipt reads from the member portal or admin UI go through a **server-side proxy route** (`GET /api/members/reimbursements/[id]/receipt` for the member, `GET /api/admin/ledger/reimbursements/[id]/receipt` for officers) that verifies session + ownership/permission before redirecting to the blob URL. The blob URL itself is never embedded in HTML or returned in JSON to the client; every access is mediated by a server check.

Required new env var: `BLOB_READ_WRITE_TOKEN` (Vercel Blob store token).

The `receiptUrl` column on `ledger_reimbursements` stores the full Vercel Blob URL (e.g., `https://<store>.public.blob.vercel-storage.com/<uuid>/<filename>`). File-type validation (PDF, JPEG, PNG; max 10 MB) is enforced server-side in the upload handler before writing to Blob.

The existing `receiptUrl` text field on `ledger_transactions` (ordinary transactions, FU-3) remains a paste-URL text field for now — no file-upload UX for ordinary transactions in inc2. The file-storage decision applies only to `ledger_reimbursements` in this increment.

The `public/uploads`-based upload handler at `src/app/api/admin/upload/route.ts` (used for campaign images) is left untouched; that surface is not financial and ephemeral loss there is acceptable. Receipt files are financial documents with a 7-year retention requirement — they require durable object storage.

**Rationale:**
- `public/uploads` + `writeFile` is already used for campaign images and is the only file-upload precedent in the codebase. That handler was confirmed unacceptable for receipts: Vercel's serverless runtime provides no persistent local disk, so any file written to the local filesystem is lost between invocations and certainly lost on redeployment. Financial documents with a 7-year retention requirement cannot use ephemeral storage.
- **Vercel Blob** is the correct fit: the project is deployed on Vercel, Blob is native to the platform (no cross-provider credentials, no separate CDN), it is actively maintained, and the `@vercel/blob` package adds negligible bundle weight to a server-only upload route. License: Apache-2.0.
- **Cloudflare R2 / S3** would work but introduce additional cross-provider credentials (`AWS_ACCESS_KEY_ID`, etc.) and a heavier SDK for a single use-case in a small club app. The dependency evaluation criteria prefer the option that is already available in the deploy environment.
- **Storing blobs in Postgres** (bytea) is rejected: blob columns at multi-MB scale degrade query performance across all tables sharing the DB connection pool and violate the principle of keeping the DB for structured data only.
- The access-control model (server proxy, never raw blob URL to the client) provides defense-in-depth: even if a blob URL were somehow leaked, the server route is the only entry point that links the UUID path back to a member identity or a permission check.

**Impact:**
- New npm dependency: `@vercel/blob`. Add to `package.json` (production dependency).
- New env var: `BLOB_READ_WRITE_TOKEN` — deployment-engineer must document in Vercel environment variables.
- New upload route: `src/app/api/members/reimbursements/upload/route.ts` — accepts a multipart file, validates type + size, calls `put()`, returns the blob URL to the server action (not to the browser). This is a server action or route handler intermediary, not a direct browser-to-Blob upload.
- New receipt-proxy routes: `GET /api/members/reimbursements/[id]/receipt` (auth + memberId ownership check → redirect) and `GET /api/admin/ledger/reimbursements/[id]/receipt` (auth + `LEDGER_VIEW` → redirect).
- `ledger_reimbursements.receiptUrl` column: `text NOT NULL` (required — every reimbursement must have a receipt).
- `ledger_transactions.receiptUrl` remains text (paste-URL) for ordinary transactions — no file upload in inc2 for that surface.
- Security review must audit: upload file-type sniffing (MIME type from Content-Type header is spoofable — server must also inspect the first bytes), size limit enforcement, that the blob path is UUID-namespaced (not predictable), and that the proxy routes return 404 (not 403) for IDs that exist but belong to another member.

---

## DECISION-017: Ledger `flow` column stores `'income' | 'expense'` only; `transferGroupId` is the transfer discriminator

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
The `flow` column on `ledger_transactions` takes only two values: `'income'` and `'expense'`. It does NOT store a third value `'transfer'`. For a transfer pair (two linked rows per DECISION-016), the debit row stores `flow = 'expense'` and the credit row stores `flow = 'income'`. The `transferGroupId` UUID column (non-null on both rows of a pair) is the sole discriminator used to: (a) label rows as "Transfer" in the UI, (b) enforce two-row atomic delete/edit, and (c) join transfer pairs in the inc2 firewall guardrail. No check constraint on `flow` may include `'transfer'` as a valid value.

**Rationale:**
DECISION-016 established two linked rows so that `fundBalanceCents()` can be a single-pass sum with no special cases. That property only holds if `flow` encodes the sign direction (`'income'` = positive, `'expense'` = negative) on each row independently. If `flow = 'transfer'` were stored, the balance helper would need to know whether the queried fund is the source (debit) or destination (credit) of each transfer row — reintroducing exactly the asymmetry DECISION-016 was designed to eliminate. The spec and DECISION-016 text reference `flow = 'transfer'` as the *conceptual* category, not a literal column value; this decision binds the implementation to the reading that preserves the single-pass property.

**Impact:**
- `ledger_transactions.flow` check constraint (if any): `flow IN ('income', 'expense')` — no `'transfer'`.
- `fundBalanceCents()` in `src/lib/ledger.ts`: income rows add, expense rows subtract, no other branch needed.
- UI code that renders "Transfer" derives the label from `transferGroupId IS NOT NULL`, not from `flow = 'transfer'`.
- The inc2 firewall guardrail joins on `transferGroupId` and checks `sourceFund.kind` vs `destFund.kind` — it does not filter on a `flow` value.

---

## DECISION-016: Ledger transfer representation — two linked rows via `transferGroupId`

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
Ledger transfers between funds are stored as **two linked rows** in `ledger_transactions`, not a single row with a `transferFromFundId` annotation. The debit row has `flow = 'expense'`, `fundId = sourceFundId`, and a UUID `transferGroupId`. The credit row has `flow = 'income'`, `fundId = destFundId`, and the same `transferGroupId`. Both rows share the same `entityId`, `txnDate`, `amountCents`, and `memo`. The server action that records a transfer inserts both rows atomically (a single DB transaction). Cross-entity transfers are not defined and must be rejected server-side.

The `flow = 'transfer'` discriminator is retained on both rows (alongside `transferGroupId`) so the UI can render them with a "Transfer" label, suppress the `party` required-field validation on the debit row, and so the inc2 firewall guardrail can detect Activity→Admin flows by joining on `transferGroupId` to find pairs where source `fund.kind = 'activity'` and destination `fund.kind = 'administrative'`.

**Rationale:**
The single-row design (one row, `transferFromFundId` nullable) makes `fundBalanceCents()` asymmetric: the helper cannot be a simple sum over `(fundId, flow)` tuples because transfer rows serve double duty — income for the destination fund, expense for the source fund in the same row. Every balance query and the inc2 guardrail would need to special-case this. The two-row design keeps `fundBalanceCents()` a single-pass sum with no special cases: each fund sums only its own rows. The firewall guardrail becomes a straightforward join on `transferGroupId`. Both the debit and credit appear in their respective fund ledgers as first-class rows, satisfying the audit-trail requirement symmetrically.

**Impact:**
- `ledger_transactions` gains a nullable `transferGroupId uuid` column (no FK — it is a self-join key within the same table).
- `src/lib/ledger.ts` — `fundBalanceCents()` sums all rows for a fund by sign (income positive, expense negative) with no transfer special-case.
- The server action for recording a transfer inserts two rows in a single DB transaction. The form UI collects source fund, destination fund, amount, date, memo — one submission.
- `flow = 'transfer'` is still a valid discriminator value and appears on both rows of a transfer pair.
- `transferFromFundId` column from the spec prototype is dropped — that was a demo-prototype artifact, not a schema commitment.

---

## DECISION-015: Fiscal-year convention is start-year, shared via `src/lib/fiscal-year.ts`

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
The Lions fiscal year (Jul 1 – Jun 30) is labeled by its **starting** calendar year everywhere in the app: `FY2026 = Jul 1 2026 – Jun 30 2027`. The helpers `getFiscalYear` / `currentFiscalYear` / `fiscalYearLabel` are extracted from `src/lib/dues.ts` into a single shared module `src/lib/fiscal-year.ts` (re-exported from `dues.ts` for back-compat). The forthcoming Ledger accounting feature imports from `@/lib/fiscal-year` rather than redefining it.

**Rationale:**
The Ledger prototype (`Westerville_Lions_Ledger.html`) labeled the same 12 months by their **ending** year (`FY2026 = Jul 2025 – Jun 2026`) — off by one from the shipped dues feature. Two features disagreeing on what "FY2026" means would cause treasurers to record dues and accounting against different windows and mis-file. The transparency doc's per-capita cycle (Jul 2026 → Jun 2027 as one Lions year) matches the start-year labeling already shipped in dues, so we standardize on it and give it one home.

**Impact:**
New file `src/lib/fiscal-year.ts`; `dues.ts` now re-exports the three helpers (no behavior change — dues was already start-year, so no data migration). The Ledger spec (`docs/features/the-ledger-accounting.md`, §2) and all future ledger fiscal-year math depend on this module. The prototype's end-year labeling is explicitly dropped.

---

## DECISION-014: Dues Tracking scope expansion — treasurer role, two-amount dues_settings, dues_category on members, new permission keys

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
Five implementation-level decisions added in the Phase 3 loop-back revision after scope expansion (work-log: `docs/work-log/2026-06-24-dues-tracking.md`):

1. **New `treasurer` role seeded at sort_order 3.** The existing role order (admin=1, board_member=2, member=3, volunteer=4) gains `treasurer` at position 3; `member` shifts to 4, `volunteer` to 5. The migration uses conditional UPDATEs (`WHERE name = 'member' AND sort_order = 3`) to make the bump idempotent. `ROLES.TREASURER = "treasurer"` added to `src/lib/permissions.ts`.

2. **Two permission keys replace the old single `dues.view` / `membership.manage` design.**
   - `FEATURES.DUES_VIEW = "dues.view"` — read gate. Bound to `admin` + `board_member` + `treasurer`.
   - `FEATURES.DUES_MANAGE = "dues.manage"` — write gate. Bound to `admin` + `treasurer` ONLY. `membership.manage` is NOT the dues write gate. Membership managers who are not admins or treasurers have no dues write access.
   - All read surfaces gate on `hasAnyFeature([DUES_VIEW, DUES_MANAGE])`. All write surfaces gate on `hasFeature(DUES_MANAGE)`. CSV export gates on `hasAnyFeature([DUES_MANAGE, REPORTS_EXPORT])`.

3. **`dues_settings` holds two amounts per fiscal year.** The single `expected_amount_cents` column from DECISION-013 does not exist. The table has `individual_amount_cents` and `family_amount_cents` instead. The status query resolves the applicable amount with a CASE expression keyed on `m.dues_category`. FY2026 seed: individual 12000 cents ($120.00), family 9600 cents ($96.00).

4. **New `members.dues_category` column (`text NOT NULL DEFAULT 'individual'`).** Values: `individual | family`. Set by treasurer/admin on the per-member dues detail page via `PATCH /api/admin/dues/[memberId]/category`. Existing members default to `individual` via the column default. Changing the category retroactively recomputes status for all fiscal years (acceptable at club scale; documented in UI).

5. **Named treasurer role assignments in migration.** Chris Henson (chenson42@gmail.com) and James Shively (jmshively@gmail.com) receive the `treasurer` role via idempotent email-keyed `user_roles` INSERTs in `0040_dues_tracking.sql`. Email keys (not UUID) ensure the migration works in production without hardcoding environment-specific IDs.

**Rationale:** A separate `treasurer` role with its own permission key keeps financial write access narrowly scoped without requiring new UI for role management. The two-amount design is the minimal extension for a family discount: one row per year, two columns, resolved at query time. Putting `dues_category` on the member (not per payment or per fiscal year) reflects the reality that membership type is a stable attribute of the person, not a per-year decision. Email-keyed user assignments are idempotent across environments.

**Impact:**
- `src/lib/db/schema.ts` — `duesCategory` column on `members`; `individualAmountCents` + `familyAmountCents` on `duesSettings` (no `expectedAmountCents`).
- `src/lib/permissions.ts` — `DUES_VIEW`, `DUES_MANAGE` in `FEATURES`; `TREASURER` in `ROLES`.
- `drizzle/migrations/0040_dues_tracking.sql` — DDL + treasurer role seed + sort_order bumps + FY2026 seed + user_roles bindings.
- `drizzle/migrations/0041_dues_permissions.sql` — both feature rows + role bindings.
- `src/lib/dues.ts` — `deriveStatus()` takes `(totalPaidCents, expectedCents | null)`.
- New API endpoint: `PATCH /api/admin/dues/[memberId]/category`.
- New admin component: `DuesCategoryControl` on per-member detail page.
- New admin component: `DuesConfigureModal` (two-input) on dues list page.

**Amends:** DECISION-013 — the Impact bullet for `dues_settings.expected_amount_cents` is superseded. The fiscal-year integer convention and integer-cents storage decisions in DECISION-013 remain valid and unchanged.

---

## DECISION-013: Dues Tracking — fiscal year as starting integer, amounts as integer cents, status derived on read

**Status:** Resolved (Impact amended by DECISION-014 — `dues_settings` has two amount columns, not one)
**Date:** 2026-06-24

**Decision:**
Three implementation-level data choices for the `dues_payments` and `dues_settings` tables:

1. **Fiscal year stored as a single integer (the starting calendar year).** FY2026 = Jul 1 2026 – Jun 30 2027 is stored as `fiscal_year = 2026`. The helper `getFiscalYear(date)` in `src/lib/dues.ts` maps any payment date to this integer: if the month is January–June (0–5), return `year - 1`; if July–December (6–11), return `year`. This avoids storing a date range per year and avoids any ambiguity about which year a row belongs to. Display label is `FY2026 (Jul 2026 – Jun 2027)`.

2. **Amounts stored as integer cents.** `amount_cents: integer` avoids floating-point rounding on financial values. The UI divides by 100 for display and multiplies by 100 on input. Negative values represent refunds/reversals. Zero is disallowed at the application layer (validated before insert).

3. **Dues status (Paid / Partial / Unpaid) computed on read, never stored.** Status = `COALESCE(SUM(amount_cents), 0)` for a `(member_id, fiscal_year)` pair, compared to the applicable `dues_settings` amount for that year (individual or family, per DECISION-014). No denormalized status column on `members` or `dues_payments`. This eliminates the risk of stale cached status and keeps the data model minimal; the club's scale (~100 members) makes the GROUP BY query negligible.

**Rationale:** Integer fiscal year is unambiguous and queryable with a simple equality filter. Integer cents is standard practice for financial storage at any scale. Derived status avoids the class of bugs where a stored flag diverges from the actual payment sum after an edit or delete.

**Impact:**
- `dues_payments.fiscal_year`: `integer NOT NULL`
- `dues_payments.amount_cents`: `integer NOT NULL` (non-zero enforced at app layer)
- `dues_settings`: two amount columns — `individual_amount_cents` and `family_amount_cents` (see DECISION-014; the single `expected_amount_cents` column is superseded)
- `src/lib/dues.ts` — new file: `getFiscalYear()`, `currentFiscalYear()`, `fiscalYearLabel()`, `deriveStatus()`
- No stored status column anywhere.

---

## DECISION-012: Dues Tracking — separate `/admin/dues` route, `DUES_VIEW` permission key, CSV via Response + manual encoding, member-portal path reserved

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
Four structural rulings for the Annual Membership Dues Tracking feature (work-log: `docs/work-log/2026-06-24-dues-tracking.md`):

1. **Separate `/admin/dues` route, not a tab under `/admin/membership`.** The existing `/admin/membership` route is scoped to membership *applications* (the `membership_applications` table). Dues tracking is a financially distinct domain (a `dues_payments` table linked to `members`). Merging the two would conflate a one-time intake workflow with a recurring per-year ledger, creating a surface with two unrelated data models and two unrelated permission audiences. The new route lives at `src/app/(dashboard)/admin/dues/` with its own top-level sidebar entry, gated on the new `DUES_VIEW` key. A sub-route at `src/app/(dashboard)/admin/dues/[memberId]/` holds per-member detail. The admin API handlers live under `src/app/api/admin/dues/`.

2. **New `DUES_VIEW` feature key added to the `FEATURES` catalog.** The analyst's Option A (new `dues.view` key, bound to `board_member` and `admin`) is the architecturally correct choice. Option B (grant `membership.manage` to `board_member`) would give board members write-API access even when the UI hides controls — a quiet invariant violation. `DUES_VIEW` becomes the read gate; `MEMBERSHIP_MANAGE` remains the write gate. Page-level and API-level checks use `hasFeature()` with these two keys; no second gating mechanism is introduced.

3. **Export uses `Response` with hand-rolled CSV, not `exceljs`.** The existing `exceljs` export produces an `.xlsx` file targeted at Zeffy's import format. The dues export is a plain auditor CSV (name, email, year, amount, status). Adding a 1 MB+ Excel workbook for six columns of plain text is not justified. A hand-rolled `text/csv` response — already a supported output of the native `Response` API in Node — keeps the bundle clean. `exceljs` is not introduced as a new dependency for this surface.

4. **Member self-view path reserved at `/members/dues` but not built in this increment.** If member self-view is added later, it lives in the existing `src/app/members/` route group (already authenticated), not in `/(dashboard)/admin`. No code is written for this path now; the reservation is noted so the data model (Phase 3) does not foreclose it.

**Rationale:** Separating dues from membership applications keeps each admin surface coherent. A new permission key is the only correct enforcement model for the read-vs-write split. Hand-rolled CSV avoids a new dependency. Reserving the member self-view path prevents a schema decision from accidentally locking out the future increment.

**Impact:**
- `src/app/(dashboard)/admin/dues/` — new route directory (Phase 4).
- `src/app/(dashboard)/admin/dues/[memberId]/` — new sub-route for per-member detail (Phase 4).
- `src/app/api/admin/dues/` — new API route directory (Phase 4).
- `src/components/admin/admin-sidebar.tsx` — new "Dues" entry gated on `DUES_VIEW` (Phase 4).
- `src/lib/permissions.ts` — `DUES_VIEW: "dues.view"` added to `FEATURES` (Phase 4, via add-permission skill).
- `drizzle/migrations/` — idempotent migration binding `dues.view` to `admin` and `board_member` roles (Phase 4, via add-permission skill).
- No new npm dependencies introduced.

---

## DECISION-011: Write-in Signups implementation details — `kind` discriminator, shared `AdminRsvpRow` type, no `force` flag, no server capacity check

**Status:** Resolved
**Date:** 2026-05-20

**Decision:**
Four implementation-level rulings for the Write-in Signups feature, downstream of DECISION-010:

1. **Explicit `kind` discriminator in POST body.** `POST /api/admin/events/[id]/signup` uses `{ kind: "member" | "guest", ... }` as the discriminator rather than inferring intent from the presence/absence of `userId`. If `kind` is absent but `userId` is present, the server treats it as `kind: "member"` for backward compatibility during the transition (existing call sites in `occurrence-rsvp-section.tsx` and `admin-event-rsvp-table.tsx` do not yet send `kind`; they are updated in step 8 of the implementation order).

2. **`AdminRsvpRow` hoisted to `src/types/admin-rsvp.ts`.** The local `RsvpRowData` interface in `occurrence-rsvp-section.tsx` and the local `RsvpRow` interface in `admin-event-rsvp-table.tsx` are equivalent types with different names. `WriteInForm`'s `onAdded` callback would require a mapped adapter at each call site if the types stayed local and diverged. Hoisting to `src/types/admin-rsvp.ts` resolves the naming conflict, removes the adapter risk, and gives TypeScript a single source of truth for the admin attendee row shape. The raw DB query result type (`RsvpRow` in `page.tsx` lines 12–20) stays local — it represents the pre-consolidation Drizzle query shape and is not the same thing.

3. **No `force: true` flag in the POST body.** The server never enforces a capacity cap on the admin signup path (existing behavior). The inline client warning (yellow advisory above the submit button) is the only capacity signal. The `created_by_user_id` audit column implicitly records admin-initiated override inserts. Adding a `force` flag would introduce a code path with no observable server-side effect.

4. **No server-side capacity check on admin POST.** Consistent with existing behavior — the admin path bypasses capacity enforcement. The client advisory warning satisfies the soft-warn policy from Phase 1.

**Rationale:** Explicit discriminators eliminate a class of client bugs (sending both `userId` and `guestName`). Hoisting the shared type captures the real duplication between the two components at the type level without merging their structurally different parents. Omitting `force` and the server cap check keeps the admin path consistent with its pre-existing behavior and avoids dead code.

**Impact:**
- `src/types/admin-rsvp.ts` — new file.
- `src/components/admin/occurrence-rsvp-section.tsx` — local `RsvpRowData` removed; imports `AdminRsvpRow`.
- `src/components/admin/admin-event-rsvp-table.tsx` — local `RsvpRow` removed; imports `AdminRsvpRow`.
- `src/app/(dashboard)/admin/events/[id]/page.tsx` — row-mapping output typed as `AdminRsvpRow`; `isGuest: !r.userId` added to non-recurring rows.
- `src/app/api/admin/events/[id]/signup/route.ts` — POST branches on `kind`; backward-compat fallback for absent `kind`.

---

## DECISION-010: API shape, lookup endpoint, component placement, and schema addition for Write-in Signups

**Status:** Resolved
**Date:** 2026-05-20

**Decision:**
Four structural rulings for the Write-in Signups feature (work-log: `docs/work-log/2026-05-20-write-in-signups.md`):

1. **Extend the existing admin signup route; no separate `/guest-signup` route.** `POST /api/admin/events/[id]/signup` accepts a discriminated body: either `{ userId, occurrenceDate? }` (existing member path) or `{ guestName, guestEmail?, occurrenceDate?, force? }` (new guest path). `DELETE` accepts either `{ userId, occurrenceDate? }` or `{ rsvpId }` (new guest path; requires eventId ownership check). A new `PATCH /api/admin/events/[id]/signup/[rsvpId]` route handles in-place guest edits at `src/app/api/admin/events/[id]/signup/[rsvpId]/route.ts`.

2. **Email-match lookup lives at `GET /api/admin/members/lookup?email=...`** (`src/app/api/admin/members/lookup/route.ts`). Gated by `FEATURES.EVENTS_EDIT` (not `MEMBERS_VIEW`). Returns only `{ id, name, email }` to limit PII exposure. No existing endpoint does a point-lookup by email; the full-list `GET /api/admin/members` over-fetches for this purpose.

3. **One shared `WriteInForm` component in `src/components/admin/write-in-form.tsx`.** Reused by both `occurrence-rsvp-section.tsx` (recurring path) and `admin-event-rsvp-table.tsx` (non-recurring path). The two call sites differ only in whether `occurrenceDate` is passed. No unification of the parent components is required.

4. **`created_by_user_id` added to `event_rsvps`.** Nullable `uuid` referencing `users.id` with `ON DELETE SET NULL`. Member self-signups leave it null; admin write-ins populate it with the session user's id. Idempotent migration: `ALTER TABLE event_rsvps ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;`. No index needed.

**Rationale:** Extending the existing route avoids duplicating auth preamble and response shape. The narrow lookup endpoint limits data exposure to exactly what the email-match CTA requires. A single shared `WriteInForm` captures the real duplication between the two admin RSVP components without merging their structurally different parent state. The audit column is low-risk (nullable, idempotent migration) and provides an accountable record for capacity-override inserts.

**Impact:**
- `src/app/api/admin/events/[id]/signup/route.ts` — extended (POST + DELETE branches).
- `src/app/api/admin/events/[id]/signup/[rsvpId]/route.ts` — new file (PATCH).
- `src/app/api/admin/members/lookup/route.ts` — new file (GET).
- `src/components/admin/write-in-form.tsx` — new file.
- `src/lib/db/schema.ts` — `createdByUserId` column added to `eventRsvps`.
- `drizzle/migrations/` — new idempotent migration for `created_by_user_id` column.
- Three latent bug fixes in `occurrence-rsvp-section.tsx`, `admin-event-rsvp-table.tsx`, and `admin/events/[id]/page.tsx` are included in the same implementation pass.

---

## DECISION-009: Component rename strategy and shadcn scaffold classification for Add-to-Calendar dropdown

**Status:** Resolved
**Date:** 2026-05-20

**Decision:**
Two structural rulings for the "Add to Calendar — Provider Dropdown" feature (work-log: `docs/work-log/2026-05-20-add-to-calendar-dropdown.md`):

1. **Rename in place, not alongside.** `src/components/events/add-to-calendar-button.tsx` is renamed to `add-to-calendar-dropdown.tsx` and its body is replaced entirely. A parallel file is not created. The old component (`AddToCalendarButton`) will have no callers after this feature ships; keeping both files creates an ambiguity that must be managed forever. Four call sites are updated as part of the same change. The new export is `AddToCalendarDropdown`.

2. **`npx shadcn@latest add dropdown-menu` is not a new npm dependency.** `@radix-ui/react-dropdown-menu` is already in `package.json`. The scaffold command generates `src/components/ui/dropdown-menu.tsx` — a TypeScript/TSX wrapper file — and adds no new entry to `pnpm-lock.yaml`. This is the same structural pattern as `src/components/ui/confirm-dialog.tsx` (a hand-written Radix wrapper). DECISION-008's "no new npm dep" ruling is preserved.

**Rationale:** Rename-in-place eliminates dead artifacts in a single commit. The shadcn scaffold ruling keeps the wrapper consistent with the rest of `src/components/ui/` without widening the dependency graph.

**Impact:**
- `src/components/events/add-to-calendar-button.tsx` → `src/components/events/add-to-calendar-dropdown.tsx` (renamed, body replaced).
- `src/components/ui/dropdown-menu.tsx` created via shadcn scaffold.
- Four call sites updated to import `AddToCalendarDropdown` from the new path.
- Dead `eventTitle` prop removed from the component and all call sites (v1.15.0 follow-up, closed here).

---

## DECISION-008: ICS generator, route, and button placement for Add-to-Calendar feature

**Status:** Resolved
**Date:** 2026-05-20

**Decision:**
Three structural rulings for the Add-to-Calendar feature (work-log: `docs/work-log/2026-05-20-add-to-calendar.md`):

1. **ICS generator lives in `src/lib/events.ts`.** The generator functions (`generateIcsEvent`, `generateIcsSeries`, `buildVcalendar`) are added as new exports to the existing file rather than a new `src/lib/ics.ts` or `src/lib/events/ics.ts`. `events.ts` already owns `generateOccurrences`, `parseWallClock`, and `easternOffsetFor` — all three are required by the ICS generator. Keeping them co-located avoids a cross-file import of a module that owns every piece of data the generator needs. File will reach ~500 lines; that is still well within a single-concern boundary.

2. **Route lives at `src/app/api/events/[id]/ics/route.ts`, not under a new `/api/ics/` namespace.** The existing public event API lives at `src/app/api/events/[id]/rsvp` and `src/app/api/events/[id]/signup`. An ICS download is another operation on the same event resource and belongs in the same resource tree. A top-level `/api/ics/` namespace adds a second resource tree that mirrors `/api/events/` without justification. A single handler at this path uses an internal branch (see ruling 3) to enforce `isPublic` vs. `FEATURES.MEMBERS_VIEW`.

3. **Single handler with an internal auth branch.** One `GET` handler checks: if the event is public (`isPublic === true`), serve the ICS to any caller; if private, require a session and `hasFeature(session.user.features, FEATURES.MEMBERS_VIEW)`. Two separate handlers (one public, one member) would share identical ICS generation logic and differ only in the five-line auth preamble — not enough divergence to justify duplication.

4. **No new npm dependency.** A hand-rolled ICS generator (~200 lines) is correct. The `ics` and `ical-generator` npm packages are actively maintained but neither is already in `package.json`. The ICS format needed here is a small, well-specified subset of RFC 5545 (VCALENDAR + VEVENT + optional VTIMEZONE). The project dependency evaluation criteria require that an existing dependency solve the problem before a new one is added. None does. Adding a new dep for ~200 lines of string building (where correctness is fully verifiable against the RFC) is not warranted. No bundle-size impact on the server-only route.

5. **`<AddToCalendarButton>` lives in `src/components/events/`.** It is an event-surface-specific component, not a general UI primitive, so `src/components/ui/` is wrong. Its only peer event components are `occurrence-signup-list.tsx` and `single-event-signup.tsx`, both already in `src/components/events/`.

**Rationale:** Nesting under the existing events resource tree and co-locating the generator with its dependencies are the two choices that minimize new indirection. The single-handler-with-branch pattern matches the existing RSVP handler, which also branches on session state internally.

**Impact:**
- `src/lib/events.ts` gains ICS generator exports (~200 lines).
- New route: `src/app/api/events/[id]/ics/route.ts`.
- New component: `src/components/events/add-to-calendar-button.tsx`.
- No new npm dependency. No new migration. No new FEATURES key.

---

## DECISION-007: `OccurrenceGroupData.date` stays typed as `Date`; `rsvpByDate` key uses `format(d, "yyyy-MM-dd HH:mm:ss")`

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
`OccurrenceGroupData.date` remains typed as `Date` (not changed to `string`). After `eventRsvps.occurrenceDate` switches to `mode: "string"`, the `rsvpByDate` map key in `src/app/(dashboard)/admin/events/[id]/page.tsx` changes from `row.occurrenceDate?.toISOString() ?? "null"` to `row.occurrenceDate ?? "null"` (plain string from DB). The lookup key at line 119 changes from `d.toISOString()` to `format(d, "yyyy-MM-dd HH:mm:ss")` (date-fns, local components) so both sides of the map use the same string format that Postgres returns.

**Rationale:** `generateOccurrences` returns `Date[]`; changing `OccurrenceGroupData.date` to `string` would cascade type changes through the entire admin page, the orphan-detection loop, and the sort comparator — more churn than benefit. The Date type is correct and coherent as long as dates are locally parsed on the way in (via `parseWallClock`). The map key format change is a surgical two-line edit that makes both sides consistent without touching the type.

**Impact:** Two lines in `src/app/(dashboard)/admin/events/[id]/page.tsx` — lines 99 and 119. No type change to `OccurrenceGroupData`.

---

## DECISION-006: Helper placement and `formatEventWhen` centralization for wall-clock refactor

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
New time helpers (`parseWallClock`, `formatEasternOffset`, `formatEventWhen`) live in the existing `src/lib/events.ts`, not in a new file or subdirectory. A single `formatEventWhen(event): string` helper is required and must be the only place that branches on `event.isAllDay` for display purposes — callers must not re-implement the branch inline.

**Rationale:** `events.ts` is 245 lines and handles a single domain. Adding three small helpers (~30 lines each) reaches ~330 lines — still cohesive. A new `src/lib/event-times.ts` file would require updating ~12 import sites and adds indirection without justification at this size. The centralized `formatEventWhen` helper is required because 10+ display sites need the all-day branch; a missing branch at any one site produces a silent wrong display (time shown when it should be omitted, or vice versa). Making the branch optional-inline creates an untestable invariant.

**Impact:** `src/lib/events.ts` gains three new exported functions. All display sites import and call `formatEventWhen` rather than branching directly on `isAllDay`.

---

## DECISION-005: Migration shape and `mode: "string"` annotation for wall-clock columns

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
One migration file (`drizzle/migrations/0037_events_wall_clock_and_all_day.sql`) adds the single new DDL change: `ALTER TABLE events ADD COLUMN IF NOT EXISTS is_all_day boolean NOT NULL DEFAULT false`. The `mode: "string"` annotation on `events.startDate`, `events.endDate`, `events.recurrenceEndDate`, and `eventRsvps.occurrenceDate` is a Drizzle TypeScript-only annotation — it instructs Drizzle to return the raw Postgres string rather than constructing a `Date` object. It emits no DDL and will not alter or drop the column on `db:push`. No second migration file is needed for the mode changes.

**Rationale:** Splitting into two migrations (one for `is_all_day`, one as a documentation note) adds file noise with no operational benefit — the mode annotation requires zero SQL. A single migration with only the `ADD COLUMN IF NOT EXISTS` statement satisfies the idempotency invariant (CLAUDE.md: "Every statement must be idempotent"). Confirming mode is DDL-safe is critical: Drizzle's `mode` option on `timestamp()` affects only the JS return type, not the Postgres column definition. The column remains `timestamp without time zone` in the database regardless of the `mode` value in `schema.ts`.

**Impact:** New file `drizzle/migrations/0037_events_wall_clock_and_all_day.sql` with one statement. `src/lib/db/schema.ts` updated to add `mode: "string"` to four columns and a new `isAllDay` boolean column on the `events` table.

---

## DECISION-004: RSVP count display on cancelled occurrence rows

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
On public and member-portal cancelled occurrence rows (`OccurrenceSignupList`), suppress the "X attendees" count and the action button entirely — render only the "Cancelled" badge and optional reason text. In the admin accordion, always show the count; admins need to know how many people were signed up before the cancellation.

**Rationale:** Showing a signup count on a row where signups are impossible is confusing to members. Admins have a legitimate need for the number (historical data; they may want to notify those members manually in v2). The difference in behavior is appropriate to the audience.

**Impact:** `OccurrenceSignupList` checks `row.isCancelled` before rendering the count `<p>` and the action button. Admin accordion header always renders its count span regardless of `isCancelled`.

---

## DECISION-003: Orphaned cancellation records surfaced in admin accordion as extra rows

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
When an admin edits the recurrence rule so that a previously cancelled date falls outside the new generated window, the cancellation record is NOT silently hidden and NOT accompanied by a warning at edit time. Instead, the admin detail page (`src/app/(dashboard)/admin/events/[id]/page.tsx`) detects orphans by comparing the `eventOccurrenceOverrides` set against the generated occurrence list and appends them to `occurrenceGroups` with a display label that includes "outside current recurrence rule." The admin can Restore (delete the record) to clean up. Sort order is chronological across generated and orphaned rows.

**Rationale:** Option (b) — warn at recurrence-rule edit time — requires changes to the event-edit form and introduces a two-step flow (edit, then decide what to do about orphans). Option (c) — leave invisible — is a data integrity risk. Option (a) is purely additive (no form changes) and keeps orphan management explicit in the same accordion where cancellations live.

**Impact:** `src/app/(dashboard)/admin/events/[id]/page.tsx` gains post-generation orphan detection logic. No new API surface required.

---

## DECISION-002: `generateOccurrences` signature unchanged; only `getNextOccurrence` gains cancellation exclusion

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
The architect's suggestion specified `generateOccurrences` should gain a `cancelledDates: Set<string>` parameter to skip cancelled dates. After reading all call-sites, this is the correct place for the exclusion on the `/events` list (next-occurrence computation) but the WRONG place for the detail-page occurrence list, where cancelled dates must APPEAR (with a badge) rather than be skipped. To avoid a confusing dual-mode parameter ("sometimes skip, sometimes don't"), the exclusion is placed only on `getNextOccurrence`, which is responsible for "what is the next bookable date." `generateOccurrences` remains a pure date generator. Callers that need the `isCancelled` flag annotate their `OccurrenceRow[]` after generation using the cancellation map fetched separately.

**Rationale:** Filtering inside `generateOccurrences` would produce inconsistent behavior depending on caller intent. The function's contract is "give me all dates in the window" — callers decide what to do with each date. `getNextOccurrence`'s contract is "give me the next actionable date" — skipping cancelled dates is correct there.

**Impact:** `src/lib/events.ts` — `getNextOccurrence` and its `findNextDayOfWeek` helper gain `cancelledDates: Set<string> = new Set()`. `generateOccurrences` is unchanged. Five `getNextOccurrence` call-sites each gain a batch cancellation fetch.

---

## DECISION-001: Cancel-occurrence table name, occurrence_date column type, and cancel API shape

**Status:** Resolved (Impact bullet about `generateOccurrences` partially superseded by [DECISION-002](#decision-002-generateoccurrences-signature-unchanged-only-getnextoccurrence-gains-cancellation-exclusion))
**Date:** 2026-05-18

**Decision:**
Three rulings for the "Cancel a Single Event Occurrence" feature (work-log: `docs/work-log/2026-05-18-cancel-event-occurrence.md`):

1. **Table name:** `event_occurrence_overrides`. This is the right name: it is additive (does not touch `events` or `eventRsvps`), is self-describing, and leaves room for future override types (e.g., time-change overrides) without a rename. Columns: `id uuid PK`, `event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE`, `occurrence_date date NOT NULL`, `cancelled_at timestamp WITH TIME ZONE NOT NULL`, `cancelled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL`, `cancellation_reason text`. Composite unique on `(event_id, occurrence_date)`.

2. **`occurrence_date` is a `date` column (no time component).** The existing `eventRsvps.occurrenceDate` is a `timestamp` (naive, no timezone — the known project bug). We do NOT use that column type for the new table. Occurrence cancellation is keyed on the calendar date of the occurrence (`YYYY-MM-DD`), not its wall-clock time. A `date` column avoids timezone ambiguity entirely: the API route segment carries `YYYY-MM-DD`, the DB stores `YYYY-MM-DD`, and the UI badge lookup is a string equality check. This is safe because every occurrence of a given event on a given calendar date is the same occurrence — there is no scenario where two occurrences of the same event share the same calendar date.

3. **Single toggle endpoint:** `POST /api/admin/events/[id]/occurrences/[date]/cancel` with body `{ cancelled: boolean, reason?: string }`. Rationale: a single endpoint is easier to guard (one auth check, one hasFeature check, one rate-limit surface), easier to test (one contract), and the body makes the intent explicit. Two separate endpoints (cancel + restore) would duplicate boilerplate and create an ambiguous "which one do I call?" question for the client. The `[date]` segment carries a `YYYY-MM-DD` string. When `cancelled: true`, the handler upserts a row into `event_occurrence_overrides`; when `cancelled: false`, it deletes it. The handler returns the updated occurrence state.

**Rationale:** All three choices minimize ambiguity at the data-model and API boundaries. The `date` column type is the most load-bearing decision: using `timestamp` here (matching the existing `eventRsvps.occurrenceDate`) would re-introduce the naive-timestamp bug and create a join surface where two `timestamp` values with different TZ assumptions must be compared for equality — a known failure mode in this codebase. The `date` column sidesteps that entirely.

**Impact:**
- New file: `drizzle/migrations/0036_event_occurrence_overrides.sql` (idempotent: `CREATE TABLE IF NOT EXISTS`, unique constraint guarded with `IF NOT EXISTS`).
- New table in `src/lib/db/schema.ts`: `eventOccurrenceOverrides`.
- New route: `src/app/api/admin/events/[id]/occurrences/[date]/cancel/route.ts`.
- ~~`src/lib/events.ts` — `generateOccurrences()` gains an optional `cancelledDates: Set<string>` parameter.~~ **Superseded by DECISION-002:** the parameter was placed on `getNextOccurrence` (and its `findNextDayOfWeek` helper) instead. `generateOccurrences` is unchanged.
- `src/types/events.ts` — `OccurrenceRow` gains `isCancelled: boolean` and `cancellationReason: string | null`.
- No new npm dependency. No new `FEATURES` key. No new role binding.

---

<!-- Decisions are appended above this line, newest first. -->
