# B-41 — Sync Log & Members Export Permission Gaps — Work Log

> **Slug:** `2026-09-05-b41-sync-log-permission`
> **Surface:** (dashboard) admin
> **Permission(s):** New `FEATURES.SYNC_LOG_VIEW` (`sync_log.view`); `/api/admin/members/export` now gates on `MEMBERS_EDIT` OR `REPORTS_EXPORT` instead of `REPORTS_EXPORT` alone
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Root Cause

Two carried-forward gaps from DECISION-083's 22-area admin-permission audit (logged as B-41 in `docs/backlog.md`, sub-items 1 and 2; sub-item 3 was already fixed and required no code change — see below):

1. **`/admin/sync-log`** (`src/app/(dashboard)/admin/sync-log/page.tsx`) checked only `auth()`, no `hasFeature()` call. It was a deliberately-documented exception in `NO_PAGE_GATE_ALLOWLIST` (`src/lib/admin-page-feature-gates.test.ts`), alongside Email Queue and Release Notes — but unlike those two, its `ADMIN_NAVIGATION` item also declared no `requiredFeature`, so `getAdminProtectionRules()` derived no proxy rule for it either. The page fell entirely to `src/proxy.ts`'s generic `ADMIN_DASHBOARD` catch-all, meaning **any** admin-area user (holding even one unrelated permission, e.g. `testimonials.manage`) could read Google Group sync history — including real member email addresses in the `added`/`removed`/`failed` columns of every sync run.
2. **`/api/admin/members/export/route.ts`** gated on `FEATURES.REPORTS_EXPORT` alone — the same standalone-generic-permission shape DECISION-083 found and fixed for the newsletter export route. Not live-exploitable today (only `admin`/`board_member` hold `reports.export`, and `admin` already holds `members.edit`), but a future role granted `reports.export` for an unrelated report would silently gain the ability to download the full member roster (name, email, phone, address) via this endpoint, with no relationship to the page's own gate.

## Reproduction (pre-fix)

1. Grant a test role `testimonials.manage` only (no `admin.dashboard`, no `members.edit`, no `subscriptions.view`, etc.).
2. Sign in as that user. The admin layout's `canAccessAdminArea()` check passes (they hold at least one admin-gating feature).
3. Navigate to `/admin/sync-log`. Pre-fix: page renders, showing every Google Group sync run's added/removed/failed member emails. Post-fix: redirected to `/access-pending`.
4. Separately: hit `GET /api/admin/members/export?format=zeffy` as a user holding only `reports.export` (no `members.edit`). Pre-fix: 200 with the full member roster spreadsheet. Post-fix: 403.

## Phases

