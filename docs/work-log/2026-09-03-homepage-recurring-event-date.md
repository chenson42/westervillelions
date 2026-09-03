# Homepage recurring-event date is wrong on "Upcoming Events" cards — Work Log

> **Slug:** `2026-09-03-homepage-recurring-event-date`
> **Surface:** public (homepage)
> **Permission(s):** none — public, unauthenticated surface
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | (parent agent, brief) | Complete | Confirmed real | 2026-09-03 |
| 2 — Architectural review | — | Skipped (see note) | — | 2026-09-03 |
| 3 — Technical design | — | Skipped (see note) | — | 2026-09-03 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-09-03 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

## Bug Report

**Symptom:** On the public homepage, the "Upcoming Events" cards (rendered via
`FeaturedContent` / `NextEventCard`) show the wrong date for recurring events.
Example: the Farmers Market (a weekly recurring event) always displayed its
very first-ever occurrence date, not the next upcoming one — even though the
card is titled "Upcoming Events" and visitors expect to see when the event
next happens.

**Repro steps (pre-fix):**
1. Have a recurring event (e.g. weekly, "Every Saturday") whose original
   `startDate` is in the past relative to today, with future occurrences
   still generated (no `recurrenceEndDate`, or one still in the future).
2. Mark it `isFeatured` (or let it be the fallback single event) and
   `isPublic`.
