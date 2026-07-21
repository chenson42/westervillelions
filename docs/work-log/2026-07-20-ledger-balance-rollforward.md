# Ledger Fund Balance Rollforward — Work Log

> **Slug:** `2026-07-20-ledger-balance-rollforward`
> **Surface:** (dashboard) admin — The Ledger (`/admin/ledger`, per-fund detail, compliance, reports)
> **Permission(s):** No change — existing `ledger.*` gates cover this
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant — Phases 1–3 condensed into the originating brief (root cause fully diagnosed before Phase 4 started)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | (brief) | Skipped — condensed into brief | Root cause confirmed; fix scope named | 2026-07-20 |
| 2 — Architectural review | (brief) | Skipped — no invariants change (pure-function reuse + one companion SQL query, same shape as DECISION-027/028) | — | 2026-07-20 |
| 3 — Technical design | (brief) | Skipped — condensed into brief; design decisions ratified as DECISION-029 | — | 2026-07-20 |
| 4 — Implementation | api-developer | Complete | — | 2026-07-20 |
| 5 — Verification | api-developer (bug-fix variant: implementer runs it) | PASS | PASS | 2026-07-20 |
| 6 — Shipped vs intent | (pending — hand off to analyst if desired) | — | — | — |

**Skip notation:** Per CLAUDE.md's bug-fix variant, Phases 1–3 are condensed into the task brief that kicked off this fix (root cause was already diagnosed in the main session before any agent was invoked). No invariant changes were needed — the fix reuses the existing `fundBalanceCents()` pure function and follows the exact query/reuse pattern DECISION-027/028 already established for the aged-public-funds guardrail, so Phase 2 (architect) is skipped with that precedent as justification.

---

## The Bug (user-visible)

On `/admin/ledger` with the current FY selected (FY2026, Jul 2026 – Jun 2027, no transactions yet in that window), fund balances displayed the fund's static inception-date seed instead of the true current balance:

| Fund | Displayed (bug) | True balance |
|------|------------------|--------------|
| Club — Administrative Fund | $19,090.10 | $16,134.12 |
| Club — Activity Fund | $0.00 | $84.52 |
| Foundation — Charitable Fund | $28,569.30 | $4,836.57 |

The flaw was invisible until the club's real books (276 transactions spanning FY2024-25 and FY2025-26) were seeded on 2026-07-20 via `scripts/import-quicken-ledger.ts` — prior to that, every fund's opening seed and its actual multi-year balance happened to coincide (all activity was in the "first" FY the fund had seen).

## Root Cause

In `src/lib/ledger-queries.ts`, three functions computed a fund's `openingCents` for the selected FY as the raw `fund.openingBalanceCents` column — a one-time seed value anchored at the fund's inception (e.g. 6/30/2024) and never itself mutated — and `endingCents` as `openingCents + <selected-FY posted income> − <selected-FY posted expense>`:

- `getOverview()` (fundSummaries construction)
- `getFundReport()` (single-fund Budget/Actual/Variance report)
- `getEntityReport()` (multi-fund entity report)

For any FY after a fund's first, this silently dropped every prior fiscal year's net posted activity from both the opening and ending figures — the exact class of FY-scoping blind spot DECISION-028 fixed for the aged-funds guardrail (Query A2); this is the display-side counterpart the brief named at the outset.

## Reproduction (pre-fix)

1. Seed the DB with `scripts/import-quicken-ledger.ts` (276 real transactions, FY2024-25 + FY2025-26).
2. Visit `/admin/ledger` with the default entity (club) and default FY (current, FY2026 — no txns yet in that window).
3. Administrative Fund card reads $19,090.10 (the raw seed); Activity Fund reads $0.00. Toggle to Foundation: Charitable Fund reads $28,569.30.
4. All three are wrong — they omit two prior fiscal years of real posted activity.

## The Fix

**New pure function** — `rolledForwardOpeningCents(seedCents, preFyTxns)` in `src/lib/ledger.ts`:

```ts
export function rolledForwardOpeningCents(
  seedCents: number,
  preFyTxns: Array<FlowRow & { status: string }>,
): number {
  const posted = preFyTxns.filter((t) => t.status === "posted");
  return fundBalanceCents(seedCents, posted);
}
```

Filters defensively to `status === 'posted'` and delegates the actual arithmetic to the existing canonical `fundBalanceCents()` — no second, hand-rolled balance formula (same reuse discipline DECISION-028 established for the cross-FY aged-funds balance).

**New companion SQL query**, added to each of the three call sites — mirrors DECISION-027/028's Query A2 shape/style exactly:

```sql
SELECT fund_id, flow, SUM(amount_cents) AS total_cents
FROM ledger_transactions
WHERE entity_id = :entityId AND fund_id IN (:fundIds)
  AND status = 'posted' AND txn_date < :fyStart
GROUP BY fund_id, flow
```

Posted-only and unbounded below (no lower date bound), grouped by fund + flow. The results feed `rolledForwardOpeningCents()` per fund; `endingCents` becomes `rolledForwardOpening + <FY income> − <FY expense>`, unchanged in shape from before.

## Call Sites Fixed vs. Already-Correct

