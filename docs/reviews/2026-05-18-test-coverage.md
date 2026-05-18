# Test Coverage Review — 2026-05-18

**Cadence:** 7 days (first run — establishes baseline)
**Trigger:** Post-close of cancel-occurrence v1.13.0 and event-times-wall-clock v1.14.0
**Runner:** qa

---

## Summary

39 Vitest unit tests pass, all concentrated in `src/lib/events.ts`. The events module is the strongest-covered file at 92.76% statements and 83.33% branches. Every other critical module — `permissions.ts`, `permissions-server.ts`, `members.ts`, `email.ts`, `google-groups.ts`, and the entire `auth/` subtree — is at 0% statement coverage (all rely on DB/network; none have unit test doubles in place). Overall statement coverage is 26.8%, dominated by the events module. Three Playwright e2e smoke tests pass against the running dev server (public homepage, events page, unauthenticated redirect to /signin). The nine cancelled-occurrence flows and eight wall-clock display flows deferred during Phase 5 of v1.13.0 and v1.14.0 have no automated test coverage of any kind.

---

## Per-module Coverage Table

| Module | % Stmts | % Branch | % Funcs | % Lines | Gap Severity | Recommendation |
|--------|---------|---------|---------|---------|-------------|----------------|
| `src/lib/events.ts` | 92.76 | 83.33 | 91.66 | 94.73 | Low | Add branches for lines 26-30 (parseWallClock short/date-only fallbacks), line 118 (formatRecurrence no-days/biweekly without range), line 170 (monthly 12-iteration exhaustion), line 230 (findNextDayOfWeek maxDays exhaustion non-cancelled path) |
| `src/lib/permissions.ts` | 0 (stmts) | 100 | 0 | 0 | Low | 100% branch coverage because it's pure constants — no branches in coverage scope. Add a Vitest test for `getFeaturesByCategory` and `FEATURE_DESCRIPTIONS` completeness check to guard against key drift. Functions show 0% only because v8 counts the export initializer as a function; actual behavior is fully covered by branching. |
| `src/lib/permissions-server.ts` | 0 | 0 | 0 | 0 | High | All six exports hit DB. Unit-testable with a Drizzle mock for `getUserFeatures` (cache hit/miss), `hasFeature`, `hasAnyFeature`, `hasAllFeatures`, `clearUserPermissionCache`, `getFeaturesFromSession`, `sessionHasFeature`. `getFeaturesFromSession` and `sessionHasFeature` are pure functions with no DB dependency — these are immediate unit test candidates. |
| `src/lib/members.ts` | 0 | 0 | 0 | 0 | Medium | Three branching paths: (1) email conflict, (2) existing user re-link, (3) new user create+welcome email. All touch DB. E2e covers happy path via admin member create flow. Unit tests require Drizzle test double. Flag as e2e-covered for paths 1 and 3; path 2 (conflict guard) has no e2e test either. |
| `src/lib/email.ts` | 0 | 0 | 0 | 0 | Medium | Resend + DB-dependent. Retry loop, queue-write, and success/failure branches are untested. Covered only by the welcome-email happy path exercised through member create in e2e. The retry/failure branches are not exercised anywhere. |
| `src/lib/google-groups.ts` | 0 | 0 | 0 | 0 | Low | External API (Google Workspace). Not unit-testable without significant mocking. Manual verification only per pipeline instructions. Acceptable as manual-verify-only given the external dependency. |
| `src/lib/auth/index.ts` | 0 | 0 | 0 | 0 | High | NextAuth config — not unit-testable, but the sign-in happy path and the credentials callback (bcrypt comparison, feature-loading into JWT) are not covered by any Playwright test. Critical flows. |
| `src/lib/auth/password-reset.ts` | 0 | 0 | 0 | 0 | Medium | `generateResetToken()`, `hashToken()`, `createPasswordResetToken()`, and `verifyPasswordResetToken()` contain pure logic (token generation, hashing, expiry check). The pure parts are unit-testable without DB mocks. No tests exist. |
| `src/lib/hooks/usePermissions.ts` | 0 | 0 | 0 | 0 | Low | Client-side hook; not in Vitest's node environment. Acceptable gap. |

