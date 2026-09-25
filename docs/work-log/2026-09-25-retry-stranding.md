# Email Queue Retry — `retrying`-Row Stranding Fix (B-66) — Work Log

> **Slug:** `2026-09-25-retry-stranding`
> **Surface:** (dashboard) admin — `/admin/email-queue`
> **Permission(s):** none new — existing `FEATURES.ADMIN_USERS` gate on the retry route and the page is unchanged
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Bug confirmation | api-developer | Complete (brief) | Confirmed | 2026-09-25 |
| 2 — Architectural review | — | **Skipped, documented below** | — | — |
| 3 — Technical design | api-developer | Complete (brief, inline — qa already scoped the fix) | — | 2026-09-25 |
| 4 — Implementation | api-developer | Complete | — | 2026-09-25 |
| 5 — Verification | qa | Complete | **PASS** | 2026-09-25 |
| 6 — Shipped vs intent | analyst | Complete | **SHIP WITH NOTES** | 2026-09-25 |

**Skips, per the bug-fix variant's "no silent skips" rule:**
- **Phase 2 (architect) skipped.** This fix adds one nullable timestamp column used only for an internal staleness check and changes no permission, no route contract, no response shape, and no user-facing behavior beyond making a previously-invisible state visible. It does not introduce a directory, a dependency, or a new architectural pattern — it reuses the exact pattern (`db.update().where().returning()`, one column, one migration) the codebase already uses throughout. Reasoned about below anyway, given this file's own history with "should this touch an invariant" scrutiny.

---

# Phase 1 — Bug Confirmation (brief)

**Root cause:** the atomic-claim fix in `docs/work-log/2026-09-25-email-silent-success.md` (closing a real, qa-proven duplicate-send race) marks a row `status: "retrying"` before sending, and `settleClaim()` always writes a terminal status afterward inside a `try/catch`. But a JS `try/catch` cannot run after a **hard process death** — a Vercel function timeout, an instance being killed, or a deploy landing mid-request. A row claimed right before that happens is left at `retrying` forever.

**Why this matters (found and disclosed by qa, not discovered independently here):** a stranded `retrying` row is invisible to:
- both retry paths (targeted and bulk both require `status = 'failed'`),
- all three `/admin/email-queue` sections (each filters on one exact status string),
- and the failed-count badge (`getFailedEmailCount()`, pre-fix: `status = 'failed'` only).

Structurally the same shape as the month-long silent-outage bug this whole chain of work-logs exists to fix — permanently un-retryable and silently uncounted — just narrower (needs a hard process death mid-claim, not just a missing env var) and rarer.

**Reproduction (conceptual — this specific failure mode requires an actual process kill mid-request, which cannot be manufactured in a unit test or a local dev session):** claim a row (`UPDATE ... SET status='retrying' ... WHERE status='failed'`), then have the process die before the terminal write. Pre-fix: the row is permanently stuck at `retrying`, matched by no query in the codebase. Post-fix: the same row is reset back to `failed` (and, in the meantime, counted by the badge) once `RETRY_STALE_MINUTES` (5) has elapsed.

## VERDICT

Bug confirmed (qa's own finding, escalated rather than buried in their Phase 5 re-verification). Fix adds recovery without weakening the atomic claim — verified in Phase 4/testing below.

---

# Phase 2 — Architectural Review — SKIPPED, with reasoning

See the status-table note above. No new table, no new route, no new permission, no new directory, no new dependency. One nullable `timestamptz` column on an existing table, following the exact idempotent-migration and Drizzle-query patterns already used throughout `email_queue`'s own history (five prior migrations touch this same table). The two design questions with actual judgment calls — the staleness threshold and where the reset runs — are answered in Phase 3 below rather than deferred to an architect, since the task brief itself already framed and constrained both.

---

# Phase 3 — Technical Design (brief, inline)

## The threshold: 5 minutes

This project sets no `maxDuration` anywhere (grepped `src/app/api` — no hits) and has no `vercel.json` (confirmed absent) — deliberate, per the hosting-cost constraint recorded in this session's memory (Vercel Pro's per-seat pricing was rejected). That means the retry route runs on Vercel's **Hobby-tier default serverless function limit: 10 seconds.** A single retry request — targeted or bulk — cannot be "genuinely still in flight" past that wall-clock budget; the platform itself kills it first. Past 10 seconds, a row claimed by that request is not slow, it's dead.

**Chose 5 minutes (`RETRY_STALE_MINUTES = 5`)** — a 30x margin over the 10-second hard cap. Reasoning for both directions:
- **Long enough to never race a live send.** The margin has to absorb everything that isn't "the platform killed the function": clock skew between whatever machine sets `retryingAt` and whatever machine later evaluates the cutoff, a cold start, an unusually slow Resend response before the 10s cap bites, GC pauses, etc. 30x the hard platform limit is generous enough that no realistic combination of these can make a genuinely-still-claiming request look stale. Getting this wrong in the "too short" direction is the worse failure: it would reopen the exact duplicate-send race the atomic claim was built to close, silently, for the sake of a slightly faster recovery.
- **Short enough to still be a same-session recovery.** An admin looking at a stuck retry doesn't want to wait an hour, and doesn't need to — see "where the reset runs" below, this doesn't require a wait in practice for the common case.

