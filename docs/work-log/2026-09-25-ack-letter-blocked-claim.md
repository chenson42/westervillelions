# Acknowledgment Letter Email Claim Collapses `blocked` Into `success` — Work Log

> **Slug:** `2026-09-25-ack-letter-blocked-claim`
> **Surface:** (dashboard) admin — Ledger, `/admin/ledger/donors/letters`
> **Permission(s):** existing `LEDGER_RECORD` covers the route — unchanged
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant — backlog **B-67**, DECISION-102's "known open violation," highest-stakes remaining instance of the defect class (subject is a donor receipt, not an internal email)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | **Skipped** | Bug real, fix preserves intended behavior — see note below | 2026-09-25 |
| 2 — Architectural review | architect | **Skipped** | Fix does not touch invariants beyond the caller-layer rule DECISION-102 already established | 2026-09-25 |
| 3 — Technical design | tech-lead | **Skipped** | Brief design captured inline below (root cause + ruling) rather than a separate doc — fix is confined to one module | 2026-09-25 |
| 4 — Implementation | api-developer | Complete | — | 2026-09-25 |
| 5 — Verification | qa | Complete | **PASS** | 2026-09-25 |
| 6 — Shipped vs intent | analyst | Complete | **SHIP WITH NOTES** | 2026-09-25 |

**No silent skips (CLAUDE.md):** Phases 1–3 are skipped per the CLAUDE.md bug-fix variant table — the bug is well-understood (DECISION-102 already diagnosed it and named the exact function), the fix doesn't introduce a new architectural shape (it reuses DECISION-102's own caller-layer rule and DECISION-085's `sendEmail()` contract unchanged), and the design question ("what does blocked mean here, and how do mixed batches behave") is answered in this document rather than a separate Phase 3 doc, per the "brief design or skip if trivial" allowance — this fix is not trivial (four new outcome combinations to reason through), so the reasoning is captured in full below rather than omitted.

---

## Root Cause

`emailAcknowledgmentLetters()` (`src/lib/ledger-acknowledgment-letter-queries.ts`) claims a donor
acknowledgment as sent **before** sending (`UPDATE ... SET sent_at = now() WHERE sent_at IS NULL
RETURNING id`), then decides whether to keep or revert that claim based on
`addresses.some((a) => a.success)`. `sendEmail()`'s non-production guard
(`shouldBlockNonProductionSend()`, DECISION-085) returns `success: true` on a *blocked* send —
deliberately, so ordinary callers behave identically in dev and production. But `success: true`
on the blocked path made `anySucceeded` true for a fully-blocked batch too, so the claim stuck
for a donor acknowledgment that was **never handed to Resend at all**. Because the claim is
deliberately permanent (a donor must never receive two receipts), that row became permanently
un-resendable outside production — the exact shape DECISION-102 catalogued as defect #4's sibling,
timing inverted (claim-before-send here vs. claim-after-send in the financial-report case) and
higher stakes (a donor receipt, not an internal board email).

## Reproduction (pre-fix)

1. In a non-production environment with no relevant address in `EMAIL_DEV_ALLOWLIST` (the normal
   case — donor addresses are never allowlisted).
2. Generate a letter for an acknowledgment, then call `POST
   /api/admin/ledger/acknowledgments/letters/email` for it.
3. `sendBulkMemberEmail()` → `sendEmail()` reports `success: true, blocked: true` for the
   donor's address (nothing reaches Resend).
4. Pre-fix: `anySucceeded` is `true` (blocked reads as success) → the ack's `sent_at`/`sent_via`
   claim is kept, response says `status: "emailed"`.
5. The row is now permanently claimed. `sentAt !== null` blocks every future call at guard #2
   ("already sent") — there is no way to re-send it, ever, in that environment or after promoting
   to production, without a manual DB fix.

## The Design Question, Answered

**What should "blocked, not delivered, not failed" mean for an acknowledgment letter?**

Ruling: **blocked is not success, and blocked is not failure — it is its own third outcome, and
whether it changes the ack-level result depends entirely on whether anything else in the same
batch actually delivered.**

- **Any address delivered → still "emailed," unchanged.** A donor who received the letter at one
  of several addresses did receive it (Phase 1's original partial-failure rule, extended
  unchanged to a third category). A blocked or failed sibling address is surfaced in that ack's
  per-address detail, never promoted to a separate top-level outcome.
