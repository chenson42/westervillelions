# Admin Area Gating Bug — Budget-Committee Members Locked Out — Work Log

> **Slug:** `2026-08-05-admin-area-gating`
> **Surface:** (dashboard) admin — layout, header, admin sidebar data
> **Permission(s):** No new keys. Fixes how existing keys (`budget.edit`, `budget.view`, `ledger.view`, `ledger.manage`, `ledger.approve`, etc.) are recognized as admin-area-admitting.
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped | Bug confirmed real via production repro supplied by user; fix preserves intended behavior (narrows nothing, only widens admission to features that already legitimately gate an admin section) | 2026-08-05 |
| 2 — Architectural review | architect | Skipped | Fix doesn't touch invariants — no new dependency, no new directory, no schema change. Single-source-of-truth refactor stays within existing `src/lib/permissions.ts` | 2026-08-05 |
| 3 — Technical design | tech-lead | Skipped (trivial, root cause pre-diagnosed by user) | — | 2026-08-05 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-08-05 |
| 4b — Implementation (proxy layer) | full-stack-developer | Complete | — | 2026-08-05 |
| 5 — Verification | qa | Complete | **PASS** | 2026-08-08 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

**Skip rationale:** This is the bug-fix variant of the pipeline. Root cause was already diagnosed and verified against production by the user before work started; the fix is a permission-gating correction confined to one shared module plus its three call sites, with no schema, dependency, or directory changes. Phases 1–3 are stubbed per CLAUDE.md's "no silent skips" rule.

---

## Root Cause

`src/app/(dashboard)/admin/layout.tsx` — the layout wrapping **every** admin page — hard-gated entry on `FEATURES.ADMIN_DASHBOARD` (`admin.dashboard`) specifically:

```ts
if (!isAdmin && !userFeatures.includes(FEATURES.ADMIN_DASHBOARD)) {
  redirect("/access-pending");
}
```

This fires before any page-level gate runs. A user holding only budget-committee features (`budget.edit`, `budget.view`, `ledger.view`, etc.) — but not `admin.dashboard` — was bounced to `/access-pending` on every admin route, including `/admin/ledger/budgeting`, even though `AdminSidebar` and the budgeting page itself already correctly recognized those features.

The header's "Admin" nav link (`src/components/layout/header.tsx`, desktop + mobile) had the same narrow check, hardcoded as a raw string (`session.user.features?.includes("admin.dashboard")`) rather than via a shared helper, so the link was invisible to the same users even before they hit the layout redirect.

`src/components/admin/admin-sidebar.tsx` already handled the budget keys correctly (its per-item `requiredFeature: string | string[]` filtering, unchanged in behavior by this fix) — it was never the blocker.

## Reproduction (verified against production, from the user)

Lori Lampel (`llampel@westervillelions.org`) holds roles `member` + `budget_committee`, granting `budget.edit`, `budget.view`, `ledger.view`, `events.view`, `impact.view`, `members.view`. She does not hold `admin.dashboard`.

1. Sign in as Lori.
2. Header shows no "Admin" link.
3. Navigate directly to `/admin/ledger/budgeting`.
4. Redirected to `/access-pending` — she cannot open the budget she was recruited to review.

## Fix

Deliberately did **not** widen any role binding — `budget_committee` still does not (and should not) hold `admin.dashboard`. Instead, made the admin-area *entry* gate recognize any feature that legitimately unlocks an admin section, using the exact same data the sidebar already renders from, so the two layers cannot drift again.

1. **`src/lib/permissions.ts`** — moved the `NavItem`/`NavGroup` shape and the full `navigation` array out of `admin-sidebar.tsx` and into this file as `AdminNavItem`, `AdminNavGroup`, and `ADMIN_NAVIGATION` (content unchanged — same items, same `requiredFeature` values, same order). Added:
   - `canAccessAdminArea(features?: string[] | null): boolean` — true if the user holds `admin.dashboard` or any feature that gates at least one `ADMIN_NAVIGATION` item. Items with no `requiredFeature` (Email Queue, Sync Log, Release Notes) are excluded from the gate-feature set — they carry no permission of their own and can't be used as an admission criterion.
   - `getFirstAccessibleAdminHref(features?: string[] | null): string | null` — the href of the first `ADMIN_NAVIGATION` item (in nav order) the user holds the feature for, or `null`.
   - This module was chosen over a separate `admin-nav.ts` file specifically to avoid a circular import: `admin-sidebar.tsx` already imports `FEATURES` from `permissions.ts`, so a second file importing `FEATURES` from `permissions.ts` while `permissions.ts` imported nav data back from it would create an ES module cycle. Putting both the data and the derived helpers in the same file keeps the dependency direction one-way (permissions.ts has no dependents in this graph; everything else depends on it, as before).

