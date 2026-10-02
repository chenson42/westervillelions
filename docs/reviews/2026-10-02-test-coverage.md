# Test Coverage Review — 2026-10-02

**Owner:** qa
**Cadence:** 7 days. Last run 2026-09-25 (`2026-09-25-test-coverage.md`); this run is on cadence (7d, 0d overdue).
**Scope:** everything shipped since the 2026-09-25 baseline: v1.83.0 (public-form junk guard), v1.84.0 (same-title event fan-out), v1.85.0 to v1.88.0 (reimbursements without board approval, aged-fund FIFO, email-queue retention, discard reconciliation session, same-entity move + hardened delete, cross-entity move, treasurer permission baseline, reconcilable paid reimbursements).

## Verdict

**PASS on the suites, with a prioritized gap list.** Typecheck, lint, unit and the orchestrator's e2e run are all green, the two live gaps from 2026-09-25 are resolved (B-73) or unchanged and still open (B-74), and this week's new ledger code is the best-tested code in the repo (most new modules 95-100%). The headline is not this week's work. It is that **three high-value surfaces have almost no automated coverage** (member RSVP/signup routes: no unit tests and one e2e; public form submission plus the new junk guard: neither; the DB-bound permission resolver that every gate depends on: neither), and the last of those was assigned to qa on 2026-06-24 and never done. Details and ready-to-file backlog wording below.

## Suite results

| Layer | Result | Notes |
|---|---|---|
| `pnpm exec tsc --noEmit` | PASS | Clean, no output. |
| `pnpm test` (Vitest) | PASS | **188 files / 3294 tests, 0 failed**, about 4s. Baseline 2026-09-25 was 127 files / 2203 tests: +61 files, +1091 tests. |
| `pnpm lint` | PASS | 0 errors, 1 pre-existing warning (`budget-context-panel.tsx:114` unused eslint-disable). The 3 lint errors the B-111 Phase 5 saw in B-108's files are gone at HEAD. |
| `pnpm build:only` | **NOT RUN by me** | A dev server is listening on :3000 and `next build` shares `.next`. Each Phase 5 this week recorded a green build (latest: B-108, exit 0, 2026-10-02), but I did not re-prove it at HEAD `9179e51`. The pre-push skill should. |
| `pnpm test:e2e` | **Cited, not re-run** | Orchestrator's run today: **220 passed / 1 skipped / 0 failed** (baseline 186 / 1 / 0). The +34 is my arithmetic from the Phase 5 logs, not from a report I read: `ledger-move-transaction` 15, `ledger-reimbursement-correct` 7, `admin-email-queue-access` 7, `admin-events-announce-page-gate` +2, `admin-ledger-budget-committee-gate` +3. |
| Manual click-through | See "Live-only checks" | Every feature this week was verified by scripted browser/curl runs against the dev DB; most of that is not repeatable in CI. |

Safety: no query in this review touched `PROD_DATABASE_URL`. Vitest does not read `.env.local`; the read-only SQL I ran used `DATABASE_URL` after confirming its host differs from the production host. Note `PROD_DATABASE_URL` is an **active, uncommented line** in `.env.local` (CLAUDE.md documents this as making production the default target for scripts); every QA pass this week had to compare hosts by hand to be safe.

## Coverage (v8, `src/lib/**`)

Overall: **73.19% statements / 71.05% branches / 69.09% functions / 74.34% lines** (2026-09-25: 65.2 / 62.76). Above the 70% target for the first time in this series. The +8 points came from new ledger modules landing at 95-100%, not from closing old 0% modules (see "Still-0% modules").

### Standing watch list

| Module | Stmts | Branch | Target | Status |
|---|---|---|---|---|
| `events.ts` | 94.86 | 88.94 | 90+ | Met. (09-25: 94.96 / 88.) Grew by `isUpcomingWallClock` and `diffFanOutFields`, both covered. |
| `permissions.ts` | 100 | 100 | 100 | Met. |
| `members.ts` | 86.84 | 70.83 | 80+ | **Met numerically, gap not closed.** See P7. Lines 151-166 and 184 are 0%. |
| `email.ts` | 100 | 95.45 | n/a | Strong (line 361 only). |
| `financial-report-queries.ts` | 82.51 | 70.33 | n/a | 4 uncovered anonymous callbacks: the `getLatestOpenMonthForEntity` blocking-date filter/map (about line 779-785) and two in `getMonthlyStatement`'s cause-line builder (about 867, 904). The pure predicate has a brute-force equivalence test (`financial-report-queries.test.ts:811`); the carve-out has e2e (`deposit-in-transit-carveout`). Acceptable. |
| `reconciliation-queries.ts` | 53.15 | 46.29 | n/a | 20 uncovered named functions, all plain CRUD/reads (`insertBankLines`, `insertMatch`, `getCandidateTransactionsForMatching`, `getLaterClosedSessionForAccount`, ...). This week's new code in the file (`discardOpenSession`, `listLaterClosedSessionsForAccount`) is covered. The CRUD is exercised by `deposit-in-transit-carveout`, `ledger-move-transaction` and `ledger-reimbursement-correct` e2e. Accepted, not a new gap. |
| `ledger-fund-move-queries.ts` | 99 | 87.82 | n/a | Strong. |
| `ledger-reimbursement-correction-queries.ts` | 95.21 | 86.36 | n/a | Strong. 1 uncovered callback (~line 589). |

