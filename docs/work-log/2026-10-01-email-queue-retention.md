# Email Queue 6-Month Retention (Lazy Purge) — Work Log

> **Slug:** `2026-10-01-email-queue-retention`
> **Surface:** (dashboard) admin — `/admin/email-queue` (no new page, no new route)
> **Permission(s):** existing `FEATURES.ADMIN_USERS` (`admin.users`) covers this; it already gates both the page and the sidebar failed-count badge. No new key.
> **Estimated complexity:** small (one helper + one call site + unit tests + two lines of copy)
> **Pipeline mode:** Accelerated — Phase 2 skipped (confirmed by the orchestrator 2026-10-01; the page-load trigger condition is met — see Phase 2 notation).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-01 |
| 2 — Architectural review | architect | **Skipped** — documented skip, see Phase 2 notation (page-load trigger, no new directory/dependency/table/column/route/`FEATURES` key/migration, not a durable-claim path) | — | 2026-10-01 |
| 3 — Technical design | tech-lead | Complete (brief design; DECISION-107 logged) | Design complete, implementer named | 2026-10-01 |
| 4 — Implementation | **full-stack-developer** (one server helper + one page edit + comments + tests, ~<150 lines, tightly coupled; no schema/DDL, so no database-admin step) | Complete | — | 2026-10-01 |
| 5 — Verification | qa | Complete | **PASS** | 2026-10-01 |
| 6 — Shipped vs intent | analyst | Complete | **SHIP WITH NOTES** (3 follow-ups: B-87 proposed, release-notes entry at release, 2026-10-13 first-real-purge check) | 2026-10-01 |

---

## Request (from the treasurer, 2026-10-01)

> "Does there need to be a purge routine for the email queue? I don't think we need to see more than 6 months of history."

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Yes, but for privacy rather than performance: delete `email_queue` rows older than six months, lazily, every time an admin opens `/admin/email-queue`, because the project has no scheduler and the three tables that point at the queue already survive its pruning.

## Does it need to exist at all? (the treasurer's actual question)

- **Not for performance.** Production holds 133 sent rows over ~5.5 months (about 25 a month, a few hundred a year). `ix_email_queue_status` already keeps the page and the nav badge cheap. A table that size is not a scale problem for years.
- **Yes for data minimisation.** `email_queue` stores the full HTML body, recipient/cc/bcc addresses, and base64 `.ics` attachments of everything the site sends. Bodies include member-supplied text (proposal submissions emailed to the board), donor acknowledgment letters (name + gift amount), and the board's monthly financial statements. Nothing today ever removes any of it. Capping retention is a small, real win and the page also gets less noisy.
- **No regulatory or audit reason to keep it longer.** The durable "what was sent" records live in their own tables (`dues_reminders`, `event_announcements`, `financial_report_sends`, `ledger_acknowledgments.sent_at/sent_via`), each self-describing. Acknowledgment letters can be recomposed from the immutable fields on `ledger_acknowledgments` (amount, date, purpose are copied at creation and locked once sent). `email_queue` is a delivery log and retry buffer, not the system of record (DECISION-085).

So: worth doing, small, not urgent. Production's first purge removes nothing until **2026-10-13** (oldest sent row is 2026-04-13); this is expected, not a bug, and needs no backfill or one-off script.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`admin.users` holder) | Opens `/admin/email-queue` to check delivery, retry a failed message, or read a sent message. The purge is a side effect of this, not a verb. | On demand |
| Admin | Reads the new one-line retention note on that page | On demand |
| Anonymous visitor / authenticated member without a role / signed-in member | None. No user-facing change on any other surface. | n/a |

There is deliberately **no** "Purge now" button and **no** new endpoint (see Decision 1). If the user overrides that, a button adds a new destructive admin verb that needs `<ConfirmDialog>`, its own `auth()` + `hasFeature()` gate, and a result toast.

## Flows

**Flow 1 — Admin opens the Email Queue page (the purge flow):**
`/admin/email-queue` → `auth()` + `hasFeature(ADMIN_USERS)` gate (existing) → `resetStaleRetryingEmails()` (existing; moves stranded `retrying` rows to `failed`) → **purge rows older than the cutoff** → the three section queries run → page renders with at most ~6 months of history.
- Failure: the purge throws or the DB hiccups on that one statement → swallow it and render the page exactly as today. A purge failure must never be the reason the page 500s. (If the DB is truly down, the three section queries fail as they do today.) Not logged to the user; the next visit retries.

**Flow 2 — Stale tab clicks Retry on a row that has since been purged:**
Admin leaves the page open for days → another visit purges the row → clicks the per-row Retry → `POST /api/admin/email-queue/retry` → `handleTargetedRetry()` finds no row → returns `"Email not found"` → `RowRetryButton` shows it as an error toast.
- Already degrades gracefully, no 404/crash. Microcopy is terse; acceptable. Nothing to build.

**Flow 3 — Anything that remembers an `emailQueueId` after the row is purged:**
`dues_reminders`, `event_announcements`, `financial_report_sends` hold `email_queue_id` with `ON DELETE SET NULL` → the FK nulls out; the row keeps its own `success`, `error`, `note`, `sentAt`.
- **Verified in code:** nothing reads `emailQueueId` back from any of the three tables. Every reference is a write (`dues/reminders/route.ts`, `events/[id]/announce/route.ts`, `financial-report-send.ts`, `ledger/reports/send/route.ts`). There is no "view email" link anywhere that dereferences it, and the acknowledgment-letter read-back workaround was already deleted under DECISION-103. The only reader of `email_queue` rows is `/admin/email-queue` and its retry route. A purged row therefore degrades to "nothing to show", never a 404 or crash.
- **Verified in migrations:** all three FKs are `ON DELETE SET NULL` in SQL (`0086`, `0096`, `0103`), not just in `schema.ts`. The schema comment at ~line 521 (on `dues_reminders`) correctly anticipates pruning. The same wording is not repeated on `event_announcements` or `financial_report_sends`, whose FKs behave identically; and the `email_queue` table's own comment says nothing about retention. Fix all of that in the same change (see Gaps).

**Flow 4 — Nobody opens the page for a long time:**
Rows older than six months accumulate (about 25 a month, trivial) → next visit deletes them all in one statement.
- At this volume a single `DELETE` is fine. No batching needed; tech-lead should note the assumption in a comment.

## Permissions

- **Permission(s):** existing `FEATURES.ADMIN_USERS` (`admin.users`), confirmed on `src/app/(dashboard)/admin/email-queue/page.tsx` (`hasFeature(session.user.id, FEATURES.ADMIN_USERS)`, else redirect to `/admin`), on the sidebar badge, and on the derived proxy rule via `ADMIN_NAVIGATION`. The purge runs strictly after that gate, so it adds no new access and no new endpoint.
- **Default roles:** unchanged (the `admin` role). Note for the open questions: this key is **not** bound to the treasurer role as far as the migrations show, so "who actually opens this page" matters (Open Question 1).

## Decisions made (recommended defaults; veto any)

1. **Trigger: on `/admin/email-queue` page load, not inside `sendEmail()`, not a button.**
   - *Inside `sendEmail()` (piggyback on every enqueue):* this is the codebase's other accepted pattern (failed-login attempts and the form cooldown both prune on insert, DECISION-033). It gives the tightest guarantee, because the table is pruned exactly when it grows. Rejected here for three reasons. (a) **Latency on the send path:** bulk sends loop `sendEmail()` per recipient (event announcements, dues reminders, minutes), so every recipient gains a Neon round-trip inside a request whose budget `email-queue-stats.ts` documents as the Hobby 10-second cap. (b) **Blast radius:** `sendEmail()` is the most incident-prone function in the repo (DECISION-102/103, four same-shaped defects in one day); adding an unrelated write to its hot path, plus the failure isolation it would need, is risk with no user-visible benefit. Its unit suites also mock the `db` chain, so a `.delete()` forces edits to existing mocks. (c) The performance argument against it is weak, but the first two are not.
   - *Explicit button:* relies on a human remembering to do housekeeping; it will not happen. Also adds a destructive endpoint to gate, test, and confirm.
   - *Page load:* one idempotent, usually zero-row `DELETE` per visit to a low-traffic page, after the permission gate, next to `resetStaleRetryingEmails()`, which already does a write-on-read for the same "no scheduler" reason. Cheapest and lowest risk. **Honest limit:** retention is "deleted at the next admin visit after six months", not "deleted at six months". If nobody visits, nothing is pruned; with ~25 rows a month that costs almost nothing, but it means the retention claim must stay internal (see Gap on `/privacy`).
   - *Escalation path if the user wants a hard guarantee:* move the same helper call into the enqueue path. The helper is shared, so that is a one-line move, but it re-opens Phase 2 (see Phase 2 recommendation).
