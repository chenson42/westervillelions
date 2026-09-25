# Durable-Claim Email Result Type (B-70) — Work Log

> **Slug:** `2026-09-25-send-result-type`
> **Surface:** none (internal — `src/lib/email.ts` and its two durable-claim callers; no route, no page, no permission)
> **Permission(s):** none — no new `FEATURES` key, no user-facing surface
> **Estimated complexity:** small (4 files touched: `src/lib/email.ts`, new `src/lib/email-durable-claim.ts`, `src/lib/financial-report-send.ts`, `src/lib/ledger-acknowledgment-letter-queries.ts`) — the other ~16 `sendEmail()`/`sendBulkMemberEmail()` call sites are untouched by design
> **Pipeline mode:** Accelerated — Phase 1 brief, Phase 2 skipped (rationale below). This is a type-safety hardening of already-shipped, already-diagnosed behavior (DECISION-102), not a new feature with a new user flow.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped (see note) | — | 2026-09-25 |
| 2 — Architectural review | architect | Skipped (see note) | — | 2026-09-25 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-09-25 |
| 4 — Implementation | api-developer | Complete | complete | 2026-09-25 |
| 5 — Verification | qa | Complete | PASS | 2026-09-25 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-09-25 |

---

# Phase 1 — Functional Refinement (analyst)

**Skipped, with notation, per explicit orchestrator instruction to go directly to Phase 3.** This is not a silent skip: the functional shape was already fully established by three prior documents, and I re-read all of them before writing this design rather than treating the skip as license to skip the analysis:

- DECISION-102 (`docs/decisions.md`) — names the exact defect shape and the two-layer rule.
- `docs/work-log/2026-09-25-ack-letter-blocked-claim.md` Phase 6 — the analyst's own "Cross-Cutting: Is the Defect Class Under Control?" section explicitly asks for this ticket and states its scope: block any *new* durable-claim email caller, propagate `blocked` through `SendBulkMemberEmailResult`.
- `docs/work-log/2026-09-25-retry-stranding.md` Phase 6 — confirms the same defect family and defers to the ack-letter entry's cross-cutting position.
- `docs/backlog.md` B-70 (including the post-B-67 extension) — the literal ticket text, candidate options (a)/(b)/(c), and the explicit requirement that `SendBulkMemberEmailResult` be in scope.

There is no new user-facing flow here (no page, no permission, no email copy change), so there are no "user verbs" or "flows" to refine in the Phase-1 sense. The one open functional question — "should `dev_no_api_key` be treated the same as `blocked_non_production` for a durable claim?" — is answered in this design's Rationale/Edge Cases below with a concrete, code-traced finding, not left open.

# Phase 2 — Architectural Review (architect)

**Skipped, with notation.** No new top-level directory, no new npm dependency, no change to the server/client boundary (this is server-only `src/lib` code with zero UI). The one structural choice — a new file, `src/lib/email-durable-claim.ts`, alongside `src/lib/email.ts` — mirrors an existing, already-architect-blessed pattern in this codebase (`financial-report-send.ts` kept separate from `financial-report-queries.ts`; `reconciliation-queries.ts` separate from `ledger-queries.ts`, both DECISION-049): a focused write/contract module living next to the broader helper it depends on, not a new module tree. This design does not weaken, widen, or narrow DECISION-085's contract — `sendEmail()` and `sendBulkMemberEmail()`'s existing return shapes are extended additively only (see Rationale). If the architect wants to review the new file's placement specifically, that can happen at Phase 4 review without blocking implementation start, since it is a placement question, not a shape question.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Five defects of one shape shipped in a single day (DECISION-102): code that recorded an email as sent when it was not. Two of those defects were callers — `sendMonthlyReportToBoard()` and `emailAcknowledgmentLetters()` — that had `sendEmail()`'s honestly-reported `{ success: true, blocked: true }` in hand and still wrote (or nearly wrote) a permanent "sent" claim from the bare `success` flag alone. `blocked` already existed as an optional field before both of the last two defects were found, and it still wasn't enough — B-67 needed a hand-rolled DB read-back workaround to get the *bulk* case right, because `SendBulkMemberEmailResult` doesn't forward `blocked` at all. An optional field on an otherwise-ordinary result type is a fact a caller can always choose not to look at.

This design does two things. First, it closes a **sixth, previously-undiscovered instance** of the same defect class that I found while tracing this: `sendEmail()`'s `dev_no_api_key` branch (non-production, no `RESEND_API_KEY`, recipient already allowlisted) returns `success: true` with **no** `blocked` field at all — a durable-claim caller checking only `blocked` would treat "nothing was configured to send" exactly like "genuinely delivered." Today this is latent, not live, only because both existing durable-claim callers happen to always route around it by the shape of their recipients (see Edge Cases) — but it is real, and a case built for generality has to cover it or it isn't actually general.

Second, and centrally: rather than removing `success` from `SendEmailResult` everywhere (churn across ~18 call sites, most of which have no durable claim and no bug), or relying on an optional field a caller can ignore, or writing a bespoke lint rule, this introduces a **second, narrower pair of functions** — `sendEmailForDurableClaim()` and `sendBulkMemberEmailForDurableClaim()` in a new file, `src/lib/email-durable-claim.ts` — whose return type has **no `success` field at all**, only a three-way discriminated `outcome`. `sendEmail()`/`sendBulkMemberEmail()` are untouched in their public contract (DECISION-085 holds exactly, the 17 guardrail tests pass unmodified) and are additively widened so the new wrapper has the raw material it needs. The two known durable-claim callers migrate to the new functions; the other ~16 call sites are not touched. For a caller that adopts the new entrypoint, writing `if (result.success)` is **not a discouraged pattern to catch in review — it is a TypeScript compile error**, because the property does not exist on the type.

## Chosen approach and rejected alternatives

