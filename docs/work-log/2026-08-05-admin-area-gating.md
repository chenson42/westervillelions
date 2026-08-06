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
| 5 — Verification | qa | Pending | — | — |
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
