# Impact Dashboard — Giving by Cause FY Filter Pills — Work Log

> **Slug:** `2026-07-20-impact-cause-fy-pills`
> **Surface:** (dashboard) member portal — `/members/impact`
> **Permission(s):** none new — reuses the existing `impact.view` gate (page-level, unchanged)
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phases 1–3 condensed into a single orchestrator-authored brief (no separate analyst/architect/tech-lead passes). Full rationale below.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | orchestrator (condensed) | Skipped — condensed into brief | — | 2026-07-20 |
| 2 — Architectural review | orchestrator (condensed) | Skipped — condensed into brief | — | 2026-07-20 |
| 3 — Technical design | orchestrator (condensed) | Skipped — condensed into brief | — | 2026-07-20 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-07-20 |
| 5 — Verification | full-stack-developer (self-verified per explicit task scope) | Complete | PASS | 2026-07-20 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phases 1–3 (condensed — see brief)

The orchestrating agent's brief served as the functional spec, design constraints, and implementer assignment in one document. Reproduced in full below for traceability, since CLAUDE.md requires no silent skips.

**User spec:**
- Pills above the "Giving by Cause" list on `/members/impact`: one per each of the current fiscal year plus the 3 prior fiscal years, most recent first, plus an "All" pill.
- Default selection: the current fiscal year.
- Clicking a pill re-filters the cause breakdown to that FY (All = all-time).
- Pill for a past FY with zero giving still renders; selecting it shows a friendly empty message with a hint to view All.
- Percentages within a selection are relative to that selection's own total.

**Design constraints (given, not re-derived):**
- Compute per-FY cause buckets server-side inside the existing single-pass fold in `getPhilanthropy()` — no extra DB round-trips.
- New client component receives all-time + per-FY data as props; pill switching is local `useState`, no URL params, no server round-trip.
- Pill styling follows the `DuesStatusFilter` idiom (`src/components/admin/dues-status-filter.tsx`).
- Respect the existing `counts_as_giving` / giving predicate exactly as-is (DECISION-030) — do not alter it.

No architectural or functional gaps surfaced during implementation that would have warranted escalating back to a full Phase 1/2/3 pass — the brief was self-consistent and matched the existing `getPhilanthropy()` / `PhilanthropySummary` shape closely enough that no invariant was at risk.

**Implementer:** full-stack-developer (small, tightly coupled — one pure helper, one query-layer extension, one new client component, ~150 lines total).

---

# Phase 4 — Implementation (full-stack-developer)

**Status:** complete

## Summary

Added a pure, unit-tested `bucketGivingByCause()` helper to `src/lib/ledger.ts`, extended `getPhilanthropy()` in `src/lib/ledger-queries.ts` to compute per-fiscal-year cause breakdowns (current FY + 3 prior) inside its existing single-pass fold with zero new DB queries, and built a new client component `ImpactByCause` that renders the FY pills and swaps the cause list locally. The old server-rendered `ImpactByCause` function in the page was removed in favor of the new client component of the same name.

## What I did