3. Visit `/` (homepage).
4. **Before fix:** the "Upcoming Events" card shows the event's very first
   occurrence date (the series' original `startDate`) — which may be months
   or years in the past — instead of the next Saturday it will actually
   occur.
5. **After fix:** the card shows the next real occurrence's date (e.g. "next
   Saturday").

Contrast: `/events` did not exhibit this symptom, because for recurring
events it displays a generic `recurrenceLabel` ("Every Saturday") instead of
a specific date, sidestepping the underlying mismatch rather than fixing it.
The user explicitly wants the homepage card to show the actual next
occurrence's date, not a generic label.

## Root Cause

- `src/app/page.tsx` queried events, then sorted them via a
  `sortByNextOccurrence()` helper that called `getNextOccurrence()` from
  `src/lib/events.ts` **only to compute a sort key** (`.getTime()`). The
  computed next-occurrence `Date` was discarded immediately after sorting —
  never attached back onto the row object.
- The row objects passed into `FeaturedContent` / `NextEventCard` still
  carried the original `startDate` field (the DB's wall-clock string — the
  series' original start, for recurring events).
- `NextEventCard` called `formatEventWhen(event)`
  (`src/lib/events.ts`), which does `parseWallClock(event.startDate)` and
  formats it — i.e. it formatted the *original* start date for every event,
  including recurring ones, instead of the next occurrence.

## Phases Skipped and Why

- **Phase 2 (architect):** Skipped. No new dependency, no new directory, no
  structural change, no invariant touched — this is a data-flow fix within
  two existing files plus one small, non-duplicating helper extraction in a
  third (already-existing) lib file.
- **Phase 3 (tech-lead):** Skipped. Root cause and fix shape were already
  established via direct investigation before implementation began; the
  change is trivial in scope (~30 net lines across 3 files) and tightly
  coupled across server + client, matching the full-stack-developer bug-fix
  criteria.

## What Changed

### `src/lib/events.ts`

- Extracted the Date→display-string formatting logic out of
  `formatEventWhen()` into a new exported helper,
  `formatWallClockDate(d: Date, isAllDay: boolean): string`, so there is one
  formatting implementation instead of two (per CLAUDE.md's duplication
  rule). `formatEventWhen(event)` is now a thin wrapper:
  `formatWallClockDate(parseWallClock(event.startDate), event.isAllDay)`.
- This lets callers that already hold a computed `Date` (e.g. a next
  occurrence from `getNextOccurrence()`) format it directly, without
  round-tripping back into a DB-style wall-clock string just to re-parse it.

### `src/app/page.tsx`

- Replaced `sortByNextOccurrence()` (which discarded the computed `Date`)
  with `withNextOccurrence()`, which maps each event row to
  `{ ...row, nextOccurrence: Date }` using the same `getNextOccurrence()`
  call (still passed the per-event cancelled-dates set from
  `cancelledByEvent`, so cancelled-occurrence handling —
  `eventOccurrenceOverrides` — is unchanged). `sortByNextOccurrence()` is now
  a plain sort over the already-attached `nextOccurrence` field — no third
  call to `getNextOccurrence()`.
- For non-recurring events, `getNextOccurrence()` returns the event's own
  `startDate` (confirmed by reading `src/lib/events.ts` — the
  `!event.isRecurring` branch returns `start` if it's in the future), so this
  change is a verified no-op for non-recurring homepage events (also covered
  by a new regression test, see below).
- Added `parseWallClock` import for the (defensive, effectively unreachable
  given `upcomingPublic`'s WHERE clause already excludes ended series)
  fallback when `getNextOccurrence()` returns `null`.

### `src/components/home/featured-content.tsx`

- `NextEvent` type: replaced `startDate: string` with
  `nextOccurrence: Date`, documented as the already-computed next
  occurrence, not the series' original start.
- `NextEventCard` now calls
  `formatWallClockDate(event.nextOccurrence, event.isAllDay)` instead of
  `formatEventWhen(event)`.

### `src/lib/events.test.ts`

- Added a `formatWallClockDate` describe block: timed formatting, all-day
  formatting (no time suffix), and an equivalence check confirming
  `formatEventWhen` stays a thin wrapper (guards against the two
  implementations drifting apart again).
- Added a regression describe block,
  `"regression — recurring event display uses next occurrence, not series
  start"`, with two tests:
  - A weekly-recurring event where `now` is well after `startDate`:
    asserts `formatWallClockDate(getNextOccurrence(event, now), false)`
    is `"Saturday, July 4, 2026 at 9:00 AM"` (the next Saturday) and
    explicitly is **not** equal to `formatEventWhen(event)` (which would
    format the original, stale `startDate`) — this test fails on the
    pre-fix formatting path and passes on the fixed one.
  - A non-recurring event: asserts `getNextOccurrence()`'s result formats
    identically to `formatEventWhen(event)`, confirming the fix is a no-op
    for non-recurring events.

## Verification

- `pnpm exec tsc --noEmit` — **PASS**, no errors.
- `pnpm test` (Vitest, full suite) — **PASS**, 83 files / 1572 tests,
  including the new `events.test.ts` cases (100 tests in that file, all
  passing).
- `pnpm build:only` — **PASS**, production build completed with no
  errors, homepage (`/`) built successfully.
- No `console.log` added. No native browser dialogs (not applicable to this
  change). No schema/migration changes (not applicable).

## Files Modified

- `src/lib/events.ts` — extracted `formatWallClockDate()`; `formatEventWhen()` now delegates to it.
- `src/app/page.tsx` — attach computed `nextOccurrence` Date to each event row instead of discarding it after sorting.
- `src/components/home/featured-content.tsx` — `NextEvent.nextOccurrence: Date` replaces `startDate: string`; `NextEventCard` formats `nextOccurrence` directly.
- `src/lib/events.test.ts` — new `formatWallClockDate` tests + regression tests for next-occurrence display.

## Open Questions / Handoff Notes

- Nominate **qa** for Phase 5.
- What to click through in the browser:
  - Homepage `/` — if a public, featured (or fallback) event is a recurring
    series whose original start is in the past, its "Upcoming Events" card
    should show the **next** occurrence's date, not the original start date.
  - Compare against `/events`, which should be unaffected (still shows
    `recurrenceLabel` for recurring events).
  - A cancelled single occurrence (via `eventOccurrenceOverrides`) on the
    otherwise-next date should cause the homepage card to skip to the
    following valid occurrence — verify against a seeded override if one
    exists in dev data, otherwise this is covered by unit tests
    (`getNextOccurrence` cancelled-date handling, unchanged by this fix).
  - Non-recurring featured/fallback events should be visually unchanged.
- No new `FEATURES` entry, no new env var, no schema change.
