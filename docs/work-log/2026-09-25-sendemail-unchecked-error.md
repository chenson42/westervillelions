# sendEmail() discards Resend's `{ error }` response — silent send failures on the primary path — Work Log

> **Slug:** `2026-09-25-sendemail-unchecked-error`
> **Surface:** mixed (server-side email infrastructure, used by every outbound-mail feature)
> **Permission(s):** none — infrastructure bug, no new permission surface
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

**Backlog:** B-65, high priority. Root cause of the 2026-08-28 → 2026-09-25 production email outage. This is the unfinished half of `docs/work-log/2026-09-25-email-silent-success.md`, whose retry-route fix (`attemptSend()` in `src/app/api/admin/email-queue/retry/route.ts`) documented but deliberately left `sendEmail()`'s own primary send loop unfixed ("tracked separately, intentionally NOT fixed here").

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | (brief, inline — skipped, see below) | Skipped | N/A | 2026-09-25 |
| 2 — Architectural review | (skipped, see below) | Skipped | N/A | 2026-09-25 |
| 3 — Technical design | (skipped, see below) | Skipped | N/A | 2026-09-25 |
| 4 — Implementation | api-developer | Complete | — | 2026-09-25 |
| 5 — Verification | qa | Complete | PASS | 2026-09-25 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-09-25 |

**Skipped-phase notation (CLAUDE.md forbids silent skips):**
- **Phase 1 (analyst):** Skipped. This bug was already fully diagnosed and scoped by the task brief itself, which cited exact production evidence (98 rows, all `sent`, zero retries, vs. Resend's 1 actual send) and named the reference implementation to follow. No functional ambiguity to refine.
- **Phase 2 (architect):** Skipped. No new directory, dependency, or structural change — a bug fix confined to one existing function's internal control flow. Does not touch the `EmailAttachment`/`SendEmailOptions`/`SendEmailResult` public shapes.
- **Phase 3 (tech-lead):** Skipped. The design already exists and is QA-verified: `attemptSend()` in `src/app/api/admin/email-queue/retry/route.ts` (fixed the same week for the identical defect). This fix mirrors that shape rather than inventing a second convention.

---

## Root Cause

`src/lib/email.ts`'s `sendEmail()` primary send loop called:

```js
await resend.emails.send({ from, to: [to], subject, html, ... });
```

and discarded the return value. Resend's SDK (v6, `"resend": "^6.16.0"`) resolves `{ data, error }` and does **not throw** on an API-level rejection (invalid/revoked key, unverified sending domain, exceeded quota, suppressed recipient, malformed payload). Only a network/transport failure throws. So an API-level rejection fell straight through the `try` block into the "success" write: `status: 'sent'`, `attempts: 1`, no retry, `return { success: true }`.

**Production evidence (from the task brief, already captured before this work started):** the club's Resend key was revoked ~2026-08-28. Over the following month, `email_queue` recorded 98 rows over 90 days — every one `sent`, `attempts: 1`, `last_error` empty, zero `failed`, zero retries — while Resend's own dashboard showed 1 actual send in its 30-day window. ~34 real messages (proposal notifications, dues reminders, contact-form replies, donor acknowledgments, reimbursement requests) were silently discarded while the app reported success for every one.

## Reproduction

1. Configure a valid-looking but revoked/invalid `RESEND_API_KEY` (or any condition where Resend responds with a 4xx/5xx body rather than a network failure — the SDK never throws for these).
2. Call `sendEmail({ to, from, subject, html })` in production mode.
3. **Pre-fix:** `resend.emails.send()` resolves `{ data: null, error: {...} }`; the code never inspects it; the row is written `status: 'sent'`, `sendEmail()` returns `{ success: true }`. No retry occurs, `email_queue.last_error` stays empty.
4. **Post-fix:** the same call now inspects `result.error`, writes `status: 'failed'` with the real error message, retries transient errors up to `MAX_ATTEMPTS`, and returns `{ success: false, error }`.

Captured as an automated regression in `src/lib/email-send-error-handling.test.ts` — see Phase 4 below for confirmation that these tests fail against the pre-fix code and pass against the fix.

---

# Phase 4 — Implementation (API) — 2026-09-25

**Owner:** api-developer
**Status:** complete

### Summary

Fixed `sendEmail()`'s primary send loop in `src/lib/email.ts` to inspect Resend SDK v6's resolved `{ data, error }` response instead of assuming a resolved promise means success. A non-null `error` is now treated as a failed attempt exactly like a thrown exception: it consumes a retry attempt, and after exhausting retries (or immediately, for an error classified as permanent) the row lands `status: 'failed'` with the real error message and `sendEmail()` returns `{ success: false, error }`. The missing-key branch (fixed last week) and the deny-by-default non-production guard (`shouldBlockNonProductionSend()`) are untouched and still run in the same order, before this code path is ever reached.

### What I did

- Read `src/app/api/admin/email-queue/retry/route.ts`'s `attemptSend()` (the reference implementation, fixed last week for the identical defect) and mirrored its shape: check `result.error`, extract `result.error.message`, treat presence of a non-null `error` the same as a thrown exception.
- Added error classification using Resend's `RESEND_ERROR_CODE_KEY` enum (read from the SDK's `.d.mts` type definitions, `node_modules/.pnpm/resend@6.16.0/node_modules/resend/dist/index.d.mts`): a blacklist of codes that will fail identically on every attempt (`invalid_api_key`, `invalid_from_address`, `validation_error`, `missing_required_field`, etc.) stops the retry loop after one attempt instead of burning all `MAX_ATTEMPTS`. Everything not on that blacklist — including a genuinely transient `rate_limit_exceeded`, and any error code the SDK adds after this list was written — is treated as retryable, on the theory that guessing a *new* code is permanent risks giving up on something that would have succeeded a moment later, while guessing a known-permanent code is retryable only costs a little time.
- Changed `attempts` in the final `failed` write from a hardcoded `MAX_ATTEMPTS` to the actual number of attempts made (`attemptsMade`), so a permanent error caught on attempt 1 doesn't misreport itself as three attempts.
- Used `result?.error` (optional chaining) rather than `result.error` — this matters for the existing test suite: several pre-existing tests in `email-guardrail.test.ts` call `sendMock.mockReset()` without a `mockResolvedValue`, relying on the mock's default `undefined` resolution to stand in for "a send happened." A bare `result.error` would throw a `TypeError` on `undefined`, get caught by the generic `catch` block, and silently retry 3 times before failing — breaking those guardrail tests without touching their assertions. `result?.error` keeps `undefined`/missing responses on the success path, matching real Resend SDK behavior (a resolved `Response<T>` always has `data` or `error`, never neither) while staying compatible with the existing mock shape.
- Left the missing-key branch, `shouldBlockNonProductionSend()` guard, `sendBulkMemberEmail()`, and all public types (`SendEmailOptions`, `SendEmailResult`, `EmailAttachment`) untouched.
- Wrote `src/lib/email-send-error-handling.test.ts` (7 new tests) covering every case named in the task brief.