## Where the reset runs — self-healing on view, not click-gated

qa asked directly: is admin-triggered-only (bulk sweep) sufficient, or should the reset also run on a read of `/admin/email-queue`? **Position: both, and additionally the admin nav's badge query, for defense in depth — none of the three costs more than one indexed conditional `UPDATE` that usually matches zero rows.**

- **Bulk sweep (`handleBulkRetry()`):** the task's explicit, minimal ask. Runs `resetStaleRetryingEmails()` before selecting eligible rows, so a row stranded by an earlier crash can rejoin the very sweep that's running right now.
- **`/admin/email-queue` page read:** click-gated-only leaves a stranded row invisible until someone happens to click "Retry Failed Emails" specifically — but the page itself is the more common admin action (an admin who sees nothing wrong has no reason to click retry at all). Self-healing on read closes that gap: the page now resets stale rows before running its three section queries, so a stranded row shows up correctly under "Failed Emails" on the very page load that would otherwise show nothing.
- **`getFailedEmailCount()` (admin nav badge, every admin page):** deliberately **not** given its own write — see Visibility below for why this one counts instead of resets.

None of the three needs new scheduled infrastructure (this project has none, by design). Each piggybacks on work that already runs on its own trigger — a page load or a button click — exactly the constraint the task set.

## Visibility