- **Zero delivered, and at least one address genuinely failed (a real send was attempted and
  rejected by Resend) → "failed," exactly as before.** This is deliberately NOT collapsed with
  "blocked" even when the batch also contains a blocked address — a genuine rejection is
  worth surfacing distinctly from "the environment never let this leave the building," and
  keeping "failed" meaning exactly what it meant before is a strict no-regression requirement.
- **Zero delivered, zero genuinely failed, every address blocked → new status, "blocked."** Revert
  the claim, same as "failed" does. The reasoning: the claim exists solely to prevent a donor
  receiving a duplicate of something that actually went out. If nothing went out, there is
  nothing to duplicate — holding the claim protects no one and permanently disables a legitimate
  future send. This is the one-line fix to B-67's actual defect: previously "at least one address
  reported success" (which blocked sends always do) kept the claim; now "at least one address
  reported success **and was not blocked**" (i.e., genuinely delivered) is what keeps it.

**Mixed batches**, worked through explicitly per the task's callout:
| Delivered | Failed | Blocked | Outcome | Claim |
|---|---|---|---|---|
| ≥1 | any | any | `emailed` | kept |
| 0 | ≥1 | any | `failed` | reverted |
| 0 | 0 | ≥1 | `blocked` (new) | reverted |

Results stay regrouped by **array index** against the parallel `{ackId, to}` tracking array, never
by address string — unchanged from the existing (correct) approach, since two donors can share one
address and this fix doesn't touch that mechanism.

## Why a DB read-back instead of reading `sendResult.blocked` directly

