# Test Coverage Review — 2026-09-25

**Owner:** qa
**Cadence:** 7 days — last run 2026-09-09, this run is 16 days (2.3x) overdue.

## Why this review is different from a routine sweep

Today (2026-09-25) shipped seven releases (v1.78.1 → v1.82.0), took the unit suite from
2032 to 2203 tests, and — via QA's own Phase 5 rigor, not pipeline ceremony — surfaced a
month-long production email outage (2026-08-28 → 2026-09-25, ~34 messages silently lost)
and six instances of one defect shape: **code recording a message as sent when it was
not**. DECISION-102/103 and the Durable-Claim Exception close that specific class for its
two known callers.

The brief for this review was explicit: line coverage on `sendEmail()` looked fine all
along, because the *happy path* was thoroughly tested — the defect lived entirely in the
untested *failure/refusal* path. So this review does not lead with percentages. It leads
with named, ranked, still-untested failure paths, because that is the lesson of today and
the thing a percentage cannot show.

---

## Suite results

### Unit tests — `pnpm test`

**PASS.** 2203/2203, 127 test files, 4.0s. Matches the task brief's expected count exactly.

### Typecheck — `pnpm exec tsc --noEmit`

**PASS.** Clean, no output.

### Production build — `pnpm build:only`

**PASS.** `✓ Compiled successfully`. Route tree unchanged in shape from the prior review's
baseline; no new warnings.

### End-to-end — `pnpm test:e2e`

**PASS.** 186 passed / 1 skipped / 0 failed (187 total), workers: 1 (serial), 9.6 minutes
wall-clock against a freshly started `pnpm dev`. Identical shape to the 2026-09-09 baseline
(186 passed / 0 failed / 1 skipped) — same total, same zero failures, holding the
"reproducible, fully green" property that review closed with. See the fixture-pollution
recheck below for whether that property is durable, not just true today.

