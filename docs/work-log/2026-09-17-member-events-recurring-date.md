# Member events page shows series start, not next occurrence — Work Log

> **Slug:** `2026-09-17-member-events-recurring-date`
> **Surface:** (dashboard) member portal (`/members/events`)
> **Permission(s):** none — any signed-in user
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant — Phases 1, 2, 3, 5, 6 skipped (display-only change on one page, same class as the 2026-09-03 homepage fix; no invariants, schema, or server logic touched).

---

## Root cause

`/members/events` already computes `nextOccurrence` per event via `getNextOccurrence()` and uses it to decide what is upcoming, to sort, and to key the RSVP button. But the card's date line called `formatEventWhen(event)`, which formats the stored `startDate` — for a recurring series that is the *first-ever* occurrence. The 2026-09-03 homepage fix (`docs/work-log/2026-09-03-homepage-recurring-event-date.md`) changed only the homepage card; this page kept the old call. The card also showed no recurrence description, so nothing told a member the event repeats.

## Reproduction (pre-fix)

1. Have a weekly recurring event whose `startDate` is in the past and whose `recurrenceEndDate` is in the future (production: "BMX Volunteers — Thursday Racing", started 2026-08-27, ends 2026-10-22).
2. Sign in and open `/members/events`.
3. **Before:** the card appears under Upcoming Events (correctly) but its date line reads "Wednesday, August 27, 2026 at 6:00 PM" while the RSVP button is for the next occurrence.

Production data was checked: all three BMX series are weekly, run through late October, and have no cancelled occurrences. No data change needed.

## Fix

The date line renders `formatWallClockDate(event.nextOccurrence, event.isAllDay)`; recurring events also show the existing `formatRecurrence()` label ("Every Thursday, Aug 27 – Oct 22, 2026") beneath it. `formatEventWhen` is no longer imported by this page.

## Verification

- `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build:only`, `pnpm test:e2e` — see /pre-push run in the session.