**Should a `retrying` row render in the admin UI at all?** Decided: yes, but minimally — `StatusPill` now carries an explicit `retrying: "Retrying…"` label (blue, distinct from both `failed`'s amber and the gray unknown-status fallback), following the exact precedent `dev_no_api_key` set (a labeled entry rather than falling through to "pending"). No new table section was added: with the reset running on both page-view and bulk-sweep, a `retrying` row that persists long enough to be *seen* by an admin (rather than resolving in the sub-second span of an actual send) is already the stale case the reset just handled — a live section for a state that, by design, should almost never outlive a single page render would be complexity out of proportion to the problem. The label exists for the residual case: an admin refreshing at the exact instant a request is mid-flight, or the brief window before a stranding is caught.

**Should the failed-count badge include stranded rows?** Yes — but as a **read-time inclusion in the count query**, not a write. `getFailedEmailCount()` now counts `status = 'failed' OR (status = 'retrying' AND retrying_at < cutoff)`. Deliberately not "reset-then-count": the badge is a read-only query that runs on every single admin page render (not just `/admin/email-queue`), and giving every admin page render a side-effecting write felt like the wrong place to put one, especially for a signal whose entire premise is "a write didn't happen when it should have." Folding the same predicate into the `WHERE` clause gets the same visibility outcome — a stranded row is never hidden from the badge — without adding a write to the hottest, most frequently-evaluated path in the whole fix.

## Implementer

api-developer (this work log) — small, schema + one route + one page + one shared lib file + a UI label; no split needed.

---

# Phase 4 — Implementation

## Files Created

- `drizzle/migrations/0106_email_queue_retrying_at.sql` — `ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS retrying_at TIMESTAMPTZ;` — idempotent, verified by execution (see Idempotency below).
- `src/app/(dashboard)/admin/email-queue/view-email-dialog.test.tsx` — 3 tests for `StatusPill`'s new `retrying` handling.

## Files Modified

- `src/lib/db/schema.ts` — added `emailQueue.retryingAt` (`timestamp("retrying_at", { withTimezone: true })`, nullable), with a doc comment explaining why it's `withTimezone: true` while the table's pre-existing timestamp columns aren't (the 2026-09-03 security review's `timestamp`-vs-`timestamptz` drift finding — this is a genuine instant used for a staleness comparison, so it gets the correct type from day one; the pre-existing columns' drift is untouched, out of scope). Updated the `status` column's inline comment (no change needed — `retrying` was already listed there from the prior fix).
- `src/lib/email-queue-stats.ts` — added `RETRY_STALE_MINUTES` (exported constant, 5, with the threshold reasoning above), `resetStaleRetryingEmails(now)` (the shared reset — one `UPDATE ... WHERE status='retrying' AND retrying_at < cutoff RETURNING id`, returns count reset), and extended `getFailedEmailCount()` to also count stale-`retrying` rows (now takes an optional `now: Date = new Date()` param for testability; the existing no-arg call site in `src/app/(dashboard)/admin/layout.tsx` is unaffected).
- `src/app/api/admin/email-queue/retry/route.ts` — `claimFailedRow()` now takes a `now: Date` param and stamps `retryingAt: now` in the same atomic claim `UPDATE`. Every terminal write in `settleClaim()` and `handleMissingApiKey()` (sent / failed / blocked_non_production / dev_no_api_key) now also clears `retryingAt: null`. `handleBulkRetry()` calls `resetStaleRetryingEmails(now)` before selecting eligible rows; `handleTargetedRetry()` deliberately does not (an explicit single-row click has no need to sweep the whole table).
- `src/app/(dashboard)/admin/email-queue/page.tsx` — calls `resetStaleRetryingEmails(new Date())`, awaited, before the three section queries, so a page view self-heals a stranded row and shows it correctly in "Failed Emails" on the same render.
- `src/app/(dashboard)/admin/email-queue/view-email-dialog.tsx` — `QueuedEmailStatus` gained `"retrying"`; `STATUS_LABEL`/`STATUS_CLASS` gained a `"Retrying…"` entry (blue), per the Visibility decision above.
- `src/lib/email-queue-stats.test.ts` — rewritten with a richer `db` mock (adds `update`) covering both `getFailedEmailCount()` (existing 3 tests preserved unmodified in substance, 1 new test added for the `retrying` fold-in) and 4 new `resetStaleRetryingEmails()` tests.
- `src/app/api/admin/email-queue/retry/route.test.ts` — added a `vi.mock("@/lib/email-queue-stats", ...)` (spy-wrapped, so this file doesn't need to model the reset's own UPDATE predicate — that's covered on its own in `email-queue-stats.test.ts`), one `mockClear()` line in the shared `beforeEach`, and a new 4-test describe block. **Zero existing lines removed** — verified by `git diff`, every line beginning with `-` in the diff is the `--- a/...` file header.

## Schema Changes

- `email_queue.retrying_at` — nullable `timestamptz`. Migration `drizzle/migrations/0106_email_queue_retrying_at.sql`.

## Not touched, per the task's explicit constraint

`src/lib/email.ts`, `src/lib/email-guard.ts`, `src/lib/ledger-acknowledgment-letter-queries.ts` — confirmed untouched (a concurrent agent's in-progress work on the acknowledgment-letter claim path is visible in the shared working tree; I did not read past what was necessary to confirm no overlap, and made no edits there).

## Idempotency — proven by execution, not just review

Ran `drizzle/run-migrations.mjs` twice against the dev database from `.env.local` (`ep-orange-sunset...neon.tech`, confirmed by inspecting the connection string):

- **First run:** applied `0106_email_queue_retrying_at.sql` cleanly (interspersed with expected `NOTICE ... already exists, skipping` messages from unrelated earlier migrations replaying, e.g. `ix_email_queue_status`). Ended `✅ Migrations completed successfully`.
- **Second run:** produced exactly one relevant notice — `NOTICE: column "retrying_at" of relation "email_queue" already exists, skipping` — and again ended `✅ Migrations completed successfully`. A clean no-op.
- Verified the column directly afterward: `information_schema.columns` shows `retrying_at | timestamp with time zone | YES` (nullable, correct type).
- Verified no data was touched: `email_queue` status distribution is `blocked_non_production: 397, pending: 2, sent: 678` — unchanged from the distribution recorded in the prior work-log's own qa pass. Only DDL ran; no row was read, written, or sent. No real email was sent, no address was added to `EMAIL_DEV_ALLOWLIST`, no database write outside the migration's own `ALTER TABLE` occurred.

## Test evidence — failed against pre-fix code, passes against fixed code

Reverted the five non-test files this fix touches (`schema.ts`, `email-queue-stats.ts`, the retry route, the page, `view-email-dialog.tsx`) to pre-fix `HEAD` via `git checkout --`, keeping all test files (new and modified) in place, then ran the three affected test files:

```
Test Files  3 failed (3)
     Tests  10 failed | 23 passed (33)
```

The 10 failures are exactly the new B-66 assertions: `resetStaleRetryingEmails` tests fail because the function doesn't exist pre-fix (import resolves to `undefined`, called as a function → `TypeError`, surfaced by vitest as assertion failures against the expected counts); the route tests fail because `claimFailedRow()`'s `.set()` call pre-fix has no `retryingAt` key at all (`{status:"retrying",attempts:4}` vs. expected `objectContaining({retryingAt: expect.any(Date)})`), the terminal-write test fails the same way, and the "bulk sweep calls the reset" test fails because `resetStaleRetryingEmailsMock` was never called (`0` times instead of `1`). The 23 passes are the pre-existing tests in these same files, confirming the revert didn't collaterally break anything already covered.

Restored the fix via `cp` from a pre-edit backup, confirmed byte-identical restoration by `git diff --stat` matching the pre-revert diff exactly, then re-ran the full suite: all 2171 tests pass.

## Gate results

- `pnpm exec tsc --noEmit`: **PASS** (no output)
- `pnpm lint`: **PASS** — 0 errors. One pre-existing, unrelated warning (`src/components/admin/ledger/budget-context-panel.tsx:114`, unused eslint-disable directive) — same warning noted in the prior work-log, not touched by this change.
- `pnpm test`: **PASS** — 125 test files, **2171 tests** passed, 0 failed.
  - The task's stated baseline was 2154. The actual delta from *this* fix is **+12** (5 net-new in `email-queue-stats.test.ts` [4 `resetStaleRetryingEmails` tests + 1 `getFailedEmailCount` fold-in test — the file's original 3 tests are preserved], 4 net-new in `route.test.ts`, 3 net-new in the new `view-email-dialog.test.tsx`). The gap between 2154+12=2166 and the observed 2171 is a **concurrent, unrelated agent's in-progress work** visible in this shared working tree (`src/lib/ledger-acknowledgment-letter-queries.ts`, `src/app/api/admin/ledger/acknowledgments/letters/email/route.ts`, and their test files, plus `docs/backlog.md`/`docs/decisions.md` — none of which this task touched, per the explicit constraint). Confirmed via `git status`/`git diff --stat` that none of those files carry any edit from this work.
- `pnpm build:only`: **PASS** — exit code 0, all routes compiled, no errors.

## Implementer Notes

- `getFailedEmailCount()` gained an optional `now: Date = new Date()` parameter (for deterministic testing of the staleness cutoff) — fully backward compatible; the one existing call site (`src/app/(dashboard)/admin/layout.tsx`) calls it with no arguments and is unaffected.
- Considered folding `resetStaleRetryingEmails()` into `getFailedEmailCount()` itself (so every admin page render self-heals, not just `/admin/email-queue`). Rejected: that would add a write to the single hottest, most-frequently-evaluated read path in the admin area, and the count-based visibility fix already closes the actual "invisible" gap without one. If a future review finds 5-minute-plus staleness windows in practice are common enough that the two current reset points (bulk sweep, queue-page view) aren't catching them fast enough, this is the next lever to pull.
- Did not touch `EMAIL_DEV_ALLOWLIST`, did not attempt a real send, did not commit, did not push.

## Open questions / handoff notes

- **For `qa` (Phase 5):** please re-verify independently per the project's established discipline, specifically:
  1. The claim/settle behavior still works end-to-end under `pnpm dev` with the same synthetic `.invalid`-address technique used in the prior pass — do NOT click "Send now" for real.
  2. That the two untouched race tests (`"must not send twice when two requests for the same id arrive concurrently..."` and `"bulk retry has the identical race protection..."`) are byte-identical — confirm via `git diff` (I checked; no line beginning with `-` other than the file header appears in the diff).
  3. Whether the `resetStaleRetryingEmails()` mock-based tests in `email-queue-stats.test.ts` are trustworthy proxies for real Postgres `timestamptz` comparison behavior — I hand-verified the real drizzle-orm `Param`-node shape for a `timestamptz` column (a real column's bound value is NOT always a bare string/Date in `queryChunks` the way a mocked `{}` schema's is) and adjusted the test's SQL-fragment inspector accordingly, but a from-scratch second look is warranted given how easy this was to get subtly wrong.
  4. Since the actual stranding scenario (a hard process kill mid-request) cannot be manufactured in a unit test or `pnpm dev`, consider whether a live click-through of "the reset runs on page view" is worth doing by manually inserting a synthetic `retrying` row with an old `retrying_at` via a scratch script (no real send involved) and confirming it appears under "Failed Emails" after a page load — I did not do this myself since it would require a direct DB write, and the task explicitly forbade writing to any database.
- **For the next agent (none required):** no UI beyond the `StatusPill` label change was needed; this was small enough to stay within api-developer per CLAUDE.md's implementer-split table, but the `StatusPill`/`page.tsx` edits are, strictly, UI files — flagging this scope call for the record in case a future reviewer wants `ux-developer` to have signed off on the visual treatment specifically.
- **Root cause of the underlying hazard (hard process death) is not fixable in application code** — it's inherent to any atomic-claim pattern on a platform with no durable, crash-safe distributed lock. This fix bounds the damage (max 5 minutes of invisibility, self-healing, no manual SQL required) rather than eliminating the possibility, which is the correct trade for a platform with no lower-level primitive to build a stronger guarantee on.

---

## Phase 5 — Verification — 2026-09-25

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** The safety-critical direction (the staleness reset must never touch a genuinely live claim) holds up under independent verification: `vercel.json` is confirmed absent, no `maxDuration` is set anywhere in `src/app`, and the atomic-claim `UPDATE ... WHERE status = 'failed'` that the retry route uses is byte-identical to pre-fix — the two pre-existing race tests are untouched, confirmed by diff. The mock-based `timestamptz`-comparison test the implementer flagged for a second look is not vacuous: a standalone probe of the real `drizzle-orm` schema confirms the test's `Param { value: Date, encoder: PgTimestamp }` extraction logic matches what the query builder actually produces at build time. A live click-through in the dev database (never production) confirmed the reset fires on page view, moves a synthetic stranded row from `retrying` to `failed`, clears `retrying_at`, and makes it visible under "Failed Emails" — cleaned up afterward.

### What I did

- Ran the shared gate suite (see Piece A's work-log for the identical run against the same tree): `pnpm exec tsc --noEmit` (clean), `pnpm lint` (0 errors, 1 pre-existing unrelated warning), `pnpm test` (2171/2171), `pnpm build:only` (clean).
- **Verified the `vercel.json`/`maxDuration` premise directly, rather than accepting it:** `ls vercel.json` → not found; `find . -maxdepth 3 -iname vercel.json` (excluding `node_modules`) → no hits; `grep -rn "export const maxDuration"` across `src/app` → no hits. The 10-second Hobby-tier default cap the 30x margin (`RETRY_STALE_MINUTES = 5`) is built on is a verified fact, not an assumed one.
- **Confirmed the atomic claim is unweakened:** read `claimFailedRow()` in `src/app/api/admin/email-queue/retry/route.ts` — the claim `UPDATE` still gates on `and(eq(emailQueue.id, id), eq(emailQueue.status, "failed"))`, unchanged; the only addition is `retryingAt: now` in the same `.set()` call. Every terminal write (`settleClaim()`'s sent/failed/blocked_non_production branches, `handleMissingApiKey()`'s dev_no_api_key/failed branches) now also sets `retryingAt: null` — read each branch individually to confirm none were skipped.
- **Confirmed the two named race tests are byte-identical**, per the implementer's own claim: `git diff -- src/app/api/admin/email-queue/retry/route.test.ts` shows only additions (new mock declaration, one `mockClear()` line, and a new describe block at the end) — no line beginning with `-` other than the diff's own file-header lines. Located and read both tests directly (`"must not send twice when two requests for the same id arrive concurrently…"` and `"bulk retry has the identical race protection…"`) to confirm they sit above the diff's insertion point, untouched.
- **Independently reproduced the pre-fix failure** (not just re-reading the implementer's report): `git stash push` on the five non-test files this fix touches (`schema.ts`, `email-queue-stats.ts`, the retry route, the page, `view-email-dialog.tsx`), ran the three affected test files — **10 failed, 23 passed**, matching the implementer's own reported numbers exactly (the `resetStaleRetryingEmails` tests fail because the function/column don't exist pre-fix; the route tests fail because `claimFailedRow()`'s `.set()` call has no `retryingAt` key and the bulk-sweep-calls-the-reset test finds `0` calls instead of `1`). `git stash pop` restored the fix; re-ran the full suite to confirm 2171/2171 green again.
- **Assessed the mock-based `timestamptz`-comparison test, per the implementer's own request for a second look.** Wrote a standalone script (`.qa-scratch/check_sql_shape.mjs`, deleted after use) that imports the REAL `emailQueue` schema and builds the actual `and(eq(emailQueue.status, "retrying"), lt(emailQueue.retryingAt, cutoff))` condition via real `drizzle-orm` functions (no mocking), then walked the resulting SQL AST. Confirmed: the bound value for the `timestamptz` column is a real `Param { value: <Date instance>, encoder: PgTimestamp }` node — the value is genuinely still a JS `Date`, not yet serialized to a driver string, exactly as the test file's comment claims ("a timestamptz column's Date value is only converted to its driver string at execution time, not at query-build time"). This means `email-queue-stats.test.ts`'s `extractSqlParams()` helper is exercising real query-composition behavior against the real schema (only the DB execution layer — `db.select`/`db.update`'s `.where()`/`.returning()` — is mocked), not asserting against a shape that only exists inside the mock. The test is a legitimate, disclosed-scope unit test of *what WHERE clause the code builds*, not an integration test of Postgres comparison semantics — it doesn't claim to be the latter, and the mock's own JS `Date <` comparison is a faithful analog of Postgres `timestamptz <` (both compare underlying instants, immune to timezone-of-display issues). Not vacuous.
- **Re-verified migration idempotency independently**, not just accepting the implementer's proof: started `pnpm dev` against the same dev database (`ep-orange-sunset...neon.tech`, confirmed via `.env.local`), which re-runs all migrations on every startup — observed `NOTICE: column "retrying_at" of relation "email_queue" already exists, skipping` and a clean `✅ Migrations completed successfully`, a **third** clean idempotent run (implementer ran it twice; this was the third, independently).
- Confirmed `schema.ts` declares `retryingAt: timestamp("retrying_at", { withTimezone: true })` — the exact column-type-drift concern the 2026-09-03 security review flagged — verified by reading the schema diff directly, not inferred.
- **Manual click-through in the DEV database only (never production; no real send attempted; `EMAIL_DEV_ALLOWLIST` untouched):**
  1. Started `pnpm dev`.
  2. Inserted a synthetic row directly via a scratch script using the project's own `postgres` driver against `.env.local`'s `DATABASE_URL`: `to: 'qa-stranded-test@example.invalid'`, `status: 'retrying'`, `retrying_at: now() - interval '10 minutes'` (comfortably past the 5-minute threshold).
  3. Signed in as the seeded e2e admin (`E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`) via a throwaway Playwright script driving the real credentials sign-in form (same technique `e2e/helpers/auth.ts` uses), then navigated to `/admin/email-queue`.
  4. Confirmed the synthetic address appeared on the rendered page, under "Failed Emails" (screenshot captured), with a working "Retry" button next to it.
  5. Queried the DB directly afterward: the row's `status` had flipped from `retrying` to `failed` and `retrying_at` was `null` — the page-load reset fired and self-healed the row on the very render that would otherwise have shown nothing, exactly as designed.
  6. Checked a 360px-viewport screenshot — no layout breakage introduced by this fix specifically (the admin email-queue table's mobile density is a pre-existing characteristic of that page, not something this fix's `StatusPill` label change affects).
  7. Deleted the synthetic row (`DELETE FROM email_queue WHERE "to" = 'qa-stranded-test@example.invalid'`), confirmed 1 row removed, and confirmed `git status` was unchanged from session start (no committed artifacts from this click-through).
  - Did not attempt to visually capture the `retrying`/"Retrying…" pill state itself — by design, the reset fires before the page's section queries run on every read, so a genuinely stranded row is only ever visibly `retrying` in the residual window the implementer's design doc already names (a concurrent in-flight request, or the instant before staleness is caught); manufacturing that exact race is out of scope for a click-through and isn't needed to confirm the fix's actual claim (self-healing works).

### Outputs

- No source files touched by qa — verification only. `git status` confirmed unchanged from session start (only the pre-existing implementer diff plus this work-log edit).
- Scratch scripts (`.qa-scratch/manage_stale_row.mjs`, `.qa-scratch/click_through2.mjs`, `.qa-scratch/check_sql_shape.mjs`, screenshots) were created for this verification and deleted before finishing; the dev database was left in its pre-click-through state (the one synthetic row inserted was deleted; no other rows were touched — the migration re-runs are the project's own idempotent DDL, not a qa action).

#### Type Check
`pnpm exec tsc --noEmit`: **PASS** (no output)

#### Unit Tests
`pnpm test`: **PASS**
Total: 2171 | Passed: 2171 | Failed: 0
Duration: ~4s
Failures: none

#### Production Build
`pnpm build:only`: **PASS**
Notes: all routes compiled, no warnings beyond the pre-existing unrelated ESLint one; no new routes.

#### End-to-End Tests
`pnpm test:e2e`: **Not run** — not requested in this task's shared Gates section. The stranding scenario itself (a hard process kill mid-request) cannot be manufactured by Playwright against a real dev server any more than it can by Vitest, per the implementer's own note — the manual click-through below substitutes for it by manufacturing the *symptom* (a stale `retrying` row) directly and confirming the recovery path, which is the part actually under test.

#### Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| Synthetic `retrying` row (10 min stale) becomes visible under "Failed Emails" on `/admin/email-queue` page load | pass | DB confirmed `status: retrying → failed`, `retrying_at: null` after the page render; row cleaned up afterward. Dev database only (`ep-orange-sunset...neon.tech`), no real send attempted, `EMAIL_DEV_ALLOWLIST` untouched. |
| Migration `0106` idempotency (third independent run, via `pnpm dev` restart) | pass | Clean `NOTICE ... already exists, skipping` + successful completion. |

#### Regression Tests Added
(By the implementer, verified by qa — reproduced failing pre-fix [10 failed / 23 passed] and passing post-fix)
- "the atomic claim stamps `retryingAt` with the current time…" — `src/app/api/admin/email-queue/retry/route.test.ts` — guards against: losing the only signal that distinguishes a live claim from a stranded one.
- "every terminal write clears `retryingAt` back to null…" — `src/app/api/admin/email-queue/retry/route.test.ts` — guards against: a completed row being misidentified as stranded.
- "the bulk sweep runs `resetStaleRetryingEmails()` before selecting eligible rows…" — `src/app/api/admin/email-queue/retry/route.test.ts` — guards against: the sweep not running where designed.
- "targeted (single-row) retry does NOT run the sweep…" — `src/app/api/admin/email-queue/retry/route.test.ts` — guards against: an unnecessary full-table sweep on every single-row click.
- "resets a row stranded at 'retrying' past the threshold back to 'failed'… — fails against pre-fix code (no such function/column existed)" — `src/lib/email-queue-stats.test.ts` — the primary regression test for B-66.
- "does NOT reset a row still within the threshold…" — `src/lib/email-queue-stats.test.ts` — guards against: reopening the duplicate-send race by resetting a live claim (the safety-critical direction, independently verified above via the `vercel.json`/`maxDuration` check).
- "never touches a row that isn't 'retrying' at all, regardless of age" — `src/lib/email-queue-stats.test.ts` — guards against: the reset touching unrelated statuses.
- "resets multiple stranded rows in one sweep and leaves fresh ones alone" — `src/lib/email-queue-stats.test.ts` — guards against: an all-or-nothing sweep that can't distinguish rows in the same batch.
- "also folds in the 'retrying' status, so a stranded row is visible on the badge…" — `src/lib/email-queue-stats.test.ts` — guards against: the failed-count badge staying silent on a stranded row.
- 3 `StatusPill` tests — `src/app/(dashboard)/admin/email-queue/view-email-dialog.test.tsx` — guard against: a `retrying` row rendering as an unrecognized/broken status instead of a labeled "Retrying…" pill.

#### Coverage on Critical Modules
- `src/lib/email-queue-stats.ts`: every branch of `resetStaleRetryingEmails()` and `getFailedEmailCount()` is covered (stale/fresh/wrong-status/multi-row cases) — not one of the three named coverage-target modules in the qa charter, but exercised at what I'd assess as effectively 100% of its own branches.

#### Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `POST /api/admin/email-queue/retry` | yes | yes | `FEATURES.ADMIN_USERS` — unchanged by this fix (confirmed by reading the route diff: only `claimFailedRow`/`settleClaim`/`handleMissingApiKey`/`handleBulkRetry` bodies changed; the `auth()`/`hasFeature()` block at the top of `POST()` is untouched). |
| `GET /(dashboard)/admin/email-queue` (page) | yes | yes | `FEATURES.ADMIN_USERS` — unchanged; the only addition is the `await resetStaleRetryingEmails(new Date())` call, placed after the existing gate check, confirmed by reading the diff. |

This fix adds no new route, no new server action, and no new permission — it adds one nullable column and folds a self-healing read into two already-gated surfaces plus the admin-nav badge query (which itself carries no independent gate; it is only ever invoked from already-gated admin pages, unchanged by this fix).

### Open questions / handoff notes

- **For `analyst` (Phase 6):** confirm this closes B-66 against intent — a stranded row should never require a manual SQL fix to recover, and should not silently disappear from the failed-count badge. Both are true post-fix, verified above via a live click-through, not just unit tests.
- **Worth carrying forward, not a blocker:** the implementer's own "Root cause of the underlying hazard is not fixable in application code" note is accurate — this bounds the damage window to 5 minutes rather than eliminating the possibility of a hard-crash-induced stranding. No further action needed unless a future review finds the 5-minute window catching stranded rows too slowly in practice, at which point the two existing reset points (bulk sweep, page view) are the levers to revisit, per the implementer's own note.
- No blocking findings. No loop-back required.

---

## Phase 6 — Shipped vs Intent — 2026-09-25

**Owner:** analyst
**Status:** complete

### Summary

**Verdict: SHIP WITH NOTES.** I traced the claim/settle/reset code directly (`route.ts`, `email-queue-stats.ts`, `page.tsx`, `view-email-dialog.tsx`) rather than relying on qa's report, and the invisibility is genuinely cured within a bounded, documented window — no manual SQL fix is ever required again. Two things keep this from a clean SHIP IT: the plan-tier assumption the 5-minute threshold rests on is documented only next to the constant itself, not anywhere a person changing the hosting plan or adding `maxDuration` would naturally look; and the badge's staleness predicate is a second, independent expression of "what counts as stale" alongside the shared reset function, which is fine today but is exactly the shape CLAUDE.md's duplication rule asks reviewers to watch.

### What I did

- Read `claimFailedRow()`/`settleClaim()`/`handleMissingApiKey()` in `src/app/api/admin/email-queue/retry/route.ts` directly: confirmed the atomic claim (`status='failed'` → `'retrying'`) now also stamps `retryingAt: now`, and every terminal branch (`sent`, `failed`, `blocked_non_production`, `dev_no_api_key`) clears `retryingAt: null` — none skipped.
- Read `resetStaleRetryingEmails()` and `getFailedEmailCount()` in `src/lib/email-queue-stats.ts` in full, including the doc comments explaining the 10-second-Hobby-cap / 30x-margin reasoning.
- Confirmed both call sites (`handleBulkRetry()` in the retry route, and `AdminEmailQueuePage` in `page.tsx`) call the one shared `resetStaleRetryingEmails()` function — not independent reimplementations — and that this runs after the page's `auth()`/`hasFeature(FEATURES.ADMIN_USERS)` gate, not before.
- Read `view-email-dialog.tsx`'s `StatusPill`: confirmed `retrying` renders as a distinct blue "Retrying…" chip (`rounded-full`, correctly a chip not a button per CLAUDE.md's UX guidelines), never falling through to an unlabeled or misleading state.
- Walked the actual timeline a user experiences (see Q1 below) rather than just accepting "self-heals" as a label.

### Answers to the assigned questions

1. **Is the invisibility actually cured, and what's the user-visible timeline?** Yes, bounded to `RETRY_STALE_MINUTES` (5). Concretely: a row that strands at `retrying` is not shown in any of the three `/admin/email-queue` sections and does not add to the failed-count badge for up to 5 minutes after the crash — which is correct, since a request that young could still genuinely be in flight and showing it as "failed" would invite a duplicate-send click. Past 5 minutes: the badge counts it immediately on the next admin page render anywhere in the admin area (a read-only `OR` in `getFailedEmailCount()`, no write needed), and the row itself flips back to `failed` and appears under "Failed Emails" the next time either `/admin/email-queue` is loaded or "Retry Failed Emails" is clicked — whichever happens first, with no admin action required to know something needs attention (the badge is passive). No manual SQL is ever required. This matches the fix's own stated goal and I verified it by reading the code paths, not by re-running qa's already-thorough manual click-through.

2. **The 5-minute threshold's coupling to Hobby tier's 10-second cap — is it documented where a person changing that would see it?** No, and this is a real gap. The reasoning lives entirely in `RETRY_STALE_MINUTES`'s doc comment in `src/lib/email-queue-stats.ts` — a file nobody would think to open while adding a `vercel.json`, setting `export const maxDuration`, or upgrading the Vercel plan. **Follow-up, concrete:** add a short cross-reference comment at the point a future change would actually happen — e.g., a one-line note in `next.config.ts` near where Vercel-specific config would go, or a bullet under CLAUDE.md's "Hosting must be cheap AND multi-maintainer" guidance — pointing back to `RETRY_STALE_MINUTES` and saying "if this project ever gets a longer function timeout, revisit this constant; it currently assumes the 10-second Hobby default." As written today, someone could raise the function timeout to 60s or 15 minutes and never learn that a 5-minute staleness window is now too short to guarantee it never races a live claim, until it does.

3. **Are the three reset/count sites the right shape, or early duplication?** Mostly right, one soft spot. The bulk sweep and the page load both call the single shared `resetStaleRetryingEmails()` function — that's correct reuse, not duplication (two callers of one function is exactly what CLAUDE.md wants). The badge (`getFailedEmailCount()`), however, does **not** call that function — by design, since it's a read-only path that must not carry a write — and instead re-expresses the same predicate (`status = 'retrying' AND retrying_at < cutoff`) as its own `OR` clause, sharing only the `staleRetryingCutoff()` cutoff-math helper. That's two independent expressions of "what counts as stale," which is below CLAUDE.md's "more than two places" trigger and is deliberately, reasonably shaped (an `UPDATE...RETURNING` and a `SELECT count(*)` genuinely need separate query bodies) — I'm not calling this a defect. But it's the seed of exactly the pattern CLAUDE.md's duplication rule warns about, and if a fourth site ever needs the same "is this row stale" predicate (e.g., a future dashboard widget), the next one should factor the predicate itself (not just the cutoff arithmetic) into something both a `db.update()` and a `db.select()` can share, rather than hand-copying the `and(eq(...), lt(...))` shape a third time.

### Edge cases

- Empty state: not applicable — no new page or section, only a new pill state on an existing table.
- Failure microcopy: pass — "Retrying…" is honest and non-technical; no stack traces surfaced.
- Permission gate: pass — confirmed both the retry route and the page still gate on `FEATURES.ADMIN_USERS` via `auth()` + `hasFeature()`, unchanged, with the new reset call placed after the gate in both cases.
- Brand consistency: pass — `StatusPill` correctly uses `rounded-full` (a status chip, not a button, so this is the correct exception per CLAUDE.md's UX guidelines), and reuses the existing color-mapping pattern rather than inventing a new one.
- Mobile: pass — qa's 360px screenshot check found no layout change introduced by this fix.

### Follow-ups (SHIP WITH NOTES)

1. Cross-reference `RETRY_STALE_MINUTES`'s hosting-tier assumption from a location a future plan/timeout change would actually touch (`next.config.ts` or CLAUDE.md's hosting section), not only from the constant's own file.
2. If a third caller ever needs "is this `email_queue` row stale" logic beyond the current update-sweep and read-only-count pair, factor the predicate itself into a shared query fragment rather than hand-copying it a third time — not needed today.

### Open questions / handoff notes

- None blocking. B-66 is closed — `docs/backlog.md` updated in this same pass.
- See the companion `2026-09-25-ack-letter-blocked-claim.md` entry for the cross-cutting position on whether B-70 should now gate new durable-claim email work — that discussion applies to this fix's family of defects too (a stranded claim is the same "a write that was supposed to happen didn't, and nothing noticed" shape), even though this particular fix doesn't touch `SendEmailResult`/`SendBulkMemberEmailResult` directly.
