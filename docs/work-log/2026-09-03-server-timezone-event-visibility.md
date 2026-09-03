# Server timezone (UTC) causes upcoming events to vanish from every events list — Work Log

> **Slug:** `2026-09-03-server-timezone-event-visibility`
> **Surface:** mixed — public homepage, public events list, public event detail, admin events list, admin event detail, member events list, member past-events list, member portal home (birthdays), minutes "next meeting" lookup
> **Permission(s):** none — no permission changes; every touched surface already gates the same way it did before
> **Estimated complexity:** small (one new helper + mechanical call-site swaps), but production-severity
> **Pipeline mode:** Bug-fix variant

This is a distinct, more severe bug from `2026-09-03-homepage-recurring-event-date.md` (which fixed which
*occurrence date* a recurring event's card shows). This bug is about whether an event shows up as upcoming
**at all** — and it affects every events surface in the app, not just the homepage card, and non-recurring
events too.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | (orchestrating session, brief) | Complete | Confirmed real, verified live in production | 2026-09-03 |
| 2 — Architectural review | (orchestrating session, inline — see note below) | Complete | Resolved, not skipped | 2026-09-03 |
| 3 — Technical design | (orchestrating session, brief — folded into the bug report + fix spec) | Complete | Trivial design, documented here | 2026-09-03 |
| 4 — Implementation | api-developer | Complete | typecheck + full test suite + production build all pass | 2026-09-03 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

## Bug Report

**Symptom:** Events later in the same day can silently vanish from every "upcoming events" surface in the
app — homepage, `/events`, `/events/[id]`, `/admin/events`, `/admin/events/[id]`, `/members/events`,
`/members/events/past`, and the "next meeting" lookup used by meeting minutes.

**Confirmed live in production (2026-09-03):** Fetched `https://westervillelions.org/events` at
approximately 3:5x PM Eastern on 2026-09-03 and confirmed today's 7:00 PM "General Meeting"
(`events` row `2ede3b7d-38c6-43f9-b49b-cac84874beba`, `is_public=true`, `is_recurring=false`) was missing
from the list, which jumped straight from the recurring Farmers Market to the October 1 General Meeting —
a same-day event, still hours in the future, was already being treated as past.

**Reproduction (conceptual):** Any event whose Eastern wall-clock start time falls within the
EDT/EST-to-UTC offset window (~4-5 hours) after the current Eastern time, on the current Eastern calendar
day, will read as "already past" on a process running in UTC. E.g. at 3:00 PM Eastern, any event scheduled
for later that day up to ~7:00-8:00 PM (depending on DST) was being excluded.

---

## Root Cause

The DB stores event/occurrence timestamps as **Eastern wall-clock strings** (`timestamp` columns with
Drizzle `mode: "string"`, e.g. `"2026-09-03 19:00:00"` meaning 7:00 PM Eastern — DECISION-005).
`src/lib/events.ts`'s `parseWallClock()` parses such a string into a JS `Date` using *local* calendar/clock
components (via date-fns `parse()`), which only means "7:00 PM Eastern" if the process's own local
timezone happens to be `America/New_York`.

Every page deciding "is this event still upcoming" built `now` the same naive way:

```ts
const now = new Date();
```

then either formatted it for a raw SQL string comparison (`format(now, "yyyy-MM-dd HH:mm:ss")` compared
against `events.startDate`) or passed it straight into `getNextOccurrence(event, now, ...)`, which
internally runs `isAfter`/`isBefore` against `parseWallClock()`-parsed Dates.

`new Date()` always represents the correct absolute instant — but reading it through local-time accessors
(`.getHours()`, `format()`, date-fns comparisons) reflects the **process's own local timezone**, not
Eastern. Vercel's Node runtime defaults to UTC and nothing in this repo pins `TZ`. So in production, `now`
was being read ~4-5 hours ahead of true Eastern wall-clock time — any event later that day, within that
offset window, read as "already past" and vanished.

---

## Phase 2 (architect) — done inline, not skipped

This bug touches DECISION-005's wall-clock invariant, so Phase 2 was not skipped — it's resolved here: the
fix must **not** change how wall-clock strings are stored or parsed (DECISION-005 stays correct exactly as
written). It must fix the one broken assumption: that `new Date()` read through local-time accessors
equals Eastern wall-clock time. That assumption is false whenever the process's local timezone isn't
`America/New_York` — which is exactly Vercel production today.

The chosen fix is a new, explicit, process-timezone-independent helper: "get the current Eastern
wall-clock instant as a Date object using the SAME naive-local-Date convention `parseWallClock()` already
produces." That shape means it drops into every existing `getNextOccurrence(event, now, ...)` /
`format(now, "yyyy-MM-dd HH:mm:ss")` call site as a pure one-line swap, with **zero** changes to any
comparison logic, `getNextOccurrence()` internals, or the wall-clock storage model itself.

This was handled inline by the orchestrating session (rather than a separate architect agent invocation)
because the ruling was narrow, unambiguous, and fully specified before implementation began — there was no
open structural question requiring a second opinion. It is recorded here, not silently skipped, per
CLAUDE.md's Bug-Fix Variant rule ("Skipping a phase requires explicit notation in the work-log").

**Why `Intl.DateTimeFormat` and not a new dependency:** `easternOffsetFor()` in the same file deliberately
avoids `Intl` — but for a different reason (computing a UTC *offset string* via manual DST-boundary math,
for ICS generation, where the existing approach was already correct and tested). `nowEastern()`'s job is
different: reading the *current instant's* true Eastern calendar/clock components. Node ships full ICU
data regardless of `process.env.TZ`, so `Intl.DateTimeFormat` with an explicit `timeZone` option is exactly
the right tool and requires no new package (`date-fns-tz` was explicitly avoided).

---

## Phase 3 (brief) — Fix Spec

**New helper**, `src/lib/events.ts`:

```ts
export function nowEastern(): Date
```

Returns a "naive local" `Date` — its getter methods (`getFullYear`, `getMonth`, `getDate`, `getHours`,
`getMinutes`, `getSeconds`) return the *Eastern* wall-clock date/time for the current instant, in exactly
the same convention `parseWallClock()` produces from a DB string. Implementation: `Intl.DateTimeFormat`
with `timeZone: "America/New_York"` reads the true Eastern year/month/day/hour/minute/second, then
`new Date(year, month - 1, day, hour, minute, second)` constructs the naive-local Date from those
components.

**Call-site fix:** every `const now = new Date();` (or inline `new Date()`) feeding a wall-clock comparison
becomes `const now = nowEastern();` (or `nowEastern()` inline), importing `nowEastern` from `@/lib/events`.
No other line changes at any call site.

---

## Phase 4 — Implementation (API)

**Owner:** api-developer
**Status:** complete

### Summary

Added `nowEastern()` to `src/lib/events.ts` and swapped every wall-clock-comparison call site's
`new Date()` for it. This is a pure logic fix — no schema changes, no new permissions, no UI changes beyond
what already renders correctly once the underlying date query returns the right rows. Typecheck, the full
Vitest suite (1579 tests, including new coverage for `nowEastern()` and a regression test for this exact
bug class), and the production build (`pnpm build:only`) all pass.

### What I did

- Added `nowEastern(): Date` to `src/lib/events.ts` with a doc comment explaining why it exists (process TZ
  ≠ Eastern is not guaranteed) and that it returns a naive-local Date matching `parseWallClock()`'s
  convention, not a real UTC instant.
- Swapped `new Date()` → `nowEastern()` at the 8 confirmed call sites, plus one additional site found during
  implementation (`src/app/events/[id]/page.tsx` has **two** `new Date()` occurrences feeding wall-clock
  comparisons, not one — both were in scope and both were fixed) and the optional `members/page.tsx` site
  (included — cheap and correct).
- Added unit tests for `nowEastern()` in `src/lib/events.test.ts`: EDT case, EST case, a UTC/Eastern
  calendar-date-disagreement case, spring-forward and fall-back DST boundary cases (values verified against
  actual `Intl.DateTimeFormat` output before writing the assertions, not guessed), and a convention-parity
  check against `parseWallClock()`.
- Added a regression test demonstrating the actual bug class: given a fixed "now" instant, a naive
  UTC-read `now` wrongly classifies a same-day upcoming Eastern event as past via `getNextOccurrence()`,
  while `nowEastern()` classifies it correctly. Built to be independent of the test runner's own local
  timezone (see "Testing notes" below).
- Ran `pnpm exec tsc --noEmit`, `pnpm test`, and `pnpm build:only` — all green. Did not assume; actually ran
  each one (per explicit instruction, given a prior implementer's unverified "typecheck passed" claim was
  later found false on this project).

### Outputs

**New export**, `src/lib/events.ts`:
- `nowEastern(): Date` — current Eastern wall-clock instant as a naive-local Date, matching
  `parseWallClock()`'s convention. Doc comment explains the "why" in detail (process TZ guarantee doesn't
  hold, Vercel defaults to UTC, this repo pins no `TZ`).