2. **Retention value: a constant, not a setting.** `EMAIL_QUEUE_RETENTION_DAYS = 183` (about six months) exported from `src/lib/email-queue-stats.ts`, with a pure `emailQueueRetentionCutoff(now)` mirroring `pruneCutoff()` in `src/lib/auth/failed-login.ts` so it is unit-testable without a database. Days rather than calendar months because JS month arithmetic misbehaves at month-end (Aug 31 minus six months), and 183 days from 2026-04-13 lands on 2026-10-13, identical to the calendar answer. A `ledger_settings`-style setting needs a UI, a permission, a migration, and a validation story for what is a one-time policy statement from the treasurer, not a knob anyone will turn. Reconsider only if the board wants different retention per message type.
3. **Age basis: `COALESCE(sent_at, created_at) < cutoff`.** `created_at` alone would delete a message the instant it is successfully retried after sitting `failed` for six months, and it would vanish from "Recently Sent" the moment it was sent. `sent_at` is null for unsent rows, so the COALESCE gives every row a defined age.
4. **Which rows: every status, with one exclusion.**
   - `sent`: purge (the obvious set).
   - `blocked_non_production`, `dev_no_api_key`: purge. They were never delivered and are dev noise.
   - `failed`: purge at the same cutoff. A six-month-old failure is noise, and retrying a six-month-old dues reminder or announcement would send stale content to a real person. The failure is not lost: the owning table (`dues_reminders`, `event_announcements`, `financial_report_sends`) keeps its own `success = false` + `error`. It also keeps the nav badge honest instead of nagging forever about something nobody will ever retry. Keeping failed rows forever would retain the recipient and body indefinitely and defeat the point.
   - `pending`: purge. A `pending` row older than six months is a stranded insert (the process died between the enqueue and the status write). These rows are **invisible today**: the page shows only `failed`, `blocked_non_production` / `dev_no_api_key`, and `sent`; the badge counts only `failed` and stale `retrying`; the retry paths require `failed`. Purging them is pure upside. (The invisibility itself is a separate pre-existing gap; see Out of Scope.)
   - `retrying`: **exclude from the DELETE** (`status <> 'retrying'`) and run `resetStaleRetryingEmails()` first, as the page already does. A stranded `retrying` row becomes `failed` five minutes after stranding and is purged on the next visit. Excluding it closes a narrow race where an admin retries a six-month-old failed row at the same instant the purge fires (the claim would then settle against a deleted row, and the message could be sent with no record of it).
5. **Audit: no audit row.** The three candidates do not fit: `google_group_sync_log` is group-scoped (`group_email` is NOT NULL, and it feeds `/admin/sync-log`), `permission_audit_log` records permission changes, and `ledger_audit_log` records ledger edits. The two existing opportunistic prunes in this codebase (failed logins, form cooldown) write no audit row either. Auditing the deletion of a delivery log with another log is a regress, since the durable "what was sent" records live elsewhere. Instead, state the policy as a static line on the page ("Email history is kept for 6 months. Older messages are removed automatically when this page is opened.") so the behaviour is discoverable. The helper returns the deleted count for tests and, if tech-lead wants it, a future toast; no new table.
6. **`/privacy` needs no edit.** `src/app/privacy/page.tsx` states no retention period for anything and never mentions outbound-email logs, so nothing it says is invalidated. Do **not** add a "six months" promise there: the lazy trigger cannot strictly guarantee it, and a policy page that over-promises is worse than one that is silent. If the board later wants one, word it as "kept for up to about six months", bump `EFFECTIVE_DATE`, and treat it as a separate, board-approved change.

## Gaps the Request Didn't Address

- **Trigger, age basis, status policy, retention value, audit.** All five were left open by the request; recommended defaults are in "Decisions made" above.
- **Comment drift.** `schema.ts`: add one retention sentence to the `email_queue` table comment, and note on `event_announcements` and `financial_report_sends` that `email_queue_id` goes null on purge (only `dues_reminders` says so today). Why it matters: the next engineer who adds a durable-claim table will copy whichever comment they find. Resolution: tech-lead includes it in Phase 3.
- **Stale microcopy.** "Recently Sent (last 20)" shows "No emails sent yet." when it is empty. After a purge on a quiet club it can be empty even though emails were sent last year. Suggest "No emails sent in the last 6 months." Resolution: one-line copy change, in scope.
- **Referencing columns are unindexed.** The `ON DELETE SET NULL` cascade has to find rows in `dues_reminders`, `event_announcements`, and `financial_report_sends` by `email_queue_id`; none of those columns is indexed (checked `schema.ts`). At today's volume (a few hundred rows each) this is negligible, and I recommend **not** adding indexes for it. Tech-lead should write one line in the design acknowledging it so a future 10x does not surprise anyone.
- **Test dates.** Production has no row old enough to exercise the purge for 12 days. Tests must use fixture timestamps around the cutoff, with no dependence on production data. Required cases: just inside the window kept, just outside deleted, `retrying` excluded, sent-recently-but-created-long-ago kept, purge failure swallowed and page still renders.
- **Durable-claim exception (CLAUDE.md, Bug-Fix Variant): does not apply.** This change deletes rows and writes no "this was sent" claim. It must still not call `sendEmail()` or touch the claim-bearing tables beyond the FK null-out.

## Adversarial Pass (Pass 5)