The task's framing assumes direct access to `sendEmail()`'s `blocked?: true` field. In this module
that access doesn't exist: `emailAcknowledgmentLetters()` calls `sendBulkMemberEmail()`, not
`sendEmail()` directly (correctly, per DECISION-085 — "bulk member mail must go through
`sendBulkMemberEmail()`, never a hand-rolled loop"), and `sendBulkMemberEmail()`'s per-recipient
result type (`{ to, success, error?, emailQueueId }`) does **not** forward `sendEmail()`'s
`blocked` field at all. Reading `sendResults[i].blocked` is not possible without changing
`src/lib/email.ts`, which this task explicitly puts out of scope (a concurrent agent may be
working there).

Two alternatives were considered and rejected:

1. **Re-derive blocked-ness by importing `shouldBlockNonProductionSend()`** from
   `src/lib/email-guard.ts` and calling it locally before sending. Rejected: it's
   environment-sensitive (`NODE_ENV !== "production"`) and would misclassify every send as
   "blocked" under Vitest regardless of what a test scripted `sendBulkMemberEmail()` to return,
   since `bulk: true` unconditionally blocks in any non-production `NODE_ENV`. It would also
   duplicate a predicate that already lives in exactly one place for exactly this reason
   (`email-guard.ts`'s own doc comment) — adding a second read site for the same fact split
   across two files is the kind of duplication CLAUDE.md's review rule flags.
2. **Add `blocked` to `SendBulkMemberEmailResult`** in `src/lib/email.ts` — the natural,
   minimal, correct fix, and the direct continuation of how `SendEmailResult.blocked` itself was
   added. Rejected only because the task marks `src/lib/email.ts` out of scope for this change.
   **Recommended as the real fix** — see Follow-Ups.

What was implemented instead: after `sendBulkMemberEmail()` resolves, the code queries
`email_queue` for the `status` of every `emailQueueId` the batch returned, and treats
`status === 'blocked_non_production'` as blocked. This is not an inference — it is the literal,
persisted fact `sendEmail()` itself wrote for that exact purpose (`blocked_non_production` is a
value only that one code path sets), read back from the single source of truth the `blocked`
field exists to summarize. It required zero changes to `sendEmail()`, `sendBulkMemberEmail()`, or
`email-guard.ts`, and — because the hermetic test mock's `db.select()` queue defaults to `[]` when
nothing is pushed — every pre-existing test for this function needed **zero changes** to keep
passing: the new lookup simply returns nothing extra unless a test explicitly stages a
`blocked_non_production` row.

## What I Did

- `src/lib/ledger-acknowledgment-letter-queries.ts`:
  - `EmailLetterResult` gains a fourth variant: `{ ackId, status: "blocked", reason }`.
  - The `"emailed"` variant's `addresses` entries gain an optional `blocked?: true` field.
  - `emailAcknowledgmentLetters()`'s Step 4 now: (a) reads back `email_queue.status` for every
    `emailQueueId` the batch produced, (b) classifies each address as
    delivered / failed / blocked per the table above, (c) decides `emailed` / `failed` / `blocked`
    at the ack level per the ruling, reverting the claim for both `failed` and the new `blocked`
    case, keeping it only when something genuinely delivered.
  - Doc comments above the function and above the amended Step 4 block spell out the ruling and
    the DB-read-back rationale in place, so a future maintainer doesn't have to reconstruct it
    from this work-log.
- `src/app/api/admin/ledger/acknowledgments/letters/email/route.ts`: response-shape doc comment
  updated to document the new `"blocked"` status alongside `"skipped"`/`"failed"`.
- `src/lib/ledger-acknowledgment-letter-queries.test.ts`: five new tests (see Outputs).
- No UI changes. `AcknowledgmentLetterSelector`
  (`src/components/admin/ledger/acknowledgment-letter-selector.tsx`) already renders any
  non-`"emailed"` result generically via `r.reason` (`notSentCount` = everything not `"emailed"`,
  a bulleted list of `{donorName} — {r.reason}`), so the new `"blocked"` status renders correctly
  with zero component changes. The existing microcopy ("Emailed" means accepted for sending, not
  delivery-confirmed — B-47) is unaffected and still accurate: a `"blocked"` result was never even
  accepted for sending, so it was never at risk of being described as delivered.

## Outputs

- **Endpoint (unchanged contract, extended response union):** `POST
  /api/admin/ledger/acknowledgments/letters/email` — same auth/gate (`LEDGER_RECORD`), same
  request body (`{ ackIds: string[] }`). Response `results[]` now includes a fourth possible shape:
  `{ ackId: string; status: "blocked"; reason: string }`, alongside the existing `"emailed"`
  (now `addresses[].blocked?: true` optionally present), `"skipped"`, and `"failed"` shapes.
- **Schema/migration:** none. No new tables or columns — the fix reads the existing
  `email_queue.status` column, already populated by `sendEmail()`.
- **Files touched:**
  - `src/lib/ledger-acknowledgment-letter-queries.ts`
  - `src/app/api/admin/ledger/acknowledgments/letters/email/route.ts` (doc comment only)
  - `src/lib/ledger-acknowledgment-letter-queries.test.ts`
- **Guardrail proof (DECISION-085's 17 `sendEmail()`/`email-guard` tests untouched):**
  `git diff --stat -- src/lib/email.ts src/lib/email-guard.ts
  src/app/api/admin/email-queue/retry/route.ts` (and their `.test.ts` siblings) returns **empty** —
  none of those files were opened for writing in this change. (`src/lib/db/schema.ts` shows an
  unrelated diff — `retryingAt` on `email_queue` — from a concurrent agent's
  `2026-09-25-retry-stranding` work; not touched or reviewed by this fix.)
- **Tests added (5), each named for the behavior it proves:**
  1. *"a fully blocked send does NOT leave the claim in place, reports 'blocked' ... and the
     letter is re-sendable afterward — fails against pre-fix code"* — the primary regression test.
     Verified failing against pre-fix logic before writing the fix (pre-fix: `anySucceeded` is
     `true` for the blocked address, so this test's first assertion — `status: "blocked"` — would
     instead see `status: "emailed"`, and the claim would never be reverted, so the retry portion
     of the test would fail at the "already sent" guard).
  2. *mixed batch, one delivered + one blocked → still "emailed"* — the "delivered anywhere wins"
     rule, extended to the third category.
  3. *mixed batch, zero delivered, one genuinely failed + one blocked → "failed," not "blocked"* —
     proves failed and blocked don't collapse into each other when mixed.
  4. *genuine total failure (nothing blocked) still reverts and reports "failed"* — no-regression
     check.
  5. *genuine full success (nothing blocked) still keeps the claim and reports "emailed"* —
     no-regression check ("a donor must still never get two receipts").
  - Test count: **2154 → 2159** (5 new, all passing; 124/124 test files pass).

## Gates

- `pnpm exec tsc --noEmit`: **PASS** (no output).
- `pnpm lint`: **PASS** — 0 errors. 1 pre-existing warning in
  `src/components/admin/ledger/budget-context-panel.tsx` (unused eslint-disable directive),
  unrelated to this change and not touched by it.
- `pnpm test`: **PASS** — 2159/2159 tests, 124/124 files.
- `pnpm build:only`: **PASS** — production build completed, all routes compiled.

## Further Instance of the Defect Class Found

**`SendBulkMemberEmailResult` (`src/lib/email.ts`) does not forward `sendEmail()`'s `blocked`
field at all.** Every caller of `sendBulkMemberEmail()` that ever writes a durable claim — not
just this one — has no direct way to distinguish blocked from delivered without doing what this
fix did (re-derive it from `email_queue.status` via the returned `emailQueueId`, which works but
is a workaround, not the sanctioned path `DECISION-102` describes). This wasn't caught earlier
because `emailAcknowledgmentLetters()` is (to my knowledge, per DECISION-102's own "known open
violation" note) the *only* durable-claim caller that goes through `sendBulkMemberEmail()` today;
a future one (e.g., a bulk dues-receipt or bulk-statement feature) would hit the identical gap.
Filed as a follow-up rather than fixed here, since `src/lib/email.ts` is explicitly out of scope
for this change.

## Open Questions / Handoff Notes

- **For `api-developer` (a future pass) or whoever owns `src/lib/email.ts` next:** add
  `blocked?: true` to `SendBulkMemberEmailResult`'s per-recipient shape in
  `sendBulkMemberEmail()`, mirroring `SendEmailResult.blocked` exactly (additive, optional, only
  set on the blocked path). Once that lands, this file's Step 3b (the `email_queue` read-back)
  becomes unnecessary and should be replaced with a direct `sendResults[i].blocked` read — leaving
  it in place after that fix ships would be the exact kind of duplicated-decision drift CLAUDE.md's
  code-review rule flags. Recommend filing this as a named backlog item (e.g., alongside B-70,
  which already tracks making the `blocked` contract enforceable at the type level) rather than
  doing it inline here, since it touches a file explicitly marked out of scope for this task.
- **For `qa` (Phase 5):** this is a bug-fix variant — reproduce the original bug against the
  pre-fix `emailAcknowledgmentLetters()` (a fully-blocked batch keeps its claim and reports
  "emailed"), then confirm the fix removes it (reports "blocked," reverts the claim, and a retry
  succeeds). The five new unit tests already exercise this; a manual click-through isn't
  necessary for this one (no UI changes), but confirm the admin Ledger → Donors → Letters screen
  still renders a `"blocked"` result sensibly (it should, via the existing generic
  `r.reason` rendering — verify no console error, since `"blocked"` is a new discriminant value
  the component's TypeScript narrowing hasn't been exercised against before).
- **For `analyst` (Phase 6):** confirms this closes B-67 and matches DECISION-102's stated intent
  (a caller holding a durable claim must branch on the full three-way outcome). Also worth noting
  in that review: DECISION-102 assumed direct `blocked` field access for every durable-claim
  caller; this fix's DB read-back is a documented, narrower workaround specific to
  `sendBulkMemberEmail()`-based callers, not a new general pattern — don't let it get copied
  elsewhere without first checking whether `SendBulkMemberEmailResult.blocked` has landed by then.

---

## Phase 5 — Verification — 2026-09-25

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** The fix is correctly scoped, matches the ruling table in the root-cause section exactly, and does not regress either safety property the atomic claim exists for. The primary regression test was independently confirmed to fail against pre-fix code (reverted `emailAcknowledgmentLetters()`, re-ran the suite: 3 of 5 new tests fail with exactly the collapse-into-`emailed` symptom the work-log describes) and pass against the fix. DECISION-085's guardrail files (`src/lib/email.ts`, `src/lib/email-guard.ts`) are byte-identical to `HEAD` — confirmed by `git diff`, not inferred. The `email_queue`-status-read-back workaround was checked against the actual reachable state space for a `sendBulkMemberEmail()`-based caller and found correct, not merely plausible.

### What I did

- Ran the shared gate suite (covers both Piece A and Piece B, since both landed in the same working tree): `pnpm exec tsc --noEmit` (clean), `pnpm lint` (0 errors, 1 pre-existing unrelated warning in `budget-context-panel.tsx`), `pnpm test` (2171/2171, 125/125 files), `pnpm build:only` (clean, all routes compiled, no warnings).
- Read `src/lib/ledger-acknowledgment-letter-queries.ts` in full (the `emailAcknowledgmentLetters()` function and its doc comment) and cross-checked the implementation against the ruling table in this work-log's "The Design Question, Answered" section, address by address: `anyDelivered` gates the keep-claim path exactly as `success && !blocked`; `anyGenuinelyFailed` is `!success && !blocked`, correctly excluding blocked addresses from "genuine failure"; the revert-vs-keep branch and the `failed`-vs-`blocked` branch match the table's four rows.
- **Regression proof, reproduced independently (not just re-reading the implementer's claim):** `git stash push` on `ledger-acknowledgment-letter-queries.ts` only (keeping the new tests in place), ran `pnpm exec vitest run src/lib/ledger-acknowledgment-letter-queries.test.ts` — 3 of 5 new tests failed against pre-fix code:
  - the crux test ("a fully blocked send does NOT leave the claim in place…") — pre-fix reports `status: "emailed"` with the blocked address shown as `success: true`, exactly the defect description.
  - the delivered+blocked mixed test — pre-fix shows the blocked address as `success: true` (no `blocked` flag), i.e. the per-address detail itself lies about delivery, not just the top-level status.
  - the failed+blocked mixed test — pre-fix reports `"emailed"` instead of `"failed"`, because the blocked address's `success: true` alone was enough to satisfy `anySucceeded`.
  - The other 2 new tests (genuine total failure, genuine full success — the "nothing blocked" no-regression cases) pass unmodified pre-fix and post-fix, which is itself evidence the fix didn't perturb the two safety properties that predate it.
  - `git stash pop` restored the fix; re-ran the full suite to confirm 2171/2171 green again.
- **No-regression check on the two safety properties, read directly from the code, not inferred from tests passing:** a genuine full success (`anyDelivered` true, nothing blocked) still takes the `emailed` branch and never runs the revert `UPDATE` — the claim is permanent, so a donor still cannot receive two receipts. A genuine total failure (`anyGenuinelyFailed` true, nothing delivered) still takes the `failed` branch — identical revert `UPDATE`, identical guard (`sentVia = 'email'`), identical reason string — verified by diff that this code path is unchanged in shape, only re-labeled from `anySucceeded` to `anyDelivered`/`anyGenuinelyFailed`.
- **Mixed-batch and by-index-not-by-address checks:** read Step 4's `meta`/`sendResults` zip — unchanged from before this fix (still array-index, never address-string), confirmed by diff that the only change to that loop is adding the `blocked` lookup and flag, not the zip mechanism itself. The delivered+blocked and failed+blocked test cases (read above) match the ruling table's mixed-batch row.
- **Assessed the DB read-back workaround (Step 3b) for correctness and robustness, not just "does it pass its own tests":**
  - Traced `sendBulkMemberEmail()` → `sendEmail()` → `shouldBlockNonProductionSend(to, { bulk: true })` (`src/lib/email-guard.ts`). Because `sendBulkMemberEmail()` unconditionally passes `_bulkMemberSend: true` for every recipient, and `shouldBlockNonProductionSend()` returns `Boolean(opts.bulk) || !isDevAllowedRecipient(to)`, a bulk send outside production is **always** blocked regardless of the allowlist — confirmed by reading both functions, not assumed. This means the only two terminal statuses a `sendBulkMemberEmail()`-based non-production call can ever produce are `blocked_non_production` and (in the exceedingly rare case a permanent Resend rejection happens... which can't happen outside production since the guard fires first) — in practice, outside production, every candidate is always `blocked_non_production`, and the `failed`/`sent` statuses are only reachable in production. **`dev_no_api_key` is unreachable via this caller**, because the blocked-guard check runs before the missing-API-key check and the bulk flag always trips it first outside production — so the workaround's binary `status === 'blocked_non_production'` check is checking the only non-terminal-success status this caller can actually see, not an incomplete enumeration.
  - Checked whether a missing/deleted `email_queue` row could silently misclassify a blocked send as delivered (the `blockedQueueIds.has(...)` check defaults to "not blocked" when a row isn't found). `emailQueueId` is a required, non-optional `string` on both `SendEmailResult` and `SendBulkMemberEmailResult`'s per-recipient shape (every return path in `sendEmail()` sets it from `queued.id`, inserted before any guard runs), so the `.filter((id): id is string => Boolean(id))` defensive filter never actually drops an entry in practice. Grepped the whole `src/` tree for any `delete(emailQueue)` call — **none exist** — so a queue row can never disappear between the send and the read-back. The "missing row" failure mode is theoretical, not reachable in this codebase today; if a future migration ever adds row deletion/archival for `email_queue`, this read-back would need re-auditing, and I've noted that below rather than treating it as fixed.
  - Confirmed the classification does not depend on `NODE_ENV` at all — it reads the already-persisted `status` string, which in tests is whatever the test staged via `mockDbState.selectQueue.push(...)`. This is exactly why the suite's own hermetic mocks don't misclassify every send as blocked under Vitest (the pitfall the work-log explicitly called out and rejected as an alternative design) — verified by reading the test file's mock setup, not just trusting the claim.
- Confirmed `git diff --stat -- src/lib/email.ts src/lib/email-guard.ts` (and their `.test.ts` siblings) is **empty** — these files are byte-identical to `HEAD`, i.e. genuinely untouched by this fix, matching the DECISION-085 guardrail requirement.
- Read `src/components/admin/ledger/acknowledgment-letter-selector.tsx` end to end: the "Emailed" copy still explicitly disclaims delivery confirmation (B-47 compliant, "Delivered" does not appear anywhere), and the non-`"emailed"` branch renders `r.reason` generically for `"skipped"` / `"failed"` / `"blocked"` alike — the production build's clean TypeScript compile confirms the new `"blocked"` discriminant narrows correctly with zero component changes required, as the implementer predicted.
- No e2e run for this piece specifically (no UI changed; the task's shared Gates section didn't call for a `pnpm test:e2e` pass for either piece, and this fix has no user-facing surface beyond a response-shape addition already covered by unit tests and the component read above).

### Outputs

- No source files touched by qa — verification only. Confirmed `git status` is unchanged from session start after all reverts/pops (`git stash pop` restored `ledger-acknowledgment-letter-queries.ts` to the implementer's exact diff).
- Scratch verification scripts (drizzle SQL-shape probe, dev-DB row insert/check/cleanup for Piece B) were created under a local `.qa-scratch/` directory and deleted before finishing; nothing from that directory was committed or left behind.

#### Type Check
`pnpm exec tsc --noEmit`: **PASS** (no output)

#### Unit Tests
`pnpm test`: **PASS**
Total: 2171 | Passed: 2171 | Failed: 0
Duration: ~4s
Failures: none

#### Production Build
`pnpm build:only`: **PASS**
Notes: all routes compiled (public + admin + member portal + API), no warnings beyond the pre-existing unrelated ESLint one; route count consistent with the pre-existing route tree (no new routes added by this fix).

#### End-to-End Tests
`pnpm test:e2e`: **Not run** — not requested in this task's shared Gates section, and this fix touches no Playwright-covered flow directly (response-shape change only, no new UI). Not treated as a gap since the crux behavior is unit-test-covered and independently reproduced above.

#### Manual Click-Through
Not required for this piece — no UI changes, per the implementer's own note and confirmed by reading `acknowledgment-letter-selector.tsx` (renders the new `"blocked"` status via the existing generic branch).

#### Regression Tests Added
(By the implementer, verified by qa — reproduced failing pre-fix and passing post-fix per the discipline in CLAUDE.md)
- *"a fully blocked send does NOT leave the claim in place, reports 'blocked' … and the letter is re-sendable afterward — fails against pre-fix code…"* — `src/lib/ledger-acknowledgment-letter-queries.test.ts:725` — guards against: B-67, a blocked (non-production) send satisfying the durable "sent" claim.
- Mixed delivered+blocked → `emailed` — `src/lib/ledger-acknowledgment-letter-queries.test.ts:782` — guards against: a blocked sibling address being promoted to a top-level outcome instead of per-address detail.
- Mixed failed+blocked, zero delivered → `failed` (not `blocked`) — `src/lib/ledger-acknowledgment-letter-queries.test.ts:818` — guards against: a genuine rejection being swallowed by the new `blocked` category.
- Genuine total failure (no blocking) still reverts and reports `failed` — `src/lib/ledger-acknowledgment-letter-queries.test.ts:847` — guards against: regression on the pre-existing failure path.
- Genuine full success (no blocking) still keeps the claim and reports `emailed` — `src/lib/ledger-acknowledgment-letter-queries.test.ts:876` — guards against: regression on the pre-existing success path (a donor must never get two receipts).

#### Coverage on Critical Modules
- `src/lib/ledger-acknowledgment-letter-queries.ts`: not separately measured in isolation (this codebase's coverage targets in the qa charter name `events.ts`/`permissions.ts`/`members.ts` specifically); the function under test has 40 tests across its full surface after this change, all passing, covering every branch of the new three-way outcome logic identified above.
- `src/lib/email.ts` / `src/lib/email-guard.ts`: unchanged by this fix; DECISION-085's existing 17 tests continue to cover them, untouched (confirmed by diff).

#### Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `POST /api/admin/ledger/acknowledgments/letters/email` | yes | yes | `FEATURES.LEDGER_RECORD` — unchanged by this fix (route.ts diff is a doc-comment addition only, confirmed by reading the full diff); this is the same gate the sibling generate/print/mark-sent actions on this screen already use, appropriate since acknowledgment letters and their send status are ledger-record-scoped data. |

This fix adds no new route and no new server action — it only extends the response union of an existing, already-gated endpoint. No gate change was in scope or made.

### Open questions / handoff notes

- **For `analyst` (Phase 6):** confirm this closes B-67 against the Phase 1 intent recorded in DECISION-102 (a durable-claim caller must branch on the full three-way outcome, never on `success` alone). Worth explicitly re-affirming in that review: the DB-read-back workaround is documented as caller-specific to `sendBulkMemberEmail()`-based callers and not a general pattern — qa's audit above confirms it's *correct* for this caller today (because `dev_no_api_key` is structurally unreachable via the bulk path), but that correctness argument would need re-verification if `SendBulkMemberEmailResult.blocked` lands later (B-70/the follow-up named in this work-log) or if `email_queue` ever gains a deletion/archival path — neither exists today, but a future reviewer copying this workaround into a new caller should not assume the same reachability argument holds without re-checking it for that caller's own call shape.
- No blocking findings. No loop-back required.

---

## Phase 6 — Shipped vs Intent — 2026-09-25

**Owner:** analyst
**Status:** complete

### Summary

**Verdict: SHIP WITH NOTES.** I re-read `emailAcknowledgmentLetters()` and its callers independently of qa's own re-verification (not just re-reading their report) and confirm the fix delivers exactly what B-67/DECISION-102 required: a blocked send can no longer masquerade as a delivered receipt, and the claim reverts whenever nothing actually left the building. The fix is small, correctly scoped, and the five new tests pin the real defect (verified failing pre-fix independently by qa, and I traced the branch logic against the ruling table line by line). Two notes accompany the ship, neither blocking: the microcopy shown to a treasurer for the new `"blocked"` state carries more infrastructure jargon than it needs to, and the DB-read-back workaround rests on an implicit, untested coupling to `sendBulkMemberEmail()`'s current behavior.

### What I did

- Re-read `src/lib/ledger-acknowledgment-letter-queries.ts` Step 3b/Step 4 directly (not from the work-log's paraphrase) and confirmed the three-way outcome table is implemented exactly as specified: `anyDelivered` (⇒ `emailed`, claim kept), `anyGenuinelyFailed` with zero delivered (⇒ `failed`, claim reverted), all-blocked with zero delivered (⇒ `blocked`, claim reverted). Confirmed the per-address `success` flag is corrected to `false` for a blocked address (`sendResult.success && !blocked`), so the per-address detail itself no longer lies about delivery — this was one of the three failure modes qa's independent pre-fix repro caught, and it's fixed at the source, not just at the top-level status.
- Confirmed `SendBulkMemberEmailResult` (`src/lib/email.ts:345`) still has no `blocked` field — the workaround's stated reason for existing is real, not a convenience. Read `shouldBlockNonProductionSend()` and confirmed (independently of qa's trace) that `_bulkMemberSend: true` makes the guard unconditional (`Boolean(opts.bulk) || !isDevAllowedRecipient(to)`) outside production, which is what makes the binary `blocked_non_production` read-back exhaustive for this caller today.
- Read `src/components/admin/ledger/acknowledgment-letter-selector.tsx`'s email-results panel end to end. Confirmed the `"blocked"` result renders through the same generic `{donorName} — {r.reason}` branch as `"failed"`, with no special-casing needed, and that the "Emailed" disclaimer (B-47) is untouched and still accurate.
- Checked the two invariant halves from CLAUDE.md's own Acknowledgment Letter Email section against the code, not just the work-log's restatement of them.

### Answers to the assigned questions

1. **Does behavior now match the CLAUDE.md invariant (both halves)?** Yes. "A donor must never receive one receipt twice" — the claim is still permanent and is kept only on `anyDelivered`, unchanged in shape from before this fix. "Nor have a row claim 'sent' when nothing arrived" — the claim now reverts for *both* zero-delivered outcomes (`failed` and the new `blocked`), where before it only reverted for `failed`. Both halves hold, verified by reading the branch logic directly rather than trusting the description.

2. **Is `"blocked"` legible to a treasurer with no idea what `EMAIL_DEV_ALLOWLIST` is?** Partially. The shown reason is *"delivery blocked outside production for all addresses — nothing was sent, not marked sent, safe to retry."* The actionable part is clear (nothing sent, safe to retry, no receipt was skipped) — a treasurer doesn't need to act differently on it than on `"failed"`. But "outside production" is infrastructure vocabulary that will read as noise to someone whose mental model is "did the letter go out or not." Since this state is designed to essentially never appear in production, I'm not blocking on it, but it's a real, named gap: **follow-up — reword the `"blocked"` reason string for a non-technical reader** (e.g., "not sent — this system is running in a test mode and didn't actually send mail; try again once it's live"), and treat any *production* occurrence of this status as itself a signal worth alerting on, since production should structurally never produce it.

3. **Is the DB read-back workaround durable, or an implicit coupling a future change could silently break?** Taking a position: **it is correct today and fragile going forward, and there is no test pinning the assumption that makes it correct.** Its correctness rests on two facts neither of which is asserted anywhere as a contract: (a) `sendBulkMemberEmail()` unconditionally sets `_bulkMemberSend: true` for every recipient, and (b) `shouldBlockNonProductionSend()` treats `bulk: true` as an unconditional block outside production, making `dev_no_api_key` structurally unreachable via this path. Both are true by reading the current code, but nothing stops a future change to either function (e.g., a per-recipient override flag, or a change to when the API-key check runs relative to the bulk check) from making `dev_no_api_key` reachable again through `sendBulkMemberEmail()` — at which point this workaround's binary `blocked_non_production`-or-not classification would silently misclassify a real "no API key" outcome as "delivered," reopening a defect in this exact class. **Recommended fix, concrete:** add one test to `src/lib/email.test.ts` (or wherever `sendBulkMemberEmail()` is tested) asserting that outside production, `sendBulkMemberEmail()` never yields a queue status other than `blocked_non_production` or a genuine delivery/failure — i.e., pin the reachability argument qa made by hand into a test that breaks loudly the day it stops being true. This is a small, targeted addition, not a redesign, and it protects the workaround specifically until B-70's extension (propagating `blocked` through `SendBulkMemberEmailResult`) removes the need for it entirely.

### Edge cases

- Empty state: not applicable — no new UI surface.
- Failure microcopy: pass, with the note above (jargon, not incorrectness).
- Permission gate: pass — `FEATURES.LEDGER_RECORD`, unchanged, confirmed by reading the route diff (doc-comment only).
- Brand consistency: pass — no new UI; existing `rounded-2xl` panel and generic list rendering reused as-is.
- Mobile: not applicable — no layout change.

### Follow-ups (SHIP WITH NOTES)

1. Reword the `"blocked"` reason string shown to treasurers to drop infrastructure jargon ("outside production") in favor of plain "this didn't actually send" language. Low urgency (state should not occur in production) but should ride along with any future touch of this screen.
2. Add a pinning test asserting `sendBulkMemberEmail()` outside production only ever produces `blocked_non_production` or a genuine terminal outcome, never `dev_no_api_key` — protects the Step 3b workaround from silently breaking if `shouldBlockNonProductionSend()` or `sendBulkMemberEmail()`'s bulk-flag behavior ever changes. File alongside B-70.
3. See the cross-cutting B-70 position below — do not let a sixth durable-claim caller ship using a hand-rolled workaround before B-70's discriminated-union (or equivalent) lands.

### Open questions / handoff notes

- None blocking. B-67 is closed — `docs/backlog.md` updated in this same pass.

---

## Cross-Cutting: Is the Defect Class Under Control? (also see the companion `2026-09-25-retry-stranding.md` entry)

DECISION-102 named four instances found in one day; B-67 (this entry) is a fifth, and it shipped only by hand-deriving a workaround because the type system still lets a caller ignore `blocked`. That is not a controlled pattern — it is a pattern currently *contained* by the fact that every instance so far has been caught by careful, deliberate review (qa's own re-verification independently reproduced this one, and B-67 itself was found while fixing a *different* instance, not by a systematic search). Five instances of the same shape in a single day is not a rate that "code review will keep catching" indefinitely; it is a rate that argues the type should stop permitting the mistake.

**My position: B-70 should now block any *new* durable-claim email caller — not the whole pipeline.** Concretely: if a future feature introduces a new place that writes a durable "this was sent" claim (a new acknowledgment type, a new bulk-notification feature, anything with an append-only or partial-unique-indexed "sent" row), Phase 2/3 review should treat "does this go through `sendEmail()`/`sendBulkMemberEmail()` and can it obey DECISION-102's caller rule without a hand-rolled `email_queue` read-back" as a gating question, and should not accept a sixth copy of B-67's workaround as the answer. This doesn't block unrelated work elsewhere in the app, and it doesn't require reopening today's two fixes — both are correct, tested, and worth shipping now. But B-70 (the discriminated-union redesign, already scoped to include propagating `blocked` through `SendBulkMemberEmailResult`) should be scheduled promptly, not left to compete indefinitely with feature work, given the rate at which this shape keeps recurring.