**Fixed (primary computation, each gained one companion query):**
- `getOverview()` — `src/lib/ledger-queries.ts` (fundSummaries construction, one batched query across all of the entity's funds)
- `getFundReport()` — same file (one query, single fund)
- `getEntityReport()` — same file (one batched query, mirrors `getOverview()`'s shape)

**Already correct / fixed automatically (derived, not primary):**
- `getComplianceOverview()` — `entityBalance = overview.funds.reduce((s, f) => s + f.endingCents, 0)`. Derives from `getOverview()`'s already-fixed `fundSummaries`; no code change needed.
- `get990Prep()` — same pattern, derives `entityBalance` from `getOverview()`'s `funds[].endingCents`; fixed automatically.
- `getEntityReport()`'s own `entityBalance` sum — derives from the now-fixed `fundReports[].endingCents` within the same function; fixed automatically as part of the primary fix above.
- The `agedPublicFunds` guardrail path (Query A2 + `countAgedPublicFunds()`, DECISION-028) was already cross-FY-correct by construction (it computes its own independent cross-FY balance, never touching `fundSummaries[].endingCents`) — **not touched**.

## Behavioral Note — Reserves Guardrail Input Changed Meaning (as expected, not a regression)

`entityBalanceCents` fed into `guardrails()` (Check 4 — reserves below threshold, and Check 6 — negative fund balance) now reflects the TRUE rolled-forward balance instead of a FY-scoped delta-only figure. Both checks' *intent* was always "is the club's real money low or negative right now" — the FY-scoped figure was silently wrong for any FY after a fund's first, so this is a correctness fix to those guardrails too, not a change in what they mean. Documented inline at the `entityBalance` computation in `getOverview()` and in DECISION-029.

## Tests (Vitest, `src/lib/ledger.test.ts`)

New `describe("rolledForwardOpeningCents", ...)` block, 5 tests — all four named by the brief plus one extra multi-row regression matching `fundBalanceCents`'s own coverage shape:

1. `"first FY (no pre-FY txns): opening = seed (regression — current behavior preserved)"`
2. `"later FY: opening = seed + prior income − prior expense (real repro numbers: seed 2856930, prior net −2373273 → opening 483657)"`
3. `"pre-FY pending/rejected txns excluded from rollforward"`
4. `"fund with zero seed and prior activity (club Activity: 0 + 8452 → 8452)"`
5. `"nets multiple posted pre-FY rows across flows, same as fundBalanceCents"`

All 5 new tests pass. All 322 pre-existing tests remain green — **327/327 total.**

## Verification (Phase 5 — bug-fix variant, run by the implementer)

- `pnpm exec tsc --noEmit` — **PASS** (0 errors)
- `pnpm test` — **PASS** (327/327, 9 test files)
- `pnpm build:only` — **PASS** (production build completed, all routes compiled)

**Live repro against the dev server** (already running on `localhost:3000`, seeded DB — DB verified directly via a scratch `postgres` script, not read from the app, to get independent expected values before checking the page):

| Fund (FY2026, current) | Before (bug) | Expected (SQL) | After (page) |
|---|---|---|---|
| Club Administrative | $19,090.10 | $16,134.12 | **$16134.12** ✓ |
| Club Activity | $0.00 | $84.52 | **$84.52** ✓ |
| Foundation Charitable | $28,569.30 | $4,836.57 | **$4836.57** ✓ |
| Foundation Scholarship | (untested pre-fix) | $0.00 | **$0.00** ✓ |

Prior-FY spot check (FY2025, i.e. FY2025-26) — computed independently via SQL first, then compared to the page:
- Club Administrative Fund: opening = seed ($19,090.10) + FY2024-25 posted net = **$20,023.15**; ending (rolled-forward opening + FY2025-26 posted net) = **$16,134.12** — matches FY2026's opening exactly, as it must (continuity check). Page confirmed via authenticated Playwright: `$16134.12` present on `/admin/ledger?entity=club&fy=2025`.

Verified via a temporary authenticated Playwright spec (`signInAsAdmin` from `e2e/helpers/auth`, run with `pnpm exec dotenv -e .env.local -- playwright test`) covering: club overview (current FY), foundation overview (current FY), club overview prior FY (2025), `/admin/ledger/compliance` renders without error, `/admin/ledger/reports` renders without error. **5/5 passed.** The temp spec file and `playwright-report`/`test-results` artifacts were deleted after verification; the dev server was left running per instructions.

## Verdict: PASS

## Outputs

- `src/lib/ledger.ts` — new exported `rolledForwardOpeningCents(seedCents, preFyTxns)`.
- `src/lib/ledger-queries.ts` — new pre-FY rollforward companion query + `rolledForwardOpeningCents()` call in `getOverview()`, `getFundReport()`, `getEntityReport()`; `FundReport`/`FundSummary` type doc comments updated; explanatory comment added at the `entityBalance` computation in `getOverview()` documenting the reserves-guardrail behavioral note.
- `src/lib/ledger.test.ts` — new `describe("rolledForwardOpeningCents", ...)` block (5 tests, all passing).
- `docs/decisions.md` — DECISION-029 (this fix, full detail).
- No schema change, no new routes, no new permissions.

## Open Questions / Handoff Notes

- No UI/API contract changed — `FundReport`/`FundSummary`/`EntityOverview` shapes are unchanged, only the *values* inside `openingCents`/`endingCents` are now correct. No `ux-developer` handoff needed; the existing UI consumes the corrected values with zero code change.
- Recommend routing to **analyst** for the Phase 6 shipped-vs-intent sign-off (bug-fix variant: confirms the bug no longer manifests for the user) to formally close the pipeline, though the fix is functionally complete and verified.
- Unrelated observation, not acted on: at the time this fix was verified, `git status` showed two files modified outside this task's scope (`docs/treasurer-todo.md`, `src/components/admin/admin-sidebar.tsx`) and one untracked temp spec (`e2e/temp-admin-nav-groups.spec.ts`), plus a `v1.27.0` commit (`7b36297`) landed on `main` mid-session that included prior uncommitted Ledger inc7 / dues-sidebar work. These appear to be from a concurrent session and were left untouched — not part of this fix's diff (confirmed via `git diff --stat` scoped to the three files this fix touches).