| Phase | Status |
|-------|--------|
| 1 — Functional refinement | **Skipped** — bug-fix variant per CLAUDE.md; the bug (live PII exposure) and the fix (add a dedicated permission key, mirror DECISION-083's export-route shape) were already fully specified by the B-41 backlog entry and DECISION-082/083. No new user-facing behavior beyond "this now requires a permission it should have required already." |
| 2 — Architectural review | **Skipped** — no new directory, no new dependency, no structural change; purely an application of an already-established pattern (DECISION-082's nav-derived proxy protection, DECISION-083's dedicated-PII-key + OR-export-gate shape). |
| 3 — Technical design | **Skipped** — the fix shape was fully dictated by the add-permission skill (`.claude/skills/add-permission/`) and by mirroring DECISION-083 exactly; no design decisions were left open. |
| 4 — Implementation | Complete (this entry, full-stack-developer) |
| 5 — Verification | Pending — nominate **qa** |
| 6 — Shipped vs intent | Pending — nominate **analyst** after qa |

---

## Phase 4 — Implementation (full-stack) — 2026-09-05

**Owner:** full-stack-developer
**Status:** complete

### Summary

Added a new `sync_log.view` permission (bound to `admin` and `board_member`, matching `subscriptions.view`'s precedent) and gated `/admin/sync-log`'s page body and its `ADMIN_NAVIGATION` entry with it, closing a live PII exposure. Removed `sync-log` from the gate test's `NO_PAGE_GATE_ALLOWLIST` so the regression suite enforces this permanently, and added a `getAdminProtectionRules()` pin. Fixed `/api/admin/members/export/route.ts`'s standalone-`REPORTS_EXPORT` gate to `hasAnyFeature([MEMBERS_EDIT, REPORTS_EXPORT])`, mirroring DECISION-083's fix for the newsletter export route exactly. Sub-item 3 (dashboard "Newsletter Subscribers" card linking to `/admin/subscriptions`) was already fixed prior to this session — verified, no code change made.

### What I did

- Added `FEATURES.SYNC_LOG_VIEW = "sync_log.view"` to `src/lib/permissions.ts`, with `FEATURE_CATEGORIES.SYNC_LOG = "sync_log"` and a `FEATURE_DESCRIPTIONS` entry: "View Google Group sync history, including member email addresses."
- Gave the "Sync Log" `ADMIN_NAVIGATION` item `requiredFeature: FEATURES.SYNC_LOG_VIEW` (was previously undeclared) — this is what makes `getAdminProtectionRules()` (DECISION-082) derive the matching proxy rule automatically; updated the `AdminNavItem.requiredFeature` doc comment to drop Sync Log from the "no permission of their own" list.
- Created `drizzle/migrations/0100_sync_log_view_permission.sql` — idempotent insert of the `sync_log.view` feature row plus `admin` and `board_member` role bindings, following the exact `add-permission` skill / `0083`/`0093` migration shape.
- Gated `src/app/(dashboard)/admin/sync-log/page.tsx`'s page body: `auth()` (unchanged) + `hasFeature(session.user.id, FEATURES.SYNC_LOG_VIEW)` redirecting to `/access-pending`, matching the `/admin/proposals` and `/admin/social-requests` sibling pattern.
- Removed `"sync-log"` from `NO_PAGE_GATE_ALLOWLIST` in `src/lib/admin-page-feature-gates.test.ts`, updated its doc comment, and updated the module-level comment referencing "Email Queue, Sync Log, Release Notes" to drop Sync Log.
- Updated `src/lib/permissions.test.ts`: removed `sync-log` from the "produces no rule for System items" assertion and added a new test pinning that `getAdminProtectionRules()` now derives a `/admin/sync-log` rule requiring `SYNC_LOG_VIEW` (mirrors the existing `/admin/documents` pin test).
- Searched for API routes backing the sync-log page (`googleGroupSyncLog` usage under `src/app/api`) — none exist; the page queries the DB directly as a Server Component. The two `/api/admin/groups/**/sync` routes are sync-trigger actions (write paths), not sync-log readers, and are out of scope for this fix.
- Fixed `src/app/api/admin/members/export/route.ts`: `hasFeature(REPORTS_EXPORT)` → `hasAnyFeature([FEATURES.MEMBERS_EDIT, FEATURES.REPORTS_EXPORT])`, matching `src/app/api/admin/newsletter/export/route.ts`'s DECISION-083 shape (surface-owning permission — `members.edit` is the same key that gates `/admin/members` and the `"members"` segment in `getAdminProtectionRules()` — OR'd with the generic `reports.export`).
- Verified sub-item 3: `src/app/(dashboard)/admin/page.tsx:177` already links to `/admin/subscriptions` (not `/admin/newsletter`). No change made.

### Outputs

- `src/lib/permissions.ts` — new `FEATURES.SYNC_LOG_VIEW`, `FEATURE_CATEGORIES.SYNC_LOG`, `FEATURE_DESCRIPTIONS` entry, `ADMIN_NAVIGATION` Sync Log item now declares `requiredFeature`, doc-comment updates.
- `drizzle/migrations/0100_sync_log_view_permission.sql` — new migration (idempotent; ran clean against dev DB).
- `src/app/(dashboard)/admin/sync-log/page.tsx` — added `hasFeature()` + `redirect("/access-pending")` gate.
- `src/lib/admin-page-feature-gates.test.ts` — `sync-log` removed from `NO_PAGE_GATE_ALLOWLIST`; doc comments updated.
- `src/lib/permissions.test.ts` — updated the "no rule for System items" test (dropped `sync-log`), added a new `getAdminProtectionRules()` pin test for `/admin/sync-log` → `SYNC_LOG_VIEW`.
- `src/app/api/admin/members/export/route.ts` — gate changed from `hasFeature(REPORTS_EXPORT)` to `hasAnyFeature([MEMBERS_EDIT, REPORTS_EXPORT])`.
- No `docs/decisions.md` entry added — the add-permission skill doesn't call for one, and this work-log plus the existing DECISION-082/083 entries fully document the pattern being applied (not a new pattern).

### Verification performed

- Migration run against dev DB (`pnpm db:migrate`) — succeeded; confirmed via `psql`: `features` has a `sync_log.view` row (category `sync_log`, description matches `FEATURE_DESCRIPTIONS` byte-for-byte); `role_features` binds it to both `admin` and `board_member`, nothing else.
- `pnpm exec tsc --noEmit` — clean, no errors.
- `pnpm test` — 101 test files, 1892 tests, all passing.
- Regression-sanity check on the gate test itself: temporarily reverted the `hasFeature`/`redirect` gate in `sync-log/page.tsx` back to auth-only, re-ran `src/lib/admin-page-feature-gates.test.ts` — it failed for the right reason (`FEATURE_GATE_PATTERN` not found in the page source), confirming the suite is non-vacuous for this segment. Restored the fix; full suite re-run green (1892/1892).
- `pnpm build:only` — production build succeeded, exit 0, no errors; `/admin/sync-log` and `/api/admin/members/export` both listed as dynamic (`ƒ`) routes as expected.
- Did not attempt a live signed-in click-through (no test credentials in this environment) — verified the code path and the derivation instead: `getAdminProtectionRules()` now includes a `sync-log` rule requiring `SYNC_LOG_VIEW` (new pinned unit test), and the existing `permissions.test.ts` suite (`"every ADMIN_NAVIGATION item with a requiredFeature is admitted by a derived rule matching its own href"`) automatically covers the new item since it iterates `ADMIN_NAVIGATION` generically.

### Open questions / handoff notes

- **For qa (Phase 5):** signed-out `/admin/sync-log` should redirect to `/signin`; a signed-in user without `sync_log.view` should land on `/access-pending` (not `/admin`, matching the `/admin/proposals`/`/admin/social-requests` sibling convention rather than `/admin/subscriptions`'s older `/admin` redirect — worth a manual click-through with a real low-privilege account if one is available in a non-prod environment). Also verify `/api/admin/members/export` returns 403 for a `reports.export`-only, non-`members.edit` account, and 200 for `members.edit` holders without `reports.export`.
- No e2e gate spec was added for `sync-log` (unlike `/admin/subscriptions`'s `admin-subscriptions-page-gate.spec.ts`) — not every gated area has one (e.g. `club_files`, `proposals`, `social_requests` don't either), and the task didn't call for one. Flagging as an optional qa follow-up, not a gap in this fix.
- Release notes were not written — per workflow rules this repo writes release notes on push to `main`, and this work has not been pushed. Whoever pushes this should run `/release-notes`.
- Recommend **qa** next.