**Files modified** (import + one-line `new Date()` → `nowEastern()` swap, each with an inline comment
pointing back to the doc comment):
- `src/app/page.tsx` — homepage "Upcoming Events" (`nowStr` + `getNextOccurrence` via `withNextOccurrence`)
- `src/app/events/page.tsx` — public events list
- `src/app/events/[id]/page.tsx` — single event detail; **two** sites: the per-occurrence `isPast: d < now`
  computation inside the RSVP occurrence-row builder (~line 113), and the series-level
  `getNextOccurrence(event, ..., cancelledSetForSeries)` call for the "Add to Calendar" button (~line 193)
- `src/app/(dashboard)/admin/events/page.tsx` — admin events list
- `src/app/(dashboard)/admin/events/[id]/page.tsx` — admin event detail (`isPast: d < now` occurrence
  grouping)
- `src/app/members/events/page.tsx` — member events list
- `src/app/members/events/past/page.tsx` — member past-events list
- `src/lib/minutes-queries.ts` — "next meeting" lookup for minutes (`getMeetingLookup`-style helper,
  ~line 627)
- `src/app/members/page.tsx` — "Birthdays this month" calculation (`currentMonth` / `monthName`); included
  per the task's judgment call — same bug class (current-Eastern-calendar-date decision), cheap and correct
  to fix even though lower severity (only wrong right around a month boundary near midnight Eastern)
