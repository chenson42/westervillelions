# Shared Resend Send-and-Classify Helper (B-68) — Work Log

> **Slug:** `2026-09-25-shared-resend-attempt`
> **Surface:** mixed (server-only: `src/lib/email.ts`, `src/app/api/admin/email-queue/retry/route.ts`)
> **Permission(s):** none — no new permission surface, pure refactor
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — see explicit phase notation below

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped (see note) | — | 2026-09-25 |
| 2 — Architectural review | architect | Skipped (see note) | — | 2026-09-25 |
| 3 — Technical design | tech-lead | Skipped (see note) | — | 2026-09-25 |
| 4 — Implementation | api-developer | Complete | — | 2026-09-25 |
| 5 — Verification | qa | Complete | PASS | 2026-09-25 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-09-25 |

**Explicit phase-skip notation (CLAUDE.md: no silent skips):** This is a backlog item (B-68)
handed directly to the implementer with a fully specified brief (problem statement, target
shape, non-negotiables, test requirements) already written into the backlog entry — equivalent
to a completed Phase 1–3 in substance, just not run as separate agent passes. Phases 1–3 are
marked skipped rather than run because:
- **Phase 1 (analyst):** the "bug" (duplicated decision logic, no behavior change intended) was
  already confirmed real by the brief itself, which names the specific two call sites and the
  incident history that makes the duplication a correctness risk, not a style question.
- **Phase 2 (architect):** no new directory, dependency, or structural pattern — one new file in
  the existing flat `src/lib/*.ts` module style, following `email-guard.ts`'s established
  precedent (pure module, no `@/lib/db` import) almost exactly. The brief itself directs where to
  look.
- **Phase 3 (tech-lead):** the brief specifies the exact shape (`attemptResendSend()`), what it
  owns and doesn't own, the non-negotiables (behavior-identical, `RESEND_ERROR_CODE_KEY`-sourced
  classification, don't move the guardrail ordering, don't touch three named files), and the test
  requirements — a design doc would restate the brief.

Per CLAUDE.md's bug-fix variant, root cause and reproduction are captured below in lieu of a
separate Phase 1–3 doc.

**Root cause / what this fixes:** `sendEmail()` (`src/lib/email.ts`) and `attemptSend()`
(`src/app/api/admin/email-queue/retry/route.ts`) each independently implemented "call
`resend.emails.send()`, inspect the resolved `{ data, error }` (the SDK does not throw on an
API-level rejection), and classify permanent vs. retryable error codes." The retry route got this
fix first; `sendEmail()` picked it up a day later, and the two were held together only by
two-way pointer comments, with no shared code. CLAUDE.md treats this as a correctness defect, not
tidiness — a future fix to one leaves the other silently wrong, which is exactly how the original
month-long silent-outbound-mail-outage bug persisted.

---

# Phase 4 — Implementation (API) — 2026-09-25

**Owner:** api-developer
**Status:** complete

## Summary

Extracted the shared "send one email via Resend and classify the outcome" step into
`attemptResendSend()` in a new pure module, `src/lib/email-send-attempt.ts`, and updated both
`sendEmail()` and the admin email-queue retry route's `attemptSend()` to call it instead of
each independently inspecting `resend.emails.send()`'s return value. No behavior changes on
either path — this is a pure refactor.

## What I did

- Created `src/lib/email-send-attempt.ts` holding:
  - `ResendSendAttemptInput` — the subset of send options both callers ever populate
    (from/to/subject/html/replyTo/cc/bcc/attachments).
  - `ResendSendAttemptResult` — `{ success: true }` or `{ success: false, error, retryable }`.
  - `PERMANENT_RESEND_ERROR_CODES` (moved verbatim from `src/lib/email.ts`) and
    `isRetryableResendError()` (moved verbatim).
  - `attemptResendSend(resend, input)` — makes exactly one `resend.emails.send()` call, returns
    `{ success: true }` on a clean resolve, or `{ success: false, error, retryable }` where
    `retryable` is `false` only for a recognized permanent code, `true` for a recognized
    transient code, an unrecognized code, or a thrown transport error.
- Rewrote `sendEmail()`'s retry loop in `src/lib/email.ts` to call `attemptResendSend()` once per
  iteration and branch on `outcome.success` / `outcome.retryable` instead of inlining the SDK call
  and the `if (result?.error)` check. Removed the now-duplicated
  `PERMANENT_RESEND_ERROR_CODES` / `isRetryableResendError` from this file.
