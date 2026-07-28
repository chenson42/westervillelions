# Monthly Statement Gate — Exclude Outstanding Checks — Work Log

> **Slug:** `2026-07-28-report-gate-outstanding-checks`
> **Surface:** (dashboard) member portal — `/members/financial-reports/[entitySlug]/[month]`
> **Permission(s):** none (no permission change; existing member-linked gate unchanged)
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Root Cause

`isMonthGatedForEntity()` (and `getLatestOpenMonthForEntity()`'s independent candidate
computation) treated ANY posted, unreconciled transaction dated on/before month-end in a
member-exposed fund as a reason to gate the month — including legitimately-outstanding
(uncashed) checks that the report already accounts for via `bookVsCashDivergenceCents` and
each line's `hasUncashedCheck` flag. Because the gate is a "no unreconciled activity on/before
this boundary" predicate, one outstanding check permanently blocks every later month too, not
just its own month.

## Reproduction (pre-fix)

Foundation/Charitable fund had exactly two unreconciled rows, both outstanding checks dated
2026-03-07 (`payment_method='check', flow='expense', reconciled=false`). `isMonthGatedForEntity()`
gated March 2026 and every month after it (April, May, June), even though those months' books
were otherwise correct and the report already footnotes the two outstanding checks. The
landing-page picker for Foundation/Charitable stopped at February 2026.

Club/Administrative was unaffected by this bug — its 26 unreconciled rows are non-check
transactions or check+income rows (dues paid by paper check), none of which qualify for the
carve-out; June 2026 correctly stays gated (earliest unreconciled row 2026-06-24).

## The Fix

Added `isOutstandingCheckRow()` in `src/lib/financial-report-queries.ts`, matching
`getDashboard()`'s `uncashedChecks` predicate in `src/lib/ledger-queries.ts` exactly:

```ts
function isOutstandingCheckRow(r: { paymentMethod: string | null; flow: string }): boolean {
  return r.paymentMethod === "check" && r.flow === "expense";
}
```

`isMonthGatedForEntity()`'s row-narrowing predicate now selects `paymentMethod` and `flow`
alongside `txnDate`/`fundKind`, and excludes `isOutstandingCheckRow()` rows from the
"unreconciled activity blocks this month" test:

```ts
return rows.some(
  (r) =>
    isMemberExposedKind(r.fundKind) && r.txnDate <= monthEnd && !isOutstandingCheckRow(r),
);
```

`getLatestOpenMonthForEntity()`'s independent `blockingDates` computation (used to derive the
picker's candidate month, separately from the final `isMonthGatedForEntity()` re-check) got the
same exclusion — without it, the picker's candidate would still have been capped at the month
before the earliest outstanding check, even though the gate itself was fixed.

Keyed deliberately on `flow='expense'`, not `paymentMethod='check'` alone: a dues payment
received by paper check (`payment_method='check', flow='income'`) is a genuinely-unreconciled
deposit and must keep gating. A test (`STILL gates on an unreconciled check+INCOME row`) fails if
someone widens the exclusion to all `payment_method='check'` rows.

## Tests Added (`src/lib/financial-report-queries.test.ts`)

1. `does NOT gate on an unreconciled OUTSTANDING CHECK (payment_method='check', flow='expense')` — outstanding check alone no longer gates.
2. `STILL gates on an unreconciled check+INCOME row (dues paid by paper check)` — regression guard for the flow='expense' keying.
3. `STILL gates on an unreconciled non-check expense (e.g. debit_card/bill_pay)` — non-check expenses are unaffected.
4. All pre-existing `isMonthGatedForEntity` tests (future-month gate, exposure boundary, empty-backlog, elapsed-month) pass unchanged — canned rows in those tests carry no `paymentMethod`/`flow` fields, so `isOutstandingCheckRow()` returns `false` for them and old behavior is preserved.

## Phases Skipped