### Call-site audit

Audited every non-test `sendEmail()` call site (grep across `src/`):

| Call site | Behavior with `success: false` |
|---|---|
| `src/app/api/contact/route.ts`, `src/app/api/auth/forgot-password/route.ts`, `src/app/api/suggestions/route.ts`, `src/app/api/membership-applications/route.ts`, `src/app/api/admin/ledger/reimbursements/[id]/route.ts`, `src/app/api/admin/social-requests/[id]/decide/route.ts`, `src/app/api/admin/proposals/[id]/decide/route.ts`, `src/app/api/members/social-requests/[id]/submit/route.ts`, `src/app/api/members/proposals/[id]/submit/route.ts`, `src/lib/members.ts`, `src/lib/auth/index.ts` | All call `await sendEmail({...})` and discard the return value entirely (no `.success`/`.error` read). Unaffected: these callers never distinguished true/false before (the DB write they care about already committed), and still don't. `success: false` was already reachable at these call sites via the missing-key-in-production branch shipped last week, so this is not a new code path for them, just a new *trigger* for an already-handled shape. **None roll back a committed DB write on email failure** — verified by reading each route; the pattern is "commit the record, then best-effort notify," consistent with the deny-by-default invariant's design. |
| `src/app/api/admin/ledger/acknowledgments/letters/email/route.ts` → `emailAcknowledgmentLetters()` in `src/lib/ledger-acknowledgment-letter-queries.ts` | **Designed for `success: false`.** The atomic claim (`UPDATE ledger_acknowledgments SET sent_at = now(), sent_via = 'email' WHERE sent_at IS NULL RETURNING id`) runs before any send; if every address for a claimed acknowledgment fails, the claim is explicitly reverted. This is the exact mechanism CLAUDE.md cites by name. This fix makes `success: false` actually reachable from an API-level Resend rejection for the first time — previously that class of failure would have falsely reported `success: true` and the claim would have wrongly stuck as "sent." Verified by reading `emailAcknowledgmentLetters()`: it reads `sendResult.success` from `sendBulkMemberEmail()`'s per-recipient results and only keeps the claim if `anySucceeded`. No change needed here — the fix makes existing, already-correct logic finally fire as designed. |
| `src/app/api/admin/events/[id]/announce/route.ts` (per-recipient `event_announcements` rows, DECISION-093) | Already reads `result?.success ?? false` and `result?.error ?? null` per recipient via `sendBulkMemberEmail()`, and writes one row per attempted recipient regardless of outcome ("success and failure alike"). No behavior change needed — a real Resend rejection will now correctly populate `success: false` and a real `error` string instead of a false `success: true`. |
| `src/app/api/admin/dues/reminders/route.ts` | Same pattern as the announce route: `result?.success ?? false`, `result?.error ?? null`, already built to handle failure per-recipient via `sendBulkMemberEmail()`. No change needed. |
| `src/app/api/admin/minutes/[id]/email/route.ts` | Passes `sendEmail()`'s own `{ success, error? }` straight through as the HTTP 200 response body (per its own doc comment). Already designed for `success: false`; a caller checking that field now gets an honest answer instead of always `true`. |
| `src/lib/financial-report-send.ts` (concurrent work, out of scope — read only, not modified) | Reads `sendResult.success` / `sendResult.error` and returns `{ ok: false, reason: "send_failed", detail: ... }` on failure. Already correctly shaped for this fix; not touched. |
| `src/app/api/admin/ledger/transactions/route.ts` | Uses `sendBulkMemberEmail()`, not raw `sendEmail()`, for the treasury-approval-notification loop (DECISION-085/086) — same per-recipient result handling as the announce/dues-reminder routes. No change needed. |

