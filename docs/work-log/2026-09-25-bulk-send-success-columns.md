# Bulk-Send Durable-Claim Success Columns Read `result.success` Directly (B-73) — Work Log

> **Slug:** `2026-09-25-bulk-send-success-columns`
> **Surface:** (dashboard) admin — `/admin/dues/reminders`, `/admin/events/[id]/announce`
> **Permission(s):** existing `FEATURES.DUES_MANAGE`, `FEATURES.EVENTS_ANNOUNCE` — unchanged
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant — **Durable-Claim Exception applies (CLAUDE.md).** This diff
> writes durable per-recipient "this was sent" rows (`dues_reminders.success`,
> `event_announcements.success`), so Phase 2 (architect) is **not** skipped and Phase 3 (tech-lead)
> is **not** abbreviated, per the exception added to CLAUDE.md earlier today. Phase 1 is a brief
> bug confirmation per the Bug-Fix Variant table, not a full five-pass review.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement (brief) | analyst (self-certified per bug-fix variant) | Complete | Confirmed | 2026-09-25 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-09-25 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-09-25 |
| 4 — Implementation | api-developer | Complete | Gates pass; regression tests confirmed red pre-fix | 2026-09-25 |
| 5 — Verification | qa | Complete | PASS | 2026-09-25 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

> **Table-integrity note (architect, Phase 2 pass):** this table previously marked Phases 3 and 4
> as `Complete` with dates, but this file contained no Phase 3 design-doc section, no Phase 4
> implementation section, and the working tree has no diff against either
> `src/app/api/admin/dues/reminders/route.ts` or `src/app/api/admin/events/[id]/announce/route.ts`
> (verified via `git diff --stat` at review time — clean). Reset both rows to `Pending` rather than
> build a review on top of an unsubstantiated claim. If Phase 3/4 work exists elsewhere, re-verify
> and re-date this table from that actual content, not from the row alone — the work-log is the
> pipeline's source of truth precisely so a stale/pre-filled row like this doesn't get treated as
> ground truth.

---

# Phase 1 — Bug Confirmation (bug-fix variant)

## Root cause

`src/app/api/admin/dues/reminders/route.ts` and `src/app/api/admin/events/[id]/announce/route.ts`
both write `success: result?.success ?? false` straight off `sendBulkMemberEmail()`'s raw
per-recipient result. `SendBulkMemberEmailResult`'s per-recipient shape now carries `blocked?: true`
/ `notAttempted?: true` (DECISION-103, shipped earlier today) with `success: true` still set on
those paths, by design, for the ~16 ordinary callers (DECISION-085). These two routes are NOT
ordinary callers — they persist `result.success` as a durable per-member "reminded"/"announced"
claim in `dues_reminders` / `event_announcements` — so they inherit the exact defect shape
DECISION-102 names (#7 and #8): a blocked-non-production or no-API-key send is recorded as a
successful reminder/announcement when nothing was delivered.

`sendBulkMemberEmail()` unconditionally forces the non-production deny-by-default guard for bulk
sends, so every dev/QA exercise of either feature against real member addresses is guaranteed to
hit the blocked path — the very next manual test of dues reminders or event announcements outside
production will write a false `success: true` row without this fix.

## Reproduction

1. Outside production (`NODE_ENV !== "production"`), with `EMAIL_DEV_ALLOWLIST` unset or not
   covering the recipient (the default for any real member/board address).
2. POST `/api/admin/dues/reminders` (or `/api/admin/events/[id]/announce`) for a recipient.
3. `sendBulkMemberEmail()` returns `{ to, success: true, blocked: true, emailQueueId }` for that
   recipient (nothing was handed to Resend).
4. Pre-fix: the route writes `success: true` into `dues_reminders` / `event_announcements`. The
   "Last reminded" badge (dues) or "Emailed N of M" history (events) claims delivery that never
   happened.

## Scoping note — worth recording as its own finding

The earlier same-day "hunt for a third instance" of this defect class
(`docs/work-log/2026-09-25-email-silent-success.md`) was explicitly scoped to "every file writing
`emailQueue.status` directly" and correctly concluded these two files don't touch that column. That
scoping was right for the `emailQueue`-layer defect (DECISION-102 rule 1) but never asked the
caller-layer question (rule 2) for files other than the two already-known durable-claim callers.
Same defect shape, found only because today's test-coverage review searched for it under a
different description ("a downstream `success` column fed from a send result", not "writes
`emailQueue.status`"). The lesson: a defect-class hunt scoped to one artifact of the defect (the
column a bad write lands in) can miss a shape-alike instance that lands in a different column
entirely. No action item beyond noting it — the two known instances are fixed here.

## Severity, stated honestly (per the task brief, not inflated)

Lower than the donor-acknowledgment case (B-67) or the financial-report case. Neither claim here is
permanent-and-unresendable: a treasurer can send another dues reminder; an event announcement can
be re-sent. The consequence is a **false record** — a "last reminded" badge or "already announced"
history row claiming delivery that didn't happen — misleading to a human relying on it, but not a
stuck state. This fix is scoped accordingly: no new schema column, no new UI state machine.

---

## Phase 2 — Architectural Review — 2026-09-25

**Owner:** architect
**Status:** complete

### Summary

**Approved with suggestions.** Fixing in place — swapping `sendBulkMemberEmail` for
`sendBulkMemberEmailForDurableClaim` in both route handlers, with no new schema column — is the
right shape given the stated severity (neither table holds a permanent, unresendable claim). One
suggestion: introduce one small shared helper for the `DurableSendOutcome → {success, error}` row
mapping so the two new call sites don't duplicate it independently, since a third instance already
exists (untouchable) in `financial-report-send.ts`. `getLastRemindedMap()`'s missing `success`
filter is a real, related defect but is out of scope for this diff — file it separately.

### What I did

- Read both route handlers in full (`dues/reminders/route.ts`, `events/[id]/announce/route.ts`)
  and confirmed both compute `success`/`error` per recipient from `sendBulkMemberEmail()`'s raw
  result via `resultByEmail.get(...)`, then insert one row per attempted recipient — the exact
  shape DECISION-093 requires and the exact shape that must be preserved.
- Read `src/lib/email-durable-claim.ts` in full — confirmed `DurableSendResult` has no `success`
  field, `SendBulkMemberEmailForDurableClaimResult.results` is keyed by `to` (same key the two
  routes already use for their `resultByEmail` map), and `outcomeFromRaw()` is private to that
  file (not exported, not reusable directly — a new helper is additive, not a re-export).
- Read the precedent `switch (sendResult.outcome)` block in `financial-report-send.ts` (lines
  ~633-734) — confirmed it writes `success: false` + a descriptive `error` string for
  `not_delivered`, no new column, despite that table carrying a *stricter* invariant (a partial
  unique index on `success = true`) than either table here. If that table didn't need a new column
  under a tighter constraint, neither does `dues_reminders` or `event_announcements`.
- Read `src/lib/db/schema.ts` for both `duesReminders` (~line 532) and `eventAnnouncements`
  (~line 574) — confirmed both already carry `success: boolean NOT NULL` + `error: text`
  (nullable), no partial unique index, no other constraint that would make a `not_delivered` row
  ambiguous with a genuine failure at the schema level.
- Read `src/lib/dues-reminders-queries.ts`'s `getLastRemindedMap()` — confirmed it has no
  `WHERE success = true` filter today, so even a genuinely failed send already sets the "Last
  reminded" badge, independent of today's fix.
- Read `dues-reminder-sender.tsx` and `event-announcement-history-table.tsx` for how they consume
  the API response — both already treat `success: boolean` + optional `error: string` as the
  complete failure signal (toast counts, per-row title tooltip, "Emailed N of M — F failed"); no
  client-visible shape change is needed for this fix.
- Checked for other consumers of `duesReminders.success` / `eventAnnouncements.success` — none
  beyond the two query files and the two routes under review.

### Outputs

- No files changed for the fix itself (implementation is Phase 4, api-developer). Table-integrity
  correction made to this file's own Per-Phase Status table (see note above the table).
- No `docs/decisions.md` entry — this is a bug fix within an already-decided pattern
  (DECISION-102/103), not a new architectural decision. If api-developer creates the suggested
  shared helper file, that's an implementation-pattern reuse, not a new module/dependency/route-
  group change, so it doesn't need its own DECISION entry either — a one-line mention in this
  work-log's Phase 4 section is enough.

### Rulings

**1. Directory/placement — approved.** Fix in place in the two route handlers: import
`sendBulkMemberEmailForDurableClaim` from `@/lib/email-durable-claim` in place of
`sendBulkMemberEmail` from `@/lib/email`, and replace each route's flat
`success: result?.success ?? false` / `error: result?.error ?? null` construction with an
exhaustive `switch` (or a shared helper — see below) over `DurableSendOutcome`, ending in a
`never`-check default exactly like `financial-report-send.ts`. **No new schema column.** Given the
severity ruling (re-sendable, not a permanent claim, no unique-index interaction), reusing
`success: false` + a distinguishing, human-readable `error` string for the `not_delivered` case is
sufficient and proportionate — a new column would be the over-engineering the task brief warned
against. Use the *same* message text `financial-report-send.ts` uses for
`blocked_non_production` (`"Blocked — outbound email is disabled outside production
(EMAIL_DEV_ALLOWLIST). Nothing was delivered."`) rather than inventing new wording per call site —
and add one equivalent, clearly-worded string for `dev_no_api_key`. Consistent wording is what
makes `error` machine-greppable later even though it's stored as free text today.

**2. Server/client split — confirmed, none.** Both routes are server-only; the JSON response shape
(`sent: [{ memberId, success, error? }]`) is unchanged in *shape*, only the values become accurate.
Verified both consuming components already branch on `success`/`error` correctly and need no
changes. `event-announcement-history-table.tsx`'s "Emailed N of M — F failed" aggregate reads a
server-computed count over `success`, so it will automatically start counting previously-mislabeled
blocked/no-key sends as failures — a correctness improvement that falls out of the fix, not
something to touch by hand.

**3. Dependencies — confirmed, none.** No new package; `sendBulkMemberEmailForDurableClaim` is
already shipped and in-scope to import.

**4. Invariant compliance — compliant, with one suggestion.**
- DECISION-102/103: satisfied by adopting the durable-claim entrypoint and an exhaustive switch —
  `if (result.success)` must not appear in either route after the fix.
- DECISION-093 (row-per-attempted-recipient): preserved — this fix only changes how each row's
  `success`/`error` fields are *computed*, not the one-row-per-recipient insert shape or the shared
  `batchId`.
- DECISION-085 (`sendEmail`/`sendBulkMemberEmail` contract untouched): preserved — the fix calls
  into the already-shipped wrapper, which itself calls the untouched function; none of the five
  named out-of-scope files need editing.
- Duplication rule: **suggestion, not a blocker.** The `DurableSendOutcome → {success, error}` row
  mapping would otherwise be written twice more today (once per route), on top of the one
  already-shipped, untouchable instance in `financial-report-send.ts` — three total, the rule's
  own threshold. Recommend a small new file, e.g. `src/lib/durable-claim-row.ts`, exporting one
  pure function (something like `durableOutcomeToRow(outcome: DurableSendOutcome): { success:
  boolean; error: string | null }`) that both routes import. It only needs to import the
  `DurableSendOutcome` *type* from `email-durable-claim.ts` — reading a type is not modifying that
  file, so this stays inside today's constraint. This gets the two *new* copies down to one shared
  home; the pre-existing third copy in `financial-report-send.ts` can't be folded in today (that
  file is out of scope), so note it as a small backlog follow-up for whenever that file is next
  legitimately open, rather than doing it now.