### Other modules touched this week

100% statements: `email-compose`, `email-queue-stats`, `email-queue-view`, `event-siblings-queries`, `ledger-ack-donee`, `ledger-audit-notes`, `ledger-correction` (94.25 br), `ledger-duplicate-candidates`, `ledger-fund-move-ack`, `ledger-fund-move-policy`, `ledger-reimbursement-link` (75 br), `ledger-transaction-lock`, `ledger-transaction-validation`, `ledger-transfer-policy`, `ledger` (95.81 br), `durable-claim-row`, `email-durable-claim`, `email-guard`, `form-guard` (97 br).
Below 100: `ledger-acknowledgment-letter-queries` 99.28, `ledger-audit` 96.42, `ledger-reimbursement-correction` 97, `turnstile` 96.15, `ledger-fund-move-preview` 81.25 (`listMoveRegisterContext`, the register's Move-button loader, is 0% unit; covered by the move e2e).
Real gaps in changed files: **`ledger-queries.ts` 47.41%** (the aged-fund loader inside `getOverview()` is 0 of 22 statements, see P4); `utils.ts` 12.5% (pre-existing; the new `isUuid` is fully covered); `permissions-server.ts` 14.28% (see P3).

### Still-0% modules (unchanged, deferred to e2e by convention)

`auth/index.ts` 0, `proposals-queries` 0, `social-requests-queries` 0, `documents-queries` 0, `dues-queries` 0, `google-groups` 2.04, `auth/password-reset` 35.55, `club-files-queries` 58, `minutes-queries` 57. The convention is "DB-bound is covered by e2e". That compensating claim is false for some of these (P1, P2, P3 below); I checked each against `e2e/`.

## Carry-over from 2026-09-25

| Item | Status |
|---|---|
| **B-73** (`dues_reminders` / `event_announcements` read raw `.success`) | **Closed and holding.** `src/app/api/admin/dues/reminders/route.test.ts` exists, test 6 is the blocked-send regression. |
| **B-74** (generic email-queue retry unaware of durable claims) | **Still open, no code change.** `grep` for `ledger_acknowledgments`, `financialReportSends`, `dues_reminders`, `event_announcements` in `src/app/api/admin/email-queue/retry/route.ts` is empty. Two things changed around it. Narrowed: the retention purge (v1.85.0) deletes rows older than 183 days and the three claim tables' `email_queue_id` FKs are `ON DELETE SET NULL` (verified in the dev DB), so the exposure window is now six months. **Widened**: DECISION-115 gates the retry route on `EMAIL_QUEUE_FEATURES` (`email_queue.manage` or `admin.users`), so the `treasurer` role can now trigger the double-send path, not just `admin.users` holders. Recommend adding that to B-74's text. |
| 09-25 finding #3 (`members.ts` provisioning failure paths) | **Partially moved.** 36.84% to 86.84%, but only because `members-welcome-email.test.ts` exercises the create-new-user path. The existing-user relink, the `EMAIL_CONFLICT` guard (user already linked to a different member) and the missing-`member`-role warning are still 0%. See P7. |
| `E2E_ADMIN_PASSWORD_HASH` mismatch trap | **Fixed.** `bcrypt.compare(E2E_ADMIN_PASSWORD, E2E_ADMIN_PASSWORD_HASH)` is true today. |
| `recurring-signup-rollup.spec.ts` date rot | **Held.** Self-seeding fixture; green in the orchestrator's run. The shared series `291c76f3` ended 2026-09-26 and `write-in-signups` still passes, as predicted (admin detail page is not date-filtered). |
| Fixture-pollution recheck | **Two small leaks, one schema trap.** See P11. |

## Prioritized gap list

Priorities: **P1-P3 high** (a regression here reaches members or weakens a gate with no automated signal), **P4-P7 medium**, **P8-P12 low-medium/low**. "Established" means I read it in code or re-queried it; "believed" means a theory I did not reproduce.

### P1 (HIGH) Member RSVP and signup routes are almost entirely untested

`src/app/api/events/[id]/rsvp/route.ts` (157 lines) and `src/app/api/events/[id]/signup/route.ts` (298 lines) have no unit test and no e2e. **Established:** no `*.test.*` beside either route. The only e2e that touches them is one test, `cancel-occurrence.spec.ts:174` (member `POST /api/events/[id]/signup` on a cancelled occurrence returns 400). `/api/events/[id]/rsvp` appears in no spec at all, and the other signup specs (`recurring-signup-rollup`, `write-in-signups`) call the admin write-in route `/api/admin/events/[id]/signup` or seed RSVP rows by DB. The member-facing code carries the logic the charter names as the second most important flow: `maxAttendees` capacity with guests (`COALESCE(SUM(1 + guestCount))`), the 409 "occurrence is full" and unique-violation race, required `occurrenceDate` for recurring series, rejection of cancelled occurrences, per-occurrence keying, and the wall-clock/UTC parsing of `occurrenceDate` (all of these except the cancelled-occurrence 400 are unexercised) that already produced the "12:30 PM shows as 8:30 AM" bug. This is the first review to flag it: I grepped every prior test-coverage review for `rsvp/route` and found nothing, so it has not been known-and-deferred, it has been missed.

**Proposed backlog wording:** *"Member RSVP and signup routes have no tests. Add route tests for `POST /api/events/[id]/rsvp` and `POST|DELETE /api/events/[id]/signup` (mocked db): invalid status 400, recurring without `occurrenceDate` 400, cap reached 409 including guest counts, unique-violation race 409, non-recurring vs per-occurrence keying, 401 when unauthenticated on signup. Add one member-side e2e (self-seeded private RSVP event like `cancel-occurrence.spec.ts`): a signed-in member signs up for one occurrence of a weekly series and only that occurrence's count rises. Priority: should-do, high."*

### P2 (HIGH) Public form submission and the v1.83.0 junk guard are untested at the route and e2e layers

**Established:** `contact`, `newsletter/subscribe`, `membership-applications` and `auth/register` route handlers have no test files; no e2e submits any public form (`grep` for `/contact`, `/join`, `newsletter` in `e2e/` matches only an admin gate spec). `form-guard.ts` is well covered as pure functions (100% / 97%), `turnstile.ts` 96%, `purge-form-spam.test.ts` 13 cases. What is not covered is the **wiring**, which is where the 2026-09-28 Revision 2 changes landed (after Phase 5 Revision 1 FAILED on recall): the order "cooldown before content guard", the `renderedAt` timing check, honeypot, and the dynamic `@/lib/db` import inside `checkAndRecordFormCooldown()`. Those were verified once, by hand, with `TURNSTILE_SECRET_KEY` temporarily removed from `.env.local`. Two properties make this worse than an ordinary gap: a rejected submission returns `{"success":true}` (by design), so **a false positive on a real applicant is invisible to the applicant and to the club**; and the structural guard rejects a form submitted too soon after render, which is exactly how Playwright (and a password manager with autofill) behaves, so an e2e has to wait deliberately or it will test the guard instead of the form. The charter lists "Public form submission: contact, newsletter, membership application" as a named high-value e2e flow; it has never had one. Related and also untested: `auth/reset-password/route.ts` (token consumption; the forgot-password half got a unit test this week) and `auth/register/route.ts`; there is no forgot-then-reset-then-sign-in e2e.

**Proposed backlog wording:** *"Public forms have no route or e2e coverage. (a) Route tests for contact, newsletter/subscribe, membership-applications: honeypot filled returns success and writes nothing; two-field gibberish returns success and writes nothing; one gibberish field plus one legitimate field writes the row; hard-surname legitimate input (Nguyen, Krzyzewski shapes) writes the row; same email on a second form inside the cooldown is dropped while a different email is not; the cooldown check runs before the content guard (assert call order). (b) One Playwright spec per form with Turnstile unset in dev, waiting past the render-time floor, asserting the row (or `email_queue` row, status `blocked_non_production`) and the success state. (c) Route tests for `auth/reset-password` and `auth/register`, and one forgot-reset-sign-in e2e. Priority: should-do, high; the guard returns success on rejection, so only a test can notice a false positive."*

### P3 (HIGH, long-standing, owned by qa) The DB-bound permission resolver has never run under test

**Established:** `src/lib/permissions-server.ts` is 14.28% covered. `permissions-server.test.ts` tests only the two pure session helpers; `getUserFeatures`, `hasFeature`, `hasAnyFeature`, `hasAllFeatures`, `requireFeature` and the 60-second cache have no test. 62 other test files reference this module (the gate tests `vi.mock` it), so every route gate test asserts "the route called `hasFeature` with the right key" and none asserts what `hasFeature` returns for a real role set. This was flagged **High on 2026-05-18** and **Medium on 2026-06-24 with "Assignee: qa"** (`2026-06-24-test-coverage.md:154,183`) and never done. It matters more this week: every gating change shipped (`hasAnyFeature` for `EMAIL_QUEUE_FEATURES` and `BUDGET_WRITE_FEATURES`, the events page, the `ledger.manage` bind to `treasurer`) routes through it, the Phase 5 for B-111 observed the 60s cache live ("re-sign-in, then wait a minute"), and `default-role-bundles.test.ts` / `treasurer-permission-migration.test.ts` only scan the migration SQL, not the resolver. **Also established:** the "admin gets ALL features" rule and the union-of-roles `selectDistinct` are implemented twice, in `getUserFeatures()` (`permissions-server.ts`) and in the JWT callback `src/lib/auth/index.ts:243-264` (0% covered), with no test that they agree. **Mixed gating, not a defect I am claiming:** 3 route files read `session.user.features` (JWT, refreshed on sign-in or explicit update) while 118 use DB-backed `hasFeature`/`hasAnyFeature`; a role revocation reaches the second group within 60s and the first only at re-sign-in. I did not test how stale the JWT can get. **Why I'm not just writing it:** this review's brief forbids source edits; the test is about 60 lines and I will take it if assigned.

**Proposed backlog wording:** *"Unit-test the DB-bound permission resolver (carried since 2026-05-18/2026-06-24). `permissions-server.ts`: mock Drizzle and cover admin-role returns every feature, multi-role union without duplicates, no roles returns empty, cache hit inside 60s makes no second query, cache expiry (fake timers) re-queries, `clearUserPermissionCache`, `hasAnyFeature([])` is false, `hasAllFeatures([])` behavior is pinned deliberately, `requireFeature` throws with the key named. Add a parity test that the JWT callback in `src/lib/auth/index.ts` and `getUserFeatures` resolve the same feature set for the same role rows (or extract one shared resolver; the rule currently lives in two places). Priority: should-do, high; this is the primitive behind every Feature-Gate Audit."*

### P4 (MEDIUM) The aged-fund loader SQL, the actual input behind the reported bug, is 0% covered

**Established:** `getOverview()` lines 3170-3250 of `ledger-queries.ts`, including Query A2 (`COALESCE(SUM(CASE WHEN txn_date >= cutoff ...))` per public fund, `status = 'posted'`, `flow IN ('income','expense')`), are **0 of 22 statements** covered, and `ledger-queries.test.ts` has no aged test; no e2e references the flag. The 2026-10-01 bug was data-shaped (a mature fund whose trailing-year income exceeds its balance); the pure function `computeAgedPublicFunds` is 100% covered with the regression test at `ledger.test.ts:287`, and QA verified the loader once against dev data (Charitable Fund no longer flagged, Activity Fund flagged, a $100 round trip). A one-character change in the loader (`>=` to `>`, dropping the `posted` filter, mis-handling the cutoff) would pass all 3294 tests and ship a wrong compliance flag.

**Proposed backlog wording:** *"Pin the aged-fund loader. Extract the Query A2 block of `getOverview()` into a small function (or test it in place) and cover: SQL shape rendered through `PgDialect` (posted-only, income and expense, `txn_date >= cutoff::date`, grouped by fund and flow), the row-to-facts mapping (income window vs total, missing fund defaults to 0), and that the cutoff comes from `agedPublicFundCutoffDate(settings.holdingPeriodWarnDays)`. Priority: should-do, medium."*

### P5 (MEDIUM) The reimbursement lifecycle has no committed e2e, and the spec's stated reason for skipping Mark Paid is out of date

**Established:** `grep -rniE "reimburs|Mark Paid" e2e/` matches only `ledger-reimbursement-correct.spec.ts`, which seeds paid rows by DB and states in its header that it "NEVER drives Mark Paid (it emails the member)". That premise predates deny-by-default outbound email: with a fixture member on `example.invalid` and `EMAIL_DEV_ALLOWLIST` unset, `sendEmail()` queues `blocked_non_production` and nothing leaves the machine (CLAUDE.md, "Outbound Email Is Deny-By-Default"). Unit coverage of the lifecycle is strong and mutation-verified (admin `[id]` route 41 tests, member routes 12 + 8, `ledger-reimbursement.test.ts` 21), so this is the integration layer: the pay route's pinned `WHERE`, the now-required `bankAccountId` and normalized check number, the status-conditioned reject/member-edit races, and the posted transaction's lock were all verified by an ad hoc script. Also untested: `GET admin/ledger/reimbursements/route.ts`, `members/reimbursements/page.tsx` and `reimbursement-form.tsx` (no unit, no e2e).

**Proposed backlog wording:** *"Add a reimbursement lifecycle e2e: seed a fixture member (`example.invalid`) and a submitted request; as the e2e admin open Mark Paid, assert bank account is required and preselected, check number field appears for Check only, submit, assert the posted transaction exists with the account and number, is locked against edit/delete, the Paid tab shows payer and fund, and the member and treasurer emails land as `blocked_non_production` rows. Second test: reject twice, second is 409. Update the spec header comment that says Mark Paid is never driven. Priority: should-do, medium."*

### P6 (MEDIUM) Money-integrity guards that rest on live-only or mock-only proof

The deterministic halves of this week's race fixes can be e2e-tested; only the interleaving cannot.
- **Close/match account-mismatch (F1 fix, v1.87.0).** Unit tests are mock-based; the real-Postgres proof was a throwaway script (orphan 4 of 4 before, 0 of 3 after). Deterministic e2e: seed a Club row matched by direct SQL into an open Foundation session, `POST .../close` must return 400 `transaction_account_mismatch` and leave the row unreconciled; `POST .../match` of an off-account row must return 409. Note the close route had **no unit test at all** until this week's F1 fix added 4.
- **Discard reconciliation session (v1.85.0).** Zero e2e. Legs (a)-(e) were a scripted run, never committed; the Phase 5 itself lists "optional committed Playwright spec" as a follow-up. Deterministic e2e: open session with lines and matches, discard through the `ConfirmDialog`, assert session/lines/matches gone, transactions untouched and unreconciled, a closed session answers 409 byte-identical, and the same period can be re-created.
- **Mock-only by nature (cannot be a CI test):** the `FOR UPDATE` contention and parallel-POST stale races (n=2 and n=6), the `ACCESS EXCLUSIVE` ordering test, and the `BEFORE UPDATE ... RETURN NULL` fault injection that made the rollback sentinels observable. The unit suites pin the same behavior statically (`PgDialect` renders `FOR UPDATE`, `txEnd` is `rolled_back` not `committed`, mutation proofs), which is the right stand-in, but it is a stand-in.

**Proposed backlog wording:** *"Commit e2e for the two deterministic reconciliation guards: (a) close and match refuse an off-account matched transaction (seed via DB); (b) discard an open session end to end including the closed-session 409 and same-period re-create. Reuse `cleanupMoveTransactionFixtures()`. Priority: should-do, medium."*

### P7 (MEDIUM) `provisionUserForMember` branches still untested

Carry-over of 09-25 finding #3, narrowed. **Established:** `members.ts` lines 149-166 (`existingUser` found, `EMAIL_CONFLICT` when `existingUser.memberId` is set and differs, otherwise relink and return `wasExisting: true`) and line 184 (missing `member` role) are 0%; `members-welcome-email.test.ts` covers only the create path. Route tests (`admin/members/route.test.ts`, `[id]/route.test.ts`) mock `provisionUserForMember` and test how they *handle* `EMAIL_CONFLICT`, not whether it is raised. The project memory states an active member without a linked user is a defect. The mock surface already exists in `members-welcome-email.test.ts`, so this is about three tests.

**Proposed backlog wording:** *"`provisionUserForMember`: add three tests beside `members-welcome-email.test.ts`: existing unlinked user (case-insensitive email) is linked with no welcome email; existing user linked to the same member is re-affirmed; existing user linked to a different member throws `EMAIL_CONFLICT` and writes nothing. Priority: small, medium."*

### P8 (LOW-MEDIUM) Email-queue retention: pin the FK invariant and plan the first production purge

The purge is a `DELETE` triggered by rendering `/admin/email-queue`. **Established:** three tables reference `email_queue` (`dues_reminders`, `event_announcements`, `financial_report_sends`) and all three FKs are `confdeltype 'n'` (SET NULL) in the dev DB and `onDelete: "set null"` in `schema.ts` (lines ~554, ~597, ~1378). Nothing pins that. If one is ever changed to cascade, the purge would silently delete durable "this was sent" claims, the exact failure DECISION-102 exists to prevent. Separately, the QA smoke found **0 real rows older than the cutoff in dev**, so the first execution against real rows will be production, on or after **2026-10-13**. Unit proof is good (pinned SQL, call order, swallowed failure, gate).

**Proposed backlog wording:** *"Add a source-scan test (pattern: `budget-write-gate.test.ts`) asserting every `references(() => emailQueue.id` in `src/lib/db/schema.ts` has `onDelete: 'set null'`. Add a read-only post-deploy check to the release checklist for the first purge: count of `email_queue` rows older than 183 days before and after the first admin visit on or after 2026-10-13, and row counts of the three claim tables unchanged. Priority: small, low-medium."*

### P9 (LOW-MEDIUM) Event fan-out UI has no committed test

`apply-to-siblings-control.tsx` and the `event-form.tsx` changes (v1.84.0) have no component test and no e2e; the route (12 tests), `events.ts` helpers (11) and `event-siblings-queries` (3) are covered. The ConfirmDialog that must list every sibling date, the exact-title match and the "matched by the original title when renaming" note were verified by a disposable script against real "General Meeting" rows in the dev DB. Admin-only and `events.edit`-gated, so low blast radius. **Proposed:** *"Self-seeding e2e for same-title fan-out: create 3 future events with an `E2E QA` title, edit location with the box ticked, assert the dialog lists three dates, confirm, assert siblings changed and a past/other-title event did not. Priority: low."*

### P10 (LOW-MEDIUM) 360px verification is manual screenshots in a scratch directory

This week's QA passes found at least four horizontal-overflow or off-screen problems at 360px (dashboard transactions table, reconciliation session grid at 848px, email-queue "Not Sent" table clipped, reimbursement action buttons off-screen; several are filed as B-89 and B-139). All were measured by hand; the only committed viewport check is one test in `budgeting-restructure.spec.ts`. CLAUDE.md lists mobile-first as a gotcha. **Proposed:** *"One `mobile-overflow.spec.ts` that loads about eight admin ledger/email-queue pages at 360x800 and asserts `document.documentElement.scrollWidth <= clientWidth`, annotating the known offenders with their B-ids so the test flips the day each is fixed. Priority: low."*

### P11 (LOW) Fixture hygiene in the dev DB (established by read-only SQL)

- **Two leaked fixtures** from aborted runs: event "E2E QA Cancel Occurrence Fixture ..." (created 2026-09-11, so `afterAll` did not run that day) and one `qa-...@example.invalid` user (2026-09-18). Both are past-dated and inert.
- **`user_roles` has no `UNIQUE (user_id, role_id)`** (only `user_roles_pkey` on `id`; `schema.ts:82-87`). `scripts/create-test-user.mjs` uses `ON CONFLICT DO NOTHING`, which has nothing to conflict on, so the e2e admin now has **10 rows for 2 roles** (5 copies each). Harmless today because `getUserFeatures` uses `selectDistinct`, but a role *removal* path that deletes by `(user_id, role_id)` would remove all copies and an *assignment* path anywhere else can do the same. Production not checked (never read). **Proposed:** *"Add UNIQUE (user_id, role_id) to `user_roles` (idempotent migration that first de-duplicates), or make the script check-then-insert; sweep the two leaked fixtures. Priority: low; schema change goes to database-admin."*

### P12 (LOW) Test-name discipline

QA's Phase 5 for reimbursements noted the delivered guards lack the "— regression for X" suffix the project asks for. The B-108 and B-111 e2e titles do carry it. A rename at next touch is enough; not filing.

## Flaky e2e: the sign-in race, and whether `e2e/helpers/auth.ts` needs a retry

**Established (from the work-logs and the files):**
- `e2e/global-setup.ts` warms `/`, `/signin`, `/members`, `/admin`, `/api/auth/csrf|session|providers` once, before any test. It is the fix for the 2026-09-10 cold-start `MissingCSRF` race.
- Playwright retries are `process.env.CI ? 2 : 0`, so locally a single bounce fails the test, and because most suites are `describe.serial`, the rest of that file is skipped.
- Sign-in logic is **copy-pasted**: `e2e/helpers/auth.ts` (`signInAsAdmin`, used by 21 spec files) plus nine spec-local copies of the same five lines (`admin-email-queue-access`, `admin-events-announce-page-gate`, `admin-ledger-budget-committee-gate`, `club-files-flow`, `proposals-permission-boundary`, `admin-minutes-notetaker-gate`, `social-requests-flow`, `admin-subscriptions-page-gate`, `admin-documents-notetaker-gate`). The two flakes this week landed in one of each kind: `budget-star-notes` (uses the helper) and `admin-events-announce` (local copy). A retry added only to `auth.ts` would have fixed the first and not the second.
- The aged-fund Phase 5 independently recorded one more cold-server `MissingCSRF` on 2026-10-01 (warm retry succeeded).

**Believed, not established:** that the race is back for a different reason than cold start. `global-setup` protects only the first requests after the server boots; this week three or four pipelines edited source under a running `next dev` while e2e ran, and each edit can invalidate the compiled auth route or page graph so a later sign-in POST races a recompile. Test that before relying on it: correlate `[auth][error] MissingCSRF` lines in the dev log with file-save times. I did not reproduce it.

**Recommendation: yes, add a bounded retry, in one place.**
1. Move the sign-in into `e2e/helpers/auth.ts` as `signInAs(page, email, password)`; make `signInAsAdmin` delegate; replace the nine local copies with imports (that is also the "same decision in more than two places" duplication finding).
2. Retry only the specific failure: after submit, if the URL is still `/signin` **and no credentials-error message is visible**, `await page.request.get("/api/auth/csrf")` and re-submit. Cap at 3 attempts so a real auth break (wrong hash, Turnstile on) still fails within about 45s.
3. `console.warn("[e2e] sign-in retry n")` on every retry so the flake stays visible instead of becoming a habit (the `global-setup` comment explains why silent re-runs are the dangerous part).
4. Do **not** set `retries: 1` globally: serial describes re-run non-idempotent `beforeAll` fixture setup against state the failed attempt already changed.
The implementer must confirm the selector for the credentials-error element on `/signin`.

**Proposed backlog wording:** *"Consolidate e2e sign-in into one helper with a bounded, logged retry for the MissingCSRF bounce. Replace nine spec-local `signIn`/`signInAsFixture` copies. Done when a cold-after-edit dev server no longer fails the first sign-in in a full run and a wrong password still fails fast. Priority: should-do, low-medium."*

## Date-anchored fixtures (next 30 days: through 2026-11-01)

I found **nothing that will break in the next 30 days.** What I checked and what remains latent:
- **Unit tests** with a real clock (21 files use `new Date()`/`Date.now()` without fake timers): all the time-sensitive ones I opened use the value as a timestamp stamp or a +/- 1 day offset (`minutes-queries.test.ts` `wallClock(offsetDays)` uses offsets of -3, +1, -30, -60). The aged-fund, move-lock and `isUpcomingWallClock` tests inject a fixed `now`. DST ends **2026-11-01**; `events.test.ts` DST cases use fixed dates.
- **Shared dev-DB fixtures.** The only event IDs the e2e specs hard-code are `2a68b4c6` ("Lions Club Meeting", one-off, 2026-05-21; used by `wall-clock-display`, a fixed input-to-output assertion) and `291c76f3` ("Farmer's Market Signup", series ended 2026-09-26, used by `write-in-signups` against the date-agnostic admin detail page). Both are stable as long as nobody edits or deletes those rows; a script that touches them is the failure mode, not the calendar. The rest of the hard-coded UUIDs are ledger entities/funds/accounts.
- **Latent, not inside 30 days:** `todayIso()` in `e2e/ledger-move-transaction.spec.ts:74` and `e2e/helpers/cross-entity-move-fixtures.ts:51` is `new Date().toISOString().slice(0, 10)`, a **UTC** date, while the app uses the Eastern wall clock. Between 8 PM and midnight Eastern it returns tomorrow. Harmless this month; on the evening of **2027-06-30** it would date the fixture 2027-07-01, the next fiscal year, and the tier tests (prior-year vs current-year needs `ledger.manage`) would flip. `ledger-reimbursement-correct.spec.ts:77-90` uses the machine-local date instead, correct only on an Eastern-time machine. **Proposed:** *"Use one Eastern-date helper in e2e fixtures (same source as the app's `nowEastern()`)."* Priority: low; fold into the sign-in/helper cleanup.
- **Fixed sessions in the move spec** (August/September 2026 closed sessions, gift dated 2026-08-15) do not depend on "now" and are in FY2026-27 until 2027-07-01.

## Which of this week's flows have no automated coverage, and which rest on live-only checks

Legend: **U** unit, **E** committed e2e, **L** live/scripted only (dev DB), **M** manual follow-up owed.

| Flow (release) | Automated | Live-only or not automated at any layer |
|---|---|---|
| Public-form junk guard (v1.83.0) | U on pure guard, turnstile, purge script | **Route wiring + cooldown order: L only (curl with Turnstile removed). No E.** Prod purge dry-run reproduced 15 of 16 once; `--apply` never run (M). See P2. |
| Same-title event fan-out (v1.84.0) | U: 26 tests (route, queries, helpers) | **UI + dialog listing dates: L only** (disposable script on real dev rows). See P9. |
| Reimbursements without board approval (v1.85.0) | U strong, mutation-verified | **Lifecycle: L only.** No E. Reject-vs-pay interleave not reproducible by hand either. See P5. |
| Aged-fund FIFO (v1.85.0) | U on pure function only | **Loader SQL: 0% unit, L only** (dev figures, $100 round trip). See P4. |
| Email-queue retention (v1.85.0) | U: pinned SQL, call order, gate | Purge against real rows: **L on fixtures only; first prod run is M on/after 2026-10-13.** See P8. |
| Discard reconciliation session (v1.85.0) | U: 8 + 8 + 3 | **All end-to-end legs L only.** No E. 360px, `ConfirmDialog` copy L. See P6. |
| Move + hardened delete (v1.86.0) | U + **E 8** | Concurrency (parallel POST, `FOR UPDATE`) L; 360px L. |
| Cross-entity move + F1 fix (v1.87.0) | U + **E +7** (15 total) | **F1 interleave L; deterministic close/match refusals have no E.** Migration 0109 replay L (U shape test exists). See P6. |
| Treasurer permission baseline (v1.88.0) | U parity/bundle tests (8 mutations caught) + **E 24** | Five-persona matrix L; stale-JWT / 60s cache L, undocumented in any test (P3). **M: read the production role table** for non-admin `treasurer` holders (B-111 F4); never read from QA. |
| Reconcilable paid reimbursements (v1.88.0) | U strong + **E 7** | Concurrency (`ACCESS EXCLUSIVE`, `FOR UPDATE`) and sentinel fault injection L. **M: post-deploy read-only check** `SELECT count(*) FROM ledger_transactions WHERE status='posted' AND bank_account_id IS NULL` should be 0 after the treasurer repairs the two 2026-10-01 rows; Mark Paid emailing a real member is deliberately unexercised. |

Feature-gate spot audit (read from files, not inferred): I scripted a check of every `route.ts` added or changed since the baseline under `src/app/api`. All 26 changed `admin/**` routes call `auth()`; 25 also call `hasFeature`/`hasAnyFeature`, the budget group uses `BUDGET_WRITE_FEATURES` consistently, mutation routes use `LEDGER_RECORD`/`LEDGER_MANAGE`, read routes `LEDGER_VIEW`. The 26th, `admin/events/[id]/route.ts`, gates on `session.user.features.includes(EVENTS_EDIT | EVENTS_DELETE)` (JWT, not DB; see P3 note), so it is gated, by the other mechanism. `members/reimbursements*` are member-owned (session `memberId` + status-conditioned writes, no `FEATURES` key by design). The five public routes (`forgot-password`, `register`, `contact`, `membership-applications`, `newsletter/subscribe`) are anonymous by design. No missing or wrong gate found.

## Ranked summary

| # | Priority | Gap | Cost |
|---|---|---|---|
| P1 | High | Member RSVP + signup routes: no unit tests, one e2e (cancelled-occurrence 400); never flagged before | route tests + 1 e2e |
| P2 | High | Public forms + v1.83.0 guard wiring + reset/register: no route or e2e coverage; false positives are silent | route tests + 3 e2e |
| P3 | High | DB-bound permission resolver (and its duplicate in the JWT callback) never run under test; carried since 2026-05-18, owned by qa | about 60 lines |
| P4 | Medium | Aged-fund loader SQL 0% | small |
| P5 | Medium | Reimbursement lifecycle no e2e; stale "never drive Mark Paid" premise | 1 e2e |
| P6 | Medium | Discard session and close/match account-mismatch guards have no committed e2e | 2 e2e |
| P7 | Medium | `provisionUserForMember` existing-user / `EMAIL_CONFLICT` branches | 3 unit tests |
| P8 | Low-Med | Pin `email_queue` FK `SET NULL`; first prod purge after 2026-10-13 | 10 lines + checklist |
| P9 | Low-Med | Fan-out UI e2e | 1 e2e |
| P10 | Low-Med | 360px overflow sentinel spec | 1 e2e |
| P11 | Low | Leaked fixtures; `user_roles` lacks UNIQUE | migration + sweep |
| flake | Low-Med | Consolidate 10 sign-in copies, bounded logged retry | helper change |

## Outputs

- This file, and one line appended to `docs/reviews/log.md`.
- No source, test, `docs/backlog.md` or `docs/decisions.md` edits. Scratch (coverage JSON, run output) is in the session scratchpad only.
- Verification commands run: `pnpm vitest run --coverage` (twice, text/JSON reporters), `pnpm exec tsc --noEmit`, `pnpm lint`, read-only `psql` against `DATABASE_URL` (dev) for FK, fixture and `user_roles` checks.

## Open questions / handoff notes

- Nominate **api-developer** for P1/P2 route tests, **qa** for P3/P7/P4 (small, mechanical; qa owns P3 from 2026-06-24), **full-stack-developer** for the e2e helper consolidation and P5/P6/P9/P10 specs.
- Please add the widened-actor note (treasurer can reach the retry route, DECISION-115) to B-74.
- I could not verify build at HEAD (dev server on :3000); `/pre-push` should.
- Not checked and worth a human: production's `user_roles` duplicates (P11) and the production `treasurer`/`admin.users` role holders (B-111 F4).