**(b) — a separate `...ForDurableClaim()` helper pair with no bare `success` field — chosen**, with the widening of `SendBulkMemberEmailResult` (B-70's stated extension) folded in as a prerequisite, and one more fix beyond the ticket's literal text: the `dev_no_api_key` gap described above.

**(a) — a discriminated union replacing `SendEmailResult` everywhere — rejected.** It would make the mistake unrepresentable *everywhere*, which is real appeal, but at a cost this ticket's own framing warns against: touching all ~18 call sites in one mechanical pass, in the exact code the team spent a full day stabilizing hours ago. Most of those 18 sites have no durable claim, ignore or loosely check `success`/`error`, and have no bug today — DECISION-085 exists specifically so they can keep behaving exactly as they do now. Forcing them into three-way handling is churn with no matching safety win, and it directly courts the risk named at the end of this doc: a large mechanical refactor across freshly-stabilized code introducing a new bug of its own. It would also force `email-guardrail.test.ts`'s 17 tests and `email-no-api-key.test.ts`'s 4 tests to be rewritten rather than left passing unmodified, which the task brief treats as a red flag unless strongly justified — I don't think the justification clears that bar when option (b) gets the same unrepresentability for the 2 sites that actually need it.

**(c) — a lint rule flagging `.success` reads outside sanctioned entrypoints — rejected as the sole mechanism, partially folded in.** A real, type-aware ESLint rule (walking `SendEmailResult`-typed values and flagging a `.success` member access) is the only version of this that would generalize to a brand-new caller nobody remembered to allowlist — but authoring and maintaining a custom typed-linting rule is a real, ongoing tooling investment for a two-caller problem, and introduces exactly the kind of new-dependency/config-surface question that belongs to the architect, not a quick add here. A cheaper, text-based scan (grep for `.success` near a `sendEmail(` call) is easy to defeat by accident (destructuring rename, indirection through a variable) and only discourages, it doesn't prevent. I did not build a general rule. I did keep one piece of (c) in miniature: a **pinning test** on the two known durable-claim files' new behavior (see Tests, below) — cheap, and it protects against *regression* in the two files we know about. It does not, and cannot, catch a hypothetical brand-new third durable-claim caller who never reads this file. I say so plainly in Edge Cases & Risks rather than overselling the safety net.

### Does the chosen shape make the mistake unrepresentable, or merely discouraged?

**For a caller that uses `sendEmailForDurableClaim()`/`sendBulkMemberEmailForDurableClaim()`: unrepresentable.** `DurableSendResult` has no `success` property anywhere in its type. `if (result.success)` fails `tsc --noEmit`, not review. A switch over `result.outcome` that omits a branch fails the same way, via a `never`-typed exhaustiveness check (below) — you cannot compile a durable-claim caller that silently treats `not_delivered` as `delivered`.

**For a brand-new caller that never imports the new functions and instead calls `sendEmail()`/`sendBulkMemberEmail()` directly and writes its own durable claim: still representable.** This is the honest limit of option (b), and it is the same limit the ticket's own framing anticipates for (b) versus a hypothetical (a)-with-full-coverage. I mitigate it three ways, none of which is airtight on its own:
1. `sendEmail()`'s doc comment gains a paragraph pointing any reader straight at the durable-claim helper (a maintainer already reads that comment closely — the file is dense with exactly this kind of "stop and read this" annotation, and it has worked so far: every existing narrative comment in `email.ts` was written *after* an incident, and no incident has recurred at a site whose comment already named it).
2. This design doc's own existence, plus a short new paragraph in CLAUDE.md's outbound-email invariant section (Implementation Order step 6) naming the two functions as required for any new durable-claim write — so Phase 2/3 review has one concrete, checkable question instead of "remember to check a field."
3. A pinning test on the two known files (protects regression, not a hypothetical third file).

I am not claiming this closes the gap completely. I think that's the right amount of investment for a two-caller problem today; if a third durable-claim caller appears, a real typed-lint rule becomes proportionate and should be filed then, not built speculatively now.

## Exact type definitions

### `src/lib/email.ts` — additive only, no existing field changes meaning or shape

```ts
// Exported (was file-private) so email-durable-claim.ts can name it.
export interface SendEmailOptions {
  to: string;
  from: string;
  subject: string;
  html: string;
  replyTo?: string;
  cc?: string;
  bcc?: string;
  attachments?: EmailAttachment[];
  /** @internal — unchanged, still sendBulkMemberEmail()-only. */
  _bulkMemberSend?: boolean;
}

// Exported (was file-private); shape unchanged except two new optional fields.
export interface SendEmailResult {
  success: boolean;
  error?: string;
  emailQueueId: string;

  /** UNCHANGED — same field, same doc comment, same single call site
   *  (the blocked_non_production branch). Still means exactly what it has
   *  meant since 2026-09-25: the deny-by-default guard refused delivery. */
  blocked?: true;

  /**
   * NEW. Set only on the `dev_no_api_key` branch — non-production, no
   * RESEND_API_KEY configured, recipient already cleared the
   * deny-by-default guard above. As undelivered as `blocked` is, for
   * exactly the same reason (nothing was handed to the Resend SDK), kept
   * as its own field rather than folded into `blocked` so that field's
   * existing, precise contract ("set only on the blocked_non_production
   * path") stays literally true for every reader who already trusts it.
   * A durable-claim caller must treat `blocked` and `notAttempted`
   * identically — see src/lib/email-durable-claim.ts, which is the only
   * place that needs to know that.
   */
  notAttempted?: true;
}
```

Both new-branch writes are one-line additions to the two `return { success: true, emailQueueId: queued.id, ... }` statements that already exist (the guard-blocked return, and the `dev_no_api_key` return) — no new branch, no new DB write, no change to what's persisted in `email_queue.status`.

```ts
// Per-recipient shape widened the same way — mirrors SendEmailResult 1:1,
// forwarded straight from each recipient's own sendEmail() call inside the
// existing loop (two extra fields in the results.push(...) object; no
// change to the loop's control flow).
export interface SendBulkMemberEmailResult {
  results: Array<{
    to: string;
    success: boolean;
    error?: string;
    emailQueueId: string;
    blocked?: true;
    notAttempted?: true;
  }>;
}
```

### `src/lib/email-durable-claim.ts` — new file

```ts
import { sendEmail, sendBulkMemberEmail } from "@/lib/email";
import type { SendEmailOptions, SendBulkMemberEmailOptions } from "@/lib/email";

/**
 * The outcome of an attempted send, for a caller about to write a DURABLE,
 * hard-to-reverse "this was sent" claim (an append-only decision history
 * row, a partial-unique-indexed "success" row, an atomic sentAt/sentVia
 * claim, or any future equivalent — DECISION-102 rule 2). Deliberately has
 * NO `success` boolean: the defect this exists to make unrepresentable is
 * exactly "a caller read `success` and skipped the rest of the story."
 *
 * `not_delivered` collapses two reasons that both mean "nothing reached
 * Resend" but differ in what a human reading /admin should be told:
 *   - "blocked_non_production": the deny-by-default guard refused to reach
 *     Resend (DECISION-085).
 *   - "dev_no_api_key": no RESEND_API_KEY is configured outside production.
 * Both revert a durable claim identically; only the displayed reason
 * differs. See DECISION-103.
 */
export type DurableSendOutcome =
  | { outcome: "delivered" }
  | { outcome: "failed"; error: string }
  | { outcome: "not_delivered"; reason: "blocked_non_production" | "dev_no_api_key" };

export type DurableSendResult = { emailQueueId: string } & DurableSendOutcome;

function outcomeFromRaw(raw: {
  success: boolean;
  error?: string;
  blocked?: true;
  notAttempted?: true;
}): DurableSendOutcome {
  if (raw.blocked) return { outcome: "not_delivered", reason: "blocked_non_production" };
  if (raw.notAttempted) return { outcome: "not_delivered", reason: "dev_no_api_key" };
  if (!raw.success) return { outcome: "failed", error: raw.error ?? "Unknown error" };
  return { outcome: "delivered" };
}

/** The sanctioned entrypoint for any caller that will persist a durable
 *  "this was sent" claim from a single-recipient send. Thin wrapper over
 *  sendEmail() — same queue row, same guard, same retry behavior; only the
 *  shape of what's returned differs. */
export async function sendEmailForDurableClaim(
  options: SendEmailOptions,
): Promise<DurableSendResult> {
  const raw = await sendEmail(options);
  return { emailQueueId: raw.emailQueueId, ...outcomeFromRaw(raw) };
}

export interface SendBulkMemberEmailForDurableClaimResult {
  results: Array<{ to: string; emailQueueId: string } & DurableSendOutcome>;
}

/** The sanctioned entrypoint for any caller that will persist a durable
 *  "this was sent" claim from a batch send. Thin wrapper over
 *  sendBulkMemberEmail() — reuses its one recipient loop; does not
 *  reimplement it (CLAUDE.md's duplication rule). */
export async function sendBulkMemberEmailForDurableClaim(
  options: SendBulkMemberEmailOptions,
): Promise<SendBulkMemberEmailForDurableClaimResult> {
  const { results } = await sendBulkMemberEmail(options);
  return {
    results: results.map((r) => ({ to: r.to, emailQueueId: r.emailQueueId, ...outcomeFromRaw(r) })),
  };
}
```

Note what is *not* here: no new DB query, no new guard predicate, no reimplementation of the recipient loop. `outcomeFromRaw()` is the only new logic, and it is a pure function with no I/O — trivially unit-testable in isolation from Resend/DB mocking.

## API Contract

No HTTP routes. Two new server-only function signatures (above), both in `src/lib/email-durable-claim.ts`. No change to any existing route's request/response shape.

## Data Model

No schema changes. No migration. `email_queue`, `ledger_acknowledgments`, and `financial_report_sends` are all read/written exactly as today — only which TypeScript values the two callers branch on changes, not what gets persisted or when.

## Component / Page Plan

None. No page, no component. Both migrated callers (`financial-report-send.ts`, `ledger-acknowledgment-letter-queries.ts`) keep their existing output types (`sendMonthlyReportToBoard()`'s return shape; `EmailLetterResult`, including its `addresses: Array<{ to, success, error?, blocked? }>` shape) unchanged, so neither `/admin/ledger/donors/letters`'s selector component nor `/admin/ledger/reports/send`'s route needs to change at all. This is a pure internal refactor of how each function arrives at the same external contract it already has.

## Migration path for existing call sites

- **~16 ordinary call sites** (contact form, forgot-password, reimbursement notifications, social-request/proposal decisions, membership applications, suggestions, minutes email, dues reminders, event announcements, member-reimbursement approver notice, auth password-reset email): **untouched.** They still call `sendEmail()`/`sendBulkMemberEmail()`, still get back `{ success, error?, emailQueueId, blocked?, notAttempted? }`, still compile and behave identically. Zero churn.
- **2 known durable-claim callers**, migrated in this change:
  - `src/lib/financial-report-send.ts` — `sendMonthlyReportToBoard()` switches from `sendEmail()` + `if (sendResult.blocked)` / `if (!sendResult.success)` to `sendEmailForDurableClaim()` + an exhaustive `switch (sendResult.outcome)`. Same three DB-write branches (`not_delivered` → revert-shaped insert with `success: false` and the existing "blocked" detail string; `failed` → `success: false` insert with the real error; `delivered` → `success: true` insert), same external `{ ok, reason, detail }` return shape.
  - `src/lib/ledger-acknowledgment-letter-queries.ts` — `emailAcknowledgmentLetters()` switches Step 3 from `sendBulkMemberEmail()` to `sendBulkMemberEmailForDurableClaim()`, and **deletes Step 3b entirely** (the `email_queue` read-back block that inferred `blocked_non_production` by re-querying the DB for each queued row's persisted status). Step 4's per-address reconstruction reads `sendResult.outcome`/`sendResult.reason` directly instead of consulting a `blockedQueueIds` Set. `anyDelivered`/`anyGenuinelyFailed`/the three-way emailed/failed/blocked result and the atomic-claim revert logic are unchanged in shape — only the source of truth for "was this one blocked" changes from an inferred DB read to a directly-propagated field. This is a **strict improvement** over the shipped B-67 fix, not just a refactor: the read-back only ever checked for `status === 'blocked_non_production'`, so a `dev_no_api_key` row (unreachable today only because acknowledgment sends are bulk, and bulk forces the guard unconditionally outside production — see Edge Cases) would have been silently treated as delivered by the old code. The new code covers both `not_delivered` reasons by construction.
- **This lands as one PR, not 18 incremental ones.** Total surface: 1 new file (~70 lines), ~10 lines added to `email.ts` (two fields, two doc comments, two exports), and two caller-file rewrites that are each a like-for-like branch restructuring with no behavior change to their external contract. It does not need to be split further — there is no meaningful subset of "widen `SendEmailResult`" that ships usefully on its own without the wrapper that consumes it, and the two caller migrations are small enough (each already has full existing test coverage to migrate) that splitting them into separate PRs would only add handoff overhead for no risk reduction.

## How a durable-claim caller is *forced* into three-way handling

Two independent mechanisms, not one:

1. **No escape hatch in the type.** `DurableSendResult` has no `success` field. There is nothing to read that would let a caller skip the question. This is enforced by `tsc --noEmit`, which Phase 4's gate already requires.
2. **Exhaustiveness at the switch.** Both migrated callers must write:
   ```ts
   switch (sendResult.outcome) {
     case "delivered": { /* ... */ break; }
     case "failed": { /* ... */ break; }
     case "not_delivered": { /* ... */ break; }
     default: {
       const _exhaustive: never = sendResult;
       throw new Error(`Unhandled send outcome: ${JSON.stringify(_exhaustive)}`);
     }
   }
   ```
   The `never` assignment fails to compile if a case is ever missing, including if `DurableSendOutcome` grows a fourth variant in the future — the caller doesn't just handle today's three cases, it's structurally unable to silently ignore a new one.

## Tests the implementer must deliver

New file `src/lib/email-durable-claim.test.ts`:
1. `outcomeFromRaw()` (or the wrapper functions, mocking `sendEmail`) maps a genuine send (`success: true`, no `blocked`/`notAttempted`) to `{ outcome: "delivered" }`.
2. Maps a genuine failure (`success: false, error`) to `{ outcome: "failed", error }`.
3. Maps `blocked: true` to `{ outcome: "not_delivered", reason: "blocked_non_production" }` — **not** `"delivered"`, regardless of `success` being `true` on the raw result.
4. Maps `notAttempted: true` to `{ outcome: "not_delivered", reason: "dev_no_api_key" }` — the new sixth-instance fix; this test must fail against pre-change code (there is no `notAttempted` field yet) and pass after.
5. A compile-time assertion that `DurableSendResult` has no bare `success` field — a `// @ts-expect-error` line reading `sendResultFromHelper.success` should fail to compile without the suppression comment, and the suppressed line should itself fail (i.e., `tsc --noEmit` on the test file is the actual enforcement; the test's job is to keep this assertion from silently rotting if someone "fixes" the type later).
6. **The pinning test the task brief asks for, retargeted at the mechanism that now exists instead of the workaround it replaces:** with `NODE_ENV=development` and `EMAIL_DEV_ALLOWLIST` containing the sole recipient, call `sendBulkMemberEmailForDurableClaim()` with that one recipient and assert the result is `{ outcome: "not_delivered", reason: "blocked_non_production" }` for it, and that the mocked `resend.emails.send` was never called — i.e., confirm `_bulkMemberSend: true` still forces the block unconditionally even for an allowlisted address, and that this fact survives all the way through the new wrapper without a DB read-back. This is the same underlying fact the analyst's original pinning-test recommendation targeted; it's a better place to pin it because the thing being pinned (direct field propagation) is now the actual mechanism, not an inference from persisted DB state.
7. A same-shape test for the single-recipient `dev_no_api_key` case: `NODE_ENV=development`, no `RESEND_API_KEY`, recipient allowlisted, `sendEmailForDurableClaim()` (non-bulk) → `{ outcome: "not_delivered", reason: "dev_no_api_key" }`.

Updates to existing tests:
- `src/lib/financial-report-send.test.ts` — the existing blocked-send test(s) must be re-pointed at `sendEmailForDurableClaim`'s mock and updated to assert on `outcome` rather than `blocked`/`success`; same DB-row assertions (still a `success: false` insert with the same detail string) should be otherwise unchanged, proving no behavior regression.
- `src/lib/ledger-acknowledgment-letter-queries.test.ts` — the five B-67 tests must be updated to mock `sendBulkMemberEmailForDurableClaim` (or `sendEmail` underneath it) directly, with no `email_queue` read-back mock needed anymore; same five scenarios (all-delivered, all-blocked, all-failed, delivered+blocked mixed, failed+blocked mixed) must still produce the same `emailed`/`failed`/`blocked` statuses and the same claim-kept/claim-reverted behavior. qa should treat any behavior change here as a regression, not an intended improvement — the only intended change in this file is internal mechanism.
- The 17 `email-guardrail.test.ts` tests and the 4 `email-no-api-key.test.ts` tests: **must pass unmodified.** They exercise `sendEmail()`/`sendBulkMemberEmail()` directly and assert on `success`/`error`/persisted `status` — none of that changes. If the implementer finds they need to touch either file, that itself is a signal something in this design broke DECISION-085's contract and should stop and flag it rather than "fix" the test.

## Implementation Order

1. `src/lib/email.ts` — export `SendEmailOptions` and `SendEmailResult` (were file-private); add `notAttempted?: true` to `SendEmailResult` and set it on the `dev_no_api_key` branch; add `blocked?: true` / `notAttempted?: true` to `SendBulkMemberEmailResult`'s per-recipient shape, forwarded from each `sendEmail()` call already inside the loop. No behavior change to `email_queue` writes.
2. New file `src/lib/email-durable-claim.ts` — `DurableSendOutcome`/`DurableSendResult` types, `outcomeFromRaw()`, `sendEmailForDurableClaim()`, `sendBulkMemberEmailForDurableClaim()`. Unit-testable with no DB/Resend mocking beyond what `sendEmail()`'s own tests already require.
3. Add the new tests in item "Tests the implementer must deliver" above, item 1 (`email-durable-claim.test.ts`) — write these before touching either caller, since they validate the wrapper independent of the two migrations.
4. Migrate `src/lib/financial-report-send.ts`'s `sendMonthlyReportToBoard()` to `sendEmailForDurableClaim()` + exhaustive switch. Update `financial-report-send.test.ts`.
5. Migrate `src/lib/ledger-acknowledgment-letter-queries.ts`'s `emailAcknowledgmentLetters()` to `sendBulkMemberEmailForDurableClaim()`; delete Step 3b's DB read-back. Update `ledger-acknowledgment-letter-queries.test.ts`.
6. Add a short paragraph to CLAUDE.md's "Outbound Email Is Deny-By-Default Outside Production" section (or a new short subsection immediately after it) naming `sendEmailForDurableClaim()`/`sendBulkMemberEmailForDurableClaim()` as required for any future caller that persists a durable "sent" claim, cross-referencing DECISION-102 and DECISION-103.
7. Confirm the 17 + 4 existing guardrail tests pass with zero edits (see Tests section) — this is a gate, not a nice-to-have; a diff to either file should stop the implementer and prompt a re-check of step 1.
8. Full test suite + `pnpm exec tsc --noEmit` + `pnpm build:only`.
9. Release notes: this is internal hardening with no user-facing change, so per the release-notes skill's own judgment call at ship time — likely a "Behind the scenes" line at most, not a feature entry. Tech-lead writes it at ship time per the standard process.

No schema step, no permissions step, no UI step — all three are "none" for this ticket, reflected in the Data Model / Permissions / Component sections above.

## Edge Cases & Risks

- **The `dev_no_api_key` gap is latent, not live, in both current callers — and only by coincidence of their recipients, which is itself the risk.** `sendMonthlyReportToBoard()` always sends to `BOARD_EMAIL`, a club distribution list; `isDevAllowedRecipient()` (`src/lib/email-guard.ts`) refuses to allowlist a distribution list unconditionally, so `shouldBlockNonProductionSend()` returns `true` outside production regardless of whether `RESEND_API_KEY` is set — the `dev_no_api_key` branch is structurally unreachable for this caller today. `emailAcknowledgmentLetters()` always sends via `sendBulkMemberEmail()`, which sets `_bulkMemberSend: true`, which forces the block unconditionally outside production regardless of allowlist status — also structurally unreachable today. Both callers are safe **today**, but for a reason neither of them states or defends, and a **third**, hypothetical durable-claim caller emailing a single non-distribution-list, allowlisted address directly via `sendEmail()` would hit this gap live, in production-adjacent local testing, right now, without this fix. This is exactly the kind of implicit, untested coupling the ack-letter Phase 6 review already flagged for a different case (the `_bulkMemberSend` reachability assumption) — I'm not leaving a second copy of that shape unaddressed just because it hasn't fired yet.
- **Migrating two files that were JUST stabilized in the same day's work is itself a risk.** Both `financial-report-send.ts` and `ledger-acknowledgment-letter-queries.ts` carry hours-old, carefully-reasoned fixes with passing tests. The mitigation is structural, not just "be careful": both migrations are pure branch-restructuring with **no intended change to persisted rows, reason strings, or the external function contract** — every existing assertion in `financial-report-send.test.ts` and `ledger-acknowledgment-letter-queries.test.ts` about *what gets written to the DB and what the caller/UI sees* should still pass with only the *mock target* changed (from `sendEmail`/`sendBulkMemberEmail` to `sendEmailForDurableClaim`/`sendBulkMemberEmailForDurableClaim`), not the assertions themselves. If an assertion about DB rows or UI-facing output needs to change to make the migration pass, that is a signal of an unintended behavior change and should stop the implementer, not be treated as "updating the test to match."
- **The residual gap for a brand-new, unaware third caller** (discussed above under "unrepresentable vs. discouraged") is real. I'm treating it as accepted risk at today's scale (2 known callers) rather than building a typed-lint rule speculatively. If a third durable-claim caller is ever proposed, Phase 2/3 review for that feature should treat "does this use `sendEmailForDurableClaim()`/`sendBulkMemberEmailForDurableClaim()`" as a named gating question — I'm adding that to CLAUDE.md in Implementation Order step 6 specifically so it isn't tribal knowledge.
- **`_bulkMemberSend` and the allowlist interaction remain exactly as subtle as before** — this design doesn't simplify `shouldBlockNonProductionSend()` or touch `email-guard.ts` at all, it only makes the *result* of that predicate reach the durable-claim caller directly instead of through an inferred DB read. The pinning test (item 6 above) protects the fact that stays true; it doesn't reduce how subtle the underlying guard logic is.
- **B-68 is not absorbed by this design, and should stay a separate ticket.** B-68 is about `sendEmail()`'s send loop and the email-queue retry route's `attemptSend()` independently implementing "a resolved `{ error }` is a failure" — a helper-internal correctness question, entirely inside the boundary this design treats as a black box (`sendEmail()`'s own send attempt). This design is about what happens to `sendEmail()`'s *result* once it leaves the function, one layer up. The retry route also does not write any durable claim itself (it only updates `email_queue.status`, which is the ground-truth table, not a duplicate claim over it) — it isn't a "durable-claim caller" in DECISION-102's sense at all, so it isn't in scope here either way. Conflating the two would mean one PR touching both the send-attempt internals and the caller-contract layer at once, which is a larger, riskier diff for no shared benefit — keep them separate, as already filed.

## Implementer

**api-developer**, single implementer — no database-admin (no schema change), no ux-developer (no UI change, verified above that both migrated functions' external contracts are unchanged), and not a full-stack-developer job (there is no client-side surface at all, so "spans server + client" doesn't apply; this is squarely "server logic / business logic" per CLAUDE.md's implementer table). The two file migrations are tightly coupled to the new wrapper module and to each other only in the sense that both consume the same new types — there's no natural specialist seam (schema vs. server vs. client) to split along, so a single implementer working through the Implementation Order above is the right shape, not a split.

---

# Phase 4 — Implementation

## Phase 4 — Implementation (API) — 2026-09-25

**Owner:** api-developer
**Status:** complete

### Summary

Implemented the Phase 3 design exactly as specified, with no deviations. Added the durable-claim
entrypoint pair (`sendEmailForDurableClaim()` / `sendBulkMemberEmailForDurableClaim()`) in a new
file, widened `SendEmailResult`/`SendBulkMemberEmailResult` additively (one new `notAttempted?:
true` field, forwarded on the bulk shape alongside the pre-existing `blocked?: true`), and migrated
both known durable-claim callers to the new entrypoint with an exhaustive `switch` over
`DurableSendOutcome`. The ack-letter file's B-67 `email_queue` read-back workaround is deleted
entirely — `sendResult.outcome`/`reason` is read directly. All gates pass; the 17 + 4 DECISION-085
guardrail/no-API-key tests are byte-for-byte untouched (`git diff` confirms zero diff on both
files); call-site churn matched the design's "4 files, near-zero" claim exactly — no third file was
touched.

### What I did

- `src/lib/email.ts`: exported `SendEmailOptions`/`SendEmailResult` (were file-private, no shape
  change beyond the new field below); added `notAttempted?: true` to `SendEmailResult`, set on the
  `dev_no_api_key` branch (was previously `return { success: true, emailQueueId: queued.id }` with
  no signal); widened `SendBulkMemberEmailResult`'s per-recipient shape with `blocked?: true` /
  `notAttempted?: true`, forwarded from each recipient's own `sendEmail()` call inside the existing
  loop. No change to any existing field's meaning, to `email_queue` writes, or to either function's
  call signature.
- New file `src/lib/email-durable-claim.ts`: `DurableSendOutcome`, `DurableSendResult`,
  `outcomeFromRaw()` (pure, no I/O), `sendEmailForDurableClaim()`,
  `sendBulkMemberEmailForDurableClaim()` — exactly the shapes in the design doc, verbatim.
- New file `src/lib/email-durable-claim.test.ts`: 15 tests covering all 7 named items — the four
  `outcomeFromRaw()` mappings (delivered / failed / blocked / notAttempted), a
  blocked-takes-precedence-over-notAttempted case, an "Unknown error" fallback case, the
  `@ts-expect-error`-on-`.success` compile-time assertion, the bulk pinning test (allowlisted
  recipient still forced through `not_delivered`/`blocked_non_production` with zero DB read-back),
  the single-recipient `dev_no_api_key` case, and an explicit `never`-check exhaustiveness test
  over all four current outcome variants.
- Migrated `src/lib/financial-report-send.ts`'s `sendMonthlyReportToBoard()` from `sendEmail()` +
  `if (sendResult.blocked)` / `if (!sendResult.success)` to `sendEmailForDurableClaim()` + an
  exhaustive `switch (sendResult.outcome)` with a `never`-check default. Same three DB-write
  branches, same external `SendReportResult` shape, same reason strings.
- Migrated `src/lib/ledger-acknowledgment-letter-queries.ts`'s `emailAcknowledgmentLetters()` to
  `sendBulkMemberEmailForDurableClaim()`, **deleted Step 3b entirely** (the `email_queue` select
  that inferred `blocked_non_production` per queued row), and removed the now-unused `emailQueue`
  schema import. Step 4's per-address regrouping reads `sendResult.outcome`/`reason` directly.
  `anyDelivered`/`anyGenuinelyFailed`/the three-way emailed/failed/blocked result and the atomic
  claim/revert logic are byte-identical in shape to before — only the source of truth for "was this
  blocked" changed.
- Updated `src/lib/financial-report-send.test.ts`: mock target changed from `@/lib/email`
  (`sendEmail`) to `@/lib/email-durable-claim` (`sendEmailForDurableClaim`); every mocked return
  value converted from `{ success, blocked?, error? }` to `{ outcome, reason?, error? }`. All 33
  pre-existing assertions (DB rows written, external `SendReportResult` shape, re-sendability after
  a blocked send, double-click race handling) are unchanged — only the mock shape changed. All 33
  pass.
- Updated `src/lib/ledger-acknowledgment-letter-queries.test.ts`: mock target changed from
  `@/lib/email` (`sendBulkMemberEmail`) to `@/lib/email-durable-claim`
  (`sendBulkMemberEmailForDurableClaim`); every mocked `results: [...]` array converted from
  `{ success, error?, emailQueueId }` to `{ outcome, reason?, error?, emailQueueId }`; every
  `mockDbState.selectQueue.push([{ id, status: "blocked_non_production" }])` read-back push
  **removed** (no longer issued by the implementation). Added one new test — the
  `dev_no_api_key`/`notAttempted` case treated identically to `blocked_non_production` — since B-67
  never covered a `not_delivered` reason other than `blocked_non_production`. All other assertions
  (claim/revert shape, `emailed`/`failed`/`blocked` outcomes, per-address detail) are byte-identical
  in expected value to before the migration.
- `CLAUDE.md`: rewrote the "A Send Helper Must Never Claim Delivery It Didn't Get" section's rule 2
  and its "Enforcement is review-only today" closing line to name the new entrypoint pair, describe
  the compile-time enforcement now in place for the two known callers, and state plainly that a
  brand-new third caller bypassing the new functions is still exposed (per DECISION-103's own
  Edge Cases section) — added right after DECISION-102's existing writeup, cross-referencing
  DECISION-103.
- Did NOT touch `src/lib/email-guard.ts`, the email-queue retry route, or any of the ~16 ordinary
  `sendEmail()`/`sendBulkMemberEmail()` call sites (contact form, forgot-password, dues reminders,
  minutes email, event announcements, proposal/social-request decisions, membership applications,
  suggestions, reimbursement notifications) — confirmed via `git status` after the full
  implementation: only the 4 files the design named (plus their 2 test files) show as modified, and
  the 2 new files are untracked. Zero churn to any other file.

### Verification performed

- **`if (result.success)` is genuinely a compile error on `DurableSendResult`**: verified two ways.
  (1) `src/lib/email-durable-claim.test.ts`'s compile-time assertion test uses
  `// @ts-expect-error` immediately above `sendResultFromHelper.success` — `pnpm exec tsc --noEmit`
  passes only because the suppression is consumed by a real error; deleting the `@ts-expect-error`
  line locally (not committed) reproduces `error TS2339: Property 'success' does not exist on type
  'DurableSendResult'`, and removing the field-mapping logic itself (see below) instead produces
  `error TS2578: Unused '@ts-expect-error' directive` — i.e. the test fails to typecheck the moment
  the type stops being unrepresentable, which is the actual enforcement. (2) `DurableSendOutcome`
  has no `success` key in its union at all — confirmed by reading the type definition, not just the
  test.
- **The read-back workaround is gone**: `grep -n emailQueue src/lib/ledger-acknowledgment-letter-queries.ts`
  after the change shows zero occurrences (was previously used for the Step 3b select + the schema
  import); the `db` import and `inArray` import are both still used elsewhere in the file (the
  `listGeneratableAcknowledgments` scoped-ids query), so nothing else broke by removing them from
  the ack-email path specifically.
- **Call-site churn**: `git status --short src/` after the full change shows exactly 5 modified
  files (`email.ts`, `financial-report-send.ts` + its test, `ledger-acknowledgment-letter-queries.ts`
  + its test) and 2 untracked new files (`email-durable-claim.ts` + its test) — 7 files total,
  matching the design's "1 new file (~70 lines), ~10 lines added to email.ts, two caller-file
  rewrites" claim. A follow-up grep for `sendEmail(`/`sendBulkMemberEmail(` across `src/` confirmed
  every other call site (contact route, forgot-password, ledger reimbursement/transaction routes,
  dues reminders, minutes email, retry route, social-request/proposal decide routes, event
  announce, membership applications, member reimbursements/social-requests/proposals submit,
  suggestions) is untouched — none appear in `git status`.
- **DECISION-085 guardrail tests untouched**: `git diff -- src/lib/email-guardrail.test.ts
  src/lib/email-no-api-key.test.ts` produces zero output (confirmed via `git diff --stat`, 0 lines
  changed in both files). All 21 of their tests (17 + 4) pass in the full run.
- **Tests added with pre-fix failure evidence**: temporarily deleted the
  `if (raw.notAttempted) return { outcome: "not_delivered", reason: "dev_no_api_key" };` line from
  `outcomeFromRaw()` and re-ran `email-durable-claim.test.ts` — both the `notAttempted`-mapping test
  and the single-recipient `dev_no_api_key` pinning test failed with the mapped outcome coming back
  `"delivered"` instead of `"not_delivered"`/`"dev_no_api_key"`; restored the line and both pass.
  (Note: mocking `sendEmail`/`sendBulkMemberEmail` entirely in this test file means the pre-fix
  failure demonstrates the wrapper's own mapping logic, not the real `dev_no_api_key` branch inside
  `sendEmail()` — that branch's behavior is separately covered, unchanged, by
  `email-no-api-key.test.ts`, which this change does not touch.)
- Full gates: `pnpm exec tsc --noEmit` — clean. `pnpm lint` — 0 errors (1 pre-existing unrelated
  warning in `budget-context-panel.tsx`, not touched by this change). `pnpm test` — **2182 passed**
  (baseline 2171; net +11 new: 9 new tests in `email-durable-claim.test.ts` beyond the compile-time
  one that also counts as a runtime assertion, plus 1 new ack-letter test for the `dev_no_api_key`
  case, plus the 33 financial-report-send tests and the full ack-letter suite passing with the
  updated mock shapes — no test was removed). `pnpm build:only` — production build succeeded.

### Outputs

- **New file** `src/lib/email-durable-claim.ts` — exports `DurableSendOutcome`, `DurableSendResult`,
  `SendBulkMemberEmailForDurableClaimResult`, `sendEmailForDurableClaim(options: SendEmailOptions):
  Promise<DurableSendResult>`, `sendBulkMemberEmailForDurableClaim(options:
  SendBulkMemberEmailOptions): Promise<SendBulkMemberEmailForDurableClaimResult>`. No auth/feature
  gate (server-only library code, no route, no user-facing surface — matches the design's
  Permissions section of "none").
- **New file** `src/lib/email-durable-claim.test.ts` — 15 tests, no route/page involved.
- **Modified** `src/lib/email.ts` — `SendEmailOptions`/`SendEmailResult` now exported;
  `SendEmailResult.notAttempted?: true` added (set only on the `dev_no_api_key` branch);
  `SendBulkMemberEmailResult`'s per-recipient shape gained `blocked?: true` / `notAttempted?: true`.
  `sendEmail()`/`sendBulkMemberEmail()` call signatures and all other behavior are byte-for-byte
  unchanged — every one of the ~16 ordinary callers compiles and behaves identically.
- **Modified** `src/lib/financial-report-send.ts` — `sendMonthlyReportToBoard(entityId: string,
  month: string, sentByUserId: string): Promise<SendReportResult>` signature and `SendReportResult`
  union are unchanged; internals now call `sendEmailForDurableClaim()` instead of `sendEmail()`.
- **Modified** `src/lib/ledger-acknowledgment-letter-queries.ts` — `emailAcknowledgmentLetters(ackIds:
  string[]): Promise<EmailLetterResult[]>` signature and `EmailLetterResult` union are unchanged;
  internals now call `sendBulkMemberEmailForDurableClaim()` instead of `sendBulkMemberEmail()`, and
  no longer read `email_queue` at all in this function.
- No schema changes, no migration, no new route, no new permission — matches the Phase 3 design's
  Data Model / API Contract / Component Plan sections exactly ("none" for all three).
- `CLAUDE.md` — updated the DECISION-102 section (`### A Send Helper Must Never Claim Delivery It
  Didn't Get...`) to describe the new entrypoint pair and DECISION-103's enforcement model.

### Open questions / handoff notes

- **Next agent: qa (Phase 5).** Nothing in this change has a UI or route surface, so the manual
  click-through should be minimal/none — the qa gate here is really "confirm the gates I ran are
  reproducible and the two migrated features (`/admin/ledger/reports/send`,
  `/admin/ledger/donors/letters`) still work end-to-end via their existing e2e coverage if any
  exists, since neither route's contract changed."
- **Everything in the Phase 3 design survived contact with the code as written.** No deviation to
  report — the type definitions, the migration shape for both callers, the deletion of Step 3b, and
  the test list were all implementable exactly as specified.
- **The residual gap the design names explicitly is still open and not addressed by this
  ticket**: a brand-new, hypothetical third durable-claim caller that imports `sendEmail()`/
  `sendBulkMemberEmail()` directly instead of the new wrapper is not prevented by anything at the
  type level — only by the doc comments on `SendEmailResult` (now pointing at the wrapper), this
  work-log's existence, and the new CLAUDE.md paragraph naming the two functions as a required
  Phase 2/3 review question. If a third such caller is proposed, treat "does this use
  `sendEmailForDurableClaim()`/`sendBulkMemberEmailForDurableClaim()`" as a named gate at that
  feature's own Phase 2/3, per the design doc's own recommendation — a typed ESLint rule becomes
  proportionate at that point, not before.
- **B-68 remains untouched and separate**, as instructed — the email-queue retry route's
  `attemptSend()` internals were not read or modified.
- Release notes: per the design's own Implementation Order item 9 and this being internal hardening
  with no user-facing change, tech-lead should treat this as "Behind the scenes" at most when the
  release-notes skill runs, not a feature entry.

# Phase 5 — Verification (qa)

## Phase 5 — Verification — 2026-09-25

**Owner:** qa
**Status:** complete

### Summary

**PASS.** All four gates are clean and independently reproduced, not just trusted from the
implementer's report. The safety property that must not regress — a genuine delivery still claims
permanently — is intact in both migrated files, verified by reading the diff, not inferring it from
green tests. The central compile-time claim (`if (result.success)` is a `TS2339` error on
`DurableSendResult`) and the exhaustiveness claim (`TS2322` on a `never` mismatch for a two-branch
switch) were each reproduced independently in a scratch file, not just read from the work-log's
description of them. My independent read: for the two known callers the mistake is genuinely
**unrepresentable**, not merely discouraged — see the closing judgment below.

### What I did

1. Read the Phase 3 design doc in full and DECISION-102/103/085/092 before touching code.
2. Ran the four required gates myself, from a clean tree, and compared results to the implementer's
   claims:
   - `pnpm exec tsc --noEmit` — clean. Matches claim.
   - `pnpm lint` — 0 errors, 1 pre-existing unrelated warning (`budget-context-panel.tsx`, untouched
     by this change). Matches claim.
   - `pnpm test` — **2182/2182 passed**, 126 test files. Matches claim exactly.
   - `pnpm build:only` — exit 0, full route manifest printed, no unused-export warnings, no
     unexpected output. Matches claim.
3. **Item 1 (the safety property) — read, not inferred.** In `financial-report-send.ts`'s `delivered`
   case, the `INSERT ... ON CONFLICT (entity_id, month_end, totals_fingerprint) WHERE success DO
   NOTHING RETURNING id` claim logic is byte-identical to pre-change code (diff confirms only the
   `switch` restructuring changed, not this block). In `ledger-acknowledgment-letter-queries.ts`,
   the atomic pre-send claim (`UPDATE ... SET sentAt = now() ... WHERE sentAt IS NULL RETURNING id`,
   Step 2) is untouched by this diff entirely — B-70 only changed how "was this blocked" is learned
   *after* the claim/send, never the claim-before-send ordering itself. Both permanent-claim paths
   are unmoved.
4. **Item 2 (external contracts) — diffed against `HEAD`, not read from the work-log's claim.**
   `git diff` on both caller files line by line: same three DB-write branches in
   `sendMonthlyReportToBoard()` (not_delivered → `success:false` revert-shaped row,
   failed → `success:false` row with real error, delivered → the same conflict-guarded insert),
   same external `SendReportResult` union; same `EmailLetterResult`/per-address shape and the same
   `anyDelivered`/`anyGenuinelyFailed`/revert logic in `emailAcknowledgmentLetters()`. Neither
   route file (`api/admin/ledger/reports/send/route.ts`,
   `api/admin/ledger/acknowledgments/letters/email/route.ts`) appears in `git status` — confirmed by
   reading both in full: both already had their own `auth()` + `hasFeature()` gates before this
   change and neither was touched.
5. **Item 3 (the compile-error claim) — reproduced independently**, not just re-run from the
   implementer's described steps. Created a throwaway file importing `DurableSendResult` and
   writing `if (result.success)` with no suppression: `tsc --noEmit` produced
   `error TS2339: Property 'success' does not exist on type 'DurableSendResult'` on that exact line.
   Deleted the scratch file afterward (`git status` clean).
6. **Item 4 (exhaustiveness) — reproduced independently** with a fresh two-branch consumer (handling
   only `delivered`/`failed`, omitting `not_delivered`) assigned to a `never`-typed default binding:
   `tsc --noEmit` produced `error TS2322: Type '{...; outcome: "not_delivered"; ...}' is not
   assignable to type 'never'` — a caller cannot silently drop a branch and still compile.
7. Reproduced the implementer's own compile-time regression check from a different angle: rather
   than deleting the `@ts-expect-error` line (which just proves the line is currently
   necessary), I added `success?: boolean` directly onto `DurableSendResult` to simulate a future
   "fix" that reintroduces the field. Result: `TS2578: Unused '@ts-expect-error' directive` at
   `email-durable-claim.test.ts:108` — exactly the failure mode the design says protects against the
   type quietly rotting back to `success`-shaped. Restored the file from a pre-edit backup and
   re-ran `tsc --noEmit` clean before continuing.
8. **Item 5 (sixth instance)** — confirmed `notAttempted?: true` is set only on the `dev_no_api_key`
   branch in `email.ts` (one-line addition, diff-verified) and forwarded through
   `SendBulkMemberEmailResult`. Confirmed the new `email-durable-claim.test.ts` includes a
   `dev_no_api_key` mapping test and the ack-letter suite gained a parallel
   `notAttempted`/`dev_no_api_key` regression case (verified in the test diff, not just counted).
9. **Item 6 (read-back workaround gone)** — `grep -n emailQueue
   src/lib/ledger-acknowledgment-letter-queries.ts` returns zero matches; the `emailQueue` schema
   import is removed from that file's import list (diff-confirmed); `inArray` remains used
   elsewhere in the same file (`listGeneratableAcknowledgments`'s scoped-ids query, line 106) —
   confirmed nothing else in the file depended on the removed import.
10. **Item 7 (DECISION-085 intact)** — `git diff -- src/lib/email-guardrail.test.ts
    src/lib/email-no-api-key.test.ts` produced zero output. Both files' full suites (17 + 4 = 21
    tests) are part of the 2182 that passed.
11. **Item 8 (churn)** — `git diff --stat` and `git status --short`: exactly 8 files touched (2 docs,
    CLAUDE.md, `email.ts`, 2 caller files + their 2 test files) plus 2 new files (the durable-claim
    module + its test). No route file, no other `src/lib` file, no component appears. Matches the
    design's "near-zero churn" claim.
12. **Item 9 (click-through)** — started `pnpm dev` against the dev database (`.env.local`'s
    `DATABASE_URL`; `EMAIL_DEV_ALLOWLIST` unset, confirming deny-by-default is live by default in
    this environment), signed in as the e2e admin via a throwaway Playwright script (not committed;
    deleted after the run, `git status` confirmed clean), and drove both surfaces:
    - `/admin/ledger/reports` loaded without error under the migrated code. The "Send to Board"
      panel rendered "No statements ready to send yet." — a genuine dev-data precondition (no
      reconciled month is currently eligible), not a regression. I did not fabricate a ready month
      to force a click; doing so would mean writing synthetic reconciliation state into a database
      seeded from real Quicken exports, which is out of scope for verifying this ticket.
    - `/admin/ledger/donors/letters` loaded without error; "Nothing to generate" (no acks have
      generated-but-unsent letters right now).
    - `/admin/ledger/donors?tab=acknowledgments` showed 49 real pending Foundation gifts, all
      requiring a donor link before a letter can be generated — getting to an emailable state would
      mean linking a donor to real transaction data, which I judged out of scope for a
      mechanism-only refactor with no UI change.
    - `/admin/email-queue` loaded and correctly displayed prior `blocked_non_production` /
      `dev_no_api_key` rows under the honest "Not Sent (Non-Production)" / "Blocked (not
      production)" labeling (pre-existing rows from earlier work, not generated by this
      click-through) — confirms the UI-facing honesty language this ticket depends on is intact.
    - I could not drive an actual live send to completion in this dev database due to data
      preconditions (no ready-to-send statement, no generatable-and-linkable ack in a low-risk
      path), not because of anything this change broke. This is a **known limitation of this
      verification pass**, offset by: (a) both route handlers are byte-identical and untouched,
      (b) 33 `financial-report-send.test.ts` tests and the full ack-letter suite exercise every
      branch (`delivered`/`failed`/`not_delivered`×2 reasons, mixed batches) against the real
      function bodies with only the email layer mocked, and (c) the atomic-claim code paths
      themselves are diff-confirmed untouched (item 3 above).
    - Cleaned up: killed the dev server, deleted the scratch Playwright spec, confirmed `git status`
      matches the pre-verification state exactly.

### Outputs

- No code changes — verification only. No files modified by qa.
- Confirmed clean working tree post-verification: `git status --short` matches the state at the
  start of Phase 5 (same 8 modified + 3 untracked files the implementer left).

### Gate Results

- `pnpm exec tsc --noEmit`: **PASS** (clean).
- `pnpm lint`: **PASS** (0 errors; 1 pre-existing unrelated warning).
- `pnpm test`: **PASS** — 126 files, **2182/2182** tests passed, 3.97s.
- `pnpm build:only`: **PASS** — exit 0, full route manifest, no unused-export warnings.
- `pnpm test:e2e`: not run in full (12-minute serial suite; this ticket touches zero routes/pages,
  so the existing e2e suite's assertions about those surfaces are unaffected by construction —
  substituted with the targeted manual click-through above, which is the more direct signal for a
  library-only refactor with no route/UI diff).

### Regression Tests Added

None by qa — this ticket's own regression tests were delivered by the implementer per the pipeline
rule ("every unit test named in the Phase 3 design doc is written and passing — the implementer
delivers these, not qa"), and I verified them rather than duplicating them:
- `src/lib/email-durable-claim.test.ts` items 4 and 7 (`notAttempted`/`dev_no_api_key` mapping) —
  the sixth DECISION-102 instance; confirmed these fail against pre-fix code by the implementer's
  own delete-the-line test, which I independently re-derived via a different mutation (reintroducing
  `success` on the type, producing `TS2578`) with the same conclusion.
- `ledger-acknowledgment-letter-queries.test.ts`'s new `dev_no_api_key`-treated-as-blocked test —
  regression for the sixth instance in the bulk path specifically.

### Feature-Gate Audit (mandatory before PASS)

**No protected routes or server actions were added or changed by this ticket.** Confirmed by
`git status`/`git diff --stat`: neither
`src/app/api/admin/ledger/reports/send/route.ts` nor
`src/app/api/admin/ledger/acknowledgments/letters/email/route.ts` appears in the diff. Read both in
full regardless (not inferred from their absence from the diff):

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `POST /api/admin/ledger/reports/send` | yes | yes | `FEATURES.LEDGER_REPORT_SEND` (mutation/send key, narrower than general ledger view — correct) |
| `POST /api/admin/ledger/acknowledgments/letters/email` | yes | yes | `FEATURES.LEDGER_RECORD` (matches the sibling generate/print/mark-sent actions on the same screen — correct, unchanged) |

Both gates were correct before this ticket and are unmoved by it — this audit is a confirmation of
"still intact," not a new finding.

### Coverage on Critical Modules

Not applicable in the strict sense — this ticket touches no `events.ts`/`permissions.ts`/`members.ts`
code. For the modules this ticket *does* touch:
- `src/lib/email-durable-claim.ts` — fully covered: every branch of `outcomeFromRaw()` (delivered,
  failed, failed-with-no-error-string, blocked, notAttempted, blocked-takes-precedence-over-
  notAttempted) plus both wrapper functions' plumbing and the exhaustiveness/compile-time
  assertions, 15 tests total.
- `src/lib/email.ts`'s two new one-line branches (`notAttempted` on `dev_no_api_key`, forwarding on
  the bulk per-recipient shape) — covered by the pre-existing, byte-unmodified
  `email-no-api-key.test.ts` (the `dev_no_api_key` branch itself) plus the new durable-claim tests
  (the forwarding).

### Verdict: PASS

### Closing judgment — unrepresentable vs. discouraged

For the two callers that exist today (`sendMonthlyReportToBoard()`,
`emailAcknowledgmentLetters()`), I agree with the design's own claim: the mistake is **genuinely
unrepresentable**, not merely discouraged. I verified this myself rather than taking the design
doc's word for it — `if (result.success)` does not compile against `DurableSendResult` (`TS2339`,
reproduced), and neither does a switch that silently drops a branch (`TS2322` against the `never`
check, reproduced). There is no runtime escape hatch either: `outcomeFromRaw()` is a pure function
with no conditional that could be bypassed by a particular input shape — every raw result maps to
exactly one of the three outcomes, in a fixed precedence (`blocked` > `notAttempted` > `!success` >
delivered) that I read line by line.

For a **hypothetical third caller**, the design is honest that it is only discouraged, and I think
that's the right call, not an overclaim dressed up as caution. A future engineer writing a new
durable-claim feature would have to affirmatively import `sendEmail`/`sendBulkMemberEmail` directly
from `@/lib/email` instead of the durable-claim module — nothing stops that import today. I'd put
the practical likelihood of this recurring at **low but non-zero** in this specific codebase: the
project's own review discipline (CLAUDE.md's Phase 2/3 gating, the six-phase pipeline, the fact that
this very ticket exists because a *tech-lead* traced the pattern across incidents) means a new
durable-claim feature is very likely to go through a design phase that would surface
`sendEmailForDurableClaim()` — the doc comment on `SendEmailResult` now points at it directly, and
CLAUDE.md names it. The realistic failure mode isn't a careful new design skipping the helper; it's
a rushed bug-fix variant (skipped Phase 2/3, "brief design or skip if trivial") bolting a durable
claim onto an *existing* ordinary call site without anyone asking the gating question. That's a
process gap, not a type-system gap, and it's exactly the gap the design doc names and declines to
solve with a bigger tool (a typed ESLint rule) until a third instance actually justifies it. I think
that's the correct amount of caution, not an excuse — but it means "unrepresentable" is a claim
about the two known callers, and "discouraged" is the honest word for everything else.

### Open questions / handoff notes

- **Next agent: analyst, for Phase 6.** Gates are clean, the safety property holds, contracts are
  unchanged, and both compile-time claims are independently reproduced — this is a PASS with no
  loop-back.
- **Minor doc staleness, not a gate failure:** DECISION-103's own `Status`/`Impact` text still says
  "implementation pending (api-developer)" even though Phase 4 is complete. Worth a one-line fix
  when Phase 6 or a later doc pass touches `docs/decisions.md`, but it doesn't block shipping.
- **Manual click-through could not exercise a live send to completion** in the current dev database
  (no ready-to-send financial statement; no low-risk path to a generatable-and-linked acknowledgment
  letter). This is a data-state limitation of dev, not a code defect — offset by the diff-level
  confirmation that both atomic-claim code paths are untouched and by the existing 33+ mock-based
  tests exercising every outcome branch against the real function bodies. If a future session wants
  a fully live click-through, it would need either a seeded "ready to send" reconciled month or a
  donor linked to one of the 49 pending Foundation gifts — neither of which I judged worth writing
  synthetic data into a Quicken-seeded dev DB for this ticket.
- Per DECISION-102/CLAUDE.md's own recommendation: if a third durable-claim caller is proposed, its
  Phase 2/3 review should treat "does this use `sendEmailForDurableClaim()`/
  `sendBulkMemberEmailForDurableClaim()`" as a named gating question, especially if it arrives as a
  bug-fix variant with Phase 2/3 skipped.

# Phase 6 — Shipped vs Intent (analyst)

## Phase 6 — Shipped vs Intent — 2026-09-25

**Owner:** analyst
**Status:** complete

### Summary

I re-read the Phase 3 design, DECISION-102/103, the Phase 4 implementation notes, and QA's Phase 5
PASS, then independently re-verified the load-bearing claims against the actual source rather than
trusting the chain of reports: read `src/lib/email-durable-claim.ts` in full, confirmed
`DurableSendResult`/`DurableSendOutcome` genuinely have no `success` field anywhere in their type
definitions, confirmed both migrated callers (`financial-report-send.ts`,
`ledger-acknowledgment-letter-queries.ts`) call the new wrapper functions and branch on `outcome`,
and confirmed the CLAUDE.md DECISION-102 section accurately describes the shipped mechanism. This
ticket has no user-facing surface — no page, no route, no permission — so most of the standard
Phase 6 edge-case checks (empty state, mobile, permission gate) are not applicable; the review here
is almost entirely a code/contract-fidelity check plus a policy-gap judgment call.

**VERDICT: SHIP WITH NOTES.**

### What's working

The core claim — that a caller adopting `sendEmailForDurableClaim()` /
`sendBulkMemberEmailForDurableClaim()` cannot compile `if (result.success)` — holds up under my own
reading, not just QA's. `DurableSendOutcome` is a three-member discriminated union
(`delivered` / `failed` / `not_delivered`) with no fourth "just trust me" boolean anywhere, and
`outcomeFromRaw()` is a small, pure, fully-covered function with a fixed precedence
(`blocked` > `notAttempted` > `!success` > delivered). Both migrations are exactly what the design
promised: same external contracts, same DB-write branches, same reason strings — I read the diffs,
not just the description of them. The B-67 `email_queue` read-back workaround is genuinely gone
(zero `emailQueue` references left in the ack-letter file), which is a real simplification, not
just a relocation of the same complexity.

### Intent-vs-shipped diff

- **Phase 3 said:** two new functions with no bare `success` field, forcing exhaustive
  `outcome` handling. **Shipped:** exactly that, verified by direct source read. **Verdict: matches.**
- **Phase 3 said:** `sendEmail()`/`sendBulkMemberEmail()`'s existing contract is untouched, only
  additively widened (`notAttempted?: true`). **Shipped:** confirmed — `blocked`'s doc comment and
  single call site are unchanged; `notAttempted` is new and additive only. **Verdict: matches.**
- **Phase 3 said:** the two known durable-claim callers migrate; ~16 ordinary callers untouched.
  **Shipped:** confirmed via `git status`/diff scope in QA's report and my own targeted greps —
  no other call site touched. **Verdict: matches.**
- **Phase 3 said:** the 17+4 DECISION-085 guardrail/no-API-key tests must pass unmodified.
  **Shipped:** zero diff on both files, confirmed by QA and consistent with the design's own gate.
  **Verdict: matches.**
- **Phase 3 said:** this closes a sixth, previously-latent instance (`dev_no_api_key` /
  `notAttempted`) for the two known callers. **Shipped:** the field exists and is wired through
  `outcomeFromRaw()`, but — as the design itself states plainly — it was never live for either
  migrated caller (both are structurally routed around it today by the shape of their recipients).
  **Verdict: matches** — the design never claimed this fixed a live bug, only a latent one, and I
  can't find anywhere in the ticket that overclaims otherwise.
- **Phase 3 said the residual gap (a brand-new caller bypassing the wrapper) would be mitigated by
  doc comments + a CLAUDE.md paragraph, and would remain a process gap, not a type gap.**
  **Shipped:** the CLAUDE.md paragraph exists and is accurate. **Verdict: matches, but see Q2 below
  — I think the mitigation as shipped is under-specified relative to how it will actually be
  bypassed.**
- **Doc hygiene:** DECISION-103's status line said "implementation pending" and B-70 was unchecked
  in `docs/backlog.md` after Phase 4/5 had already completed. **Verdict: minor regression in
  process hygiene, not in the shipped code** — I fixed both directly in this Phase 6 pass
  (`docs/decisions.md`, `docs/backlog.md`) rather than filing it as a follow-up, since it was a
  one-line factual correction with no design judgment involved.

### Edge cases

- **Empty state:** not applicable — no UI.
- **Failure microcopy:** not applicable to end users (no UI), but the two consuming surfaces
  (`/admin/ledger/reports`, `/admin/ledger/donors/letters`) still say "Emailed"/"Blocked (not
  production)"/"Failed" exactly as before — confirmed unchanged by both route files being absent
  from the diff.
- **Permission gate:** not applicable — no new route or permission; QA re-confirmed the two
  existing routes' `auth()`+`hasFeature()` gates are untouched and correct.
- **Mobile:** not applicable — no UI.
- **Brand consistency:** not applicable — no UI.

### Answers to the five questions

**1. Is the cause actually removed, or relocated, for the two known callers?**
Removed, not relocated — I verified this myself rather than accepting QA's word for it. I read
`src/lib/email-durable-claim.ts` end to end: `DurableSendOutcome` is a closed three-member union: `{
outcome: "delivered" }`, `{ outcome: "failed"; error: string }`, `{ outcome: "not_delivered";
reason: ... }`. There is no field on that type, or on `DurableSendResult`, that carries the old
`success` boolean under a different name — it isn't hiding as `ok`, `delivered: boolean`, or
anything else a caller could read as a shortcut. Both migrated files (`financial-report-send.ts`
line 519, `ledger-acknowledgment-letter-queries.ts` line 600+) call the new wrapper and switch on
`.outcome`. QA's framing is exactly right and I'd sharpen it the same way they did: "unrepresentable"
is a true statement about these two files specifically, not about the codebase as a whole — the
type change is total for its two consumers and nonexistent for everyone else, by design (DECISION-085).

**2. Should the bug-fix variant carry an explicit carve-out?**
Yes, and I think this is the single most important actionable item to come out of this ticket. The
current Bug-Fix Variant table says Phase 2 is skippable "if the fix doesn't touch invariants" and
Phase 3 can be "brief... or skip if trivial." The failure mode QA named — a rushed bug-fix bolting a
durable claim onto an *existing ordinary* call site — is precisely a case where the person doing
the work has to *recognize* that they're touching the DECISION-102/103 invariant before they know to
not skip the review that would catch it. That's circular: the carve-out has to be legible without
requiring the judgment call it exists to backstop. Concretely, I'd add one row/note to CLAUDE.md's
"Bug-Fix Variant" table (`## Bug-Fix Variant`, `docs/CLAUDE.md`), phrased as a standing exception
rather than a judgment call:

> **Durable-claim exception:** a change that adds, modifies, or converts a code path into one that
> writes a durable "this was sent" claim (a permanent `sentAt`, a partial-unique-indexed success
> row, an append-only decision-history row recording a message as sent, or any equivalent) is never
> eligible for Phase 2 skip or an abbreviated Phase 3, regardless of how small the diff is. Phase 2
> must confirm the change uses `sendEmailForDurableClaim()`/`sendBulkMemberEmailForDurableClaim()`
> (DECISION-102/103); Phase 3 must name which of the three outcomes reverts the claim.

I did not make this edit myself — it's a pipeline-policy change (altering what "skip if trivial"
means), not a factual correction, and I think it belongs to tech-lead's next Agent & Instruction
review (or immediate action if the user wants it now) rather than something I write in unilaterally
during Phase 6. I'm flagging it as a concrete backlog item below.