**Conclusion: no call site behaves worse.** Every site that actively branches on `success`/`error` was already built to handle `false` (from the missing-key-in-production branch shipped last week); this fix only makes that value honest for a wider class of real Resend rejections. Every site that discards the return value continues to discard it, unaffected either way.

### Retry route / `sendEmail()` shared-helper assessment

**They should share a helper, and I did not extract one — flagging per CLAUDE.md's duplication rule rather than doing it inline, since the retry route is explicitly out of my scope for this task** (per the task's "working tree note": my files are `src/lib/email.ts`, its tests, and this work-log; a concurrent agent is mid-flight on ledger-reports/financial-report-send files, and touching the retry route risks an unrelated collision).

What's duplicated right now, after this fix:
- The `if (result.error) { ... extract message ... }` check itself — same shape, two places (`sendEmail()`'s loop, `attemptSend()` in the retry route).
- The Resend-`Response<T>`-is-not-throwing doc comment — now copy-pasted (with variations) in both files.

What is **not** duplicated and shouldn't be merged: the two call sites diverge in real ways — `sendEmail()` persists a *new* queue row, runs `shouldBlockNonProductionSend()` inline, and retries in-process with `sleep()`; the retry route re-sends an *existing* row's persisted fields, runs the same guard via the shared `shouldBlockNonProductionSend()` predicate (already extracted to `src/lib/email-guard.ts` for exactly this reason), and has its own claim/settle state machine. A full merge would be the wrong shape.

**Recommended shared helper (follow-up, not done here):** a small `attemptResendSend(resend: Resend, params: {from, to, subject, html, replyTo?, cc?, bcc?, attachments?}): Promise<{success: true} | {success: false, error: string, retryable: boolean}>` in a new or existing shared module (e.g. `src/lib/email-guard.ts` or a new `src/lib/resend-send.ts`), used by both `sendEmail()`'s loop and the retry route's `attemptSend()`. This would consolidate: the `try`/`catch`-plus-`result.error` check, the error-message extraction, and (new, from this fix) the permanent-vs-retryable classification, which the retry route does not currently have at all — it treats every failure as retryable-by-admin-click, which is fine for a human-initiated single retry but means this fix's classification logic is not yet DRY between the two call sites. I did not implement this because it touches a file outside my assigned scope for this task; recommend a small follow-up ticket.

### Outputs

- **Modified:** `src/lib/email.ts` — `sendEmail()`'s primary send loop (~lines 49–90, 172–246 post-fix). No signature change to `sendEmail()`, `sendBulkMemberEmail()`, `SendEmailOptions`, `SendEmailResult`, or `EmailAttachment`. New internal-only additions: `PERMANENT_RESEND_ERROR_CODES` (a `Set<string>`) and `isRetryableResendError()` (not exported).
- **Created:** `src/lib/email-send-error-handling.test.ts` — 7 new tests:
  1. A permanent API error (`invalid_api_key`) lands `failed` with the real message, returns `success: false`, never `sent`.
  2. A permanent error fails fast on attempt 1 (doesn't burn all 3 attempts).
  3. A retryable error (`rate_limit_exceeded`) retries to `MAX_ATTEMPTS`, then lands `failed`.
  4. A retryable error that succeeds on attempt 2 lands `sent` with `attempts: 2`.
  5. `{ data, error: null }` still lands `sent` — no regression on the happy path.
  6. A thrown exception still retries `MAX_ATTEMPTS` times and lands `failed` — unchanged behavior.
  7. An error code the SDK hasn't been told about yet is treated as retryable, not guessed as permanent.
- **No schema changes.** No migration.
- **No new permission surface.**

### Verification performed

- **Pre-fix failure evidence:** stashed `src/lib/email.ts` back to its pre-fix state and ran the new test file against it — 5 of 7 tests failed (the 2 that passed pre-fix are the happy-path "error: null" case and the thrown-exception case, both of which were already correct; the fix doesn't touch those paths). Confirms the tests actually exercise the defect. Re-applied the fix (`git stash pop`) afterward — `src/lib/email.ts` verified unchanged from the fixed version.
- `pnpm exec tsc --noEmit`: **PASS**, no errors.
- `pnpm lint`: 1 pre-existing error, in `src/components/admin/ledger/financial-report-send-panel.tsx` (`react/no-unescaped-entities`) — a file owned by the concurrent ux-developer agent's in-flight ledger-reports work, not touched by this fix. No lint errors in any file this task modified.
- `pnpm test`: **2151 passed, 0 failed** (baseline was 2130; +21 new — 7 from this fix's new file, the remainder from the concurrent financial-report-send work already in the working tree).
- `pnpm build:only`: **skipped**, per the task's instruction — the concurrent ledger-reports UI agent is actively modifying files in the same working tree, which could make a build run unreliable/non-attributable. qa should re-run it once that work lands or in isolation.

### Open questions / handoff notes

- **Next agent: qa.** Please re-run `pnpm build:only` once the concurrent financial-report/ledger-reports work has landed or been isolated — I skipped it per the task's explicit instruction, not because of a failure I saw.
- **Recommended follow-up (not filed as a numbered backlog item — deferring that to whoever triages this work-log):** extract a shared `attemptResendSend()` helper used by both `sendEmail()` and the retry route's `attemptSend()`, per the "duplication is a correctness defect" section of CLAUDE.md. Two copies of "check `result.error`, don't trust a resolved promise" is exactly the shape that rule targets. Also worth folding the new permanent-vs-retryable classification into the retry route at the same time, since it currently treats every failure as equally retryable-by-click (acceptable for a human-initiated single retry today, but would benefit from the same signal).
- **No production/database action taken.** No commit, no push, no real send attempted, `EMAIL_DEV_ALLOWLIST` untouched, per the task's explicit constraints.

---

## Phase 5 — Verification — 2026-09-25

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** The crux is verified: a Resend API-level rejection (a resolved `{ error }`, not a throw) now lands `email_queue.status = 'failed'` with the real error message and `sendEmail()` returns `{ success: false }` — it never lands `sent`. This was independently confirmed by stashing `src/lib/email.ts` back to its pre-fix state and re-running the new test file against it: 5 of 7 tests failed for exactly the claimed reason (`result.success` wrongly `true`, `sendMock` invoked once instead of the expected retry count), then passed again after restoring the fix. Error classification, `attempts` accounting, guard ordering, and every audited call site check out. One stale doc comment found (non-blocking, noted below).

### What I did

1. **Reproduced the pre-fix failure independently.** `git stash push -- src/lib/email.ts`, ran `pnpm exec vitest run src/lib/email-send-error-handling.test.ts` against the stashed (pre-fix) code: **5 of 7 failed** — matching the implementer's claim exactly, and for the right reason (`expected true to be false` on `result.success`, `sendMock` called once instead of 2-3 times). `git stash pop` restored the fix; confirmed `git diff --stat` matched the pre-stash diff exactly (no drift introduced by the stash round-trip).
2. **Verified the error-code list against ground truth, not the implementer's claim.** Read `RESEND_ERROR_CODE_KEY` directly from `node_modules/.pnpm/resend@6.16.0/node_modules/resend/dist/index.d.mts:121` — the SDK's actual 21-code union. `PERMANENT_RESEND_ERROR_CODES` in `src/lib/email.ts` contains 15 of them (`invalid_idempotency_key`, `validation_error`, `missing_api_key`, `restricted_api_key`, `invalid_api_key`, `not_found`, `method_not_allowed`, `invalid_idempotent_request`, `invalid_attachment`, `invalid_from_address`, `invalid_access`, `invalid_parameter`, `invalid_region`, `missing_required_field`, `security_error`) — every one a genuinely non-transient condition. The 6 excluded (treated retryable): `concurrent_idempotent_requests`, `monthly_quota_exceeded`, `daily_quota_exceeded`, `rate_limit_exceeded`, `application_error`, `internal_server_error` — all defensible as retryable (rate/quota conditions can clear; `application_error`/`internal_server_error` are Resend-side and may be transient). `isRetryableResendError()` returns `true` for `undefined` and for any code not in the set, so a future SDK-added code takes the retry path as designed. Confirmed via the dedicated test (`"an unrecognized error code... is treated as retryable"` — passes).
3. **Confirmed guard ordering is untouched.** `git diff --stat` shows only `src/lib/email.ts` changed; `src/lib/email-guard.ts` and `src/app/api/admin/email-queue/retry/route.ts` have zero diff. `shouldBlockNonProductionSend()` still runs first in `sendEmail()`, before the missing-key branch, before the send loop — same as before this fix (confirmed by reading the surrounding, unmodified code, not just the diff hunk).
4. **Ran the DECISION-085 guardrail tests unmodified.** `git diff --stat src/lib/email-guardrail.test.ts` — empty (no diff). `pnpm exec vitest run src/lib/email-guardrail.test.ts` — **17/17 passed** against the fixed `email.ts`.
5. **Confirmed `attempts` accounting.** Test 2 (`invalid_from_address`, permanent) asserts `sendMock` called once and `attempts: 1` in the final `failed` write — passes. Test 3 (`rate_limit_exceeded`, retryable) asserts 3 calls and `attempts: 3` — passes. Read the source: `attemptsMade` is set inside the loop on every iteration and used (not `MAX_ATTEMPTS`) in the final failed-write — confirmed by reading the diff directly, not inferring from tests alone.
6. **Independently audited the two highest-stakes call sites** named in the task, by reading the actual current source (not trusting the work-log's own audit table):
   - `src/lib/ledger-acknowledgment-letter-queries.ts` (lines ~580–617): reads `sendResult.success` per address, computes `anySucceeded`, and **only** reverts the atomic claim (`sentAt: null, sentVia: null`, guarded by `sentVia = 'email'`) when every address failed. This is exactly the mechanism CLAUDE.md cites — and this fix is what makes it fire correctly for a real Resend rejection for the first time (previously `sendResult.success` was always `true`, so the claim could never legitimately revert).
   - `src/app/api/admin/events/[id]/announce/route.ts` (lines ~286–330): writes one `event_announcements` row per attempted recipient via `sendBulkMemberEmail()`'s per-recipient results (`success: result?.success ?? false`), success and failure alike (DECISION-093) — confirmed unchanged and now receiving honest `success`/`error` values.
   - No call site reads `sendEmail()`'s return and rolls back a DB write it shouldn't — every discarding call site was already discarding before this fix (the missing-key-in-production branch shipped last week already made `success: false` reachable at every site).
7. **Ran the four shared gates** (see below).
8. **Noted, did not require a fix for:** the doc comment atop `attemptSend()` in `src/app/api/admin/email-queue/retry/route.ts` still reads "`src/lib/email.ts`'s `sendEmail()` has the same unchecked-`error` bug on its primary send path — tracked separately, intentionally NOT fixed here" — this is now stale (the bug is fixed) but harmless; a doc-only cleanup, not a functional defect. Flagging for whoever next touches that file.
9. **Assessed the shared-helper recommendation.** Read both `sendEmail()`'s loop and the retry route's `attemptSend()` side by side: they are semantically equivalent today on the crux (both treat a resolved `{ error }` as a failure, never as success) but structurally different in ways that make a straight merge premature — `sendEmail()` classifies permanent-vs-retryable, `attemptSend()` treats every failure as retryable-by-click. This asymmetry is real but not a divergence in *correctness* (no path in either file can land `sent`/`success: true` on an unresolved error) — confirmed by reading both files in full, not just the named line ranges.

### Outputs

- **Verified, not modified:** `src/lib/email.ts`, `src/lib/email-guard.ts`, `src/app/api/admin/email-queue/retry/route.ts`, `src/lib/ledger-acknowledgment-letter-queries.ts`, `src/app/api/admin/events/[id]/announce/route.ts`.
- **Verification artifacts (not committed to the repo):** a scratch reproduction test used to independently confirm the `sendEmail()` / `BOARD_EMAIL` interaction relevant to Piece B — see Piece B's Phase 5 section in `docs/work-log/2026-09-25-financial-report-auto-send.md`; no files added to this feature's own tree beyond the implementer's.
- **Decisions logged:** none new — this fix does not touch `docs/decisions.md`.

### Gates (shared with Piece B — run once, apply to both)

- `pnpm exec tsc --noEmit`: **PASS** — no errors.
- `pnpm lint`: **PASS** — 0 errors, 1 pre-existing unrelated warning (`react-hooks/exhaustive-deps` in `src/components/admin/ledger/budget-context-panel.tsx`, untouched by either piece).
- `pnpm test`: **PASS** — 2151/2151 passed, 124 test files, ~4s.
- `pnpm build:only`: **PASS** — compiled successfully; `/api/admin/ledger/reports/send` present as a dynamic route in the manifest, no build warnings beyond the pre-existing lint warning.

### Regression Tests Added

- All 7 tests in `src/lib/email-send-error-handling.test.ts` are regression tests for this exact defect — see that file's own docblock. Independently confirmed 5/7 fail pre-fix (see above); none were written by qa (the implementer delivered these per the Phase 4 gate), but qa independently re-verified the fail-then-pass discipline rather than trusting the claim.

### Feature-Gate Audit

No protected routes or server actions touched by this fix. `sendEmail()` is infrastructure with no permission surface of its own; every caller's existing `auth()`/`hasFeature()` gate is unchanged.

### Verdict: PASS

### Open questions / handoff notes

- **Next agent: analyst**, for Phase 6 shipped-vs-intent, on both pieces.
- Stale doc comment in `src/app/api/admin/email-queue/retry/route.ts`'s `attemptSend()` docblock (says the `sendEmail()` bug is "intentionally NOT fixed here") should be updated in a future small pass — not a functional issue, just now-inaccurate documentation.
- The shared `attemptResendSend()` helper extraction the implementer recommended is a legitimate follow-up per CLAUDE.md's duplication rule, but not a blocker — the two call sites are correct today, just not DRY on their (non-identical) classification logic.

---

## Phase 4 — Implementation (API) — Follow-up fix — 2026-09-25

**Owner:** api-developer
**Status:** complete

### Summary

Corrected the stale doc comment QA flagged in `attemptSend()` (`src/app/api/admin/email-queue/retry/route.ts`),
which still asserted `sendEmail()`'s unchecked-`error` bug was "intentionally NOT fixed here" —
that was true before this work-log's Phase 4, but B-65 fixed it. Also added an explicit two-way
pointer between `attemptSend()`'s check and `sendEmail()`'s equivalent check in `src/lib/email.ts`,
so a future edit to either one's error-handling shape is obviously meant to prompt a look at the
other, per this work-log's own recommendation and CLAUDE.md's duplication-is-a-correctness-defect
rule. Did not extract the shared `attemptResendSend()` helper — confirmed still a follow-up, not
done in this pass, per the task's explicit instruction.

### What I did

- Reworded `attemptSend()`'s docblock: replaced "tracked separately, intentionally NOT fixed here
  (out of scope for this route)" with an accurate statement that `sendEmail()`'s equivalent bug
  **was** fixed (citing this file's own root-cause section) and mirrors this function's shape, plus
  an explicit note that the two checks are semantically equivalent but not yet extracted into one
  helper, with a pointer to "check the other file if you change this one."
- Added the same kind of pointer to `sendEmail()`'s own `result?.error` check in `src/lib/email.ts`
  (it already named `attemptSend()` as "the reference shape this mirrors" — tightened that comment
  to also say the two checks aren't extracted yet and should be kept in sync).
- **Verified semantic equivalence directly**, not just via the existing docs: both functions treat
  a resolved `{ error }` from `resend.emails.send()` as a failure, extract `error.message ?? String(error)`,
  and never let a resolved-but-erroring promise fall through to a "sent"/"success" write. The real
  difference — `sendEmail()` classifies permanent-vs-retryable Resend error codes and
  `attemptSend()` does not (every failure there is retryable-by-admin-click) — is a genuine,
  intentional divergence documented in both places, not an inconsistency needing to be resolved
  here.
- Did not extract `attemptResendSend()` — out of scope for this small fix per the task; left as a
  named, tracked follow-up (see Outputs / Open questions below), now with the two-way pointer in
  place so it can't silently drift further apart in the meantime.

### Verification performed

- `pnpm exec tsc --noEmit`: **PASS**.
- `pnpm lint`: **PASS**, 0 errors (1 pre-existing unrelated warning, see the sibling work-log's
  Phase 4 follow-up section).
- `pnpm test`: **2154 passed** (this comment-only change added no tests of its own; the count
  reflects the 3 new tests added in the sibling `financial-report-send` follow-up fix landed in
  the same pass — see that work-log).
- `pnpm build:only`: **PASS**.
- `git diff --stat src/app/api/admin/email-queue/retry/route.ts src/lib/email.ts` — confirms only
  doc comments changed in both files; no logic, no exported shape, no test-relevant behavior
  touched.

### Outputs

- **Modified:** `src/app/api/admin/email-queue/retry/route.ts` (doc comment only, atop
  `attemptSend()`), `src/lib/email.ts` (doc comment only, inside `sendEmail()`'s send loop).
- **No schema changes, no new tests needed** (comment-only change), **no permission change.**
- **No commit, no push, no database write, no real send attempted**, per the task's explicit
  constraints.

### Open questions / handoff notes

- **Follow-up still open, still not implemented:** extract a shared `attemptResendSend()` helper
  used by both `sendEmail()`'s loop and `attemptSend()` in the retry route, folding in the
  permanent-vs-retryable classification that `attemptSend()` currently lacks. This is a legitimate
  CLAUDE.md duplication-rule finding (same decision — "a resolved `{error}` means failure" —
  implemented in two places), not a blocker. The two-way doc-comment pointers added in this pass
  are meant to keep the two in sync until that extraction happens, not a substitute for it.
- **Next agent:** qa, to confirm the comment now reads accurately and doesn't need anything
  further; then analyst for Phase 6 on the combined work.

---

## Phase 6 — Shipped vs Intent — 2026-09-25

**Owner:** analyst
**Status:** complete

### VERDICT

SHIP WITH NOTES

### ONE-LINE TAKE

`sendEmail()` now tells the truth about whether Resend accepted the message — a revoked key or any other API-level rejection lands `status: 'failed'` with a real error on attempt one, instead of a false `'sent'` for 90 days — and the one thing still open (a shared helper between this fix and the retry route's twin) is a DRY follow-up, not a correctness gap.

### Q1 — Would the original outage now be caught? (traced, not summarized)

1. The club's Resend key is revoked. The next `sendEmail()` call proceeds past the queue insert and the non-production/missing-key guards (key is present, just invalid) into the send loop.
2. `resend.emails.send()` resolves — does not throw — with `{ data: null, error: { name: "invalid_api_key" or "restricted_api_key", message: "..." } }`.
3. `result?.error` is truthy. `isRetryableResendError("invalid_api_key")` returns `false` — `invalid_api_key` is in `PERMANENT_RESEND_ERROR_CODES` (`src/lib/email.ts:96`). The loop `break`s after exactly one attempt rather than burning all three.
4. The row is written: `status: 'failed'`, `lastError: <Resend's real message>`, `attempts: 1`, `nextRetryAt: now + 15min`. `sendEmail()` returns `{ success: false, error, emailQueueId }`.
5. **What the admin sees, and when:** every caller in the call-site audit either discards this return value (11 sites — unchanged, they never branched on it) or was already built to handle `false` (the acknowledgment-letter claim, the per-recipient announce/dues-reminder rows) — so nothing downstream misbehaves. Independently of any caller, the very next time *any* admin holding `ADMIN_USERS` loads *any* `/admin/*` page, `getFailedEmailCount()` (wired into `src/app/(dashboard)/admin/layout.tsx:47`, rendered as a badge on the Email Queue nav item in `src/components/admin/admin-sidebar.tsx`) picks up the new `failed` row and shows a nonzero count. This badge shipped in the same work today specifically because of this incident.
6. **Time to detection is now bounded by "next admin dashboard visit," not "next time someone happens to compare Resend's dashboard to `email_queue` by hand."** For an admin who opens the dashboard daily (plausible for a club treasurer/board admin doing routine work), that's same-day detection of a total mail outage, versus the actual 2026-08-28 → 2026-09-25 gap. It is not instantaneous (there's still no push notification, no cron, no external alert — confirmed no cron exists in this project), and a failed row still requires a manual bulk or targeted retry click to resolve — but the false-"sent" lie that let 34 messages vanish with zero signal is closed. **Yes, this specific incident is now caught**, and caught fast relative to the 90 days it went unnoticed before.

### Q2 — Is "retry the unknown" the right default?

Yes, and it's worth being precise about what this choice actually controls, because the task framing overstates its stakes. Classification (`PERMANENT_RESEND_ERROR_CODES`) only decides whether a doomed request burns 1 attempt or 3 before landing at the same terminal state — `status: 'failed'`, real error message, `success: false`. **Neither branch of this decision can reproduce the incident**, because the incident's actual defect (a resolved `{ error }` being treated as success) is fixed upstream of the classification check, unconditionally. So the real tradeoff is operational, not correctness: guessing "permanent" on a genuinely-transient new error code costs a false `failed` status an admin has to manually retry (recoverable, just slower); guessing "retryable" on a genuinely-permanent new error code costs ~1 second of wasted latency and two pointless Resend calls before landing at the identical `failed` state. Given this project has no cron and depends entirely on a human clicking retry, defaulting new/unknown codes to retryable is the cheaper mistake to make by far — it self-heals inside the same request for the transient case and only trivially delays the correct terminal state for the permanent case. Endorsed as written.

### Q3 — Is the duplication a real risk, and is deferring it acceptable?

It's two places, not three (`sendEmail()`'s loop and `attemptSend()` in the retry route) — I did not find a third literal reimplementation of the `result.error` check anywhere else in `src/` (grepped every `resend.emails.send()` call site; the only other reference is a doc-comment pointer in `email-guard.ts`, not code). If "three-way" refers instead to the three same-shaped false-success bugs found today across the codebase (this one, the missing-key branch, the financial-report blocked-send claim), that's a different, and more serious, finding — see the systemic-finding section below, not this one.

On the two-place duplication itself: it is a real but now well-contained risk, not a blocker. Both copies currently agree on the crux ("a resolved `error` is a failure, never success") and now carry hand-written, two-way pointer comments telling a future editor of either one to check the other — that's better than the silent copy-paste CLAUDE.md's duplication section warns about, but it is still "protected by someone remembering," which is exactly the shape of protection that let the *retry-route* half of this same bug survive uncaught for a week after the primary path was supposedly the only one left ("intentionally NOT fixed here" — stale until this work-log's own follow-up corrected it). Deferring the extraction is acceptable for this ship — it does not block Phase 6 — but it should not be left as an unfiled recommendation. I've opened it as **B-68** in `docs/backlog.md` so it has a stable ID and doesn't quietly disappear the way the retry route's own "tracked separately" note nearly did.

### What's Working

- The fail-then-pass discipline is genuinely followed, not asserted: both the implementer and QA independently stashed `email.ts` back to its pre-fix state and confirmed the new tests fail for the *claimed* reason (`result.success` wrongly `true`, wrong call count), then pass again restored — this is exactly the evidence a "trust but verify" review should look for, and it's here twice, from two different agents.
- The error-code classification was checked against ground truth, not the implementer's say-so: QA read `RESEND_ERROR_CODE_KEY` directly from the installed SDK's `.d.mts` file and confirmed all 15 codes in `PERMANENT_RESEND_ERROR_CODES` are genuinely non-transient and the 6 excluded ones are genuinely defensible as retryable.
- The call-site audit is complete and specific — every non-test `sendEmail()` caller is individually named with a stated reason it either doesn't care or was already built for `false`, rather than a blanket "should be fine."

### Intent-vs-Shipped Diff

- Phase 1 said: (skipped — the bug was fully diagnosed by the task brief itself, citing exact production evidence). Shipped: a fix matching the brief's own reference implementation (`attemptSend()`) plus a permanent/retryable classification layer the brief didn't explicitly ask for but which follows directly from "don't burn retries on a hopeless request." Verdict: matches, with a reasonable, justified addition.
- Brief implied "mirror the retry route's fix." Shipped: mirrors it on the crux, diverges intentionally on classification (present here, absent there), documented in both places as a deliberate difference, not an oversight. Verdict: acceptable drift.

### Edge Cases

- Empty state: not applicable (infrastructure fix, no UI surface).
- Failure microcopy: pass — `lastError` now carries Resend's real message (e.g., an actual `invalid_api_key` description) instead of nothing; visible at `/admin/email-queue` and via the nav badge.
- Permission gate: not applicable — no new permission surface; every caller's existing gate is unchanged (confirmed by QA's feature-gate audit).
- Mobile: not applicable.

### Follow-Ups (SHIP WITH NOTES)

- **B-68** (filed in `docs/backlog.md`): extract a shared `attemptResendSend()` helper for `sendEmail()` and the retry route's `attemptSend()`, folding in the permanent/retryable classification for both. Not blocking — both paths are independently correct today.
- Stale doc-comment risk: already caught once (QA flagged, implementer fixed same day) — no further action needed here, but it's the concrete illustration of why B-68 shouldn't sit indefinitely as a comment-only mitigation.
- Housekeeping (done as part of this review): `docs/backlog.md`'s B-65 entry marked closed with a pointer to this work-log; B-68 opened for the deferred extraction.

### Systemic Finding — see the combined note in `docs/work-log/2026-09-25-financial-report-auto-send.md`'s Phase 6 section (same finding, filed once to avoid duplicating the argument across both work-logs).

### Open questions / handoff notes

- No further agent action required to close this work-log. B-68 is filed and unblocked for whoever picks it up next; it does not need to be this feature's own follow-up work-log unless the team wants to schedule it now.