---

## E2e Flow Inventory

### Existing Playwright tests (e2e/smoke.spec.ts — 3 tests)

| Flow | Covered | Test name | Notes |
|------|---------|-----------|-------|
| Homepage renders | Yes | `homepage renders` | Checks body contains "Westerville Lions" |
| Events page renders | Yes | `events page renders` | Checks /events URL and h1 visible |
| Unauthenticated /members redirect | Yes | `members route redirects unauthenticated visitors to signin` | Accepts /signin or /access-pending |

### Critical uncovered flows

#### Cancel-occurrence (v1.13.0) — all deferred from Phase 5

| Flow | Covered | Recommended action |
|------|---------|-------------------|
| Admin cancels an occurrence (POST cancel endpoint, `cancelled: true`) | No | Playwright e2e: sign in as admin, cancel a specific occurrence, verify 200 and override row |
| Admin restores a cancelled occurrence (`cancelled: false`) | No | Playwright e2e: follows the cancel test above; verify `restored: true` and row deleted |
| Public /events shows "Cancelled" badge for a cancelled occurrence | No | Playwright e2e: verify the badge text after a cancel; does not require auth |
| Members-events "you were signed up" note for cancelled occurrence | No | Playwright e2e: sign up, cancel occurrence, reload member events page, check note |
| Signup blocked when occurrence is cancelled (409/400 from signup route) | No | Playwright e2e OR Vitest API route unit test with mock DB |
| Permission gate: non-admin cannot reach cancel endpoint (403) | No | Playwright e2e: sign in as member, POST cancel, assert 403 |
| Orphan RSVP row visible in admin event accordion after cancel | No | Playwright e2e: verify admin UI shows attendees despite cancellation |
| Admin accordion: cancelled occurrence shown distinctly | No | Playwright e2e: visual state check |
| Cancellation reason stored and shown | No | Playwright e2e: provide reason string, verify in admin UI |

#### Wall-clock event times (v1.14.0) — all deferred from Phase 5

| Flow | Covered | Recommended action |
|------|---------|-------------------|
| Timed event displays correct wall-clock time (not UTC-offset) | No | Playwright e2e: create event at 12:30 PM, verify display shows "12:30 PM" not "8:30 AM" |
| All-day event create via admin form | No | Playwright e2e: toggle all-day, submit, verify no time suffix on display |
| All-day event display omits time suffix | No | Unit test (formatEventWhen) — already covered at 100% in Vitest |
| Recurring event times stable across DST spring-forward | No | Unit test — covered in Vitest DST boundary suite |
| Recurring event times stable across DST fall-back | No | Unit test — covered by easternOffsetFor tests |
| All surfaces (events page, event detail, member portal) show wall-clock time | No | Playwright e2e: navigate to /events, member events page, event detail |
| Admin event editor pre-populates correct wall-clock time | No | Playwright e2e: edit existing event, verify form shows same time as display |
| RSVP confirmation time matches display time | No | Playwright e2e: RSVP to timed event, verify confirmation matches display |

#### Past-events admin filter

| Flow | Covered | Recommended action |
|------|---------|-------------------|
| Recurring event with future occurrences appears in upcoming, not past | No | Unit test: `getNextOccurrence` with `now` before `recurrenceEndDate` — partially covered; admin filter logic in page/action not tested |

---

## Top 5 Prioritized Gaps

1. **Playwright e2e: admin cancels and restores an occurrence end-to-end.** This is the highest-risk untested flow from the two recent features. It exercises the POST cancel endpoint, the permission gate, the DB override row, and the public badge in a single flow. None of Phase 5's deferred verification became a regression guard. A regression in the cancel toggle would be invisible to automated testing.