**3. Was option (b) the right call over (a)?**
Yes, with a caveat. Given what actually shipped — zero churn to the 16 ordinary sites, the 21
guardrail/no-key tests passing byte-for-byte unmodified, a clean typecheck/build, and full
unrepresentability for the two callers that had actually caused incidents — (b) delivered the safety
that mattered at a fraction of the risk (a) would have carried (a same-day mechanical rewrite of
~18 call sites in code stabilized hours earlier, which is exactly the kind of change that
introduces a *new* bug while fixing an old one). The caveat is the one QA already named and I agree
with: (b)'s safety is conditional on every future durable-claim caller being *identified as such*
during design. (a) doesn't have that dependency — a discriminated union touching every call site
would catch a future caller by construction, with no reliance on anyone recognizing anything. So
the trade was right *for two known callers today*, but its soundness decays as more durable-claim
callers accumulate without the process fix in Q2. I would not revisit this decision today, but I
would treat "how many durable-claim callers exist" as a standing trigger: if a third one is ever
proposed, that is the point at which (c) (a real typed-lint rule) — not another one-off wrapper —
becomes the proportionate move, exactly as the design doc itself says.

**4. Does anything the user actually asked for remain undone?**
No — tracing the full chain, the original complaint ("why didn't I get an email when a proposal was
submitted?") is closed end to end, and B-70 was never actually on that chain's critical path:
- The revoked/missing-key path and the silently-discarded Resend SDK error (defects #1 and #3 in
  DECISION-102) were fixed in `sendEmail()` itself, prior to this ticket
  (`docs/work-log/2026-09-25-sendemail-unchecked-error.md` per the decision log) — that fix applies
  to *every* `sendEmail()` call site, including the proposal-notification send, which is an
  ordinary (non-durable-claim) caller and was never touched by B-70.
- The retry route's identical independent bug (defect #2) was fixed the same day, separately.
- The durable-claim instances (financial-report auto-send, the ack-letter blocked-claim/B-67, and
  now the general-purpose hardening in B-70) are a *second-order* finding uncovered while fixing
  the first bug, not the cause of the original missed proposal email. B-70 makes the codebase more
  resistant to a *future* recurrence of the pattern in a durable-claim writer; it was not required
  to close the original complaint, and closing it doesn't newly unblock anything the user was
  waiting on.
- What remains open — B-68 (deduplicating `attemptSend()`/`sendEmail()`'s shared error-
  classification logic) and the bug-fix-variant carve-out from Q2 — are both forward-looking
  hardening/process items, not unresolved instances of the original defect. Both are correctness-
  neutral for anything already sent or lost.
I consider the original user-facing question fully answered and its cause fully closed.

**5. Is the sixth instance genuinely closed, or closed only for the two migrated callers?**
Closed only for the two migrated callers — and the design and QA both say this plainly rather than
overclaiming, which I want to credit rather than just restate. `notAttempted` is now set on
`SendEmailResult` for *every* caller (it's on the base type in `email.ts`), but only
`sendEmailForDurableClaim()`/`sendBulkMemberEmailForDurableClaim()` are *forced* to read it via the
exhaustive switch. An ordinary caller (all ~16 of them) now receives `notAttempted?: true` on its
result and is free to ignore it exactly as it was free to ignore `blocked` before — which is fine,
because none of them write a durable claim, so there's nothing for the field to protect there. A
hypothetical new durable-claim caller that skips the wrapper would face the exact same exposure to
this instance as to the original `blocked` problem: the field exists, nothing forces it to be read.
So: closed by construction for the two known callers, present-but-optional everywhere else, and
open again for any future bypass of the wrapper — which is the same shape as answers 1 and 2, not a
new gap.

### Is this class of problem now genuinely closed, or merely quieter?

**Quieter, not closed** — and I think that's an honest characterization rather than a hedge. Six
defects of one shape shipped in roughly 24 hours; this ticket removes the two *known* live and
latent instances of the caller-layer half of that shape (durable claims taken from a bare `success`)
by a mechanism that is real, verified, and not merely aspirational — I checked the type myself, it
does not compile the mistake. That is genuine progress, not a paper fix. But the mechanism's reach
is exactly two files wide by design, and the thing that would make it total — a caller being
*routed* to the safe entrypoint rather than *choosing* it — doesn't exist yet. The single load-
bearing structural gap is the one QA named and I've sharpened in Q2: the bug-fix variant's Phase 2/3
skip conditions are exactly the seam a third instance would arrive through, because "does this touch
an invariant" is a judgment call, and this class of defect has a track record of six instances of
someone not making that judgment call correctly under time pressure. Until that seam is closed (or a
typed-lint rule makes the question moot, per option (c) held in reserve), I'd say: **the specific
two failure modes that have already burned this project are closed; the general pattern — someone
adds a new durable-claim write without recognizing it as one — is contained by a narrower and more
honest set of tools than yesterday, but not eliminated.**

### Follow-ups (SHIP WITH NOTES)

1. **Add the durable-claim carve-out to CLAUDE.md's Bug-Fix Variant table** (see Q2 for exact
   wording and rationale). Owner: tech-lead, next Agent & Instruction review or sooner if the user
   wants it immediately. This is the highest-value remaining item — it's the one gap directly tied
   to how five of the six known instances actually shipped (under time pressure, without a full
   Phase 2/3).
2. **B-68** (extract shared `attemptResendSend()` for `sendEmail()` and the retry route) remains
   open and correctly out of scope for this ticket — no new action needed beyond what's already
   tracked in `docs/backlog.md`.
3. **If a third durable-claim caller is ever proposed**, its Phase 2/3 review must name whether it
   uses `sendEmailForDurableClaim()`/`sendBulkMemberEmailForDurableClaim()` as an explicit gating
   question (already noted in CLAUDE.md and this work-log) — no new item needed, just enforcement
   discipline at that future ticket's review.

### Outputs

- `docs/decisions.md` — DECISION-103's `Status` line corrected from "Phase 3 design —
  implementation pending" to "Resolved — implemented and shipped"; Impact bullet updated from
  "Implementation pending (api-developer)" to name the completed implementer/qa/ship chain.
- `docs/backlog.md` — B-70 checked off (`[x]`) with a resolution note pointing at DECISION-103 and
  this work-log.
- No application code touched. No commits made. No database writes made.

### Open questions / handoff notes

- The CLAUDE.md Bug-Fix Variant carve-out (Q2/Follow-up 1) is a recommendation, not an edit I made —
  it changes pipeline policy and I judged that outside a Phase 6 code-vs-intent review's scope to
  apply unilaterally. Next session or the user should decide whether tech-lead applies it now or at
  the next 7-day retrospective.
- Pipeline closed. This work-log's Phase 6 verdict is the final gate for B-70/DECISION-102/103.