- `src/lib/events.ts` — added `nowEastern()` itself
- `src/lib/events.test.ts` — new `describe("nowEastern", ...)` block and a new
  `describe("regression — server timezone event visibility ...", ...)` block

No schema changes. No new `FEATURES` key. No migration.

### Testing notes

The `nowEastern()` unit tests use `vi.useFakeTimers()` / `vi.setSystemTime()` (the pattern already used in
`src/lib/ledger-category-queries.test.ts` and `src/lib/financial-report-queries.test.ts`) to fix the current
instant, then assert Eastern components via `Intl.DateTimeFormat`'s explicit `timeZone` option — which is
itself independent of the test runner's own local timezone / `process.env.TZ`, so these tests are stable in
any CI environment. DST boundary expected values (spring-forward Mar 8 2026, fall-back Nov 1 2026) were
computed and verified by actually running the `Intl.DateTimeFormat` logic in Node before writing the
assertions, not derived by hand — this matched the pattern `easternOffsetFor()`'s own DST tests already use
for boundary cases (`easternOffsetFor` tests the same March 8 / November 1 2026 dates).

The regression test (`describe("regression — server timezone event visibility ...")`) deliberately does
**not** call a real, un-mocked `new Date()` to represent "the bug" — doing so would make the test's outcome
depend on whichever machine/CI runs the suite (on a box whose local TZ happens to already be
`America/New_York`, the "buggy" `new Date()` wouldn't actually reproduce the bug, and the test would give a
false negative). Instead it constructs the "what a UTC-local process's naive-read `new Date()` would look
like" Date deterministically from a fixed instant's *UTC* components, which reproduces the exact defect
regardless of what timezone the test suite itself runs in.

### Verification results

- `pnpm exec tsc --noEmit` — **PASS** (no output, no errors)
- `pnpm test` — **PASS** (83 test files, 1579 tests, all green, including the new `nowEastern` and
  regression suites)
- `pnpm build:only` — **PASS** (full production build completed, full route manifest printed, zero
  errors/warnings in build output)

### Additional finding — flagged, not fixed (needs a human decision)