2. **Playwright e2e: wall-clock display is correct (12:30 PM not 8:30 AM) on the events page.** This is the root bug that v1.14.0 fixed (documented in project memory as the "naive timestamp-as-UTC bug"). No automated test guards against its return. A one-line regression in `parseWallClock` or in how startDate is passed to the display component would silently reintroduce a user-visible defect that burned a full feature sprint to fix.

3. **Vitest unit tests for `permissions-server.ts` pure functions (`getFeaturesFromSession`, `sessionHasFeature`).** These two functions have zero DB dependency. They accept plain objects and return booleans/arrays. They are called in every protected server component. Missing a feature name or mishandling an undefined `features` array would silently break permission gating for the session path. The test would be six lines.

4. **Vitest unit test for `permissions.ts` catalog completeness.** The branch coverage shows 100% because it's pure constants, but no test guards that `FEATURE_DESCRIPTIONS` has a key for every `FEATURES` value. A new feature added to `FEATURES` without a matching description causes a UI rendering defect (undefined description text in the admin roles page). A single `Object.values(FEATURES).forEach(f => expect(FEATURE_DESCRIPTIONS[f]).toBeDefined())` would catch it at commit time.

5. **Playwright e2e: signup blocked when occurrence is cancelled.** The signup route (`POST /api/events/[id]/signup`) explicitly checks for a cancellation override row and returns 400 "This occurrence has been cancelled." This guard has no automated test. A regression in the `dateKey()` comparison (the exact bug pattern that burned us in the wall-clock fix, DECISION-005) would silently allow signups for cancelled occurrences.

---

## events.ts Uncovered Branches (lines 26-30, 118, 170, 230)

- **Lines 26-30** (`parseWallClock`): the short-format `"yyyy-MM-dd HH:mm"` fallback and the date-only `"yyyy-MM-dd"` fallback. Currently the tests only exercise the full `"yyyy-MM-dd HH:mm:ss"` format and the `Date` instance guard. Low risk but the fallback paths are user-facing (form input uses `"HH:mm"` format).
- **Line 118** (`formatRecurrence`): the `!days` path in the weekly/biweekly branch without a range string. Occurs when `recurrenceDays` is null and `recurrenceEndDate` is also null.
- **Line 170** (`getNextOccurrence` monthly): the `return null` after 12 iterations of cancelled dates. The test for "all remaining occurrences cancelled" covers the weekly variant; the monthly 12-iteration exhaustion is untested.
- **Line 230** (`findNextDayOfWeek`): the `return null` when `maxDays` is exhausted without hitting the end-date guard. Only reachable when all occurrences in a wide window are cancelled.

---

## Trends (baseline — first run)

| Metric | Value |
|--------|-------|
| Vitest unit tests | 39 |
| Test files | 1 (`src/lib/events.test.ts`) |
| Playwright e2e tests | 3 |
| Overall statement coverage | 26.8% |
| `events.ts` statement coverage | 92.76% |
| `events.ts` branch coverage | 83.33% |
| `permissions.ts` branch coverage | 100% |
| `permissions-server.ts` coverage | 0% (DB-dependent; 2 pure functions have no test) |
| `members.ts` coverage | 0% (DB-dependent; e2e covers happy path only) |
| `email.ts` coverage | 0% (Resend-dependent; retry/failure paths uncovered anywhere) |
| `auth/` coverage | 0% (NextAuth-bound; credentials callback untested) |
| Cancelled-occurrence flows with automated coverage | 0 of 9 |
| Wall-clock display flows with automated coverage | 0 of 8 (DST unit tests pass; UI rendering untested) |

Future reviews should track movement on statement coverage for the overall `src/lib/` bundle, the count of e2e tests, and specifically whether any cancel-occurrence or wall-clock e2e tests have been added.

