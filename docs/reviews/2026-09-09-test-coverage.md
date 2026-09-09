# Test Coverage Review — 2026-09-09

**Owner:** qa
**Status:** Diagnosis only (read-only pass) — this review is 76 days overdue; this document is the evidence base. Log entry in `docs/reviews/log.md` to be appended separately once remediation is scheduled.

## Context

A full serial run (`pnpm test:e2e --workers=1`) produced **131 passed, 13 failed, 1 skipped, 41 did not run**. Three failures were pre-triaged and excluded from this pass:

- `cancel-occurrence.spec.ts:56` / `:133` — hardcoded dates now in the past (date rot).
- `ledger-category-management.spec.ts:196` — `getByLabel('Search')` strict-mode collision with the new `#admin-nav-search`.

This document diagnoses the remaining 10, using `test-results/*/error-context.md` from the failing run plus a read-only query against the dev Neon DB (`.env.local`'s `DATABASE_URL`). No files were edited, no server was started, no scripts were run.

## Headline finding — one real regression, ranked #1

**The HEIC receipt-upload WASM decoder is completely broken in production**, not just in this test run. This is a genuine product bug, not a test-maintenance item — see Cluster 3 below.

## Ranked findings (most user-impact first)

### 1. `receipt-heic-upload.spec.ts:42`, `:61`, `:83` — REAL PRODUCT REGRESSION

**Failing assertion:** `:42` — `getByText(/ready to attach/)` never appears (30s timeout). `:61` — alert text is `"Couldn't load the HEIC photo converter — check your connection and try again, or export the photo as JPEG."` instead of the expected decode-failure copy. `:83` — same chunk-load alert instead of the expected decode-failure copy.

**Root cause, with evidence:** All three tests — including the two that upload deliberately-broken files, which should only ever reach the *decode* stage — fail identically at the *chunk-load* stage (`HeicDecodeStageError` with `stage: "chunk-load"`, per `src/lib/heic-decode.ts:157-163`). That uniformity across a valid file, a truncated file, and a plain-text file renamed `.heic` rules out anything file-content-related; the WASM module itself never loads.

`src/lib/heic-decode.ts` lazy-loads `libheif-js/wasm-bundle`, an Emscripten build that must call `WebAssembly.instantiate` to run. `next.config.ts`'s CSP `script-src` is:

```
script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://www.googletagmanager.com
```

`'unsafe-eval'` / `'wasm-unsafe-eval'` is **not present**. Chromium requires one of those two tokens in `script-src` before it will compile/instantiate WebAssembly; without it, `WebAssembly.instantiate` throws synchronously, which `decodeHeicFileToJpegBlob`'s try/catch classifies as `"chunk-load"` — producing exactly the alert text observed.

The chain that produced this:

- **DECISION-038** (2026-07-21, choice of HEIC decode library) explicitly justified *not* touching `next.config.ts`: *"No change to `next.config.ts` — confirmed the existing CSP (`worker-src 'self' blob:`, `script-src ... 'unsafe-eval' ...`) already permits the `Blob`-Worker/WASM mechanics `heic2any` uses."* The feature's CSP safety argument was `'unsafe-eval'`'s presence.
- **Commit `4aea4f8`** (2026-09-04, "site-review overhaul... real 404", v1.75.0) removed `'unsafe-eval'` from `script-src`. `docs/work-log/2026-09-04-site-review-fixes.md` §7 records the change and its verification: *"`pnpm build:only` passed, and `/` in dev showed no CSP console errors... No rollback needed."* — verified only against the public homepage, never against the admin ledger receipt-upload flow that actually depends on WASM.
- The same work-log even logged the symptom without connecting it: *"a persistent Next.js dev-mode '1 Issue' overlay badge... traced it to a console error (`eval() is not supported... Content-Security-Policy`)... pre-existing dev-only noise, not a regression."* — dismissed as React dev tooling noise, five days before this run surfaced the same CSP restriction breaking a real feature.

**Category:** Real regression, shipped in v1.75.0 (2026-09-04), five days before this run.

**User impact:** Any Chrome or Firefox admin/treasurer uploading a HEIC receipt photo hits this — native `createImageBitmap()` decode already fails for HEIC in Chrome/Firefox by design (that's the entire reason the WASM fallback exists), so the fallback is now the *only* path, and it is 100% broken. The user sees a "check your connection" message that is actively misleading (it is a CSP block, not a network issue), with no working alternative except manually exporting to JPEG first. Safari is unaffected (native decode succeeds there and never reaches the WASM path).

**Recommended fix:** Add `'wasm-unsafe-eval'` to `script-src` in `next.config.ts` (narrower than restoring `'unsafe-eval'`, which also re-permits `eval()`/`new Function()` — `'wasm-unsafe-eval'` only permits WebAssembly compilation and is supported in all evergreen browsers). Re-verify with a real HEIC upload in Chrome, not just an absence of console errors on `/`. This is implementer + qa work (api-developer or deployment-engineer for the CSP change, qa to re-verify), not a test edit — the tests are correctly catching a real bug and should stay red until it's fixed.

---

### 2–6. Cluster 1 — budgeting/ledger fixtures (5 tests): stale, self-inflicted fixture pollution, not a regression

**Common root cause:** `budgeting-restructure.spec.ts`, `budget-star-notes.spec.ts`, `prior-year-cause-line-reconcile.spec.ts`, and `transaction-budget-line-link.spec.ts` all run against dedicated "never otherwise used" fiscal years (FY2095/2097/2098/2099) and, **by their own documented design, do not clean up after themselves** ("there is no destructive cleanup path for this data short of finalizing the budget... or reaching into the DB directly"). `budget-star-notes.spec.ts` is the one exception that claims a cleanup step exists ("QA cleans up FY2099... via a direct DB delete after this suite finishes running") — but per the task background, the e2e suite "has not been run cleanly in a while," and a DB query confirms that step was never executed:

```
entity   | fiscal_year |    fund    |        category         | annual_amount_cents | starred |          created_at
club       |        2099 | activity   | Event costs             |               50000 | t       | 2026-07-30 20:27:21
club       |        2099 | activity   | Service projects        |                6500 | f       | 2026-07-30 20:27:29
club       |        2099 | activity   | Vision screening        |                   0 | f       | 2026-07-30 20:27:16
foundation |        2097 | charitable | Charitable donation out |              100000 | f       | 2026-07-30 18:29:39
foundation |        2098 | charitable | Charitable donation out |              120000 | f       | 2026-07-30 18:29:43
foundation |        2099 | charitable | Charitable donation out |               19000 | f       | 2026-07-30 20:23:04
foundation |        2095 | charitable | Charitable donation out |               80000 | f       | 2026-07-30 21:46:48
```

Every one of these rows is from **2026-07-30 or 2026-08-06** — a prior run of these exact suites — sitting untouched for weeks. Each spec's "first" test assumes it is starting from a blank fixture (an un-budgeted category, a lump-sum category with no breakdown, a category with no cause groups yet) and instead finds the state its own prior run left behind. This is exactly the drift a weekly test-coverage review exists to catch, and the review has been skipped for 76 days.

#### 2. `budget-star-notes.spec.ts:126`

**Failing assertion:** `expect(amountInput).toHaveValue("")` — received `"0.00"`.
**Evidence:** DB row `club / FY2099 / activity / Vision screening / annual_amount_cents=0`, created 2026-07-30 20:27:16 — this is the exact "lazy-created row shows a fake $0.00" bug this test is a *regression test for* (see its own inline comment), except the $0.00 row is genuine leftover data, not a live re-occurrence of the bug. The category was starred once before, in a previous run, lazily creating a `0`-amount budget row that never got cleaned up; this run finds a non-null `0` where it expects "absent" (`null` → blank input).
**Category:** Missing fixture reset (documented cleanup step, not executed).
**Fix:** Run the documented FY2099 cleanup delete (`ledger_budget_lines` cascade, `ledger_budgets`, `ledger_budget_approvals` for FY2099) before the next full run. Longer-term: make the cleanup automatic (an `afterAll` DB delete scoped to `fiscal_year = 2099` for the Club entity) instead of a manually-remembered QA step — a manual step that has already been skipped once should not be trusted to happen reliably.

#### 3. `budgeting-restructure.spec.ts:137`

**Failing assertion:** `getByLabel('Budget for Charitable donation out (expense)')` (a lump-sum amount `<input>`) not found.
**Evidence:** The page snapshot shows "Charitable donation out" already rendered in **cause-breakdown mode** (flag/note/remove buttons only, no lump-sum spinbutton) — this suite's own later tests build exactly that breakdown, and the suite's header comment says explicitly this FY2099/Foundation/Charitable fixture is "not a cleanup gap," i.e. designed to accumulate forever. The test at line 137 is the *first* test in the file and assumes the category starts as a blank lump-sum row — true only the first time this suite is ever run.
**Category:** Design flaw — a suite documented as safe to leave dirty is not safe to *re-run*, and it keeps getting re-run as part of the standard suite.
**Fix:** Either (a) give this suite its own disposable FY per run (e.g. derive the fiscal year from a timestamp/worker index so every run gets a clean, never-before-seen FY), or (b) add the same kind of `afterAll` DB cleanup recommended for budget-star-notes. Option (a) is more robust since it also removes the suite's dependency on FY2099 being untouched by any other suite.

#### 4. `prior-year-cause-line-reconcile.spec.ts:87`

**Failing assertion:** `locator.click` times out waiting for a `+ Add cause` button under "Charitable donation out."
**Evidence:** DB shows `ledger_budget_lines` rows already present for FY2097 and FY2098, cause `"Vision & Eye Care"`, label `"E2E QA Prior-Ref Pilot Dogs"`, created 2026-07-30 18:29:39/43 — the exact cause/label this test's Step 1 tries to create from scratch. The category is already in breakdown mode with that cause group already added, so the control this test expects (an "+Add cause" button in the lump-sum-row position) either isn't present or is in a different location the test's xpath scoping doesn't reach.
**Category:** Same as #3 — self-inflicted fixture pollution from an earlier, uncleaned run of this same test.
**Fix:** Same as #3 (fresh-FY-per-run or explicit `afterAll` cleanup) applied to FY2097/2098.

#### 5. `transaction-budget-line-link.spec.ts:133`

**Failing assertion:** `getByRole('button', { name: 'Community & Civic', exact: true })` times out.
**Evidence:** DB shows `ledger_budgets` (FY2095, foundation/charitable/"Charitable donation out", $800.00) and three `ledger_budget_lines` rows under cause `"Community & Civic"` — labels `"E2E QA B30 Linked"` ($500), `"E2E QA B30 Fuzzy"` ($300), `"E2E QA B30 ZeroActivity"` ($0) — all created **2026-08-06**, over a month before this run. The failing "Setup" test's whole job is to create exactly these three lines from a blank category by picking "Community & Civic" from a cause picker; the picker has nothing to offer because that cause group already exists.
**Category:** Same pattern, third occurrence — self-inflicted fixture pollution from the suite's own prior run.
**Fix:** Same remediation family as #3/#4.

#### 6. `budgeting-overview-restructure.spec.ts:53`

**Failing assertion:** `getByText(/this page could not be found/i)` not found on an invalid-`fundSlug` 404.
**Evidence:** The page **does** 404 correctly — `[fundSlug]/page.tsx:96` calls `notFound()` when the fund lookup fails, confirmed by code and by the rendered snapshot, which shows the site's real custom 404 page (heading `"Page not found"`, body `"The page you're looking for doesn't exist or may have moved."`). That copy was introduced by the same commit `4aea4f8` (2026-09-04, "real 404") that caused finding #1 — before that commit, Next's framework default 404 text ("This page could not be found") is what this regex was written against, and the test was never updated when the custom 404 page shipped.
**Category:** Stale test — copy assertion, not a behavior assertion; the underlying `notFound()` behavior is correct.
**Fix:** Update the regex to match the real page, e.g. `getByRole("heading", { name: "Page not found" })`, and ideally assert on the HTTP response status (404) rather than page copy, so a future copy change (which CLAUDE.md explicitly allows — "copy that the club expects to change" is out of scope for tests) doesn't break this again.

---

### 7. `ledger-search.spec.ts:88` — stale test, expired time-based assumption

**Failing assertion:** `getByText(/No transactions or budget lines match these filters\./)` not visible on a bare `/admin/ledger/search` visit (default = current FY, no query).
**Evidence:** The test's own comment states the premise plainly: *"FY2026 as of 2026-08-06, which has zero posted transactions/budget lines yet in this club's real books (confirmed against the dev DB)."* A read-only query today shows that premise has expired:
```
club has 1 ledger_budgets row for fiscal_year = 2026
foundation has 6 posted ledger_transactions with txn_date >= 2026-07-01 (real FY2026 activity, min date 2026-08-12)
```
`getFiscalYear()` (`src/lib/fiscal-year.ts`) confirms FY2026 = Jul 2026–Jun 2027, so "current FY" is still FY2026 today — the FY number didn't roll over, the club's real books simply gained data in the five weeks since the spec was written, the same way any live ledger naturally does.
**Category:** Stale test — a hardcoded "today's real data happens to be empty" assumption that was always going to expire, not a fixture accident and not a product bug.
**Fix:** Don't assert on the emptiness of real, ambient production-like data. Either point this assertion at one of the suite's own dedicated never-used FYs (e.g., FY2094, unclaimed by every other suite per the FY-allocation comments spread across these specs), or seed-and-filter to a search term guaranteed to match nothing (this file already has exactly that pattern two tests later — `zzznomatchxyz123`, `ledger-search.spec.ts:144`) instead of relying on a whole fiscal year staying empty forever.

---

### 8. `ledger-search.spec.ts:196` — stale test, bug in the test's own URL construction

**Failing assertion:** `expect(page.locator("text=/error|failed to load/i")).toHaveCount(0)` — 1 match found.
**Evidence:** The test navigates to:
```
/admin/ledger/${CLUB_ENTITY}?entity=${CLUB_ENTITY}&fy=2026&highlight=00000000-0000-0000-0000-000000000000
```
with `CLUB_ENTITY = "club"`, producing `/admin/ledger/club?entity=club&...`. The route is `/admin/ledger/[fundSlug]/page.tsx` — `club` is the **entity** slug, not a **fund** slug. A DB check of `ledger_funds` shows the only valid fund slugs for the club entity are `activity` and `administrative`; `club` is not one of them, so the page 404s (the same custom 404 page as finding #6). The Next.js dev-mode overlay then reports "1 Issue" for the resulting runtime/console state, which is what the broad `/error|failed to load/i` text locator is actually catching — not an in-app error banner, which is what the test intends to rule out.
**Category:** Stale/broken test — a URL-construction bug in the spec itself, most likely introduced when the budgeting-overview/drill-down restructure moved other specs onto `entity=`/`fy=` query-param URLs and this one test's fund-slug segment was never filled in correctly.
**Fix:** Use a real fund slug, e.g. `` `/admin/ledger/activity?entity=${CLUB_ENTITY}&fy=2026&highlight=...` ``, matching how every other passing test in this same file constructs register URLs.

## Summary table

| # | Spec:line | Category | User-facing? |
|---|-----------|----------|---------------|
| 1 | `receipt-heic-upload.spec.ts:42,61,83` | **Real regression** (CSP `script-src` missing `'wasm-unsafe-eval'`, shipped v1.75.0) | **Yes — feature is fully broken for Chrome/Firefox admins** |
| 2 | `budget-star-notes.spec.ts:126` | Missing fixture reset (documented step, skipped) | No — dev-DB-only |
| 3 | `budgeting-restructure.spec.ts:137` | Design flaw — non-idempotent suite re-run | No — dev-DB-only |
| 4 | `prior-year-cause-line-reconcile.spec.ts:87` | Design flaw — non-idempotent suite re-run | No — dev-DB-only |
| 5 | `transaction-budget-line-link.spec.ts:133` | Design flaw — non-idempotent suite re-run | No — dev-DB-only |
| 6 | `budgeting-overview-restructure.spec.ts:53` | Stale test (404 copy changed) | No — behavior is correct |
| 7 | `ledger-search.spec.ts:88` | Stale test (time-expired "empty FY" assumption) | No — behavior is correct |
| 8 | `ledger-search.spec.ts:196` | Stale/broken test (wrong URL segment) | No — behavior is correct |

Cascading effect: the serial-mode `test.describe.configure({ mode: "serial" })` used by all four Cluster-1 suites means each of findings 2–5 also causes Playwright to skip every subsequent test in that same file once the first one fails — this is very likely a meaningful share of the 41 "did not run" tests in the full run, on top of the 13 counted failures.

## Recommendation

1. **Escalate finding #1 immediately** as a bug fix, not a test-maintenance item — hand to api-developer or deployment-engineer for the one-line CSP change, then back to qa to re-verify against a real HEIC upload (not just console-error absence).
2. Findings #2–5: run the overdue FY2099/2098/2097/2095 cleanup once to unblock the next run, then fix the underlying non-idempotency (fresh-FY-per-run or `afterAll` cleanup) so this doesn't recur every time the suite goes a while between clean runs.
3. Findings #6–8: hand back to qa/implementer as straightforward test edits (regex/URL fixes) — no product change needed.
4. The 76-day gap on this review is itself the root enabler of #2–5 (and arguably #1 — a suite run within the first week of v1.75.0 would have caught the CSP regression immediately). Recommend the 7-day cadence actually be enforced going forward.