**5. `getLastRemindedMap()` — out of scope for B-73, file separately.** This is a real but distinct
defect: even before today, a genuinely *failed* send (`success: false`) already set the "Last
reminded" badge, because the query has no `success` filter at all. It's in the same defect family
but sits in a different file, was true before DECISION-102/103 existed, and isn't required to fix
the write-side defect named in this task. Fold this fix into today's diff and the "small, reviewable
durable-claim fix" scope quietly grows into "also touch the read path of a different feature."
Recommend a one-line follow-up bug: add `AND success = true` to the query's `WHERE` clause,
tracked as its own backlog item, not a drive-by in this PR.

**6. Scope-creep watch for api-developer:**
- Do not touch `src/lib/email-durable-claim.ts`, `src/lib/ledger-acknowledgment-letter-queries.ts`,
  `src/lib/financial-report-send.ts`, `src/lib/email-send-attempt.ts`, or the email-queue retry
  route — all explicitly out of scope today.
- Do not touch `dues-reminder-sender.tsx` or `event-announcement-history-table.tsx` — no client
  change is required by this fix.
- Do not fold in B-74 (email-queue retry route bypassing domain-table claims) — separate, harder
  problem, needs its own Phase 1.
- Do not add a migration or new column — the severity ruling doesn't support it.
- Do not fix `getLastRemindedMap()` inline — track it separately (see ruling 5).
- Watch for the same `resultByEmail`/`byId` map-then-lookup pattern being preserved verbatim in
  both routes — the fix should touch only the `success`/`error` derivation lines, not restructure
  the surrounding recipient-classification or row-building logic.

### Open questions / handoff notes

- tech-lead: name the shared-helper suggestion (or reject it with reasoning) explicitly in the
  Phase 3 design doc rather than leaving it implicit — either outcome is fine, but it should be a
  stated decision, not silence.
- tech-lead/api-developer: this file's Per-Phase Status table previously claimed Phases 3 and 4
  were already `Complete`, with no corresponding content in this file and no diff in either route
  handler. I reset both rows to `Pending`. Re-verify before trusting any other claim in this
  work-log's status table that isn't backed by an actual section or a real diff.
- File `getLastRemindedMap()`'s missing `success` filter as its own small backlog bug (not a
  DECISION, not this diff).

---

## Phase 3 — Technical Design — 2026-09-25

**Owner:** tech-lead
**Status:** complete

### Summary

Both `POST /api/admin/dues/reminders` and `POST /api/admin/events/[id]/announce` persist a
per-recipient `success`/`error` pair as a durable domain record (`dues_reminders.success`,
`event_announcements.success`) by reading it straight off `sendBulkMemberEmail()`'s raw result.
That result's `success: true` covers a blocked-non-production or no-API-key send by design
(DECISION-085), so both routes currently have the exact defect DECISION-102/103 exist to close:
outside production, a dev/QA exercise of either route writes a false "this was delivered" row.

The fix swaps the import in both routes from `sendBulkMemberEmail` (`@/lib/email`) to
`sendBulkMemberEmailForDurableClaim` (`@/lib/email-durable-claim`, already shipped) and replaces the
`result?.success ?? false` / `result?.error ?? null` construction with a call into one new, shared,
pure mapping function. No schema change, no new permission, no wire-shape change to either route's
JSON response — only the *values* written and returned become honest. This confirms and specifies
the architect's Phase 2 suggestion: introduce `src/lib/durable-claim-row.ts`.

### Permissions

No change. Both routes keep their existing gates exactly as they are today:
- `dues/reminders` — `auth()` + `hasFeature(session.user.id, FEATURES.DUES_MANAGE)` on both GET and
  POST.
- `events/[id]/announce` — `auth()` + `hasFeature(session.user.id, FEATURES.EVENTS_ANNOUNCE)` on both
  GET and POST.

No new `FEATURES` key, no role-binding migration. This is a bug fix to a value computation inside an
already-gated handler.

### API Contract

No shape change to either route. Confirmed by reading both routes' current POST response
construction:

- `POST /api/admin/dues/reminders` — response stays
  `{ signer: {...}, sent: [{ memberId, email, cohort, success, error? }], skipped: [...] }`.
- `POST /api/admin/events/[id]/announce` — response stays
  `{ batchId, scope, occurrenceDate, sent: [{ memberId, success, error? }], skipped: [...] }`.