2. **`src/components/admin/admin-sidebar.tsx`** — removed the inline `NavItem`/`NavGroup` interfaces and the ~220-line `navigation` array; now imports `ADMIN_NAVIGATION as navigation` from `@/lib/permissions`. Rendering logic (grouping, active-link matching, mobile menu) is untouched — this is a pure data-source change, verified identical by content diff against the moved block.

3. **`src/app/(dashboard)/admin/layout.tsx`** — replaced the `userFeatures.includes(FEATURES.ADMIN_DASHBOARD)` check with `canAccessAdminArea(userFeatures)`.

4. **`src/components/layout/header.tsx`** (desktop link + mobile link) — replaced both hardcoded `session.user.features?.includes("admin.dashboard")` checks with `canAccessAdminArea(session.user.features)`.

5. **Landing-page problem** (constraint 3 in the brief): `/admin` (the stats dashboard) has no gate of its own — before this fix, anyone who passed the layout gate (i.e., held `admin.dashboard`) landed there by definition, so it never needed one. Now that the layout admits people on narrower grants, someone without `admin.dashboard` must not see the stats page (member counts, pending applications, unread contacts — org-wide figures a `budget.edit`-only grant shouldn't unlock).

   **Decision: kept `admin.dashboard` required on `/admin` itself and added a redirect to the user's first accessible section**, rather than making the header link compute a personalized destination. Chose this over the alternative (pointing the header's `href` at a computed per-user destination) because:
   - It keeps `/admin`'s permission model as a single, obvious check in one place (the page itself), matching how every other admin page already gates itself.
   - The header link can stay a static `/admin` href — simpler component, no need to thread `getFirstAccessibleAdminHref` through the client-side header just to compute a `Link href`.
   - It composes correctly if a user's landing target ever needs recalculating (e.g., their first grant is revoked) — the redirect always re-derives it live from current session features, rather than a value baked into a link at render time.

   `src/app/(dashboard)/admin/page.tsx` now redirects non-`admin.dashboard` holders (who are not `isAdmin`) to `getFirstAccessibleAdminHref(userFeatures) ?? "/access-pending"` before running any of its stats queries.

   For Lori's exact feature set, `getFirstAccessibleAdminHref` resolves to `/admin/ledger` (Treasury → Ledger, gated on `ledger.view`, which precedes Budgeting in `ADMIN_NAVIGATION` order) — not `/access-pending`, and not the stats page. From there `AdminSidebar` shows her the Budgeting link directly.

## Files Modified

