# Silent email delivery failure when RESEND_API_KEY is missing — Work Log

> **Slug:** `2026-09-25-email-silent-success`
> **Surface:** mixed (server-side email infrastructure, used by every outbound-mail feature)
> **Permission(s):** none — infrastructure bug, no new permission surface
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | (brief, inline) | Complete | Bug confirmed with production evidence | 2026-09-25 |
| 2 — Architectural review | (skipped — documented below) | Skipped | N/A | 2026-09-25 |
| 3 — Technical design | (brief, inline) | Complete | see Phase 3 section | 2026-09-25 |
| 4 — Implementation | api-developer | Complete | — | 2026-09-25 |
| 5 — Verification | qa | Complete | PASS | 2026-09-25 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-09-25 |

**Post-ship follow-up work status** (Phase 6's tracked follow-ups #1–2, plus the per-message retry feature that followed):

| Item | Owner | Status | Verdict | Date |
|------|-------|--------|---------|------|
| Follow-up #1–2 implementation (failed-count badge, `dev_no_api_key` visibility) | ux-developer | Complete | — | 2026-09-25 |
| Follow-up #1–2 verification | qa | Complete | PASS | 2026-09-25 |
| Per-message (targeted) retry — implementation | (unattributed — see "Note on pipeline gap" below) | Complete, no Phase 1–3 write-up | — | 2026-09-25 |
| Per-message retry — verification (1st pass) | qa | Complete | **FAIL** (duplicate-send race; escalated deny-by-default gap) | 2026-09-25 |
| Per-message retry — rework (fixes both findings) | api-developer | Complete | — | 2026-09-25 |
| Per-message retry — re-verification (2nd pass) | qa | Complete | **PASS** (with a required follow-up: `retrying`-row stranding, see Phase 5 re-verification section) | 2026-09-25 |
| 6 (repeat) — Shipped vs intent, per-message retry | analyst | **Not yet run** | — | — |

---

# Phase 1 — Bug Confirmation (brief)

**Root cause:** `src/lib/email.ts`, the branch comment "Dev mode — no API key" (`sendEmail()`, ~line 173 pre-fix), was not guarded on `NODE_ENV`. Whenever `RESEND_API_KEY` was unset or blank — in *any* environment, including production — `sendEmail()`:
1. Logged to console instead of sending.
2. Wrote `email_queue.status = 'sent'`, `sentAt = now()`, `attempts = 1`.
3. Returned `{ success: true }`.

This converts a total outbound-mail outage in production into a silent success, with the queue row itself acting as false evidence that delivery happened.

**Production evidence (read-only, verified 2026-09-25):**
- Resend's dashboard: **1** send in its 30-day history.
- Production `email_queue`: **98 rows over 90 days, every one `status='sent'`, `attempts=1`, `last_error` empty.** Zero `failed`, zero retries, zero `blocked_non_production`.
- ~35 of those 98 fall inside Resend's 30-day window, against Resend's 1 actual send.
- This is specifically the **missing-key** signature, not an *invalid*-key signature: an invalid key throws inside `resend.emails.send()`, which retries `MAX_ATTEMPTS` times and lands `status='failed'` with a populated `last_error`. All-`sent`/no-error/`attempts=1` only happens on the code path that never calls Resend at all.
- Outage window: ~2026-08-28 (last confirmed real delivery) through 2026-09-25, undetected for ~4 weeks because the app reported success throughout. Affected message types include proposal board notifications, a proposal approval notice, and at least seven reimbursement requests.

**Reproduction:**
```
NODE_ENV=production, RESEND_API_KEY unset (or "") → sendEmail() to any recipient
```
Pre-fix: returns `{ success: true }`, queue row lands `status: 'sent'`, nothing sent to Resend.

## VERDICT

Bug confirmed. Fix preserves all intended behavior elsewhere (deny-by-default non-production guardrail, retry semantics, bulk-send semantics) — see call-site audit in Phase 4.

---

# Phase 2 — Architectural Review — SKIPPED, with reasoning

Skipped per the bug-fix variant ("skip if the fix doesn't touch invariants; document the skip"). This *does* touch the **Outbound Email Is Deny-By-Default Outside Production** invariant's honest-reporting property, so it earned scrutiny before skipping:

- The invariant's actual guarantee is about *whether mail reaches a real inbox outside production* (the allowlist gate). That gate is untouched — it still runs first, unconditionally, and still returns `blocked_non_production` for any non-allowlisted recipient regardless of API-key state. Verified by a dedicated regression test (below) plus the full existing `email-guardrail.test.ts` suite, unchanged and still green.
- What changes is a *different* branch entirely (the no-key branch, which only runs after the allowlist gate has already been cleared or in production where the gate doesn't apply). No existing invariant documents "a missing key marks the queue row sent" as intended behavior — that was simply undocumented, unintended, and the subject of this fix.
- No new table, no new permission, no new route. `src/lib/db/schema.ts`'s `emailQueue.status` column is untyped `text`, so a new status string (`dev_no_api_key`) is additive, not a migration.

Conclusion: no architectural review needed. Documented here per "no silent skips."

---

# Phase 3 — Technical Design (brief, inline)

## Fix

In `sendEmail()`, the missing-key branch is now environment-aware:

- **`NODE_ENV === 'production'` + missing key:** never reports success. Writes `status: 'failed'`, `lastError: 'RESEND_API_KEY is not configured — email was not sent'`, `attempts: 1`, and a `nextRetryAt` 15 minutes out (same `RETRY_MINUTES` constant used by the real-failure path), so it surfaces immediately at `/admin/email-queue` under **Failed Emails** and is eligible for the existing retry flow with no new UI. Returns `{ success: false, error, emailQueueId }`.
- **Non-production + missing key** (only reachable after the recipient already cleared the deny-by-default allowlist guard, or trivially in a hypothetical where `_bulkMemberSend` narrowed it — actually bulk sends are never allowlisted, so this branch is single-recipient-only in practice): still returns `{ success: true }` so local manual testing of a feature's happy path isn't broken by an absent dev Resend key, but the queue row is now `status: 'dev_no_api_key'` — **never** `'sent'` — so a developer reading `/admin/email-queue` or the DB directly isn't told delivery happened when it didn't.

**Same defect, second call path — found in audit, fixed in the same PR:** `src/app/api/admin/email-queue/retry/route.ts` had an identical unguarded "Dev mode — mark as sent" branch. Because this route re-sends a *persisted* `email_queue` row directly (bypassing `sendEmail()` per DECISION-092, so attachments forward correctly on retry), it needed its own matching guard rather than inheriting `sendEmail()`'s fix. Left unfixed, a production admin who set up the retry flow to recover from an earlier key-related outage could click "Retry Failed Emails" and have it silently re-mark the same messages "sent" a second time. Now: production + missing key → row's `attempts`/`lastError`/`nextRetryAt` updated, counted in the response's `failed` count, left in `status: 'failed'`. Non-production + missing key → `status: 'dev_no_api_key'`, counted in neither `succeeded` nor `failed` (kept out of both so the summary toast doesn't claim delivery either way).

## Return-value decision and full call-site audit (~18 `sendEmail()` call sites)

Changing `success: true` → `false` for the production-missing-key case only matters where a caller *branches* on the return value. Audited every call site:

| Call site | Behavior on `success: false` | Verdict |
|---|---|---|
| `src/lib/ledger-acknowledgment-letter-queries.ts` → `emailAcknowledgmentLetters()` (via `sendBulkMemberEmail`) | Reverts the atomic `sent_at`/`sent_via` claim when **every** address for a donor fails, reports `status: "failed"` to the caller, safe to retry. | **Correct new behavior.** Pre-fix, a production outage would have kept every claim as "sent" with zero actual letters delivered — undetectable, unrecoverable without a manual DB fix. Post-fix, the outage now correctly reverts the claim and shows up as retryable. No error path observed; reverts on total failure exactly as designed. |
| `src/app/api/admin/dues/reminders/route.ts` | Records `success` as data on a per-recipient `dues_reminders` row; response is `200` always ("success or failure is a successful API call", DECISION-075 §6 precedent). | **Unaffected.** Already treats `false` as ordinary data, not an error to propagate. |
| `src/app/api/admin/events/[id]/announce/route.ts` | Same shape — per-recipient `event_announcements` row (DECISION-093), `200` always. | **Unaffected**, same reasoning. |
| `src/app/api/admin/minutes/[id]/email/route.ts` | Passes `sendEmail()`'s `{success, error?}` straight through as the JSON body, `200` either way (DECISION-075 §6). | **Unaffected** — this route's entire contract is "report sendEmail()'s own result," so a more honest `false` is exactly correct. |
| `src/app/api/members/proposals/[id]/submit/route.ts`, `src/app/api/members/social-requests/[id]/submit/route.ts` | Fire-and-forget after DB commit, wrapped in `try/catch`, return value never inspected. | **Unaffected** — cannot break the submission either way. |
| `src/app/api/admin/ledger/reimbursements/[id]/route.ts` (approve/reject notifications) | Fire-and-forget, wrapped in `try/catch`, return value never inspected. | **Unaffected.** |
| `src/app/api/contact/route.ts`, `src/app/api/suggestions/route.ts`, `src/app/api/membership-applications/route.ts` (inside `after()`), `src/app/api/auth/forgot-password/route.ts` | Awaited but return value never inspected; forgot-password always returns `{success:true}` from the route regardless (deliberate anti-enumeration behavior, unrelated to `sendEmail()`'s own result). | **Unaffected.** |
| `src/lib/members.ts`, `src/lib/auth/index.ts` | Awaited, return value never inspected. | **Unaffected.** |
| `sendBulkMemberEmail()` itself | Passes each recipient's `{success, error, emailQueueId}` straight into its own `results` array — no behavior branch, just data collection. | **Unaffected**, and it correctly inherits the fix since every recipient still goes through `sendEmail()`. |

**Conclusion:** no call site produces a worse outcome from `success: false`. The one call site that actually *acts* on the boolean (the acknowledgment-letter claim revert) goes from a dangerous false-positive to the intended safety behavior.

## Non-production behavior chosen and why

Chose a **distinct status (`dev_no_api_key`)** over reusing `'sent'`. Reusing `'sent'` was the original bug's shape in miniature — a developer with an allowlisted address but no local Resend key would see "Sent" and believe mail worked. Reusing `'blocked_non_production'` was considered and rejected: that status specifically means "the deny-by-default guardrail intentionally withheld this," a *policy* decision; a missing key outside production is a *configuration* fact orthogonal to the guardrail, and conflating the two would make it harder to reason about which one is in play when both a real incident (DECISION-085/086) and this fix are ever read side by side later.

`/admin/email-queue` renders unknown statuses gracefully already: `StatusPill` (`src/app/(dashboard)/admin/email-queue/view-email-dialog.tsx`) falls back to `pending`'s badge color and shows the raw status string verbatim for anything not in its `STATUS_LABEL` map, rather than crashing or mislabeling. Confirmed by code inspection — no test needed for this, it's pre-existing defensive code, not new.

**Known gap, deliberately left as an open item (UI, not API):** the admin queue page's three sections (`Failed`, `Blocked (Non-Production)`, `Recently Sent`) are each populated by a query filtered to one exact status string. A `dev_no_api_key` row will not appear in any of the three sections — it's invisible on the dashboard (though never mislabeled, and directly queryable in the DB). This is a **local-development-only cosmetic gap**, not a production safety issue, and adding a fourth dashboard section is a UI change outside api-developer's Phase 4 scope per CLAUDE.md's implementer split table. Flagged for `ux-developer` below.

## Also checked (per task's "also check" list)

- **`sendBulkMemberEmail()`:** does not have its own copy of the bug — it calls `sendEmail()` once per recipient and passes each result through unmodified, so it inherits the fix automatically. No separate silent-success path.
- **Anywhere else in `src/lib/email.ts` reporting success for something that didn't happen?** Audited the whole file. The `blocked_non_production` branch (non-production deny-by-default) *also* returns `{success: true}` for a message that wasn't delivered — but that is intentional and documented (`"Blocked messages are still queued and still report success, so callers and their tests behave exactly as in production"`), it's a deliberate test-ergonomics decision tied to the deny-by-default invariant, not a defect, and out of scope for this bug fix. Flagging it here only for completeness, not proposing a change.
- **Would a missing `RESEND_FROM_EMAIL` produce a similar silent failure?** `RESEND_FROM_EMAIL` isn't read inside `email.ts` at all — every call site passes its own `from` explicitly (several via `getFromEmail()` in `src/lib/email-compose.ts`, which has its own fallback chain). `sendEmail()` has no fallback-or-fail branch for `from` the way it did for the API key; a missing/empty `from` would either be caught by `getFromEmail()`'s existing fallback or would reach `resend.emails.send()` and fail there with a normal thrown error, landing correctly in the existing `failed`-with-`lastError` path (the working path this whole bug fix restores parity with). Report only, no expansion of scope.

## Implementer

api-developer (this work log)

---

# Phase 4 — Implementation

## Files Modified

- `src/lib/email.ts` — the no-API-key branch of `sendEmail()` is now environment-aware: production reports `{success:false}` and lands a `failed` row with a real `lastError`; non-production lands a distinct `dev_no_api_key` status while still returning `{success:true}` for local testing ergonomics.
- `src/app/api/admin/email-queue/retry/route.ts` — the identical unguarded "mark as sent" dev-mode branch (bypasses `sendEmail()` per DECISION-092 to forward attachments correctly on retry) now carries the same production/non-production split.
- `src/lib/db/schema.ts` — updated the `emailQueue.status` inline comment to list the two statuses (`blocked_non_production`, `dev_no_api_key`) that already existed/now exist in code but weren't documented there. No column/type change — `status` was always untyped `text`.

## Files Created

- `src/lib/email-no-api-key.test.ts` — 4 new tests: production+missing-key (fails, non-empty error, asserted written pre-fix to confirm it fails against the old code — see below), production+present-key (unchanged), non-production+missing-key+allowlisted (dev_no_api_key, success:true), non-production+missing-key+non-allowlisted (blocked_non_production unchanged — DECISION-085 regression guard).

## Schema Changes

None. `emailQueue.status` is `text`, no migration required for a new status string.

## Test evidence — failed against pre-fix code, passes against fixed code

Confirmed by temporarily restoring `src/lib/email.ts` to its pre-fix `HEAD` content and running the new test file in isolation:

```
FAIL  src/lib/email-no-api-key.test.ts > PRODUCTION + missing key: never reports success...
  AssertionError: expected true to be false   (result.success)
FAIL  src/lib/email-no-api-key.test.ts > NON-PRODUCTION + missing key + allowlisted recipient...
  AssertionError: expected "vi.fn()" to be called with [ObjectContaining{status: "dev_no_api_key"}]
  Received: [{ status: "sent", attempts: 1, sentAt: ... }]
```
Then restored the fixed file; all 4 new tests pass, and the full existing `email-guardrail.test.ts` (deny-by-default suite) and `retry/route.test.ts` (attachment-forwarding suite) remain green — confirming no regression to DECISION-085's deny-by-default guarantee or DECISION-092's attachment-forwarding guarantee.

## Gate results

- `pnpm exec tsc --noEmit`: **PASS** (no output/errors)
- `pnpm test`: **PASS** — 119 test files, **2100 tests** passed (baseline was 2096; +4 from this fix)
- `pnpm build:only`: **PASS** — production build completed, all routes compiled
- `pnpm lint`: **PASS** (0 errors). One pre-existing, unrelated warning in `src/components/admin/ledger/budget-context-panel.tsx:114` ("Unused eslint-disable directive") — not touched by this change, not introduced by this change.

## Implementer Notes

- The in-progress financial-report work in the working tree (`src/lib/financial-report-send.ts`, `src/app/api/admin/ledger/reports/`, migrations `0103`/`0104`, the rest of the `src/lib/db/schema.ts` diff) was left untouched. Confirmed by inspecting `git diff src/lib/db/schema.ts` before and after my one-line comment edit — my change lands on a pre-existing, unrelated line with no overlap.
- Did not touch `EMAIL_DEV_ALLOWLIST` or add any address to it. Did not attempt a real send. Did not correct any of the 98 historically mis-recorded production `sent` rows.

## Open questions / handoff notes

- **For `ux-developer` (optional, low priority):** `/admin/email-queue` has no section that would ever show a `dev_no_api_key` row (its three sections each query one exact status). This only matters in local/dev environments with no Resend key configured — not a production concern — but if it's worth a quick section mirroring "Blocked (Non-Production)," that's a small, self-contained addition to `src/app/(dashboard)/admin/email-queue/page.tsx`.
- **For the user, explicitly out of scope per the task brief:** the 98 historically mis-recorded `sent` rows in production `email_queue` cannot be reliably split into "actually delivered" vs. "silently lost" — at least one of the ~35 rows in Resend's 30-day window did send. This is a data decision, not a code fix, and needs the user's judgment on whether/how to correct the historical record (e.g., a note to affected proposal submitters, board members who should have seen a proposal-approval or reimbursement notice, etc.).
- **Root operational fix, separate from this code fix:** the reason this outage happened at all is that production's `RESEND_API_KEY` became unset/blank around 2026-08-28. This work log does not investigate *why* the env var went missing (Vercel config, secret rotation, etc.) — that's a deployment/infra question, potentially for `deployment-engineer`, once the user wants it investigated. The code fix here only ensures the *next* time a key goes missing, it can't hide again.
- **Handoff:** `qa` for Phase 5 verification (dev-server smoke test + admin `/admin/email-queue` click-through to confirm the Failed Emails section renders a synthetic failed-due-to-missing-key row sensibly), then `analyst` for Phase 6 sign-off.

---

# Phase 5 — Verification — 2026-09-25

**Owner:** qa
**Status:** complete

### Summary

**VERDICT: PASS.** Independently reproduced the original defect (not just re-read the implementer's evidence): reverted `src/lib/email.ts` and the retry route to pre-fix `HEAD` with the new tests in place, watched the exact regression fail two different ways, then restored the fix and watched all tests go green. Found one real gap — the retry route's copy of the defect had **zero** dedicated test coverage (the existing `route.test.ts` always stubs a present API key) — and closed it myself with two new regression tests, which I also failed-then-passed against pre-fix code before trusting them. All four gates are clean. The deny-by-default guard, the acknowledgment-letter claim-revert, and the event-announcement per-recipient failure rows all behave exactly as the design doc claims, verified by reading the code myself. Hunted for a third instance of the pattern; found none — `sendBulkMemberEmail()` and `financial-report-send.ts` both route through `sendEmail()` with no independent write path, and only two places in the entire codebase construct a `Resend` client.

### What I did

- Read the full work-log (Phases 1–4) before touching anything.
- Read `src/lib/email.ts`, `src/app/api/admin/email-queue/retry/route.ts`, and both new/changed test files in full, plus the `emailQueue` schema diff and the unrelated `permissions.ts`/`schema.ts`/`decisions.md` diffs (confirmed the latter three are entirely the untouched financial-report work and don't overlap).
- **Independently reproduced the defect** (point 1): saved the two fix diffs to the scratchpad, `git checkout --` both `src/lib/email.ts` and the retry route back to pre-fix `HEAD` (kept all test files), ran the new tests, confirmed 2 of 4 failed with the exact regression shape (`expected true to be false`; queue row written with `status: "sent"` instead of `dev_no_api_key`). Restored the fix via `git apply` of the saved diffs and confirmed all tests passed.
- **Found and closed a coverage gap on the "second instance"** (task's explicit ask to treat it with the same rigor): `src/app/api/admin/email-queue/retry/route.test.ts` stubs `RESEND_API_KEY` to a fake value in its top-level `beforeEach` for every existing test, so the missing-key branch (the actual bug in this file) was never exercised by any test. Added two regression tests (`describe("... — missing RESEND_API_KEY (regression)")`) covering production+missing-key (must land back in `failed`, `attempts+1`, real `lastError`, counted in the response's `failed`, never `sent`) and non-production+missing-key (`dev_no_api_key`, counted in neither `succeeded` nor `failed`). Verified these two fail against the pre-fix route (both wrongly reported `succeeded: 1`) and pass against the fix, using the same revert/restore method as above. Had to add a missing `afterEach` import to make the new `vi.unstubAllEnvs()` cleanup compile.
- Verified the deny-by-default ordering claim (point 2) by reading `src/lib/email.ts` top-to-bottom: the non-production allowlist/bulk guard (lines 157–171) runs and `return`s **before** the no-key branch (lines 180–205) is ever reached — a non-allowlisted or bulk recipient can never fall through to the new dev path. Confirmed by the existing `email-guardrail.test.ts` (unchanged, still green, 12 tests) plus the new suite's own non-allowlisted case.
- Spot-checked the three call sites named in point 3 by reading the actual source, not trusting the audit table:
  - `ledger-acknowledgment-letter-queries.ts` (`emailAcknowledgmentLetters`): confirmed the atomic claim (`UPDATE ... WHERE sent_at IS NULL RETURNING id`) runs before any send, and that a total-failure branch (`!anySucceeded`) reverts `sentAt`/`sentVia` to `null` guarded by `sentVia = 'email'`. This is a genuine revert, not an error throw — correct.
  - `events/[id]/announce/route.ts`: confirmed `success: result?.success ?? false` is written per-recipient into `event_announcements` and returned in the JSON body under a 200, so a production key outage now correctly shows per-recipient failures instead of false "sent" rows.
  - `proposals/[id]/submit/route.ts` and `social-requests/[id]/submit/route.ts`: confirmed both wrap `sendEmail()` in an inner `try/catch` after the DB commit, with the return value never inspected — cannot roll back or behave worse under `success: false`.
- Checked point 4: `emailQueue.status` is untyped `text` (confirmed in `schema.ts`, comment-only diff, no migration). Read `StatusPill` in `view-email-dialog.tsx`: an unknown status like `dev_no_api_key` gets the "pending" gray styling but the label renders the **raw status string verbatim**, not a misleading fixed label — no crash. Confirmed by reading `admin/email-queue/page.tsx`'s three section queries (`eq(status, "failed")`, `eq(status, "blocked_non_production")`, `eq(status, "sent")`) — a `dev_no_api_key` row indeed appears in none of the three. This is reachable only in non-production (the production path always uses `status: "failed"`, which IS captured), so it's a real but cosmetic dev-only gap, not a production safety issue. No migration required, confirmed.
- Hunted for a third instance (point 5): `grep -rn "new Resend("` across `src/` returns exactly two hits — `src/lib/email.ts` and the retry route — both already fixed. `grep -rn "RESEND_API_KEY"` likewise returns only those two files (plus their tests). Traced every file touching the `emailQueue` table directly (`.update(emailQueue`/`.insert(emailQueue`) — only the same two files write to it; `dues/reminders`, `events/announce`, and the in-progress `financial-report-send.ts` all reference `emailQueueId` only as a foreign key returned by `sendEmail()`/`sendBulkMemberEmail()`, never writing `emailQueue.status` themselves. Read `sendBulkMemberEmail()` in full: it loops `sendEmail()` per recipient and passes each result through unmodified — no independent write path, correctly inherits the fix. **No third instance found.**
- Checked point 6: `nextRetryAt` is set 15 minutes out (`RETRY_MINUTES`, the same constant the real-failure path uses) on the production-missing-key branch, and the retry endpoint's eligibility query (`status = 'failed' AND nextRetryAt <= now()`) picks it back up once elapsed — genuinely retryable. Confirmed no retry storm risk: this project has no cron/scheduled worker (grepped for `cron`/`vercel.json` — none), so `/api/admin/email-queue/retry` only fires on an admin's manual button click (`retry-button.tsx`), not on a timer. No double-send risk from this fix specifically: while the key is missing, the row can never reach `status: "sent"` no matter how many times it's retried; once the key is restored, the real `resend.emails.send()` try/catch path takes over and behaves exactly as it did before this fix (unchanged).
- Ran all four required gates from scratch after restoring the fix and again after adding my own tests.

### Outputs

- `docs/work-log/2026-09-25-email-silent-success.md` — this Phase 5 section, plus the status-table update.
- `src/app/api/admin/email-queue/retry/route.test.ts` — added `import { afterEach }` and a new `describe("POST /api/admin/email-queue/retry — missing RESEND_API_KEY (regression)")` block with 2 tests (see Regression Tests Added below). No other file touched.
- No production code changed by qa. `src/lib/email.ts` and `src/app/api/admin/email-queue/retry/route.ts` were temporarily reverted to pre-fix `HEAD` for reproduction and restored byte-identical to the implementer's version (diffed against a saved copy to confirm).
- Did not touch the in-progress financial-report work (`src/lib/financial-report-send.ts`, `src/app/api/admin/ledger/reports/`, migrations `0103`/`0104`, `docs/decisions.md`, the rest of `src/lib/db/schema.ts`/`src/lib/permissions.ts`) beyond reading it to confirm it inherits the fix correctly (it calls `sendEmail()` and branches on `sendResult.success`, no independent Resend client or status write).
- Did not send any real email, did not add any address to `EMAIL_DEV_ALLOWLIST`, did not write to any database (all tests run against mocked `db`/`resend` modules).

#### Type Check
`pnpm exec tsc --noEmit`: **PASS** (no output)

#### Lint
`pnpm lint`: **PASS** — 0 errors. One pre-existing, unrelated warning (`src/components/admin/ledger/budget-context-panel.tsx:114`, unused eslint-disable directive) — confirmed not touched by this change.

#### Unit Tests
`pnpm test`: **PASS**
Total: 2102 | Passed: 2102 | Failed: 0
Files: 119 passed
Duration: ~2.2s
Baseline was 2096; +4 from the implementer's `email-no-api-key.test.ts`, +2 from qa's new retry-route regression tests = 2102, confirmed by direct count.

#### Production Build
`pnpm build:only`: **PASS** — ran twice (once before, once after adding the retry-route tests, since test files can still break `tsc` during the build's TypeScript pass). Both exited 0. All routes compiled; route table unchanged from the prior build (no route added/removed by this fix).

#### End-to-End Tests
Not run. This is infrastructure-only (no new route, no new UI, no new user-facing flow) and the task brief's Gates section names only `tsc`, `lint`, `pnpm test`, `pnpm build:only`. Playwright's existing suite does not target `/admin/email-queue` or the retry endpoint at all (confirmed by `grep -rl "email-queue" e2e/` — no hits), so running it would add ~12 minutes with zero coverage of the changed code.

#### Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| `/admin/email-queue` rendering a `dev_no_api_key` row | Not driven live | The task explicitly forbids a real send, an allowlist change, or any DB write. Verified the same fact statically instead: read `StatusPill`'s fallback logic and the three section queries directly (see "What I did" above) — a `dev_no_api_key` row cannot crash the page (falls back to the "pending" pill style, raw status text shown) and appears in none of the three sections (dev-only cosmetic gap, not a production concern). This is a stronger check than eyeballing a locally-rendered page once, since it covers every code path that touches the status string, not just whatever row a manual test happens to produce. |
| Production outage against the real Resend dashboard | N/A | Cannot be driven without a real production deploy; the original bug report's forensic evidence (Resend 1-send vs. `email_queue` ~35-`sent` mismatch) already stands as the production-side confirmation this fix responds to. |

### Regression Tests Added

- `PRODUCTION + missing key: never reports success, and lands a failed row with a non-empty error` — `src/lib/email-no-api-key.test.ts:77` — implementer's test — guards against: the exact silent-success bug in `sendEmail()`.
- `NON-PRODUCTION + missing key + allowlisted recipient: never marked 'sent', lands a distinct status, still reports success` — `src/lib/email-no-api-key.test.ts:112` — implementer's test — guards against: a dev-only false "sent" label.
- `NON-PRODUCTION + missing key + NON-allowlisted recipient: still blocked_non_production (deny-by-default must not regress, DECISION-085)` — `src/lib/email-no-api-key.test.ts:127` — implementer's test — guards against: the new dev-key branch ever becoming reachable ahead of the deny-by-default guard.
- `PRODUCTION + missing key: never marks the row sent — lands it back in failed with an incremented attempt and a real error` — `src/app/api/admin/email-queue/retry/route.test.ts:122` — **qa's test, added during this verification** — guards against: the identical silent-success bug in the admin retry route, which had shipped with zero test coverage for its own missing-key branch — regression for the retry-route half of the 2026-09-25 email-silent-success bug.
- `NON-PRODUCTION + missing key: lands a distinct dev_no_api_key status, counted in neither succeeded nor failed` — `src/app/api/admin/email-queue/retry/route.test.ts:143` — **qa's test, added during this verification** — regression for the same bug's dev-mode half in the retry route.

Both qa-added tests were confirmed failing against the pre-fix retry route (both wrongly returned `succeeded: 1` for a row that was never actually sent) before being confirmed passing against the fix — same failed-then-passing discipline as the implementer's four.

### Coverage on Critical Modules

Not applicable in the "critical modules" sense this section usually covers (`events.ts`/`permissions.ts`/`members.ts` are untouched by this fix). For the two files this fix actually changed: every branch of `sendEmail()`'s no-key logic and every branch of the retry route's no-key logic now has a dedicated test (production/non-production × the two files), which was not true before this verification pass for the retry route.

### Feature-Gate Audit (mandatory before PASS)

This bug fix touches no new route and no new server action — it changes internal branching inside an existing route and an existing library function. The route's own auth/feature gate was not modified and was not in scope, but confirmed unchanged and still correct by reading it:

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `POST /api/admin/email-queue/retry` | yes (`src/app/api/admin/email-queue/retry/route.ts:15-18`) | yes (`hasFeature(session.user.id, FEATURES.ADMIN_USERS)`, line 20-23) | Pre-existing, unchanged by this fix — flagging only that `FEATURES.ADMIN_USERS` gates a mail-retry action, which reads as slightly broad (retrying queued email isn't really an admin-user-management action) but this is pre-existing scope, not introduced or widened by this bug fix, and out of scope for a bug-fix-variant Phase 5 to relitigate. Noting for the record, not failing on it. |
| `sendEmail()` / `sendBulkMemberEmail()` (`src/lib/email.ts`) | N/A — library function, not a route/action; every call site enforces its own gate upstream (unchanged by this fix) | N/A | N/A |

No protected route or server action was added, removed, or had its gate changed by this fix.

### Open questions / handoff notes

- **For `analyst` (Phase 6):** shipped-vs-intent should confirm the fix matches the Phase 1 intent (production honesty restored, dev ergonomics preserved, deny-by-default untouched) — all confirmed true above.
- **For `ux-developer` (carried forward from Phase 4, still open, still low priority):** `/admin/email-queue` has no section that will ever show a `dev_no_api_key` row. Confirmed by qa as cosmetic/dev-only, not a production concern; still a reasonable small follow-up if a developer wants queue visibility while working without a local Resend key.
- **For the user (carried forward from Phase 4, unchanged, still needs a human decision):** the 98 historically mis-recorded `sent` rows in production `email_queue` cannot be reliably split into "actually delivered" vs. "silently lost." This is a data/communications decision (e.g., whether to notify affected proposal submitters or board members), not a code fix, and qa did not touch it.
- **For the user or `deployment-engineer` (carried forward, unchanged):** why production's `RESEND_API_KEY` went missing around 2026-08-28 is still uninvestigated — this fix only ensures the next occurrence can't hide silently.
- **Minor note, not a blocker:** `POST /api/admin/email-queue/retry` gates on `FEATURES.ADMIN_USERS` rather than a more narrowly-named email/queue permission. Pre-existing, unchanged by this fix, flagged for a future permissions review rather than reopened here.
- **Update on the parallel third-instance hunt:** a background search agent was also launched during this verification to hunt for a third instance from an independent angle. It has since returned and confirms the same conclusion as the grep sweep above — no third instance exists anywhere in the codebase. It additionally traced every file that writes to the `emailQueue` table directly and confirmed only the same two already-fixed files (`src/lib/email.ts`, the retry route) ever write `emailQueue.status`; `dues/reminders`, `events/announce`, and the in-progress `financial-report-send.ts` all reference `emailQueueId` only as a foreign key returned by `sendEmail()`/`sendBulkMemberEmail()`, never writing `status` themselves. This closes out the item — nothing further to relay to the next agent.
- **Handoff:** `analyst` for Phase 6 shipped-vs-intent sign-off.

---

# Phase 6 — Shipped vs Intent — 2026-09-25

**Owner:** analyst
**Status:** complete

### Summary

The real intent behind "fix the email bug" was never "make email work again" — that requires restoring `RESEND_API_KEY` in Vercel Production, which no code change can do. The intent was: **the next time this exact configuration drift happens, does anyone find out inside a day instead of inside a month?** I read `src/lib/email.ts` and the retry route myself rather than taking Phase 4/5's word for it, confirmed the guard ordering and the two new statuses behave exactly as designed, and traced what an admin actually sees today. The code answers "does the system stop lying" with an unambiguous yes. It does not fully answer "does anyone notice" — that still depends on an admin choosing to open `/admin/email-queue`, a page with no badge, no count, and no link from anywhere that would put it in front of someone during a routine session. That gap, the 98 unresolved historical rows, and one small dev-only UI blind spot are real but don't rise to blocking this fix. **VERDICT: SHIP WITH NOTES.**

### What I did

- Re-read the full work-log (Phases 1–5) end to end.
- Independently read `src/lib/email.ts` in full (not just the diff) and confirmed for myself: the non-production allowlist/bulk guard returns before the no-key branch is reached (so DECISION-085 cannot be bypassed by the new branch); the production no-key path writes `status: "failed"`, a plain-English `lastError`, and a 15-minute `nextRetryAt`; the non-production no-key path writes `status: "dev_no_api_key"` and returns `success: true`.
- Independently read `src/app/api/admin/email-queue/retry/route.ts` in full and confirmed the second copy of the defect is fixed with the same production/non-production split, and that it only touches `status: "failed"` rows (`eq(emailQueue.status, "failed")` in its eligibility query) — meaning the 98 historical `status: "sent"` rows are structurally unreachable by the retry button, accidental or deliberate.
- Read `src/app/(dashboard)/admin/email-queue/page.tsx` in full: confirmed the three sections (`failed`, `blocked_non_production`, `sent`) are separate queries with no aggregate count exposed outside the page itself, and confirmed the Failed Emails table renders `lastError` as plain text in a table cell — not a stack trace, not a raw exception object.
- Read `src/app/(dashboard)/admin/email-queue/view-email-dialog.tsx` and confirmed `StatusPill`'s fallback: an unrecognized status string (e.g. `dev_no_api_key`) renders with the "pending" pill color and the raw status text verbatim — no crash, no mislabeling as "Sent".
- Grepped for any surface that would proactively flag a failed-email count to an admin outside the page itself: `src/lib/permissions.ts` (the nav entry, plain link, no badge), the main `/admin` dashboard, and admin layout/components. Found none. This is the basis for my answer to question 1 below.
- Confirmed the retry route's eligibility query and the admin page's `failed` section both key on the literal string `"failed"`, so the fix's new `failed` rows (missing-key case) surface identically to the pre-existing failed-for-other-reasons rows — no new UI path was needed for the production case, and I verified that claim rather than accepting it.

### Answers to the five questions

**1. Is the outage now actually visible?**

Concretely: with the key missing in production, `sendEmail()` writes a row into `email_queue` with `status: "failed"`, `lastError: "RESEND_API_KEY is not configured — email was not sent"`, and `nextRetryAt` 15 minutes out. That row appears in the **Failed Emails** table at `/admin/email-queue` under a red-tinted "Failed Emails" heading with a count badge, with the error message rendered directly in a cell. If an admin clicks Retry, the retry route will keep re-failing the same rows with the same honest error (it also cannot silently mark them "sent" anymore) — so the failure is durable and correctly reported, not a one-time blip that self-heals into a lie.

But nothing pushes that fact to anyone. I checked and confirmed: no badge on the "Email Queue" admin-nav entry, no count on the `/admin` landing page, no cron/health-check, no email-to-self alert (understandably — the alert channel is the thing that's broken). An admin only learns about this by choosing to open `/admin/email-queue`, which is precisely the page nobody opened for four weeks in the incident that prompted this fix. **My position: passive visibility on that one page is necessary but not sufficient for a failure mode with this history and this blast radius (board notifications, reimbursement requests, donor acknowledgments).** The smallest sufficient addition, given this project has no cron/scheduled-worker infrastructure (confirmed absent in Phase 5): a failed-count badge on the "Email Queue" entry in the admin nav, sourced from the same `eq(status, "failed")` query the page already runs, so every admin session that touches the sidebar surfaces the number without anyone deciding to go looking. This is a follow-up, not a blocker — the underlying data is now honest, which is the precondition a visibility feature needs to be built on top of.

**2. Is `{success: true}` for the dev no-key path the right call?**

I can build a real case either way, and I land on agreeing with the choice as shipped, for a narrower reason than "convenience."

*Case for `false` (parity with production):* the entire incident happened because "success" was reported for work that didn't happen. Applying the same rule in dev is the more principled, harder-to-misuse-later stance, and it would exercise failure-branch code paths (like the acknowledgment-letter claim-revert) in local testing, which is generically good for catching bugs before production.

*Case for `true` (as shipped):* this isn't a mirror of the production incident, because the two things differ in exactly the property that made the production case dangerous — **surprise**. Production's missing key was a silent, undetected drift nobody chose. A local developer's missing `RESEND_API_KEY` is a fact they already know about their own machine; they didn't lose a key, they never had one in `.env.local`. It's also not a new precedent — the pre-existing `blocked_non_production` branch already returns `success: true` for mail that provably wasn't delivered, specifically so "callers and their tests behave exactly as in production" (the file's own comment). `dev_no_api_key` is that same, already-accepted design pattern extended to a second dev-only non-delivery reason, not a new exception. Critically, the part of the original bug that actually caused harm — the **persisted record** lying — is fixed either way; `dev_no_api_key` is never `'sent'`. The return value is a live, ephemeral signal to the calling code in the same request; the queue row is the durable record a human or a future audit would ever actually consult. Fixing the durable one and leaving the ephemeral one alone for developer ergonomics is a defensible split, not the same mistake repeated.

I'd flag one place this reasoning could break: if a developer ever puts their own address in `EMAIL_DEV_ALLOWLIST` *and* runs without a Resend key, a feature that branches on `success` (like the acknowledgment-letter atomic claim) will believe the letter went out in a local test. That's the same shape of risk as the production incident, just contained entirely to a local database no one else reads. I don't think it's worth changing the return value over, but it's the honest edge of the argument.

**3. The 98 mis-recorded production rows.**

Leaving them uncorrected in the code fix was the right call — a fix that guessed which of the 98 were real would just be a second, quieter version of the same bug (asserting a delivery fact you don't actually know). But "acceptable to leave uncorrected" and "nothing to do" are different, and the task is right to flag that some of these are real obligations, not abstractions.

Two concrete, useful facts for the user:

- **The retry button cannot touch these rows, so there's no accidental double-send risk from the tooling.** I verified this myself: both the admin page's "Failed Emails" section and the retry route's eligibility query key on `status = "failed"`, and all 98 rows are `status = "sent"`. They are invisible to and untouched by every code path this fix changed. Nothing in the app will resurrect them on its own — any correction is a deliberate human action, which is appropriate given the ambiguity.
- **The ~35 rows inside Resend's 30-day window are more resolvable than "can't reliably tell which" suggests.** Resend confirms exactly 1 real send in that window; if its dashboard/logs show that send's specific recipient and timestamp, cross-referencing it against those ~35 `email_queue` rows would identify the one that's real and clear the other ~34 as confirmed-lost, not just probably-lost. The remaining ~63 rows (days 31–90) are likely outside Resend's own retention and may need a support request to Resend for older logs, if that's worth pursuing.
- **For the specific named obligations** (a proposal board notification, a proposal approval notice, seven reimbursement requests) — these are few enough, and consequential enough, that I'd recommend skipping log archaeology entirely and just asking the affected people directly ("did you get an email about X around late August?") rather than trying to reconstruct delivery forensically. That's more reliable than any queue-based signal ever will be, and it's the actual thing that matters: did the person who needed to know, know.

This is a data/communications decision for the user, correctly kept out of the code fix.

**4. Did anything regress?**

No, and I verified this from the source rather than trusting the audit table. In `src/lib/email.ts`, the non-production deny-by-default block (allowlist check, `_bulkMemberSend` unconditional block) executes its own `return` before the no-key branch is ever reached — the two `if` blocks are sequential and mutually exclusive by construction, not by convention. A non-allowlisted or bulk recipient hits `blocked_non_production` and returns; it can never fall through into the new `dev_no_api_key` or `failed` logic. I'm satisfied DECISION-085's guarantee is intact.

**5. Is the `dev_no_api_key` admin-UI gap really cosmetic?**

Cosmetic in stakes, but I'd push back gently on "just" cosmetic in kind — it's a smaller instance of the identical shape of problem this whole fix exists to close: a state that exists and is honestly recorded, but renders as if nothing happened at all. A developer without a local Resend key who opens `/admin/email-queue` to check "did my test email do anything" sees zero rows in all three sections and reasonably concludes the queue is empty, when in fact a row exists with the right, honest status — it's just not queried by any section. Low stakes because it's dev-only and no real recipient or dollar amount is involved, but the fix for the fourth question's problem ("does anyone notice") and this one are the same shape of fix: surface the status you're already writing. I'd bundle both into one small `ux-developer` follow-up rather than treating them as unrelated.

### Edge cases

| Case | Verdict | Notes |
|---|---|---|
| Failure microcopy | pass | `lastError` renders as a plain sentence ("RESEND_API_KEY is not configured — email was not sent") in the Failed Emails table, not an exception dump. |
| Empty state | not applicable | No new empty state introduced; the existing "No failed emails" copy on the admin page is unchanged and untouched by this fix. |
| Permission gate | pass | `/api/admin/email-queue/retry` still gates on `auth()` + `hasFeature(FEATURES.ADMIN_USERS)`, unchanged by this fix — confirmed by reading the route. (Whether `ADMIN_USERS` is the right key for a mail-retry action is a pre-existing, separately-flagged question, not something this fix touched or should be relitigated against.) |
| Deny-by-default invariant (DECISION-085) | pass | Verified myself by reading guard ordering in `src/lib/email.ts`; the allowlist/bulk block always returns before the no-key branch runs. |
| Mobile / brand consistency | not applicable | No UI was added or changed by this fix; the admin email-queue page's existing styling (`rounded-lg` table container, `rounded-2xl` empty state) is untouched. |

### Intent-vs-shipped diff

- Phase 1 said: a missing production API key must never be reported as a successful send. Shipped: `failed` status, real error, retry-eligible, `success: false`. **Matches.**
- Phase 1 said (via Phase 3/4 design, adopted as intent): dev ergonomics should be preserved without resurrecting the lie. Shipped: new `dev_no_api_key` status, never `'sent'`, `success: true` only for local convenience. **Matches**, with the dev-allowlist edge case noted above as a residual, non-blocking risk.
- Phase 4 found and fixed a second instance (the retry route) that Phase 1 didn't know existed at the time it was scoped. **Acceptable, disclosed drift** — this is exactly the kind of finding a bug-fix variant should surface mid-flight, and it was fixed with matching rigor (its own regression tests, found missing by qa and closed in the same pass).
- Phase 1's implicit goal — "would a recurrence be caught faster" — is **partially met**. The data is now honest; the surfacing of that data to a human is still passive. This is the basis for the one substantive follow-up below.

### Follow-ups (tracked; ship does not block on these)

1. **Add a failed-email count signal to the admin nav or `/admin` landing page**, sourced from the existing `eq(emailQueue.status, "failed")` query already run by `/admin/email-queue`. Purpose: convert "an admin who thinks to check will see it" into "an admin sees it during a routine session without deciding to look." Owner: ux-developer (small, UI-only). Not a blocker — the fix's honesty is the precondition this depends on, and that precondition now holds.
2. **Extend `dev_no_api_key` visibility on `/admin/email-queue`**, either as a small fourth section or folded into a relabeled "Blocked / Not Sent (Non-Production)" section querying both `blocked_non_production` and `dev_no_api_key`. Dev-only, low priority, carried forward from Phase 4/5. Owner: ux-developer.
3. **Resolve the 98 historically mis-recorded `sent` rows** — a human/data decision, not code. Recommend: (a) cross-reference Resend's confirmed single 30-day send against the ~35 in-window `email_queue` rows to clear the rest as confirmed-lost; (b) for the named real obligations (proposal notification, proposal approval, seven reimbursement requests), contact the affected people directly rather than relying on delivery forensics. Owner: user/treasurer/board, whoever owns those relationships.
4. **Investigate why `RESEND_API_KEY` went missing in Vercel Production around 2026-08-28.** This code fix makes a recurrence visible; it does not prevent one. Owner: user or deployment-engineer.

### Open questions / handoff notes

- None blocking. This closes the pipeline for the code-correctness portion of the bug. Follow-ups 1–4 above are tracked here for whoever picks them up next; none require reopening Phase 3/4 for this fix itself.

## VERDICT: SHIP WITH NOTES

## Phase 6 Follow-Up — Implemented — 2026-09-25

**Owner:** ux-developer
**Status:** complete

### Summary

Implemented both Phase 6 follow-ups: a failed-email-count badge on the admin nav's Email Queue entry (follow-up #1), and visibility for `dev_no_api_key` rows on `/admin/email-queue` (follow-up #2). Neither touches the financial-report work in progress elsewhere in the tree, `src/lib/email.ts`, the retry route, or adds a new `FEATURES` key. `getAdminProtectionRules()`'s output — the DECISION-082 invariant this task called out by name — is unchanged, verified by re-running the exact test suite that pins its shape.

### What I did

- Added `ix_email_queue_status` (idempotent `CREATE INDEX IF NOT EXISTS`) via schema.ts + a new migration, since `email_queue.status` was unindexed and the new badge adds a `COUNT(*) WHERE status = 'failed'` query that now runs on **every** admin page render (not just the email-queue page itself).
- Added `src/lib/email-queue-stats.ts` — `getFailedEmailCount()`, one indexed `COUNT(*)`.
- Wired the count into `src/app/(dashboard)/admin/layout.tsx`: computed once per request, gated on the exact permission `/admin/email-queue`'s `page.tsx` already requires (`FEATURES.ADMIN_USERS`, or `isAdmin`) — not fetched at all for a user who couldn't open the page, so nothing leaks even in the RSC payload.
- Passed the count into `AdminSidebar` (`src/components/admin/admin-sidebar.tsx`) as a new optional `failedEmailCount` prop and rendered a pill on the Email Queue item only, with a second, redundant permission check inside the component itself (defense in depth against a future caller passing the prop without gating).
- Did **not** touch `ADMIN_NAVIGATION`, `AdminNavItem`, or any `requiredFeature` — the badge is purely a runtime prop threaded through the existing render tree; `permissions.ts`'s nav data is byte-for-byte unchanged.
- Extended `StatusPill` (`view-email-dialog.tsx`) with a `dev_no_api_key` label ("Not sent — no API key (dev)") and its own color, distinct from `blocked_non_production`, instead of falling through the existing "unknown status → styled as pending" fallback.
- Folded `dev_no_api_key` into the page's existing non-production section (chose this over a fourth section, per the follow-up's own suggested option): the section's query now uses `inArray(status, ["blocked_non_production", "dev_no_api_key"])`, the heading is relabeled "Not Sent (Non-Production)", the copy explains both reasons, and a new "Reason" column renders `StatusPill` per row so the two are visually distinguishable.
- Ran the full gate suite (see below) plus the pre-existing `permissions.test.ts` / `admin-page-feature-gates.test.ts` suites specifically, to confirm nothing about admin-area protection moved.

### Badge design

- **Placement:** inline pill on the "Email Queue" sidebar row, right-aligned via `ml-auto` (the label span became `flex-1` to make room).
- **Look:** `bg-amber-100 text-amber-800` (or `bg-white text-amber-700` when the row is the active/blue one) — reusing the exact amber tone the page's own "Failed Emails" heading badge already uses, so the color vocabulary for "failed" is consistent between the nav and the page it points to. Not `lions-red` (undefined/transparent) and not a new color.
- **Shape:** `rounded-full`, `min-w-[1.25rem] h-5 px-1.5` — a count chip, not a button, so `rounded-full` is correct per CLAUDE.md's chip exception. Matches the existing count-pill convention already used elsewhere in admin (`src/app/(dashboard)/admin/page.tsx`, ledger entity-detail panels).
- **Zero is silent:** the badge only renders when `failedEmailCount > 0`; no permanent chrome.
- **Cap:** displays `99+` above 99 (`formatBadgeCount`), so an extreme count can't distort the sidebar's fixed-width row.
- **Accessibility:** `aria-label="{n} failed email(s)"` on the pill itself (singular/plural), independent of the visible digit-only text — a screen reader hears "3 failed emails", not "3".
- **Mobile:** no new breakpoints needed — the sidebar's existing 64px-wide (`w-64`) fixed layout and flex row already reflow correctly at 360px; the pill is small and right-aligned within the existing `flex items-center` row, verified by reading the rendered markup (no dedicated screenshot tool available in this environment, called out below for a reviewer to eyeball).

### Query cost

- **Query:** `SELECT COUNT(*)::int FROM email_queue WHERE status = 'failed'` (via `db.select({ count: sql<number>\`count(*)::int\` }).from(emailQueue).where(eq(emailQueue.status, "failed"))`).
- **Index:** `email_queue.status` was **not indexed** before this change — confirmed by reading `schema.ts` (no `.index()`/`uniqueIndex()` referencing it) before touching anything. Added `ix_email_queue_status` (migration `0105_email_queue_status_index.sql`, idempotent `CREATE INDEX IF NOT EXISTS`) specifically because this query now runs on every admin page load, not just on `/admin/email-queue` — the existing three status-filtered queries on that page benefit too, but they were already only paid for by someone choosing to open that specific page.
- **Frequency:** once per admin-area request (in the shared layout), not once per nav item and not per client-side re-render — `AdminLayout` is a Server Component, `AdminSidebar` receives the number as a plain prop.
- **React.cache():** considered and deliberately **not used**. This codebase has zero existing usage of `cache()` from `"react"` (confirmed by grep), and calling a `cache()`-wrapped function outside of an actual Next.js RSC render is untested territory for this repo's Vitest/node test setup — I don't want to introduce an unproven caching primitive to save one already-cheap indexed `COUNT(*)` that runs once per request. Documented this reasoning inline in `email-queue-stats.ts` so a future reader doesn't wonder why it's missing.

### Gating

- The count is fetched in `AdminLayout` only when `isAdmin || userFeatures.includes(FEATURES.ADMIN_USERS)` — the exact same check `/admin/email-queue`'s `page.tsx` performs (`hasFeature(session.user.id, FEATURES.ADMIN_USERS)`), read directly from `session.user.features` (the same source `AdminSidebar` already uses for every other item's visibility) rather than re-deriving anything new.
- `AdminSidebar` independently re-checks the same condition before rendering the pill, so a future refactor that accidentally passes a nonzero count to an unauthorized session still renders nothing.
- Did **not** add a `requiredFeature` to the Email Queue `ADMIN_NAVIGATION` entry. That's deliberate and load-bearing: `permissions.test.ts` has an existing test — `"produces no rule for System items with no requiredFeature of their own (Email Queue, Release Notes)"` — pinning that this entry has none, because `getAdminProtectionRules()` derives proxy admission from it. Adding one would have widened (or at minimum changed the shape of) `/admin/*` proxy admission for that segment, which the task explicitly forbade ("Do not change any entry's permission, href, or segment").

### How I verified `getAdminProtectionRules()` is unchanged

- Ran `pnpm exec vitest run src/lib/permissions.test.ts src/lib/admin-page-feature-gates.test.ts` before and after my changes: **195 tests, all passing, identical count, both times.** In particular the test named above (which asserts `email-queue` and `release-notes` produce no proxy rule) still passes unmodified — I never touched `ADMIN_NAVIGATION`, so there was nothing for it to catch, but I ran it to confirm rather than assume.
- Read `src/proxy.ts` and `getAdminProtectionRules()` in `src/lib/permissions.ts` before making any change, to confirm the function reads only `href`/`requiredFeature` off `ADMIN_NAVIGATION` — my edits never touch either field on any nav item.

### Task 2 — `dev_no_api_key` visibility

- Chose to fold `dev_no_api_key` into the existing "Blocked (Non-Production)" section (relabeled "Not Sent (Non-Production)") rather than adding a fourth section, per the follow-up note's own suggested option — fewer sections for an admin to scan, and the two reasons genuinely share the same user-facing meaning ("nothing was sent to a real recipient, and that's expected outside production").
- Added a "Reason" column to that table rendering `StatusPill` per row, so `blocked_non_production` and `dev_no_api_key` rows are visually distinguishable even though they're now queried and rendered together.
- `StatusPill`'s label is explicitly "Not sent — no API key (dev)" — not "Blocked" — so it's never confused with the deliberate deny-by-default guard, and not "Pending"/"Sent", so it can't be misread as evidence of either state.
- Verified the pre-existing unknown-status fallback (styled as "pending") still works for a genuinely unrecognized future status — added a test for it.

### Tests added

- `src/components/admin/admin-sidebar.test.tsx` (7 tests): badge renders with correct count + accessible singular/plural label; renders nothing at zero; renders nothing when `failedEmailCount` prop is omitted; caps at "99+"; hidden from a user lacking `ADMIN_USERS`; still shown for `isAdmin` without the feature explicitly listed.
- `src/lib/email-queue-stats.test.ts` (3 tests): returns the queried count; returns 0 when no row comes back; filters on `status = 'failed'` (inspected via the drizzle SQL fragment's query chunks, since the fragment itself has a circular reference that breaks naive `JSON.stringify`).
- `src/app/(dashboard)/admin/email-queue/status-pill.test.tsx` (4 tests): `dev_no_api_key` gets its own label and never renders as "Sent" or silently as "Pending"; `dev_no_api_key` and `blocked_non_production` render with different colors; a genuinely unknown status still falls back to the pending style; existing `sent`/`failed` labels are unchanged.
- **Total: 2116 tests (baseline 2102, +14).**

### Gates run

- `pnpm exec tsc --noEmit` — clean, no errors.
- `pnpm lint` — 0 errors (1 pre-existing warning in `src/components/admin/ledger/budget-context-panel.tsx`, unrelated to this change, not touched).
- `pnpm test` — 2116/2116 passing.
- `pnpm build:only` — production build succeeded; all routes compiled, no new errors.

### Outputs

- `src/lib/db/schema.ts` — added `ix_email_queue_status` index to `emailQueue`.
- `drizzle/migrations/0105_email_queue_status_index.sql` — new, idempotent.
- `src/lib/email-queue-stats.ts` — new, `getFailedEmailCount()`.
- `src/lib/email-queue-stats.test.ts` — new.
- `src/app/(dashboard)/admin/layout.tsx` — computes and gates the count, passes it to `AdminSidebar`.
- `src/components/admin/admin-sidebar.tsx` — new `failedEmailCount` prop, badge rendering, `formatBadgeCount()` cap helper, defense-in-depth gate.
- `src/components/admin/admin-sidebar.test.tsx` — new.
- `src/app/(dashboard)/admin/email-queue/view-email-dialog.tsx` — `StatusPill` gains `dev_no_api_key` label/color.
- `src/app/(dashboard)/admin/email-queue/status-pill.test.tsx` — new.
- `src/app/(dashboard)/admin/email-queue/page.tsx` — non-production query now covers both `blocked_non_production` and `dev_no_api_key`; section relabeled "Not Sent (Non-Production)"; new "Reason" column.

### Open questions / handoff notes for qa

- **Click-through:** open `/admin/email-queue` as a user holding `ADMIN_USERS` (or an admin) with at least one `failed` row in the DB — confirm the amber pill appears on the sidebar's "Email Queue" entry with the right count, and disappears once no `failed` rows remain. Then check as a user who lacks `ADMIN_USERS` (but can reach some other admin area) — confirm no pill, ever, regardless of DB state.
- **Mobile:** verify the pill at 360px width in the mobile slide-out sidebar (`isMobileMenuOpen` state) — I verified via markup reading, not a live screenshot; a real click-through is worth 30 seconds to be sure the pill doesn't wrap awkwardly next to a long-enough label (it shouldn't — "Email Queue" plus a 2–3 char pill fits comfortably in `w-64`).
- **`dev_no_api_key` section:** with `RESEND_API_KEY` unset locally, trigger any `sendEmail()` call, then confirm the row appears under "Not Sent (Non-Production)" with a purple "Not sent — no API key (dev)" pill in the Reason column, distinguishable from a genuine `blocked_non_production` row in the same table.
- **New copy for the club to review, if anyone cares:** the relabeled section heading "Not Sent (Non-Production)" and its subtext; the `dev_no_api_key` pill text "Not sent — no API key (dev)". Both are dev/admin-facing only, never seen by a member or the public.
- **Follow-ups #3 and #4** from the original Phase 6 (the 98 historically mis-recorded rows, and investigating the missing production key) are unrelated to this UI work and remain open — not touched here, as instructed.
- Next: **qa** for Phase 5 verification of this follow-up (typecheck/build/test already green above; a manual click-through per the notes above is the remaining piece).

---

## Phase 5 — Verification of Phase 6 Follow-Up — 2026-09-25

**Owner:** qa
**Status:** complete

### Summary

**VERDICT: PASS.** Verified all six scrutiny points from the task brief independently rather than trusting the implementer's notes. The security-critical claim holds: `git diff` against HEAD for `src/lib/permissions.ts` and `src/proxy.ts` is **empty** — `ADMIN_NAVIGATION` and `getAdminProtectionRules()` are byte-for-byte unchanged, and `permissions.test.ts` + `admin-page-feature-gates.test.ts` (199 tests) pass. The permission gate is correct and does not leak: `getFailedEmailCount()` is called only inside a ternary gated on the exact permission `/admin/email-queue` itself requires, so the query provably never executes for an unauthorized session (confirmed by reading the code, not inferring it), and `AdminSidebar` re-checks the same condition before rendering. The migration was verified **by execution, not just review**: ran `drizzle/run-migrations.mjs` against the dev DB twice — the index didn't exist beforehand (checked via `psql \di`), the first run created it, the second emitted a clean `NOTICE: relation "ix_email_queue_status" already exists, skipping` and exited 0. Ran a live click-through against a real `pnpm dev` server with a real signed-in admin session (Playwright, not just static reading): the badge correctly renders nothing with the dev DB's real zero `failed` rows, and the relabeled "Not Sent (Non-Production)" section correctly renders 397 real `blocked_non_production` rows with the new Reason column. Confirmed zero rows were written to `email_queue` by any of this verification (row counts identical before/after, zero rows in the last 10 minutes). Separately rendered `AdminSidebar` with `failedEmailCount={36}` (the exact number named in the brief) through the real component code at the real fixed 256px sidebar width and screenshotted it — "Email Queue" plus the "36" pill fit on one line with no wrap or overflow, in both the active and inactive row color variants. All four required gates are clean.

### What I did

- Read the full work-log (Phases 1–6, plus the "Phase 6 Follow-Up — Implemented" section) before touching anything.
- **Point 1 (security-critical):** ran `git diff --stat` and `git diff -- src/lib/permissions.ts src/proxy.ts` against the working tree's `HEAD`. The stat shows exactly 8 files changed, none of them `permissions.ts` or `proxy.ts`; the targeted diff is empty. This is a stronger check than reading the file once, since it rules out even a whitespace-only or comment-only change. Then ran `pnpm exec vitest run src/lib/permissions.test.ts src/lib/admin-page-feature-gates.test.ts src/app/api/admin/email-queue/retry/route.test.ts` directly (not just the full suite) — **199 tests passed**, including the specific test that pins the Email Queue nav item as having no `requiredFeature` of its own (`"produces no rule for System items with no requiredFeature of their own (Email Queue, Release Notes)"`).
- **Point 2 (permission leak):** read `src/app/(dashboard)/admin/layout.tsx` in full. The count is computed by `const failedEmailCount = canSeeEmailQueue ? await getFailedEmailCount() : 0;` — a ternary, meaning the DB query is never even called (not called-and-discarded) when `canSeeEmailQueue` is false. Confirmed `canSeeEmailQueue = isAdmin || userFeatures.includes(FEATURES.ADMIN_USERS)` matches the permission `/admin/email-queue`'s own `page.tsx` enforces (`hasFeature(session.user.id, FEATURES.ADMIN_USERS)`, which grants `ADMIN_USERS` to every Admin-role user via `getUserFeatures()`'s "Admin gets ALL features" rule — the same population `isAdmin` checks for). Noted one genuine but pre-existing nuance: the layout's check reads `session.user.features`, a JWT-cached snapshot refreshed only at sign-in or on an explicit `trigger === "update"` (confirmed in `src/lib/auth/index.ts:215`), whereas the page's own `hasFeature()` re-queries the DB with a 60-second cache. This means a just-revoked user could see a stale badge for the life of their session token. I checked whether this is a **new** gap this feature introduces: it is not — `AdminSidebar` already filters every other nav item's visibility off the same `session.user.features`/`isAdmin` values (confirmed by reading the pre-existing `visibleGroups` filter in `admin-sidebar.tsx`, untouched by this diff), so the badge is exactly as fresh/stale as the rest of the sidebar always has been, not a regression. Also confirmed `AdminSidebar`'s own `showFailedBadge` re-check uses the identical `isAdmin || userFeatures.includes(FEATURES.ADMIN_USERS)` expression — no drift between the two gates.
- **Point 3 (index, verified by execution):** `export $(grep DATABASE_URL .env.local) && psql "$DATABASE_URL" -c "\di ix_email_queue_status"` — confirmed the index did **not** exist beforehand. Ran `node drizzle/run-migrations.mjs` once — log shows `→ 0105_email_queue_status_index.sql` with no error, and a follow-up `\di` confirmed the index now exists (`public | ix_email_queue_status | index | ... | email_queue`). Ran the migration runner a **second** time — output shows the same `→ 0105_email_queue_status_index.sql` line followed by a Postgres `NOTICE` (`code: '42P07', message: 'relation "ix_email_queue_status" already exists, skipping'`) and the script still printed `✅ Migrations completed successfully` with exit code 0. This is execution-based proof of idempotency, not a read of the SQL text. Confirmed the index is declared in `schema.ts` inside the `emailQueue` table's own config (`index("ix_email_queue_status").on(t.status)`), so `drizzle-kit push` will keep it rather than drop it as an orphan.
- **Point 4 (per-render cost):** `grep -rn "getFailedEmailCount" src/` (excluding tests) returns exactly one call site — `src/app/(dashboard)/admin/layout.tsx:47`. Confirmed the query itself is a single `db.select({count: sql\`count(*)::int\`}).from(emailQueue).where(eq(status,"failed"))` — one indexed count, no N+1, no per-nav-item query. Assessed the `React.cache()` omission: since there is exactly one call site in the entire codebase, `cache()`'s de-duplication-across-calls-in-one-request benefit doesn't apply here — there's nothing to de-duplicate. The implementer's stated reasoning (no existing `cache()` usage in this codebase, unproven in this test setup, cost already minimal post-index) holds up under my independent check. Acceptable.
- **Point 5 (click-through):** Started `pnpm dev` in the background against the real dev Neon DB, confirmed it was live via `curl` (200) and `ps aux`. Queried `email_queue` status counts first: `blocked_non_production: 397, pending: 2, sent: 678` — **zero `failed` rows and zero `dev_no_api_key` rows** in this dev DB. Wrote a throwaway Playwright script (run from the repo root so `node_modules` resolved, never committed) that signs in as the real `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` credentials via the actual sign-in form (same helper pattern as `e2e/helpers/auth.ts`) and visits `/admin/email-queue` at both a desktop (1280px) and a 360px mobile viewport. Confirmed live: the "Email Queue" nav `<a>` renders with **no badge span at all** when the real count is 0 (`grep`-verified from the captured `outerHTML`) — the zero case renders nothing, live, not just per the unit test. Confirmed the page's "Failed Emails" section shows "No failed emails — everything is delivering successfully." and the relabeled **"Not Sent (Non-Production)" section shows a "50" count badge** (the query's `.limit(50)`) with real `blocked_non_production` rows, a **Reason column** rendering "Blocked (not production)" pills, and the new explanatory copy exactly as described in the handoff notes. Re-queried `email_queue` counts and a "created in the last 10 minutes" count immediately after — **identical counts, zero new rows** — confirming my click-through wrote nothing to the database, honoring the task's constraint. For the "36" scenario specifically (which the dev DB cannot produce without a real write), rendered `AdminSidebar` directly with `failedEmailCount={36}` via a temporary vitest spec (`src/__tmp_qa_badge_render.test.tsx`, written, run once via `pnpm exec vitest run`, then immediately deleted — confirmed via `git status` that no trace remains), capturing its real `renderToStaticMarkup()` output — the actual component code, not a mockup. Loaded that markup in a real Chromium page (via Playwright) styled with the project's actual Tailwind color tokens at the sidebar's true fixed width (256px, `w-64` — independent of viewport, confirmed via `getBoundingClientRect()`), and screenshotted the Email Queue row: "Email Queue" plus a "36" pill render on one line with no wrapping, in both the active (blue background, white pill) and inactive (white background, amber pill) states. Verified the raw markup carries `aria-label="36 failed emails"` distinct from the visible "36" text. Stopped the dev server afterward (`pkill -f "next dev"`) and confirmed no processes remained.
- **Point 6 (screen-reader labeling):** confirmed via both the unit tests (`admin-sidebar.test.tsx`'s singular/plural assertions) and my own captured markup (`aria-label="36 failed emails"` on the pill `<span>`, separate from the visible digit-only "36" text a sighted user sees) — a screen reader announces the full sentence, not a bare number.
- Ran the required gates from a clean shell: `pnpm exec tsc --noEmit` (clean), `pnpm lint` (0 errors, 1 pre-existing unrelated warning in `budget-context-panel.tsx`, confirmed untouched by this diff), `pnpm test` (2072/2072 — matches the task brief's pre-stated expected baseline of 2072 exactly, i.e. 2116 minus the 44 stashed financial-report tests), `pnpm build:only` (exit 0, 268 routes compiled, no errors or warnings in the log).
- Read every changed file's full diff (`page.tsx`, `view-email-dialog.tsx`, `layout.tsx`, `admin-sidebar.tsx`, `schema.ts`) rather than trusting the "Outputs" list — all match the handoff's description exactly, no surprises.

### Outputs

- `docs/work-log/2026-09-25-email-silent-success.md` — this Phase 5 section.
- No production code changed by qa. A temporary render-check spec (`src/__tmp_qa_badge_render.test.tsx`) and several throwaway `.mjs` Playwright scripts were created under the repo root purely to invoke `node_modules`-resolved imports, run once each, and deleted immediately after — confirmed via `git status --porcelain` that the working tree returned to exactly its pre-verification state (the same 8 modified files + 7 untracked files listed at the start of this task, nothing more).
- Ran `drizzle/migrations/0105_email_queue_status_index.sql` twice against the dev Neon DB (the task's point 3 explicitly authorized this as the way to verify idempotency "by execution"). This is the one intentional, sanctioned database write in this verification — a schema index, not data — and is exactly what this feature is meant to ship. No `email_queue` row, no user, no session, and no other table was written to; confirmed by direct before/after row-count comparison.
- Did not commit, did not push, did not send any real email, did not add any address to `EMAIL_DEV_ALLOWLIST`, did not modify `ADMIN_NAVIGATION` or any nav/permission data.

#### Type Check
`pnpm exec tsc --noEmit`: **PASS** (no output)

#### Lint
`pnpm lint`: **PASS** — 0 errors. 1 pre-existing warning (`src/components/admin/ledger/budget-context-panel.tsx:114`, unused eslint-disable directive) — confirmed untouched by this diff (not in the changed-files list).

#### Unit Tests
`pnpm test`: **PASS**
Total: 2072 | Passed: 2072 | Failed: 0
Files: 120 passed
Duration: ~2.2s
Matches the task brief's own pre-stated expectation exactly (2116 minus 44 stashed financial-report tests). The three new test files from this follow-up (`email-queue-stats.test.ts`, `admin-sidebar.test.tsx`, `status-pill.test.tsx`) are untracked-but-on-disk and included in this run.

#### Production Build
`pnpm build:only`: **PASS** — exit code 0. 268 routes compiled (static + dynamic). No errors, no warnings in the build log (`grep -iE "error|warn|fail"` on the captured log returned nothing).

#### End-to-End Tests
Not run via the Playwright config/`pnpm test:e2e` — the task's Gates section names only `tsc`, `lint`, `pnpm test`, `pnpm build:only`, and this is UI-only work with no new route or server action. Instead drove an equivalent real-browser click-through directly (see "What I did," point 5) using a throwaway Playwright script and the project's real `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` credentials against a live `pnpm dev` server — a stronger check than the existing suite would provide anyway, since `grep -rl "email-queue" e2e/` still returns no hits (the existing suite doesn't touch this page at all).

#### Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| Sidebar badge, real zero-failed-rows dev DB | pass (live) | Signed in as real e2e admin via Playwright against `pnpm dev`; captured the Email Queue `<a>` element's `outerHTML` — no badge `<span>` present at all when the real count is 0. |
| `/admin/email-queue` "Not Sent (Non-Production)" section, real data | pass (live) | 397 real `blocked_non_production` rows render under the relabeled heading with a "50" count badge (query's `.limit(50)`), new Reason column, "Blocked (not production)" pill, and the new explanatory copy — all exactly as described in the handoff. |
| `dev_no_api_key` row rendering | reviewed only, not driven live | The dev DB has zero such rows and creating one would require an actual `sendEmail()` call writing to `email_queue`, which the task forbids. Verified instead via the existing `status-pill.test.tsx` (4 tests, all passing) and by reading `StatusPill`'s implementation directly — confirmed `dev_no_api_key` gets its own label/color rather than falling through to the "pending" fallback. |
| Badge at 256px sidebar width (360px viewport) with a realistic count (36) | pass (live render, synthetic prop) | Rendered the real `AdminSidebar` component (not a mockup) with `failedEmailCount={36}` via a temporary, immediately-deleted vitest spec, then screenshotted the output at the sidebar's true fixed 256px width in a real Chromium page — "Email Queue" + "36" fit on one line, no wrap, no overflow, in both active and inactive row styles. |
| DB write check | pass | `email_queue` status counts and a "created in last 10 minutes" count were identical before and after the entire click-through — confirmed zero writes occurred. |
| Migration idempotency | pass (verified by execution) | Ran `drizzle/run-migrations.mjs` twice against the dev DB; second run cleanly no-ops (Postgres `NOTICE`, exit 0). |

### Regression Tests Added

None added by qa this pass — the implementer's 14 new tests (7 `admin-sidebar.test.tsx`, 3 `email-queue-stats.test.ts`, 4 `status-pill.test.tsx`) already cover every branch I probed manually (zero count, singular/plural, 99+ cap, missing-permission suppression, isAdmin bypass, omitted-prop default, unknown-status fallback, dev_no_api_key distinct labeling/coloring). I verified these tests are honest by reading them in full rather than trusting the count, and by independently reproducing their claims live (see click-through table above) rather than re-running them as a black box.

### Coverage on Critical Modules

Not applicable in the events.ts/permissions.ts/members.ts sense — this follow-up touches none of them. For the files it did add: `email-queue-stats.ts`'s only exported function (`getFailedEmailCount()`) has 3 dedicated tests covering the query-result, empty-result, and filter-predicate branches — effectively 100% of its logic. `admin-sidebar.tsx`'s new badge logic has 7 dedicated tests covering every branch (`showFailedBadge`'s three-way AND, the 99+ cap, singular/plural).

### Feature-Gate Audit (mandatory before PASS)

This follow-up adds no new API route, no new server action, and no new `FEATURES.*` key. It threads an existing permission check into an existing layout to gate a new *display* (a count badge), and extends an existing page's rendering to cover an additional pre-existing status string. No protected route's gate changed.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `(dashboard)/admin/layout.tsx` (badge count fetch) | yes — `await auth()`, unchanged, pre-existing | yes — gated on `isAdmin \|\| userFeatures.includes(FEATURES.ADMIN_USERS)` before the query even runs (verified: the query call sits inside the `true` branch of a ternary, not called-and-discarded) | `FEATURES.ADMIN_USERS` — matches the exact key `/admin/email-queue`'s own `page.tsx` requires (`hasFeature(session.user.id, FEATURES.ADMIN_USERS)`), confirmed by reading both files side by side |
| `GET (dashboard)/admin/email-queue` (page, pre-existing, unchanged by this follow-up) | yes, unchanged | yes, unchanged (`hasFeature(session.user.id, FEATURES.ADMIN_USERS)`) | `FEATURES.ADMIN_USERS`, unchanged — the same minor pre-existing note flagged in the original Phase 5 (this key reads slightly broad for a mail-queue feature) still stands, not reopened here |

No protected route or server action was added, removed, or had its gate changed by this follow-up. `ADMIN_NAVIGATION` and `getAdminProtectionRules()` are confirmed byte-for-byte unchanged (empty `git diff`).

### Verdict: PASS

### Open questions / handoff notes

- **For `analyst` (Phase 6, second pass on this follow-up):** both Phase 6 follow-ups (#1 failed-count badge, #2 `dev_no_api_key` visibility) are implemented, tested, and verified live. The one nuance worth carrying forward for the record, not a blocker: the badge's permission check reads the JWT-cached `session.user.features` (refreshed only at sign-in or an explicit session `update`), while the page it points to re-checks live against the DB (60-second cache) via `hasFeature()`. This is **not a new gap** — it's the same freshness model the entire `AdminSidebar` has always used for every other nav item's visibility — but it does mean a just-revoked admin could see a stale badge count for the remainder of their session. Not worth fixing on its own; noting it so a future session-freshness review has the full picture in one place.
- **Still open, unrelated to this follow-up, carried forward unchanged from Phase 6:** the 98 historically mis-recorded production `sent` rows (human/data decision), and investigating why `RESEND_API_KEY` went missing in Vercel Production around 2026-08-28 (deployment-engineer/user).
- **Minor, unchanged:** `FEATURES.ADMIN_USERS` gating the email-queue area continues to read slightly broad for a mail-specific feature — flagged again for a future permissions review, not this one.
- No loop-back needed. Recommend closing this follow-up's pipeline with a Phase 6 SHIP IT/SHIP WITH NOTES pass.

---

## Note on pipeline gap — Per-Message Retry (Follow-Up #3) has no Phase 1–4 write-up

The implementing agent that built the targeted/per-message retry button (`row-retry-button.tsx`, the `handleTargetedRetry()` path in `retry/route.ts`, and the corresponding "Follow-Up #2 (Targeted Retry)" tests in `route.test.ts`) was interrupted before writing its work-log section. There is no Phase 3 design or Phase 4 implementation entry for this piece — this Phase 5 section is qa verifying code that exists in the working tree with no preceding write-up to check it against. The user completed one piece of it directly (`router.refresh()` in `row-retry-button.tsx`). Per "no silent skips," this gap is being surfaced here rather than silently backfilled; tech-lead/api-developer should retroactively add a Phase 3/4 section if this work proceeds past qa.

---

## Phase 5 — Verification of Per-Message Retry (Follow-Up #3) — 2026-09-25

**Owner:** qa
**Status:** complete

### Summary

**VERDICT: FAIL.** Six of seven scrutiny points hold up under independent verification, but point 2 ("no duplicate sends... confirm the server is also safe") does not: `handleTargetedRetry()` in `src/app/api/admin/email-queue/retry/route.ts` has no atomic claim on the row it's about to send. It `SELECT`s the row, checks `item.status !== "failed"` in memory, then later `UPDATE`s it — with a real database round-trip (and therefore a real window) between the read and the write. Two concurrent requests for the same id (a fast double-click, or two admins working the same failed row at once) can both observe `status: "failed"` before either write lands, and both proceed to call `resend.emails.send()`. I reproduced this directly: a test that fires two concurrent `POST` requests for the same id shows `resend.emails.send()` called **twice**, not once. The client-side in-flight guard in `row-retry-button.tsx` (`if (inFlight) return`) does not protect against this, exactly as the task brief warned — it only prevents one browser tab from double-firing, not two requests reaching the server. This is a real duplicate-send hazard for the exact scenario this feature exists to serve: an admin resending genuine board notifications, reimbursement requests, donor acknowledgments, and password resets. I wrote a regression test for it (failing, left in the suite) rather than reporting the finding without proof. Everything else — the `nextRetryAt` bypass (the entire point of this feature), the unchecked-`error` fix, per-id result reporting, the permission gate, and the bulk button's unchanged behavior — is correct and independently verified below. I also surfaced one adjacent, pre-existing (not introduced by this follow-up) finding worth escalating: this retry route bypasses `sendEmail()` entirely and therefore has **no `EMAIL_DEV_ALLOWLIST` deny-by-default check at all** — a fact that made my own manual click-through materially riskier than the task brief assumed, detailed under point 6.

### What I did, by scrutiny point

**Point 1 — `nextRetryAt` bypass is the entire point.** Read `handleTargetedRetry()`: it queries `inArray(emailQueue.id, ids)` with no `lte(nextRetryAt, now)` clause at all, unlike `handleBulkRetry()`. Confirmed by execution, not just reading: temporarily reverted `src/app/api/admin/email-queue/retry/route.ts` to its pre-Follow-Up-3 `HEAD` content (saved a copy of the fixed file first) and re-ran `route.test.ts` — **7 of 11 tests failed**, including the load-bearing one (`"picks up a failed row with nextRetryAt = NULL by composing inArray(id), never lte(nextRetryAt) — fails without the fix"`), which failed because the pre-fix `POST()` took no parameters at all and always ran the bulk sweep — it never even parsed a request body. Restored the fixed file (`diff` confirmed byte-identical to the saved copy) and re-ran: 10 of 11 passed (the 11th being my own new race test — see point 2). **Confirmed: real, tested, correct.**

**Point 2 — No duplicate sends.** See Summary. Concretely, in `handleTargetedRetry()`:
```ts
const rows = await db.select().from(emailQueue).where(inArray(emailQueue.id, ids));
...
if (item.status !== "failed") { ... continue; }
...
const outcome = await attemptSend(resend, item);   // <-- real send happens here
...
await db.update(emailQueue).set({ status: "sent", ... })  // <-- claim happens AFTER the send
```
The claim (`status: "sent"`) is written only *after* the send succeeds, and the eligibility check reads a snapshot taken before any writer has claimed the row. There is no `UPDATE ... WHERE status = 'failed' RETURNING id` gate before `attemptSend()` — the exact pattern this same codebase already uses elsewhere for precisely this hazard (`ledger-acknowledgment-letter-queries.ts`'s atomic `sent_at IS NULL` claim, called out by name in CLAUDE.md as "atomic on purpose"). I added a test to `route.test.ts` (`"must not send twice when two requests for the same id arrive concurrently (double-click / race)..."`) that fires two `POST`s for the same id via `Promise.all` and asserts `sendMock` was called once. **It fails against the current code**: `expected "vi.fn()" to be called 1 times, but got 2 times`. I ran it three times to rule out flake (mock-based, no real timing dependency — the mock's `db.select().where()` resolves via a microtask with no artificial delay, so this isn't a timing coincidence; it reproduces on every run). Left the test in the suite, failing, as the regression guard for whoever fixes this.

**Point 3 — Unchecked-`error` bug fixed on this path.** Read `attemptSend()`: it inspects `result.error` from `resend.emails.send()` and returns `{success: false, error: ...}` when non-null, never falling through to the success branch. The file's own top-of-function comment names the exact hazard this guards against and cites the outage this whole work-log documents. Test `"a Resend response carrying a non-null error marks the row failed with that message — NOT sent (regression for the unchecked-error bug)"` passes, and I confirmed it's a real guard (not a tautology) by temporarily deleting the `if (result.error)` check and re-running — the test then fails with `expected succeeded: 0 but got succeeded: 1`, confirming it actually exercises the code path. Restored the check afterward (`diff` against the saved copy confirmed byte-identical). Confirmed `src/lib/email.ts`'s `sendEmail()` primary path still has the *original* unchecked-error bug, unfixed, exactly as the task brief said is known/tracked/out-of-scope — did not touch it.

**Point 4 — Permission gate.** `POST /api/admin/email-queue/retry` requires `auth()` (401 if absent) then `hasFeature(session.user.id, FEATURES.ADMIN_USERS)` (403 if absent) — unchanged by this follow-up, and identical in both bulk and targeted modes since both flow through the same `POST()` entry point before the mode branches. This matches `/admin/email-queue`'s own page-level gate (`hasFeature(session.user.id, FEATURES.ADMIN_USERS)`), confirmed by reading both files side by side. Two dedicated tests (`"the permission gate still refuses an unauthorized caller in targeted mode"`, `"an unauthenticated caller is refused in targeted mode"`) pass and assert `sendMock`/`updateSet` were never called — not just a status code check. Carrying forward the same pre-existing, non-blocking note as the original Phase 5: `ADMIN_USERS` reads broader than a mail-specific permission would ideally be, unchanged by this follow-up, not re-litigated here.

**Point 5 — Per-id results.** `"returns a correct per-id result for a mixed success/failure batch"` passes: a 2-id batch with one Resend success and one Resend rejection returns `{mode: "targeted", retried: 2, succeeded: 1, failed: 1}` and a `results` array with the correct per-id `{id, success, error?}` shape, matching what `row-retry-button.tsx` actually reads (`data.results.find((r) => r.id === id)`) to decide its own toast/state per row. Confirmed the UI code and the API contract agree by reading both, not just trusting the test.

**Point 6 — UI click-through.** Ran this live against `pnpm dev` and the real dev Neon DB (`ep-orange-sunset` per `.env.local`), signed in via the real `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` credentials through the actual sign-in form (Playwright, throwaway spec, deleted after). Inserted exactly one synthetic `failed` row (`to: qa-synthetic-donotsend@example.invalid`, an address on ICANN's reserved-for-documentation `.invalid` TLD, guaranteed non-deliverable and non-real) directly via SQL, confirmed it before/after with `SELECT status, count(*) FROM email_queue GROUP BY status` (0 → 1 → back to 0 after cleanup, no other row touched).
- Confirm dialog: opened correctly (Radix `AlertDialog`, `role="alertdialog"` — not a native browser dialog), and its text names the **exact** recipient and subject verbatim: *"This will resend the message now, immediately, to qa-synthetic-donotsend@example.invalid (subject: "QA synthetic failed row — do not retry for real")."* Screenshot saved during the run.
- Sidebar badge: rendered `aria-label="1 failed email"` / visible text `"1"` on the Email Queue nav item, matching the exactly-one synthetic row — confirmed via a direct `aria-label*="failed email"` locator, not eyeballing.
- In-flight/disable behavior: confirmed in the component source (`disabled={inFlight}`, button text swaps to "Retrying...") — not re-verified live beyond this, since exercising it live would require actually confirming a send (see below).
- **I deliberately did not click "Send now."** I clicked the row's "Retry" button (confirmed via `getByRole("button", { name: "Retry", exact: true })` to avoid the ambiguous substring match against the page's own "Retry Failed Emails" bulk button — my first attempt at this locator accidentally fired the *bulk* button instead, which I caught immediately by checking the dev server log for an unexpected `POST /api/admin/email-queue/retry`; it ran, found zero eligible rows because my synthetic row's `nextRetryAt` is `NULL`, and did nothing — confirmed by the row's `attempts`/`status` being unchanged in the DB afterward). Once the dialog was open, I clicked **Cancel**, confirmed the dialog closed, and confirmed via the dev server log that no second `POST` was issued.
- **Why I stopped short of confirming a real send, and a finding this surfaced:** the task brief assumes `sendEmail()`'s deny-by-default guard "will block the actual dev send" if I trigger one. That assumption is **wrong for this specific route**. `attemptSend()` calls `resend.emails.send()` **directly** — this route bypasses `sendEmail()` entirely (by design, per DECISION-092, to forward persisted attachments) and therefore never runs the `EMAIL_DEV_ALLOWLIST` check at all, in either bulk or targeted mode. I confirmed this is **pre-existing, not introduced by this follow-up**: `git show HEAD:.../retry/route.ts` (the version before today's entire day of work) has the identical direct `resend.emails.send()` call with no allowlist check. This repo's own `.env.local` has a real, populated `RESEND_API_KEY` (confirmed present, value not disclosed) — meaning if I had clicked "Send now," this route would have made a genuine live call to Resend's API attempting to deliver to whatever `to` address the row carried, in violation of the task's explicit "do NOT attempt a real send." I used a `.invalid`-TLD address specifically so that even my accidental bulk-button click (which did fire a real `POST`, before it exited on zero eligible rows) could not have resulted in a deliverable message under any code path. **This is a live safety gap independent of today's fix**, not a regression, but exactly the shape of incident CLAUDE.md's "Outbound Email Is Deny-By-Default Outside Production" section describes twice already (2026-08-09, 2026-08-12) — the retry route is simply a call site the deny-list-era protections never covered, and deny-by-default's own code-level fix in `sendEmail()` doesn't reach it either, because it isn't called. **I recommend flagging this to tech-lead/deployment-engineer as its own follow-up**, independent of whether this specific per-message retry feature ships: a targeted, one-click "Retry" button (versus the existing bulk button, which most admins are unlikely to click casually) meaningfully lowers the accidental-trigger bar for this exact gap.
- Mobile (360px): screenshot taken; a raw `document.documentElement.scrollWidth (999) > clientWidth (360)` check initially looked like a horizontal-overflow bug, but a second diagnostic pass (walking every element's ancestor chain for an `overflow-x: auto/scroll/hidden` clip) found **zero unclipped elements wider than the viewport** — every wide element (the three data tables, including the new Retry column) is correctly contained inside its own `overflow-x-auto` wrapper, the same pattern the page already used for its other two tables before this change. I judge this a Chromium `scrollWidth` measurement quirk on nested scroll containers, not a real visible bug, and not a regression — consistent with the prior Phase 5 pass's same conclusion for the Reason column added in Follow-Up #2.
- **DB write check:** `email_queue` status counts identical before and after the entire click-through except for the one row I inserted and then deleted myself. Confirmed zero real sends occurred.

**Point 7 — Bulk button unchanged.** `handleBulkRetry()` still queries `and(eq(emailQueue.status, "failed"), lte(emailQueue.nextRetryAt, now))` — byte-for-byte the same predicate as before this follow-up (confirmed via `git show HEAD` diff of the whole file: the bulk path was refactored into its own named function but the query and per-item logic are unchanged). Still incapable of blasting all 36 real production rows at once, since none of them have a `nextRetryAt` that satisfies `lte`. No regression here.

### Gate results

- `pnpm exec tsc --noEmit`: **PASS** (no output).
- `pnpm lint`: **PASS** — 0 errors. 1 pre-existing, unrelated warning (`src/components/admin/ledger/budget-context-panel.tsx:114`), confirmed untouched by this diff (same warning present before any of today's changes).
- `pnpm test`: **FAIL** — Test Files: 1 failed | 119 passed (120). Tests: **1 failed | 2078 passed (2079)**. The one failure is the race-condition regression test I added (`src/app/api/admin/email-queue/retry/route.test.ts`, `"must not send twice when two requests for the same id arrive concurrently..."`). Baseline before my addition was 2078/2078 passing (matches the task brief's stated starting point); +1 test, and it fails, by design, against the current code.
- `pnpm build:only`: **PASS** — exit code 0, full route table compiled, no errors in the captured build log (`grep -iE "error|fail"` on the log returned nothing).

### Findings, ranked

1. **FAIL — duplicate-send race in `handleTargetedRetry()`.** No atomic claim between reading a row's `status` and sending through it. Two concurrent requests for the same id both send. Reproduced with a failing test (see below). This is the blocking finding.
2. **Escalate, not blocking this verdict — no deny-by-default coverage on this entire route (bulk or targeted), pre-existing.** `resend.emails.send()` is called directly, bypassing `sendEmail()`'s `EMAIL_DEV_ALLOWLIST` guard entirely, in every environment. Confirmed pre-existing via `git show HEAD`. Not introduced today, but a one-click per-row button raises its practical risk. Recommend a follow-up ticket for tech-lead/deployment-engineer, independent of this feature's fate.
3. Everything else audited (points 1, 3, 4, 5, 7, and the UI aside from the send-safety concern) is correct and independently verified, not merely re-read from the implementer's claims.

### Regression Tests Added

- `must not send twice when two requests for the same id arrive concurrently (double-click / race) — regression for missing atomic claim in handleTargetedRetry` — `src/app/api/admin/email-queue/retry/route.test.ts` (end of the "targeted retry (Follow-Up #2)" describe block) — **currently failing, left in the suite on purpose** — guards against: duplicate real sends when two requests race for the same `email_queue` row. Confirmed failing against both the pre-Follow-Up-3 code (`HEAD`) and the current code — this is not a new regression introduced today, it's a hazard that was never closed.

### Coverage on Critical Modules

Not applicable in the `events.ts`/`permissions.ts`/`members.ts` sense. For the file this follow-up actually changed (`retry/route.ts`): every stated branch (nextRetryAt bypass, non-`failed` refusal, mixed-batch per-id results, Resend error handling, both permission-failure paths) has a passing dedicated test; the one uncovered-until-now branch (concurrent claim safety) now has a test too — it's just failing, which is the correct state to hand back.

### Feature-Gate Audit (mandatory before PASS)

No new route or server action; `POST /api/admin/email-queue/retry` already existed and its gate is unchanged by this follow-up.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `POST /api/admin/email-queue/retry` (targeted mode, new) | yes, unchanged, shared with bulk mode | yes, unchanged (`FEATURES.ADMIN_USERS`) | Same pre-existing key as bulk mode and the page itself; same non-blocking breadth note carried forward from the original Phase 5, not reopened here. |

### Verdict: FAIL

### Open questions / handoff notes

- **For the implementer (api-developer) — this is the loop-back:** fix the race in `handleTargetedRetry()` (and, since `handleBulkRetry()` iterates a snapshot list too, consider whether concurrent bulk + targeted retries on the same id have the identical hazard — I did not test that combination, only same-mode-same-id). The fix shape that matches this codebase's own precedent: an atomic `UPDATE email_queue SET status = '<in-flight marker>' WHERE id = $1 AND status = 'failed' RETURNING id` claim before calling `attemptSend()`, mirroring `ledger-acknowledgment-letter-queries.ts`'s "atomic on purpose" pattern (cited in CLAUDE.md). Watch the regression test I left in the suite go from failing to passing — do not consider this done until it's green.
- **For tech-lead/deployment-engineer, new finding, not blocking this specific verdict but real:** the entire `/api/admin/email-queue/retry` route (bulk and targeted, today's change and pre-existing) has no `EMAIL_DEV_ALLOWLIST` deny-by-default check — it calls `resend.emails.send()` directly. Recommend a follow-up to decide whether this route should check the allowlist outside production (mirroring `sendEmail()`'s guard) before this one-click UI sees wider use.
- **For whoever picks this back up:** there is no Phase 1–3 write-up for this feature (see the "Note on pipeline gap" section above) — worth backfilling once the race is fixed, so this doesn't ship without the design-intent record the rest of this work-log has for every other piece.
- **Carried forward, unrelated to this follow-up, still open:** the 98 historically mis-recorded production `sent` rows (human/data decision) and the still-uninvestigated root cause of `RESEND_API_KEY` going missing in Vercel Production around 2026-08-28.
- **Handoff:** back to **api-developer** (Phase 4 loop-back) to fix the race, per "Loop-back: FAIL returns to the implementer (Phase 4) with the failing flow cited." Not ready for analyst/Phase 6 until this is green.

---

## Phase 4 — Implementation (API) — Rework of Per-Message Retry (Follow-Up #3) — 2026-09-25

**Owner:** api-developer
**Status:** complete

### Summary

Fixed both blocking defects from qa's FAIL. The duplicate-send race is closed with an atomic claim on the row (`UPDATE email_queue SET status='retrying', attempts=attempts+1 WHERE id=$1 AND status='failed' RETURNING id`), mirroring `ledger-acknowledgment-letter-queries.ts`'s "atomic on purpose" pattern by name, applied to **both** the targeted and bulk retry paths. The route's total bypass of the `EMAIL_DEV_ALLOWLIST` deny-by-default guard is closed by extracting the predicate out of `sendEmail()` into a new pure module, `src/lib/email-guard.ts`, and having both `sendEmail()` and the retry route call the same function — no copy, no behavior drift, `sendEmail()`'s own guardrail suite still passes unchanged. qa's failing regression test now passes without being weakened; I did not touch its assertions.

### What I did

- **Atomic claim (`claimFailedRow()`, `src/app/api/admin/email-queue/retry/route.ts`):** one conditional `UPDATE ... WHERE id = $id AND status = 'failed' RETURNING id`, run before any send is attempted, for both `handleTargetedRetry()` and `handleBulkRetry()`. A lost claim (zero rows returned) is reported as `"Already being retried — refresh and try again"` in targeted mode and simply skipped (owned by whichever concurrent request won) in bulk mode — never a fabricated success, never a second send. The claim also increments `attempts` in the same statement, so every downstream caller reuses that value instead of incrementing a second time.
- **Claim-then-send-fails handling:** the claim moves the row to a new, deliberately transient status, `"retrying"`. `settleClaim()` wraps the send/guard/missing-key logic in a `try/catch` and *always* writes a terminal status before returning — `"sent"` on success, `"failed"` (with the real error and a `nextRetryAt`) on any failure, including an unexpected exception that isn't a normal Resend rejection (attemptSend() already catches those; the outer catch protects against a failure in the surrounding code, e.g. the DB write itself). A row can never be left stranded at `"retrying"`. Documented this in `claimFailedRow()`'s and `settleClaim()`'s doc comments. Added `'retrying'` to the `emailQueue.status` inline comment in `src/lib/db/schema.ts` — no migration needed, `status` is untyped `text`. `"retrying"` deliberately doesn't get its own `/admin/email-queue` section or `StatusPill` label: it only exists for the duration of one request, and unknown statuses already fall back to the pre-existing "pending" style with the raw string shown, so nothing breaks if it's ever observed mid-flight.
- **Bulk path had the identical race — fixed the same way.** `handleBulkRetry()` iterated a snapshot list and sent unconditionally, exactly like the pre-fix targeted path. It now calls the same `claimFailedRow()`/`settleClaim()` pair per row. Added a dedicated concurrency regression test (`"bulk retry has the identical race protection"`) mirroring the targeted one.
- **Deny-by-default guard, extracted, not duplicated.** Created `src/lib/email-guard.ts`: a pure module (no `@/lib/db` import) exporting `shouldBlockNonProductionSend(to, opts?)`, holding the exact predicate (`isClubDistributionList`, `isDevAllowedRecipient`, the `_bulkMemberSend`-style unconditional widening via `opts.bulk`) that used to live only inside `sendEmail()`. `sendEmail()` now imports and calls it instead of the inline logic — the guard's ordering, its `production` bypass, its distribution-list refusal, and its allowlist behavior are all byte-identical to before, just relocated. `settleClaim()` in the retry route calls the same function, before the missing-key check, mirroring `sendEmail()`'s own ordering. A blocked retry is recorded as `status: "blocked_non_production"` — the same status `sendEmail()` already uses for the identical concept — so it surfaces in the existing "Not Sent (Non-Production)" admin section with zero new UI, and is never counted as a real failure (same treatment as `dev_no_api_key`: not in `succeeded`, not in `failed`).
- **Why this satisfies "keep `sendEmail()`'s behavior byte-identical":** the only change inside `sendEmail()` is swapping an inline `if` condition for a call to the extracted function with the same inputs; no branch, no status string, no return shape changed. Verified by running the full `email-guardrail.test.ts` and `email-no-api-key.test.ts` suites unchanged — both still pass with no edits to either file.
- **Test-file scaffolding change (test infra, not weakening any assertion):** the mock `@/lib/db` in `route.test.ts` previously only supported an unconditional `.update().set().where()`. Implementing a real atomic claim required the mock to actually behave like one — I extended it to support `.where(cond).returning()` (the claim path, which checks the row's CURRENT status against the WHERE precondition before mutating, so two concurrent claims on the same shared row object correctly resolve to exactly one winner) alongside the existing bare-`await` path (the terminal writes). Extraction of the WHERE clause's bound values from the real (non-mocked) `eq()`/`and()` SQL fragments follows the same "read `queryChunks` directly" technique already established in `email-queue-stats.test.ts`, adapted because this file's `emailQueue` schema mock has no real column objects (so the `encoder.name` trick used there doesn't apply here — positional extraction was used instead, since the call sites are controlled and known). Did not touch or weaken the QA-authored failing test's assertions — it passes as originally written.
- **Adjusted one pre-existing test, not weakened:** the "NON-PRODUCTION + missing key" test previously didn't allowlist its fixture recipient, because the route had no guard to clear. Now that the guard runs first, that test would incorrectly exercise the *new* blocked-by-guard branch instead of the missing-key branch it's meant to isolate. Added `vi.stubEnv("EMAIL_DEV_ALLOWLIST", "member@westervillelions.org")` to keep it isolated to the missing-key logic, and added a full dedicated describe block for the guard itself (below) so that behavior isn't just implicitly assumed.
- **Global test default:** added `vi.stubEnv("NODE_ENV", "production")` to the file's top-level `beforeEach` (with a matching `afterEach(() => vi.unstubAllEnvs())`), following the exact convention `email-guardrail.test.ts` already uses ("no guardrail interference") for describe blocks that aren't about the guard. Without this, essentially every pre-existing test in the file would have started failing the moment the guard was wired in, since the default Vitest `NODE_ENV` is not `"production"` and none of the fixture recipients are allowlisted.

### Tests added/changed

- `must not send twice when two requests for the same id arrive concurrently...` (qa's) — **now passes**, unmodified assertions. Also strengthened with two additional checks (exactly one of the two responses reports success; the row lands at a terminal `"sent"` status, never stranded at `"retrying"`).
- `bulk retry has the identical race protection: two overlapping bulk sweeps never send the same row twice` — new, targets `handleBulkRetry()`'s copy of the same hazard.
- `reverts the row to failed with a real error instead of leaving it claimed-but-never-settled` (new describe block, "claim succeeds but the terminal write then throws") — forces the terminal `"sent"` write itself to throw via a test-only fault injector (`forceThrowOnNextSentWrite`), asserting `settleClaim()`'s outer `try/catch` reverts the row to `"failed"` with the thrown error, `attempts` incremented exactly once (not twice). This is the direct answer to the task's "claim-succeeds-then-send-fails" requirement, covering the case beyond the already-existing ordinary-Resend-rejection test.
- Strengthened the existing `"a Resend response carrying a non-null error marks the row failed..."` test with an explicit assertion that the row's live status lands at `"failed"`, not left at the transient `"retrying"` claim status.
- New describe block, `"blocked by the non-production deny-by-default guard"` (5 tests): blocks a non-allowlisted recipient (`blocked_non_production`, not counted as success or failure, real block message in the result); still delivers to an allowlisted recipient; refuses a club distribution list even if it's allowlisted; delivers in production regardless of allowlist state; and confirms the guard also applies to the bulk path.
- Adjusted: `"NON-PRODUCTION + missing key..."` now allowlists its fixture recipient (see above) so it stays isolated to the missing-key branch.

### Gate results

- `pnpm exec tsc --noEmit`: **PASS** (no output).
- `pnpm lint`: **PASS** — 0 errors. Same 1 pre-existing, unrelated warning (`src/components/admin/ledger/budget-context-panel.tsx:114`) as every prior pass in this work-log — confirmed untouched by this diff. (Caught and fixed one new warning of my own — an unused `response` binding in one of the new guard tests — before this final run.)
- `pnpm test`: **PASS** — **2086 passed (2086)**, 120 test files. Baseline stated in the task brief was 2078 passing + 1 failing (2079 total); the 1 failing test now passes, and 7 new tests were added (1 bulk-race test, 1 claim-then-throws test, 5 guard tests) — 2079 + 7 = 2086, confirmed by direct count.
- `pnpm build:only`: **PASS** — exit code 0, full route table compiled, no errors in the captured log.

### Outputs

- `src/app/api/admin/email-queue/retry/route.ts` — added `claimFailedRow()` (atomic claim) and `settleClaim()` (guaranteed-terminal settlement with its own safety-net `try/catch`); `handleMissingApiKey()` now takes a pre-claimed `attempts` value instead of incrementing its own; both `handleTargetedRetry()` and `handleBulkRetry()` now claim before sending; the deny-by-default guard now runs first inside `settleClaim()` via the new shared `shouldBlockNonProductionSend()`.
- `src/lib/email-guard.ts` — new. Exports `shouldBlockNonProductionSend(to, opts?)`, the single source of truth for the non-production deny-by-default predicate, extracted from `sendEmail()`. No `@/lib/db` import, no side effects.
- `src/lib/email.ts` — `sendEmail()`'s inline guard logic (`isClubDistributionList`, `isDevAllowedRecipient`, the manual `_bulkMemberSend` condition) replaced by a single call to `shouldBlockNonProductionSend(to, { bulk: _bulkMemberSend })`. No behavior change — verified by the full existing `email-guardrail.test.ts` suite passing unmodified.
- `src/lib/db/schema.ts` — `emailQueue.status` inline comment now lists `'retrying'` as a transient status, with a pointer to where it's used. No migration — `status` is untyped `text`.
- `src/app/api/admin/email-queue/retry/route.test.ts` — extended the `@/lib/db` mock to simulate a real atomic claim (`.where().returning()` alongside the existing bare-`await` path); added the test-only `forceThrowOnNextSentWrite` fault injector; added the new describe blocks and strengthened assertions listed above; adjusted the one pre-existing test that needed an allowlist stub to stay isolated to its original branch; added a top-level `NODE_ENV="production"` default + `afterEach(() => vi.unstubAllEnvs())`.

### Answering the task's specific questions

- **How the claim is atomic and what a race-loser sees:** one `UPDATE ... WHERE id=$id AND status='failed' RETURNING id`, run before any send. In targeted mode the loser's result entry reports `"Already being retried — refresh and try again"` and is counted in `failed`. In bulk mode the loser is simply skipped (no entry — bulk mode has no per-id UI to report to; the winning concurrent request's own accounting covers the row).
- **Claim-then-send-fails:** `settleClaim()` always writes a terminal status. An ordinary Resend rejection (already caught inside `attemptSend()`) writes `status: "failed"` with the real error and a `nextRetryAt`. An unexpected exception anywhere else in the settlement path is caught by `settleClaim()`'s own `try/catch` and does the same — the row is never left at the transient `"retrying"` status. Covered by both the existing Resend-rejection test (now with an explicit status assertion) and a new dedicated fault-injection test.
- **Bulk path had the identical race** — confirmed and fixed the same way, with its own dedicated concurrency test.
- **Sharing the guard without duplicating it, without changing `sendEmail()`'s behavior:** extracted to `src/lib/email-guard.ts`, a pure module both `sendEmail()` and the retry route import. `sendEmail()`'s own guardrail test suite (`email-guardrail.test.ts`) passes unmodified, proving the behavior didn't drift.
- **Tests added:** see "Tests added/changed" above — 7 new, 2 strengthened, 1 adjusted (not weakened) to stay isolated to its original intent.
- **Anything else found:** none beyond what's documented above. The `'retrying'` transient status was a design choice this rework introduced (not present before) — flagged for the record in case a future reviewer wonders where it came from; it's intentionally invisible in the admin UI (falls to the unknown-status fallback) because it should never persist long enough to need its own treatment, and `settleClaim()`'s guarantee is what keeps that true.

### Open questions / handoff notes

- **For qa (Phase 5, second pass):** the previously-failing regression test now passes unmodified; please re-verify independently rather than trusting this account, per the project's established discipline. Specifically worth re-checking live: (1) the claim/settle behavior under `pnpm dev` with the exact same synthetic `.invalid`-address technique QA used before — do NOT click "Send now" for real, same constraint as before; (2) that `email-guardrail.test.ts` truly wasn't touched (it wasn't — confirm via `git diff`); (3) whether the `'retrying'` transient status is ever visible during a live click-through (it shouldn't be, given request-scoped lifetime, but worth a look).
- **Still open, unrelated to this rework:** the 98 historically mis-recorded production `sent` rows (human/data decision), and the still-uninvestigated root cause of `RESEND_API_KEY` going missing in Vercel Production around 2026-08-28.
- **Still open:** there is no formal Phase 1–3 write-up for the per-message retry feature itself (see the "Note on pipeline gap" section above) — this rework only fixed the two blocking defects qa found in Phase 5; backfilling the design-intent record is still worth doing before/alongside the next Phase 6 pass.
- **Handoff:** qa for Phase 5 re-verification.

---

## Phase 5 — Re-Verification of Per-Message Retry Rework — 2026-09-25

**Owner:** qa
**Status:** complete

### Summary

**VERDICT: PASS**, with one real risk disclosed rather than hidden: the atomic-claim fix trades an always-reproducible duplicate-send race for a narrow, low-probability "stranded `retrying` row" hazard that a JS `try/catch` structurally cannot close. Both of my original blocking findings are genuinely fixed, verified by re-reading the code, re-running the tests, and — for the race — running my own independent sabotage experiments against the real code rather than trusting the new tests' existence. My own regression test passes unmodified with two assertions added, not weakened. `sendEmail()`'s guard extraction is logically byte-identical to the pre-extraction inline code (De Morgan-equivalent restructuring, same helper behavior, same allowlist parsing) and both `email-guardrail.test.ts` and my `email-no-api-key.test.ts` pass completely untouched. I drove a live click-through against a real `pnpm dev` server — inserted one synthetic `failed` row, clicked the actual "Retry" button, confirmed via the server log and the JSON response that `shouldBlockNonProductionSend()` blocked it before any Resend call could happen, confirmed zero DB drift afterward. The one finding I'm escalating rather than burying: a stranded `retrying` row is invisible to both retry paths, invisible to all three `/admin/email-queue` sections, and invisible to the failed-count badge — a genuine dead end, recoverable only by a direct SQL `UPDATE`. I judge this an acceptable trade for this pass (see reasoning below) but not one that should go untracked given this project's specific history with exactly this failure shape.

### What I did

- Read the full work-log — the original Phase 5 FAIL, and the Phase 4 rework — before touching anything.
- Confirmed the working tree's changed-file list matches the rework's claimed output exactly (`git status --porcelain`, `git diff --stat`): the same 8 modified files + 8 untracked files as claimed, nothing extra.
- Read `src/app/api/admin/email-queue/retry/route.ts` in full: `claimFailedRow()` (atomic `UPDATE ... WHERE id=$1 AND status='failed' RETURNING id`, attempts incremented in the same statement), `settleClaim()` (guard check → missing-key check → send, all wrapped in `try/catch` that always writes a terminal status), `handleTargetedRetry()` and `handleBulkRetry()` both calling the claim/settle pair.
- Read `src/lib/email-guard.ts` in full and diffed its logic against the removed inline code in `src/lib/email.ts` (`git diff HEAD -- src/lib/email.ts`) line by line: `extractAddress()` is identical to the inline regex/trim/lowercase; `isClubDistributionList()` and `isDevAllowedRecipient()` are structurally identical; `shouldBlockNonProductionSend(to, {bulk})`'s `if (NODE_ENV === "production") return false; return Boolean(opts.bulk) || !isDevAllowedRecipient(to);` is De Morgan-equivalent to the original inline `NODE_ENV !== "production" && (_bulkMemberSend || !isDevAllowedRecipient(to))` — confirmed `Boolean(undefined) === false` matches `_bulkMemberSend` being falsy/undefined in the original `||`. No operator-precedence or allowlist-parsing drift found.
- Confirmed the guard now runs first in both call sites: `src/lib/email.ts` (guard check, then the no-API-key branch) and `settleClaim()` (guard check at the top of the `try`, then `if (!resend)`) — read both top-to-bottom, not inferred from tests.
- **Independently re-proved the concurrency fix**, not just re-ran the existing tests:
  - Ran the two race tests (`must not send twice...`, `bulk retry has the identical race protection...`) five times each against the current code — deterministic pass, no flake.
  - Sabotage 1: removed the atomic claim's `WHERE status='failed'` precondition (`.where(eq(emailQueue.id, id))` only). Result: the **bulk** race test failed deterministically (`sendMock` called twice) across 3 reruns; the **targeted** race test still passed. Investigated why — traced the mock's execution model and found the targeted path's own in-memory `if (item.status !== "failed")` pre-check, combined with the mock's synchronous same-tick object mutation inside `.returning()`, accidentally serializes the two concurrent calls in this specific test harness, independent of the atomic claim's WHERE clause.
  - Sabotage 2: restored the atomic claim, instead removed the in-memory `if (item.status !== "failed")` pre-check in `handleTargetedRetry()`. Result: **both** race tests still passed — proving the atomic claim alone, with no in-memory check, is sufficient to prevent the race. This is the real production guarantee (a real Postgres `UPDATE ... WHERE ... RETURNING` is atomic across separate connections; the in-memory check has no equivalent in a real multi-instance deployment where two requests don't share a JS object).
  - Sabotage 3: removed both the atomic claim's WHERE clause and the in-memory check together. Result: both race tests failed deterministically (2 sends each), confirming there's no other hidden protection.
  - Restored `route.ts` byte-identical to its pre-sabotage state after each experiment (`diff` confirmed identical each time), then ran the full suite (2086/2086) to confirm no residual change.
  - **Finding from this experiment** (verified fact, not a blocker): the "targeted" race regression test, as currently written, would not by itself catch a hypothetical future regression that only removed `claimFailedRow`'s WHERE precondition while leaving the in-memory status check in place — the mock's shared-object timing masks it. It is not a false PASS on the real defect (the defect is fixed, and the "bulk" sibling test in the same describe block would catch that exact regression, since bulk has no equivalent in-memory guard). Noting this for whoever next touches this file, not reopening the verdict over it — the actual production behavior is correct and the suite collectively still catches a regression to the shared `claimFailedRow()` helper.
- Read `route.test.ts`'s current `"must not send twice..."` test and compared it against the assertion the original FAIL report quoted (`expect(sendMock).toHaveBeenCalledTimes(1)`, with the exact same test name). That assertion is present, character-for-character, unchanged. Two additional assertions were added after it (`successes` count equals 1, terminal `row.status === "sent"`) — strictly additive, nothing removed or loosened. Not weakened.
- Read the "1 pre-existing test adjusted" claim directly: the `"NON-PRODUCTION + missing key..."` test in the same file gained one line, `vi.stubEnv("EMAIL_DEV_ALLOWLIST", "member@westervillelions.org")`, with every original assertion (`dev_no_api_key` status, `succeeded:0, failed:0`, `sendMock` not called) unchanged. This is necessary because the guard now runs before the missing-key branch — without allowlisting the fixture recipient, this test would silently start testing the *guard's* block instead of the *missing-key* branch it's named for and meant to isolate. Judged this an honest characterization, not a stealth weakening — the test's assertions didn't change, only an environment precondition needed to keep it testing what its name says it tests.
- Ran the required gates from a clean shell:
  - `pnpm exec tsc --noEmit` — clean, no output.
  - `pnpm lint` — 0 errors. 1 pre-existing, unrelated warning (`src/components/admin/ledger/budget-context-panel.tsx:114`), same warning present since before today's work, confirmed untouched by any diff in this work-log.
  - `pnpm test` — **2086/2086 passing**, 120 files, matches the rework's own stated count exactly.
  - `pnpm build:only` — exit 0, full route table compiled, `grep -iE "error|fail"` on the captured log returned nothing.
- Confirmed `git diff` for `src/lib/email-guardrail.test.ts`, `src/lib/permissions.ts`, and `src/proxy.ts` is empty (byte-for-byte untouched), then ran `email-guardrail.test.ts`, `permissions.test.ts`, `admin-page-feature-gates.test.ts`, and `email-no-api-key.test.ts` directly (not just as part of the full suite) — 216 tests, all passing.
- Read `src/lib/db/schema.ts`'s diff: comment-only update to `emailQueue.status` listing `'retrying'`, plus the previously-verified `ix_email_queue_status` index from the earlier follow-up. No unexpected schema drift.
- Read `src/app/(dashboard)/admin/email-queue/row-retry-button.tsx` in full: uses `<ConfirmDialog>` (not a native dialog), names the exact recipient and subject in the confirm copy, has a client-side `inFlight` guard (correctly described by both FAIL reports as insufficient alone, which is why the server-side atomic claim is the real fix).
- **Live click-through against a real `pnpm dev` server**, not just re-reading static code:
  - Checked `.env.local` first, without disclosing values: `RESEND_API_KEY` is set but **empty** (`length=0`), and `EMAIL_DEV_ALLOWLIST` is **not set at all** in this environment (only referenced in a comment). This makes a live click-through here doubly safe from a real send — even a hypothetical guard failure would still hit `resend === null` in the route (`process.env.RESEND_API_KEY ? new Resend(...) : null`), which never reaches the network.
  - Recorded the baseline `email_queue` status distribution (`blocked_non_production: 397, pending: 2, sent: 678`, zero `failed`/`dev_no_api_key`/`retrying`).
  - Started `pnpm dev`, confirmed migrations re-ran idempotently (`0105_email_queue_status_index.sql` cleanly no-op'd with a `NOTICE`, matching the earlier follow-up's own verification).
  - Inserted exactly one synthetic row directly via SQL: `status='failed'`, `to='qa-synthetic-retry-check@example.invalid'` (ICANN reserved-for-documentation TLD), `attempts=2`.
  - Wrote a throwaway Playwright script (`@playwright/test`'s `chromium`, deleted immediately after use), signed in via the real `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` through the actual sign-in form, navigated to `/admin/email-queue`, located the synthetic row, and clicked its real "Retry" button — confirmed the `ConfirmDialog` (`role="alertdialog"`, not a native dialog) opened with the exact recipient and subject named in its copy.
  - Clicked "Send now" for real (safe given the environment facts above) and captured the actual `POST /api/admin/email-queue/retry` response: `{"mode":"targeted","retried":1,"succeeded":0,"failed":0,"results":[{"id":"...","success":false,"error":"Blocked — non-production deny-by-default guard (EMAIL_DEV_ALLOWLIST)"}]}` — the guard fired, counted in neither bucket, exactly as designed.
  - Grepped the dev server log and found `[Email Queue Retry] BLOCKED: refusing to retry ... from a non-production process` — confirming the guard branch actually executed server-side, not just that the API happened to return the right JSON.
  - Queried the row directly afterward: `status='blocked_non_production'`, `attempts=3` (incremented exactly once by the claim), `last_error` unchanged from the seed value (the guard branch doesn't touch `lastError`, matching the code).
  - Ran a second throwaway script confirming the row disappeared from the "Failed Emails" section and reappeared under "Not Sent (Non-Production)", and that the sidebar's Email Queue nav item rendered with no numeric badge (zero real `failed` rows) — live rendering, not a unit test.
  - Deleted the synthetic row, re-queried status counts (`blocked_non_production: 397, pending: 2, sent: 678` — identical to baseline), killed the dev server, deleted both throwaway `.mjs` scripts, and confirmed `git status --porcelain` matches the exact pre-verification working tree (same 8 modified + 8 untracked files, nothing more, nothing less).
- **Investigated the `retrying`-stranding risk in depth**, per the task's explicit ask to take a position:
  - Confirmed no existing UI path can reach a row stuck at `status='retrying'`: `claimFailedRow()`'s WHERE clause requires `status='failed'`; `handleBulkRetry()`'s eligibility query requires `status='failed'` too. A `retrying` row satisfies neither, in either mode, forever.
  - Read `src/app/(dashboard)/admin/email-queue/page.tsx`'s three section queries directly: `eq(status,"failed")`, `inArray(status,["blocked_non_production","dev_no_api_key"])`, `eq(status,"sent")`. A `retrying` row matches none of the three — it renders in **no section at all**, not mislabeled, just absent.
  - Read `getFailedEmailCount()` (`src/lib/email-queue-stats.ts`): `eq(emailQueue.status, "failed")` only — a stranded `retrying` row is not counted by the sidebar badge either.
  - Read `StatusPill`: if a `retrying` row were ever rendered somewhere (it currently isn't, anywhere), it would fall to the pre-existing unknown-status fallback (styled as "pending", raw string shown) — not a crash, not a mislabel, but moot since nothing queries it.
  - Confirmed there is no cron/scheduled-worker infrastructure in this project (consistent with the earlier Phase 5 pass's finding) and no `updatedAt` column on `emailQueue` (only `createdAt`, `sentAt`, `nextRetryAt`) — meaning even a hypothetical future self-healing sweep couldn't safely distinguish "genuinely stuck for 20 minutes" from "claimed one second ago" without a new column.
  - Confirmed `settleClaim()`'s `try/catch` genuinely covers every JS-catchable failure mode already tested (ordinary Resend rejection, an unexpected exception forced via the `forceThrowOnNextSentWrite` fault injector) — the only gap is a failure mode a `try/catch` cannot observe at all: the process terminating between the claim's `UPDATE` committing and the terminal `UPDATE` committing (a Vercel function timeout, an instance crash, or a hard mid-request deploy kill). This is a real, correctly-identified new risk this rework introduces — it did not exist before today, because before today there was no intermediate claimed-but-unsettled state at all (the old code had no claim step, only the now-fixed race).

### My position on the `retrying`-stranding risk

Verified fact: a stranded `retrying` row is a genuine dead end today — invisible in the sidebar badge, invisible in all three admin-page sections, and unreachable by either retry endpoint. The only recovery path is a direct SQL statement.

My judgment, not deferred: **ship it anyway, but only with this tracked as a required near-term follow-up, not a someday-maybe.** Reasoning:
- The defect this rework closes (the duplicate-send race) was **certain and cheap to trigger** — any fast double-click or two admins working the same failed row at the same time, guaranteed to reproduce, with a real duplicate delivery to a real board member, donor, or reimbursement requester every time it fired.
- The risk this rework introduces requires a **hard process kill landing inside a narrow window** — realistically sub-second to a few seconds, bounded by one Resend API round-trip plus one or two DB writes — which is far rarer than a UI double-click, and Vercel function timeouts (10s+ by default) don't naturally land there under normal Resend latency. The realistic triggers are a genuinely hung upstream call, a mid-request deploy, or an instance crash — infrequent events, not everyday ones.
- Both hazards are visible-vs-invisible in the same currency (an admin does or doesn't know something needs attention), so this is a real trade, not a free lunch — which is exactly why it needs a named owner and a next step, not silence.
- **Concrete recommendation for the next agent (tech-lead), not a vague flag:** this can't be fixed with a pure code change today because there's no timestamp to safely judge staleness. The minimal fix is a small schema addition — a `retryingAt` timestamp set by `claimFailedRow()` — plus extending `handleBulkRetry()`'s eligibility query to also sweep up `status='retrying' AND retryingAt < now() - interval` back to `failed`. This requires no new cron infrastructure since the existing bulk sweep already runs on a button click; it would also self-heal on the *next* click of the same button that would have hit the race in the first place.

### Gate results

- `pnpm exec tsc --noEmit`: **PASS** (no output)
- `pnpm lint`: **PASS** — 0 errors. 1 pre-existing, unrelated warning (`src/components/admin/ledger/budget-context-panel.tsx:114`), confirmed untouched by any diff in this work-log, distinguished from a lint failure.
- `pnpm test`: **PASS** — 2086/2086, 120 files, matches the rework's stated count exactly.
- `pnpm build:only`: **PASS** — exit 0, full route table compiled, no errors in the captured log.

### Answers to the task's six scrutiny points

1. **My own regression test passes unmodified.** Confirmed — the original `expect(sendMock).toHaveBeenCalledTimes(1)` assertion is present character-for-character; two assertions were added after it, strictly additive.
2. **The `retrying`-stranding risk.** Real, investigated in depth, judged acceptable to ship with a concrete required follow-up (schema addition + bulk-sweep staleness reset) rather than left open-ended. See "My position" above.
3. **`sendEmail()` byte-identical after extraction.** Confirmed by reading the extracted predicate against the original inline logic line by line — De Morgan-equivalent restructuring, `extractAddress()` behaviorally identical, `_bulkMemberSend`/`opts.bulk` term preserved, `NODE_ENV` check preserved, allowlist parsing/trimming/case preserved. `email-guardrail.test.ts` passes completely untouched (empty `git diff`).
4. **The "1 pre-existing test adjusted, not weakened."** Found and read before/after: one `vi.stubEnv(EMAIL_DEV_ALLOWLIST, ...)` line added so the test stays isolated to the missing-key branch it's named for, now that the guard runs earlier in the code. Every original assertion is untouched. Honest characterization, confirmed.
5. **Ordering.** Confirmed in both `sendEmail()` and `settleClaim()`: the guard runs before the missing-key check in both places, read top-to-bottom, not inferred from test order. A blocked retry is counted in neither `succeeded` nor `failed` (`countsAsFailed: false`), confirmed by reading `settleClaim()`'s return value and both callers' accounting.
6. **Re-ran the concurrency proof myself, for both targeted and bulk.** Did more than re-run the existing tests: ran three separate sabotage experiments against the real `route.ts` (not the mocks) to independently establish that the atomic claim is both necessary and sufficient, and surfaced a real (non-blocking) nuance in the targeted test's own rigor that the bulk test's sibling coverage compensates for. Restored the file byte-identical after each experiment and reconfirmed the full suite green.

### Regression Tests Added

None added this pass. Verified the rework's 7 new/strengthened tests are honest by reading them in full and by running my own three independent sabotage experiments against the real code, rather than re-running the suite as a black box.

### Coverage on Critical Modules

Not applicable in the `events.ts`/`permissions.ts`/`members.ts` sense. For the files this rework changed: `claimFailedRow()`, `settleClaim()`, and `shouldBlockNonProductionSend()` each have dedicated tests for every stated branch (claim win/loss, claim-then-throws, guard block/allow/distribution-list/production-bypass, both targeted and bulk paths) — the one branch with no test and no way to add one without new infrastructure is the hard-process-death stranding case, which is exactly the risk flagged above.

### Feature-Gate Audit (mandatory before PASS)

No new route or server action. `POST /api/admin/email-queue/retry`'s gate is unchanged by this rework.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `POST /api/admin/email-queue/retry` (targeted + bulk, unchanged by this rework) | yes | yes (`FEATURES.ADMIN_USERS`) | Same pre-existing key, same non-blocking breadth note carried forward from every prior pass in this work-log, not reopened here. |

### Verdict: PASS

### Open questions / handoff notes

- **For `tech-lead`, new and required, not carried-forward boilerplate:** design a small follow-up to close the `retrying`-stranding gap — a `retryingAt` timestamp column plus a staleness reset folded into `handleBulkRetry()`'s existing eligibility query (`status='retrying' AND retryingAt < now() - interval '<n> minutes'` → reset to `failed`). No new cron infrastructure needed; this piggybacks on the button that already exists. Recommend prioritizing this before the per-message retry button sees wide admin use, given the project's history with exactly this "silently invisible" failure shape.
- **For the record, not a blocker:** the "targeted" concurrency regression test has an incidental redundant guard from the test mock's shared-object timing that would mask a hypothetical future regression limited to only `claimFailedRow`'s WHERE clause — the sibling "bulk" test in the same file has no such redundancy and would catch it. Worth knowing if either test is ever refactored in isolation.
- **Still open, unrelated to this rework, carried forward unchanged:** the 98 historically mis-recorded production `sent` rows (human/data decision), the still-uninvestigated root cause of `RESEND_API_KEY` going missing in Vercel Production around 2026-08-28, and the missing Phase 1–3 write-up for the per-message retry feature itself (worth backfilling now that the rework is green).
- **Handoff:** `analyst` for Phase 6 shipped-vs-intent, once the missing Phase 1–3 write-up is backfilled or explicitly waived — the pipeline gap noted earlier in this file is still open and should be resolved one way or the other before Phase 6 closes it out.