- Extracted the inline "group giving rows by cause" logic from `getPhilanthropy()` into a new pure, exported function `bucketGivingByCause(rows: GivingFoldRow[]): CauseBucket[]` in `src/lib/ledger.ts`. It buckets by normalized `beneficiaryCause`, sorts desc by total with the `''` ("Other community support") key always last, and computes `pct` relative to the *passed-in* row set's own total — not a global total. This lets the same function serve both the all-time bucket and any single-FY bucket.
- `getPhilanthropy()` now:
  - Computes `targetFYs = [currentFY, currentFY-1, currentFY-2, currentFY-3]`.
  - In the same loop that already builds `allTimeCents`/`currentFyCents`/`fyMap`, also buckets rows into `rowsByTargetFy: Map<number, GivingFoldRow[]>` for just those 4 years — no extra DB round trip, same single pass over `givingRows`.
  - Builds `byCause` via `bucketGivingByCause(givingRows)` (replaces the old duplicated inline logic — now guaranteed to match any per-FY bucket's formula since both go through the same function).
  - Builds `byCauseByFy: Record<number, PhilanthropyByCause[]>` — one entry per target FY, always present even when a year has no giving (empty array, not omitted).
- Extended `PhilanthropySummary` with `byCauseByFy`.
- Built `src/components/members/impact-by-cause.tsx` (`"use client"`): renders an "All" pill + 4 FY pills (`fyPillLabel()` → `"FY2026–27"` style, shortened from the full `fiscalYearLabel()` format since the full label is too long for a pill), defaults `useState` selection to `currentFiscalYear`, swaps the rendered cause list locally with no server round-trip. Empty state: "No giving recorded yet this fiscal year." plus a "View All giving instead" link back to the All pill, shown inline in the card per the UX empty-state idiom. Pill styling matches `DuesStatusFilter` exactly (`bg-lions-blue text-white` selected / `bg-white text-gray-700 border border-gray-300 hover:bg-gray-50` unselected, `rounded-lg`, `focus:ring-2 focus:ring-lions-blue`).
- Updated `src/app/members/impact/page.tsx`: imports the new component, computes `fiscalYears`/`currentFY` via `currentFiscalYear()` from `src/lib/fiscal-year.ts`, passes `byCause` (all-time) + `byCauseByFy` + `fiscalYears` + `currentFiscalYear` as props, and removed the old server-rendered `ImpactByCause` function (same name, now shadowed by the import). Headline stats, by-fiscal-year table, and recent gifts sections are untouched.

## Outputs

- `src/lib/ledger.ts` — added `bucketGivingByCause()`, `GivingFoldRow`, `CauseBucket` (new section, after `isGiving`).
- `src/lib/ledger-queries.ts` — extended `getPhilanthropy()` fold to build `byCauseByFy` in the existing single pass; `PhilanthropySummary` type gained `byCauseByFy: Record<number, PhilanthropyByCause[]>`; imports `bucketGivingByCause` and `GivingFoldRow` from `@/lib/ledger`.
- `src/components/members/impact-by-cause.tsx` — new client component (pills + cause list + empty state).
- `src/app/members/impact/page.tsx` — wires the new component in, removes the old inline `ImpactByCause`.
- `src/lib/ledger-impact.test.ts` — added a `describe("bucketGivingByCause", ...)` block, 5 new tests (current-FY bucket, prior-FY bucket, empty-rows → `[]`, pct-sums-to-~100 sanity, all-time-unchanged formula parity).
- No schema change, no new `FEATURES` key, no new env var.

## Implementer Notes

- Percentages are deliberately scoped to each bucket's own total (not the all-time total) per the brief — a cause that's 100% of a slow year's giving shows as 100% for that year's pills, not diluted against all-time totals.
- `byCauseByFy` always has exactly 4 keys (current + 3 prior), even for years with zero rows, so the client component never has to special-case a missing key — `byCauseByFy[fy] ?? []` is defensive but should never actually hit the `??` fallback in practice.
- Kept the `fyPillLabel()` short-label formatter local to the client component rather than adding a new export to `src/lib/fiscal-year.ts`, since it's presentation-only and not needed elsewhere yet — if another surface needs the same short format later, promote it then.

---

# Phase 5 — Verification (self-verified per explicit task scope: "you are Phase 4+5")

**Date:** 2026-07-20
**Verified by:** full-stack-developer

## Type Check

`pnpm exec tsc --noEmit`: **PASS** (no output, exit 0)

## Unit Tests

`pnpm test`: **PASS** — 337 passed (332 baseline + 5 new `bucketGivingByCause` tests). No regressions.

## Production Build

`pnpm build:only`: **PASS** — `/members/impact` compiled as a dynamic (`ƒ`) route alongside all other routes; no build errors.

## Dev-Server / Live Check

Dev server was already running on `localhost:3000` (not restarted, per instruction).

- `curl` unauthenticated `GET /members/impact` → `307` redirect to `/signin?callbackUrl=%2Fmembers%2Fimpact` — confirms the route compiles and the auth gate fires correctly with no server error.
- The e2e admin user (`E2E_ADMIN_EMAIL` in `.env.local`) is not member-linked by default, so it would only ever see the "Account Not Linked" state — insufficient to exercise the pills. Per the escalation path in the task brief, I:
  1. Queried the dev DB (`DATABASE_URL` in `.env.local`, the local Neon dev database — not production) for a member row not already linked to a user; found none (every active member already has a linked `users` row, consistent with the "members must always have user accounts" project convention). Confirmed `users.member_id` has no unique constraint (checked schema + migrations), so temporarily pointing the e2e admin's `member_id` at an existing member is safe and reversible with no FK/uniqueness conflict.
  2. `UPDATE users SET member_id = '102f53a4-e293-4e17-8e8a-a22151999ac2' WHERE email = 'lions-e2e-test@westervillelions.org'` (Chris Henson's member row). Confirmed the e2e admin already holds `impact.view` (visibility is `'board'` in `ledger_settings`), so no additional permission wiring was needed.
  3. Wrote a temporary Playwright spec (`e2e/tmp-impact-fy-pills.spec.ts`, since deleted) that signs in via `signInAsAdmin()`, loads `/members/impact`, and asserts: no "Account Not Linked" state; all 5 pills render (`All`, `FY2026–27`, `FY2025–26`, `FY2024–25`, `FY2023–24`); the current-FY pill (`FY2026–27`) is selected by default (`bg-lions-blue` class); the current FY shows the empty message + "View All giving instead" link (this dataset has no FY2026 giving yet); clicking `All` shows the full all-time list; clicking `FY2025–26` (has data) shows that year's breakdown; clicking `FY2023–24` (no data) shows the empty message again.
  4. Ran it: **PASS** (1/1, after fixing one locator ambiguity — `getByText("Youth & Education")` initially matched both the cause-list label and a "Recent Named Gifts" line item; scoped with `{ exact: true }`).
  5. Reverted: `UPDATE users SET member_id = NULL WHERE email = 'lions-e2e-test@westervillelions.org'` — confirmed via the `RETURNING` clause that `member_id` is back to `NULL`.
  6. Deleted `e2e/tmp-impact-fy-pills.spec.ts` and the `test-results/` artifacts directory it produced. `git status` afterward shows no e2e/test-results residue.

## Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| Load `/members/impact` as a member-linked user with giving data | PASS | Pills render: All, FY2026–27, FY2025–26, FY2024–25, FY2023–24 |
| Default selection = current FY | PASS | `FY2026–27` pill pre-selected (`bg-lions-blue`) |
| Current FY has no giving → empty state | PASS | "No giving recorded yet this fiscal year." + "View All giving instead" link shown |
| Click "All" | PASS | Full all-time cause list renders, largest cause "Youth & Education" visible, empty message gone |
| Click a past FY with giving (FY2025–26) | PASS | That year's cause breakdown renders |
| Click a past FY with no giving (FY2023–24) | PASS | Empty state renders again |

## Verdict

**PASS**

---

# Rework — Fiscal-Year Pill Set (full-stack-developer) — 2026-07-20

**Owner:** full-stack-developer
**Status:** complete
**Pipeline mode:** bug-fix-scale — Phases 1–3 skipped (trivial-enough, condensed orchestrator brief), same as the original shipped feature. Documented per the no-silent-skips rule.

## Treasurer spec (same day, after shipping)

> "For Giving by Cause let's leave 23-24 off since we don't have that data. Let's just show All, then the next three fiscal years, and maybe a More pill to get to older data if it exists."

The shipped v1.28.0 version hardcoded exactly 4 pills (current FY + 3 prior), which surfaced `FY2023–24` even though the books only start FY2024 — the treasurer's complaint.

## What changed

- **`src/lib/fiscal-year.ts`** — added a new pure, exported helper `deriveCauseFyPills(dataYears: number[], currentFY: number): { fixed: number[]; more: number[] }`. `fixed` = current FY + 2 prior, clamped so it never includes a year earlier than `Math.min(...dataYears)` (current FY itself is exempt from the clamp — always shows). `more` = any data-bearing year older than the fixed set, newest-first. Placed here (not `ledger.ts`) because `ledger.ts`/`ledger.test.ts` were off-limits — another agent was concurrently building the admin ledger dashboard against those files.
- **`src/lib/ledger-queries.ts`** — `getPhilanthropy()`'s single-pass fold no longer clamps `byCauseByFy` to a fixed 4-year window (`targetFYs`/`targetFYSet`/`rowsByTargetFy` removed). It now retains giving rows for **every** fiscal year present in the data (`rowsByFy`), and builds `byCauseByFy` for every year that appears in `fyMap` plus the current FY (even if the current FY has zero rows — it's always the default pill). Still zero extra DB round-trips; same single pass over the already-fetched `givingRows`. `PhilanthropySummary.byCauseByFy`'s JSDoc updated to describe the new unclamped contract. Re-read the file immediately before editing per the concurrency instruction; diff stayed confined to `getPhilanthropy()`'s fold and the type doc comment — did not touch `ledger.ts`, `ledger.test.ts`, `src/app/(dashboard)/admin/ledger/page.tsx`, or `src/components/admin/ledger/*`.
- **`src/app/members/impact/page.tsx`** — replaced the hardcoded `[fy, fy-1, fy-2, fy-3]` array with a data-driven derivation: `dataYears = philanthropy.byFiscalYear.map(fy => fy.fiscalYear)` (already only contains years with actual data — never synthesized) fed into `deriveCauseFyPills(dataYears, currentFY)`, producing `fixedFiscalYears`/`moreFiscalYears` passed down as new props.
- **`src/components/members/impact-by-cause.tsx`** — prop shape changed from a single `fiscalYears: number[]` to `fixedFiscalYears: number[]` + `moreFiscalYears: number[]`. Added local `showMore` state; a dashed-outline "More" pill (secondary styling — `border-dashed border-gray-300 text-gray-500`, distinct from the selected/unselected filled-vs-outlined pill states) renders only when `moreFiscalYears.length > 0` and hasn't been expanded yet. Clicking it reveals the older years as ordinary pills in place — no re-collapse, no page reload, no server round-trip (all data was already present in `byCauseByFy` from the unclamped query). Pill order unchanged: All first, then fiscal years newest-first, then More last when present.
- **`src/lib/ledger-impact.test.ts`** — added `describe("deriveCauseFyPills", ...)` with 7 new tests: today's real dev-data shape (3 fixed, no More), the earliest-year clamp (data starts in the current FY, both prior candidates dropped), the exact 3-data-years → no-More boundary, the 4-data-years → More boundary, a 5-data-years multi-year More case, current-FY-always-renders-even-empty, and a defensive no-data-at-all fallback.

## Gates

1. **Unit tests:** `pnpm test` → **359 passed** (352 baseline + 7 new `deriveCauseFyPills` tests). No regressions.
2. **Typecheck:** `pnpm exec tsc --noEmit` → clean, no output.
3. **Production build:** `pnpm build:only` → passed, `/members/impact` compiled as a dynamic route alongside all other routes, no errors.
4. **Live check (dev server, not restarted):**
   - Queried the dev DB directly for actual giving-by-FY totals: FY2025 ($27,075.36) and FY2024 ($34,949.17) have posted giving; no other fiscal years have any. `currentFiscalYear(new Date())` = 2026 (today is 2026-07-20, before the Jul 1 FY2026 cutover data has landed). Expected pill set: `All | FY2026–27 | FY2025–26 | FY2024–25`, no `FY2023–24`, no `More`.
   - Confirmed `users.member_id` for the e2e admin (`lions-e2e-test@westervillelions.org`) was `NULL` (prior session's revert held).
   - Temporarily linked it to Chris Henson's member row (`102f53a4-e293-4e17-8e8a-a22151999ac2`, same row used in the original Phase 5 verification) via direct SQL `UPDATE`.
   - Wrote a temporary Playwright spec (`e2e/tmp-impact-cause-fy-pills.spec.ts`, since deleted) that signs in via `signInAsAdmin()`, loads `/members/impact`, and asserts: no "Account Not Linked" state; the pill bar contains exactly 4 buttons (`All`, `FY2026–27`, `FY2025–26`, `FY2024–25`); `FY2023–24` and `More` are both absent; the current-FY pill is selected by default (`bg-lions-blue`) and shows the empty-state message; clicking `FY2024–25` (has data) clears the empty state; clicking `All` renders the all-time list.
   - Ran it: **PASS** (1/1). Note: `signInAsAdmin()` reads `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` from `process.env`, which Playwright does not auto-load from `.env.local` — had to `export $(grep -E "^(E2E_ADMIN_EMAIL|E2E_ADMIN_PASSWORD)=" .env.local | xargs)` before invoking `pnpm exec playwright test`.
   - Reverted: `UPDATE users SET member_id = NULL WHERE email = 'lions-e2e-test@westervillelions.org'` — confirmed via `RETURNING` that `member_id` is back to `NULL`.
   - Deleted `e2e/tmp-impact-cause-fy-pills.spec.ts`. `test-results/` only contained `.last-run.json` (gitignored, not a residue concern) — no other artifacts from this run to clean up. `git status` afterward shows no e2e/test-results residue attributable to this task (unrelated untracked files present belong to the concurrent admin-ledger-dashboard agent's session and were left untouched).

## Verified pill list (live, dev data as of 2026-07-20)

**All | FY2026–27 | FY2025–26 | FY2024–25** — no `FY2023–24`, no `More` pill. Default selection: `FY2026–27` (current FY), showing the "No giving recorded yet this fiscal year." empty state since no giving has posted to FY2026 yet.

## Open questions / handoff notes

- Not manually verified: the "More" pill's expand behavior itself, since today's dev data only has 2 data years (FY2024, FY2025) plus the empty current FY — exactly the no-More case. `deriveCauseFyPills`'s unit tests cover the 4+/exactly-3 boundary and the multi-year expansion logic directly, but there's no live dataset today with 4+ years of giving to click-verify the reveal animation/interaction against. Once the books pass two more fiscal years (FY2027 or later with FY2023 still absent, or if FY2023 data is ever backfilled), a live click-through of the More pill would be worth doing.
- No schema change, no new `FEATURES` entry, no new env var.
- Nominating **analyst** to fold this rework into the Phase 6 shipped-vs-intent review (or re-run Phase 6 if it already closed against the pre-rework shape).

---

# Phase 6 — Shipped vs Intent (analyst)

Not yet run — nominating **analyst** to close the pipeline (Phase 6, shipped-vs-intent review) next, covering both the original shipped shape and this same-day pill-set rework.