- `src/lib/permissions.ts` — added `AdminNavItem`, `AdminNavGroup`, `ADMIN_NAVIGATION` (moved from admin-sidebar.tsx, content unchanged), `canAccessAdminArea()`, `getFirstAccessibleAdminHref()`.
- `src/components/admin/admin-sidebar.tsx` — now imports `ADMIN_NAVIGATION` from `@/lib/permissions` instead of defining it inline; no behavior change.
- `src/app/(dashboard)/admin/layout.tsx` — gate now uses `canAccessAdminArea()`.
- `src/app/(dashboard)/admin/page.tsx` — added its own `admin.dashboard` gate with a redirect to `getFirstAccessibleAdminHref()` (previously relied entirely on the layout's now-widened gate).
- `src/components/layout/header.tsx` — both Admin nav links (desktop + mobile) now use `canAccessAdminArea()` instead of a hardcoded string check.
- `src/lib/permissions.test.ts` — new `describe` blocks for `canAccessAdminArea` and `getFirstAccessibleAdminHref`, including a regression test using Lori Lampel's exact production feature set.

No schema changes. No new `FEATURES` entries. No new env vars. No role bindings changed — `budget_committee` still does not hold `admin.dashboard`, by design.

## Unit Tests (Phase 4 — implementer-delivered)

Added to `src/lib/permissions.test.ts`:

- `canAccessAdminArea`: admits `admin.dashboard` holder; admits Lori's exact budget-committee feature set (regression); admits a `budget.view`-only holder; rejects a plain member with only non-gating features (`members.view`, `events.view`, `impact.view`); rejects empty array; rejects `undefined`; rejects `null`.
- `getFirstAccessibleAdminHref`: returns `/admin` for an `admin.dashboard` holder; returns `/admin/ledger` for Lori's feature set; returns `null` for a non-gating feature set; returns `null` for `undefined`/empty; sanity-checks that `ADMIN_NAVIGATION`'s no-`requiredFeature` System items (Email Queue, Sync Log, Release Notes) can never be a "first accessible" landing target.

All new and pre-existing tests pass (895 total, 35 files).

## Verification Run By Implementer

- `pnpm exec tsc --noEmit` — **PASS** (no output, no errors).
- `pnpm test` — **PASS** (895 tests, 35 files, 0 failures).
- `pnpm build:only` — **PASS** (production build completed; grepped output for `error`/`fail`, no matches; full route manifest generated including all `/admin/*` and `/api/admin/*` routes).
- `pnpm lint` — **NOT PASS, but pre-existing and unrelated**: ESLint 9.39.2 crashes with `SyntaxError: The requested module 'minimatch' does not provide an export named 'default'` inside `@eslint/eslintrc`'s `override-tester.js`, before it reaches any project file. This is an ESM/CJS interop break in the ESLint dependency chain itself, reproducible on a clean checkout with no relation to the files touched here. Not one of the three checks the user asked me to run/report, flagging for deployment-engineer's dependency review.

## Open Questions / Handoff Notes

For **qa** (Phase 5):

- Manual click-through with a test user carrying only budget-committee-shaped features (or Lori's real account, in a safe/read-only way) — confirm:
  1. Header shows "Admin" link (desktop + mobile).
  2. Direct link to `/admin/ledger/budgeting` now loads the budgeting page instead of bouncing to `/access-pending`.
  3. Visiting `/admin` directly (not `/admin/ledger/budgeting`) redirects to `/admin/ledger`, not the stats dashboard and not `/access-pending`.
  4. A user with **no** admin-gating features at all (plain `member` role) still gets bounced to `/access-pending` from any `/admin/*` route — confirm the widening didn't over-grant.
  5. A full `admin` role user still sees the stats dashboard at `/admin` unchanged.
- No seam exists in this codebase today for unit-testing Next.js Server Component `redirect()` calls (grepped — no existing test mocks `next/navigation`'s `redirect` or `auth()` at the page level). The redirect *decision logic* is fully covered by the `getFirstAccessibleAdminHref`/`canAccessAdminArea` unit tests above; the actual `redirect()` wiring in `layout.tsx` and `page.tsx` is verifiable only via qa's manual click-through or a Playwright e2e test if qa judges it worth adding.
- `docs/decisions.md` — no entry added; this is a bug fix restoring intended behavior, not a new architectural decision. Flag if qa/analyst disagrees given the file was moved between modules.
- Nominate **qa** next.

---

## Increment 2 — Proxy Layer — Verification (qa) — 2026-08-08

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** The `/admin/ledger` rule added to `src/proxy.ts`'s `protectionRules` (positioned before the `/^\/admin/` catch-all) does what the fix claims: a real user holding exactly Lori Lampel's production feature set (`budget.edit`, `budget.view`, `events.view`, `impact.view`, `ledger.view`, `members.view` — no `admin.dashboard`) reaches `/admin/ledger/budgeting` in a real browser, is still correctly refused everything she has no feature for, and the sidebar/header render exactly what she may use. Reverting the fix and re-running the same live test reproduced the original bug exactly (bounced to `/access-pending`), then restoring the fix made it pass again — this is not a code-reading verdict, it's an observed before/after. One separate, pre-existing dead-code finding was surfaced during this pass and is flagged below for a follow-up decision, not blocking this verdict because it does not violate the brief's actual acceptance bar.

### What I did

1. Ran the three baseline gates fresh: `pnpm exec tsc --noEmit` (clean), `pnpm test` (1196/1196, matches stated baseline, 61 files), `pnpm build:only` (clean production build, full `/admin/*` and `/api/admin/*` route manifest generated, no `error`/`fail` in output).
2. Created a disposable user in the **dev** DB (`DATABASE_URL`, confirmed distinct from `PROD_DATABASE_URL` before touching anything) with a throwaway role (`qa_temp_lori_shaped`) bound to **exactly** Lori's 6 features — verified by a direct SQL read against `role_features`/`features` before use (no more, no fewer). Used a non-`@westervillelions.org` email (`qa-lori-shaped-temp@example.test`) specifically to avoid the auth `jwt` callback's auto-member-link/admin-notify side effects that fire for `@westervillelions.org` sign-ins.
   - Note for context: the *real* Lori account already present in the dev DB holds `board_member` + `member`, and dev's `board_member` role (unlike whatever prod's narrower `budget_committee`-only binding implies) carries 17 features **including `admin.dashboard`** — using the real dev Lori account would have trivially and incorrectly passed every check in this brief. The disposable account was necessary, not optional, to test the actual reported scenario.
3. Started `pnpm dev`, confirmed readiness, and drove the disposable account through a real Chromium browser via Playwright (the closest available "real browser" driver in this environment) rather than reasoning from the route files:
   - `/admin/ledger/budgeting` → loads, `<h1>Budget Planning</h1>` visible. **This is the page she was recruited to use, and it works.**
   - `/admin/ledger` → loads (Ledger dashboard).
   - `/admin/ledger/settings/categories` → she lacks `LEDGER_MANAGE`; **the proxy admits her to `/admin/ledger*`, and the page's own `hasFeature(LEDGER_MANAGE)` check redirects her to `/admin/ledger`** — confirmed via server response, no crash, no 500, no client-side error boundary.
   - `/admin/members` → refused, lands on `/access-pending` (she lacks `MEMBERS_EDIT`) — confirms the widened proxy rule did not over-grant.
   - `/admin` → refused, lands on `/access-pending`, **not** the org-wide stats dashboard.
   - Header "Admin" link: present (count = 1) for this user.
   - `/admin/ledger` sidebar: renders only `Ledger, Budgeting, Reconciliation, Reports, Compliance, User's Guide` plus the ungated `System` items (`Email Queue, Sync Log, Release Notes`) — every section requiring a feature she lacks (`Dashboard, Members, Users, Roles, Permissions, Applications, Groups, Dues, Donors, Ledger Settings, Events, Campaigns, Announcements, Testimonials, Programs, Newsletter, Contact, Suggestions, Security`) is correctly absent.
4. **Proved the regression is real, not assumed:** temporarily reverted the `/admin/ledger` rule in `src/proxy.ts` (replaced it with a comment, restoring the exact pre-fix `protectionRules` ordering), reran the new e2e spec against the running dev server — the budgeting test failed exactly as the original bug report describes (`/admin/ledger/budgeting` → `/access-pending`). Restored the rule verbatim (`git diff src/proxy.ts` confirmed byte-for-byte identical to the pre-revert state — the diff against `HEAD` is only the original, still-uncommitted Increment 2 change, nothing extra), reran, all green again.
5. Added a permanent Playwright regression spec, `e2e/admin-ledger-budget-committee-gate.spec.ts` (5 tests, `describe.configure({ mode: "serial" })`). Since this codebase has **no HTTP API to create a new role** (role creation is migration-only by design — confirmed by grepping `src/app/api/admin/roles/` and the `/admin/roles` page, which has no create action), the spec composes a disposable fixture user from two **real, already-migrated** roles — `member` (`events.view`, `members.view`) + `budget_committee` (`budget.view`, `budget.edit`, `ledger.view`) — via a minimal, documented direct-DB read (role id by name) and insert/delete of the fixture user + its two role bindings in `beforeAll`/`afterAll`. This mirrors the fixture discipline `ledger-category-management.spec.ts` already uses for disposable data, extended for the one seam (role creation) with no HTTP equivalent. Verified this leaves nothing behind: `SELECT count(*) FROM users WHERE email LIKE 'qa-budget-committee-gate-%@example.test'` → `0` after the suite ran.
6. Deleted the disposable account, role, and all its `role_features`/`user_roles` rows; verified all four counts are `0` post-cleanup. Stopped the dev server (port 3000 confirmed free).

### Outputs

- `e2e/admin-ledger-budget-committee-gate.spec.ts` (new) — 5 tests:
  - `can load /admin/ledger/budgeting directly — regression for proxy layer admin-area gating` — the primary regression guard; failed against the reverted proxy, passes against the fix.
  - `the Admin link is visible in the header for this user`
  - `visiting bare /admin never shows the org-wide stats dashboard`
  - `is still refused a route she has no feature for — /admin/members (lacks members.edit)`
  - `is refused by the page's own gate (not the proxy) for /admin/ledger/settings/categories, which requires ledger.manage`
- `src/proxy.ts` — untouched net of this verification pass (temporarily reverted and restored during step 4 above; `git diff` shows only the pre-existing, still-uncommitted Increment 2 change from `full-stack-developer`, nothing added by qa).
- No schema changes, no migration files, no production database access. Dev DB (`DATABASE_URL`) returned to its exact prior state (confirmed via row-count checks post-cleanup).

### Type Check
`pnpm exec tsc --noEmit`: **PASS** (clean, including the new e2e spec file).

### Unit Tests
`pnpm test`: **PASS**
Total: 1196 | Passed: 1196 | Failed: 0
Files: 61
Duration: ~1.4s

### Production Build
`pnpm build:only`: **PASS**
Notes: Full route manifest generated, including all `/admin/*` and `/api/admin/*` routes; no `error`/`fail` matches in build output.

### End-to-End Tests
`pnpm test:e2e` (scoped to the new spec, run three times — pre-check with fix present, with fix reverted, with fix restored): **PASS** (final state)
- With fix present (first run): 5/5 passed.
- With `/admin/ledger` rule reverted: 1/5 passed, 4 skipped after first failure — `can load /admin/ledger/budgeting directly` failed exactly as the original bug describes (`/admin/ledger/budgeting` → `/access-pending`). This is the proof the test catches the regression.
- With fix restored: 5/5 passed again.
Full suite (`pnpm test:e2e` across all specs) was not re-run in this pass — out of scope for a focused verification of one proxy rule; the full suite is covered by the routine `pnpm test:e2e` gate in `/pre-push` before any push to `main`.

### Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| Sign in as Lori-shaped disposable user (exactly her 6 prod features, no more) | pass | Lands on `/members`; not an admin.dashboard holder |
| `/admin/ledger/budgeting` | pass | `Budget Planning` heading renders — the page she was recruited to review |
| `/admin/ledger` | pass | Ledger dashboard loads |
| `/admin/ledger/settings/categories` | pass (graceful refusal) | Server-side redirect to `/admin/ledger`, no crash — the page's own `LEDGER_MANAGE` gate, not the proxy |
| `/admin/members` | pass (correctly refused) | Redirects to `/access-pending` — lacks `MEMBERS_EDIT` |
| `/admin` | pass (correctly refused) | Redirects to `/access-pending`, **not** the stats dashboard — see dead-code note below |
| Header "Admin" link | pass | Visible for this user |
| Sidebar on `/admin/ledger` | pass | Shows only Ledger, Budgeting, Reconciliation, Reports, Compliance, User's Guide + ungated System items — every gated section she lacks is absent |
| Revert-and-observe (proxy rule removed) | pass | `/admin/ledger/budgeting` reproduced the exact original bug (`/access-pending`) |

Driven via Playwright/Chromium against the real running dev app rather than truly by-hand mouse clicks, since no interactive browser session is available in this environment — this satisfies the spirit of "don't verify by reading code alone" (real HTTP requests, real auth, real server-side redirects, real rendered DOM) even though it's automated rather than literally manual.

### Regression Tests Added
- `can load /admin/ledger/budgeting directly — regression for proxy layer admin-area gating` — `e2e/admin-ledger-budget-committee-gate.spec.ts:90` — guards against: the exact Increment 2 bug (a non-`admin.dashboard` holder with legitimate ledger/budget features falling through `src/proxy.ts`'s ordered `protectionRules` to the `ADMIN_DASHBOARD`-only catch-all). Confirmed failing-then-passing against the real revert, not assumed.
- 4 supporting tests in the same file guard the surrounding boundary (over-grant refusal, page-level sub-gate, header visibility, `/admin` bare-route behavior) so a future change to any of these can't silently regress alongside the main fix.

### Coverage on Critical Modules
Not re-measured in this pass — this was a scoped verification of one proxy rule and its live behavior, not a coverage sweep. `src/lib/permissions.ts` unit coverage (`canAccessAdminArea`, `getFirstAccessibleAdminHref`) was already added and verified by the implementer in the Increment 1 section above; unaffected by this change (the proxy layer has no unit-test seam — see the implementer's note about `redirect()` not being mockable in this codebase's current test setup).

### Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)`/proxy gate present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `proxy.ts` rule: `/^\/admin\/ledger/` | n/a (proxy runs on `session` from `auth()`, confirmed at top of `proxy()`) | yes — `requiredFeatures: [LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE, LEDGER_APPROVE, BUDGET_VIEW, BUDGET_EDIT]`, `requireAll` unset (default ANY) | yes — union of every feature that legitimately gates a Ledger/Budgeting sidebar item, matching `ADMIN_NAVIGATION`'s own per-item requirements |
| `GET /admin/ledger/budgeting` (page) | yes | yes — `hasAnyFeature(... LEDGER_MANAGE, LEDGER_APPROVE, BUDGET_VIEW, BUDGET_EDIT)` | yes |
| `GET /admin/ledger/settings/categories` (page) | yes | yes — `hasFeature(LEDGER_MANAGE)`, redirects to `/admin/ledger` if absent | yes — narrower than the proxy's area-admission rule, correctly so (settings is a mutation surface) |
| `GET /admin/ledger` (page) | yes | yes — `hasAnyFeature(LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE)` | yes |
| `GET /admin/members` (page, unchanged by this increment) | yes | yes — proxy rule `/^\/admin\/members/` requires `MEMBERS_EDIT` | yes |

This increment touched only the proxy's route-admission layer, not any API route or server action — no new `src/app/api/admin/**` or `"use server"` surface was added. Every Ledger/Budgeting page reachable through the widened proxy rule already carries its own `hasFeature`/`hasAnyFeature` check, confirmed by direct file read (not inferred from passing tests), per the audit's own mandate.

### Open finding (not a blocker for this PASS)

`src/app/(dashboard)/admin/page.tsx`'s own redirect-to-`getFirstAccessibleAdminHref()` logic (added in Increment 1, intended to send a non-`admin.dashboard` holder somewhere useful instead of `/access-pending`) is **currently unreachable** for any user without `ADMIN_DASHBOARD`: bare `/admin` doesn't match the proxy's `/^\/admin\/ledger/` (or any other specific) rule, so it falls to the generic `/^\/admin/` catch-all, which still hard-requires `FEATURES.ADMIN_DASHBOARD` and redirects to `/access-pending` **before `admin/page.tsx` ever executes**. Confirmed live: the Lori-shaped account visiting `/admin` lands on `/access-pending`, not `/admin/ledger` as the Increment 1 work-log narrative describes.

This does **not** fail this verification — the brief's actual acceptance bar for `/admin` was "must still be refused or redirect ... confirm she is not dumped on org-wide stats," and `/access-pending` satisfies "refused" and clearly isn't the stats page. But it means Increment 1's own stated design intent (land her on `/admin/ledger` instead of a bare refusal) isn't actually happening, and `getFirstAccessibleAdminHref()`'s usage in `admin/page.tsx` is dead code today for anyone without `admin.dashboard`. Flagging for a follow-up decision (tech-lead/analyst) rather than fixing here — qa does not write feature code, and the fix (likely: reuse `canAccessAdminArea` in the proxy's bare-`/admin` case the same way the layout does, or drop the now-unreachable branch from `admin/page.tsx`) is a design choice, not a verification task.

### Verdict: PASS

### Open questions / handoff notes
- Nominate **analyst** for Phase 6 (shipped-vs-intent). The core ask — Lori-shaped users reaching `/admin/ledger/budgeting` — is verified working end-to-end with a real browser, before-and-after the fix.
- Flag the dead-code finding above (`admin/page.tsx`'s unreachable redirect branch) to analyst/tech-lead as a candidate follow-up item — not required to close this pipeline entry, since it doesn't violate the stated acceptance criteria, but it's real drift between the Increment 1 narrative and live behavior worth a decision (fix the proxy to reuse `canAccessAdminArea` for bare `/admin`, or delete the now-dead redirect branch and its comment).
- `e2e/admin-ledger-budget-committee-gate.spec.ts` is new and permanent; it will run as part of the routine `pnpm test:e2e` gate going forward (not scoped/skipped).