- **Phase 1 (analyst):** Skipped. Bug and intended fix were fully specified by the user with an exact predicate, an existing app-wide definition to reuse (`getDashboard()`'s `uncashedChecks`), and expected before/after behavior for both affected funds — no functional ambiguity to refine.
- **Phase 2 (architect):** Skipped. No new files, no new dependency, no schema/migration, no invariant touched — a pure predicate narrowing inside an existing query function.
- **Phase 3 (tech-lead):** Skipped. Trivial, single-function predicate change with the exact fix and test list handed down; no design doc needed.

## Gates

- `pnpm exec tsc --noEmit`: PASS (clean).
- `unset DATABASE_URL DB_URL; pnpm test`: PASS — 614 passed (611 baseline + 3 new), fully hermetic.
- `pnpm build:only`: PASS.
- No `console.log`. No schema/migration touched. No version bump, no release notes, no commit, no `db:push` (per instructions).

## Open Questions / Handoff Notes

- **Next agent: qa**, for Phase 5. Reproduce the pre-fix gate leak against the prod-shaped scenario (an outstanding check gating all subsequent months) if a seeded/canned fixture is available, then confirm the fix clears it; confirm the picker (`getLatestOpenMonthForEntity`) now offers through June 2026 for Foundation/Charitable and still stops at May for Club/Administrative (June gated on the 2026-06-24 non-check row) if reachable against real/seeded data.
- Headed for a v1.42.1 patch release once qa signs off — release-notes/version bump intentionally not done here per the gates above.

---

## Phase 5 — Verification — 2026-07-28

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** Both `isMonthGatedForEntity()` and `getLatestOpenMonthForEntity()` carry the
`isOutstandingCheckRow()` carve-out. Reverting the exclusion reproduces the exact pre-fix
red/green cycle the bug-fix discipline requires: dropping the exclusion entirely turns the
"does NOT gate on an outstanding check" test red; simulating the over-broad wrong-fix
(`paymentMethod === "check"` alone, ignoring `flow`) turns the "STILL gates on check+income"
test red. Restoring the real fix turns both green again, and the full hermetic suite passes at
614/614. Typecheck and production build are clean. A live check against the local dev DB's
actual Foundation/Charitable data (two outstanding checks, `check`/`expense`/unreconciled, dated
2026-03-07 — the literal prod scenario this fix addresses) confirms `getLatestOpenMonthForEntity`
now returns `2026-06` for that entity, not capped at February.

### What I did

1. Read `src/lib/financial-report-queries.ts` in full and confirmed `isOutstandingCheckRow()`
   (`paymentMethod === "check" && flow === "expense"`) is applied in both
   `isMonthGatedForEntity()`'s row predicate (line ~364) and
   `getLatestOpenMonthForEntity()`'s `blockingDates` filter (line ~561) — the second is the one
   that actually drives the picker's candidate month independently of the final re-check, and
   was the real cause of the Feb ceiling.
2. Ran `pnpm exec tsc --noEmit` — clean, no output.
3. Ran `unset DATABASE_URL DB_URL; pnpm test` — hermetic, 614/614 passed, 20 test files.
4. Ran `pnpm build:only` — passed, all routes compiled including
   `/members/financial-reports/[entitySlug]/[month]`, no errors in build output.
5. **Regression-discipline reproduction (before/after):**
   - Reverted `isMonthGatedForEntity()`'s return statement to drop `!isOutstandingCheckRow(r)`
     entirely (simulating "no fix"). Ran the 3 new tests: the "does NOT gate on an unreconciled
     OUTSTANDING CHECK" test went **red** (`expected true to be false`) as expected; the two
     "STILL gates" tests stayed green (correct — they test behavior that was already true before
     this fix and must remain true after; they're regression guards against over-exclusion, not
     reproductions of the original under-exclusion bug).
   - Restored, then separately simulated the *wrong, over-broad* fix — excluding on
     `paymentMethod === "check"` alone, ignoring `flow`. Ran the 3 tests again: the "STILL gates
     on an unreconciled check+INCOME row" test went **red** (`expected false to be true`),
     exactly as its own doc comment promises ("this must fail if someone excludes all
     payment_method='check' rows") — confirming this is the test that would catch a regression
     to the wrong keying.
   - Restored the real fix (`!isOutstandingCheckRow(r)`, keyed on `flow === "expense"`). Reran
     `pnpm test`: 614/614 green, confirmed no `QA-SCRATCH` artifacts left in the file (`grep`
     returned no matches), `git status --short` showed only the implementer's original two
     modified files plus this work-log — no scratch residue.
6. **Live check against local dev DB** (`.env.local`'s `DATABASE_URL`, read-only, no writes):
   queried `ledger_transactions`/`ledger_funds`/`ledger_entities` directly via `psql` and
   confirmed the Westerville Lions Foundation's `charitable` fund has exactly 2 unreconciled
   rows, both `payment_method='check', flow='expense', txn_date='2026-03-07'` — the literal prod
   scenario in the work-log's Root Cause section. Ran `getLatestOpenMonthForEntity()` and
   `isMonthGatedForEntity()` directly (via a scratch `tsx` script, deleted after) against this
   real data: Foundation/Charitable resolved to latest-open-month `2026-06`, and every month
   Feb–June checked individually as NOT gated. (Club/Administrative currently has 0 unreconciled
   rows in the local DB — the 26-row/June-gated state described in the work-log's Root Cause
   section reflects an earlier point in this live, evolving local DB, not its current state — so
   Club also resolved to `2026-06` with nothing to gate on right now. This is expected DB drift,
   not a test discrepancy; the Foundation scenario is the one that actually exercises the fix.)

### Outputs

- No source files changed by qa — verification only. Files read/exercised:
  `/Users/cshenso/git/westervillelions/src/lib/financial-report-queries.ts`,
  `/Users/cshenso/git/westervillelions/src/lib/financial-report-queries.test.ts`.
- Scratch file created and deleted during the session (no trace left):
  `/private/tmp/claude-501/-Users-cshenso-git-westervillelions/ff4af343-e6ab-4e71-b1dc-0d97cc36ab87/scratchpad/qa-live-check.ts`.
- No decisions.md entry needed — no design change, verification only.

### Gates

- `pnpm exec tsc --noEmit`: **PASS** (clean).
- `unset DATABASE_URL DB_URL; pnpm test`: **PASS** — 614 passed, 0 failed, 20 test files, hermetic.
- `pnpm build:only`: **PASS** — clean build, all routes present, no warnings beyond the routine
  `vite-tsconfig-paths` plugin notice.
- Regression reproduction (fail-without/pass-with): **PASS** — both experiments (no-fix revert,
  over-broad-fix revert) turned exactly the expected test red, and the real fix turns everything
  green.
- Both functions carry the carve-out: **CONFIRMED** by direct source read, not inference from
  passing tests.
- No over-exclusion regression: **CONFIRMED** — all pre-existing `isMonthGatedForEntity` tests
  (future-month gate, current-month gate, exposure boundary/Activity/Scholarship, empty backlog,
  elapsed-month, after-month-end date) pass unchanged in the full 614-test run.
- Live check against local dev DB: **PASS** — Foundation/Charitable's real outstanding-check data
  clears through June 2026 under the fix; see "What I did" item 6.
- Feature-gate audit: no protected routes or server actions touched by this fix — it's a pure
  predicate change inside an existing internal query function already gated by its caller
  (`getMonthlyStatement()` / the `[entitySlug]/[month]` page's existing `impact.view`-style
  member-linked check, unchanged by this fix). No new `FEATURES.*` surface.

### Verdict: PASS

### Open questions / handoff notes

- **Next agent: analyst**, for Phase 6 (bug-fix variant) shipped-vs-intent sign-off.
- Nothing outstanding from qa. The implementer's note that this is headed for a v1.42.1 patch
  release stands — release-notes/version bump was intentionally deferred to that step, not part
  of Phase 5.