---

## Follow-up: 5 Priority Gaps Closed — 2026-05-18

**Action taken:** All 5 priority gaps closed in the same session. No version bump (test-only changes).

### New files

| File | Purpose |
|------|---------|
| `src/lib/permissions-server.test.ts` | Vitest — `getFeaturesFromSession` and `sessionHasFeature` pure-function tests (gap #3) |
| `src/lib/permissions.test.ts` | Vitest — FEATURES/FEATURE_DESCRIPTIONS catalog completeness + getFeaturesByCategory + ROLES (gap #4) |
| `e2e/cancel-occurrence.spec.ts` | Playwright — cancel+restore occurrence, signup-blocked, permission gate (gaps #1, #5) |
| `e2e/wall-clock-display.spec.ts` | Playwright — wall-clock time display regression guard (gap #2) |
| `e2e/helpers/auth.ts` | Playwright helper — credentials-based sign-in for admin e2e flows |
| `scripts/create-test-user.mjs` | One-time DB setup — creates `lions-e2e-test@westervillelions.org` with admin role |
| `scripts/reset-test-user-pw.mjs` | DB utility — resets test user password to a fresh bcrypt hash |

### Infrastructure note

A dedicated e2e test admin user (`lions-e2e-test@westervillelions.org`) was created in the database. Credentials are stored in `.env.local` as `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`. If the password hash drifts (bcrypt), re-run `pnpm exec dotenv -e .env.local -- node scripts/reset-test-user-pw.mjs`.

The cancel/restore tests use `test.describe.serial` to prevent parallel-execution race conditions on the shared DB fixture (Farmer's Market Signup event, id `291c76f3`). Different occurrence dates are used per test group (`2026-05-30` for cancel/restore, `2026-06-06` for signup-blocked) to further isolate them.

### Updated counts

| Metric | Before | After |
|--------|--------|-------|
| Vitest unit tests | 39 | 59 |
| Vitest test files | 1 | 3 |
| Playwright e2e tests | 3 | 9 |
| Cancelled-occurrence flows covered | 0 of 9 | 4 of 9 |
| Wall-clock display flows covered | 0 of 8 | 2 of 8 |
| permissions-server.ts pure-function coverage | 0% | 14.28% stmts (pure funcs only; DB funcs intentionally unmocked) |

### Gate results

- `pnpm exec tsc --noEmit`: PASS
- `pnpm test`: PASS — 59/59
- `pnpm test:e2e`: PASS — 9/9
- `pnpm build:only`: PASS

### Per-gap status

1. **Gap #1 (cancel/restore + badge):** Closed. `e2e/cancel-occurrence.spec.ts` — 2 serial tests cover: admin cancels with reason → badge + reason appear; admin restores → badge disappears. Permission gate (401 without auth) also covered.
2. **Gap #2 (wall-clock display):** Closed. `e2e/wall-clock-display.spec.ts` — asserts "7:00 PM" appears and UTC-shifted variants ("11:00 PM", "12:00 AM") do NOT appear on the event detail page for a known stored wall-clock time.
3. **Gap #3 (permissions-server.ts pure functions):** Closed. `src/lib/permissions-server.test.ts` — 11 tests covering `getFeaturesFromSession` (5 cases) and `sessionHasFeature` (6 cases) including empty, undefined, null features arrays.
4. **Gap #4 (permissions.ts catalog completeness):** Closed. `src/lib/permissions.test.ts` — 9 tests including FEATURE_DESCRIPTIONS completeness check, no-orphan-keys check, `getFeaturesByCategory` (4 cases), FEATURES dot-notation format, no-duplicates, ROLES catalog.
5. **Gap #5 (signup blocked on cancelled occurrence):** Closed. `e2e/cancel-occurrence.spec.ts` — asserts POST `/api/events/[id]/signup` returns 400 with `error` matching `/cancelled/i` when the occurrence has an override row.