**Auth note (flagged by the task brief):** `.env.local`'s `E2E_ADMIN_PASSWORD_HASH` does
**not** match `E2E_ADMIN_PASSWORD` (verified via `bcrypt.compare`), confirming an earlier
agent re-hashed the dev-DB admin user's password today (`users.password` row `updated_at
= 2026-09-25 20:18:06`) without updating the corresponding `.env.local` constant. E2E auth
**worked** for this run because the *database* row was updated to match the *plaintext*
`E2E_ADMIN_PASSWORD` (confirmed by a second `bcrypt.compare` against the live DB value) —
the stale `.env.local` hash was simply never consulted. It becomes a live problem the next
time anyone re-runs `scripts/create-test-user.mjs` (documented in CLAUDE.md as the way to
recreate this user): that script upserts `users.password` from
`E2E_ADMIN_PASSWORD_HASH` unconditionally, and would overwrite today's working password
with a hash that does not match `E2E_ADMIN_PASSWORD`, silently breaking every subsequent
e2e run until someone notices. **Action:** regenerate `E2E_ADMIN_PASSWORD_HASH` from the
current `E2E_ADMIN_PASSWORD` (`bcrypt.hash(E2E_ADMIN_PASSWORD, 10)`) and update
`.env.local` before the next environment reset. Not blocking today's PASS; is a trap for
tomorrow's session.

---

## The central question: what else has no test for its failure path?

Ranked by consequence — a real, currently-shipping failure mode first, then coverage gaps
on code that already knows better.

### 1. HIGH — The generic email-queue retry mechanism has no awareness of any durable-claim table it doesn't own, which can silently re-open the exact double-send risk the claim exists to prevent

**Established by reading code, not reproduced live** (labeled per the fact/theory
discipline this project asks for): `src/app/api/admin/email-queue/retry/route.ts`
(`handleTargetedRetry` / `handleBulkRetry`) operates **exclusively** on `email_queue` rows
filtered by `status = 'failed'`. It has no join to, and no awareness of,
`ledger_acknowledgments`, `financial_report_sends`, `dues_reminders`, or
`event_announcements` — the four tables DECISION-102 names (three by name, one by "any
future equivalent") as durable "this was sent" claims.

Each of those four tables' own write path decides "sent" vs. "not sent" **once, at the
moment of the original send attempt** — `emailAcknowledgmentLetters()` explicitly reverts
`sentAt`/`sentVia` to `null` on any genuine failure specifically so the ack row becomes
re-sendable (its own Test 10, confirmed by reading `ledger-acknowledgment-letter-queries.ts`
lines 635-660). `financialReportSends`' partial unique index only ever covers a
**successful** claim, by design, so a `success:false` row is explicitly re-attemptable
from the app (`financial-report-send.test.ts`: "a retry after a failed send is NOT blocked
by already_sent, because the partial index only covers successful rows").

Neither of those two subsystems' design accounted for a **third actor**: an admin who,
instead of using the feature's own "send again" control, opens `/admin/email-queue` (which
lists every failed message in the system, with no indication of which domain table
references it) and clicks "Retry" on the same underlying row. If that retry succeeds, the
donor or the board **actually receives the message** — `email_queue.status` flips to
`sent` — while the domain table's own claim is untouched: still `sentAt: null` for the ack
row, still `success: false` (permanently, by design) for the financial-report row. A human
looking at the ack-letters or financial-reports admin screen sees "not sent" for a message
that, in fact, already went out. Clicking "send" again from that screen creates a **second**
independent email — the exact double-delivery the atomic claim exists to make impossible,
delivered instead through a side door the claim's own design never considered.

For `dues_reminders` and `event_announcements` (see finding #2) the consequence is milder
but still real: a genuinely-failed reminder or announcement that a later manual retry
successfully delivers leaves the "last reminded"/"already announced" badge permanently
wrong in the opposite direction — understating outreach that did, in fact, happen.

**Why this is invisible to every layer of testing that exists today:** no unit test
constructs "a `failed` `email_queue` row that is also referenced by a durable-claim table,"
retries it, and asserts on the claim table's own state afterward — `retry/route.test.ts`
tests the queue row in isolation; `ledger-acknowledgment-letter-queries.test.ts` and
`financial-report-send.test.ts` each test their own claim logic in isolation. No e2e spec
crosses `/admin/email-queue` with `/admin/ledger/acknowledgments` or
`/admin/ledger/reports`. This is precisely today's own lesson restated one layer up: two
independently well-tested, independently correct pieces of code produce a defect only in
their *interaction* — DECISION-102's defect #4 was a caller misreading its own send
helper's result; this is two callers of the same send helper never being told about each
other.

**The test that would catch it (recommended, not yet written):** an integration-style
test — `emailAcknowledgmentLetters()` sends and the send fails (claim reverts,
`email_queue` row lands `failed`) → call the retry route's `handleTargetedRetry` on that
same `emailQueueId` → mock the second attempt as a Resend success → assert
`ledger_acknowledgments.sentAt` is **still null** (documenting the gap) or, once fixed,
that the retry route updates the claim (closing it). The same shape for
`financial_report_sends`.

**Recommendation:** file as a backlog item (adding as B-74 below) rather than treating as
a QA-owned fix — this is a genuine design question (should the retry route look up and
update linked claims? should claim-bearing `email_queue` rows be excluded from the generic
retry UI entirely and only retryable from their own feature?) that needs a Phase 1, the
same way B-72 (permanent-vs-transient classification) was filed rather than patched inline.

### 2. HIGH — Two pre-existing durable-claim writers were never audited against today's DECISION-102 fix, and read `result.success` directly

`src/app/api/admin/dues/reminders/route.ts` (writes `dues_reminders.success`, the "last
reminded" record) and `src/app/api/admin/events/[id]/announce/route.ts` (writes
`event_announcements.success`, the "already announced" record) both do:

```ts
success: result?.success ?? false,
```

reading straight off `sendBulkMemberEmail()`'s raw per-recipient result — the exact
pre-DECISION-102 pattern. `SendBulkMemberEmailResult`'s per-recipient shape now forwards
`blocked`/`notAttempted` (added today, DECISION-103), which means `success: true` is
returned for a blocked-non-production or no-API-key send, and both routes write that
`true` straight into their durable table. This is not hypothetical for these two features:
`sendBulkMemberEmail()` unconditionally sets `bulk: true` on `shouldBlockNonProductionSend`,
which means **every dev/QA test of dues reminders or event announcements against real
member/board addresses is guaranteed to hit the blocked path** — so the very next time
either feature is manually tested outside production, it will write a false `success: true`
row.

**Why today's own audit missed it — verified, not guessed:** `docs/work-log/
2026-09-25-email-silent-success.md`'s "hunt for a third instance" explicitly traced "every
file touching the `emailQueue` table directly" and concluded `dues/reminders`,
`events/announce`, and (at the time) `financial-report-send.ts` "reference `emailQueueId`
only as a foreign key returned by `sendEmail()`/`sendBulkMemberEmail()`, never writing
`emailQueue.status` themselves" — correctly concluding no *emailQueue.status* defect exists
in those files. That audit was scoped to "who writes `emailQueue.status`," which is the
right question for the `emailQueue`-layer defect (DECISION-102 rule 1). It never asked the
*caller*-layer question (DECISION-102 rule 2) for these two files — only for the two files
already known to have durable claims. **This is not a case for a blanket repeat of the
grep** (checked the two other bulk-sender routes in `src/app/api/admin/ledger/transactions/
route.ts` — board-approval notifications — and they discard `sendBulkMemberEmail()`'s
result entirely, never persisting a `success` field, so the theory does not
overgeneralize); it is exactly two more instances of the *specific* pattern DECISION-102
names, missed because the audit's search term didn't cover them.

**Test coverage of the specific defect:** `src/app/api/admin/dues/reminders/route.ts` has
**no test file at all**. `src/app/api/admin/events/[id]/announce/route.ts` **does** have
`route.test.ts` (18 tests) but every send-outcome test mocks `sendBulkMemberEmail` to
return only `success: true` or `success: false` + `error` — **zero test exercises
`blocked: true` or `notAttempted: true`**, so the exact line that mis-writes the durable
claim has never been asked to prove itself under the one input that breaks it.

**Recommendation:** migrate both routes to `sendBulkMemberEmailForDurableClaim()`
(`src/lib/email-durable-claim.ts`), matching the two callers DECISION-103 already fixed —
the type-level guarantee (`DurableSendOutcome` has no bare `success` field) makes the
exact mistake these two routes make impossible to compile. File as B-73 below. This is
implementer work (api-developer), not something QA patches inline.

### 3. MEDIUM — `members.ts`'s `provisionUserForMember` — the function this project's own standing memory calls a defect when it fails silently — has zero coverage of its error paths, unchanged since at least the 2026-06-24 review

Coverage: `members.ts` 36.84% stmts / 29.41% lines (lines 120-227, i.e.
`provisionUserForMember` itself, entirely uncovered). `members.test.ts` covers only the
pure decision helpers (`shouldProvisionOnMemberCreate/Update`, `resolveJoinDate`,
`isValidMembershipType`) — none of the three branches this agent's own charter names by
name ("happy path, 'user already exists with this email' path, 'user already linked to a
different member' error path") have a unit test. Checked for e2e compensation, per
CLAUDE.md's "DB-bound paths are covered by e2e" allowance: no e2e spec references
"already linked," "already has an account," or `provisionUserForMember` at all — the
compensating claim does not hold.

This matters more than a routine coverage gap because the user's own standing project
memory states plainly: *"Active members without a linked users row are a defect; create
the account, don't fall back to anonymous."* The one function enforcing that invariant has
had its failure paths untested since this review first flagged it (2026-06-24: "members.ts
0% (pre-existing)"), reconfirmed at every subsequent review, and still true today. A silent
regression here (e.g., an error path that swallows the "already linked to a different
member" case and creates a duplicate/orphaned link instead of surfacing it) would violate
that invariant with no automated signal.

**The tests that would catch it:** mock the Drizzle call surface and assert (a) a new
member with no existing user creates one and links it; (b) a member whose email matches an
existing, unlinked user links to that user rather than creating a duplicate; (c) a member
whose email matches a user already linked to a *different* member returns/throws the
"already linked" error and does not silently relink.

### 4. LOW-MEDIUM — Financial-report-send.ts's two validation-guard branches are unexercised, but are pure input rejection, not silent-success risk

Coverage gaps at lines ~575-585 (`invalid_month` when `monthBounds()` throws) and the
`default: throw new Error(...)` exhaustiveness guard at the end of `sendMonthlyReportToBoard`'s
switch. Neither is a "reports success for work not done" shape — both are defensive
rejections that, if they ever fired unexpectedly, would be loud (a thrown error / a 4xx),
not silent. Noted for completeness per the coverage-target list, not ranked with 1-3.

---

## Date-rot finding — confirmed now, not tomorrow

Two distinct "Farmers Market" fixtures both have `recurrence_end_date = 2026-09-26 00:00:00`
— **tomorrow**:

| Event | ID | Used by |
|---|---|---|
| "Visit us at the Westerville Farmers Market" (public) | `882e610b-…` | Production event; also the event at the center of today's `2026-09-25-recurring-occurrence-visibility.md` privacy-leak fix (shipped, commit `4816cd8`) |
| "Farmer's Market Signup" (private, `requiresRsvp: true`) | `291c76f3-…` | `e2e/recurring-signup-rollup.spec.ts`, `e2e/write-in-signups.spec.ts` |

**Mechanism, read directly from `src/app/(dashboard)/admin/events/page.tsx:36-55`:** the
admin events list's default `view=upcoming` filter includes a recurring series only while
`recurrenceEndDate IS NULL OR recurrenceEndDate >= now`. Starting any time after midnight
on 2026-09-26, `recurrence_end_date = '2026-09-26 00:00:00' < now` becomes true, and the
series flips into the `view=past` bucket — **disappearing from the default `/admin/events`
list**.

`e2e/recurring-signup-rollup.spec.ts` navigates to `ADMIN_LIST_URL = "/admin/events"`
(the default upcoming view) three times (lines 166, 188, 280) and asserts rollup counts
for `291c76f3-…` on that page. **Every one of those three assertions will start failing
starting 2026-09-26** — not because the underlying rollup logic is wrong, but because the
event will no longer be listed at all. `e2e/write-in-signups.spec.ts` only navigates
directly to the admin *detail* page by ID (never the list), so it is very likely unaffected
by this specific filter — not independently proven here, since I did not run the suite
past the boundary.

**Confirmed NOT at risk:** `e2e/cancel-occurrence.spec.ts` was already fixed by the
2026-09-09 review to self-seed a private fixture event with a rolling `addDays(new Date(),
7)` window in `beforeAll` and delete it in `afterAll` — verified still present in the spec
file today. That fix holds.

**Recommendation (for the implementer/tech-lead, not fixed here — a test-file edit needs
its own brief pass, and the finding's value is in catching it today):** give
`recurring-signup-rollup.spec.ts` and `write-in-signups.spec.ts` the same treatment
`cancel-occurrence.spec.ts` already got — a self-seeded recurring fixture with a rolling
end date — rather than a fixed 2026 recurrence end date on a shared, real-world-named
fixture event. Filing as part of B-74 (below) is out of scope; recommend a short, dedicated
follow-up before 2026-09-26 rather than folding it into a bigger ticket.

---

## e2e fixture-pollution recheck — is the 2026-09-09 fix still holding?

The 2026-09-09 review closed a cluster of FY2099/2097/2098/2095 sentinel-fiscal-year
fixture pollution with a shared `e2e/helpers/ledger-fixture-cleanup.ts` (`beforeAll` +
`afterAll`, scoped by entity + fiscal year), and reported two **pre-existing** FY2099
budget rows (dated 2026-07-30, outside the helper's scope) as "harmless, worth a one-time
sweep."

**Checked today:** those exact two 2026-07-30 rows are gone. In their place, two
**different** FY2099/Club/activity rows exist (`Event costs`, `Service projects`), both
`created_at = 2026-09-11`. First read as a candidate regression — a fixture surviving 14
days untouched looks exactly like the pattern the 2026-09-09 fix was supposed to close.

**Investigated rather than reported at face value, and retracted:** `Event costs` is
`budget-star-notes.spec.ts`'s own `LANDMINE_CATEGORY`. That suite does **not** use the
shared `ledger-fixture-cleanup.ts` helper — it has its own local `cleanupFixture()`
(`e2e/budget-star-notes.spec.ts:190-238`) which, by explicit design, **never deletes** the
`Event costs` or `Service projects` `ledger_budgets` rows — it resets them in place
(`starred: false, note: null, annualAmountCents: 0`) because a sibling suite,
`ledger-category-management.spec.ts`, needs that row to keep existing (its merge fixture
asserts `budgetLines.total` stays 1). The code comment names this exactly: deleting the row
would break the other suite; resetting its fields is the intended fixture contract between
the two.

Re-querying `updated_at` (not just `created_at`) after today's run confirms the reset fired
during this run: both rows show `updated_at = 2026-09-25`, same session as this review. The
rows are old by `created_at` **on purpose** — they are reset-in-place fixtures, not
leaked-and-forgotten ones. **No regression. This is the 2026-09-09 fix working as
documented**, and the finding is retracted rather than carried forward as an open question
— a `created_at` check alone would have wrongly flagged working code as drifted; checking
`updated_at` and the suite's own cleanup function before concluding pollution is what this
project's "verify a theory against the same-file counter-evidence" discipline is for.

---

## Prior review (2026-09-09) — open-item compliance

| Item | Status |
|---|---|
| Finding #1 (CSP `wasm-unsafe-eval`, HEIC WASM decode) | **Fixed and held** — `receipt-heic-upload.spec.ts` (3 tests) passed in today's full run |
| Findings #2-5 (fixture pollution, budgeting suites) | **Fixed and holding** — verified via `updated_at` timestamps that today's run actually re-ran the reset-in-place cleanup, not just that the suite passed |
| Findings #6-8 (stale regex/URL assertions) | **Fixed and held** — `budgeting-overview-restructure.spec.ts`, `ledger-search.spec.ts` both passed |
| "2 pre-existing FY2099 rows... worth a one-time sweep" | **Done** (rows gone); the two 2026-09-11-dated rows found in their place are a documented, intentional reset-in-place fixture shared with `ledger-category-management.spec.ts`, not new residue — see above |
| "25 inactive `QA E2E Open Balance` categories... bounded, inert" | Not re-checked this cycle — no new evidence either way; not re-verified is not the same as regressed |
| "Treat any e2e failure as a stop from here" | **Held** — today's e2e run is fully green, and this review did not treat any failure as acceptable-to-carry-forward |

---

## Regression tests recommended (not written this cycle — filed as backlog, per the findings' need for a design decision, not a mechanical patch)

- Cross-system retry-vs-durable-claim interaction (finding #1) — needs a Phase 1 on the
  design question before a test can assert the *intended* behavior.
- `dues_reminders`/`event_announcements` blocked/notAttempted mapping (finding #2) — needs
  the migration to `sendBulkMemberEmailForDurableClaim()` first; the regression test is
  then mechanical (mirrors the existing `financial-report-send.test.ts` blocked-send tests).
- `provisionUserForMember` three branches (finding #3) — mechanical, no design question;
  recommend qa or the next implementer add these directly.

## Coverage on named critical modules

- `src/lib/events.ts` — 94.96% stmts / 88% branch (target 90%+ — **met**)
- `src/lib/permissions.ts` — 100% stmts/branch/funcs/lines (target 100% — **met**; note: the
  default `vitest run --coverage` text-table reporter's terminal output did not visibly
  print this file in one intermediate check during this review — verified via the JSON
  summary reporter that this was a display artifact, not a real gap; the underlying number
  is exactly 100%)
- `src/lib/members.ts` — 36.84% stmts / 29.41% lines (target 80%+ — **not met**, see finding #3)
- `src/lib/email-guard.ts`, `email-durable-claim.ts`, `email-send-attempt.ts`,
  `email-queue-stats.ts` — 87.5-100% branch, fully exercised on today's new work, including
  the specific outcome-mapping and stranding-reset logic named in the task brief
- `src/lib/financial-report-send.ts` — 94.26% stmts / 85.86% branch
- `src/lib/ledger-acknowledgment-letter-queries.ts` — 99.28% stmts / 94.11% branch
- Overall pure-TS (`src/lib/**`) — 65.2% stmts / 62.76% branch (below the 70% overall
  target; driven by several 0%-covered DB-query modules explicitly deferred to e2e per
  this project's own convention, not by the modules this review is about)

## Manual-only flows

No manual click-through was required this cycle — every flow in scope (unit-testable
logic, e2e-reachable admin/member flows) was exercised by an automated runner. Google
Group sync, Zeffy, and Resend-live-send remain out of runner reach per the standing
convention; none of today's changes touch those integration boundaries directly (the email
changes all sit behind the deny-by-default guard, which e2e already exercises against a
real non-production `NODE_ENV`).

## Verdict: PASS

Both required automated suites are fully green (2203/2203 unit, 186 passed/1 skipped/0
failed e2e), typecheck and production build are clean, and the two prior-review carry-items that could be
verified are holding. This PASS is **not** a claim that the codebase's failure paths are
now adequately tested — findings #1 and #2 above are live, unaddressed gaps in shipped
code, filed as backlog items B-73/B-74 for a design-and-implementation pass, per this
project's own rule that a design question (not a mechanical fix) gets a Phase 1 before a
patch.

---

## Follow-up — 2026-09-25 (same day, qa): fixed the date-rot finding above

Time-sensitive: this review's own "Date-rot finding" section (above) established that
`e2e/recurring-signup-rollup.spec.ts` would start failing 2026-09-26 — tomorrow, relative
to when this follow-up was written. Fixed same-day rather than left as a dangling
recommendation.

### What changed

`e2e/recurring-signup-rollup.spec.ts` was rewritten (174 insertions / 122 deletions) to
stop depending on the shared, calendar-pinned "Farmer's Market Signup" fixture
(`291c76f3-…`, `recurrence_end_date = 2026-09-26`) entirely, following the same pattern
`cancel-occurrence.spec.ts` adopted on 2026-09-09:

- A top-level `beforeAll` now creates its **own private, RSVP-enabled, weekly-recurring
  event** via `POST /api/admin/events`, with `startDate` and `recurrenceEndDate` computed
  from `addDays(new Date(), …)` at run time — first occurrence 10 days out, series running
  90 days. `afterAll` deletes the event unconditionally (pass or fail); `event_rsvps` and
  `event_occurrence_overrides` cascade-delete with it (schema.ts), so no separate cleanup
  is needed.
- The three occurrence dates the tests exercise (`ROLLUP_DATE_A/B/CANCEL_DATE`) are
  likewise computed relative to the fixture's own `start`, not hardcoded calendar dates.
- `readListAttending()` — previously read the **first** `"✓ N attending"` match anywhere
  in the admin list's `<tbody>`, implicitly assuming the shared fixture was always the
  only (or first-sorted) event with a nonzero RSVP count — is rewritten to locate the
  specific `<tr>` containing this fixture's unique, per-run title
  (`E2E QA Rollup Fixture <timestamp>`) and read its adjacent summary row, returning `0`
  when that row isn't rendered at all (which is what a genuinely zero-RSVP fixture does —
  `EventTableRow` only renders the summary `<tr>` when `total > 0`). This was a necessary
  correction, not a drive-by: a brand-new fixture starts at 0 attending and would sort
  among other recurring events by next-occurrence date, so blind first-match reading would
  have been a strictly *more* fragile choice than what it replaced, undermining the whole
  fix. Because the fixture is now private to the run, several assertions that previously
  used `>=`/`<=` tolerances (to absorb interference from `cancel-occurrence.spec.ts` and
  real member RSVPs on the old shared event) were tightened to exact equality — nothing
  else can touch this event's RSVPs, so the exact count is now the honest assertion.
- `NON_RECURRING_EVENT_ID` (`"Lions Club Meeting"`, `2a68b4c6-…`) was deliberately **left
  as a shared fixture** — see "Sibling sweep" below for why it isn't exposed to this bug.

### Why this cannot rot again

The 2026-06-24 review fixed `cancel-occurrence.spec.ts`'s date rot by bumping the
hardcoded dates forward; it rotted again by 2026-09-09 because a fixed calendar date is,
definitionally, a date the clock will eventually pass. This fix removes that category of
defect rather than deferring it: there is no fixed calendar date left anywhere in
`recurring-signup-rollup.spec.ts` for `nowEastern() >= recurrenceEndDate` to ever become
true against. The fixture's `recurrenceEndDate` is `addDays(<run-time-now>, 100)` every
time the suite runs (10 days to first occurrence + 90-day series window), so it is
mathematically always ~100 days in the future relative to whatever "now" the assertion
runs against, every run, indefinitely. The event is also deleted in `afterAll`, so nothing
persists between runs for a *future* run's clock to catch up to — each run gets a fresh
fixture with a fresh 100-day runway. The only way this class of bug returns is if a future
edit reintroduces a fixed date, which is exactly why this note documents the mechanism
being relied on, not just the current fix.

### Forward-safety — verified directly, not just argued

Per the task brief, I did not want to just assert this is fixed without checking. I could
not simulate "tomorrow" by moving the suite's own fixture forward (it is not proof against
its own future by construction — that's the point), so instead I directly reproduced the
underlying mechanism the review described, against a disposable third fixture, to confirm
both that the bug is real and that the fix's premise (a `recurrenceEndDate` computed
relative to "now" never triggers it) holds:

1. Signed in as the e2e admin and created a private, RSVP-enabled, weekly-recurring event
   via the real `/api/admin/events` route with `recurrenceEndDate: "2026-01-31T00:00"` —
   already in the past relative to the run-time clock (2026-09-25).
2. Loaded `/admin/events` (the default `view=upcoming` list, the same page
   `recurring-signup-rollup.spec.ts` navigates to) and confirmed the fixture's title does
   **not** appear.
3. Loaded `/admin/events?view=past` and confirmed the fixture's title **does** appear
   there instead.
4. Deleted the fixture.

Result: `appears in default (upcoming) view: false`, `appears in past view: true` —
confirming, live against the running dev server (not just by reading the route source),
that a series whose `recurrenceEndDate` has passed drops out of the exact page and view
this suite depends on. Since the rewritten suite's own fixture always has a
`recurrenceEndDate` ~100 days in the future by construction, it can never enter this
`view=past` bucket during a normal run — this is the forward-safety property, established
by reproducing the failure mode directly rather than assumed from reading code alone. This
is **not** the same as running the suite with the system clock advanced past 2026-09-26 —
that was not attempted (would require faking the server's wall clock, which the codebase
gates through `nowEastern()`, not an env var) — but reproducing the exact drop-out/reappear
mechanism against a controlled fixture is the closest safe equivalent, and it confirms the
mechanism the fix relies on behaves exactly as read from the route source.

### Sibling sweep — other date-anchored e2e fixtures/assertions

Grepped `e2e/**/*.ts` for hardcoded 2025-2027 dates and cross-checked every hit against
whether the surrounding test depends on **list/view membership** (the specific mechanism
that rots) or just on a **fixed value rendering correctly regardless of "now"** (which
does not rot):

- **`e2e/write-in-signups.spec.ts`** — hardcodes `WRITE_IN_DATE = "2026-08-15"` against the
  *same* shared `291c76f3-…` series this follow-up just decoupled
  `recurring-signup-rollup.spec.ts` from. Read
  `src/app/(dashboard)/admin/events/[id]/page.tsx`: the detail page queries `events` by
  primary key with no upcoming/past filter, and generates occurrences via
  `generateOccurrences(event, parseWallClock(event.startDate), 520)` — independent of
  "now" entirely (occurrences are enumerated from the series' own start/end window, not
  filtered against the current date; `isPast` per occurrence is a cosmetic flag only, not
  a filter). This suite only ever navigates directly to `/admin/events/[id]` by ID, never
  to the `/admin/events` list. **Confirmed empirically, not just by reading code**: this
  suite ran in the same full-suite pass below and all 7 tests passed today, 41 days after
  its target occurrence date (2026-08-15) — proving the admin detail page's occurrence
  rendering does not care whether the date is past or future. **Not fixed, not at risk**
  from this bug class. It does still share a real, calendar-pinned fixture event across
  specs, which is a separate (milder) coupling concern — noted, not actioned, since it
  isn't the "silently starts failing on a specific date" defect this follow-up targets.
- **`e2e/wall-clock-display.spec.ts`** — hardcodes `EVENT_ID` (the shared "Lions Club
  Meeting" fixture) and asserts its stored `start_date` (`2026-05-21 19:00:00`, already
  four months past) renders as "7:00 PM" and never as a UTC-shifted variant. This is a
  **fixed input → fixed expected output** formatting assertion via the public
  `/events/[id]` detail page — it does not depend on the event being upcoming, in any
  list, or on "now" at all. Cannot rot from the clock advancing. Not at risk.
- **`e2e/minutes-present-count-round-trip.spec.ts`** — hardcodes meeting dates
  (`2026-01-05` … `2026-02-02`) as **input values typed into a form**, not as fixture
  preconditions read back from a filtered list. Minutes have no "upcoming/past" view gate
  in this codebase. Not at risk.
- **`e2e/admin-security.spec.ts`** — its header comment references the shared
  `291c76f3-…` fixture only to explain *why* it forces serial mode (shared-DB contention
  with `cancel-occurrence.spec.ts`/`recurring-signup-rollup.spec.ts`); the suite itself
  creates its own uniquely-timestamped marker rows per test and touches no event fixture.
  Not at risk.
- **`e2e/cancel-occurrence.spec.ts`** — re-confirmed today (not just cited from memory):
  still self-seeds its own rolling-window private fixture in `beforeAll`/`afterAll`,
  exactly as the 2026-09-09 review fixed it. Holding.

**Conclusion: `recurring-signup-rollup.spec.ts` was the only e2e spec exposed to the
list/view-membership date-rot mechanism.** The other hardcoded dates found are either
(a) self-contained input/output formatting assertions that are insensitive to the current
date, or (b) already fixed by the 2026-09-09 remediation. No blanket sweep is warranted —
the theory ("hardcoded dates rot") only applies where the assertion depends on a
date-filtered list, and every other hardcoded-date file in `e2e/` was checked against that
specific criterion, not assumed guilty by pattern-matching on the presence of a date
string.

### Verification

- `pnpm exec tsc --noEmit` — clean, no output.
- `pnpm exec eslint e2e/recurring-signup-rollup.spec.ts` — clean, no output.
- `pnpm test:e2e -- e2e/recurring-signup-rollup.spec.ts` (targeted run, dev server already
  up) — **4 passed** (30.3s).
- Forward-safety mechanism check (see above) — reproduced live against a disposable
  fixture, then deleted.
- **Full suite, run once at the end, per the task brief**: `pnpm test:e2e` —
  **186 passed / 1 skipped / 0 failed** (187 total), 9.2 minutes wall-clock, workers: 1.
  Identical to this review's own baseline earlier today (186/1/0) — **no regression, no
  collateral damage**, including in `e2e/write-in-signups.spec.ts` (shares the old fixture
  ID space but untouched by this change) and in the areas a concurrently-running agent was
  editing (`src/app/api/admin/dues/`, `src/app/api/admin/events/[id]/announce/`) — nothing
  in either area's test coverage failed or flaked in this run.

### Verdict: PASS (follow-up fix)

`e2e/recurring-signup-rollup.spec.ts` no longer depends on any fixed calendar date and
will not rot on 2026-09-26 or any later date. Not committed or pushed — left for review
per instructions.