While auditing all `new Date()` sites near `parseWallClock`/`generateOccurrences`/`getNextOccurrence`
usage, I found one more site that matches this bug's pattern closely but was **not** in the task's
confirmed-scope list, and I did not touch it — flagging per the explicit "flag, don't silently expand
scope" instruction:

**`src/app/api/events/[id]/signup/route.ts`, line 114:**
```ts
if (parsedDate < new Date()) {
  return NextResponse.json({ error: "Cannot sign up for a past occurrence" }, { status: 400 });
}
```
`parsedDate` comes from `new Date(body.occurrenceDate)`, where `body.occurrenceDate` is the ISO string the
client received from `events/[id]/page.tsx`'s `d.toISOString()` (built from a naive-local `Date`
constructed the same way `generateOccurrences()`/`parseWallClock()` build wall-clock Dates). That round
trip is internally consistent (both the ISO-string production and this route's re-parsing happen on the
same process, so `parsedDate`'s local components — read via `format()`/`isValidOccurrence()` elsewhere in
this same handler — correctly recover the original Eastern wall-clock values). But comparing that
wall-clock-convention `parsedDate` against a **plain `new Date()`** (an actual current UTC instant, not run
through the wall-clock convention) reintroduces the same category of mismatch this whole bug-fix addresses:
on a UTC-local process, "now" read this way is several hours ahead of true Eastern time, which could
incorrectly reject a same-day signup for an occurrence that's still hours in the future (the same failure
mode as the homepage bug, just on the RSVP submission path instead of a list-visibility path).

This wasn't in the task's confirmed 8+1 call-site list, and the task's own OUT-OF-SCOPE guidance and
"don't silently expand scope" instruction both point toward flagging rather than fixing it in this same
change. Recommend a follow-up bug-fix work-log entry (or folding into the "broader `new Date()` audit"
follow-up below) to change line 114 to `if (parsedDate < nowEastern())`, with its own regression test
mirroring this one.

### Follow-up — RSVP signup route fixed (orchestrating session, same pass)

The "Additional finding" above was fixed immediately rather than deferred, since it's the exact same
root cause and a one-line change: `src/app/api/events/[id]/signup/route.ts` line 114 changed from
`if (parsedDate < new Date())` to `if (parsedDate < nowEastern())`, importing `nowEastern` from
`@/lib/events`. No dedicated route-level regression test was added — `nowEastern()`'s own correctness
is already covered by `events.test.ts`, and this call site is a direct, one-line application of it with
no new logic. Route-level click-through coverage for this path is a QA follow-up (see below).
Re-verified after this change: `pnpm exec tsc --noEmit`, `pnpm test` (1579 tests), `pnpm build:only` —
all still pass.

### Open questions / handoff notes

- **Next agent: qa** for Phase 5 verification. Suggest qa specifically re-run (or write, if not already
  covered) a manual/click-through check equivalent to the production repro: with the dev server pointed at
  a DB containing a same-day event a few hours out, confirm it now appears on `/`, `/events`,
  `/events/[id]`, `/admin/events`, `/members/events` without needing to fake the system clock — this proves
  the fix end-to-end beyond the unit-level `nowEastern()`/`getNextOccurrence()` coverage already added.
- **Follow-up audit needed** (flagged in the original task, reaffirmed here): the reconciliation, ledger,
  and dues-reminder timestamp sites were deliberately left alone in this fix because they are legitimate
  absolute-instant semantics (`createdAt`/`updatedAt`/session close-reopen timestamps), not wall-clock
  comparisons — but that judgment was made file-by-file during this task, not via an exhaustive repo-wide
  sweep. A future 30-day code or security review pass should confirm every remaining `new Date()` site in
  the codebase (not just the ones checked here) is correctly classified as absolute-instant rather than
  wall-clock-comparison, since this bug class is easy to reintroduce in new code that doesn't know to reach
  for `nowEastern()`.
- **Needs a human/next-agent decision:** the `src/app/api/events/[id]/signup/route.ts` line 114 finding
  above — same bug class, not in original scope, deliberately not fixed here.
- No UI changes were needed — every touched surface already renders whatever rows its query returns
  correctly; the bug was entirely in which rows got selected/classified as upcoming. ux-developer
  involvement is not expected for this fix, but qa's manual click-through should still visually confirm the
  previously-missing event now renders as expected on each surface.
