# Event Signups with Per-Occurrence Support

**Date:** 2026-04-29
**Status:** Planning
**Area:** member-portal, admin, api

## Value
Members need a way to sign up for specific event dates, particularly for recurring events like monthly volunteer shifts. Currently RSVPs exist but are tied to the event as a whole, not individual occurrences — making it impossible to track "who is coming on May 1st vs May 8th."

## Description
Events can optionally enable signups. When signups are enabled, an optional cap (max attendees) can be set. For one-time events, a signup button appears on the event detail page. For recurring events, the event detail page shows a list of all upcoming occurrences, each with its own signup button, attendee count, and full/signed-up state. Admins can see per-occurrence signup counts in the admin event detail view.

## Users
- **Public / unauthenticated:** Can view events and see whether signups are open and how many spots remain. Cannot sign up (must log in).
- **Logged-in members:** Can sign up for (and cancel) individual event occurrences.
- **Admins:** Can see full signup lists per event/occurrence in the admin panel.

## Permissions
No new permission needed. Signing up uses the existing member login. Admin signup visibility falls under the existing `admin.dashboard` access.

## Functional Requirements

### Events
- [ ] Events have an optional "Allow Signups" toggle (distinct from existing `requiresRsvp` field — or we reuse/rename it)
- [ ] When signups are enabled, an optional max attendees cap can be set (already exists as `maxAttendees`)
- [ ] If no cap is set, signups are unlimited
- [ ] If cap is reached, the signup button shows "Full" and is disabled

### One-time events
- [ ] Event detail page shows signup button for logged-in members
- [ ] Shows current attendee count (and remaining spots if cap is set)
- [ ] Member can cancel their signup

### Recurring events
- [ ] Event detail page shows a list of all upcoming occurrences (generated from recurrence pattern)
- [ ] Each occurrence row shows: date/time, signed-up count, remaining spots (if cap), and a signup/cancel button
- [ ] Past occurrences are hidden or collapsed
- [ ] A member can sign up for multiple individual occurrences independently
- [ ] Signing up for one occurrence does not affect others

### Admin
- [ ] Admin event detail shows signup counts per occurrence for recurring events
- [ ] Admin can see who signed up for each occurrence (name/email list)
- [ ] Existing flat RSVP list stays for non-recurring events

## Data Model

### Schema change: `event_rsvps` table
Add one nullable column:
```sql
ALTER TABLE event_rsvps ADD COLUMN IF NOT EXISTS occurrence_date timestamp;
```

- For **non-recurring** events: `occurrence_date` is NULL (existing behavior preserved)
- For **recurring** events: `occurrence_date` is the specific date/time of the occurrence
- Unique constraint: `(event_id, user_id, occurrence_date)` — one signup per user per occurrence (NULL treated as a single occurrence)

### No new tables needed
Occurrence dates are generated on-the-fly from the recurrence pattern (existing `recurrenceType`, `recurrenceDays`, `recurrenceEndDate` fields). No separate `event_occurrences` table.

## Routes

### New/modified API routes
- `POST /api/events/[id]/signup` — sign up for an event (body: `{ occurrenceDate?: string }`)
- `DELETE /api/events/[id]/signup` — cancel signup (body: `{ occurrenceDate?: string }`)

### Modified pages
- `src/app/events/[id]/page.tsx` — add per-occurrence signup UI for recurring events; add signup button for one-time events
- `src/app/(dashboard)/admin/events/[id]/page.tsx` — show per-occurrence signup summary for recurring events
- `src/components/admin/event-form.tsx` — ensure signup/cap fields are clearly labeled in admin form

## Out of Scope
- Waitlists when an event is full
- Email notifications when signing up or when cap is reached
- Guest counts on per-occurrence signups (keep existing guest count on non-recurring)
- Allowing admins to manually add/remove signups from the admin UI
- Public (unauthenticated) signups for events — login required

## Test Cases
- [ ] Sign up for a one-time event; count increments; cancel removes it
- [ ] Sign up for two different occurrences of a recurring event independently
- [ ] Signing up for one occurrence of a recurring event does not mark other dates as signed up
- [ ] When cap is reached, signup button becomes "Full" and is disabled
- [ ] Past occurrences do not show a signup button
- [ ] Non-recurring events with no cap show unlimited signup
- [ ] Admin event detail shows correct per-occurrence counts for recurring events
- [ ] Unauthenticated user sees signup info but is prompted to log in

## Open Questions
- Should we reuse `requiresRsvp` for the "Allow Signups" toggle, or introduce a cleaner `allowSignups` boolean? (`requiresRsvp` already exists but semantically overlaps — recommend renaming mentally but reusing the column to avoid migration churn)
- ~~Should recurring event series have a single cap that applies per-occurrence, or a total cap across all occurrences?~~ **Decided: per-occurrence cap** — `maxAttendees` applies independently to each date.