- Rewrote `attemptSend()` in `src/app/api/admin/email-queue/retry/route.ts` to call
  `attemptResendSend()` once and translate its result into the route's existing
  `{ success: true } | { success: false, error }` shape, ignoring the `retryable` field (see
  below — this route never used a permanent/retryable distinction and still doesn't).
- Replaced both functions' two-way pointer comments ("if this changes, check whether the other
  needs the same change") with comments pointing at the shared module and explaining what it
  owns.
- Added `src/lib/email-send-attempt.test.ts` — direct unit tests of the shared helper: success,
  a recognized permanent code, a recognized transient code, an unrecognized code (must stay
  retryable), a thrown transport error (retryable), and that `replyTo`/`cc`/`bcc`/`attachments`
  are forwarded to the SDK call only when present.
- Ran `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build:only` — see Outputs.

## Outputs

**New file:**
- `src/lib/email-send-attempt.ts` — pure module (no `@/lib/db` import, mirrors
  `src/lib/email-guard.ts`'s "why a second call site exists" pattern). Exports:
  - `attemptResendSend(resend: Resend, input: ResendSendAttemptInput): Promise<ResendSendAttemptResult>`
  - Types `ResendSendAttemptInput`, `ResendSendAttemptResult`.
  - Not a route or server action — no auth/feature gate applies; it is a pure SDK-call wrapper
    consumed only by `sendEmail()` and the retry route, both of which retain their own auth,
    `hasFeature()`, and deny-by-default guard checks exactly as before (untouched).

**Files modified:**
- `src/lib/email.ts` — `sendEmail()`'s attempt loop now calls `attemptResendSend()`; removed the
  duplicated permanent-error-code set and classifier function.
- `src/app/api/admin/email-queue/retry/route.ts` — `attemptSend()` now calls
  `attemptResendSend()` and discards its `retryable` field (this route makes one attempt per
  invocation regardless of error class; see Behavioral finding below).

**New test file:**
- `src/lib/email-send-attempt.test.ts` — 6 tests, all passing.

**Where I put the helper and why:** `src/lib/email-send-attempt.ts`, a flat pure module beside
`email-guard.ts` rather than inside `src/lib/email.ts` or a new subdirectory. Reasons:
1. `src/lib/email.ts` imports `@/lib/db` (queue writes); a caller with no DB access (the retry
   route already has its own DB import for queue-row updates, but the goal per the brief was a
   module with *no* `@/lib/db` import so it stays a pure, easily-testable unit) needed a home free
   of that coupling.
2. `email-guard.ts`'s own doc comment already establishes the precedent for exactly this kind of
   extraction — "This file holds ONLY the pure predicate... so both a DB-coupled module
   (`sendEmail()`) and a route that must never re-queue a new row can share it." The same
   reasoning applies verbatim to the send-and-classify step, just for a different decision.
3. Keeping it in `src/lib/email.ts` would have left `EmailAttachment` and `attemptResendSend` in
   the same file that also owns queue writes, deny-by-default guard invocation, and
   `sendBulkMemberEmail()` — more to import for a route that wants only the classification.

## Behavioral difference found — reported, not silently resolved

**The two implementations were not equivalent before this refactor**, though the difference
never surfaced in observable behavior. `sendEmail()`'s loop used
`isRetryableResendError(result.error.name)` to decide whether to *skip remaining in-request
attempts* on a permanent error (an efficiency optimization only — a permanent error still ends
up `status: 'failed'` with `nextRetryAt` scheduled either way, identical to a retryable one that
exhausts its attempts). The retry route's `attemptSend()` had **no permanent/retryable
classification at all** — it never imported or referenced `isRetryableResendError` or the
permanent-code set, and it always makes exactly one attempt per invocation regardless of error
type, because retries in that route happen across separate admin clicks or scheduled sweep
passes, not within a single call.

Net effect on outward behavior: **none.** Because a permanent error and an exhausted-retryable
error land in the identical terminal state (`status: 'failed'`, `nextRetryAt` set, `error`
recorded) on both paths, the retry route's total absence of classification was never
observable — it just meant a permanent error there wasted no extra attempts (there were none to
waste) rather than being explicitly fast-failed. Extracting `attemptResendSend()` with a
`retryable` field that the retry route's `attemptSend()` now receives but discards preserves this
exactly: the route still makes one attempt and still always lands `failed`/`nextRetryAt`
regardless of the classification, so nothing about it changed by gaining access to information
it doesn't act on.

I did not "pick one" implementation to standardize on — I kept both call sites' actual observable
behavior bit-for-bit as it was, and surfaced the latent divergence (retry route never classified)
here rather than silently deciding it should start using it. Whether the retry route *should*
start fast-failing a permanent error (e.g., skip re-arming `nextRetryAt` and instead surface it
as terminal in the admin UI) is a product/design decision, not a refactor — flagging as a
possible follow-up, not doing it here.

## Guardrail proof (unmodified)

`git diff --stat` on the four files the brief named as must-stay-unmodified:

```
$ git diff --stat src/lib/email-guardrail.test.ts src/lib/email-no-api-key.test.ts \
    src/app/api/admin/email-queue/retry/route.test.ts src/lib/email-send-error-handling.test.ts
(empty output — zero changes)
```

All 4 files are byte-identical to their pre-change state. Ran them explicitly:

```
pnpm exec vitest run src/lib/email-send-error-handling.test.ts src/lib/email-guardrail.test.ts \
  src/lib/email-no-api-key.test.ts src/app/api/admin/email-queue/retry/route.test.ts \
  src/lib/email-durable-claim.test.ts src/lib/email-compose.test.ts src/lib/email-queue-stats.test.ts
```
Result: **7 test files, 80 tests, all passing.** This covers DECISION-085's 17 guardrail tests
(`email-guardrail.test.ts`) and the 4 no-API-key tests (`email-no-api-key.test.ts`), plus the
retry route's duplicate-send race tests, none touched.

Confirmed untouched, per the brief's explicit exclusion list:
- `src/lib/email-durable-claim.ts` — not modified.
- `src/lib/financial-report-send.ts` — not modified by me (it shows as modified in `git status`
  because a concurrent agent is actively working on it for the nav-badge task; I did not touch
  it).
- `src/lib/ledger-acknowledgment-letter-queries.ts` — not modified.

## Existing tests — none needed changing

No existing test file was edited. `src/lib/email-send-error-handling.test.ts` and
`src/app/api/admin/email-queue/retry/route.test.ts` (the two files with end-to-end coverage of
the paths I refactored) pass unmodified against the new code, which is the intended proof this
is a behavior-preserving refactor.

## Gate results

- `pnpm exec tsc --noEmit`: **PASS**, zero errors.
- `pnpm lint`: **PASS**, 0 errors (1 pre-existing warning in
  `src/components/admin/ledger/budget-context-panel.tsx`, a file I did not touch, unrelated to
  this change).
- `pnpm test`: **2195 passed, 4 failed** (baseline was 2182 passing before this work started).
  The 4 failures are all in `src/components/admin/admin-sidebar.test.tsx`, which — per the task's
  stated scope boundary — is owned by a concurrently running agent adding a nav badge
  (`src/app/(dashboard)/admin/layout.tsx`, `src/components/admin/admin-sidebar.tsx`,
  `src/lib/financial-report-send.ts`). `git status` at the time of this run showed those exact
  files (plus their test files) already modified and uncommitted by that other agent's work,
  confirming the failures are not caused by anything in this change. I did not touch, run, or
  attempt to fix any of those files, per the scope boundary instruction.
- `pnpm build:only`: **PASS**, production build completes cleanly.

**New test count: 2199 total (2195 passing, 4 failing — all pre-existing/out-of-scope).**
Net new passing tests attributable to this work: 6 (`email-send-attempt.test.ts`, previously 0).
The remainder of the delta from the 2182 baseline is the concurrent nav-badge agent's own
in-flight test additions in `admin-sidebar.test.tsx` and `financial-report-send.test.ts`.

---

# Phase 5 — Verification — 2026-09-25

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** Re-verified with the concurrent B-69 (nav-badge) work now landed in the same
tree: `tsc` clean, `pnpm lint` 0 errors, `pnpm test` 2199/2199 passing (the 4 previously-reported
`admin-sidebar.test.tsx` failures cleared on their own once B-69 finished), `pnpm build:only`
clean. Read the diff on both call sites directly rather than inferring from green tests, per the
brief's own instruction — this is a byte-identical behavior-preserving refactor, and the one
latent divergence the implementer reported (the retry route never implemented
permanent-vs-retryable classification) checks out against the pre-refactor code.

### What I did

- Read `git diff` on `src/lib/email.ts`, `src/app/api/admin/email-queue/retry/route.ts`, and the
  new `src/lib/email-send-attempt.ts` in full, rather than trusting the passing test suite alone.
- Traced `sendEmail()`'s loop line-by-line against its pre-refactor version (`git show HEAD:...`):
  the old loop set `lastError` from `result.error.message ?? String(result.error)`, checked
  `isRetryableResendError(result.error.name) && attempt < MAX_ATTEMPTS` to decide
  sleep-and-continue vs. break, and on a thrown error always retried until `MAX_ATTEMPTS`. The new
  loop's `outcome.error`/`outcome.retryable` branches reproduce both paths exactly, including the
  thrown-error case (`attemptResendSend()`'s catch block always returns `retryable: true`, which
  is the pre-refactor thrown-error behavior — it never checked retryability, it just always
  retried until exhausted).
- Traced the retry route's `attemptSend()` against its pre-refactor version: the old function made
  exactly one `resend.emails.send()` call, translated `result.error` into `{ success: false, error
  }` with no classification of any kind, and returned `{ success: true }` otherwise. The new
  version calls `attemptResendSend()` once and discards `outcome.retryable` entirely — confirmed
  by reading the route file, not inferred: `if (outcome.success) return { success: true }; return {
  success: false, error: outcome.error };` never reads `.retryable`. This independently confirms
  the implementer's reported divergence: the retry route genuinely never classified errors before
  this refactor, and still doesn't act on the classification now that it's available — the field
  is received and ignored, exactly as claimed.
- Diffed `PERMANENT_RESEND_ERROR_CODES` and `isRetryableResendError()` in the new
  `email-send-attempt.ts` against the pre-refactor block in `git show HEAD:src/lib/email.ts` —
  byte-identical, moved verbatim. The classification source is unchanged by this refactor (it was
  already a hand-kept `Set<string>` said to mirror the SDK's `RESEND_ERROR_CODE_KEY` union before
  this change, not a runtime-imported type-checked list — that characteristic predates B-68 and
  isn't something this refactor introduced or should be blamed for). Confirmed the "unknown code
  stays retryable" default is preserved: `isRetryableResendError` returns `true` for any code not
  in the explicit permanent set, exactly as before.
- `grep -n "^import" src/lib/email-send-attempt.ts` — confirms no `@/lib/db` import (only `resend`
  and a type-only import of `EmailAttachment` from `@/lib/email`). Load-bearing constraint from
  the brief, satisfied.
- `git diff --stat` on the four protected test files
  (`src/lib/email-guardrail.test.ts`, `src/lib/email-no-api-key.test.ts`,
  `src/lib/email-send-error-handling.test.ts`,
  `src/app/api/admin/email-queue/retry/route.test.ts`) — empty. Byte-identical, as required.
- `git diff --stat src/lib/email-durable-claim.ts src/lib/ledger-acknowledgment-letter-queries.ts`
  — empty. Both untouched, as required.
- Read the new `src/lib/email-send-attempt.test.ts` (6 tests): success, a recognized permanent
  code (`invalid_api_key` → not retryable), a recognized transient code (`rate_limit_exceeded` →
  retryable), an unrecognized future code (`some_future_error_code` → retryable, never guessed
  permanent), a thrown transport error (retryable), and optional-field forwarding
  (`replyTo`/`cc`/`bcc`/`attachments` only included when present). Covers every classification
  branch directly against the shared helper.
- Ran the full gate suite fresh: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`,
  `pnpm build:only`.

### Outputs

#### Type Check
`pnpm exec tsc --noEmit`: **PASS** — zero errors.

#### Unit Tests
`pnpm test`: **PASS**
Total: 2199 | Passed: 2199 | Failed: 0
Duration: ~4s
Failures: none. (The 4 `admin-sidebar.test.tsx` failures reported mid-flight by the implementer
were the concurrent B-69 work not yet complete at that snapshot — confirmed cleared now that both
pieces are in the same tree.)

#### Lint
`pnpm lint`: **PASS** — 0 errors, 1 pre-existing warning in
`src/components/admin/ledger/budget-context-panel.tsx` (unused eslint-disable directive), a file
untouched by this change. Matches the implementer's report exactly.

#### Production Build
`pnpm build:only`: **PASS** — clean compile, 125 routes generated, zero warnings in the full
build log.

#### End-to-End Tests
Not run for this piece — B-68 is a server-only pure refactor with no user-facing flow change;
the four protected test files (which carry the retry route's own e2e-equivalent coverage,
including the duplicate-send race tests) were re-run explicitly and pass unmodified.

#### Regression Tests Added
- `src/lib/email-send-attempt.test.ts` (6 tests) — guards against: the shared classification step
  regressing on either caller's behavior (permanent vs. retryable, unknown-code-stays-retryable,
  thrown-error-always-retryable, optional-field forwarding). Not a "regression for X" test in the
  strict sense (no bug was reproduced pre-fix here — this is a refactor, not a bug fix), but it is
  the direct unit-level guard against the two call sites drifting apart again, which is the
  failure mode B-68 exists to prevent.

#### Coverage on Critical Modules
- `src/lib/email-send-attempt.ts`: 100% of exported branches exercised by its own 6-test suite
  (success, permanent, transient, unknown-code, thrown-error, optional-field-forwarding).

#### Feature-Gate Audit
No protected routes or server actions touched. `attemptResendSend()` is a pure SDK-call wrapper
with no auth/feature gate of its own — both `sendEmail()` and the retry route retain their
pre-existing, unmodified `auth()` + `hasFeature(FEATURES.EMAIL_QUEUE_MANAGE` (or equivalent) `)`
checks and the deny-by-default `shouldBlockNonProductionSend()` guard, none of which this refactor
touched (confirmed via the diffs above — only the internal send-and-classify call changed).

### Verdict: PASS

### Open questions / handoff notes

- **Next agent: analyst** (Phase 6) — shipped-vs-intent review. The refactor is behavior-identical
  by direct diff inspection, not just green tests; nothing here should block a SHIP IT.
- **Possible follow-up (not in scope here, flagged for backlog):** the retry route's
  `attemptSend()` has always ignored the permanent-vs-retryable distinction, unlike `sendEmail()`.
  Since both terminal outcomes are identical today, this is not a bug, but the newly-shared
  `retryable` field is right there if a future change wants the retry route to treat a permanent
  error differently (e.g., not re-arm `nextRetryAt`, or badge the row as non-retryable in the
  admin UI). That would be a genuine behavior/design decision requiring its own Phase 1-3, not an
  extension of this refactor.
- **Possible follow-up (not in scope here, flagged for backlog):** the retry route's
  `attemptSend()` has always ignored the permanent-vs-retryable distinction, unlike `sendEmail()`.
  Since both terminal outcomes are identical today, this is not a bug, but the newly-shared
  `retryable` field is right there if a future change wants the retry route to treat a permanent
  error differently (e.g., not re-arm `nextRetryAt`, or badge the row as non-retryable in the
  admin UI). That would be a genuine behavior/design decision requiring its own Phase 1-3, not an
  extension of this refactor.
- No schema changes, no new permissions, no UI changes — nothing for ux-developer here.

---

# Phase 6 — Shipped vs Intent — 2026-09-25

**Owner:** analyst
**Status:** complete

### Summary

**Verdict: SHIP IT.** The refactor does exactly what B-68 asked: there is now one place — `attemptResendSend()` in `src/lib/email-send-attempt.ts` — that calls the Resend SDK and decides success/failure/retryability. Both `sendEmail()` and the retry route's `attemptSend()` call through it rather than each inspecting `resend.emails.send()`'s return value independently. I read the diff on all three files directly (not just QA's trace of it) and confirm the classification logic, the permanent-error-code set, and both callers' branching are byte-identical to pre-refactor behavior. This is a correctness-shaped refactor and it holds up as one.

### What I did

- Read `src/lib/email-send-attempt.ts` in full, and the call sites in `src/lib/email.ts` (line 233) and `src/app/api/admin/email-queue/retry/route.ts` (`attemptSend()`, lines 156–173).
- Confirmed there is exactly one call to `resend.emails.send()` left in the codebase outside of tests (`grep -rn "emails.send(" src/` — only inside `attemptResendSend()`). No relocated duplication: the classification decision genuinely lives in one function now, not two functions that happen to import a shared constant.
- Confirmed the retry route's `attemptSend()` receives `outcome.retryable` and never reads it (`grep -n "\.retryable" src/app/api/admin/email-queue/retry/route.ts` returns nothing) — the asymmetry QA and the implementer both flagged is real and exactly as described.
- Cross-checked the still-open B-68 backlog entry (`docs/backlog.md` line ~427) against what shipped — the entry is stale (still unchecked `[ ]`, still describing the *pre-refactor* state as a proposal) even though the feature is fully implemented and QA-passed. Flagging as a housekeeping gap below.

### Answers to the two questions

**1. Is the duplication actually gone, or merely relocated?**

Gone, not relocated. Before: two functions each independently called the SDK and inspected `{ data, error }`. After: one function (`attemptResendSend()`) owns that call and that inspection; both prior call sites now call it and adapt its result to their own needs (a retry loop vs. a single-attempt route). That's the correct shape — a single function two callers *use*, not two functions that agree by convention. `PERMANENT_RESEND_ERROR_CODES` and `isRetryableResendError()` also moved into the same module rather than staying duplicated or reachable from two places. There is exactly one place where "did this send succeed" is decided.

**2. Preserve the asymmetry, or resolve it? Take a position.**

Preserving it *in this refactor* was the right call — B-68's job was a behavior-identical extraction, and QA independently verified it is one by tracing both callers against their pre-refactor git history line by line. Introducing new retry-route behavior inside a refactor PR is exactly the kind of scope creep this project's own invariants warn against (a reordered check in this code is a design decision, not a cleanup).

But the underlying question — *should* the retry route treat a permanent error differently now that it can? — is a real product gap, and I'll take a position on it: **yes, it should, eventually.** Today, an admin who clicks "Retry" on a message that failed because the API key was revoked or the sending domain was pulled sees the identical outcome (`status: 'failed'`, a `nextRetryAt` 15 minutes out) as an admin retrying a message that hit a transient rate limit. The row will keep re-arming `nextRetryAt` forever on every sweep pass, and nothing in the UI tells the admin "this will never succeed without an operator fixing the account" versus "this will probably succeed if you wait." That's a real information gap for whoever operates `/admin/email-queue`, and it's precisely the kind of ambiguity that let the original month-long outage go unnoticed — an admin staring at a `failed` row with no signal of *why it will stay failed* is in the same epistemic position as the pre-B-65 world, just one level down the stack now.

This is not a blocker for today's ship — the refactor's contract was "behave identically," and it does. It's a genuine, already-half-specified follow-up: `retryable: false` is sitting right there in the return value, unused. I recommend filing it as its own small backlog item (Phase 1 required, since "should a permanent error stop auto-re-arming `nextRetryAt`, or just change its displayed status" is a real UX/product call, not an obvious cleanup) rather than letting it live only as a comment in the code.

### What's working

- The extraction is clean: no `@/lib/db` import in the new module, matching the `email-guard.ts` precedent the brief asked for.
- Test coverage on the shared helper is direct and complete for its own branches (success, permanent, transient, unknown-code-stays-retryable, thrown-error, optional-field forwarding) — 6/6 passing, and QA read them rather than trusting the count.
- The four protected legacy test files are verified byte-identical (`git diff --stat` empty) and pass unmodified — the strongest evidence available that this is truly behavior-preserving, short of a production A/B.

### Edge cases

- Empty state: not applicable — no UI surface shipped with this piece.
- Failure microcopy: not applicable — no new user-facing text; the `error` string surfaced to the admin queue UI is unchanged (still Resend's raw message, as before).
- Permission gate: not applicable — no new route or gate; both callers' existing `auth()`/`hasFeature()`/deny-by-default guards are confirmed untouched by diff.
- Mobile: not applicable — server-only change.
- Brand consistency: not applicable.

### Follow-ups (SHIP WITH NOTES-shaped, tracked here even though this ships clean)

1. **Housekeeping — close out B-68 in `docs/backlog.md`.** The entry (line ~427) is still unchecked and still describes the pre-refactor problem as a future proposal, even though it shipped and passed QA today. Mark `[x]`, and add a closing note in the same style as B-65/B-66 above it (implementation file, one-line outcome, pointer to this work-log).
2. **New backlog item to file — retry-route permanent-error handling.** Should the email-queue retry route stop auto-re-arming `nextRetryAt` (or otherwise change what the admin sees) when `attemptResendSend()` reports `retryable: false`? My recommendation: yes, worth doing, low urgency — needs a short Phase 1 pass to decide the exact UI/scheduling change, not an extension of B-68.

Neither of these blocks shipping today's refactor. Verdict stands: **SHIP IT.**

### Open questions / handoff notes

- Next: no immediate implementer work required. When someone picks up the retry-route follow-up above, route it through Phase 1 (analyst) first — it's a real product decision about how a permanent failure should be presented and rescheduled, not a mechanical change.
- Recommend whoever next touches `docs/backlog.md` mark B-68 closed per the housekeeping note above.