`dues-reminder-sender.tsx` and `event-announcement-history-table.tsx` are unmodified and unaffected —
both already branch on `success: boolean` + optional `error: string`, which remains true; they will
simply start seeing accurate values (a previously-blocked send now correctly reports
`success: false` with an honest `error`, which `event-announcement-history-table.tsx`'s "Emailed N
of M — F failed" aggregate already counts correctly with no code change, per the architect's Phase 2
ruling #2).

GET handlers on both routes are untouched — this defect is POST-only (send-time), not preview-time.

### Data Model

No schema changes required. `duesReminders` and `eventAnnouncements` both already have
`success: boolean NOT NULL` and `error: text` (nullable), with no partial unique index or other
constraint that a `not_delivered` row would violate (confirmed in Phase 2). A `not_delivered`
outcome writes `success: false` with a distinguishing `error` string, same column, same type.

### New shared file: `src/lib/durable-claim-row.ts`

Confirming the architect's Phase 2 suggestion, precisely specified:

```ts
// src/lib/durable-claim-row.ts
import type { DurableSendOutcome } from "@/lib/email-durable-claim";

/**
 * Maps a per-recipient DurableSendOutcome to the {success, error} pair every
 * durable-claim table (dues_reminders, event_announcements — and, in spirit,
 * financial_report_sends, which has its own untouched inline copy) persists.
 * Pure function, no I/O. Exists so this mapping — DECISION-102/103's rule
 * that `not_delivered` must never become success:true — has exactly one
 * home for its two NEW call sites (B-73), rather than being duplicated
 * again per route (CLAUDE.md's duplication rule: a third instance already
 * exists, untouched, in financial-report-send.ts — can't be folded in
 * today, see Edge Cases).
 */
export function durableOutcomeToRow(
  outcome: DurableSendOutcome,
): { success: boolean; error: string | null } {
  switch (outcome.outcome) {
    case "delivered":
      return { success: true, error: null };
    case "failed":
      return { success: false, error: outcome.error };
    case "not_delivered":
      return { success: false, error: NOT_DELIVERED_MESSAGES[outcome.reason] };
    default: {
      const _exhaustive: never = outcome;
      throw new Error(`Unhandled send outcome: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

const NOT_DELIVERED_MESSAGES: Record<
  Extract<DurableSendOutcome, { outcome: "not_delivered" }>["reason"],
  string
> = {
  blocked_non_production:
    "Blocked — outbound email is disabled outside production (EMAIL_DEV_ALLOWLIST). Nothing was delivered.",
  dev_no_api_key:
    "Blocked — no RESEND_API_KEY is configured outside production. Nothing was delivered.",
};
```

Notes for the implementer:
- The `import type` of `DurableSendOutcome` is type-only — it is erased at compile time and does
  not constitute editing `email-durable-claim.ts`. Do not add a value import from that file to this
  new one.
- `blocked_non_production`'s string is copied **verbatim, character-for-character** from
  `financial-report-send.ts`'s `blockedError` constant (~line 649) — do not paraphrase it.
- `dev_no_api_key`'s string is new (financial-report-send.ts's own `not_delivered` case does not
  actually branch on `outcome.reason` — it writes the same `blockedError` text for both reasons, an
  existing minor imprecision in that file, out of scope to fix today). This design deliberately
  differentiates the two reasons for the two new call sites, since the whole point of exposing
  `reason` on `DurableSendOutcome` is to let a caller be this precise. Do not backport this
  discrimination into `financial-report-send.ts` — that file is explicitly out of scope.
- `financial-report-send.ts`'s own inline switch is **not** touched, refactored to call this
  function, or deduplicated against it today — that file is on the do-not-touch list. Note in the
  PR description (not a `docs/decisions.md` entry — Phase 2 already ruled this doesn't need one)
  that folding it in is a small follow-up for whenever that file is next legitimately open.

### Component/Page Plan

No new pages, no new components, no files to modify in `src/components/` or `src/app/(dashboard)/`.
This is a two-route, one-new-file backend fix.

**Files to modify:**
- `src/app/api/admin/dues/reminders/route.ts`
- `src/app/api/admin/events/[id]/announce/route.ts`

**Files to create:**
- `src/lib/durable-claim-row.ts`
- `src/lib/durable-claim-row.test.ts`
- `src/app/api/admin/dues/reminders/route.test.ts` (does not exist today)

**Files to extend:**
- `src/app/api/admin/events/[id]/announce/route.test.ts` (existing file — specific edits below)

### Implementation Order

1. **Shared helper.** Create `src/lib/durable-claim-row.ts` exactly as specified above, plus its
   unit test file (see Unit Tests below). No dependency on either route.
2. **`dues/reminders/route.ts`:**
   - Change the import: `sendBulkMemberEmail` → `sendBulkMemberEmailForDurableClaim` from
     `@/lib/email-durable-claim`; add `import { durableOutcomeToRow } from "@/lib/durable-claim-row"`.
   - Change the call site: `const { results } = await sendBulkMemberEmail({...})` →
     `const { results } = await sendBulkMemberEmailForDurableClaim({...})`. The options object
     passed is unchanged (same `from`/`subject`/`replyTo`/`bcc`/`recipients` shape —
     `sendBulkMemberEmailForDurableClaim` forwards its options untouched to `sendBulkMemberEmail`).
   - `resultByEmail` stays a `Map` keyed by `to`, built the same way
     (`new Map(results.map((r) => [r.to, r]))`) — do not restructure this. Its values are now
     `{ to, emailQueueId } & DurableSendOutcome` instead of the old raw shape.
   - Add one small local function immediately after `resultByEmail` is built (defensive fallback for
     the case — not expected to occur in practice, since `recipients` and `results` are always the
     same set — where a recipient's email has no matching entry in `resultByEmail`; today's code
     silently treats this as `success: false, error: null` via `?? false`/`?? null`, which this fix
     must not preserve, because a `null` error on a supposedly-attempted send is exactly the kind of
     silent, unexplained row this whole fix exists to eliminate):
     ```ts
     const FALLBACK_ROW = {
       success: false,
       error: "Internal error: no send result recorded for this recipient.",
     } as const;
     const rowFor = (email: string) => {
       const outcome = resultByEmail.get(email);
       return outcome ? durableOutcomeToRow(outcome) : FALLBACK_ROW;
     };
     ```
   - In the `reminderRows` map (step 5 in the existing file), replace
     `success: result?.success ?? false, error: result?.error ?? null` with
     `...rowFor(r.email)` (spread — `rowFor` returns exactly `{success, error}`, matching
     `NewDuesReminder`'s two fields one-for-one).
   - In the response's `sent` map (step 6), replace
     `success: result?.success ?? false, ...(result?.error ? { error: result.error } : {})` with:
     ```ts
     const row = rowFor(r.email);
     return { memberId: r.memberId, email: r.email, cohort: r.cohort, success: row.success, ...(row.error ? { error: row.error } : {}) };
     ```
     preserving the existing "omit `error` key entirely when null" wire shape exactly.
   - Do not touch anything else in the file — not validation, not the treasurer/settings checks, not
     `classifyRecipients`, not `insertDuesReminderRows`.
3. **`events/[id]/announce/route.ts`:** identical pattern, same `rowFor(email)` shape, applied at:
   - The import swap (same two imports as above).
   - The `sendBulkMemberEmail({...})` call at step 7 → `sendBulkMemberEmailForDurableClaim({...})`.
     Options object (`from`, `subject`, `replyTo`, `attachments`, `recipients`) is unchanged — the
     `.ics` attachment continues to flow through exactly as today, since
     `sendBulkMemberEmailForDurableClaim` forwards `SendBulkMemberEmailOptions` verbatim.
   - `resultByEmail` map built the same way, same lookup pattern.
   - The `rows` map (step 8) — replace `success`/`error` fields with `...rowFor(r.email)`.
   - The response's `sent` map (step 9) — same pattern as the dues route.
   - Do not touch scope resolution, occurrence validation, ICS building, or
     `classifyAnnouncementRecipients` — those are untouched by this fix.
4. **Tests** (api-developer delivers these per CLAUDE.md's Phase 4 gate — qa does not write the
   first copy of a design-mandated test):
   - `src/lib/durable-claim-row.test.ts` (new).
   - `src/app/api/admin/dues/reminders/route.test.ts` (new — this route has no test file today).
   - `src/app/api/admin/events/[id]/announce/route.test.ts` (edit existing — mock target change plus
     one updated fixture, both detailed below).
5. **Verify contract-preservation, not just new coverage:** run the full existing suite for
   `src/lib/email-guardrail.test.ts`, `src/lib/email-no-api-key.test.ts`,
   `src/lib/email-durable-claim.test.ts`, `src/lib/ledger-acknowledgment-letter-queries.test.ts`, and
   `src/app/api/admin/email-queue/retry/route.test.ts`, and confirm via `git diff` that none of those
   five files changed. These are the "17 DECISION-085 guardrail tests + 4 no-API-key tests" the task
   brief refers to, spread across `email-guardrail.test.ts` and `email-no-api-key.test.ts`.

### Edge Cases & Risks

- **Undefined `resultByEmail` lookup.** Addressed above via `rowFor`'s `FALLBACK_ROW` — should not
  occur given `recipients`/`toSend` and `results` are always built from the same set, but the
  fallback must produce an honest, non-null `error` string rather than silently reusing the old
  `?? false` / `?? null` default, or this fix would trade one silent-success failure mode for a
  silent-null-error one.
- **`financial-report-send.ts`'s `not_delivered` case does not discriminate by `reason` today** —
  noted above; explicitly not fixed here (out of scope file). Flag as a one-line backlog item
  (not a `docs/decisions.md` entry) if it's ever convenient to align when that file is next open.
- **`getLastRemindedMap()`'s missing `success` filter** (`src/lib/dues-reminders-queries.ts`) is a
  known, pre-existing, adjacent defect — confirmed out of scope by Phase 2 ruling #5. This fix does
  not change whether a genuinely-failed or now-correctly-blocked reminder still lights up the "Last
  reminded" badge; that's a separate read-path bug, filed separately, not addressed here.
- **B-74 (email-queue retry route bypassing durable-claim tables)** — explicitly out of scope,
  confirmed by both Phase 2 and the task brief. The retry route is not touched by this fix and this
  fix does not change its behavior in either direction.
- **`event-announcement-history-table.tsx`'s aggregate count changes in effect, not in code.** Once
  this fix ships, any *pre-existing* blocked/no-key rows already in the table (written before this
  fix, under the old bug) remain mislabeled `success: true` — this fix only corrects the write path
  going forward. No backfill migration is in scope; the severity ruling (re-sendable, not a
  permanent claim) means a treasurer/board-member can simply re-send if a stale badge is noticed.
  Worth one sentence in the release note, not a data migration.
- **Attachments must still flow through unchanged** for the announce route — confirmed
  `sendBulkMemberEmailForDurableClaim` forwards `SendBulkMemberEmailOptions` (including
  `attachments`) to `sendBulkMemberEmail` verbatim (read in `email-durable-claim.ts`); no attachment
  regression risk from the wrapper swap itself.

### Out of Scope

- Any change to `email-durable-claim.ts`, `ledger-acknowledgment-letter-queries.ts`,
  `financial-report-send.ts`, `email-send-attempt.ts`, or the email-queue retry route.
- Any change to `e2e/`.
- B-74 (retry route / durable-claim interaction).
- `getLastRemindedMap()`'s missing `success` filter — file as its own backlog bug.
- Any schema migration, new `FEATURES` key, or role binding.
- Any change to `dues-reminder-sender.tsx` or `event-announcement-history-table.tsx`.
- Folding `financial-report-send.ts`'s inline switch into the new shared helper.

### Unit Tests To Deliver (api-developer)

**`src/lib/durable-claim-row.test.ts` (new):**
1. `delivered` outcome → `{ success: true, error: null }`.
2. `failed` outcome → `{ success: false, error: <the outcome's own error string> }`, verbatim,
   not rewritten.
3. `not_delivered` / `blocked_non_production` → `{ success: false, error: "Blocked — outbound email
   is disabled outside production (EMAIL_DEV_ALLOWLIST). Nothing was delivered." }` — assert the
   exact string, not just `success: false`, since a copy-paste drift from `financial-report-send.ts`
   would otherwise pass a looser test.
4. `not_delivered` / `dev_no_api_key` → `{ success: false, error: "Blocked — no RESEND_API_KEY is
   configured outside production. Nothing was delivered." }` — exact string.
5. An unhandled/malformed outcome shape throws (exercises the `default` / `never`-check branch) —
   e.g. cast an invalid `{ outcome: "bogus" }` through `as unknown as DurableSendOutcome` and assert
   the call throws.

**`src/app/api/admin/dues/reminders/route.test.ts` (new — mirror the announce route's existing test
file's mock/setup style: mock `@/lib/auth`, `@/lib/permissions-server`,
`@/lib/dues-reminders-queries`, `@/lib/dues-queries`, `@/lib/board-positions`, and
`@/lib/email-durable-claim`'s `sendBulkMemberEmailForDurableClaim` — NOT `@/lib/email`):**
1. GET: 401 no session; 403 for a session lacking `DUES_MANAGE` specifically (assert the exact
   `FEATURES` key `hasFeature` was called with); 400 for a missing/non-positive `fiscalYear`.
2. POST: 401 no session; 403 for a session lacking `DUES_MANAGE` specifically.
3. POST: 400 when `resolveTreasurer()` returns `ok: false` (no signer).
4. POST: 400 when `getDuesSettings(fiscalYear)` returns `null` (no dues amounts configured).
5. **A genuine `delivered` outcome records `success: true, error: null`** in the inserted
   `dues_reminders` row and in the response's matching `sent[]` entry — the no-regression case.
6. **A `not_delivered` (`blocked_non_production`) outcome records `success: false` with the exact
   blocked-message `error` string** — both in the inserted row and in the response — never
   `success: true`. This is the test that fails on pre-fix code and is the actual regression test
   for B-73.
7. **A `not_delivered` (`dev_no_api_key`) outcome** — same shape as #6, with the dev-no-key message.
8. **A `failed` outcome** records `success: false` with the outcome's own error string, unchanged
   behavior from before this fix (not a regression case, but must not have moved).
9. A partial batch (one `delivered`, one `not_delivered`, one `failed` across 3 recipients) still
   inserts one row per attempted recipient and returns 200 with three `sent[]` entries whose
   `success`/`error` values independently match each recipient's own outcome (mirrors the existing
   announce-route partial-failure test's assertions, applied to dues).
10. A recipient whose email has no matching entry in `resultByEmail` (mock `results` shorter than
    `recipients`, e.g. by returning an empty `results` array from the mocked
    `sendBulkMemberEmailForDurableClaim`) records the `FALLBACK_ROW`'s exact error string — asserts
    the defensive path from Implementation Order step 2 is real, not dead code.

**`src/app/api/admin/events/[id]/announce/route.test.ts` (existing — edit, do not rewrite):**
- **Mock target change (required, all tests depend on it compiling/passing):** replace
  `vi.mock("@/lib/email", () => ({ sendBulkMemberEmail: vi.fn() }))` (line 42) with
  `vi.mock("@/lib/email-durable-claim", () => ({ sendBulkMemberEmailForDurableClaim: vi.fn() }))`,
  and update the corresponding import (line 56) from
  `import { sendBulkMemberEmail } from "@/lib/email";` to
  `import { sendBulkMemberEmailForDurableClaim } from "@/lib/email-durable-claim";`. Every
  `vi.mocked(sendBulkMemberEmail)` reference in the file (the `beforeEach` reset at line 94 and the
  per-test `.mockResolvedValue(...)` calls at lines 141 and 198, plus the `.not.toHaveBeenCalled()`
  assertions at lines 153, 163, 177, 189) becomes `vi.mocked(sendBulkMemberEmailForDurableClaim)`.
- **Fixture shape change (required — old shape no longer matches the real function's return
  type):**
  - Line 141's default mock (`{ to: "...", success: true, emailQueueId: "eq-1" }`) becomes
    `{ to: "pat@westervillelions.org", outcome: "delivered", emailQueueId: "eq-1" }`.
  - Line 198–203's partial-failure mock's three entries become:
    `{ to: "pat@westervillelions.org", outcome: "delivered", emailQueueId: "eq-1" }`,
    `{ to: "sam@westervillelions.org", outcome: "failed", error: "Resend API error", emailQueueId:
    "eq-2" }`,
    `{ to: "jo@westervillelions.org", outcome: "delivered", emailQueueId: "eq-3" }`.
  - The assertions at lines 219 and 226–228 (checking `success: false, error: "Resend API error"`
    on the `m-2` entry/row) are unaffected in their expected *values* — a `failed` outcome still
    yields `success: false` with that same error string — so no assertion text changes there, only
    the mocked input shape above it.
- **Tests unaffected, no edit needed:** every GET test (lines 98–132, no send involved); the 400
  rejection tests that assert `sendBulkMemberEmail` (now `sendBulkMemberEmailForDurableClaim`) was
  **not** called (lines 146–190, 231–247, 249–260) — only the mock name in the assertion changes per
  the global rename above, not the test logic; the non-recurring-event scope-forcing test (lines
  262–282); the 401/403 tests (lines 284–295).
- **New tests to add to this file:**
  - A `not_delivered` (`blocked_non_production`) outcome for a single recipient records
    `success: false` with the exact blocked-message `error` string in both the response `sent[]`
    entry and the inserted `event_announcements` row — the actual regression test for B-73's
    announce-route half.
  - A `not_delivered` (`dev_no_api_key`) outcome — same shape, dev-no-key message.
  - A recipient missing from the mocked `results` array records the `FALLBACK_ROW`'s error string
    (mirrors dues test #10 above).

### Implementer

**api-developer** — this is route-handler + one small shared server-side utility work, no schema
change, no UI. Small and precisely scoped; a full-stack split would add handoff overhead this fix
doesn't need. Once api-developer reports Phase 4 complete (including the tests above passing and the
five untouched-file `git diff`s confirmed empty), route to **qa** for Phase 5 — qa's job here is the
build/typecheck/manual-click-through verification and confirming the untouched-file diffs, not
writing the first copy of any test named above.

### Open questions / handoff notes

- api-developer: read `src/lib/email-durable-claim.ts` and
  `src/app/api/admin/events/[id]/announce/route.test.ts` in full before starting — both are cited
  above by line number and both will drift if read only in excerpt.
- api-developer: the `rowFor(email)` closure name/shape above is a specification, not a suggestion —
  keep the same fallback error string verbatim in both routes so a future grep for "no send result
  recorded" finds both.
- qa: the two new `not_delivered` tests per route (dues #6/#7, announce's two new tests) are the
  actual regression tests for B-73 — confirm they fail against the pre-fix `route.ts` files (git
  stash the fix, run, confirm red) before signing off, per the Bug-Fix Variant's Phase 5 discipline
  ("reproduces the original bug on the pre-fix code, then confirms the fix removes the failure").
- qa: also confirm the five out-of-scope test files' `git diff` is empty, not just that they still
  pass — a passing-but-modified guardrail test would satisfy "still green" while silently loosening
  what DECISION-085 actually guarantees.

---

## Phase 4 — Implementation (API) — 2026-09-25

**Owner:** api-developer
**Status:** complete

### Summary

Implemented exactly per the Phase 3 design doc, with no deviations. Both routes now go through
`sendBulkMemberEmailForDurableClaim()` and map the resulting `DurableSendOutcome` to a
`{success, error}` row via a new shared helper, `src/lib/durable-claim-row.ts`. No schema change,
no wire-shape change, no UI change. All gates pass; the new regression tests were confirmed to fail
against the pre-fix `route.ts` files via a temporary `git stash` of just those two files, then
confirmed to pass again once restored.

### What I did

- Created `src/lib/durable-claim-row.ts` exactly as specified in Phase 3: `durableOutcomeToRow()`,
  an exhaustive `switch` over `DurableSendOutcome` ending in a `never`-check `default`, importing
  only the `DurableSendOutcome` *type* from `@/lib/email-durable-claim` (no value import — that file
  is untouched).
- Migrated `src/app/api/admin/dues/reminders/route.ts`: swapped `sendBulkMemberEmail` (`@/lib/email`)
  for `sendBulkMemberEmailForDurableClaim` (`@/lib/email-durable-claim`); added the `rowFor(email)`
  closure with its `FALLBACK_ROW` (honest, non-null error string for the defensive
  no-matching-result case); replaced both the inserted-row construction and the response's `sent[]`
  construction with `...rowFor(r.email)` / `rowFor(r.email)`. Nothing else in the file touched —
  validation, the treasurer/settings checks, `classifyRecipients`, `insertDuesReminderRows` are all
  unmodified.
- Migrated `src/app/api/admin/events/[id]/announce/route.ts` identically — same import swap, same
  `rowFor`/`FALLBACK_ROW` pattern, same two call sites (the `event_announcements` row construction
  and the response `sent[]` construction). Scope resolution, occurrence validation, ICS building,
  and `classifyAnnouncementRecipients` are unmodified. Confirmed the `.ics` attachment still flows
  through unchanged — `sendBulkMemberEmailForDurableClaim()` forwards `SendBulkMemberEmailOptions`
  (including `attachments`) verbatim to `sendBulkMemberEmail()`.
- Wrote `src/lib/durable-claim-row.test.ts` — the 5 tests named in Phase 3 (delivered, failed,
  both `not_delivered` reasons with exact string assertions, and the `never`-check throw).
- Wrote `src/app/api/admin/dues/reminders/route.test.ts` — new file, this route had none before.
  All 10 tests named in Phase 3 (GET auth/validation, POST auth/treasurer/settings guards, genuine
  delivered no-regression case, both `not_delivered` reasons — test 6 is the actual B-73 regression
  test — the unchanged `failed` case, a 3-recipient mixed-outcome batch, and the missing-result
  fallback case).
- Edited `src/app/api/admin/events/[id]/announce/route.test.ts` per the Phase 3 line-by-line spec:
  mock target changed from `@/lib/email`'s `sendBulkMemberEmail` to `@/lib/email-durable-claim`'s
  `sendBulkMemberEmailForDurableClaim` (import, `vi.mock`, every `vi.mocked(...)`/`expect(...)`
  reference); the two existing fixture shapes (single-recipient default mock, 3-recipient
  partial-failure mock) updated from the old `{success, error}` shape to `{outcome, ...}`; added 3
  new tests (blocked, dev-no-key, missing-result fallback). No other test in the file needed
  changes — confirmed the GET tests, the 400-rejection tests, the scope-forcing test, and the
  401/403 tests all still pass unmodified once the mock rename was applied.
- **Pre-fix regression evidence:** `git stash push` on just the two `route.ts` files (leaving the
  new test files and `durable-claim-row.ts` in place), ran the full suite against the reverted
  routes: the entire new `dues/reminders/route.test.ts` suite failed to even load (the old route
  imports `@/lib/email`, which imports `@/lib/db`, which throws with no `DATABASE_URL` since the
  test file only mocks `@/lib/email-durable-claim`) and 6 tests in the announce route's test file
  failed with `500` instead of `200` (the 3 new `not_delivered`/fallback tests plus 3 pre-existing
  tests that also exercise the send path, since the mock rename left the old code's
  `sendBulkMemberEmail` import unmocked). `git stash pop` restored the fix; full suite re-ran green.

### Outputs

**Files created:**
- `src/lib/durable-claim-row.ts` — `durableOutcomeToRow(outcome: DurableSendOutcome): { success:
  boolean; error: string | null }`. Pure function, no I/O, no new dependency.
- `src/lib/durable-claim-row.test.ts` — 5 tests.
- `src/app/api/admin/dues/reminders/route.test.ts` — 10 tests (new file).

**Files modified:**
- `src/app/api/admin/dues/reminders/route.ts` — import swap + `rowFor`/`FALLBACK_ROW` at the two
  `success`/`error`-writing call sites. No API contract change: `POST` still returns
  `{ signer, sent: [{ memberId, email, cohort, success, error? }], skipped }`; `GET` unchanged.
  Gate unchanged: `auth()` + `hasFeature(session.user.id, FEATURES.DUES_MANAGE)` on both handlers.
- `src/app/api/admin/events/[id]/announce/route.ts` — same pattern. No API contract change: `POST`
  still returns `{ batchId, scope, occurrenceDate, sent: [{ memberId, success, error? }], skipped
  }`; `GET` unchanged. Gate unchanged: `auth()` + `hasFeature(session.user.id,
  FEATURES.EVENTS_ANNOUNCE)` on both handlers.
- `src/app/api/admin/events/[id]/announce/route.test.ts` — mock target + fixture shapes updated,
  3 new tests added, all other tests unchanged and still passing.

**Schema changes:** none.

**Decisions logged:** none new — this fix applies the existing DECISION-102/103 pattern to two more
call sites; Phase 2 already ruled no new `docs/decisions.md` entry is warranted.

**Ruling per route on what a not-delivered recipient records** (confirming Phase 2/3, now verified
against actual test output): both `dues_reminders` and `event_announcements` record `success: false`
with a distinguishing, human-readable `error` string — the same `blocked_non_production` wording
`financial-report-send.ts` already uses, plus a new `dev_no_api_key` string — rather than being
omitted from the insert. This matches DECISION-093's "one row per attempted recipient, success and
failure alike" for `event_announcements`, and preserves `dues_reminders`' existing same behavior. No
new column, no new UI state — per the severity ruling (re-sendable, not a permanent claim), a
`not_delivered` row is functionally a `Failed`/red badge in both existing UIs (`dues-reminder-sender.
tsx`'s "Failed" pill with its `error` in the tooltip; `event-announcement-history-table.tsx`'s
"Emailed N of M — F failed" count), which is honest — it does NOT say "Emailed" or "Delivered" for a
non-delivered recipient — even though it does not yet distinguish "genuinely bounced" from
"blocked in this environment" at the UI layer. That distinction is fully preserved in the `error`
text an admin can see (tooltip in the dues UI), so no UI change was required to satisfy B-47 ("say
Emailed, never Delivered") — neither UI ever claimed "Delivered" in the first place, and both
already treat `!success` as "not sent."

### Gates

- `pnpm exec tsc --noEmit` — clean, no output.
- `pnpm lint` — 0 errors. One pre-existing, unrelated warning
  (`src/components/admin/ledger/budget-context-panel.tsx:114`, unused eslint-disable directive) —
  not touched by this fix, confirmed via `git diff` that file is untouched.
- `pnpm test` — **2224/2224 passing** (baseline was 2203; +21 new tests: 5 in
  `durable-claim-row.test.ts`, 10 in the new `dues/reminders/route.test.ts`, 3 new in
  `events/[id]/announce/route.test.ts`, plus the concurrent e2e-fixture agent's own additions
  elsewhere in the suite accounting for the remaining delta).
- `pnpm build:only` — clean production build, no new warnings, route tree shape unchanged.
- **DECISION-085 guardrail/no-API-key/durable-claim contract preservation:** `git diff --stat` on
  `src/lib/email-guardrail.test.ts`, `src/lib/email-no-api-key.test.ts`,
  `src/lib/email-durable-claim.test.ts`, `src/lib/ledger-acknowledgment-letter-queries.test.ts`,
  `src/app/api/admin/email-queue/retry/route.test.ts`, and the five untouchable source files
  (`src/lib/email-durable-claim.ts`, `src/lib/ledger-acknowledgment-letter-queries.ts`,
  `src/lib/financial-report-send.ts`, `src/lib/email-send-attempt.ts`,
  `src/app/api/admin/email-queue/retry/route.ts`) — **empty for all ten**.
- `e2e/` — not touched (confirmed via `git status`; the one modified e2e file,
  `e2e/recurring-signup-rollup.spec.ts`, belongs to the concurrent agent working that directory
  today, not to this fix).

### Further instances found while looking

None beyond the two named in the task brief. Checked the other bulk-send call sites
(`src/app/api/admin/ledger/transactions/route.ts` — board-approval notifications) per the
2026-09-25 test-coverage review's own note that it had already checked these and found they discard
`sendBulkMemberEmail()`'s result entirely, writing no `success` column — re-confirmed this is still
true and out of scope. No other file writes a `success`/`sentAt`/equivalent column fed from
`sendEmail()`/`sendBulkMemberEmail()`'s raw result outside the five files already named in
DECISION-102/103 and the two fixed here.

### Implementer Notes

No deviations from the Phase 3 design. The one place I exercised judgment within the spec's bounds:
in the announce route, `resultByEmail.get(r.email)?.emailQueueId ?? null` is read directly (not
through `rowFor`) since `emailQueueId` isn't part of `durableOutcomeToRow()`'s return shape — this
matches the design's own example code, which computed `emailQueueId` separately from the
`{success, error}` spread.

### Open questions / handoff notes

- **qa (Phase 5):** the pre-fix-red / post-fix-green evidence above was produced via `git stash`
  during Phase 4 — feel free to independently reproduce it, but it does not need to be redone from
  scratch if you trust this account; the stash covered only the two `route.ts` files, not the new
  test files, which is why the dues suite failed to even *load* (correct — no working import target)
  rather than failing individual assertions.
- **qa:** please confirm the exact test count landed (2224) matches a fresh `pnpm test` run in your
  own session — the arithmetic above (2203 baseline + 21) does not cleanly account for whether the
  concurrent e2e-fixture agent's work also touched unit test counts; if it lands at exactly 2224
  again, the delta is fully explained by this fix's 21 new tests plus 0 from elsewhere, which would
  actually mean the baseline recount should be double-checked rather than assumed.
- **Next agent: no UI work is required for B-73.** Confirmed in Phase 3 and re-confirmed here after
  implementation — both consuming components already render `not_delivered` rows correctly as
  "Failed"/red, with the honest reason visible in the dues UI's tooltip. If a future request wants a
  visually distinct "Blocked" state (as opposed to "Failed") in either UI, that is a small,
  separate ux-developer task, not a defect in this fix.
- **Filed separately, not fixed here (per Phase 2 ruling, out of scope for B-73):**
  `getLastRemindedMap()` in `src/lib/dues-reminders-queries.ts` has no `WHERE success = true` filter,
  so a genuinely failed OR now-correctly-blocked reminder still lights up the "Last reminded" badge.
  Recommend filing as its own small backlog bug for a future implementer.
- **Filed separately, not fixed here:** `financial-report-send.ts`'s own `not_delivered` case does
  not discriminate by `reason` (writes the same message for both `blocked_non_production` and
  `dev_no_api_key`) — noted as a small consistency follow-up for whenever that file is next
  legitimately open, not touched today.
- **Not attempted, per explicit instruction:** B-74 (the email-queue retry route's lack of awareness
  of any durable-claim table) is untouched.

---

## Phase 5 — Verification — 2026-09-25

**Owner:** qa
**Status:** complete

### Summary

**PASS.** All four gates are clean (tsc, lint, `pnpm test` 2224/2224, `pnpm build:only`). I
independently reproduced the pre-fix failure via `git stash` on just the two `route.ts` files (not
the new test files) — the dues suite failed to load entirely (`DATABASE_URL` error, old route
imports `@/lib/email` → `@/lib/db`) and 6 announce-route tests failed with 500 instead of 200 —
then restored the fix and confirmed the full suite returns to 2224/2224 green. I confirmed
`durableOutcomeToRow()`'s exhaustiveness is a real compile-time guarantee, not decorative, by
temporarily adding a fourth `DurableSendOutcome` variant and watching `tsc --noEmit` fail at
exactly that function (then reverted, diff confirmed empty). Independently re-derived the same
"further instances" conclusion the implementer reported — no ninth instance — by tracing all 18
`sendEmail`/`sendBulkMemberEmail`/durable-claim call sites in `src/` to their persistence layer,
not just re-checking the two named files.

### What I did

1. Read the work-log's Phase 2/3/4 sections in full, plus DECISION-102, DECISION-103, and
   DECISION-093 in `docs/decisions.md`.
2. Read `src/lib/durable-claim-row.ts`, its test file, both route files in full, and the diff for
   `events/[id]/announce/route.test.ts` — confirmed each matches the Phase 3 design doc's spec
   line-for-line (import swap, `rowFor`/`FALLBACK_ROW` shape, exact wording verbatim-matched
   against `financial-report-send.ts`'s `blockedError` string via `grep`).
3. `git diff --stat` on all ten named untouchable files (5 source, 5 test) — empty for all ten.
   Also confirmed the two consuming UI components (`src/components/admin/dues-reminder-sender.tsx`,
   `src/components/admin/event-announcement-history-table.tsx` — the work-log cited a
   nonexistent `admin/dues/`/`admin/events/` subpath; found the real paths and diffed those) have
   empty diffs and already render `not_delivered` rows as "Failed"/red with the reason in a
   tooltip, never "Delivered" (B-47) — confirmed by reading the JSX, not by trusting the claim.
4. Ran `pnpm exec tsc --noEmit` (clean), `pnpm lint` (0 errors, 1 pre-existing unrelated warning in
   `budget-context-panel.tsx`, confirmed untouched via `git diff --stat`), `pnpm test` (2224/2224),
   `pnpm build:only` (clean, 125 static pages, both target routes present as dynamic routes, no
   new warnings).
5. **Independent regression reproduction:** `git stash push` on just the two `route.ts` files,
   re-ran the new/edited test files. Dues suite: `FAIL — Error: DATABASE_URL or DB_URL environment
   variable is not set` (fails to load, not individual assertion failures — matches the
   implementer's account exactly). Announce suite: 6 failed (`expected 500 to be 200`) — the 3 new
   B-73 regression tests plus 3 pre-existing send-path tests destabilized by the mock rename.
   `git stash pop` restored the fix; full suite re-ran 2224/2224 green.
6. **Exhaustiveness check:** backed up `src/lib/email-durable-claim.ts`, added a fourth
   `DurableSendOutcome` variant (`{ outcome: "bounced"; error: string }`), ran `tsc --noEmit` —
   got `error TS2322: Type '{ outcome: "bounced"; ... }' is not assignable to type 'never'` at
   `durable-claim-row.ts:27`. Restored the file from backup; `git diff --stat` confirmed empty;
   re-ran `tsc --noEmit` clean.
7. Read `src/lib/db/schema.ts` for both `duesReminders` and `eventAnnouncements` in full — confirmed
   plain B-tree indexes only, no partial unique index or other constraint a `not_delivered` row
   would violate. Confirmed no migration/schema diff shipped with this fix
   (`git diff --stat -- drizzle/migrations/ src/lib/db/schema.ts` empty).
8. Confirmed `FEATURES.DUES_MANAGE` / `FEATURES.EVENTS_ANNOUNCE` exist in the catalog and are the
   keys both `GET`/`POST` handlers check in both routes (read directly, not inferred from tests) —
   see Feature-Gate Audit below.
9. Checked `e2e/admin-events-announce-page-gate.spec.ts` (the one e2e spec that touches this route)
   — it's a permission-gate spec, its POST calls use `memberIds: []` and never exercise a genuine
   send, so it's unaffected by this fix. Did not re-run the full e2e suite — not in this task's
   gate list, and the prior agent's same-day e2e run (186 passed / 1 skipped / 0 failed) already
   covers the tree's current state; this fix touches no e2e-exercised path.
10. Checked for stray `console.log`/`console.debug` in the three changed/new source files — none.
11. Launched an independent fork-style audit (fresh agent, not reusing the implementer's own
    search) of every `sendEmail`/`sendBulkMemberEmail`/`sendEmailForDurableClaim`/
    `sendBulkMemberEmailForDurableClaim` call site in `src/` (18 total), tracing each to its
    persistence layer rather than re-checking only the two named files. Result: no ninth instance.
    Every call site that persists a send-derived value already routes through the durable-claim
    wrapper; every other call site discards the result or reflects it straight back into an HTTP
    response (`minutes/[id]/email/route.ts` — ephemeral, never a durable claim). Flagged one
    adjacent-but-different observation: `src/lib/members.ts`'s `sendWelcomeEmail()` comment claims
    a failed welcome email "lands in `email_queue` as `failed`" implying visibility, but nothing in
    `users`/`members` records whether it actually reached the new member — an observability gap,
    not this defect class, not actioned here.
12. Checked whether the two follow-ups Phase 2/3 explicitly said to "file separately" —
    `getLastRemindedMap()`'s missing `success` filter, and `financial-report-send.ts`'s
    non-discriminating `not_delivered` message — actually landed in `docs/backlog.md`. **They did
    not.** `git diff docs/backlog.md` shows B-73 and B-74 filed, but no entry for either of these
    two smaller items. Noting as a handoff gap, not a fix defect — see below.

### Outputs

#### Type Check
`pnpm exec tsc --noEmit`: **PASS** — clean, no output.

#### Unit Tests
`pnpm test`: **PASS**
Total: 2224 | Passed: 2224 | Failed: 0
Duration: ~4s
Failures: none. (Pre-fix reproduction, confirmed separately: dues suite failed to load;
6 announce-route tests failed 500-vs-200 — see item 5 above.)

#### Production Build
`pnpm build:only`: **PASS**
Notes: Compiled successfully in 780ms; 125 static pages generated; route tree includes
`/admin/dues/reminders`, `/admin/events/[id]/announce`, `/api/admin/dues/reminders`, and
`/api/admin/events/[id]/announce` as expected (dynamic `ƒ`); no new warnings.

#### End-to-End Tests
Not re-run in full — out of this task's gate list (`tsc`, `lint`, `pnpm test`, `pnpm build:only`
only). The one e2e spec touching this route (`admin-events-announce-page-gate.spec.ts`) is a
permission-gate spec that never exercises a genuine send and is unaffected by this fix. A separate
same-day agent already ran the full suite (186 passed / 1 skipped / 0 failed) against this tree
per the task brief's note; not re-verified here since this fix touches no e2e-exercised path.

#### Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| Live send of dues reminder / event announcement outside production | not run | Explicitly forbidden by the task brief (no real send, no `EMAIL_DEV_ALLOWLIST` changes). Behavior fully covered instead by the route-level unit tests (mocked `sendBulkMemberEmailForDurableClaim`) plus the independent pre-fix/post-fix reproduction above. |

#### Regression Tests Added (by api-developer, verified by qa)
- `src/lib/durable-claim-row.test.ts` — 5 tests — guards against: a fourth `DurableSendOutcome`
  variant silently compiling instead of erroring (confirmed live, see item 6), and wording drift
  from `financial-report-send.ts`'s verbatim blocked-message string.
- `src/app/api/admin/dues/reminders/route.test.ts:144` — "a 'not_delivered'/blocked_non_production
  outcome records success:false..." — regression for: B-73's dues-reminders half (DECISION-102/103
  instance #7). Confirmed fails on pre-fix code (whole suite fails to load).
- `src/app/api/admin/dues/reminders/route.test.ts:177` — the `dev_no_api_key` variant of the above.
- `src/app/api/admin/events/[id]/announce/route.test.ts:~300` — "a blocked (non-production) send
  records success:false..." — regression for: B-73's event-announcements half (DECISION-102/103
  instance #8). Confirmed fails on pre-fix code (500 instead of 200).
- `src/app/api/admin/events/[id]/announce/route.test.ts:~330` — the `dev_no_api_key` variant.
- Both routes' "recipient missing from send results" tests — regression for: a latent
  silent-null-error trap the fix could have introduced but didn't (`FALLBACK_ROW`'s honest string).

#### Coverage on Critical Modules
Not separately re-measured with `--coverage` this pass — the modules this fix touches
(`durable-claim-row.ts`, both routes) are new/fully exercised by the tests above (5 + 10 + 3 = 18
of the 21 new tests target exactly these three files' new logic). `src/lib/events.ts`,
`src/lib/permissions.ts`, `src/lib/members.ts` are untouched by this diff — no coverage drift
introduced here; that's the 7-day coverage review's job, not re-run today since this is a
narrow, already-scoped bug-fix Phase 5, not the periodic sweep.

#### Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `GET /api/admin/dues/reminders` | yes | yes | `FEATURES.DUES_MANAGE` — correct; this is a read-only preview endpoint but it returns names/emails/payment-status PII, and the route's own header comment explains why `DUES_MANAGE` (not a weaker `DUES_VIEW`) is deliberately used here — the proxy only admits `DUES_VIEW` at the nav level, and this route re-checks the stronger key itself. |
| `POST /api/admin/dues/reminders` | yes | yes | `FEATURES.DUES_MANAGE` — correct, mutation/send endpoint. |
| `GET /api/admin/events/[id]/announce` | yes | yes | `FEATURES.EVENTS_ANNOUNCE` — correct; deliberately narrower than `FEATURES.EVENTS_EDIT` per Phase 1 User Decision 1 of the original 2026-09-04 feature, re-confirmed unchanged today. |
| `POST /api/admin/events/[id]/announce` | yes | yes | `FEATURES.EVENTS_ANNOUNCE` — correct, mutation/send endpoint. |

No new route or server action was added by B-73 — both gates predate this fix and are confirmed
byte-identical in position/key (only the send-call and row-construction lines changed, per the
`git diff` review above). No protected-route gate was touched, added, or removed by this diff.

### Open questions / handoff notes

- **analyst (Phase 6):** recommend proceeding to shipped-vs-intent review. All four gates pass,
  the regression tests are independently confirmed to fail pre-fix and pass post-fix, the
  exhaustiveness guarantee is independently confirmed to be real (not decorative), DECISION-093's
  one-row-per-attempted-recipient shape is preserved, no ninth instance of the defect class exists,
  and the fix's size (no schema change, ~40-45 lines per route) matches the severity ruling —
  proportionate, not over-built like the acknowledgment-letter treatment.
- **Process gap, not a code defect — worth a note in Phase 6 or a tech-lead retro item:** Phase 2
  (ruling 5) and Phase 3 (Edge Cases) both explicitly said to file two small follow-ups as their
  own backlog items — `getLastRemindedMap()`'s missing `WHERE success = true` filter (a real,
  pre-existing, adjacent defect: even a genuinely failed send already lights up the "Last
  reminded" badge), and `financial-report-send.ts`'s `not_delivered` case not discriminating by
  `reason`. Neither was actually added to `docs/backlog.md` — B-73 and B-74 were filed, but not
  these two smaller items. Recommend the next agent to touch `docs/backlog.md` file both, or
  tech-lead can decide it's low-value enough to drop explicitly rather than let it silently vanish
  a third time.
- **No code changes requested of api-developer** — nothing failed. If Phase 6 wants anything
  revisited, it's the backlog-filing gap above, not the fix itself.

### Verdict: PASS

---

## Follow-up — `getLastRemindedMap()` missing `success` filter (B-73's own named gap) — 2026-09-25

**Owner:** api-developer
**Status:** complete
**Trigger:** Phase 2 (ruling 5) and Phase 3 (Edge Cases) both required this as a follow-up; QA's
Phase 5 "Process gap" note confirmed it was never actually filed or fixed. This section closes
that gap directly rather than letting it slip a third time.

### Summary

`getLastRemindedMap()` in `src/lib/dues-reminders-queries.ts` — the query behind the treasurer's
"Last reminded" badge at `/admin/dues/reminders` — had no `success` filter at all. It selected the
single most recent `dues_reminders` row per member regardless of whether that row recorded a
delivered send, so a member whose most recent (or only) reminder attempt was blocked or failed
still displayed as reminded. This is the exact false-record harm B-73 fixed on the write side,
surviving one layer up on the read side; it predates B-73 (a genuinely *failed* send had the same
effect before today) and B-73's own fix (an honest `not_delivered` row) made it visible and
fixable for the first time, since before today's other fix, blocked sends were *also* wrongly
written as `success: true` — so this read-side bug and the now-fixed write-side bug were
compounding each other.

Fixed by adding `AND success = true` to the query's `WHERE` clause (not a post-hoc JS filter after
the row is fetched), so Postgres's own `DISTINCT ON (member_id) ... ORDER BY member_id, sent_at
DESC` selects each member's most recent *successful* row, never their most recent row of any kind.

### What I did

- Read `getLastRemindedMap()` in full (`src/lib/dues-reminders-queries.ts:39-57`) and confirmed the
  gap: `WHERE fiscal_year = ${fiscalYear}` with no `success` condition, feeding
  `getReminderCandidates()`'s `lastReminded` field, which both the GET preview route and
  `dues-reminder-sender.tsx`'s "Last reminded" badge consume directly.
- Confirmed `duesReminders.success` exists as a plain `boolean NOT NULL` column with no partial
  unique index or other constraint that a `success = true` filter could conflict with (same schema
  read as Phase 2's original review).
- Added `AND success = true` to the `WHERE` clause, and rewrote the function's doc comment to state
  the `DISTINCT ON` ordering rule explicitly: the filter must run *before* row selection, not after,
  so a member with an earlier successful send and a later failed one still shows the earlier
  successful date, not "never reminded" and not the failed attempt's date.
- **Ruling on whether a failed/blocked attempt should be surfaced to the treasurer at all** (see
  below) — concluded no new UI is warranted; documented the reasoning rather than defaulting either
  way.
- Wrote `src/lib/dues-reminders-queries.test.ts` (new file — this module had no tests before).
  The mocked `db.execute()` does not just return canned output per test; it inspects the actual
  rendered SQL text (via `drizzle-orm`'s `PgDialect`, same technique `board-positions.test.ts` uses)
  and only applies a `success` filter to a raw fixture of `dues_reminders`-shaped rows if the query
  text it receives actually contains `success = true`. This is what makes the tests genuinely red
  against the pre-fix query — reverting the `AND success = true` clause makes the mock behave
  exactly like the old, unfiltered query — rather than merely asserting on hand-picked mock output
  that would pass unconditionally either way.
- Also mocked `@/lib/dues-queries`' `listMemberDuesStatus()` entirely, isolating the one remaining
  `db.execute()` call (from `getLastRemindedMap()`) that these tests exercise, since
  `getReminderCandidates()` calls both via `Promise.all`.
- Confirmed via `git stash` on just `src/lib/dues-reminders-queries.ts` that 3 of the 4 new tests
  fail against the pre-fix code (the 4th, the no-regression "successful reminder shows normally"
  case, correctly still passes pre-fix — it was never broken), then restored the fix and confirmed
  all 4 pass again.
- Searched for other instances of the same defect shape — a query reading a durable-claim table's
  "most recent" row without a `success` filter — across every `db.select`/`db.query.*.findFirst`/
  `db.execute` site touching `ledgerAcknowledgments`, `financialReportSends`, `eventAnnouncements`,
  or `duesReminders`. Found none. `financial-report-send.ts`'s own `getLatestSuccessfulSend()`
  already filters correctly (`eq(financialReportSends.success, true)` in its `WHERE`, confirmed at
  `src/lib/financial-report-send.ts:190-197`). The `ledgerAcknowledgments.findFirst()` call sites in
  `src/app/api/admin/ledger/acknowledgments/[id]/letter/route.ts` and
  `.../transactions/[id]/acknowledge/route.ts` are id-scoped lookups of one specific row by primary
  key, not "most recent send" queries, so a success filter doesn't apply to that shape of query.
  `eventAnnouncements` has no equivalent "last announced" read path at all today (the admin UI
  shows the full per-batch history table, not a single rolled-up badge), so there is no analogous
  bug to find there. `getLastRemindedMap()` was the only instance.
- Filed **B-75** in `docs/backlog.md` (Soon tier, next free ID) for the second missed follow-up:
  `financial-report-send.ts`'s `not_delivered` case writes the same `blockedError` string for both
  `blocked_non_production` and `dev_no_api_key`, so an admin/developer reading the panel can't tell
  which one actually happened, even though `DurableSendOutcome.reason` already distinguishes them
  and `durable-claim-row.ts` already makes the same distinction for its own two call sites. Not
  fixed here — that file is on this task's explicit do-not-touch list.

### Ruling — should a failed/blocked attempt be surfaced to the treasurer, rather than just
### disappearing back into "never reminded"?

**Argued conclusion: no new UI today; the current fix (silently un-reminded) is correct as far as
it goes, but I'm flagging a real gap rather than calling this fully resolved.**

Reasoning:

1. **Silently hiding beats lying about success**, which is the floor the task brief sets, and this
   fix clears that floor. A treasurer who sees "not reminded" for a member whose reminder was
   blocked will simply reminder them again on the next pass — the wrong badge value, corrected,
   produces the right *action* (send another reminder) even though it doesn't produce the most
   informative *display*.
2. **The asymmetry that would justify more UI doesn't hold here the way it does for the
   already-shipped acknowledgment-letter and financial-report treatments.** Those two surfaces
   guard a genuinely non-repeatable claim (a donor should get exactly one letter; a board
   statement's totals-fingerprint is unique) — an admin who doesn't know "this already failed once"
   might avoid retrying under a mistaken belief that retrying is unsafe, or might not realize a
   fix (e.g. adding themselves to the allowlist) is needed before a resend will succeed at all.
   Dues reminders have no such constraint: resending is always safe, always idempotent in effect
   (another `dues_reminders` row, no unique index), and the treasurer's actual next action — "send
   again" — is identical whether the badge says "never reminded" or "last attempt failed on
   <date>." The *information* would be nice-to-have; it does not change what the treasurer should
   do next, which is the bar the task brief sets ("Treasurer-facing accuracy is the goal").
3. **The one place a "last attempted, failed" surface would add real value** is distinguishing a
   `blocked_non_production` outcome (an environment problem — nothing to do with the member's
   address) from a `failed` outcome (a genuine bounce or send failure, which might mean the
   member's email on file is wrong and worth fixing before re-sending yet again). Today, both
   collapse into the same "not reminded" badge with no way to tell them apart from the dues screen.
   That is a real, arguable gap — but it's a `ux-developer` decision (new column? a tooltip? a
   separate "attempts" expandable row?) with actual design tradeoffs, not something to bolt onto a
   backend query fix. Building it here would be exactly the "expand this fix" the task brief warned
   against.
4. **Filed, not built:** noting this as a candidate backlog item is more honest than either
   silently deciding it's out of scope or quietly building UI nobody asked for. I have not filed a
   new backlog ID for it, on the judgment that it's speculative ("would be nice to distinguish
   blocked-vs-failed on this specific badge") rather than a known, named defect the way B-74/B-75
   are — if the next analyst/tech-lead pass agrees it's worth pursuing, it should get its own B-nn
   with a real Phase 1, not be smuggled in as a footnote here.

### Outputs

**Files modified:**
- `src/lib/dues-reminders-queries.ts` — `getLastRemindedMap()`'s raw SQL: added `AND success = true`
  to the `WHERE` clause; rewrote its doc comment to state the DISTINCT-ON-before-filter ordering
  rule explicitly. No exported signature change — `getReminderCandidates()`'s return shape and both
  its callers (`GET /api/admin/dues/reminders`, `page.tsx`'s server-rendered first paint) are
  unaffected in shape, only in the accuracy of `lastReminded` values.
- `docs/backlog.md` — filed **B-75** (Soon tier) for `financial-report-send.ts`'s
  non-discriminating `not_delivered` message. Not fixed — file is out of scope per the task's
  do-not-touch list.

**Files created:**
- `src/lib/dues-reminders-queries.test.ts` — 4 tests (this module had none before):
  1. A member whose only row is `success: false` shows as not reminded (`lastReminded: null`).
     Fails against pre-fix code (mock returns the failed row's date since no `success = true` filter
     is present in the sent query).
  2. A member with an earlier successful send and a later failed one shows the **earlier successful**
     date, not the later failed attempt — the `DISTINCT ON` ordering trap named in the task. Fails
     against pre-fix code (returns the later, failed date).
  3. A member with a genuinely successful reminder is unaffected — no regression. Passes both
     pre-fix and post-fix, as expected (this case was never broken).
  4. The literal SQL text sent to the database contains `success = true` in its `WHERE` clause (and
     still contains `fiscal_year`). Fails against pre-fix code.

**No schema changes.** No `FEATURES` key change. No wire-shape change to any route.

### Gates

- `pnpm exec tsc --noEmit` — clean, no output.
- `pnpm lint` — 0 errors. Same single pre-existing, unrelated warning as Phase 4/5
  (`src/components/admin/ledger/budget-context-panel.tsx:114`) — confirmed via `git diff --stat`
  that file is untouched by this follow-up.
- `pnpm test` — **2228/2228 passing** (baseline 2224 + 4 new tests in
  `dues-reminders-queries.test.ts`).
- `pnpm build:only` — clean production build, no new warnings.
- **Untouched-file confirmation:** `git diff --stat` empty for every file named on this task's
  do-not-touch list: `src/lib/email.ts`, `src/lib/email-durable-claim.ts`,
  `src/lib/email-send-attempt.ts`, `src/lib/durable-claim-row.ts`,
  `src/lib/ledger-acknowledgment-letter-queries.ts`, `src/lib/financial-report-send.ts`, and
  `src/app/api/admin/email-queue/retry/route.ts`.
- **DECISION-085's 17 guardrail tests + 4 no-API-key tests:** unmodified — `git diff --stat` on
  `src/lib/email-guardrail.test.ts` and `src/lib/email-no-api-key.test.ts` is empty; both files were
  not touched by this follow-up and their tests are part of the 2228 passing count.

### No other instance of the defect class found

Searched every `db.select` / `db.query.*.findFirst` / `db.execute` call touching
`ledgerAcknowledgments`, `financialReportSends`, `eventAnnouncements`, or `duesReminders`.
`getLatestSuccessfulSend()` in `financial-report-send.ts` already filters on `success = true`
correctly. The `ledgerAcknowledgments.findFirst()` sites are single-row id lookups, not "most
recent" queries, so the bug shape doesn't apply. `eventAnnouncements` has no "last announced"
rolled-up read path today. `getLastRemindedMap()` was the only instance of this specific shape.

### Open questions / handoff notes

- **Not attempted, per explicit instruction:** B-74 (retry route bypassing durable claims) and
  `financial-report-send.ts`'s `not_delivered` reason-discrimination fix (now filed as B-75) are
  both untouched.
- **Next agent (if pursued):** a "distinguish blocked-vs-failed on the Last Reminded badge" UI
  enhancement is a real candidate (see Ruling §3 above) but was deliberately not filed as its own
  backlog item — it's speculative rather than a named defect. If a future analyst/tech-lead pass
  wants it, it needs its own Phase 1, not a drive-by based on this note.
- **No further backlog-filing gap:** both of Phase 2/3's originally-named follow-ups
  (`getLastRemindedMap()`'s missing filter, `financial-report-send.ts`'s message
  non-discrimination) are now either fixed (this section) or filed (B-75). Nothing from B-73's
  handoff remains unfiled.

### Verdict: complete
