# Recurring Occurrence Visibility — Work Log

> **Slug:** `2026-09-25-recurring-occurrence-visibility`
> **Surface:** mixed (public `/events/[id]`, and the shared `src/lib/events.ts` recurrence engine consumed by public listings, member listings, admin, ICS, announcements)
> **Permission(s):** none — no gating changes
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | full-stack-developer (brief) | Done | Bug confirmed real | 2026-09-25 |
| 2 — Architectural review | — | Skipped | No invariants touched | 2026-09-25 |
| 3 — Technical design | full-stack-developer (inline) | Done | Root cause + fix captured below | 2026-09-25 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-09-25 |
| 5 — Verification (1st pass) | qa | Complete | PASS (missed anonymous-payload leak) | 2026-09-25 |
| 6 — Shipped vs intent (1st pass) | analyst | Complete | NEEDS REWORK | 2026-09-25 |
| 4 — Rework | full-stack-developer | Complete | Privacy fix shipped | 2026-09-25 |
| 5 — Verification (re-verification) | qa | Complete | PASS | 2026-09-25 |
| 6 — Shipped vs intent (2nd pass) | analyst | Complete | SHIP WITH NOTES | 2026-09-25 |

**Phase skip notation (required, no silent skips):**
- **Phase 1 (analyst):** Skipped as a separate agent pass. The bug was already investigated and handed to the implementer with root cause, file/line citations, and reproduction shape confirmed against the live symptom (member could not find the Farmers Market signup list the week before the final market). Confirmed real during implementation — see Reproduction below.
- **Phase 2 (architect):** Skipped. No new directories, no new dependencies, no schema change, no permission change. Both fixes are boundary-condition corrections inside existing functions (`src/lib/events.ts`) and a display-only change to an existing client component. No invariant is touched: recurrence data model, auth gating, and the server/client split are all unchanged.
- **Phase 3 (tech-lead):** No separate design doc. Root cause and fix design captured inline in this document (below), per the bug-fix variant's "brief design or skip if trivial" allowance — two files needed a boundary-normalization fix and one page needed its `generateOccurrences` call-site's `from` argument changed to match three other call sites that already did it correctly.

---

## Root Cause

**Defect A — the final occurrence of every recurring series was dropped.**

`recurrenceEndDate` is stored by the admin form as a date only, persisted at midnight
(`00:00:00`). Occurrences, however, inherit the event's start *time* (e.g. `12:30:00` for
the Farmers Market). Two functions in `src/lib/events.ts` compared an occurrence's full
timestamp directly against that midnight boundary:

- `generateOccurrences()` (`windowEnd` computed from `recurrenceEndDate` at line ~333, old code)
- `getNextOccurrence()` → `findNextDayOfWeek()` (`seriesEnd`/`end` param, old lines ~218/298)

For a weekly Saturday 12:30 PM event ending `"2026-09-26 00:00:00"`, the final candidate
`2026-09-26 12:30:00` is `isAfter` the `00:00:00` boundary, so both functions treated the
series as already over on its own last day. All three recurring events in the database had
midnight end times, making this systemic rather than one event's edge case.

Effects: `getNextOccurrence()` returning `null` a week early pushed the whole event from
"Upcoming" to "Past" on `/members/events`, `/events`, and the homepage's featured content,
and disabled its per-occurrence Add-to-Calendar links a week before the event actually ran.

**Defect B — the member-facing event page never rendered past occurrences.**

`src/app/events/[id]/page.tsx` called `generateOccurrences(event, now)`, where `now` is the
current instant. `generateOccurrences()` only walks forward from `max(seriesStart, from)`,
so the instant an occurrence's start time passed, it (and its `OccurrenceRow`, including the
signup roster) disappeared from the page entirely. Three other call sites in the codebase —
the admin RSVP page, the signup API, and the ICS/announcement generators — already pass
`parseWallClock(event.startDate)` (the series start) as `from`, precisely so historical
occurrences stay reachable. `/events/[id]` was the one outlier, and it is also the *only*
page that renders the roster (`/members/events/[id]` is a redirect to it).

The UI already fully implemented `OccurrenceRow.isPast` (dimmed row styling, "Closed" badge)
— that code path was simply unreachable, because past rows were never generated in the first
place. Signee chips were correctly never gated on `isPast`.

## Reproduction Steps (pre-fix)

1. Farmers Market: weekly Saturday, 12:30 PM start, `recurrenceEndDate = 2026-09-26 00:00:00`.
2. On or after 2026-09-19 (the week of the final market, before Sep 26's start time),
   `getNextOccurrence()` returns `null` → the event is filed under "Past" a week early on
   `/members/events` and `/events`.
3. Visit `/events/[id]` any time after an occurrence's start time (e.g. the day after the
   Sep 19 market) — that occurrence and its signee list are gone from the page. There is no
   way to look up who signed up for a market that already happened.

## Fix 1 — date-inclusive series end (`src/lib/events.ts`)

Normalized the `recurrenceEndDate` boundary to end-of-day (`endOfDay()` from `date-fns`) at
both parse sites — `getNextOccurrence()` and `generateOccurrences()` — rather than mutating
stored data (the admin form only ever collects a date, so there's no legitimate mid-day
cutoff to preserve). `findNextDayOfWeek()` needed no direct change: it receives the already
end-of-day-normalized `end` from `getNextOccurrence()`, so normalizing at the one call site
fixes both functions.

## Fix 2 — render past occurrences with their rosters (`src/app/events/[id]/page.tsx` + `src/components/events/occurrence-signup-list.tsx`)

- Changed the page's `generateOccurrences(event, now)` call to
  `generateOccurrences(event, parseWallClock(event.startDate), 520)`, matching the admin
  page and signup API exactly (including the `520`-week cap already used there).