- **Redirect targets:** none. No new URL, no `callbackUrl`/`next` parameter.
- **State-machine shortcuts:** no new route, so nothing to hit directly. (With a button there would be a new `POST` needing its own `auth()` + `hasFeature()`; another reason to prefer page-load.) The purge is a write on a `GET` render, like `resetStaleRetryingEmails()`. It is time-based and idempotent, so a Next.js prefetch or a double render is harmless.
- **Enumeration leaks:** none; no new response varies by resource existence. The stale-tab retry already returns a uniform "Email not found".
- **Input boundaries:** none; no user input reaches the purge. The cutoff is a code constant, not a query parameter or form field. Do not make it overridable from the URL.
- **Self-targeting / privilege:** an `admin.users` holder can already read every body on that page; the purge only removes data and grants nothing. A non-admin cannot reach it because it runs after the gate.
- **Edge: `created_at`/`sent_at` are naive `timestamp` columns** (the project's known drift; only `retrying_at` is `timestamptz`). Compute the cutoff in JS (as `pruneCutoff()` does), not with SQL `now() - interval`. At a six-month granularity a few hours of skew is irrelevant, but keep it consistent with DECISION-005's "do the time comparison in JS" habit.

## Out of Scope (confirm with user)

- **Pending rows are invisible everywhere** (page, badge, retry). The purge cleans them at six months, but a `pending` row stranded for an hour is as invisible as one stranded for a year. A "stuck pending" section or badge count is a separate follow-up (suggest a backlog item, next free ID is B-79).
- **Purging the three durable tables** (`dues_reminders`, `event_announcements`, `financial_report_sends`). They hold no body or address, are small, and are the real send history. Not touched.
- **`google_group_sync_log`** keeps member email lists (added/removed/failed) with no retention at all. Same class of data-minimisation gap and a natural sibling follow-up, but a different table, page, and decision. Noted, not in this change.
- **A "Purge now" button, a configurable retention setting, a Vercel cron, or an `scripts/` operator script.** Not needed (Decisions 1 and 2).
- **Resend delivery webhooks (B-47)** and **B-74** (retry route unaware of durable claims) are unrelated. Purging does not change either, and shortens B-74's exposure window to six months.

## Open Questions

1. **Who actually opens `/admin/email-queue`?** The page is gated on `admin.users`, which the treasurer role does not appear to hold. The lazy trigger only works if some admin visits at least occasionally. The unsent rows were just deleted by hand, so someone looks, but is it routine? If the answer is "rarely", the user may prefer the enqueue trigger (accepting the Phase 2 consequence below) or to have the sidebar badge path also fire the purge. *Default if unanswered: page-load only.*
2. **Is six months right for failed rows too, or should a failure be kept until someone clears it?** Default: purge at six months (reasoning in Decision 4). Say so if the treasurer wants unresolved failures to stick around.
3. **Is the treasurer comfortable that donor-acknowledgment and board-report email copies will not survive six months?** Per the code, the durable record of each is its own table and the letter is reconstructable from its immutable fields, so I see no loss. This is a courtesy confirmation, not a blocker.

---

## Phase 2 Recommendation (analyst's input to the orchestrator)

**Skip Phase 2, with an explicit work-log notation, provided the trigger is the page load.**

- It adds no directory, no dependency, no table, no column, no route, no `FEATURES` key, and no migration. Every structural question Phase 2 answers is already answered.
- "First automatic `DELETE` in the codebase" is not accurate: the pattern already exists and was ruled on. `recordFailedLogin()` prunes `failed_login_attempts` on every insert (90-day window, DECISION-033, "agreed piggyback-on-insert pattern, Architect Ruling 3"), and `checkAndRecordFormCooldown()` in `src/lib/form-guard.ts` prunes `form_submission_cooldown` on every insert. `resetStaleRetryingEmails()` already does a lazy write-on-read on this exact page. This change is a third instance of an established idiom, in the file that already holds the sibling helper.
- It is not a durable-claim path (no sent-claim is written), so the CLAUDE.md "never skippable" exception does not apply.
- The FK degradation, the one thing an architect would otherwise check, is verified above (all three FKs `ON DELETE SET NULL` in SQL; nothing reads the column back).

**Do not skip if** the user chooses the `sendEmail()` trigger. That puts a delete inside the send helper that DECISION-102/103 guard, in the path of every bulk send, and the architect should rule on it explicitly.

**Nice-to-have for the 30-day code review, not for this pipeline:** after this change the repo has three "opportunistic prune" call sites with different tables and windows. They share an idiom, not logic, so do **not** build a generic prune framework now; just record the count.

## Acceptance Criteria (for QA and my Phase 6)

1. Opening `/admin/email-queue` as an `admin.users` holder deletes rows older than the cutoff and leaves everything newer, with the cutoff measured by `COALESCE(sent_at, created_at)`.
2. Rows older than the cutoff are removed regardless of status (`sent`, `failed`, `pending`, `blocked_non_production`, `dev_no_api_key`), except `retrying`, which is excluded.
3. `dues_reminders`, `event_announcements`, and `financial_report_sends` rows survive the purge with `email_queue_id = NULL` and unchanged `success` / `error` / `note`.
4. A purge failure does not break the page; the sections still render.
5. The page shows the one-line retention note, and the empty "Recently Sent" copy no longer says "No emails sent yet."
6. No change to `sendEmail()`, `sendBulkMemberEmail()`, the retry route's behaviour, `ADMIN_USERS`, or `/privacy`.
7. Card/button styling follows the existing page (`rounded-2xl` empty state, no new buttons). No native dialogs.

## Phase 1 handoff

**Owner:** analyst
**Status:** complete

### Summary
The treasurer's question is answered: a purge is worth adding for data minimisation, not for performance, and it should run lazily from the admin email-queue page load because the project has no scheduler by design. All three tables that reference `email_queue` use `ON DELETE SET NULL` in their SQL, and nothing reads that column back, so a purged row degrades to "nothing to show". The work is small and follows two prune patterns already in the codebase.

### What I did
- Read the template, `email_queue` schema and the three referencing tables, `sendEmail()`, the retry route, `email-queue-stats.ts`, the page, the sidebar gate, `/privacy`, the sync-log page, and the existing prune precedents (`failed-login.ts`, `form-guard.ts`).
- Grepped every `emailQueueId` use to confirm they are all writes.
- Confirmed the FK behaviour in the SQL migrations as well as `schema.ts`.
- Ran the five-pass review and recorded six decisions with reasons.

### Outputs
- `/Users/cshenso/git/westervillelions/docs/work-log/2026-10-01-email-queue-retention.md` (this file)
- No decisions logged to `docs/decisions.md` yet; recommend tech-lead logs one entry in Phase 3 covering the constant, the age basis, and the status policy.

### Open questions / handoff notes
- Phase 3 (tech-lead, brief): helper placement in `src/lib/email-queue-stats.ts` next to `resetStaleRetryingEmails()`; order is reset, then purge, then queries; wrap the purge in try/catch; add the schema comments and page copy; list the unit tests under Acceptance Criteria; log one decision.
- Phase 2: skip with notation if the trigger stays page-load (see above).
- Do not touch `src/lib/ledger*.ts` or the two sibling work-logs of 2026-10-01.

---

# Phase 2 — Architectural Review (architect)

**SKIPPED — documented skip, not a silent one (2026-10-01).** Skip confirmed by the orchestrator on the
analyst's recommendation (Phase 1, "Phase 2 Recommendation"). The analyst's condition ("provided the trigger
is the page load") is met: the orchestrator adopted every analyst default, including the page-load trigger.

Analyst's rationale, preserved verbatim in substance:
- Adds no directory, no dependency, no table, no column, no route, no `FEATURES` key, and no migration. Every
  structural question Phase 2 answers is already answered.
- It is not "the first automatic `DELETE` in the codebase". The idiom exists and was ruled on:
  `recordFailedLogin()` prunes `failed_login_attempts` on insert (90-day window, DECISION-033, Architect
  Ruling 3), `checkAndRecordFormCooldown()` (`src/lib/form-guard.ts`) prunes `form_submission_cooldown`, and
  `resetStaleRetryingEmails()` already does a lazy write-on-read on this exact page. This is a third instance
  of an established idiom, in the file that holds the sibling helper.
- Not a durable-claim path (no "this was sent" claim is written), so the CLAUDE.md Bug-Fix Variant
  "durable-claim exception" does not apply. The change must still never call `sendEmail()`.
- The FK degradation (the one thing an architect would otherwise check) is verified: all three referencing
  FKs are `ON DELETE SET NULL` in SQL (`0086`, `0096`, `0103`) and nothing reads `emailQueueId` back.
- **Do not skip if** the trigger ever moves into `sendEmail()` — that re-opens Phase 2.

Resolution of the Phase 1 open questions (orchestrator, 2026-10-01):
1. The admin who opens `/admin/email-queue` is the treasurer, who also holds `admin`; the lazy page-load
   trigger is therefore fine.
2. Unresolved `failed` rows are purged at six months.
3. Losing queue copies of acknowledgment letters and board reports is acceptable; each has its own durable
   record.

---

# Phase 3 — Technical Design (tech-lead)

## Technical Design: Email Queue 6-Month Retention (Lazy Purge)

### Summary

Add a pure cutoff helper and a `pruneEmailQueue()` function to `src/lib/email-queue-stats.ts`, next to
`resetStaleRetryingEmails()`. The admin email-queue page calls it on every load, after the permission gate and
after `resetStaleRetryingEmails()`, inside its own try/catch so a purge failure can never take the page
down. One `DELETE` removes every `email_queue` row older than 183 days (age = `COALESCE(sent_at, created_at)`)
except rows currently `retrying`. Plus a one-line policy note on the page, one empty-state copy fix, three
comment-only edits in `schema.ts`, unit tests, a release-notes entry, and DECISION-107. No schema change, no
migration, no new route, no new permission, no change to `sendEmail()`.

### Permissions

- No new key. Existing `FEATURES.ADMIN_USERS` (`admin.users`) already gates the page (and the nav badge, and
  the derived proxy rule). The purge runs strictly after that gate, so it adds no access.
- Default roles unchanged. (The treasurer holds `admin`, per the orchestrator's answer to Open Question 1.)

### API Contract

No HTTP surface. One server function, one pure helper, one constant:

```ts
// src/lib/email-queue-stats.ts
export const EMAIL_QUEUE_RETENTION_DAYS = 183; // ~6 months; days, not months (month-end arithmetic)

/** Pure. Rows whose age basis is strictly before this instant are purged. */
export function emailQueueRetentionCutoff(now: Date = new Date()): Date;

/** Deletes aged rows; returns the number deleted. THROWS on DB error (caller decides). */
export async function pruneEmailQueue(now: Date = new Date()): Promise<number>;
```

Design points:
- `emailQueueRetentionCutoff` is `new Date(now.getTime() - EMAIL_QUEUE_RETENTION_DAYS * 86_400_000)`. UTC
  millisecond arithmetic, so no DST drift. Mirrors `pruneCutoff()` in `src/lib/auth/failed-login.ts`. The
  `now` parameter is injectable (default `new Date()`), unlike `resetStaleRetryingEmails(now)` which makes it
  required; here the default keeps a future second caller trivial. The page passes `new Date()` explicitly,
  matching the existing call right above it.
- **`pruneEmailQueue` does not swallow errors.** The helper stays honest and testable (a rejected delete
  rejects); the single place that decides "a purge failure must never 500 the page" is the page. This keeps
  the policy at the call site, where the analyst's Flow 1 put it, and means a future caller (e.g. an enqueue
  trigger, if ever moved) makes its own choice.
- Not exported from anywhere else; `sendEmail()`, `sendBulkMemberEmail()` and the retry route are untouched.

**Exact predicate** (verified by compiling it with `PgDialect().sqlToQuery` against the real `emailQueue`
schema on 2026-10-01 — this is the text the unit test pins):

```sql
DELETE FROM "email_queue"
WHERE ("email_queue"."status" <> $1                                   -- $1 = 'retrying'
   AND COALESCE("email_queue"."sent_at", "email_queue"."created_at") < $2::timestamp)  -- $2 = cutoff.toISOString()
RETURNING "id"
```

```ts
const cutoff = emailQueueRetentionCutoff(now);
const deleted = await db
  .delete(emailQueue)
  .where(
    and(
      ne(emailQueue.status, "retrying"),
      sql`COALESCE(${emailQueue.sentAt}, ${emailQueue.createdAt}) < ${cutoff.toISOString()}::timestamp`,
    ),
  )
  .returning({ id: emailQueue.id });
return deleted.length;
```

Why this shape:
- **`ne(status, "retrying")`, not an allow-list of statuses.** A future status value is purged by default
  (consistent with the retention policy), and the one status that is a live claim is the explicit exception.
  Nothing else in the predicate mentions status, so `pending`, `sent`, `failed`, `blocked_non_production` and
  `dev_no_api_key` are all covered. (`status` is `NOT NULL`, so `<>` cannot silently skip NULL rows.)
- **ISO string with an explicit `::timestamp` cast, not a raw `Date` bound into the `sql` fragment.** Drizzle
  does not apply a column encoder to a `Date` inside a bare `sql` template, and node-postgres would serialize
  that `Date` in the *process's local timezone*. `created_at`/`sent_at` are naive `timestamp` columns the
  project reads as UTC (DECISION-005 and the naive-timestamp drift in memory), so we bind an unambiguous UTC
  string and cast it. On Vercel (UTC) either way works; on a developer laptop in EDT the raw `Date` would skew
  by four hours. At a six-month granularity that is harmless, but there is no reason to leave a trap.
- **Strict `<`.** A row exactly at the cutoff instant is kept; the boundary is a test.
- **Cutoff computed in JS**, never `now() - interval '6 months'` in SQL (DECISION-005 habit; also what makes
  it injectable and testable).
- **One statement, no batching.** Assumption (write it in the function's doc comment): the table holds a few
  hundred rows per year (~25 sent/month), so a single `DELETE` is trivially cheap. Revisit if the table ever
  holds tens of thousands of rows.
- **Index/scan acknowledgment.** The predicate cannot use `ix_email_queue_status` (it is `<>` plus a COALESCE),
  so the `DELETE` is a sequential scan of `email_queue`. At hundreds of rows that is sub-millisecond. The same
  analysis applies to the `ON DELETE SET NULL` cascade: `email_queue_id` is unindexed on `dues_reminders`,
  `event_announcements` and `financial_report_sends`, so each deleted queue row costs one seq scan of each
  (small) table. Deliberately **not** adding indexes; revisit if any of those tables or the queue grows ~10x
  past a few thousand rows. (Also write this as one sentence in the function's doc comment.)

### Data Model

No schema changes required. No migration. Comment-only edits in `src/lib/db/schema.ts` (see Component/Page
Plan); `drizzle-kit push` is unaffected by comments.

### Component/Page Plan

- Pages to create: none.
- Components to create: none.
- Files to modify:

**1. `src/lib/email-queue-stats.ts`** — add `lt`-style imports as needed (`ne` from `drizzle-orm`; `and`, `sql`
already imported), `EMAIL_QUEUE_RETENTION_DAYS`, `emailQueueRetentionCutoff()`, `pruneEmailQueue()`. Place
them directly after `resetStaleRetryingEmails()`. The doc comment must state: why page-load rather than
`sendEmail()`; the age basis and why; that `retrying` is excluded and why (closes the race where an admin
retries a six-month-old failed row at the instant the purge fires, which would settle against a deleted row and
send with no record); the single-statement/seq-scan assumptions above; and the honest limit, "removed at the
next admin visit after six months, not at six months".

**2. `src/app/(dashboard)/admin/email-queue/page.tsx`** — three edits.

(a) Import `pruneEmailQueue` alongside `resetStaleRetryingEmails`.

(b) Call order is fixed: `resetStaleRetryingEmails()` (unchanged, unwrapped) -> purge (wrapped) -> the three
section queries. Reset must come first: it turns a stranded `retrying` row into `failed`, which this same
request then purges if it is also old (so the stranded-and-old case clears on the *same* visit, not the next
one as Phase 1 assumed). Insert after the existing `await resetStaleRetryingEmails(new Date());`:

```ts
  // Retention: drop email_queue rows older than EMAIL_QUEUE_RETENTION_DAYS (DECISION-107).
  // Lazy and best-effort by design — this project has no scheduler — so a failure here
  // must never be the reason the page doesn't render. The next visit retries.
  try {
    await pruneEmailQueue(new Date());
  } catch (error) {
    console.error("[email-queue] retention purge failed", error);
  }
```

`console.error` (not `console.log`) is the one acceptable production-path log: it is the only trace that the
purge is failing, and it contains no message content. The implementer should grep for the project's existing
caught-error logging convention and match it if one exists; if none, keep this line.

(c) Copy (no new components, no new buttons, existing classes only):

- **Policy note.** Add a second line under the existing header subtitle, same `<div>` as the `<h1>`:

  ```tsx
  <p className="mt-1 text-sm text-gray-500">
    Email history is kept for 6 months. Older messages are removed automatically when this page is opened.
  </p>
  ```

  Exact copy: `Email history is kept for 6 months. Older messages are removed automatically when this page is opened.`
  It states the mechanism ("when this page is opened"), which is the honest version of the lazy-trigger limit,
  and makes no promise that belongs on `/privacy`.
- **Empty-state copy fix.** In the "Recently Sent (last 20)" section change `No emails sent yet.` to
  `No emails sent in the last 6 months.` Keep the existing `bg-gray-50 rounded-2xl p-10 text-center text-gray-500`
  container. The other two empty states ("No failed emails — everything is delivering successfully." and "No
  blocked or unconfigured messages.") remain true after a purge; leave them.
- The "6 months" strings are literals, not derived from the constant. The unit test that pins
  `EMAIL_QUEUE_RETENTION_DAYS === 183` carries a comment telling whoever changes it to update both strings.

**3. `src/lib/db/schema.ts`** — comment-only, three places:

- `event_announcements` (beside its `emailQueueId`, ~line 591 of `schema.ts`; `grep -n emailQueueId`):
  `// Nullable, onDelete set null: email_queue rows are pruned after EMAIL_QUEUE_RETENTION_DAYS (src/lib/email-queue-stats.ts, DECISION-107), so this goes null on purge. success/error/note keep this row self-describing; nothing may dereference this id.`
- `financial_report_sends` `emailQueueId` (~line 1346): the same sentence (adjust the table-specific tail if it has no `note`:
  "success/error and the stored fingerprint keep this row self-describing").
- `email_queue` table comment (the `// Email queue for persistent delivery with retry support` line): append
  `Delivery log and retry buffer, not a system of record: rows are deleted once older than EMAIL_QUEUE_RETENTION_DAYS (about six months, measured by COALESCE(sent_at, created_at)); see pruneEmailQueue() and DECISION-107.`
- Reference only: the `dues_reminders` comment at ~line 521 already says this and is the model; do not change it.

4. **No other files.** Specifically do not touch `sendEmail()`, `sendBulkMemberEmail()`, `email-durable-claim.ts`,
the retry route, `FEATURES`/`ADMIN_NAVIGATION`, `/privacy`, or `src/lib/ledger*.ts`.

### Implementation Order

1. Helper + constant + `pruneEmailQueue()` in `src/lib/email-queue-stats.ts`, with its unit tests (tests first
   is fine; the tests are part of Phase 4's gate).
2. `schema.ts` comments (3).
3. Page: import, try/catch purge after reset, policy note, empty-state copy.
4. Page-level test (call order, swallowed failure, gate).
5. Release-notes entry via `/release-notes`; DECISION-107 is already written by tech-lead (see Outputs).
6. QA (Phase 5): manual fixture check against the dev DB (below).

No schema/migration/permission/email steps from the template apply. No `sendEmail()` call anywhere.

### Unit tests (the implementer delivers these; Phase 4 gate)

Extend `src/lib/email-queue-stats.test.ts` (its `@/lib/db` mock currently has `select` and `update` only; add a
`delete` chain `delete: vi.fn(() => ({ where: (cond) => ({ returning: async () => ... }) }))` — additive, no
change to existing cases). Compile the captured `where` argument with
`new PgDialect().sqlToQuery(cond)` (`import { PgDialect } from "drizzle-orm/pg-core"`) to assert on SQL text and
params. Because a mocked `db` cannot evaluate SQL, behavioral cases use a tiny in-test evaluator that applies
the *same* operator semantics to fixture rows, and it is only trusted because the pinned-SQL test below proves
the compiled predicate has exactly that shape. State this in a comment so nobody mistakes the evaluator for
the SUT. All fixtures use fixed dates (e.g. `now = 2026-10-13T00:00:00.000Z`); nothing depends on production data
or the wall clock.

`describe("emailQueueRetentionCutoff")`
1. `returns exactly 183 days before now` — `now = 2026-10-13T00:00:00.000Z` -> `2026-04-13T00:00:00.000Z`
   (183 days = the calendar-six-months answer for this pair, per the analyst).
2. `uses day arithmetic, not calendar months, so a month-end now is well-defined` —
   `2026-08-31T12:00:00.000Z` -> `2026-03-01T12:00:00.000Z` (documents why the constant is in days).
3. `is pure: does not mutate its argument, and defaults to the current time` — fake timers
   (`vi.useFakeTimers`/`setSystemTime`) for the default; assert the passed `Date` is unchanged.
4. `EMAIL_QUEUE_RETENTION_DAYS is 183` — a tripwire; comment: "changing this requires updating the two '6 months'
   strings in src/app/(dashboard)/admin/email-queue/page.tsx and DECISION-107".

`describe("pruneEmailQueue")`
5. `pins the exact predicate` — compiled where-clause equals
   `("email_queue"."status" <> $1 and COALESCE("email_queue"."sent_at", "email_queue"."created_at") < $2::timestamp)`
   with params `["retrying", "2026-04-13T00:00:00.000Z"]` for `now = 2026-10-13T00:00:00.000Z`. This is the
   anchor test for 6-9.
6. `keeps rows at and inside the cutoff, deletes rows older than it (strict <)` — fixture rows with age basis at
   cutoff minus 1 ms (deleted), exactly the cutoff (kept), cutoff plus 1 ms (kept), and 1 day old (kept).
7. `never deletes a 'retrying' row, however old` — fixture `retrying` row aged 400 days is kept while the same
   row at status `failed` is deleted; also asserts the status param is the literal `"retrying"` with `<>`.
8. `purges every other status when old: sent, failed, pending, blocked_non_production, dev_no_api_key` —
   one 200-day-old fixture row per status; exactly the five non-`retrying` ones are deleted. (Asserting
   behavior per status guards against someone narrowing the predicate to an allow-list.)
9. `uses COALESCE(sent_at, created_at) as the age basis` — three fixtures: (a) created 300 days ago, sent 2
   days ago (a long-stranded failure that was just retried successfully) is KEPT; (b) `sent_at` null, created
   200 days ago, DELETED (falls back to `created_at`); (c) `sent_at` 200 days ago, created 210 days ago,
   DELETED. Also assert the compiled SQL text contains `COALESCE("email_queue"."sent_at", "email_queue"."created_at")`
   and does not compare `created_at` alone.
10. `returns the number of rows deleted, 0 when none` — the `returning` fake yields N ids / `[]`.
11. `propagates a database error instead of swallowing it` — fake delete rejects -> `pruneEmailQueue` rejects
    (the page, not the helper, owns the swallow).
12. `issues exactly one DELETE on email_queue and nothing else` — `db.delete` called once; `db.update` and
    `db.insert` not called (guards the "do not touch the claim-bearing tables beyond the FK null-out" rule).

Page-level test — new `src/app/(dashboard)/admin/email-queue/page.test.tsx` (mock `next/navigation`,
`@/lib/auth`, `@/lib/permissions-server`, `@/lib/db`, `@/lib/email-queue-stats`, and the three client
components; the page is an async Server Component, so `await AdminEmailQueuePage()` returns a React element):
13. `purges after the reset and before the section queries` — call-order assertion across
    `resetStaleRetryingEmails`, `pruneEmailQueue`, then the first `db.select`.
14. `still renders (does not throw) when pruneEmailQueue rejects` — covers acceptance criterion 4; also asserts
    the three section queries still ran.
15. `does not purge for a user without ADMIN_USERS` — `hasFeature` false -> `redirect` is invoked (mock throws
    like Next's NEXT_REDIRECT) and `pruneEmailQueue` was never called; same for an unauthenticated session.
16. `shows the retention policy note and the new empty-state copy` — rendered tree contains the exact policy
    sentence, and with an empty `sent` result contains `No emails sent in the last 6 months.` and not
    `No emails sent yet.`. (If rendering the element tree to text proves awkward, assert via
    `renderToStaticMarkup` from `react-dom/server`; the child client components are mocked to `null`.)

QA (Phase 5), not unit tests: against the **dev** database, insert fixture `email_queue` rows with distinctive
subjects and `example.invalid` recipients (never a real address; direct inserts do not touch Resend) at ages
(cutoff-1 day, cutoff+1 day, `retrying` 300 days old with fresh `retrying_at`), plus one `dues_reminders` row
pointing at an old queue row; open `/admin/email-queue`; confirm old rows are gone, boundary-inside rows remain,
the `retrying` row remains, the `dues_reminders` row survives with `email_queue_id = NULL` and unchanged
`success`/`error`/`note`, the policy note shows, and (empty `sent`) the new empty-state copy shows. Also
`pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build:only`. Clean up the fixtures afterwards.

### Edge Cases & Risks

- **"Deleted at the next admin visit, not at six months."** If nobody opens the page, nothing is pruned. Fine
  for now because volume is ~25 rows/month and the only retention claim is the in-page note; revisit (move the
  same helper into the enqueue path, which re-opens Phase 2) if a hard guarantee is ever wanted. The wording
  of the note is deliberately mechanism-first for this reason. Production's first real purge is on/after
  2026-10-13 (oldest sent row 2026-04-13); that it deletes nothing before then is expected, not a bug.
- **Nav badge lag on the visit that purges.** The failed-count badge is computed in the admin layout
  (`getFailedEmailCount()`), which renders alongside the page, not after it. On the one visit where the purge
  removes old `failed` rows, the badge can still count them; it is correct on the next navigation. Harmless
  (it over-reports once, never under-reports) and not worth reordering the layout. Noted so QA does not file it
  as a defect.
- **Stranded `retrying` rows clear on the same visit** if they are also old: reset (-> `failed`) runs
  immediately before the purge. Phase 1 said "next visit"; the call order makes it the same visit.
- **Stale-tab Retry on a purged row** already returns "Email not found" from `handleTargetedRetry()` (Phase 1
  Flow 2); no work. **Bulk "Retry Failed Emails"** only ever sees rows that survived this page load's purge, so
  it cannot resend a six-month-old failure that this page already removed.
- **Cascade `ON DELETE SET NULL`** nulls `email_queue_id` on `dues_reminders`, `event_announcements`,
  `financial_report_sends`. Verified in SQL (0086, 0096, 0103) and in code that nothing reads the column back.
  Acceptable losses (decided): queue copies of acknowledgment letters and board financial reports; each keeps
  its own durable record (`ledger_acknowledgments.sent_at/sent_via`, `financial_report_sends`).
- **Unresolved `failed` rows are deleted at six months** (decided). The owning table keeps its own
  `success = false` + `error`, and a six-month-old dues reminder must not be retried anyway.
- **Concurrency.** Two admins opening the page at once run two idempotent `DELETE`s; the loser deletes zero
  rows. Next.js prefetch/double render is harmless for the same reason. The `retrying` exclusion is what keeps
  a concurrent retry claim safe.
- **No audit row** (decided; analyst Decision 5). The page note is the discoverability mechanism. The helper
  returns the count, so a future toast or audit line is a one-line addition.
- **Not a durable-claim path.** Deletes only; writes no "sent" claim; never calls `sendEmail()` or
  `sendEmailForDurableClaim()`. The CLAUDE.md durable-claim exception does not apply.
- **PII angle, for the record.** The purge bounds how long message bodies (member-supplied proposal text,
  donor names/amounts, board financials) sit in `email_queue`. It does not touch `google_group_sync_log`
  (B-82) or invisible stranded `pending` rows (B-81).

### Out of Scope

- A "Purge now" button, a configurable retention setting, a cron, or a one-off script (analyst Decisions 1, 2).
- A `/privacy` edit (analyst Decision 6; do not add a "six months" promise the lazy trigger can't strictly keep).
- Purging `dues_reminders`, `event_announcements`, `financial_report_sends` (the real send history).
- Indexes on the three `email_queue_id` FK columns (acknowledged above; revisit at ~10x volume).
- Making stranded `pending` rows visible on the page/badge -> **B-81**.
- Retention for `google_group_sync_log` (member email lists kept forever) -> **B-82**.
- A generic "opportunistic prune" framework. After this change there are three call sites (failed logins, form
  cooldown, email queue) sharing an idiom, not logic; recorded for the 30-day code review, not built.
- Resend delivery webhooks (B-47) and B-74 (retry route unaware of durable claims). Unchanged, though purging
  shortens B-74's exposure window to six months.

### Release-notes entry (write via `/release-notes` at merge; no file lists)

Provisional heading, version assigned at release time because several pipelines are in flight today
(current `package.json` is 1.84.0; this is a user-visible admin behavior change, so a minor bump is the
default, coordinated with whatever the aged-fund and reimbursements pipelines claim first):

> ### Feature: The Email Queue now keeps six months of history
>
> **Value:** The Email Queue page used to keep every message the site had ever sent, including the full text,
> the recipients, and any attached calendar file, indefinitely. It now keeps six months. Older messages, sent or
> failed, are removed automatically the next time an administrator opens the page, and the page says so.
> Nothing that still matters goes with them: dues reminders, event announcements, board financial reports and
> donor acknowledgment letters each keep their own permanent record of whether and when they went out.
> The failed-email count in the sidebar also stops nagging about messages nobody will ever retry, and an empty
> "Recently Sent" list now reads "No emails sent in the last 6 months" instead of implying nothing was ever sent.

### Decisions logged

- **DECISION-107** in `docs/decisions.md` (retention policy, age basis, status policy, page-load vs
  `sendEmail()`, the "deleted at next admin visit" caveat).

## Phase 3 — Technical Design — 2026-10-01

**Owner:** tech-lead
**Status:** complete

### Summary
A 183-day retention purge for `email_queue`, run as a best-effort, try/catch-wrapped `pruneEmailQueue()` on
every load of `/admin/email-queue` after the gate and after `resetStaleRetryingEmails()`. Age is
`COALESCE(sent_at, created_at)`, every status is purged except `retrying`, and the cutoff is an injectable pure
helper. No schema, migration, route, permission, or `sendEmail()` change.

### What I did
- Read the Phase 1 work-log, `src/lib/email-queue-stats.ts`, the email-queue page, the `failed-login.ts` prune
  precedent, the existing `email-queue-stats.test.ts` mock shape, and the three `emailQueueId` FK sites in
  `schema.ts`.
- Compiled the proposed predicate through `PgDialect().sqlToQuery` against the real schema to pin exact SQL and
  confirm the bound-parameter shape (throwaway scratch test, deleted; working tree untouched).
- Logged DECISION-107; filed B-81 and B-82 in `docs/backlog.md`; recorded the Phase 2 skip and the resolved Phase
  1 open questions in this work-log.

### Outputs
- `/Users/cshenso/git/westervillelions/docs/work-log/2026-10-01-email-queue-retention.md` (this file)
- `/Users/cshenso/git/westervillelions/docs/decisions.md` — DECISION-107 (inserted above DECISION-105)
- `/Users/cshenso/git/westervillelions/docs/backlog.md` — B-81, B-82
- No source files changed.

### Open questions / handoff notes
- Use the **full-stack-developer** agent for the whole thing (small and tightly coupled: one server helper, one
  page edit, three comment edits, tests). No database-admin step (no DDL); no api-developer/ux-developer split
  (there is no API contract and no new UI component).
- Deliver all 16 named tests; they are the Phase 4 gate alongside `tsc`, `lint`, `pnpm build:only`.
- Do not implement the "6 months" copy from the constant dynamically; literals are intentional (test 4 is the
  tripwire).
- QA: dev-DB fixture check described above; use `example.invalid` recipients only. Expect the sidebar badge to
  lag by one navigation on the purging visit.
- Do not touch `src/lib/ledger*.ts` or the two sibling work-logs of 2026-10-01.

---

# Phase 4 — Implementation

## Phase 4 — Implementation (full-stack) — 2026-10-01

**Owner:** full-stack-developer
**Status:** complete

### Summary
Implemented the Phase 3 design as written: `EMAIL_QUEUE_RETENTION_DAYS = 183`, pure `emailQueueRetentionCutoff()`
and throwing `pruneEmailQueue()` directly after `resetStaleRetryingEmails()`, the try/catch-wrapped page call
between the reset and the three section queries, the policy note and empty-state copy, three comment-only schema
edits, and all 16 named unit tests. No schema/migration/route/permission change; `sendEmail()` untouched.

### What I did
- `pruneEmailQueue()` uses the exact pinned predicate `status <> 'retrying' AND COALESCE(sent_at, created_at) < $cutoff::timestamp`, cutoff bound as an ISO string. Doc comment carries the page-load rationale, age basis, `retrying` exclusion, naive-timestamp note, single-statement/seq-scan assumptions and the "next admin visit, not at six months" limit.
- Page: import, purge wrapped in try/catch with `console.error("[email-queue] retention purge failed", error)`, policy `<p>` under the subtitle, empty-state copy "No emails sent in the last 6 months."
- `schema.ts`: three comment-only edits (email_queue table note, `event_announcements.emailQueueId`, `financial_report_sends.emailQueueId`), each read fresh and inserted narrowly; the diff of that file is only those comment lines.
- Tests: cutoff x4 + purge x8 appended to `src/lib/email-queue-stats.test.ts` (additive `delete`/`insert` mock; pinned SQL via `PgDialect().sqlToQuery`; a clearly labelled in-test evaluator applies the pinned predicate to fixture rows); page x4 in new `page.test.tsx`.
- Dev-DB check (local `DATABASE_URL` only, never `PROD_DATABASE_URL`): first confirmed zero real rows older than the cutoff, then inserted two `example.invalid` `sent` rows (200 d and 100 d old), loaded `/admin/email-queue` once as the e2e admin. Observed: page 200, policy note rendered, the 200-day row deleted, the 100-day row retained (confirmed by direct query; it is not on the page only because "Recently Sent" shows the latest 20 of 678 dev rows). Then deleted the remaining fixture; dev DB left as found (`blocked_non_production` 460, `sent` 678, `pending` 2, nothing older than the cutoff). The empty-state copy could not be observed in the browser because dev has 678 sent rows; it is covered by page test 16.

### Outputs
- Modified: `src/lib/email-queue-stats.ts`, `src/app/(dashboard)/admin/email-queue/page.tsx`, `src/lib/db/schema.ts` (comments only), `src/lib/email-queue-stats.test.ts`
- Created: `src/app/(dashboard)/admin/email-queue/page.test.tsx`
- No endpoints or server actions added; no schema change, migration, env var or `FEATURES` entry.
- No `package.json` bump, release notes, `decisions.md` or `backlog.md` edits (per instruction).
- Gate: `pnpm exec tsc --noEmit` clean; `pnpm test` 140 files / 2412 tests passed; `pnpm lint` 0 errors (1 pre-existing warning in `budget-context-panel.tsx`, not mine); `pnpm build:only` exit 0 (one earlier run exited 1 while other pipelines were editing; re-run passed).

### Open questions / handoff notes
- No deviation from the design.
- QA: expect the sidebar failed-count badge to lag one navigation on the purging visit. Production's first real purge is on/after 2026-10-13.
- Release-note text is drafted in Phase 3; the release step assigns the version.
- Next agent: qa (Phase 5).

---

# Phase 5 — Verification (qa)

## Phase 5 — Verification — 2026-10-01

**Owner:** qa
**Status:** complete

### Summary
**Verdict: PASS.** The retention purge behaves as designed against the local dev database: one visit to `/admin/email-queue` deleted a 200-day-old `sent`, `failed` and stranded-`retrying` fixture (the `retrying` row was reset to `failed` and purged on the same visit), left a linked `dues_reminders` row intact with `email_queue_id = NULL` and `success`/`error`/`note` unchanged, and rendered the policy note. The diff matches the Phase 3 design exactly, the gate precedes the purge, and a retry on a nonexistent id returns "Email not found". During the run `tsc` and `build:only` failed twice in other pipelines' files (see Gates); both are green on the final tree.

### What I did

**1. Gates** (final tree, after the concurrent pipelines settled)

| Gate | Result | Summary line (verbatim) |
|------|--------|--------------------------|
| `pnpm exec tsc --noEmit` | PASS | exit 0, no output |
| `pnpm test` | PASS | `Test Files  144 passed (144)` / `Tests  2441 passed (2441)` / `Duration  4.14s` |
| `pnpm build:only` | PASS | `✓ Compiled successfully in 848ms` / `✓ Generating static pages using 15 workers (125/125) in 3.3s`; `/admin/email-queue` and `/api/admin/email-queue/retry` both listed as `ƒ` (dynamic) |
| Feature tests only (`email-queue-stats.test.ts` + `page.test.tsx`) | PASS | `Test Files  2 passed (2)` / `Tests  24 passed (24)` |
| `eslint` on the 4 touched files | PASS | no output |

Concurrent-pipeline failures, recorded as **"concurrent pipeline, not this diff"** (not fixed, not mine):
- `tsc` x3 and `build:only` x1 (earlier): `src/app/(dashboard)/admin/ledger/reimbursements/page.tsx` imported the deleted `approve-reimbursement-dialog` and mis-typed `PayReimbursementDialog` props (reimbursements pipeline, mid-edit). Gone on re-run.
- `tsc` + `build:only` once more: `reconciliation/[sessionId]/page.tsx` imported `reconciliation-discard-button`, which a third pipeline (`2026-10-01-discard-reconciliation-session`) had not yet created. File landed; re-run green.
- No error at any point named a file in this feature's diff.
- Test counts moved 140/2412 (Phase 4) -> 144/2441 as other pipelines added tests; the 24 feature tests were green throughout.

**2. Diff review against the design — all confirmed**
- Predicate is exactly `ne(status,"retrying")` AND `COALESCE(sentAt, createdAt) < ${cutoff.toISOString()}::timestamp`; the pinned-SQL test asserts `("email_queue"."status" <> $1 and COALESCE("email_queue"."sent_at", "email_queue"."created_at") < $2::timestamp)` with params `["retrying", "2026-04-13T00:00:00.000Z"]`.
- Cutoff is bound as an ISO string (not a `Date`), computed in JS.
- Page order is `auth()` -> `hasFeature(ADMIN_USERS)` -> `resetStaleRetryingEmails()` -> `try { pruneEmailQueue() } catch { console.error("[email-queue] retention purge failed", error) }` -> section queries. Page test 1 asserts `["reset","prune","select"]`.
- `pruneEmailQueue` has exactly one non-test caller (the page); it contains no `sendEmail` call, only one `db.delete` (test 12).
- `schema.ts`: **identical to HEAD once `//` comments are stripped** (verified by diff). Note the file's diff also contains the reimbursements pipeline's DECISION-106 comment edits (`ledgerReimbursements`); those are likewise comment-only and are not this feature's. This feature's hunks are the three expected ones (`email_queue`, `event_announcements.emailQueueId`, `financial_report_sends.emailQueueId`).
- Coverage: `src/lib/email-queue-stats.ts` 100% statements / 100% branches / 100% functions (13/13, 5/5, 5/5). `events.ts`, `permissions.ts`, `members.ts` untouched by this change; not re-measured.

**3. Dev-server smoke (local `DATABASE_URL` only)**
Preconditions confirmed: `DATABASE_URL` host (`ep-orange-sunset-…`) differs from `PROD_DATABASE_URL` host (`ep-rough-smoke-…`); only `DATABASE_URL` was read by my scripts. Baseline had 0 real rows older than the cutoff, so the purge could not touch real data. Fixtures (recipient `qa-fixture@example.invalid`, subjects `QA-RETENTION-FIXTURE …`): `sent` (sent_at 200 d ago), `failed` (created 200 d ago, sent_at null), `retrying` (created and retrying_at 200 d ago), plus one `dues_reminders` row (fiscal_year 1999) pointing at the old `sent` fixture. One signed-in load of `/admin/email-queue` as the e2e admin:

| Check | Observed |
|-------|----------|
| Page status | 200 |
| Policy note | present, exact copy |
| `sent` 200 d fixture | deleted |
| `failed` 200 d fixture | deleted |
| `retrying` 200 d fixture | **deleted on the same visit** (reset -> `failed`, then purged) — confirms the design's call-order claim, and that the Phase 1 "next visit" assumption was superseded |
| `dues_reminders` fixture | survived; `email_queue_id` = NULL; `success=false`, `error`, `note` unchanged (FK is `confdeltype 'n'`, SET NULL) |
| Real rows | `sent` 678 and `pending` 2 unchanged; `blocked_non_production` went 460 -> 462, attributable to other pipelines' dev activity (not touched by the purge: all are < 183 days old) |
| Empty-state copy | not observable in browser (dev has 678 sent rows); covered by page test 4 |

Cleanup: deleted the `dues_reminders` fixture; 0 `QA-RETENTION-FIXTURE` rows remain in `email_queue`; `dues_reminders` count back to its original 1. Local DB left as found, apart from the other pipelines' rows.

**Sidebar failed-count badge (known behaviour, not a defect).** On the purging visit the badge read `2 failed emails` (the `failed` fixture + the stale `retrying` fixture, both counted by the layout alongside the page render); on the next navigation (`/admin`) there was no badge. This is the one-navigation lag the tech-lead flagged. Note the over-count here was **two**, not "by one" as the design phrased it, because two fixture rows qualified; it is still bounded to one navigation, and it only over-reports.

**360px render** (`email-queue-360.png`, kept in the scratchpad, not the repo; the screenshot shows other pipelines' local dev rows, so it was deliberately not committed). The new policy note wraps cleanly under the subtitle and the "Retry Failed Emails" button is unaffected. Two observations, both **pre-existing and not caused by this diff**:
- The "Not Sent" table is 874 px wide inside an `overflow-hidden rounded-lg` wrapper (the table markup is not in the diff), so at 360 px the columns after "To" are clipped and unreachable. `/admin/sync-log` has no overflow at 360 px, so this is specific to the table markup on this page. Suggest a backlog item (wrap in `overflow-x-auto`); I did not edit `docs/backlog.md`.
- The h1 sits at the same coordinates (top 18, left 72) as on `/admin/sync-log`, i.e. the mobile admin top bar overlapping the heading is shared layout, not this page.

**4. Retry on a nonexistent (purged-equivalent) row.** Signed in as the e2e admin, `POST /api/admin/email-queue/retry` with `{"ids":["<random uuid>"]}` returned HTTP 200 `{"mode":"targeted","retried":1,"succeeded":0,"failed":1,"results":[{"id":"…","success":false,"error":"Email not found"}]}`. No crash, no 404/500. (Only the targeted `ids` form was called; the no-body form is the bulk sender and was never invoked.)

**5. Feature-gate audit**

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `/admin/email-queue` page (`page.tsx`; purge added here) | yes (`redirect("/signin")`) | yes (`redirect("/admin")`), runs **before** the reset and the purge (read lines 14-18 vs 29-36; page test 3 asserts `pruneEmailQueue` not called for either denial) | `FEATURES.ADMIN_USERS` (unchanged; same key as the nav entry and the badge) |
| `POST /api/admin/email-queue/retry` (unchanged by this diff; read-verified because retry-after-purge touches it) | yes (401) | yes (403) | `FEATURES.ADMIN_USERS` |
| New routes / server actions | none added | n/a | n/a |

Not exercised: a signed-in user *lacking* `admin.users` against the live page/route (verified by reading the code and by page test 3, not in a browser).

### Regression / new tests (all delivered by Phase 4; qa added none)
- `src/lib/email-queue-stats.test.ts` — 4 cutoff + 8 purge tests (pinned SQL, strict `<` boundary, `retrying` exclusion, every-status purge, `COALESCE` age basis, count, error propagation, single DELETE).
- `src/app/(dashboard)/admin/email-queue/page.test.tsx` — 4 page tests (call order, swallowed purge failure, gate, copy).
- Not added by me: a Playwright spec. The purge is time-and-DB-state dependent and the e2e suite is serial against a shared DB; the unit/page tests plus the manual fixture smoke above cover it. Full `pnpm test:e2e` was not run (no spec touches this surface).

### Outputs
- `/Users/cshenso/git/westervillelions/docs/work-log/2026-10-01-email-queue-retention.md` (this section + status table)
- No source files changed by qa. No edits to `docs/decisions.md` or `docs/backlog.md`.
- Scratch only (outside the repo): `.../scratchpad/qa-retention/` (db helper, smoke scripts, 360 px screenshot).

### Verified fact vs. theory
- **Established (reproduced):** the purge deletes by the stated predicate, the stranded-`retrying` row clears on the same visit, the FK nulls and preserves the claim-bearing columns, the page renders and shows the note, retry on a missing id degrades to "Email not found", all gates green on the final tree.
- **Believed, not established:** that `blocked_non_production` +2 came from another pipeline's dev activity (consistent with timing and with those rows being < 183 days old, but I did not trace the senders).

### Open questions / handoff notes
- Next agent: **analyst** (Phase 6). Verify against the Phase 1 Acceptance Criteria; criteria 1-6 were exercised here, criterion 5's empty-state copy only via the page test, criterion 7 (styling) by inspection of the diff.
- Phase 6 should record, not block on: the badge over-reports for one navigation on the purging visit; production's first real purge is on/after 2026-10-13.
- Pre-existing, out of scope: `/admin/email-queue` tables clip columns at 360 px (see above) — suggest a backlog item.
- Operational: I started `pnpm dev` (PID 60269 at last check) for the smoke and left it running because another pipeline was using the same dev server; stop it when the other work is done. A shared scratchpad meant another agent overwrote one of my first helper scripts; harmless, scripts were moved to a private subdirectory.

---

# Phase 6 — Shipped vs Intent (analyst)

## Phase 6 — Shipped vs Intent — 2026-10-01

**Owner:** analyst
**Status:** complete

### VERDICT

SHIP WITH NOTES

### ONE-LINE TAKE

> The treasurer's "do we need a purge routine, and do we need more than 6 months?" is answered as agreed: rows older than 183 days are deleted lazily when an admin opens `/admin/email-queue`, the page says so in plain words, and nothing outside that page, `sendEmail()` or `/privacy` changed. The notes are paperwork, not defects.

### What's working

- **The treasurer's question has a real answer on the page itself.** An admin who opens the Email Queue now reads "Email history is kept for 6 months. Older messages are removed automatically when this page is opened." under the subtitle. It names the mechanism ("when this page is opened"), which is the honest form of the lazy-trigger limit, and promises nothing a policy page would have to defend.
- **The purge cannot hurt the page or the send path.** It sits after the `auth()` + `hasFeature(ADMIN_USERS)` gate and after `resetStaleRetryingEmails()`, inside its own try/catch, and `pruneEmailQueue()` has one caller (the page). Page test 3 proves a denied or signed-out user never reaches it; page test 2 proves a rejecting purge still renders all three sections.
- **The risky decisions are pinned by tests, not by prose.** The compiled SQL is asserted verbatim (`status <> $1 AND COALESCE(sent_at, created_at) < $2::timestamp`, params `["retrying", "2026-04-13T00:00:00.000Z"]`); strict `<` at the boundary, `retrying` immunity, all five other statuses, and the COALESCE case that saves a long-stranded failure which was just retried are each their own test. The in-test evaluator is labelled as such and anchored to the pinned SQL, so it cannot silently drift from the real predicate.
- **QA reproduced the interesting case, not just the happy one.** A stranded 200-day `retrying` row was reset to `failed` and purged on the same visit, and a `dues_reminders` row pointing at a purged message survived with `email_queue_id = NULL` and `success`/`error`/`note` unchanged. That is Phase 1 acceptance criterion 3 observed live, not inferred.
- **Scope discipline held.** The diff touches `email-queue-stats.ts`, the one page, three `schema.ts` comments, and tests. No `sendEmail()`, retry route, `FEATURES`, `ADMIN_NAVIGATION`, migration or `/privacy` change (confirmed: `git status` shows no `src/app/privacy` change and the page has no retention wording).

### Does the shipped behaviour answer the treasurer's question? Yes.

| Treasurer asked / Phase 1 agreed | Shipped | Verdict |
|---|---|---|
| "Do we need a purge routine?" Yes, for data minimisation (bodies, recipients, `.ics` attachments kept forever), not performance | Lazy purge on page load; no scheduler, no button, no new route | matches |
| "Not more than 6 months" | `EMAIL_QUEUE_RETENTION_DAYS = 183`; cutoff computed in JS; 2026-10-13 minus 183 days = 2026-04-13, same as the calendar answer | matches |
| Age basis `COALESCE(sent_at, created_at)` | Exactly that, bound as an ISO string with `::timestamp` (a refinement over my Phase 1, which said only "compute in JS"; it avoids local-timezone serialization of a raw `Date`) | matches (acceptable improvement) |
| All statuses except `retrying` | `ne(status, "retrying")` rather than an allow-list, so a future status is purged by default | matches |
| Purge failure never 500s the page | Wrapped at the call site; `console.error("[email-queue] retention purge failed", error)` carries no message content | matches |
| Policy note on the page | Present, exact wording from the design | matches |
| Empty "Recently Sent" copy | "No emails sent in the last 6 months." in the existing `bg-gray-50 rounded-2xl p-10 text-center text-gray-500` container; "No emails sent yet." is gone | matches |
| No `/privacy` promise | No edit; the page has no retention wording; DECISION-107 item 6 records why | matches |
| `retrying` reset-then-purge order | Reset first, so a stranded old `retrying` row clears on the same visit. Phase 1 said "next visit". | acceptable drift (better than intended; confirmed by QA) |
| Schema comment drift (three places) | `email_queue`, `event_announcements.emailQueueId`, `financial_report_sends.emailQueueId` carry the retention note; the three hunks are comment-only (ignoring the reimbursement/ledger-audit comment hunks, which belong to other pipelines) | matches |
| DECISION-107 records the "at next admin visit" caveat | Yes: "The caveat, stated plainly: rows are deleted at the next admin visit after six months, not at six months", plus the badge-lag and first-purge-date consequences, the seq-scan/no-index acknowledgment, and the escalation path | matches |
| B-81 (stranded `pending` invisible) and B-82 (`google_group_sync_log` retains member emails forever) filed | Both present in `docs/backlog.md` with Phase 1's wording and shape, including B-81's caution that a `pending` row may have actually been sent so a blind retry could duplicate delivery | matches |
| Acceptance criterion 6: no change to `sendEmail()`, `sendBulkMemberEmail()`, retry route behaviour, `ADMIN_USERS`, `/privacy` | Confirmed | matches |
| Not a durable-claim path | Deletes only; no `sendEmail*()` call; one `db.delete`, asserted by test 12 | matches |

### QA's observations, and whether they change the verdict

1. **Badge lag on the purging visit: does not change the verdict.** The sidebar badge is computed in the layout alongside the page, so on the one visit that purges old `failed` rows it can still count them and is right on the next navigation. It over-reports, never under-reports, is bounded to one navigation, and was anticipated in Phase 3 and written into DECISION-107. QA observed an over-count of **two** (the design said "by one"); that is only because two fixture rows qualified, and it does not change the analysis. Not a defect and not a follow-up. The one thing worth knowing: the over-count can only occur on a visit that deletes six-month-old failures, so it will be rare in practice.
2. **360px clipping of the "Not Sent" table: does not change the verdict; becomes backlog item B-87.** It is pre-existing, the table markup is not in this diff, and my Phase 1 acceptance criterion 7 covered only styling classes on what this change touched. The new policy note wraps cleanly at 360px and the Retry button is unaffected. But CLAUDE.md says "Mobile-first: ensure all pages are mobile-responsive", and columns after "To" being unreachable on a phone is a real defect for the admin who uses it. Filed as should-do, small. Proposed wording below; I did not edit `docs/backlog.md`.

### Edge cases

| Case | Result | Note |
|---|---|---|
| Empty state | **pass** | "No emails sent in the last 6 months." is accurate after a purge on a quiet club and uses the standard empty-state container. Browser-observed: no (dev has 678 sent rows); covered by page test 4. The other two empty states ("No failed emails ...", "No blocked or unconfigured messages.") remain true after a purge. |
| Failure microcopy | **pass** | A purge failure is invisible to the admin by design (page renders as today; next visit retries; server log only). A stale-tab Retry on a purged row returns "Email not found" (QA reproduced it: HTTP 200, per-row `success: false`, no crash). Terse but human. |
| Permission gate | **pass** | Existing `FEATURES.ADMIN_USERS`, enforced before the purge; page test 3 covers denied and unauthenticated. QA did not exercise a signed-in non-admin in a browser (code read plus the unit test); acceptable. No new route. |
| Mobile (360px) | **pass for this change, fail pre-existing** | The new note and button are fine. The Not Sent table clips (B-87 below). |
| Brand consistency | **pass** | No new buttons or cards; existing classes only; no native dialogs. |
| Adversarial (Pass 5) | **pass** | No redirect targets, no new input, the cutoff is a code constant and cannot be overridden from the URL, and the purge removes data without granting any. |

### Follow-ups (SHIP WITH NOTES)

Each gets its own work-log entry.

1. **B-87 (proposed, for the orchestrator to file; the next free ID is B-87 since B-86 exists).**

   ```markdown
   - [ ] **B-87 — Email Queue tables clip their right-hand columns on a phone.**
     (added 2026-10-01, from Phase 6 of `docs/work-log/2026-10-01-email-queue-retention.md`; pre-existing, found by qa at 360px)
     At 360px the "Not Sent" table on `/admin/email-queue` is about 874px wide inside an `overflow-hidden`
     wrapper, so every column after "To" is cut off and cannot be scrolled to. That hides the status,
     error and the per-row Retry control on a phone. `/admin/sync-log` has no overflow at 360px, so the
     problem is this page's table markup, not the shared layout. The "Failed" and "Recently Sent" tables
     use the same wrapper and almost certainly share it; check all three. Fix shape: wrap each table in
     `overflow-x-auto` (or stack to cards below `sm`), keeping the `rounded-2xl` / existing card styling.
     Separate observation, not part of this item: at 360px the mobile admin top bar sits over the page's
     h1 (same coordinates as `/admin/sync-log`), which is shared layout and would be its own item if
     anyone cares.
     Priority: should-do (small; CLAUDE.md "Mobile-first" gotcha).
   ```

2. **Release-notes entry at release time.** `docs/release-notes/v1.84.md` has no entry for this feature and the Phase 3 draft is not yet written there (`package.json` is already 1.84.1 from another pipeline). The release step writes it from the Phase 3 draft (no file lists) and assigns the version; this is not part of the code and does not block shipping.
3. **Confirm the first real purge on or after 2026-10-13.** Production's oldest sent row is 2026-04-13, so before that the purge correctly deletes nothing. After the first admin visit on or after that date, check that the count of rows older than the cutoff is zero and that `/admin/email-queue` still renders. This is a one-line check, not a defect.

Informational, for the 30-day code review: this is the third opportunistic-prune call site (failed logins, form cooldown, email queue). They share an idiom, not logic; record the count, do not build a framework.

### Red flags

None.

### Outputs
- `/Users/cshenso/git/westervillelions/docs/work-log/2026-10-01-email-queue-retention.md` (this section and the status table)
- No code, `docs/decisions.md` or `docs/backlog.md` edits. B-87 wording is above for the orchestrator to file.

### Open questions / handoff notes
- Orchestrator: file B-87 in `docs/backlog.md` (index line and body) and write the release-notes entry at release; then the pipeline can be treated as closed. The verdict is SHIP WITH NOTES rather than SHIP IT only because of those two tracked items and the post-2026-10-13 check.
- Honest limit to keep in mind (already in DECISION-107): "deleted at the next admin visit after six months, not at six months". If the board ever wants a hard guarantee, that moves the helper into the enqueue path and re-opens Phase 2.