- `OccurrenceSignupList` now splits rows into `upcomingRows` and `pastRows` (by the
  already-computed `row.isPast`). Upcoming rows render as before, at the top. Past rows sit
  behind a collapsed, default-closed disclosure button ("Show N past dates" / "Hide past
  dates", chevron icon, `aria-expanded`, focus ring, `rounded-lg`) so a year-long weekly
  series doesn't dump ~50 rows above the fold. Past rows keep their existing dimmed styling
  and "Closed" badge, and — the entire point of the fix — signee chips still render for past
  dates.
- Signups on past dates remain blocked: the API already independently rejects them
  (`src/app/api/events/[id]/signup/route.ts:115`, `parsedDate < nowEastern()`), and the UI's
  `row.isPast` branch never offers a Sign Up/toggle control, only the "Closed" badge —
  unchanged by this fix.

## Other callers of `generateOccurrences()` / `getNextOccurrence()` — impact review

Every other call site keeps its existing `from`/`now` argument; Fix 1 changes their
*results*, not their call shape, and in every case the change is the intended correction
(a series' final day now correctly reads as "upcoming" instead of "past", and the final
occurrence now appears in generated lists) rather than a new divergence:

- `src/app/page.tsx` (homepage featured events), `src/app/members/events/page.tsx`,
  `src/app/members/events/past/page.tsx`, `src/app/events/page.tsx`,
  `src/app/events/past/page.tsx`, `src/app/(dashboard)/admin/events/page.tsx` — all call
  `getNextOccurrence(event, now, cancelledDates)`. Fixed boundary means an event on its final
  day no longer flips to "Past" a week early. No sitemap entry exists for individual events
  (`src/app/sitemap.ts` has no event routes), so no sitemap impact.
- `src/app/api/admin/events/[id]/announce/route.ts`,
  `src/app/api/events/[id]/ics/route.ts`, `src/lib/event-announcements-queries.ts` — all
  already call `generateOccurrences(event, parseWallClock(event.startDate), 520)` or
  `generateOccurrences(event, now, 520)`. Fix 1 means their occurrence pickers and the public
  ICS feed now correctly include a series' final occurrence, which they were silently
  dropping before. This is a fix, not a regression, for the same underlying reason as Defect A.
- `src/lib/minutes-queries.ts` — uses `getNextOccurrence()` for "next meeting" display;
  benefits identically from the boundary fix.

No caller's behavior changes in a way that contradicts its own documented intent.

---

# Phase 4 — Implementation

## Files Modified

- `src/lib/events.ts` — normalized `recurrenceEndDate` to end-of-day (`endOfDay()`) at the
  two parse sites in `getNextOccurrence()` and `generateOccurrences()`; added `endOfDay` to
  the `date-fns` import.
- `src/app/events/[id]/page.tsx` — changed the recurring-occurrence generation call from
  `generateOccurrences(event, now)` to `generateOccurrences(event, parseWallClock(event.startDate), 520)`.
- `src/components/events/occurrence-signup-list.tsx` — split occurrence rows into
  upcoming (rendered directly) and past (behind a collapsed, default-closed "Show N past
  dates" disclosure); extracted the row markup into a shared `renderRow()` closure to avoid
  duplicating it between the two lists. No behavioral change to signup/cancel logic,
  optimistic updates, or the extra-question flow.
- `src/lib/events.test.ts` — added three regression tests (see below).

## Schema Changes

None.

## Implementer Notes

- Normalizing at the comparison boundary (via `endOfDay()`) rather than touching stored data
  or the admin form was the right call per the investigation: the form only ever collects a
  date, so there's no legitimate mid-day series-end case being papered over.
- Considered adding a `normalizeSeriesEnd()` helper to avoid the two inline `endOfDay(...)`
  calls, but two call sites with a one-line, well-commented normalization didn't meet the
  "≥3 copies" duplication bar in CLAUDE.md's periodic-review guidance — noting here in case a
  third caller of `recurrenceEndDate` parsing appears later, at which point it should become
  a shared helper.
- Refactoring `OccurrenceSignupList`'s per-row JSX into `renderRow()` was necessary to avoid
  literally duplicating ~90 lines of markup between the upcoming list and the collapsed past
  list.

---

## Tests Added (regression discipline: confirmed failing pre-fix, passing post-fix)

All three added to `src/lib/events.test.ts`:

1. **`generateOccurrences` — "includes the final occurrence when recurrenceEndDate falls at
   midnight on that same day"** — uses the exact Farmers Market shape (`baseRecurring`
   fixture: weekly Saturday, 12:30 PM, `recurrenceEndDate: "2026-09-26 00:00:00"`). Asserts
   `2026-09-26` is present in the generated occurrence list.
   - **Pre-fix:** `git stash`'d the implementation changes, ran
     `npx vitest run src/lib/events.test.ts` — failed:
     `expected [ '2026-09-05', '2026-09-12', …(1) ] to include '2026-09-26'`.
   - **Post-fix:** `git stash pop`, reran — passes.

2. **`getNextOccurrence` — "finds the final occurrence when 'now' is on the series' last
   day, before start time"** — same `baseRecurring` fixture, `now = 2026-09-24T12:00:00Z`
   (before the final Saturday's 12:30 PM start). Asserts a non-null result equal to
   `2026-09-26`.
   - **Pre-fix:** failed — `expected null not to be null`.
   - **Post-fix:** passes.

3. **`generateOccurrences` — "includes occurrences before an external 'now' when generated
   from the series start"** — documents the `/events/[id]` fix directly: builds a weekly
   event starting `2026-01-03`, shows that calling `generateOccurrences(event, laterNow, 520)`
   (the old, buggy call shape) excludes the January occurrence, while
   `generateOccurrences(event, parseWallClock(event.startDate), 520)` (the fixed call shape)
   includes it.
   - This test was added after the implementation fix was already in place (it exercises
     `generateOccurrences()`'s existing, correct `from`-window behavior — the defect was in
     the *page's* choice of `from` argument, not in the function). Its value is as a
     regression guard against `/events/[id]` (or any future caller) reverting to passing
     `now` instead of the series start.

Full suite: `npx vitest run src/lib/events.test.ts` → 110/110 passed (up from 107 before
these three were added). `pnpm test` → 2032/2032 passed across all 112 test files.

## Gates

- `pnpm exec tsc --noEmit` — PASS (no output/errors)
- `pnpm build:only` — PASS (production build completed, all routes generated)
- `pnpm test` — PASS (2032/2032)
- No `console.log` in production paths (grep confirmed on the diff)
- No native browser dialogs introduced

---

# Phase 5 — Verification (qa)

**Owner:** qa
**Status:** complete
**Verdict: PASS**

## Summary

Reproduced the original bug independently (not on the implementer's say-so) by stashing the
three implementation files and rerunning the new tests — both boundary-condition tests failed
pre-fix with the exact error text the implementer reported, then passed after restoring the
fix. All four automated gates are green. The manual click-through was driven with a scripted
Playwright session against the running dev server (`.env.local`, `ep-orange-sunset`, dev DB
left untouched at its original midnight `recurrence_end_date` values) rather than by hand,
since every flow in scope was reachable without OAuth/Resend/Givebutter — this is a stronger,
reproducible substitute for a manual pass, not a skip of it. Every item in the click-through
list passed, including the one that matters most: signee chips render on past occurrence
rows for a logged-in member.

## What I did

- Read the work-log's Phase 1–4 sections and root-cause writeup in full before touching
  anything.
- Ran `pnpm exec tsc --noEmit` — clean, no output.
- **Reproduce-then-fix, done independently:**
  - `git stash push -- src/lib/events.ts "src/app/events/[id]/page.tsx" src/components/events/occurrence-signup-list.tsx` (left `src/lib/events.test.ts` — the new tests — unstashed).
  - `npx vitest run src/lib/events.test.ts` against the pre-fix code: **2 of 3 new tests failed**, matching the implementer's report verbatim:
    - `getNextOccurrence > finds the final occurrence when 'now' is on the series' last day, before start time — regression for dropped last occurrence` → `AssertionError: expected null not to be null` (`src/lib/events.test.ts:89`)
    - `generateOccurrences > includes the final occurrence when recurrenceEndDate falls at midnight on that same day — regression for dropped last occurrence` → `AssertionError: expected [ '2026-09-05', '2026-09-12', …(1) ] to include '2026-09-26'` (`src/lib/events.test.ts:327`)
    - The third test (`includes occurrences before an external 'now'…`, line 339) passed even pre-fix, as expected — it documents `generateOccurrences()`'s existing correct `from`-window behavior; the defect it guards against lived in the page's call-site choice of argument, not in the function itself.
  - `git stash pop`, reran the same command: **110/110 passed.**
- Ran `pnpm test`: **2032/2032 passed, 112/112 files.**
- Ran `pnpm build:only`: exit 0, "Compiled successfully", TypeScript check inside the build passed, all 124 routes generated, `/events/[id]` correctly listed dynamic (ƒ).
- Confirmed dev DB state directly (`postgres` client, `.env.local` `DATABASE_URL`, `ep-orange-sunset`): both Farmers Market events still have `recurrence_end_date = 2026-09-26T04:00:00.000Z` (midnight Eastern) — the exact pre-fix data shape, untouched, per the task's instruction not to alter dev data.
- Ran `pnpm dev`, waited for readiness, confirmed migrations replayed idempotently (all `NOTICE: relation "..." already exists, skipping`).
- Drove the click-through with a scripted Playwright session (`@playwright/test`'s `chromium`, using the real credentials sign-in flow via `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` from `.env.local`, the same helper pattern as `e2e/helpers/auth.ts`) against `/events/291c76f3-ab75-4c64-8173-ac285345cfe9`, `/members/events`, and the ICS route. Scratch scripts were written to `scripts/qa_check_tmp*.mjs` and deleted after use; no test files were added to the repo by this step (that's Phase 4's job per CLAUDE.md, already satisfied).
- Killed the dev server when done (`pkill -f "next dev"`).

## Outputs

- `docs/work-log/2026-09-25-recurring-occurrence-visibility.md` — this Phase 5 section, status table row.
- No source files modified. No database writes (read-only `SELECT` to confirm data shape; the one write-shaped attempt was a deliberate negative test against the signup API, which correctly rejected it with no row created).

### Gates

| Gate | Result |
|------|--------|
| `pnpm exec tsc --noEmit` | PASS — no errors |
| `pnpm test` | PASS — 2032/2032, 112/112 files |
| `pnpm build:only` | PASS — exit 0, 124 routes, `/events/[id]` dynamic |
| Dev-server smoke (`.env.local`, `ep-orange-sunset`) | PASS — idempotent migrations, server ready, no startup errors |

### Manual Click-Through (scripted Playwright against real dev server + dev DB)

| # | Flow | Result | Evidence |
|---|------|--------|----------|
| 1a | `/events/[id]` (Farmers Market, logged out) — page loads, upcoming date visible | Pass | HTTP 200; "Sep 26, 2026" present without expanding |
| 1b | `/events/[id]` (logged in) — disclosure collapsed by default, "Show N past dates" | Pass | Button text: "Show 19 past dates"; 0 "Closed" badges visible before click |
| 1c | Expand disclosure → past rows render with "Closed" badge | Pass | 18 "Closed" badges after expand (19th past row is a cancelled occurrence, which correctly shows "Cancelled" instead — see screenshot) |
| 1d | **Signee chips render on past dates** (the point of the fix) | **Pass** | 33 name chips rendered across past rows post-expand (real member names, redacted here — see *PII note* below) — confirmed via `span.rounded-full.bg-lions-blue/10` locator, not text-guessing |
| 1e | Next upcoming date visible without expanding | Pass | "Sat, Sep 26 at 12:30 PM" row rendered above the disclosure |
| 2a | No signup control on past rows | Pass | Only 1 "Sign Up" button on the whole page, before and after expanding 19 past rows — it belongs to the upcoming row |
| 2b | API independently rejects a forced past-date signup | Pass | Direct authenticated `POST /api/events/[id]/signup` with `occurrenceDate: "2026-09-19T16:30:00.000Z"` → `400 {"error":"Cannot sign up for a past occurrence"}` (`src/app/api/events/[id]/signup/route.ts:115`) |
| 3 | `/members/events` — event whose final occurrence falls on its `recurrenceEndDate` day shows under Upcoming, not Past | Pass | Both "Farmer's Market Signup" and "Visit us at the Westerville Farmers Market" appear at body-text offsets 547/… inside the "Upcoming Events" section (offset 176), well before the "Past Events" heading (offset 6117) |
| 4 | Full-series `.ics` download includes the final occurrence | Pass | Authenticated `GET /api/events/[id]/ics` (200) — response body contains `20260926`; 19 `VEVENT` blocks (one occurrence in the 20-date series is a genuine cancelled date, unrelated to this fix, and is correctly excluded from the calendar file) |
| 5 | Mobile at 360px — disclosure and past rows don't overflow | Pass | `document.documentElement.scrollWidth <= clientWidth` both collapsed and expanded; screenshot confirms clean stacked layout, wrapping chips, no clipped content |

Screenshots saved to the session scratchpad (`qa_expanded_loggedin.png`, `qa_members_events.png`, `qa_mobile_360.png`) — not committed to the repo (scratch artifacts, not test fixtures).

**Observation, not a regression:** the dev-mode browser console showed two pre-existing warnings unrelated to any of the three changed files — a dev-only `eval()`/CSP notice (React's own dev-mode debugging aid, "React will never use eval() in production") and a Next.js `<Image>` aspect-ratio warning on `/images/logo-official.png`. Both are unrelated to `src/lib/events.ts`, the event page, or the signup list component, and the production build (which never runs React's dev-mode eval path) completed with zero warnings. Not investigated further — out of scope for this bug fix.

### Regression Tests Added (by the implementer, verified independently per the discipline above)

- `finds the final occurrence when 'now' is on the series' last day, before start time — regression for dropped last occurrence` — `src/lib/events.test.ts:86` — guards against `getNextOccurrence()` misclassifying a series as over on its own final day when `recurrenceEndDate` is stored at midnight.
- `includes the final occurrence when recurrenceEndDate falls at midnight on that same day — regression for dropped last occurrence` — `src/lib/events.test.ts:323` — same boundary bug, in `generateOccurrences()`.
- `includes occurrences before an external 'now' when generated from the series start — regression for hidden past rosters` — `src/lib/events.test.ts:339` — guards against any future caller of `generateOccurrences()` (starting with `/events/[id]`) reverting to `from: now` and silently dropping past occurrences and their rosters.

### Coverage

Not separately measured for this bug-fix pass — `src/lib/events.ts` is already a 90%+-target module under standing coverage policy and gained three targeted tests at the exact boundary that broke; no new modules were introduced. Recommend the next 7-day coverage sweep confirm the module is still at or above 90% rather than re-measuring here.

### Feature-Gate Audit

No protected routes or server actions were added or changed by this bug fix. `src/app/events/[id]/page.tsx` is and remains a public page (no `auth()`/`hasFeature()` gate — unchanged). `src/app/api/events/[id]/signup/route.ts` was not modified; its existing `auth()` check (line ~30) and past-occurrence rejection (line 115) were exercised as read-only verification, not changed. **No protected routes touched.**

## Open questions / handoff notes

- Verdict is **PASS**. Nominating **analyst** for Phase 6 (shipped-vs-intent).
- Flag for the analyst / next session, not a blocker for this verdict: `docs/decisions.md` picked up a new `DECISION-100` entry (financial-report-auto-send feature) during this verification session, from a process outside this conversation — not something this QA pass touched or caused. Worth a sanity check at session start that the three concurrent `2026-09-25-*` work-log slugs (`financial-report-auto-send`, `proposal-board-email`, `recurring-occurrence-visibility`) aren't stepping on each other's files.
- The 19th "past" occurrence in the Farmers Market series is a genuinely cancelled date (renders "Cancelled", correctly excluded from the ICS feed) — unrelated to this fix, noted only so a future reader isn't confused by the 18-vs-19 "Closed" badge count in the click-through table above.

# Phase 6 — Shipped vs Intent (analyst)

**Owner:** analyst
**Status:** complete

## VERDICT: NEEDS REWORK

## One-line take

The two dropped-occurrence bugs are genuinely fixed and the standing "always reach signups" requirement now holds structurally — but the same fix that made past rosters reachable also made a pre-existing hole ship every past and upcoming signee's real name, in plaintext, to every anonymous visitor of a public page, and that is not something a "note" can ride along with.

## Question 4 first, because it's the blocker

**Yes — member names are visible to a logged-out visitor.** Verified directly, not inferred:

I started the dev server against the untouched dev DB and issued a plain, cookie-less `curl` (no session, no auth header) at the public route:

```
curl -s "http://localhost:3000/events/291c76f3-ab75-4c64-8173-ac285345cfe9"
```

The raw HTML response (200, anonymous) contains, in plaintext inside the page's serialized Server→Client Component payload:

```
...\"isPast\":false,\"signees\":[\"<REDACTED MEMBER NAME>\"]...
...\"isPast\":true,\"signees\":[\"<REDACTED>\",\"<REDACTED>\"]...
...\"isPast\":true,\"signees\":[\"<REDACTED>\"]...
```

These are the same real signee names QA's authenticated click-through reported (33 chips across past rows). They are sitting in view-source-visible plaintext for a visitor who never signed in.

> **PII note:** the actual names returned by that anonymous request were redacted from this work-log before commit. This repository is public, and a member name tied to event-signup activity is member activity data, not the governance-context officer name that *No Personal Data in the Repository* permits. The finding is fully reproducible without them: `curl -s http://localhost:3000/events/<recurring-event-id>` and grep the response for `signees`.

**Root cause:** `src/app/events/[id]/page.tsx` builds `signeesByDate` from real RSVP rows (`r.userName ?? r.rsvpName`) unconditionally — no `auth()` check gates this query — and passes the resulting `signees: string[]` on every `OccurrenceRow` as a prop into `<EventPersonalization>`, a Client Component. Next.js serializes every prop crossing that Server→Client boundary into the page's RSC payload, which ships to the browser regardless of session state. `OccurrenceSignupList`'s `{!row.isCancelled && isLoggedIn && row.signees.length > 0 && (...)}` check (line 197) only decides whether the chip is *rendered into the DOM* — it does nothing to prevent the data from being *delivered*. Anonymous visitors don't need to defeat anything; view-source or the Network tab is enough.

**Is this a new bug from this fix, or pre-existing?** Both, and the distinction matters for scoping the rework:
- **Pre-existing:** the `signees` array was already unconditionally embedded for *upcoming* occurrences before today's change — confirmed by the first redacted hit above, which is `isPast:false`. `git diff` on `page.tsx` shows the only change was the `generateOccurrences()` call's `from` argument; the `signeesByDate` construction and the per-row `signees:` assignment are untouched. This leak already shipped to production before this bug-fix session.
- **Materially widened by this fix:** the old call was `generateOccurrences(event, now)` — bounded to the live/upcoming window. The new call is `generateOccurrences(event, parseWallClock(event.startDate), 520)` — walking from the series' start, capped at 520 weeks (~10 years). That is the entire point of Fix 2 (rosters must stay reachable), but its side effect is that the *entire historical roster* of a recurring series — every past signee's name, for the life of the series — is now embedded in the public page's HTML for anonymous visitors, where before only whatever was currently upcoming leaked. QA's own evidence (33 names across 18 past rows for one series) is the exact blast-radius increase, now sitting in plaintext on a public route.

Per the task's own framing, this is a NEEDS REWORK, not a follow-up note.

**Where the fix belongs:** the codebase already has the right pattern next to this exact bug — `/api/events/[id]/viewer-context` computes `isSignedUp` and `userName` session-dependently and is fetched client-side by `<EventPersonalization>` after mount, specifically so the server-rendered baseline can stay cacheable and anonymous-safe (see the doc comment at `page.tsx:78-87` and `viewer-context/route.ts:12-24` — the pattern was designed for exactly this problem, just not applied to `signees`). The fix is to stop embedding real names in the page's server-rendered baseline (ship `signees: []` per occurrence from `page.tsx`, matching the existing signed-out-baseline convention already used for `isSignedUp`) and extend `viewer-context` (or a sibling endpoint) to return the real per-occurrence signee lists only to authenticated requests, merged in client-side the same way `mergedOccurrenceRows` already merges `isSignedUp`. This is an extension of an existing pattern, not a new architecture — appropriately small, but it touches the server/client data boundary, so I'd route it through a brief Phase 3 check (confirm the merge shape covers `/members/events/past` and any other consumer of `OccurrenceRow`) before Phase 4 implementation.

**QA process gap worth naming, not blaming:** QA's click-through row 1a tested "logged out — page loads, upcoming date visible" but checked only that the *date* was visible, not that the payload was free of names. Row 1d (the payload-defining check) was run signed-in only. Recommend the Phase 5 checklist for any feature touching `/events/[id]` add an explicit "curl anonymously, grep the response for a known signee name" step — exactly what caught this here — since a signed-in Playwright session structurally cannot observe what an anonymous session receives.

## What's working

- **Defect A (final-occurrence boundary) is solidly fixed.** `endOfDay()` normalization is correct, minimal, well-tested (three new regression tests, confirmed failing pre-fix / passing post-fix by both the implementer and QA independently), and the reasoning for normalizing at the comparison boundary rather than mutating stored data is sound.
- **The core incident — "I can't find who signed up for a market that already happened" — is fixed for a signed-in member.** `/events/[id]` now generates and renders past occurrence rows, with rosters, from the series start. This is real, verified (33 chips), and is the fix the user asked for.
- **The disclosure control is well-built.** Proper `aria-expanded`, focus ring, `rounded-lg`, chevron icon, keeps the next upcoming date above the fold. Brand-consistent.
- **No regression to the signup/cancel/optimistic-update logic** — the `renderRow()` extraction was a clean refactor, not a behavior change, and QA independently confirmed no signup control appears on past rows and the API still rejects a forced past-date signup server-side.

## Intent-vs-shipped diff

- Phase 1 (bug-fix brief) said: *the final occurrence of a recurring series should count as upcoming through its own last day.* Shipped: exactly this, via `endOfDay()` normalization. **Verdict: matches.**
- Phase 1 said: *a member must be able to find who signed up for a past occurrence.* Shipped: `/events/[id]` now renders past rows with rosters, reachable from `/members/events/past` in two clicks (event title → expand disclosure). **Verdict: matches**, for the signed-in member surface specifically named in the original complaint.
- The user's *broader* standing requirement — "we always need to be able to get to signups" — said nothing about who else can get to them. Shipped: the fix, as implemented, also delivers every past and current signee's real name to anyone, signed in or not, via the public route's page source. **Verdict: regression** (widening of a pre-existing leak, not something Phase 1 asked for or would have approved — no work-log phase considered anonymous exposure at all).

## Edge cases

| Case | Result |
|---|---|
| Empty state (recurring series, truly zero occurrences ever generated) | **Pass, with a wording nit.** `OccurrenceSignupList`'s pre-existing `rows.length === 0` early return (untouched by this fix) renders "No upcoming dates available." inside a proper `bg-gray-50 rounded-2xl` empty-state box — not a bare heading above nothing. The heading above it ("Sign Up for a Date") is real content followed by real (if slightly imprecise, since "upcoming" doesn't quite describe an all-past series) empty-state text. This case is now rarer than before the fix, since a series with *any* history at all now shows a "Show N past dates" disclosure instead of hitting this branch. Not a blocker. |
| Failure microcopy | Not applicable — no new error path introduced by this fix; existing toasts (`"Something went wrong. Please try again."`, 409 "That occurrence is now full.") are untouched. |
| Permission gate | **Fail, for the reason above.** `/events/[id]` is intentionally public with no `auth()`/`hasFeature()` gate on the page itself — that's correct for the page. But the *data* it computes and ships (`signees`) is member PII that should be session-gated the same way `isSignedUp`/`userName` already are, and it isn't. |
| Mobile (360px) | Pass — QA confirmed no horizontal overflow, collapsed and expanded, via `scrollWidth <= clientWidth` plus a screenshot. |
| Brand consistency | Pass — disclosure button uses `rounded-lg`, focus ring, `lions-blue`; past rows keep existing `rounded-2xl` card container and dimmed styling; no `window.confirm` introduced (nothing destructive in this fix). |

## Red flags (NEEDS REWORK)

1. **Member names are served to anonymous, unauthenticated visitors on a public page, in plaintext, in the page's initial HTML.** Confirmed by direct anonymous `curl` against the running dev app (see evidence above), not inferred from reading the render-gate logic. This must be closed before ship: stop embedding real `signees` in `src/app/events/[id]/page.tsx`'s server-rendered baseline; extend the existing `/api/events/[id]/viewer-context` session-dependent-fetch pattern (already used for `isSignedUp`/`userName`) to also carry real per-occurrence signee names, gated on `session?.user?.id`, merged client-side in `EventPersonalization` the same way `mergedOccurrenceRows` already merges `isSignedUp`. This is the single change that has to happen before this can ship — everything else in this bug fix is sound.
2. **This is a pre-existing leak that this fix materially widened**, not a brand-new defect — the `signees` embedding for *upcoming* occurrences already shipped to production before today. That means the rework should fix the leak for upcoming rows too, not just the newly-added past rows, or the fix will still leave live members' names exposed on every public event page with signups enabled. Recommend flagging this as its own security-review item regardless of how the rework proceeds, since it predates this bug-fix session and may already be live in production.
3. **Not a blocker, but worth a design call before re-shipping:** the default-collapsed "Show N past dates" disclosure was the implementer's call, not the user's. For a member whose specific goal is "who signed up for the date that already happened," a default-closed list adds exactly one click and is clearly labeled ("Show 19 past dates"), which is a world away from the original failure (nothing findable at all) — I think the default is defensible as shipped. The one place I'd reconsider it: when a series has **zero upcoming rows** (the whole series is over — exactly the Farmers Market end-of-season case that triggered this bug report), collapsing by default hides the *only* content on the page behind a click, with nothing else visible above it to signal the page isn't broken. Suggest auto-expanding the disclosure when `upcomingRows.length === 0`, since the "don't dump 50 rows above the fold" rationale doesn't apply when there's no fold-worthy upcoming content competing for space. Low-severity, good candidate for a tracked follow-up once the privacy fix ships.

## Loop-back

Returning to **Phase 3/4** (not Phase 1 — the functional intent was correct; this is an implementation gap in how session-dependent data crosses the server/client boundary, using a pattern the codebase already has for the sibling fields on the same object). Suggest: a brief tech-lead check that the `viewer-context` extension covers every `OccurrenceRow` consumer (at minimum `/events/[id]`; confirm `/members/events/past` and any admin/ICS paths don't already have their own, correctly-gated, roster-fetch path — the work-log's "Other callers" section suggests they do, via `auth()`-gated admin pages and per-user ICS generation, but that should be confirmed rather than assumed), then api-developer/full-stack-developer implements the merge, then qa re-verifies with an explicit anonymous-curl-for-names step before the next Phase 6 pass.

## Open questions / handoff notes

- Once the privacy fix ships, Phase 6 should re-run in full — this review is otherwise ready to re-approve everything else in this work-log without re-litigating Defect A or the disclosure UI.
- Recommend logging the pre-existing (upcoming-occurrence) exposure as its own line in the next 30-day security review's PII sweep, independent of whether it's fixed as part of this rework or split out — it was live before this session touched the file.
- No source files were modified by this Phase 6 pass. A local `pnpm dev` server was started read-only against the untouched dev DB solely to issue anonymous `curl` requests for verification, then killed; no writes, no DB mutations, no other files touched.

# Phase 4 — Rework (full-stack) — 2026-09-25

**Owner:** full-stack-developer
**Status:** complete

## Summary

Closed the anonymous signee-name leak identified in Phase 6, for both the newly-widened past-occurrence case and the pre-existing upcoming-occurrence case. `src/app/events/[id]/page.tsx` (a public route with no `auth()` check) no longer computes or embeds any real name into the props it hands to `<EventPersonalization>` — every `OccurrenceRow.signees` and `singleEventSignees` now starts as an empty, signed-out baseline, exactly like the existing `isSignedUp: false` baseline. Real names are now delivered exclusively by `/api/events/[id]/viewer-context`, which already did its own `auth()` check for `isSignedUp`/`userName` and now does the same for a new `signeesByDate` field. A signed-in member's experience is unchanged: `<EventPersonalization>` merges the real roster in client-side, on both past and upcoming rows, the same way it already merged `isSignedUp`.

## Reproduction (confirmed myself before changing anything, per the task instructions)

```
pnpm dev   # started on :3002, port 3000 was in use
curl -s "http://localhost:3002/events/291c76f3-ab75-4c64-8173-ac285345cfe9" | grep -o 'signees[^]]*]'
```

Pre-fix (confirmed by temporarily reverting just the privacy-relevant hunks of `page.tsx` back to the leaky shape, keeping the earlier session's Defect A/B fix intact — see "Tests" below for the exact mechanism): the same class of output QA and the analyst already documented — real names inside `signees":[...]` for both `isPast:true` and `isPast:false` rows. Not re-pasted here; real names must never enter this repo (`No Personal Data in the Repository`).

Post-fix, the identical anonymous curl against the running dev server (same event, same dev DB, untouched):

```
signees\":[]
signees\":[]
... (20 occurrences total, every one empty)
```

Every `signees` array anonymous visitors receive is now empty, confirmed live, not just in a unit test.

## Fix approach

Followed the codebase's existing pattern for exactly this class of problem — `/api/events/[id]/viewer-context`, which already computed `isSignedUp`/`userName` session-dependently for `<EventPersonalization>` to merge in client-side after mount — rather than inventing a second convention:

1. **`src/app/events/[id]/page.tsx`** — removed the `users` join and `userName`/`rsvpName` selection from the RSVP query entirely (data minimization: the anonymous server render no longer even fetches names, not just hides them). `signeesByDate` map construction removed. Every `OccurrenceRow.signees` now hard-codes `[]`; `singleEventSignees` prop is now the literal `[]`. Attendee **counts** (`signedUpCount`/`isFull`) are unchanged — a public, aggregate number was a deliberate, explicit call (see "Anonymous count" below), not a default.
2. **`src/app/api/events/[id]/viewer-context/route.ts`** — added a `signeesByDate: Record<string, string[]>` field. Anonymous requests (`!session?.user?.id`) get `{}` and the route returns before any name-bearing query runs — same discipline as the existing `isLoggedIn: false` early return, never fetch-then-hide. A signed-in request runs a second query (`Promise.all`'d alongside the existing per-user RSVP lookup) selecting every active signup for the event across all members, grouped by occurrence key (`eventRsvps.occurrenceDate ?? "null"`), matching the exact key shape `OccurrenceRow.rsvpKey` and the non-recurring `"null"` key already use.
3. **`src/components/events/event-personalization.tsx`** — `ViewerContext` interface gained `signeesByDate`. `mergedOccurrenceRows` now patches `signees: context.signeesByDate[row.rsvpKey] ?? []` alongside the existing `isSignedUp` patch. The non-recurring `<SingleEventSignup>` call now passes `initialSignees={context?.signeesByDate["null"] ?? singleEventSignees}` (baseline `[]` until context loads, matching the `key={loadKey}` remount pattern already used for every other viewer-dependent prop).
4. **`src/components/events/occurrence-signup-list.tsx`** — no signup/signee logic changed. Folded in the Phase 6 UX note: the past-dates disclosure now defaults **open** when a series has zero upcoming rows (`useState(() => occurrences.length > 0 && occurrences.every((r) => r.isPast))`), so the season-ending case (e.g. the last Farmers Market of the year) doesn't hide the only content on the page behind a click.

## Ruling: anonymous signee **count** is allowed; names are not

Kept `signedUpCount`/`isFull` computed server-side and shown to anonymous visitors — a bare "3 signed up" is the same aggregate number regardless of who's asking, doesn't identify anyone, and is useful context on a public event page ("is this popular / is it full"). Only the roster of **names** is member data and is now exclusively session-gated. This was a deliberate call, not an accidental side effect of the fix — counts were never the leak and nothing about closing the name leak required touching them.

## Other leak-shape check (per the task's explicit ask)

Grepped every consumer of `OccurrenceRow` and every prop `<EventPersonalization>` takes. Only two props ever carried real names: `occurrenceRows[].signees` and `singleEventSignees` — both fixed above. `attachedFilesBaseline` was already correctly scoped (`getPublicAttachedFiles()`, a public-visibility-only query — no member names in that shape). `currentUserName`/`userRsvp`/`isLoggedIn` are the *viewer's own* data, already session-gated, not roster data. No other Server Component on a public route passes `OccurrenceRow` or signee data to a Client Component — `/events/page.tsx` and `/events/past/page.tsx` (the public events list) don't render occurrence rows or signees at all; `/members/events/[id]` is a redirect to this same page, so it inherits the fix. No further leak of this shape found.

## Tests added (regression discipline: confirmed failing pre-fix, passing post-fix)

- **`src/app/events/[id]/page.test.ts`** (new file) — calls the page's default export directly (same technique as `src/app/members/page.test.ts`), mocking `@/lib/db` and `@/lib/club-files-queries`; does **not** mock `@/lib/events`, matching the discipline in `announce/route.test.ts`. Walks the returned React element tree to find the `<EventPersonalization>` element and asserts on its literal props — this is the actual serialization boundary, not an incidental string:
  - *"ships signees: [] on every occurrence row even when real RSVP rows exist, past and upcoming"* — builds a real recurring event (weekly, starting ~100 weeks before the real clock so `generateOccurrences`'s 200-occurrence cap straddles "now" regardless of when the suite runs) with two real RSVP rows carrying a fake test-only name, landing on exact past and upcoming occurrence keys. Asserts every row's `signees` is `[]` and the fake name string appears nowhere in the serialized props.
    - **Pre-fix verification:** rather than stashing the whole (already-mid-rework) `page.tsx`, I hand-reverted just the three privacy-relevant hunks (query join + name selection, `signeesByDate` construction, the two `signees:`/`singleEventSignees` assignments) back to their leaky shape, keeping the earlier session's Defect A/B fix intact — the correct "what Phase 6 actually reviewed" baseline. Reran: **failed** — `expected [ 'Test-Only Signee Name ZzYyXx' ] to deeply equal []`. Restored the fix, reran: **passed**.
  - *"ships singleEventSignees: [] for a non-recurring, requiresRsvp event with a real signup"* — same technique, non-recurring event. **Pre-fix: failed** with the same real-name mismatch. **Post-fix: passed.**
- **`src/app/api/events/[id]/viewer-context/route.test.ts`** (new file) — mocks `@/lib/auth`, `@/lib/db`, `@/lib/club-files-queries`:
  - *"returns signeesByDate: {} and never touches db.select for an anonymous request"* + *"also refuses when auth() resolves a session with no user.id"* — asserts `db.select` is **never called** for an anonymous caller (data minimization, not just hiding), and `signeesByDate` is `{}`.
  - *"returns real signee names grouped by occurrence key, for both a past and an upcoming date"* + *"groups a non-recurring event's signee under the literal "null" key"* — signed-in caller gets the real roster.
  - **Pre-fix verification:** ran against the route as it existed before this rework (`git show HEAD:...`, which predates `signeesByDate` entirely) — **all 4 tests failed** (`expected undefined to deeply equal {...}` / `{}`). Restored the fix: **all 4 passed.**
- Confirmed the three pre-existing occurrence-boundary regression tests from the earlier (Defect A/B) fix in `src/lib/events.test.ts` are untouched and still pass — not weakened.

Full suite: `pnpm test` → **2047/2047 passed, 115/115 files** (up from 2032/112 before this rework's two new test files).

## Gates

- `pnpm exec tsc --noEmit` — PASS, no output.
- `pnpm test` — PASS, 2047/2047.
- `pnpm build:only` — PASS, "Compiled successfully", `/events/[id]` still dynamic (ƒ), `/api/events/[id]/viewer-context` present.
- No `console.log` in any touched file (grep-confirmed).
- No native browser dialogs introduced.
- Mobile-first at 360px: no layout touched by this rework beyond the disclosure's default-open state, which reuses existing markup/classes verified at 360px by the earlier QA pass; not re-verified pixel-by-pixel since no CSS changed.
- Collapsed "Show N past dates" disclosure behavior preserved for the normal (some-upcoming) case; only the zero-upcoming edge case now defaults open, per the Phase 6 note.

## Live verification (beyond the unit tests)

Ran `pnpm dev` against the untouched dev DB (`.env.local`, `ep-orange-sunset`), started on port 3002 since 3000 was in use:

- Anonymous `curl` of the same Farmers Market event Phase 6 flagged: all 20 `signees` arrays in the response are `[]`. Anonymous `curl` of `/api/events/[id]/viewer-context` for the same event: `signeesByDate:{}`.
- Signed-in check via a scripted Playwright session (`E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` from `.env.local`, same credentials-form flow as `e2e/helpers/auth.ts`): signed in, expanded "Show 19 past dates", and confirmed **33 signee chips still render** (`span.rounded-full.bg-lions-blue/10`) — the exact count QA's original click-through reported, confirming no regression to the signed-in experience. Scratch script was written to `scripts/qa_check_privacy_tmp.mjs` and deleted after use; not committed.
- Dev server killed when done. No source files modified by this verification step, no database writes.

## Outputs

- `src/app/events/[id]/page.tsx` — removed member-name query/join and `signeesByDate` construction; `occurrenceRows[].signees` and `singleEventSignees` now always `[]` (signed-out baseline).
- `src/app/api/events/[id]/viewer-context/route.ts` — added `signeesByDate`, gated on `session?.user?.id`, built from a new `Promise.all`'d query over every active signup for the event.
- `src/components/events/event-personalization.tsx` — `ViewerContext.signeesByDate`; merges real names into `mergedOccurrenceRows` and the non-recurring `initialSignees` prop.
- `src/components/events/occurrence-signup-list.tsx` — past-dates disclosure now defaults open when there are zero upcoming rows.
- `src/app/events/[id]/page.test.ts` (new) — anonymous-payload regression tests.
- `src/app/api/events/[id]/viewer-context/route.test.ts` (new) — anonymous-refusal and signed-in-roster tests.
- No schema change. No new `FEATURES` entry. No new env var.

## Open questions / handoff notes

- Nominating **qa** for a fresh Phase 5 pass, with the anonymous-curl-for-names step the analyst's Phase 6 review recommended added to the checklist explicitly (row 1a should now assert payload content, not just that a date is visible).
- After qa's PASS, this should go back to **analyst** for a full Phase 6 re-run — not just a rubber-stamp on the privacy fix, since the original Phase 6 pass approved everything else in this work-log already.
- Flagging again, as the outgoing Phase 6 review asked: the pre-existing (upcoming-occurrence) exposure predates this whole bug-fix session and was live in production before today. Worth its own line in the next 30-day security review regardless of this rework's outcome.
- Did not re-verify the 360px mobile layout pixel-by-pixel since no CSS/markup structure changed beyond the disclosure's default `showPast` value (same conditional render path as before, just a different initial boolean) — recommend qa's click-through still include a quick mobile pass as routine coverage, not because this rework specifically put it at risk.

---

# Phase 5 — Re-Verification (qa) — 2026-09-25

**Owner:** qa
**Status:** complete

## Summary

**Verdict: PASS.** The anonymous signee-name leak Phase 6 found is closed, verified at the
byte level against a live dev server, not inferred from render logic — and this time the
check covers the full response body, not just a `signees:[]` grep. All 18 real signee names
for the affected event were pulled from the dev DB and individually cross-referenced against
the entire anonymous HTML response and the anonymous `viewer-context` JSON response: zero
matches in either. The signed-in experience is unchanged (33 chips across 18 "Closed" past
rows, 1 upcoming row, matching the pre-rework count exactly). The privacy regression tests
were independently re-proven failing-then-passing using a surgical hunk-level revert (not a
full-file stash, which would have also undone the unrelated Defect A/B fix and produced a
misleading failure mode) — all 6 privacy-specific assertions failed against the pre-fix code
with the real leaked name visible in the failure output, then passed after restoring the fix.
The original Defect A/B fix is still intact and unaffected by the rework. The new
zero-upcoming-rows disclosure default was verified by direct code proof (no live example
existed in the dev DB to click through) rather than by additional live evidence — noted as a
gap below, not papered over.

## What I did

1. **Read the full work-log**, including the first Phase 5 pass, the Phase 6 NEEDS REWORK
   finding (anonymous curl leaking signee names), and the Phase 4 rework section, before
   touching anything.
2. **Read the actual diff**, not just the work-log's description of it: `git diff --stat`
   against HEAD, then the full contents of `src/app/events/[id]/page.tsx`,
   `src/app/api/events/[id]/viewer-context/route.ts`,
   `src/components/events/event-personalization.tsx`, and
   `src/components/events/occurrence-signup-list.tsx`. Confirmed by reading the code (not
   trusting the rework's prose) that:
   - `page.tsx`'s RSVP query no longer selects `users.name` or joins `users` at all —
     `signeesByDate` construction is gone entirely, `signees: []` and
     `singleEventSignees={[]}` are hard literals.
   - `viewer-context/route.ts` returns before running the name-bearing `allSignups` query
     when `!session?.user?.id` — the early-return branch is textually before the
     `Promise.all` that includes the roster query, so an anonymous request can't reach it.
   - `event-personalization.tsx` merges `context.signeesByDate[row.rsvpKey] ?? []` into
     `mergedOccurrenceRows` and passes `context?.signeesByDate["null"] ?? singleEventSignees`
     into `SingleEventSignup`'s `initialSignees` prop (confirmed that prop exists and is
     consumed in `single-event-signup.tsx`).
3. **Gates:**
   - `pnpm exec tsc --noEmit` — clean, no output.
   - `pnpm test` — 2047/2047 passed, 115/115 files.
   - `pnpm build:only` — exit 0, "Compiled successfully", 268 route-table lines emitted,
     `/events/[id]` still listed dynamic (ƒ), `/api/events/[id]/viewer-context` present.
4. **Dev DB read (read-only, no writes):** confirmed the same recurring event Phase 6 flagged
   (`291c76f3-ab75-4c64-8173-ac285345cfe9`, "Farmer's Market Signup") still has
   `recurrence_end_date = 2026-09-26T04:00:00.000Z` (midnight Eastern) — the original broken
   pre-fix data shape, untouched, per the task's constraint. Queried `event_rsvps` for that
   event: 33 non-declined signup rows, 18 distinct real names. Saved those 18 names to a
   scratch file **outside the repo** (`/private/tmp/.../scratchpad/qa_grep_names.txt`) to use
   purely as grep targets — never written into any repo file, per the absolute constraint.
5. **Byte-level anonymous check (the check whose absence caused the miss last time):**
   - Started `pnpm dev` against the untouched dev DB.
   - `curl` with an explicitly empty cookie jar against
     `http://localhost:3000/events/291c76f3-ab75-4c64-8173-ac285345cfe9` — saved the full
     79,146-byte response body.
   - Counted every occurrence of the literal substring `signees` in the body (not just
     matching lines): **20** — one per occurrence row (19 past + 1 upcoming) plus
     `singleEventSignees`, all `[]`.
   - Confirmed 1 upcoming (`isPast":false`) and 19 past (`isPast":true`) rows are present in
     the payload — i.e., the page still generates the full historical roster shape (Defect B
     fix intact), it's just empty of names.
   - **Cross-referenced all 18 real signee names individually against the entire response
     body** with `grep -F` per name, not a single combined pattern — **zero matches**. This is
     the check the first Phase 5 pass never ran (it grepped for `signees` matching an empty
     array shape, but never checked whether a name could ride along in a different field).
   - Repeated the same check against `GET /api/events/[id]/viewer-context` with no cookie:
     `{"isLoggedIn":false,"userName":null,"signedUpDates":[],"userRsvp":null,"attachedFiles":[],"signeesByDate":{}}`
     — `signeesByDate: {}`, and no other field carries a count, roster size, or anything that
     could identify who signed up. Zero name matches.
6. **Signed-in confirmation (feature not broken by the fix):** signed in through the real
   credentials form (Playwright/chromium, `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` from
   `.env.local`, same helper pattern as `e2e/helpers/auth.ts`), visited the same event page:
   - Disclosure button read "Show 19 past dates" with `aria-expanded="false"` before
     interaction — 1 chip visible (the single upcoming row's signee).
   - After clicking: `aria-expanded="true"`, **33 signee chips** rendered
     (`span.rounded-full.bg-lions-blue/10`), **18** "Closed" badges (the 19th past row is the
     pre-existing cancelled occurrence, correctly excluded), **1** "Sign Up" button (belongs to
     the sole upcoming row). This is the exact count the original Phase 5 pass and the
     rework's own live check both reported — confirmed independently a third time, on a freshly
     restarted dev server, not copied from either prior report.
7. **Original bug (Defect A/B) still fixed, dev data still untouched:** re-confirmed via the DB
   read in step 4 (midnight `recurrence_end_date` value unchanged) and via
   `npx vitest run src/lib/events.test.ts` — 110/110 passed, including the three
   boundary-condition regression tests from the first implementation pass.
8. **New disclosure behavior — mixed verification:**
   - **Default-CLOSED with upcoming rows present:** confirmed live (step 6 above — "Show 19
     past dates" starts collapsed for this series, which has exactly 1 upcoming row).
   - **Default-OPEN with zero upcoming rows:** **no live example exists in the current dev
     DB** — all three recurring events (`291c76f3…`, `882e610b…`, and an e2e fixture series)
     still have at least one occurrence on or after today (2026-09-25). Rather than fabricate
     DB state (forbidden — no writes) or claim untested behavior as verified, I verified this
     by direct code proof: `occurrence-signup-list.tsx`'s `showPast` initializer
     (`occurrences.length > 0 && occurrences.every((r) => r.isPast)`) and its `upcomingRows`
     filter (`rows.filter((r) => !r.isPast)`) both partition on the identical `r.isPast`
     predicate — so `occurrences.every(isPast)` being true is logically equivalent to
     `upcomingRows.length === 0` by construction, not by coincidence. This is a sound proof for
     a two-line boolean, but it is **code-reading verification, not click-through evidence**,
     and I'm flagging that distinction rather than presenting it as something I clicked and saw.
9. **Mobile 360px:** signed-in Playwright session at a 360×800 viewport on the same event page.
   `document.documentElement.scrollWidth <= clientWidth` both before and after expanding the
   disclosure — no horizontal overflow in either state.
10. **Regression discipline — tests genuinely fail pre-fix, re-proven independently:**
    - First attempt: `git stash push` on the three privacy-fix source files reverted them
      fully to HEAD, which also undid the *unrelated* Defect A/B fix bundled in the same
      files (`page.tsx`'s `generateOccurrences` call reverted to the old `(event, now)` shape).
      This produced a **misleading** failure: the test failed on its own precondition check
      (`occurrenceRows.some(isPast)` was `false`, because no past rows were generated at all
      under the old call shape) rather than on the actual privacy assertion. Popped the stash
      immediately rather than accept a technically-failing-but-wrong-reason result.
    - Redid it as a **surgical hunk-level revert**, hand-editing `page.tsx` and
      `viewer-context/route.ts` back to exactly their pre-privacy-rework shape (restored the
      `users` join, the `signeesByDate` map construction and `.get()` lookups, the real
      `signees`/`singleEventSignees` values) while leaving the Defect A/B fix
      (`generateOccurrences(event, parseWallClock(event.startDate), 520)`) untouched — this is
      the same technique the rework's own author used for the same reason.
    - First attempt at the surgical revert had a scoping bug of my own (declared
      `signeesByDate` inside the `if (event.requiresRsvp)` block instead of at function scope,
      where the original code had it, causing a `ReferenceError` in one test) — caught by the
      test run itself, fixed, reran.
    - **Result: 6 of 7 new privacy tests failed** against the corrected pre-fix state, with the
      real (test-fixture, non-member) fake name visibly present in the failure diffs
      (`expected [ 'Test-Only Signee Name ZzYyXx' ] to deeply equal []`, and equivalent
      `signeesByDate` mismatches in the route test) — the 1 passing test is unrelated to the
      privacy assertion.
    - Restored both files from a pre-edit backup, confirmed byte-for-byte via `git diff --stat`
      that the diff matched its pre-experiment shape exactly (73 lines changed across the two
      files, same as before the revert), then reran: **7/7 passed**, and the full suite
      (`pnpm test`) came back **2047/2047** — confirming the restore didn't leave any stray
      edits behind.
11. **Other leak-shape check, independently repeated:** grepped every prop passed to
    `<EventPersonalization>` in `page.tsx` and every field on `ViewerContext` in
    `event-personalization.tsx`. Only `occurrenceRows[].signees` and `singleEventSignees` ever
    carried names; both are now hard-coded `[]` in the page's server render. `attachedFiles`
    baseline uses `getPublicAttachedFiles()` (no member data). No other Server→Client boundary
    in this file passes roster data. Confirms the rework's own "Other leak-shape check" section
    rather than just re-reading it.
12. **Cleanup:** dev server killed (`pkill -f "next dev"`), one accidental crash mid-session
    (from an intermediate invalid edit during the stash experiment) diagnosed and restarted
    cleanly — re-ran the byte-level and signed-in checks again post-restart to confirm the
    crash/restart didn't change the result. Scratch scripts (`scripts/qa_reverify_tmp.mjs`,
    `scripts/qa_reverify_mobile_tmp.mjs`) were written temporarily into `scripts/` (Playwright
    couldn't resolve `@playwright/test` from outside the repo's `node_modules`), used, and
    deleted; `git status --short` confirmed the working tree at the end has no scratch files
    and the same 9-modified/6-untracked-file shape it had at the start of this session.

## Outputs

- `docs/work-log/2026-09-25-recurring-occurrence-visibility.md` — this Phase 5 re-verification
  section and the updated status table.
- No source files modified (net). No database writes (read-only `SELECT`s only). No commits,
  no pushes.

### Gates

| Gate | Result |
|------|--------|
| `pnpm exec tsc --noEmit` | PASS — no errors |
| `pnpm test` | PASS — 2047/2047, 115/115 files |
| `pnpm build:only` | PASS — exit 0, "Compiled successfully", 268 route-table lines, `/events/[id]` dynamic, `/api/events/[id]/viewer-context` present |
| Dev-server smoke (`.env.local`, `ep-orange-sunset`) | PASS — idempotent migrations, server ready (after one clean restart following a mid-session crash caused by my own temporary edit, not the feature code) |

### Byte-Level Anonymous Evidence (redacted per the absolute constraint)

| Check | Result |
|---|---|
| Anonymous `GET /events/[id]` full response body (79,146 bytes) | 20 `signees`-shaped fields, all `[]`; zero of 18 real signee names (pulled read-only from the dev DB) found anywhere in the body |
| Anonymous `GET /api/events/[id]/viewer-context` | `{"isLoggedIn":false,...,"signeesByDate":{}}` — no name, no roster-size field of any kind |
| Both past (19) and upcoming (1) occurrence rows present in the anonymous payload | Confirmed via `isPast` count — the historical-roster *shape* (Defect B fix) is intact; it's the *names* that are now empty, not the rows themselves |

### Signed-In Confirmation

| Check | Result |
|---|---|
| Disclosure default state (1 upcoming row present) | Collapsed, "Show 19 past dates", `aria-expanded="false"` |
| Chips after expanding | **33**, matching both prior reports exactly |
| "Closed" badges | 18 (19th past row is the pre-existing cancelled occurrence) |
| "Sign Up" buttons | 1 (the sole upcoming row) |
| Mobile 360px, collapsed and expanded | No horizontal overflow (`scrollWidth <= clientWidth` both states) |

### Regression Test Re-Proof (independent, corrected methodology)

- Naive full-file `git stash` produced a **misleading** pre-fix failure (wrong precondition,
  not the security assertion) because it also reverted the unrelated Defect A/B fix bundled in
  the same files — discarded, not reported as evidence.
- Surgical hunk-level revert (matching the rework author's own technique) reproduced the
  correct signal: **6/6 privacy-specific tests failed** pre-fix with the real leaked test name
  visible in the diff output; **7/7 passed** post-restore. Full suite reconfirmed green
  (2047/2047) after restoring, with a byte-identical `git diff --stat` to the pre-experiment
  state.
- `src/lib/events.test.ts` (Defect A/B regressions, untouched by this rework) — 110/110 still
  passing, confirming the rework didn't weaken the earlier fix.

### Regression Tests Added (by the implementer during the Phase 4 rework, re-verified independently here)

- `ships signees: [] on every occurrence row even when real RSVP rows exist, past and upcoming` — `src/app/events/[id]/page.test.ts` — guards against the page's server render ever again embedding real names into a `<Client Component>` prop.
- `ships singleEventSignees: [] for a non-recurring, requiresRsvp event with a real signup` — `src/app/events/[id]/page.test.ts` — same guard for the non-recurring path.
- `returns signeesByDate: {} and never touches db.select for an anonymous request` — `src/app/api/events/[id]/viewer-context/route.test.ts` — guards against both the *value* leaking and the roster query ever running for an unauthenticated caller (data minimization, not just response filtering).
- `also refuses when auth() resolves a session with no user.id` — `src/app/api/events/[id]/viewer-context/route.test.ts` — guards the same boundary condition the earlier Batch-2 pattern already used for `isLoggedIn`.
- `returns real signee names grouped by occurrence key, for both a past and an upcoming date` / `groups a non-recurring event's signee under the literal "null" key` — `src/app/api/events/[id]/viewer-context/route.test.ts` — confirm the signed-in path still delivers the real roster correctly keyed.

### Coverage

Not separately re-measured; two new test files were added targeting the exact
Server→Client serialization boundary that leaked, which is the coverage that matters for this
defect class. Recommend the next 7-day coverage sweep include
`src/app/events/[id]/page.tsx` and `src/app/api/events/[id]/viewer-context/route.ts` in its
scan given this history.

### Feature-Gate Audit

No `FEATURES.*`-gated route or server action was added or changed. `/events/[id]` remains
intentionally public (no `auth()`/`hasFeature()` gate on the page itself — correct, unchanged).
`/api/events/[id]/viewer-context` is also intentionally ungated by `hasFeature()` — it's not a
permission boundary, it's a session-presence boundary (`session?.user?.id`), which is the
correct mechanism here: every signed-in member, regardless of role/feature grants, is entitled
to see who else signed up for a club event they can also sign up for. This is data
minimization, not a permission gate, and applying a `FEATURES.*` check here would be the wrong
tool — noting explicitly so a future auditor doesn't flag its absence as a gap.

**No protected (`FEATURES.*`-gated) routes touched.**

## Process note for the record

The first Phase 5 pass's click-through row 1a checked only that the logged-out page *loaded*
and a date was *visible* — it never inspected payload bytes. This pass's step 5 (byte-level
anonymous check, cross-referencing every real name individually rather than pattern-matching
a single field) is now the standard I'd apply to any future feature touching a public page
that also renders session-dependent data — noting this here so it isn't lost, in addition to
whatever process update tech-lead/analyst make of it at the next retrospective.

## Open questions / handoff notes

- **Verdict is PASS.** Nominating **analyst** for a fresh Phase 6 pass.
- **Gap, not a blocker:** the "disclosure defaults open when a series has zero upcoming rows"
  behavior was verified by code proof only, not a live click-through — no recurring event in
  the dev DB currently has zero upcoming occurrences. If a fully-elapsed recurring series shows
  up in dev data later (or synthetic fixture data becomes acceptable for this kind of
  no-write-required client check), worth a quick live confirmation as routine coverage rather
  than urgency.
- Reconfirming the two items the first Phase 6 review asked to be carried forward regardless of
  this pass's outcome: (1) the *upcoming*-occurrence name exposure was live in production
  before this whole work-log's session started and predates this bug fix — still worth its own
  line in the next 30-day security review; (2) no source files were left modified by this
  QA session — `git status --short` matches the pre-session state exactly (same 9 modified /
  6 untracked files).

---

# Phase 6 — Shipped vs Intent (analyst) — SECOND PASS — 2026-09-25

**Owner:** analyst
**Status:** complete

## VERDICT: SHIP WITH NOTES

## One-line take

The leak I blocked on is closed by construction, not by hiding — I re-read `page.tsx`, `viewer-context/route.ts`, and `event-personalization.tsx` myself rather than taking QA's word for it — and the original user complaint is durably fixed for the signed-in surfaces that matter; what remains are three real but non-blocking gaps (a narrower auth-boundary question the rework didn't ask, an unaddressed loading-state flash on the exact feature the user complained about, and one unexercised edge case that resolves itself tomorrow) that belong in the backlog, not in another rework loop, given that today's real risk is the clock on the still-unpatched-in-production leak, not any residual issue in this diff.

## 1. Is the leak actually closed?

**Yes, for the mechanism, not just the symptom.** I did not rely on QA's report — I read the three files directly:

- `src/app/events/[id]/page.tsx`: the RSVP query (lines 108–115) selects only `occurrenceDate` and `guestCount`, no `users` join, no name column at all. `occurrenceRows[].signees` is a hard-coded `[]` literal (line 183), and `singleEventSignees={[]}` (line 346) is a literal, not a variable — the non-recurring path was fixed too, matching the rework's claim. This is data minimization: the query that would leak simply no longer runs, so there's no "forgot to filter" failure mode available.
- `src/app/api/events/[id]/viewer-context/route.ts`: the `!session?.user?.id` branch (line 45) returns `signeesByDate: {}` textually before the `Promise.all` that includes the name-bearing `allSignups` query (line 56) — an anonymous request cannot reach that query, not just receive a filtered result from it.
- `src/components/events/event-personalization.tsx`: `signeesByDate` only ever arrives via `context`, which is `null` until the client fetch resolves; `mergedOccurrenceRows` and the `SingleEventSignup` `initialSignees` prop both fall back to `[]`/the baseline when `context` is null.

**Residual paths, checked per the task's explicit ask:**

- `singleEventSignees` / non-recurring path — **fixed**, confirmed above, not just claimed.
- `signedUpCount` / `isFull` aggregates — deliberately still public and computed server-side (`page.tsx` lines 167, 175, 179). I agree with the rework's ruling that a bare count is not a name leak. Your own question flags the one case where this stops being fully true: **a roster of one**, where `signedUpCount: 1` combines with public knowledge (e.g., someone posts on the club's own Facebook page "I'll be there Saturday") to let a viewer infer identity by elimination. This is a real, narrow inference channel, but it is inherent to *any* public attendance counter on any event site, is not something this bug-fix session introduced or widened, and gating counts behind auth would break the "is this event full / popular" utility the ruling correctly identified as legitimate public information. Not a blocker — a one-sentence acknowledgment, per your framing, not a finding that changes the verdict.
- **A gap the rework and QA did not test for, that I want to name explicitly:** `viewer-context`'s gate is `!session?.user?.id` — session *presence*, not `memberId`, not `hasFeature()`. I checked whether that gate is as narrow as the rework's own comment claims ("every signed-in member... is entitled to see"). It is not quite: `src/app/api/auth/register/route.ts` correctly requires a matching active `members` row before a password account can be created (line 46–55), so that path is closed to a random visitor. But `src/lib/auth/index.ts`'s Google OAuth `signIn` callback (lines 107–125) allows sign-in for **any** Google account on first login ("If user doesn't exist yet (OAuth first sign-in), allow") — auto-linking to a member record only happens for `@westervillelions.org` addresses matched by name (lines 161–188). A person with an unrelated Gmail address who completes Google sign-in gets a valid session with `user.id` set and `memberId` unset — exactly the "authenticated member with insufficient roles" surface that CLAUDE.md says lands at `/access-pending`. But `/events/[id]` is public and ungated, so that same person can still load it and have `EventPersonalization` fetch `viewer-context`, which will hand them the **real roster of every past and upcoming signee**, because the gate checks only `user.id`, never `memberId` or a `FEATURES` key. This is a materially different exposure than the OAuth case for `isSignedUp`/`userName` (which are always the caller's *own* data, harmless regardless of who's asking) — `signeesByDate` is the first field on this endpoint that discloses *other people's* data, and it inherited a gate that was only ever sized for "your own state." It's bounded by requiring an actual OAuth sign-in (not zero-click scraping) and the codebase already emails `info@westervillelions.org` on an unlinked user's first sign-in (lines 190–200-ish), so it isn't silent — but it is a real, if narrow, residual path where member-derived data crosses to a non-member. **Recommend, as a cheap follow-up:** gate `signeesByDate` specifically on `session?.user?.memberId` rather than `session?.user?.id` (a one-line change in `viewer-context/route.ts`), leaving `isSignedUp`/`userName`/`attachedFiles` on the existing, correctly-scoped `user.id` gate. Not a blocker for today's ship, because it requires an affirmative sign-in action and is materially narrower than the anonymous leak this whole rework exists to close.

## 2. Does the standing requirement now hold?

**Yes, with no dead end I could find**, checked by reading the actual link targets, not assuming from the work-log's prose:

- `/members/events` (`src/app/members/events/page.tsx` lines 111, 119, 164, 200) links every event card directly to `/events/${event.id}` — no intermediate redirect.
- `/members/events/past` (`src/app/members/events/past/page.tsx` line 77) does the same.
- `/members/events/[id]/page.tsx` is a one-line `redirect(`/events/${id}`)`, so even a stale/bookmarked link into the member-portal URL shape lands on the same fixed page.
- `/events/[id]` itself now generates the full historical occurrence set (`generateOccurrences(event, parseWallClock(event.startDate), 520)`), and every past row keeps its roster, gated correctly, merged in for a signed-in viewer.

A signed-in member has no dead end across any of the three surfaces named in the task. "We always need to be able to get to signups" holds structurally, not just for the one event that prompted the report.

## 3. Did the privacy fix cost the feature anything? — yes, one real thing, worth calling out plainly

I read `EventPersonalization` and `OccurrenceSignupList` looking specifically for this. There is **no loading indicator** for the roster fetch. Sequence for a signed-in member on first paint:

1. Server-rendered baseline arrives with `isLoggedIn` effectively `false` (context is `null`), so `OccurrenceSignupList`'s chip condition (`!row.isCancelled && isLoggedIn && row.signees.length > 0`, `occurrence-signup-list.tsx` line 204) is false for every row — no chips render, and depending on what else `isLoggedIn` gates in that component, the page may also present sign-in-flavored copy to someone who is, in fact, signed in.
2. `useEffect` fires the `viewer-context` fetch on mount.
3. Once it resolves, `key={loadKey}` (`"baseline"` → `"loaded"`) forces a **full remount** of `OccurrenceSignupList`/`SingleEventSignup`, and the real chips appear.

On a fast local network this is imperceptible; on a slow connection or an interrupted fetch (the `.catch()` at line 78 silently swallows failures and leaves the baseline in place *forever*, with no retry) it reproduces something close to the shape of the original complaint: a member opens the page specifically to see who signed up, and for a beat — or, on a failed fetch, indefinitely — sees what looks exactly like "nobody's here yet" rather than "still loading." This is the same documented "flash of signed-out" tradeoff already accepted elsewhere in this codebase (the Header pattern cited in both files' comments), so it isn't a new architectural risk this fix invented — but it is the **first time that tradeoff has been applied to the literal feature the user filed the complaint about**, which raises the stakes on it in a way it didn't have for `isSignedUp`/`userName` before. I'd treat this as a concrete, scoped follow-up: add a lightweight loading state (a skeleton chip or "Loading attendees…" microcopy) specifically for the signee section, and consider a single retry on fetch failure rather than a silent, permanent fallback to the empty baseline. Not a blocker — the fix is a strict improvement over "completely absent, forever," which was the actual complaint — but I'd rather this be a named backlog item than a surprise the club reports in three weeks.

## 4. The un-click-through'd disclosure behavior — acceptable for sign-off

I read the code directly rather than trusting QA's proof-by-description: `occurrence-signup-list.tsx` lines 43–45 initialize `showPast` from `occurrences.length > 0 && occurrences.every((r) => r.isPast)`, and the `upcomingRows` filter (used elsewhere in the same file) partitions on the identical `!r.isPast` predicate. `occurrences.every(isPast) === true` is `upcomingRows.length === 0` by construction — the same array, the same field, no intervening transformation that could make the two diverge. This is a two-line boolean over a predicate that already has three independent regression tests in `events.test.ts` confirming `isPast` computes correctly at the exact boundary that matters (the series' final day). I don't think this needs a live click-through to sign off — it needs a live click-through to feel *confirmed*, and those aren't the same bar. Practically: the flagged Farmers Market series (`recurrence_end_date = 2026-09-26`) crosses into exactly this state tomorrow once the final occurrence's start time passes, so this will get real-world exercise within about a day regardless of what this review decides. **Recommend:** a quick, no-cost confirmation on 2026-09-27 (load the Farmers Market event page, confirm the disclosure is open by default) rather than gating today's ship on synthetic dev-data setup for a two-line, already-proven boolean.

## 5. Ship readiness / urgency

Weighing this correctly matters: the **anonymous name leak is still live in production right now**, this whole diff is uncommitted (`git status` at session start shows `src/lib/events.ts`, `src/app/events/[id]/page.tsx`, `event-personalization.tsx`, `occurrence-signup-list.tsx`, `viewer-context/route.ts` all modified, unpushed), and tomorrow's Farmers Market (the same event whose `recurrence_end_date` is `2026-09-26`) will generate fresh real signups that — until this ships — continue to land in the exact unauthenticated payload the first Phase 6 pass caught. None of the three items I raised above (OAuth-session roster gate, loading-state flash, unexercised disclosure edge case) come close to the severity of "every visitor's browser can already read the full attendee roster of a live public page," which is what's running in production today. Holding this fix for further rework to chase narrower, lower-severity gaps would extend the live exposure for no proportionate benefit.

## What's working

- Everything the first Phase 6 pass already approved (Defect A boundary fix, Defect B past-occurrence generation, the disclosure UI, no regression to signup/cancel/optimistic-update logic) is unchanged by the rework and re-confirmed by QA's re-verification — not re-litigated here.
- The privacy fix follows the codebase's own established pattern (`viewer-context` session-dependent fetch) rather than inventing a new one, which is exactly what I asked for in the first pass.
- Data minimization, not just response filtering: both the page's RSVP query and the API route's early-return avoid running the name-bearing query at all for an anonymous request, rather than fetching-then-hiding. This is the stronger of the two designs and closes the class of bug (a future refactor accidentally re-exposing an already-fetched-but-hidden value), not just today's instance.
- The zero-upcoming-rows disclosure default is a real, useful fix to a note I raised last time, correctly scoped and logically sound on inspection.

## Intent-vs-shipped diff

- Phase 1 said: *the final occurrence of a recurring series should count as upcoming through its own last day.* Shipped and unchanged since the first Phase 6 pass approved it. **Verdict: matches.**
- Phase 1 said: *a member must be able to find who signed up for a past occurrence.* Shipped: confirmed via direct code read across all three named surfaces (`/events/[id]`, `/members/events`, `/members/events/past`), no dead end. **Verdict: matches.**
- First Phase 6 pass said: *stop shipping real names to anonymous visitors, using the existing viewer-context pattern, for both past and upcoming rows.* Shipped: exactly this, verified independently at the source level (not just QA's byte-level test), for both the recurring and non-recurring paths. **Verdict: matches.**
- First Phase 6 pass's UX note said: *auto-expand the disclosure when a series has zero upcoming rows.* Shipped: implemented, logically verified, not yet observed live (resolves itself tomorrow). **Verdict: matches, pending routine confirmation.**
- Not explicitly asked for by either Phase 1 or the first Phase 6 pass, but newly surfaced by this second pass: the client-fetched roster has no loading state, and the session-presence gate is slightly wider than "verified club member." **Verdict: acceptable drift** — both are pre-existing architectural patterns in this codebase applied consistently to new fields, not defects introduced by carelessness, but both deserve tracked follow-ups given what they touch.

## Edge cases

| Case | Result |
|---|---|
| Empty state (zero occurrences ever) | Pass — unchanged from first pass, not re-litigated. |
| Failure microcopy | Not applicable for the roster fetch's happy path; **gap** for its failure path — a failed `viewer-context` fetch fails silently to the empty baseline with no retry and no user-visible indication (see Q3 above). Not a blocker; recommend as a follow-up. |
| Permission gate | **Pass for the leak that blocked this pipeline** (anonymous visitors get `signees: []` / `signeesByDate: {}`, verified at the source). **Note, not a fail:** the gate for `signeesByDate` specifically is session-presence (`user.id`), one step wider than "confirmed club member" (`memberId`) — see Q1. |
| Mobile (360px) | Pass — unchanged, re-confirmed by QA's re-verification, not re-tested here since no CSS changed in the rework. |
| Brand consistency | Pass — unchanged from first pass. |

## Follow-ups (tracked, since this ships as SHIP WITH NOTES)

1. **Narrow the `signeesByDate` gate in `src/app/api/events/[id]/viewer-context/route.ts` from `session?.user?.id` to `session?.user?.memberId`.** A Google OAuth sign-in from any account (not just an approved club member) currently reaches this endpoint's authenticated branch and receives the real roster. `isSignedUp`/`userName`/`attachedFiles` are fine on the current gate (they're the caller's own data); `signeesByDate` discloses other members' names and should require a confirmed member link, not mere session presence. One-line change, low risk.
2. **Add a loading affordance for the signee roster in `EventPersonalization`/`OccurrenceSignupList`**, and consider retrying (or surfacing) a failed `viewer-context` fetch instead of silently keeping the empty baseline forever. This is the one place a "looks empty" moment on this page directly re-creates the shape of the original user complaint, even though today's fix is a strict improvement over the prior total outage.
3. **Confirm live on or after 2026-09-27** that the Farmers Market event page's past-dates disclosure renders auto-expanded once the series has zero upcoming rows (logically proven, not yet observed live — see Q4). Cheap, no dev-data setup required by then.
4. **Carried forward from the first Phase 6 pass, unchanged:** log the pre-existing (pre-dating this whole work-log) upcoming-occurrence name exposure as its own line in the next 30-day security review's PII sweep, independent of the fact that this rework happened to close it as a side effect.

## Open questions / handoff notes

- Recommend shipping promptly given the still-open production exposure and tomorrow's Farmers Market signups; none of the four follow-ups above rise to a level that should hold this diff back.
- No source files were modified by this Phase 6 second pass — I read `src/app/events/[id]/page.tsx`, `src/app/api/events/[id]/viewer-context/route.ts`, `src/components/events/event-personalization.tsx`, `src/components/events/occurrence-signup-list.tsx`, `src/app/api/auth/register/route.ts`, and `src/lib/auth/index.ts` directly, plus grepped the member-events list pages for their link targets. No database access, no dev server started, no commits, no pushes.
- No real member name appears in this section; all evidence above is either drawn from the already-redacted prior sections or from code structure (query shapes, gate conditions, line numbers) rather than data values.

# Phase 4 — Follow-up Fixes (full-stack) — 2026-09-25

**Owner:** full-stack-developer
**Status:** complete

## Summary

Closed both non-blocking follow-ups the second Phase 6 pass flagged: the `signeesByDate` gate on `/api/events/[id]/viewer-context` was `session?.user?.id` (session presence — "is anyone signed in") rather than `session?.user?.memberId` (an actual linked member), and the client-fetched roster had no loading state and failed permanently and silently on a fetch error. Both are fixed. No commits, no pushes, no database writes, per the task's constraints.

## Finding 1 — roster gate, confirmed then fixed

Confirmed the analyst's read by tracing the code myself, not taking it on faith: `src/lib/auth/index.ts`'s Google OAuth `signIn` callback allows sign-in from any Google account on first login; auto-linking to a `members` row only happens for `@westervillelions.org` addresses matched by name (the same file's `jwt` callback, lines ~150–188). A first sign-in from an unrelated Google account therefore produces a session with `user.id` set but `user.memberId` unset. `/events/[id]` is public and ungated, so `EventPersonalization` still fetches `viewer-context` for that session, and the route's only gate — `!session?.user?.id` — let it through to the name-bearing query.

**Fix (`src/app/api/events/[id]/viewer-context/route.ts`):** introduced `const memberId = session.user.memberId ?? null;` and made the `allSignups` (roster) query conditional on `memberId` — `memberId ? db.select(...) : Promise.resolve([])` — inside the same `Promise.all` that already ran the caller's own-RSVP lookup. A signed-in-but-unlinked caller now gets `signeesByDate: {}` and the roster query never runs for them (never fetch-then-hide, matching the anonymous branch's existing discipline). `isSignedUp`/`userName`/`attachedFiles` are unchanged — they're always the caller's own data and remain correctly gated on mere session presence, per the analyst's own distinction. Added a doc-comment block explaining why `signeesByDate` needs a narrower gate than its sibling fields.

**Other `id`-vs-`memberId` gating checked, not changed (per the task's ask to report even without changing):**
- `/api/members/dues`, `/api/members/profile`, `/api/members/profile-picture` — all explicitly branch on `session.user.memberId` already (dues refuses outright with no `memberId`; profile/profile-picture treat a null `memberId` as "no profile," which is correct since it's the caller's own, possibly-nonexistent, profile).
- `/api/suggestions`, `/api/events/[id]/signup`, `/api/events/[id]/rsvp` — gate on `session?.user?.id` only, but every field they read or write is the caller's own row (their own suggestion, their own signup/RSVP) — never another member's data — so `id` is the correct gate for the same reason it's correct for `isSignedUp`/`userName` on this same route.
- No other route returning **other members'** derived data (names, contact info, etc.) gated on `id` alone was found. `signeesByDate` appears to have been the only instance of this specific class of gap, because it's the only field on `viewer-context` that discloses someone else's data rather than the caller's own.

## Finding 2 — loading/failure UX, fixed

**Fix (`src/components/events/event-personalization.tsx`):** added a `rosterStatus` state (`"loading" | "ready" | "error"`, starts `"loading"`) alongside the existing `context` state, and a `retryToken` state that re-runs the fetch effect on demand. The `.catch()` block that used to silently swallow the failure now sets `rosterStatus("error")` instead (still leaves the signed-out baseline `context` in place — no behavior change to what's rendered on failure, just now distinguishable). A `retryRoster()` callback bumps `retryToken`. Both are passed down to `OccurrenceSignupList` as new `rosterStatus`/`onRetryRoster` props.

**Fix (`src/components/events/occurrence-signup-list.tsx`):** renders a small status strip above the occurrence rows list — a spinner + "Loading who's signed up…" while `rosterStatus === "loading"`, or "Couldn't load who's signed up." plus an inline `Retry` button (calling `onRetryRoster`) while `rosterStatus === "error"` — and renders neither once `rosterStatus === "ready"`. New props default to `rosterStatus = "ready"` so any other/future caller (and the pre-existing single-row-list default) is unaffected. The strip is a single line inside the existing `rounded-2xl` card, so it doesn't reflow the page around it; it necessarily disappears once the roster resolves (the nature of a loading indicator), but doesn't touch row layout, chip layout, or introduce any new card/container.

**Scope note:** `SingleEventSignup` (the non-recurring signup path) was intentionally left untouched — it wasn't in this task's file list, and the original bug report (and every QA click-through) was specifically about the recurring Farmers Market series that `OccurrenceSignupList` renders. `SingleEventSignup` still has the same silent-catch tradeoff `EventPersonalization` had before today; flagging this as a follow-up for symmetry, not fixing it here.

**Not addressed, and out of scope for this pass:** the `isLoggedIn`/sign-in-prompt flash (a signed-in member briefly sees "Log in to sign up" copy until `viewer-context` resolves) is a distinct, pre-existing tradeoff from the roster-emptiness issue this task named — the task's Finding 2 was specifically about the roster looking empty, not about the sign-in copy. Not touched.

## Tests added (regression discipline: confirmed failing pre-fix, passing post-fix)

- **`src/app/api/events/[id]/viewer-context/route.test.ts`** — added *"returns signeesByDate: {} and never issues the name-bearing roster query for a signed-in session with no linked member"* (asserts `db.select` called exactly once — the caller's own-RSVP lookup only). **Pre-fix:** reverted just `route.ts` (`git stash` on that one file), reran — all 5 tests in the file failed, including this one and the two pre-existing signed-in-roster tests (their `memberId` fixtures had to change from `null` → a real id, since `null` is no longer sufficient for the roster to appear — see below). **Post-fix:** all 5 passed.
  - Also updated the two pre-existing "signed-in member receives the real roster" tests: they previously used `memberId: null` (the field was irrelevant pre-fix) — now use `memberId: "member-1"` / `"member-2"` respectively, since a real roster response now requires an actual linked member. This is a **strengthening**, not a weakening: the tests still assert exactly the same real-roster behavior, just under a fixture shape that's actually reachable under the new (correct) gate. The "and a signed-in-but-unlinked caller gets `{}`" case that the old `memberId: null` fixture used to (accidentally) cover for the wrong field is now its own explicit test, above.
- **`src/components/events/occurrence-signup-list.test.tsx`** (new file, 4 tests) — renders `OccurrenceSignupList` directly via `renderToStaticMarkup` (same technique as `member-directory.test.tsx`; `EventPersonalization`'s `useEffect`-driven fetch doesn't run under SSR, so the component is exercised directly with each `rosterStatus` value, matching the actual prop contract the real caller uses):
  - *"renders a distinguishable loading indicator while the roster fetch is in flight"*
  - *"renders a distinguishable, retryable failure state rather than silently showing an empty roster"*
  - *"shows neither the loading nor the error affordance once the roster has loaded"*
  - *"defaults to the ready (no-banner) state when rosterStatus is omitted, for callers that don't track it"*
  - **Pre-fix:** `git stash` on `occurrence-signup-list.tsx` + `event-personalization.tsx` (the props didn't exist yet), reran — the 2 tests asserting the loading/error banners **failed** (banner text absent from the rendered HTML); the ready/default-omitted tests passed vacuously (nothing to assert against). **Post-fix:** all 4 passed.

Full suite: `pnpm test` → **2052/2052 passed, 116/116 test files** (up from 2047/115 before this pass — 1 new route test + 4 new component tests = 5).

## Gates

- `pnpm exec tsc --noEmit` — PASS, no output.
- `pnpm test` — PASS, 2052/2052.
- `pnpm build:only` — PASS, "Compiled successfully", `/events/[id]` and `/api/events/[id]/viewer-context` both present in the route table; no interference from the concurrent database-admin agent's `schema.ts`/migration work (build succeeded cleanly, no schema-shaped errors).
- No `console.log` in any touched file (grep-confirmed).
- No native browser dialogs introduced.
- No existing test was weakened — the two `memberId: null` roster tests were changed to a linked-member fixture (a strengthening, see above), and the 6 privacy tests plus the 3 occurrence-boundary regression tests in `src/lib/events.test.ts` were not touched and still pass.
- No commits, no pushes, no database writes — confirmed no `db:migrate`/`db:push`/write scripts were run.

## Outputs

- `src/app/api/events/[id]/viewer-context/route.ts` — `signeesByDate`'s roster query now gated on `session.user.memberId`, not `session.user.id`; doc comment explains why this field needs a narrower gate than its siblings on the same response.
- `src/app/api/events/[id]/viewer-context/route.test.ts` — 1 new test (signed-in-unlinked → `{}`, no roster query); 2 existing tests' fixtures updated from `memberId: null` to a real member id (strengthening, not weakening).
- `src/components/events/event-personalization.tsx` — added `rosterStatus`/`retryToken` state and a `retryRoster()` callback; `.catch()` now sets an "error" status instead of silently doing nothing; passes `rosterStatus`/`onRetryRoster` to `OccurrenceSignupList`.
- `src/components/events/occurrence-signup-list.tsx` — new optional `rosterStatus`/`onRetryRoster` props; renders a loading spinner strip or a retryable failure strip above the occurrence list; defaults to `"ready"` (no visible change) when omitted.
- `src/components/events/occurrence-signup-list.test.tsx` (new) — 4 tests covering loading, error+retry, ready, and the default-omitted case.
- No schema change. No new `FEATURES` entry. No new env var. `SingleEventSignup` (non-recurring path) intentionally untouched — out of this task's scope; same silent-catch/no-loading-state gap remains there.

## Open questions / handoff notes

- Nominating **qa** for a fresh Phase 5 pass on just these two follow-ups (the rest of the work-log's Phase 5/6 history stands; this isn't a full rework of the whole feature).
- Recommend qa's manual/scripted click-through specifically try: (a) a slow/throttled network to observe the "Loading who's signed up…" strip before chips appear, and (b) simulating a `viewer-context` fetch failure (e.g. temporarily blocking the route) to confirm the "Couldn't load…"/Retry strip appears and that clicking Retry recovers the roster once the route is unblocked.
- `SingleEventSignup`'s equivalent silent-catch/no-loading gap (noted above) is a good candidate for a small tracked backlog item, for whichever non-recurring event next needs this same polish — not urgent, since no current non-recurring event's roster prompted a complaint the way the recurring Farmers Market series did.
- No real member name was written to this file or any other file in this repo during this pass; all test fixtures use `"Viewer Name"`/`"Test-Only Viewer Context Signee"`-style placeholders, consistent with the rest of this work-log.
