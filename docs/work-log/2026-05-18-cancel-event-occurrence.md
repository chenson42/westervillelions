# Cancel a Single Event Occurrence — Work Log

> **Slug:** `2026-05-18-cancel-event-occurrence`
> **Surface:** mixed — admin cancels from `/(dashboard)/admin` event/occurrences view; member portal + public events show the cancelled badge
> **Permission(s):** existing admin-events permission (analyst/tech-lead to confirm exact `FEATURES` key)
> **Estimated complexity:** small–medium
> **Pipeline mode:** Full (Phase 2 likely brief — touches existing event-occurrence module)

**User intent (verbatim, captured at intake):** Recurring events sometimes skip an individual date — e.g., the farmers market runs May–Sept but doesn't happen on July 4. Admin needs to cancel/soft-delete a single occurrence without affecting the rest of the series. Members should still see the date with a "Cancelled" badge; cancellation should be reversible; admin should be able to attach an optional reason note that's shown to members if provided. Cancel action lives on the event detail / occurrences list.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-05-18 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-05-18 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementer = full-stack-developer | 2026-05-18 |
| 4 — Implementation | full-stack-developer | Complete | Gates passed | 2026-05-18 |
| 5 — Verification | qa | Complete | PASS (machine gates) — manual click-through pending user verification | 2026-05-18 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-05-18 |

---

# Phase 1 — Functional Refinement (analyst)

## Summary

An admin needs to mark a single occurrence of a recurring event as cancelled without touching the rest of the series. The cancelled occurrence stays visible to members (and optionally the public) with a "Cancelled" badge and an optional reason. The cancellation is reversible — an admin can restore it. This is a new data model concern: the `events` table has no per-occurrence override layer at all today, so a new `event_occurrence_overrides` table (or equivalent) is needed. The feature is well-scoped by the user and is ready to design, with several gaps that need to be made explicit before implementation.

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Admin marks a single recurring-event date as cancelled; members see it with a badge and optional reason; admin can un-cancel.

## User Verbs

| Surface | Actor | Verb | Notes |
|---------|-------|------|-------|
| Admin — `/(dashboard)/admin/events/[id]` | Admin | Clicks "Cancel" on a specific occurrence row in the "Signups by Occurrence" accordion | Entry point the user named |
| Admin — cancel modal/confirm | Admin | Types an optional cancellation reason | Free text, optional |
| Admin — cancel modal/confirm | Admin | Confirms the cancellation via `<ConfirmDialog>` | Must NOT use `window.confirm()` |
| Admin — `/(dashboard)/admin/events/[id]` | Admin | Sees the occurrence row marked Cancelled (with reason if provided) | Immediate feedback after action |
| Admin — `/(dashboard)/admin/events/[id]` | Admin | Clicks "Restore" on a cancelled occurrence | Un-cancels; row returns to normal |
| Signed-in member — `/members/events` | Member | Sees the cancelled occurrence with "Cancelled" badge in the upcoming list | Passive — no action required |
| Signed-in member — `/events/[id]` | Member | Sees the cancelled occurrence with "Cancelled" badge in the signup list, with reason if provided | Passive |
| Anonymous public visitor — `/events/[id]` | Visitor | Sees the cancelled occurrence with "Cancelled" badge in the signup list, with reason if provided (only if event is public) | Passive |
| Anonymous public visitor — `/events` | Visitor | The public events list shows the recurring series next occurrence; a fully cancelled individual date does NOT shift the listed next occurrence unless ALL future dates are cancelled | Behavior needs spec — see Gaps |

## Flows

**Flow 1 — Admin cancels an occurrence:**
Entry: Admin is on `/admin/events/[id]` (the edit/detail page), scrolled to the "Signups by Occurrence" accordion section.
Step 1: Admin finds the target occurrence row (e.g., "Fri, Jul 4, 2025 at 8:00 AM") and clicks a "Cancel" button on that row.
Step 2: A `<ConfirmDialog>` opens with the occurrence date, an optional text area for the cancellation reason, and "Cancel Occurrence" / "Dismiss" buttons.
Step 3: Admin optionally enters a reason ("No farmers market on July 4") and confirms.
Step 4: API call records the cancellation. The accordion row for that occurrence immediately shows a "Cancelled" badge and the reason (if any). The "Cancel" button is replaced by a "Restore" button.
Success outcome: Admin sees the occurrence marked Cancelled in the list; toast confirms "Occurrence cancelled."
Failure: API returns an error (network failure, DB error). Toast shows "Failed to cancel occurrence. Please try again." The row is not changed (no optimistic update for a destructive action).

**Flow 2 — Admin restores a cancelled occurrence:**
Entry: Admin is on `/admin/events/[id]`, the target occurrence row shows "Cancelled."
Step 1: Admin clicks "Restore" on the cancelled row.
Step 2: A `<ConfirmDialog>` opens confirming "Restore this occurrence?"
Step 3: Admin confirms.
Step 4: API removes the cancellation record. The accordion row returns to normal; "Restore" button is replaced by "Cancel."
Success outcome: Toast confirms "Occurrence restored."
Failure: API error. Toast shows "Failed to restore occurrence. Please try again."

**Flow 3 — Member views cancelled occurrence (member portal `/members/events` list):**
Entry: Member navigates to `/members/events`.
The upcoming events section renders the recurring series as before. The cancelled date appears as a row in the occurrence list with a "Cancelled" badge in place of the "Sign Up" / "Signed Up" button. If a reason was provided, it is shown in subdued text beneath the date.
No action is available — the row is read-only for cancelled occurrences.

**Flow 4 — Member or visitor views cancelled occurrence on event detail page `/events/[id]`:**
Entry: Any user lands on the public event detail page.
The `OccurrenceSignupList` component renders the cancelled occurrence row with a "Cancelled" badge instead of the action button. If the event provides a reason, it appears beneath the date label.
No RSVP action is possible on a cancelled occurrence.

**Flow 5 — Member who had already RSVP'd views a now-cancelled occurrence:**
Entry: Member previously signed up for the July 4 occurrence. Admin later cancels it.
The member's row in the occurrence list shows "Cancelled" regardless of their RSVP status. Their RSVP record is NOT deleted (it is preserved — see Gap 1 for the full treatment). The "Signed Up" button is replaced by the "Cancelled" badge.

## Permissions

- **Permission:** `FEATURES.EVENTS_EDIT` (`"events.edit"`) — this is the existing key used by `PATCH /api/admin/events/[id]` and the edit-event form. Cancelling and restoring an occurrence is a targeted edit action on an existing event; it does not cross into `EVENTS_DELETE` (which deletes the entire event). No new key is needed.
- **Default roles:** Same roles that currently hold `events.edit` (Admin and any role with events edit already assigned). The migration must not add a new binding.
- **API gate:** The new cancel/restore endpoint must check `hasFeature(session.user.features, FEATURES.EVENTS_EDIT)` and return 403 otherwise.

## Gaps the Request Didn't Address

**Gap 1 — RSVP fate on a cancelled occurrence. (Critical — needs resolution before implementation.)**
Members may have already signed up for the July 4 occurrence. The request says nothing about what happens to those RSVPs. Three coherent options:
- A) Keep RSVPs as-is; they are still in the DB but the UI shows "Cancelled" and suppresses the RSVP count from the cancelled row's header. Admin can still see who was signed up.
- B) Keep RSVPs as-is AND show a notice to the member ("You were signed up for this date — it has been cancelled").
- C) Delete RSVPs for the cancelled occurrence automatically.
Option A is lowest-friction and preserves historical data. Option C destroys data. Recommend A. The user must decide. If option B is chosen, it implies a UI state not yet described ("was-signed-up-on-cancelled") that needs its own design.

**Gap 2 — Member email notification for cancellation. (Important — decide now even if the answer is "no.")**
The request did not ask for auto-email. The project has an email queue (`sendEmail()` in `src/lib/email.ts`). Members who RSVP'd for a cancelled occurrence have no way to learn about it unless they happen to re-visit the event page. This is especially sharp for a recurring public event like the farmers market. The user should explicitly say whether an email notification to affected RSVPs is in scope, deferred, or out of scope. If deferred, mark it as a follow-up work-log item. Shipping without deciding this will leave members surprised.

**Gap 3 — Public events list (`/events` page) and next-occurrence display. (Medium — behavior spec missing.)**
Today, `/events/page.tsx` calls `getNextOccurrence()` for each event and filters out series with no future occurrence. If July 4 is the next occurrence and it is cancelled, what does the public see? The most natural behavior is: skip cancelled occurrences in `getNextOccurrence()` and `generateOccurrences()` so the public list shows the next non-cancelled date. This requires `generateOccurrences()` (in `src/lib/events.ts`) to accept a list of cancelled dates and skip them — OR the callers filter after the fact. Either way, the core utility function must be updated. The spec must say so. Suggested resolution: `generateOccurrences()` accepts an optional `Set<string>` of cancelled ISO timestamps and excludes those dates from output. The analyst flags this; the tech-lead should confirm the implementation approach.

**Gap 4 — Naive-timestamp gotcha on `cancelled_at`. (Moderate — recurring bug pattern.)**
The project has a known bug (see memory `project_naive_timestamp_tz_bug.md`) where `timestamp` columns without timezone are read as UTC, causing wall-clock times to display shifted by the UTC offset. A `cancelled_at` column for audit purposes should use `timestamp("cancelled_at", { withTimezone: true })` in schema.ts — the same pattern used by `googleGroupSyncedAt` and `startsAt`/`endsAt` on announcements. However: the "Cancelled" badge itself must be tied to the occurrence date (which is an existing event timestamp, already subject to this bug), not to `cancelled_at`. The tech-lead must not gate the badge display on server-wall-clock comparisons. The badge is driven by the cancellation record's presence — a boolean fact — not by a time comparison. Flag to tech-lead explicitly.

**Gap 5 — Admin occurrence list shows only generated occurrences; a cancelled occurrence date must survive a recurrence-rule change. (Moderate.)**
Currently, `AdminOccurrenceRsvpSection` renders rows by calling `generateOccurrences(event, event.startDate, 520)` at page-load. If an admin edits the recurrence rule (e.g., changes end date), a previously cancelled date might no longer appear in the generated list, causing the cancellation record to become orphaned and invisible. Resolution options: either (a) always render cancellation records even if the date falls outside the current recurrence window, or (b) warn the admin when editing a recurring event that has cancellation records. Flag to tech-lead.

**Gap 6 — `OccurrenceRow` type in `src/types/events.ts` must gain a `isCancelled` and `cancellationReason` field. (Low — but easy to miss.)**
The `OccurrenceRow` interface is shared between the public event detail page and the member portal occurrence list. It will need `isCancelled: boolean` and `cancellationReason: string | null` added before the UI components can render the badge. The tech-lead should include this in the data model plan.

**Gap 7 — Schema.org Event JSON-LD on the public detail page. (Low.)**
`/events/[id]/page.tsx` emits a `schema.org/Event` JSON-LD block. A recurring event with one cancelled occurrence has no standard JSON-LD representation for that cancellation — the schema supports `eventStatus: "EventCancelled"` only at the whole-event level. This is probably acceptable to leave as-is (the structured-data block is for the series, not individual occurrences). Flag to tech-lead as a non-issue unless SEO requirements change.

## Out of Scope (confirm with user)

- **Range cancellation ("cancel all of July").** User asked for single-occurrence only. A range-cancel feature would require a different UI (date-range picker) and a different data model (range records vs point records). Mark as a potential follow-up, not part of this delivery.
- **Cancellation audit log.** The project has a `permission_audit_log` table for role changes but no general action audit log for event operations. Logging who cancelled what and when (beyond `cancelled_at` and `cancelled_by_user_id`) is out of scope for this delivery. Tech-lead may choose to store `cancelledByUserId` as a lightweight audit field.
- **Cancelling non-recurring events.** The user's use case is entirely about recurring series. Cancelling a one-off event is effectively the same as deleting it (which already exists via `FEATURES.EVENTS_DELETE`). Out of scope.

## Open Questions

1. **RSVP fate (Gap 1):** When an occurrence is cancelled, should existing RSVPs be kept (recommended) or deleted? And should members who were signed up see a "You were signed up" notice alongside the "Cancelled" badge?
2. **Email notification (Gap 2):** Should members who had RSVPs for the cancelled occurrence receive an automated email? (If yes, this needs to be in scope. If no, document the explicit decision.)
3. **Public-list next-occurrence behavior (Gap 3):** Should a cancelled occurrence be skipped when computing the "next occurrence" shown on `/events`? (Almost certainly yes — but confirm so the tech-lead can update `generateOccurrences()`.)
4. **Admin list: cancelled occurrence display in the admin events table page (`/admin/events`).** The admin list page (`page.tsx`) shows a flat table of events (not occurrences). Should a recurring series with at least one cancelled occurrence get any indicator in the table row? Or is the cancellation info only visible on the detail page?

---

## Phase 1 — Functional Refinement — 2026-05-18

**Owner:** analyst
**Status:** complete

### Summary

Admin can cancel a single occurrence of a recurring event and restore it later. The cancelled occurrence stays visible everywhere the series appears — public `/events`, public `/events/[id]`, member portal `/members/events`, and admin `/admin/events/[id]` — showing a "Cancelled" badge and optional reason. The feature requires a new per-occurrence override table in the DB (nothing in the schema handles this today), updates to `generateOccurrences()` in `src/lib/events.ts` to skip cancelled dates, updates to `OccurrenceRow` in `src/types/events.ts`, and new cancel/restore API endpoints gated behind `FEATURES.EVENTS_EDIT`. Verdict is READY WITH NOTES; four open questions must be answered before the tech-lead can finalize the design.

### What I did

- Read `src/lib/db/schema.ts` — confirmed there is no per-occurrence override layer today; the `eventRsvps` table tracks per-occurrence RSVPs via `occurrenceDate`, but there is no `event_occurrence_overrides` (or equivalent) table.
- Read `src/lib/permissions.ts` — confirmed `FEATURES.EVENTS_EDIT` is the correct gate; no new key needed.
- Read `src/lib/events.ts` — confirmed `generateOccurrences()` has no concept of cancelled dates; it will need an optional exclusion set.
- Read `src/app/(dashboard)/admin/events/[id]/page.tsx` and `src/components/admin/occurrence-rsvp-section.tsx` — confirmed the admin occurrence accordion is the right insertion point for Cancel/Restore buttons.
- Read `src/app/events/page.tsx`, `src/app/events/[id]/page.tsx`, `src/app/members/events/page.tsx`, `src/app/members/events/past/page.tsx` — inventoried all surfaces that render occurrences or next-occurrence logic.
- Read `src/app/api/admin/events/[id]/route.ts` and `src/app/api/events/[id]/signup/route.ts` — confirmed auth + permission patterns to replicate on the new cancel/restore endpoint.
- Read `src/types/events.ts` — confirmed `OccurrenceRow` needs `isCancelled` and `cancellationReason` fields.
- Ran five-pass review: user verbs, flow audit, permissions, gaps (7 gaps surfaced), adversarial pass.

### Outputs

- `docs/work-log/2026-05-18-cancel-event-occurrence.md` — Phase 1 section filled in; per-phase-status updated to READY WITH NOTES.

### Open questions / handoff notes

- **Q1 (RSVP fate — critical):** Keep existing RSVPs on a cancelled occurrence, or delete them? Recommendation: keep. Does the member need a "you were signed up" notice?
- **Q2 (email — important):** Should members with RSVPs on the cancelled occurrence receive an automated cancellation email via `sendEmail()`? Must be decided before tech-lead finalizes scope.
- **Q3 (next-occurrence skip — almost certainly yes):** Confirm that `generateOccurrences()` should skip cancelled dates when computing the next occurrence shown on the public `/events` list.
- **Q4 (admin list indicator):** Should the admin events table at `/admin/events` show any indicator that a series has cancelled occurrences, or is that detail only on the edit/detail page?
- **Tech-lead must note:** the `cancelled_at` audit column should use `{ withTimezone: true }` to avoid the naive-timestamp bug. The "Cancelled" badge must be driven by the cancellation record's presence (a boolean), not a time comparison.
- **Tech-lead must note:** cancellation records for an occurrence date must remain visible even if the recurrence rule is later edited to exclude that date from the generated list.

### Resolved Open Questions (user — 2026-05-18)

- **Q1 (RSVP fate):** **Keep existing RSVPs + show a "you were signed up for this date" note** to the affected member alongside the Cancelled badge. RSVPs stay in the DB; admin can still see who had signed up.
- **Q2 (auto-email):** **Out of scope** for this work-log. Cancellation does NOT trigger email notifications in v1. A separate work-log entry can pick this up later — the analyst should call this out at Phase 6 as a known follow-up but not a blocker.
- **Q3 (next-occurrence skip):** **Yes, skip cancelled dates** when computing the next occurrence shown on `/events` and anywhere else `generateOccurrences()` is used. Tech-lead must update the helper and all four callers.
- **Q4 (admin list indicator):** **No indicator on the flat `/admin/events` list.** Cancellation visibility lives only on the event detail/edit page. Keeps the list endpoint cheap and the table uncluttered.

---

# Phase 2 — Architectural Review (architect)

## Phase 2 — Architectural Review — 2026-05-18

**Owner:** architect
**Status:** complete

### Summary

Approved with suggestions. The feature fits the existing directory structure without new top-level directories. Three architectural rulings were issued and must be honored by the tech-lead: (1) the new table is named `event_occurrence_overrides`; (2) `occurrence_date` is a plain `date` column (no time component) using Drizzle's `date()` type; (3) the cancel/restore API is a single endpoint at `POST /api/admin/events/[id]/occurrences/[date]/cancel` that accepts `{ cancelled: boolean, reason?: string }`. No new npm package is needed. The "was-signed-up" badge state (Q1 resolution) is a UI-level concern handled by joining `eventRsvps` with the new table; it does not require a new data model concept.

### What I did

- Read the full Phase 1 section including all resolved open questions.
- Read `src/lib/db/schema.ts` — confirmed no per-occurrence override layer exists; confirmed `events.startDate` and `eventRsvps.occurrenceDate` use `timestamp` without timezone (the naive-timestamp bug context).
- Read `src/lib/events.ts` — confirmed `generateOccurrences()` has no exclusion-set parameter; confirmed all callers will need updating per Q3 resolution.
- Read `src/types/events.ts` — confirmed `OccurrenceRow` lacks `isCancelled` and `cancellationReason`.
- Read `src/components/admin/occurrence-rsvp-section.tsx` — confirmed it is already `'use client'`; Cancel/Restore buttons and ConfirmDialog fit naturally here with no boundary change needed.
- Read `src/app/api/admin/events/[id]/route.ts` — confirmed the auth + `hasFeature()` pattern to replicate exactly.
- Read `src/lib/permissions.ts` — confirmed `FEATURES.EVENTS_EDIT` is the correct gate; no new key needed; no migration role binding changes needed.
- Checked `drizzle/migrations/` — next migration number is `0036`.
- Logged DECISION-001 in `docs/decisions.md` covering the three architectural rulings.

### Outputs

- `docs/work-log/2026-05-18-cancel-event-occurrence.md` — Phase 2 section filled in; per-phase-status updated.
- `docs/decisions.md` — DECISION-001 added (table name, occurrence_date column type, cancel endpoint shape).

### Open questions / handoff notes

- **Tech-lead must honor:** `occurrence_date` is a `date` column. The API route segment `[date]` carries a `YYYY-MM-DD` string. The DB query must match on this exact string. No `timestamp` conversion logic touches this column.
- **Tech-lead must honor:** `cancelled_at` uses `timestamp("cancelled_at", { withTimezone: true })`. Never use `timestamp` without `{ withTimezone: true }` for audit timestamps in this project.
- **Tech-lead must honor:** The "Cancelled" badge is driven purely by whether a record exists in `event_occurrence_overrides` for `(eventId, occurrenceDate)`. It is never computed from a time comparison.
- **Tech-lead must honor:** The "was signed up" notice (Q1 resolution) is rendered by the UI when `isCancelled === true && isSignedUp === true` on the `OccurrenceRow`. The server page assembles this by joining `eventRsvps` with `event_occurrence_overrides` for the current user. No new column or table required.
- **Tech-lead must honor:** Cancellation records for a date must remain visible in the admin accordion even if the recurrence rule is later edited so that date falls outside the generated window (Gap 5). The tech-lead must decide how to surface these orphaned records — see Gap 5 in Phase 1.
- **Tech-lead must honor:** `generateOccurrences()` must be updated to accept an optional `cancelledDates: Set<string>` (ISO date strings, `YYYY-MM-DD`) and skip matching dates. All four call sites must pass the cancellation set.
- **Tech-lead must name the implementer.** This feature touches schema + server + client. The correct implementer is `full-stack-developer` unless the tech-lead judges the coupled surface warrants splitting (in which case: database-admin for schema, then api-developer, then ux-developer sequentially).

---

# Phase 3 — Technical Design (tech-lead)

## Technical Design: Cancel a Single Event Occurrence

### Summary

We are adding a cancellation layer to recurring events. An admin can mark any single occurrence of a recurring event series as cancelled (with an optional free-text reason) and later restore it. Cancelled occurrences remain visible on every surface that renders the series — the public event detail page, the member portal events list, and the admin occurrence accordion — but show a "Cancelled" badge instead of a signup button; members who had already RSVP'd for the cancelled date see an additional "You were signed up for this date" note. The cancellation is stored in a new `event_occurrence_overrides` table keyed on `(event_id, occurrence_date)`. The core `generateOccurrences()` helper gains an optional exclusion map so callers can skip cancelled dates when computing future occurrences. Order of work: schema, type changes, helper update + all call-sites, API route, admin Cancel/Restore UI, public/member-portal badge rendering, then release notes.

### Permissions

- **Permission key:** `FEATURES.EVENTS_EDIT` (`"events.edit"`) — existing key. No new key; no new role binding.
- **Default role bindings:** unchanged. Same roles that currently hold `events.edit` (Admin, and any role already granted that feature) can cancel/restore occurrences.

### API Contract

**`POST /api/admin/events/[id]/occurrences/[date]/cancel`**

Purpose: Toggle the cancellation state of a single occurrence. When `cancelled: true`, upserts a row into `event_occurrence_overrides`. When `cancelled: false`, deletes the row.

Route file: `src/app/api/admin/events/[id]/occurrences/[date]/cancel/route.ts`

URL param `[date]`: must match `^\\d{4}-\\d{2}-\\d{2}$`. Reject with 400 if it doesn't parse as a valid calendar date. No timezone conversion — treat as a literal `YYYY-MM-DD` string throughout.

Request body:
```json
{ "cancelled": true, "reason": "No market on July 4" }
{ "cancelled": false }
```
- `cancelled` (boolean, required)
- `reason` (string, optional, max 500 chars — trim on server; ignore if `cancelled: false`)

Auth + permission checks (in this order, returning the appropriate status before touching the DB):
1. `auth()` — if no session: 401
2. `hasFeature(session.user.features, FEATURES.EVENTS_EDIT)` — if false: 403
3. Fetch `events` row by `[id]` — if not found: 404
4. Validate `[date]` against the regex — if invalid: 400

No 409 for "date is not in the recurrence window." The architect ruled the `[date]` param drives the cancel toggle directly. Admins are trusted to know which dates are valid; rejecting valid ISO dates that fall outside the generated window would prevent retroactive cancellation or cancellation of edge-case dates. The admin UI will only surface "Cancel" buttons on rows that are already in the generated list, so the 409 is unnecessary overhead.

Response shape:
- `cancelled: true` → `200 { id, eventId, occurrenceDate, cancelledAt, cancelledByUserId, cancellationReason }`
- `cancelled: false` (restore) → `200 { restored: true }`
- Error responses: `400 { error: string }`, `401 { error: "Unauthorized" }`, `403 { error: "Forbidden" }`, `404 { error: "Event not found" }`

The response on cancel returns the full override row so the client can update state without an extra fetch.

### Data Model

**New table: `eventOccurrenceOverrides`**

Drizzle DSL pseudocode for `src/lib/db/schema.ts`:

```ts
export const eventOccurrenceOverrides = pgTable(
  "event_occurrence_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    occurrenceDate: date("occurrence_date").notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }).notNull(),
    cancelledByUserId: uuid("cancelled_by_user_id")
      .references(() => users.id, { onDelete: "set null" }),
    cancellationReason: text("cancellation_reason"),
  },
  (t) => ({
    uniqueEventDate: unique().on(t.eventId, t.occurrenceDate),
  })
);
```

Notes:
- `occurrenceDate` is a `date` column (`YYYY-MM-DD` string in JS). This is architecturally locked.
- `cancelledAt` uses `{ withTimezone: true }` to avoid the naive-timestamp bug.
- `cancellationReason` is nullable text; no max-length enforcement at the DB level (the API trims and caps at 500 chars).
- The composite unique on `(event_id, occurrence_date)` enforces one record per occurrence per event, which makes upsert / idempotency straightforward.

**Migration file:** `drizzle/migrations/0036_event_occurrence_overrides.sql`

```sql
-- 0036_event_occurrence_overrides.sql
-- Idempotent: safe to re-run on every deploy.

CREATE TABLE IF NOT EXISTS event_occurrence_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  occurrence_date DATE NOT NULL,
  cancelled_at    TIMESTAMPTZ NOT NULL,
  cancelled_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  cancellation_reason  TEXT
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_occurrence_overrides_event_id_occurrence_date_key'
      AND conrelid = 'event_occurrence_overrides'::regclass
  ) THEN
    ALTER TABLE event_occurrence_overrides
      ADD CONSTRAINT event_occurrence_overrides_event_id_occurrence_date_key
      UNIQUE (event_id, occurrence_date);
  END IF;
END $$;
```

### `OccurrenceRow` Type Change

File: `src/types/events.ts`

Add two fields:

```ts
export interface OccurrenceRow {
  date: string;               // ISO timestamp (existing)
  displayDate: string;        // existing
  signedUpCount: number;      // existing
  isSignedUp: boolean;        // existing
  isFull: boolean;            // existing
  isPast: boolean;            // existing
  signees: string[];          // existing
  isCancelled: boolean;       // NEW — true when event_occurrence_overrides row exists
  cancellationReason: string | null; // NEW — null if no reason provided
}
```

The `isCancelled` field drives badge rendering on all public/member-portal surfaces. The `cancellationReason` is shown in subdued text beneath the date label when non-null.

### `generateOccurrences()` Signature Change

**Current signature:**
```ts
export function generateOccurrences(
  event: RecurringEvent,
  from: Date = new Date(),
  maxWeeks = 52
): Date[]
```

**New signature:**
```ts
export function generateOccurrences(
  event: RecurringEvent,
  from: Date = new Date(),
  maxWeeks = 52,
  cancelledDates: Map<string, { reason: string | null }> = new Map()
): Date[]
```

The fourth parameter is a `Map<string, { reason: string | null }>` keyed by `YYYY-MM-DD` ISO date strings. The function filters out any generated `Date` whose `toISOString().slice(0, 10)` key exists in the map. The value shape (with `reason`) is available for callers that build `OccurrenceRow[]` so they can pick up the reason in the same pass without a second lookup.

`getNextOccurrence()` also needs to accept and respect the cancellation map for the Q3 "skip cancelled dates on next-occurrence" behavior (the `/events` list, `/members/events`, and the homepage all call `getNextOccurrence`). Its signature gains the same optional fourth parameter with the same semantics — skip any candidate date whose `YYYY-MM-DD` key is in the map.

**The four `generateOccurrences` call-sites:**

**Call-site 1: `src/app/api/events/[id]/signup/route.ts` (line 91)**
Purpose: validates that a submitted `occurrenceDate` is a legitimate occurrence of the event before accepting the signup.
Change: This call validates whether a date is structurally part of the recurrence rule, not whether it is currently active. A cancelled occurrence is still a structurally valid occurrence — its date was generated by the rule. Blocking signups on cancelled occurrences is the UI's responsibility; the API already rejects past-occurrence signups. Therefore this call-site passes an empty map (the default). The route already returns an error if the occurrence is full or past; the UI should never send a signup for a cancelled occurrence (the button is replaced by a badge), so no server-side cancelled-check is needed here. However, to be safe, add a DB check: if a cancellation record exists for `(eventId, occurrenceDate)`, return `400 { error: "This occurrence has been cancelled" }`. This is a separate DB query in the signup route, not a `generateOccurrences` parameter.
Fetch: none needed via `generateOccurrences`; add a separate `db.query.eventOccurrenceOverrides.findFirst` check.

**Call-site 2: `src/app/events/[id]/page.tsx` (line 96)**
Purpose: builds the `OccurrenceRow[]` array rendered by `OccurrenceSignupList` on the public event detail page.
Change: fetch all cancellation records for this event from `event_occurrence_overrides` before calling `generateOccurrences`. Build the `Map<string, { reason: string | null }>`:
```ts
const overrides = await db
  .select({ occurrenceDate: eventOccurrenceOverrides.occurrenceDate, cancellationReason: eventOccurrenceOverrides.cancellationReason })
  .from(eventOccurrenceOverrides)
  .where(eq(eventOccurrenceOverrides.eventId, id));

const cancelledDates = new Map(
  overrides.map((o) => [o.occurrenceDate, { reason: o.cancellationReason }])
);
```
Pass `cancelledDates` to `generateOccurrences` so cancelled dates are excluded from the generated window for the signup list (members don't need to see cancelled past dates in the signup UI — only active future dates). However, cancelled future dates DO need to appear in the list with the "Cancelled" badge so members can see the series is skipping that date. Resolution: pass the map to `generateOccurrences` but invert the exclusion logic: cancelled dates are NOT excluded from the generated list — they are INCLUDED but flagged. Revise the approach: `generateOccurrences` does NOT skip cancelled dates; instead, the caller uses the map after the fact when building `OccurrenceRow[]` to set `isCancelled` and `cancellationReason`. The function remains purely a date generator; the caller is responsible for the badge data. This is cleaner than filtering inside `generateOccurrences`.

This means the `cancelledDates` map is NOT a filter parameter inside `generateOccurrences`. It is a lookup the callers use when assembling `OccurrenceRow[]`. The architect's spec said `generateOccurrences` "accepts an optional Set<string> and skips matching dates" — this applies to `getNextOccurrence` only (for the public events list next-occurrence computation). The detail-page occurrence list renders cancelled dates with a badge; they should not be skipped there.

Revised function signature for `generateOccurrences`: **unchanged** — no new parameter needed.

`getNextOccurrence` gains the cancellation exclusion parameter:
```ts
export function getNextOccurrence(
  event: RecurringEvent,
  now: Date,
  cancelledDates: Set<string> = new Set()  // YYYY-MM-DD keys
): Date | null
```
Internally, when a candidate date is found, check `cancelledDates.has(candidate.toISOString().slice(0, 10))`; if true, advance to the next candidate.

**The `getNextOccurrence` call-sites** (5 sites, each needs a `cancelledDates` set):

| File | Current call | Change |
|------|-------------|--------|
| `src/app/events/page.tsx` | `getNextOccurrence(event, now)` | Fetch all overrides for all public events in one batch query keyed by eventId; pass per-event set |
| `src/app/members/events/page.tsx` | `getNextOccurrence(e, now)` | Same batch fetch pattern |
| `src/app/members/events/past/page.tsx` | `getNextOccurrence(e, now)` | Same batch fetch pattern |
| `src/app/(dashboard)/admin/events/page.tsx` | `getNextOccurrence(...)` | Same batch fetch pattern |
| `src/app/page.tsx` | `getNextOccurrence(a/b, now)` | Same batch fetch pattern |

The batch query for a page that lists N events:
```ts
const allOverrides = await db
  .select({ eventId: eventOccurrenceOverrides.eventId, occurrenceDate: eventOccurrenceOverrides.occurrenceDate })
  .from(eventOccurrenceOverrides);

const cancelledByEvent = new Map<string, Set<string>>();
for (const o of allOverrides) {
  if (!cancelledByEvent.has(o.eventId)) cancelledByEvent.set(o.eventId, new Set());
  cancelledByEvent.get(o.eventId)!.add(o.occurrenceDate);
}
// then per-event: getNextOccurrence(event, now, cancelledByEvent.get(event.id) ?? new Set())
```

This is a single extra query per page (not N+1). The table is expected to stay small (dozens of rows at most for a club calendar).

**For `generateOccurrences` call-site 2 (`src/app/events/[id]/page.tsx`):** no signature change. The per-event `cancelledDates` Map is used after the fact when building `OccurrenceRow[]`:
```ts
const occurrenceRows = occurrenceDates.map((d) => {
  const key = d.toISOString();
  const dateKey = d.toISOString().slice(0, 10);  // YYYY-MM-DD
  const cancelled = cancelledDates.get(dateKey);
  const count = signupsByDate.get(key) ?? 0;
  return {
    date: key,
    displayDate: format(d, "EEE, MMM d 'at' h:mm a"),
    signedUpCount: count,
    isSignedUp: userSignupDates.has(key),
    isFull: event.maxAttendees != null && count >= event.maxAttendees,
    isPast: d < now,
    signees: signeesByDate.get(key) ?? [],
    isCancelled: cancelled !== undefined,
    cancellationReason: cancelled?.reason ?? null,
  };
});
```

**Call-site 3: `src/app/(dashboard)/admin/events/[id]/page.tsx` (line 76)**
Purpose: builds `occurrenceGroups` for the admin occurrence accordion, using the full series window from `event.startDate` to 520 weeks.
Change: fetch `event_occurrence_overrides` for this event. Add `isCancelled: boolean` and `cancellationReason: string | null` to the `occurrenceGroups` array element type. Use the date map when building each group object — keyed on `YYYY-MM-DD` since that is what the DB stores.

Additionally, cancelled occurrences whose date falls OUTSIDE the generated window (orphaned records) must be surfaced. After building `occurrenceGroups` from `generateOccurrences`, check the cancellation map: any key in the map not present in the generated occurrence list is an orphan. Append those dates to `occurrenceGroups` with `isCancelled: true`, `rows: []`, and a `displayDate` that says e.g. `"Fri, Jul 4, 2025 — Cancelled (outside current recurrence rule)"`. Sort the full list chronologically. This satisfies the architect's Gap 5 ruling: orphaned records are always visible.

The function signature for `generateOccurrences` does not change for this call-site either. The cancellation map is used after generation.

**Summary of function signature changes:**
- `generateOccurrences`: **no change** to signature.
- `getNextOccurrence`: gains optional `cancelledDates: Set<string> = new Set()` as third parameter.

### Component / Page Plan

**Files to create:**
- `src/app/api/admin/events/[id]/occurrences/[date]/cancel/route.ts` — toggle cancel/restore endpoint

**Files to modify:**

Schema and types:
- `src/lib/db/schema.ts` — add `eventOccurrenceOverrides` table
- `src/types/events.ts` — add `isCancelled: boolean` and `cancellationReason: string | null` to `OccurrenceRow`
- `drizzle/migrations/0036_event_occurrence_overrides.sql` — new migration (create)

Helper:
- `src/lib/events.ts` — add optional `cancelledDates: Set<string>` parameter to `getNextOccurrence()` (and its internal `findNextDayOfWeek` helper); no change to `generateOccurrences` signature

Pages that call `getNextOccurrence` (batch-fetch overrides and pass per-event set):
- `src/app/events/page.tsx`
- `src/app/members/events/page.tsx`
- `src/app/members/events/past/page.tsx`
- `src/app/(dashboard)/admin/events/page.tsx`
- `src/app/page.tsx`

Pages that call `generateOccurrences` (fetch overrides and use map when building rows):
- `src/app/events/[id]/page.tsx` — fetch overrides, build `cancelledDates` Map, annotate `OccurrenceRow[]` with `isCancelled` and `cancellationReason`
- `src/app/(dashboard)/admin/events/[id]/page.tsx` — fetch overrides, annotate `occurrenceGroups`, append orphaned cancellation records

API route that validates occurrence signups (separate cancelled check):
- `src/app/api/events/[id]/signup/route.ts` — add DB check for cancellation record before accepting signup; return 400 if cancelled

Admin UI:
- `src/components/admin/occurrence-rsvp-section.tsx` — add `isCancelled: boolean`, `cancellationReason: string | null` to `OccurrenceGroup` interface; add Cancel/Restore buttons on each accordion header row; add `ConfirmDialog` for both actions; add `cancellationReason` textarea inside the cancel ConfirmDialog; wire to the new API endpoint; show "Cancelled" badge on the header row; show RSVP list (preserved) with a note "Signups below were recorded before cancellation" when the row is cancelled

Public / member-portal UI:
- `src/components/events/occurrence-signup-list.tsx` — check `row.isCancelled` before rendering the action button; if true, render a "Cancelled" badge instead; if `row.cancellationReason` is non-null, render it in subdued text; if `row.isCancelled && row.isSignedUp`, render a note "You were signed up for this date" beneath the badge

### Implementation Order

1. **Schema** — create `drizzle/migrations/0036_event_occurrence_overrides.sql` (idempotent) and add `eventOccurrenceOverrides` table to `src/lib/db/schema.ts`.
2. **`OccurrenceRow` type** — add `isCancelled: boolean` and `cancellationReason: string | null` to `src/types/events.ts`.
3. **`getNextOccurrence()` helper** — add `cancelledDates: Set<string>` optional parameter to `src/lib/events.ts` (`getNextOccurrence` and its `findNextDayOfWeek` helper). No change to `generateOccurrences`.
4. **`getNextOccurrence` call-sites** (5 pages) — add batch override fetch and pass per-event cancelled set to each call. Pages: `src/app/events/page.tsx`, `src/app/members/events/page.tsx`, `src/app/members/events/past/page.tsx`, `src/app/(dashboard)/admin/events/page.tsx`, `src/app/page.tsx`.
5. **`generateOccurrences` call-sites** (2 detail pages) — fetch overrides for the event; annotate `OccurrenceRow[]` / `occurrenceGroups` with `isCancelled` and `cancellationReason`; surface orphaned admin cancellation records in the admin accordion. Pages: `src/app/events/[id]/page.tsx`, `src/app/(dashboard)/admin/events/[id]/page.tsx`.
6. **API route** — create `src/app/api/admin/events/[id]/occurrences/[date]/cancel/route.ts` with auth + `hasFeature` guard, date validation, upsert/delete logic, and response shape as specified.
7. **Signup route guard** — add cancelled-occurrence check in `src/app/api/events/[id]/signup/route.ts`.
8. **Admin UI** — update `src/components/admin/occurrence-rsvp-section.tsx` with Cancel/Restore buttons, `ConfirmDialog`, cancellation reason textarea, "Cancelled" badge, and preserved RSVP list note.
9. **Public/member-portal badge** — update `src/components/events/occurrence-signup-list.tsx` with `isCancelled` check, "Cancelled" badge, reason text, and "You were signed up for this date" note.
10. **Release notes** — write entry via `/release-notes` skill.

### Edge Cases & Risks

**1. Admin double-clicks Cancel rapidly.**
The upsert is idempotent: `INSERT INTO event_occurrence_overrides ... ON CONFLICT (event_id, occurrence_date) DO UPDATE SET cancelled_at = EXCLUDED.cancelled_at, ...`. A second request within milliseconds will overwrite the first with the same data. The button goes into a loading state on click (`disabled` while the fetch is in flight), so double-click is unlikely from the UI, but the DB op is safe regardless.

**2. Restore (cancel then un-cancel).**
The architect ruled: on restore, DELETE the row from `event_occurrence_overrides`. The row is not kept with `cancelled_at = null`. Rationale: the table schema has `cancelled_at NOT NULL`, so a "null cancelled_at" state is not representable. Absence of a row means "not cancelled." This keeps the schema clean and the badge-check logic simple (`WHERE event_id = $1 AND occurrence_date = $2` — if no row, not cancelled). Historical audit information is limited to `cancelled_by_user_id` on the most recent cancellation record; that is acceptable per the Phase 1 out-of-scope ruling on cancellation audit logs.

**3. Orphaned cancellation records.**
When an admin edits the recurrence rule and a previously cancelled date falls outside the new generated window, the approach is: **option (a) — always surface orphans in the admin accordion**. After building `occurrenceGroups` from `generateOccurrences`, scan the `cancelledDates` map for keys not present in any generated occurrence's `YYYY-MM-DD` date. Append those as accordion rows with `isCancelled: true`, `rows: []`, and a display label that includes "outside current recurrence rule." Sort the combined list chronologically. Admins can then Restore (which deletes the record) to clean up if desired. This approach is chosen over option (b) (warn on recurrence edit) because it requires no changes to the event-edit form and keeps the warning logic simple. Option (c) (leave invisible) was rejected because hidden cancellation records are a data integrity risk.

**4. RSVP count math on cancelled rows.**
Cancelled occurrence rows retain their existing RSVPs in `eventRsvps` (the Phase 1 decision). The `signedUpCount` on a cancelled `OccurrenceRow` reflects actual RSVPs in the DB. The count is shown in the admin accordion (so admins can see "3 people were signed up") but is suppressed from the public/member badge row — on a cancelled occurrence, showing "3 / 20 spots" is confusing when signups are not possible. Implementation: in `OccurrenceSignupList`, when `row.isCancelled === true`, render neither the count line nor the action button — just the "Cancelled" badge and optional reason text. In the admin accordion header, always show the count (useful administrative data).

**5. Past occurrence cancellation.**
Admins may cancel a past date retroactively — e.g., to accurately record that the July 4 market did not happen. This is allowed. The API has no date-in-future restriction on the `[date]` param. The admin UI must not gray out the Cancel button on past occurrence rows (currently `isPast` only reduces opacity; the RSVP add/remove controls are unaffected). The "Cancelled" badge on a past occurrence in the public/member list is surfaced at the caller's discretion — since `isPast` rows are already shown with reduced opacity, the badge simply replaces the "Closed" state indicator.

**6. `cancelled_at` timezone.**
The column uses `timestamp("cancelled_at", { withTimezone: true })`. Set it to `new Date()` (UTC) on the server at insert time. The admin sees `cancelled_at` in the accordion only if we choose to display it — for v1 we do not display it. The field exists for audit purposes. No naive-timestamp risk for the "Cancelled" badge because the badge is driven by record existence, not a time comparison.

**7. Schema.org JSON-LD.**
The `eventStatus: "EventCancelled"` flag in the JSON-LD block on `/events/[id]/page.tsx` applies to the whole event, not individual occurrences. It is left unchanged in v1 (Gap 7 from Phase 1 is confirmed out of scope). Structured-data accuracy for individual cancelled occurrences is not achievable with the current schema.org spec.

### Implementer

**`full-stack-developer`**

Rationale: the feature is tightly coupled across schema, API, and multiple UI surfaces. Splitting it between three agents (db-admin → api-developer → ux-developer) would require three sequential handoffs and three rounds of context rebuilding for a feature that is ultimately small-to-medium in scope. The schema change is a single table with a straightforward migration. The API route is a single toggle endpoint. The UI changes touch three existing components and five list pages (all are additive changes, not redesigns). A single full-stack-developer pass is the minimum-complexity path. The implementer should work strictly in the order defined in Implementation Order above — schema first, then types, then helper, then call-sites, then API, then signup guard, then admin UI, then public UI.

---

## Phase 3 — Technical Design — 2026-05-18

**Owner:** tech-lead
**Status:** complete

### Summary

The design covers a new `event_occurrence_overrides` table (one row per cancelled occurrence), a toggle endpoint at `POST /api/admin/events/[id]/occurrences/[date]/cancel`, `OccurrenceRow` type additions, a targeted change to `getNextOccurrence()` (not `generateOccurrences`), and additive rendering changes across three components and seven pages. The architect's three suggestions are all resolved with explicit calls below.

### What I did

- Read the full Phase 1 and Phase 2 work-log sections and DECISION-001.
- Grepped `src/` for all `generateOccurrences` and `getNextOccurrence` call-sites; found 3 `generateOccurrences` call-sites and 5 `getNextOccurrence` call-sites (the "4 call-sites" framing in the architect's handoff notes was approximate — the full set is documented above).
- Read `src/lib/events.ts`, `src/types/events.ts`, `src/components/admin/occurrence-rsvp-section.tsx`, `src/components/events/occurrence-signup-list.tsx`, and all 7 affected pages.
- Confirmed `drizzle/migrations/` last file is `0035_members_email_not_null.sql`; next number is `0036` as the architect noted.
- Confirmed `date` is already imported in `schema.ts`; no new Drizzle import needed.
- Made three implementation decisions (logged below) and resolved all three architect suggestions.

### Outputs

- `docs/work-log/2026-05-18-cancel-event-occurrence.md` — Phase 3 section written; per-phase-status updated.

Implementation decisions to log in `docs/decisions.md` after this phase:
- **DECISION-002:** `generateOccurrences` signature is unchanged; only `getNextOccurrence` gains the `cancelledDates: Set<string>` exclusion parameter. Cancelled dates are not filtered from the occurrence list on detail pages — they are flagged with `isCancelled: true` so the badge renders. This preserves the admin's ability to see and manage cancelled dates in the occurrence list.
- **DECISION-003:** Orphaned cancellation records are surfaced in the admin accordion as extra rows labeled "outside current recurrence rule" rather than warning at recurrence-rule edit time. Admins can Restore (delete) the record to clean up.
- **DECISION-004:** `signedUpCount` is suppressed from the public/member cancelled occurrence row; the admin accordion always shows the count.

### Open questions / handoff notes

No unresolved product questions remain. All Phase 1 gaps are closed. Implementer: **full-stack-developer**.

Handoff checklist for the implementer:
- `occurrence_date` in the new table is a `date` column — the Drizzle type returns a `string` (`YYYY-MM-DD`) in JavaScript, not a `Date` object. When building the `cancelledDates` Map/Set, use the string directly; do not call `new Date()` on it.
- The `cancelledDates` Set passed to `getNextOccurrence` must use `YYYY-MM-DD` keys. Generate them with `d.toISOString().slice(0, 10)` when iterating over `Date` objects.
- The admin accordion already has `'use client'` at the top; no boundary change needed. State for `isCancelled` / `cancellationReason` on each group must be managed with `useState` (same pattern as `rows`).
- The restore action deletes the DB row. On success, set `isCancelled: false` and `cancellationReason: null` in local state.
- `ConfirmDialog` from `@/components/ui/confirm-dialog` is required for both Cancel and Restore confirmations. The Cancel dialog needs a `<textarea>` for the optional reason inside the dialog body — use the `children` prop of `ConfirmDialog` if it supports it, or use a regular shadcn `Dialog` for the cancel flow (which has a reason field) and reserve `ConfirmDialog` for the simpler Restore flow.
- No email notifications. Do not call `sendEmail()`.
- The signup route guard (step 7) is a separate `db.query` before the existing RSVP logic — do not modify `generateOccurrences` call at line 91 for this guard.

---

## Phase 4 — Implementation (full-stack) — 2026-05-18

**Owner:** full-stack-developer
**Status:** complete

### Summary

Implemented the full cancel-a-single-occurrence feature end-to-end: new `event_occurrence_overrides` table + idempotent migration, `OccurrenceRow` type additions, `getNextOccurrence` exclusion parameter, batch override fetch on all 5 call-sites, admin Cancel/Restore UI, public/member-portal badge rendering, signup route guard, and release notes. `pnpm exec tsc --noEmit` and `pnpm build:only` both pass clean.

### What I did

- Created `drizzle/migrations/0036_event_occurrence_overrides.sql` (fully idempotent) and added `eventOccurrenceOverrides` table to `src/lib/db/schema.ts` with `unique()` composite constraint on `(event_id, occurrence_date)`.
- Added `isCancelled: boolean` and `cancellationReason: string | null` to `OccurrenceRow` in `src/types/events.ts`.
- Updated `getNextOccurrence` and its `findNextDayOfWeek` helper in `src/lib/events.ts` to accept optional `cancelledDates: Set<string>` and skip matching dates. `generateOccurrences` signature is unchanged (DECISION-002).
- Added batch `eventOccurrenceOverrides` fetch + `cancelledByEvent` map to all 5 `getNextOccurrence` call-sites: `src/app/events/page.tsx`, `src/app/members/events/page.tsx`, `src/app/members/events/past/page.tsx`, `src/app/(dashboard)/admin/events/page.tsx`, `src/app/page.tsx`.
- Updated `src/app/events/[id]/page.tsx` to fetch per-event overrides and annotate `OccurrenceRow[]` with `isCancelled`/`cancellationReason` using a `YYYY-MM-DD` key map (no TZ conversion on the `date` column value).
- Updated `src/app/(dashboard)/admin/events/[id]/page.tsx` to fetch overrides, annotate `occurrenceGroups` with `isCancelled`/`cancellationReason`/`isOrphan`, and surface orphaned cancellation records as extra accordion rows labelled "outside current recurrence rule" (DECISION-003), sorted chronologically.
- Created `src/app/api/admin/events/[id]/occurrences/[date]/cancel/route.ts` — `POST` endpoint with `auth()` + `session.user.features?.includes(FEATURES.EVENTS_EDIT)` guard, `YYYY-MM-DD` date validation, upsert-on-cancel / delete-on-restore logic.
- Added cancelled-occurrence guard to `src/app/api/events/[id]/signup/route.ts` — checks `eventOccurrenceOverrides` by `YYYY-MM-DD` key before accepting a signup; returns `400` if cancelled.
- Rewrote `src/components/admin/occurrence-rsvp-section.tsx` — `OccurrenceGroup` interface gains `isCancelled`, `cancellationReason`, `isOrphan`; Cancel button opens a Radix Dialog (chosen because `ConfirmDialog` has no `children` prop and we need a textarea for the reason); Restore uses `ConfirmDialog`; both actions call the new API; state updated locally on success; add/remove controls suppressed on cancelled rows; RSVP list preserved with "recorded before cancellation" note (DECISION-004).
- Updated `src/components/events/occurrence-signup-list.tsx` — `isCancelled` check renders amber "Cancelled" badge; signup count suppressed on cancelled rows (DECISION-004); `cancellationReason` shown in italic; "You were signed up for this date" note when `isCancelled && isSignedUp`.
- Ran `pnpm db:migrate` locally — migration applied successfully.
- Created `docs/release-notes/v1.13.md`; bumped `package.json` to `1.13.0`; added nav link to `v1.12.md`.

### Outputs

- `drizzle/migrations/0036_event_occurrence_overrides.sql` — new migration; idempotent via `CREATE TABLE IF NOT EXISTS` and `DO $$ … END $$` constraint guard
- `src/lib/db/schema.ts` — `eventOccurrenceOverrides` table added
- `src/types/events.ts` — `OccurrenceRow` extended
- `src/lib/events.ts` — `getNextOccurrence` + `findNextDayOfWeek` gain `cancelledDates: Set<string>` param
- `src/app/events/page.tsx` — batch override fetch + `getNextOccurrence` updated
- `src/app/members/events/page.tsx` — same
- `src/app/members/events/past/page.tsx` — same
- `src/app/(dashboard)/admin/events/page.tsx` — same
- `src/app/page.tsx` — same; `EventRow` type gains `id` field (was already in the select, type was missing it)
- `src/app/events/[id]/page.tsx` — per-event override fetch + `OccurrenceRow[]` annotation
- `src/app/(dashboard)/admin/events/[id]/page.tsx` — override fetch + orphan detection (DECISION-003)
- `src/app/api/admin/events/[id]/occurrences/[date]/cancel/route.ts` — new; `POST`, auth + `FEATURES.EVENTS_EDIT`, cancel/restore toggle
- `src/app/api/events/[id]/signup/route.ts` — cancelled-occurrence guard added
- `src/components/admin/occurrence-rsvp-section.tsx` — Cancel/Restore buttons + dialogs; badge; preserved RSVP note
- `src/components/events/occurrence-signup-list.tsx` — cancelled badge + reason + "was signed up" note
- `docs/release-notes/v1.13.md` — new file
- `package.json` — version bumped to `1.13.0`

### Open questions / handoff notes

- **For QA to verify in the browser:**
  - Admin flow: navigate to `/admin/events/[id]` for a recurring event; click "Cancel" on an upcoming occurrence; confirm with an optional reason; verify the row shows the amber "Cancelled" badge and reason; verify the "Cancel" button becomes "Restore"; click "Restore" and confirm the row returns to normal.
  - Public badge: navigate to `/events/[id]` for the same recurring event; verify the cancelled occurrence shows the amber "Cancelled" badge and reason text; verify no signup button is present; verify other occurrences still show the signup button.
  - "Was signed up" note: as a signed-in member who has an RSVP on the cancelled occurrence, verify the "You were signed up for this date" note appears.
  - Signup guard: attempt to POST `{ occurrenceDate: <cancelled ISO timestamp> }` to `/api/events/[id]/signup`; expect `400 { error: "This occurrence has been cancelled" }`.
  - Next-occurrence skip: cancel the next occurrence for a recurring series and verify the public `/events` list shows the following uncancelled date (not the cancelled one).
  - Orphan row: edit a recurring event's recurrence rule so that a previously cancelled date falls outside the new window; verify the admin accordion shows the orphan row labelled "outside current recurrence rule."
- **No open product questions.** All Phase 1 gaps are resolved.
- **Follow-up (not a blocker):** cancellation email notification to RSVP'd members — explicitly deferred to a future work-log per user's Q2 decision. The analyst should call this out in Phase 6 as a known follow-up.
- **Next phase:** qa (Phase 5).

---

## Loop-back from Phase 5 (2026-05-18)

**Owner:** full-stack-developer

**Bug fixed:** `src/components/admin/occurrence-rsvp-section.tsx` lines 86–92 — `occurrenceDateKey` IIFE used local-time getters (`getFullYear`, `getMonth`, `getDate`) instead of `toISOString().slice(0, 10)` (UTC). The server stores `occurrence_date` as a UTC date string; for late-evening Ohio events (after 8 PM EDT = after midnight UTC) the client and server would disagree by one day, causing the cancel/restore API call to target the wrong date and no badge to appear.

**Fix applied:** Replaced the seven-line IIFE with the single expression `new Date(group.date).toISOString().slice(0, 10)`. The updated comment accurately describes the UTC convention that must match `event_occurrence_overrides.occurrence_date`.

**Audit for same pattern:**
- `src/components/admin/occurrence-rsvp-section.tsx` — single instance found and fixed; both the cancel and restore handlers consume `occurrenceDateKey` which is now derived correctly. No other local-time getter usage for date-key derivation in this file.
- `src/components/events/occurrence-signup-list.tsx` — no date keys sent to the server; only renders. No fix needed.
- All other Phase 4 files (`src/app/events/[id]/page.tsx`, `src/app/(dashboard)/admin/events/[id]/page.tsx`, `src/app/api/admin/events/[id]/occurrences/[date]/cancel/route.ts`, `src/app/api/events/[id]/signup/route.ts`) use `.toISOString().slice(0, 10)` consistently — no naive-timestamp instances found.

**Gates re-cleared:**
- `pnpm exec tsc --noEmit`: PASS (no output)
- `pnpm build:only`: PASS (77 static + dynamic routes; no warnings)
- `pnpm test`: PASS — 26/26 tests (17 regression tests QA added still pass)

**Ready for qa re-verification (Phase 5).**

---

# Phase 5 — Verification (qa)

## Phase 5 — Verification — 2026-05-18

**Owner:** qa
**Status:** blocked — one bug found; returning to Phase 4

### Summary

FAIL. The TypeScript typecheck, production build, Vitest unit tests, and dev-server smoke test all pass. Regression tests were added and pass (26/26). One bug was found during code review: `occurrence-rsvp-section.tsx` derives the `YYYY-MM-DD` key it sends to the cancel API using **local-time** date getters (`d.getFullYear()`, `d.getMonth()`, `d.getDate()`), but the server stores and matches on the **UTC** date from the ISO timestamp. These disagree for any event whose UTC timestamp crosses midnight — a common case for late-evening Ohio events (which appear as early-AM UTC). The cancel button would silently send the wrong date to the API, the upsert would create an override row for the wrong date, and the "Cancelled" badge would never appear. Returning to Phase 4 (full-stack-developer) with the specific bug and fix below.

### What I did

1. **Type check** — `pnpm exec tsc --noEmit`: PASS (no output — clean).

2. **Vitest unit tests** — `pnpm test` (pre-regression-test run): PASS — 9/9 tests, 317ms.

3. **Regression tests written** — added to `src/lib/events.test.ts`:
   - `cancelledDates` skip for weekly events (single, multiple consecutive, all cancelled within window)
   - `cancelledDates` skip for monthly events
   - Empty `cancelledDates` set is equivalent to no argument
   - `getNextOccurrence` biweekly path (two tests: base case + cancelled skip)
   - `generateOccurrences` suite: non-recurring, weekly within window, from-date boundary, biweekly alternation, monthly day-of-month, recurrenceEndDate respect
   - `isValidOccurrence` suite: exact match, no match, 30-second drift tolerance, > 30-second drift returns false

4. **Vitest unit tests (post-regression)** — `pnpm exec vitest run`: PASS — 26/26 tests, 200ms.

5. **Coverage** — `pnpm exec vitest run --coverage`:
   - `src/lib/events.ts`: 92.92% statements / 79.82% branches / 87.5% functions / 94.17% lines — **above the 90% statement target**.
   - `src/lib/permissions.ts`: 100% branches (constants-only module; V8 does not count constant declarations as callable functions/statements — no test harness needed beyond what the typecheck provides).
   - `src/lib/members.ts`: 0% — DB-bound logic; covered by e2e per spec, not flagged as a new gap introduced by this feature.

6. **Production build** — `pnpm build:only`: PASS.
   - 110 routes compiled; new route `/api/admin/events/[id]/occurrences/[date]/cancel` appears in manifest.
   - No unused-export warnings, no server/client boundary errors.

7. **Dev-server smoke test** — `pnpm dev` (port 3002, Turbopack, ready in 1308ms):
   - `GET /` → HTTP 200 (homepage).
   - `GET /events` → HTTP 200 (public events list; batch override fetch path exercised by the page code).
   - `GET /members/events` (unauthenticated) → HTTP 307 redirect to `/signin` — correct auth gate.
   - `GET /admin/events` (unauthenticated) → HTTP 307 redirect — correct auth gate.
   - `POST /api/admin/events/[id]/occurrences/[date]/cancel` (no session) → `{"error":"Unauthorized"}` HTTP 401 — permission gate fires before any DB access.
   - Migration startup log confirms `event_occurrence_overrides` table already exists; migration is idempotent.

8. **Code-review finding** — bug found in `src/components/admin/occurrence-rsvp-section.tsx` (see below).

### Outputs

- `src/lib/events.test.ts` — 17 new tests added (26 total); all pass.
- `docs/work-log/2026-05-18-cancel-event-occurrence.md` — Phase 5 section written; per-phase-status updated to blocked/FAIL.

### Bug Found — must be fixed before Phase 5 can PASS

**File:** `src/components/admin/occurrence-rsvp-section.tsx`
**Lines:** 86–92 (`occurrenceDateKey` computation)
**Classification:** Phase 4 defect — incorrect timezone handling

**Symptom:** The cancel button on the admin occurrence accordion sends the wrong `YYYY-MM-DD` date string to `POST /api/admin/events/[id]/occurrences/[date]/cancel` for events whose UTC timestamp crosses midnight.

**Root cause:** The client derives the date key using local-time getters:
```ts
const d = new Date(group.date);
const year = d.getFullYear();   // LOCAL time
const month = String(d.getMonth() + 1).padStart(2, "0"); // LOCAL time
const day = String(d.getDate()); // LOCAL time
```
The comment says "we take the UTC date portion" but that is incorrect — `getFullYear()`, `getMonth()`, and `getDate()` return **local** time, not UTC. The server stores the override's `occurrence_date` as `d.toISOString().slice(0, 10)` (UTC). For an Ohio event at 8:30 PM EDT (00:30 AM UTC next day), the client would send `YYYY-MM-DD` for one day while the server would match on the next day.

**Reproduction:** Create a recurring event with a start time between 8:00 PM and 11:59 PM EDT (00:00–03:59 UTC next day). In an EDT browser, navigate to `/admin/events/[id]`; click "Cancel" on one of those late-evening occurrences. The API receives the local date (one day prior to UTC date). The upsert writes the wrong `occurrence_date`. The page then reloads the overrides using the UTC key — no badge appears because no record matches the UTC key.

**Fix:** Replace the local-time computation with:
```ts
const occurrenceDateKey = new Date(group.date).toISOString().slice(0, 10);
```
One line change. The comment can be updated to "We use the UTC date portion from the ISO string — this must match the format stored in event_occurrence_overrides.occurrence_date."

**Returning to:** Phase 4 — full-stack-developer. Fix the one-line bug in `occurrence-rsvp-section.tsx` and re-run `pnpm exec tsc --noEmit` and `pnpm build:only` to confirm the fix is clean. Then hand back to Phase 5.

### Manual Click-Through — Pending User Verification

The following flows require a logged-in browser session and cannot be machine-verified without OAuth or password credentials. These must be confirmed by the user after the Phase 4 bug fix is applied:

| Flow | Result | Steps for user |
|------|--------|----------------|
| Admin cancels an occurrence with reason | manual — pending user verification | `/admin/events/[id]` for a recurring event → click "Cancel" on an upcoming row → enter reason → confirm. Expect: amber "Cancelled" badge + reason text; "Cancel" button becomes "Restore". Toast: "Occurrence cancelled." |
| Admin cancels without reason | manual — pending user verification | Same as above but leave reason textarea blank. Expect: amber badge; no reason text shown. |
| Admin restores a cancelled occurrence | manual — pending user verification | On a cancelled row, click "Restore" → confirm. Expect: row returns to normal; "Restore" button becomes "Cancel". Toast: "Occurrence restored." |
| Public `/events/[id]` shows cancelled badge | manual — pending user verification | Visit the public event detail page after cancelling an occurrence. Expect: cancelled row shows amber "Cancelled" badge and reason (if provided); no "Sign Up" button on that row. Other rows unaffected. |
| Public `/events` list skips cancelled next occurrence | manual — pending user verification | Cancel the first upcoming occurrence of a recurring series. Reload `/events`. Expect: the series card shows the second upcoming date (not the cancelled one). |
| Member portal "You were signed up" note | manual — pending user verification | As member A, sign up for occurrence X. As admin, cancel occurrence X. As member A, visit `/events/[id]`. Expect: occurrence X row shows "Cancelled" badge + "You were signed up for this date." |
| Member signup blocked on cancelled occurrence | manual — pending user verification | Attempt `POST /api/events/[id]/signup` with the ISO timestamp of a cancelled occurrence (use curl or browser DevTools). Expect: `400 { "error": "This occurrence has been cancelled" }`. |
| Orphan occurrence row | manual — pending user verification | Cancel an occurrence; then edit the event's recurrence rule so that date is no longer in the generated window; reload admin page. Expect: accordion shows extra row labelled "— Cancelled (outside current recurrence rule)". |
| Permission gate: non-admin calls cancel endpoint | manual — pending user verification | Log in as a user without `events.edit`; call `POST /api/admin/events/[id]/occurrences/[date]/cancel` with a valid session cookie. Expect: `403 { "error": "Forbidden" }`. |

### Type Check
`pnpm exec tsc --noEmit`: PASS

### Unit Tests
`pnpm test` (post-regression-tests): PASS
Total: 26 | Passed: 26 | Failed: 0
Duration: 200ms

### Production Build
`pnpm build:only`: PASS
Notes: 110 routes; `/api/admin/events/[id]/occurrences/[date]/cancel` appears in manifest; no warnings.

### Dev-Server Smoke Test
`pnpm dev`: PASS (routes load; auth gates fire correctly; migration idempotency confirmed)

### End-to-End Tests
Not run — `playwright.config.ts` exists but the manual click-through flows above require a browser session. All e2e flows are tagged "manual — pending user verification" above.

### Regression Tests Added
- `getNextOccurrence skips a cancelled weekly occurrence` — `src/lib/events.test.ts` — guards against: cancelled-date skip not working in `getNextOccurrence` for weekly series (core of DECISION-002)
- `getNextOccurrence skips multiple consecutive cancelled weekly occurrences` — `src/lib/events.test.ts` — guards against: only the first cancelled date being skipped
- `getNextOccurrence returns null when all remaining occurrences are cancelled` — `src/lib/events.test.ts` — guards against: infinite loop or wrong fallback when entire window is cancelled
- `getNextOccurrence skips a cancelled monthly occurrence` — `src/lib/events.test.ts` — guards against: monthly path not respecting cancelledDates
- `getNextOccurrence empty cancelledDates is equivalent to no argument` — `src/lib/events.test.ts` — guards against: default-parameter regression
- `getNextOccurrence biweekly base case` — `src/lib/events.test.ts` — guards against: biweekly path regression
- `getNextOccurrence skips a cancelled biweekly occurrence` — `src/lib/events.test.ts` — guards against: biweekly cancel-skip not working
- `generateOccurrences non-recurring returns single element` — `src/lib/events.test.ts` — guards against: non-recurring path regression
- `generateOccurrences weekly within window` — `src/lib/events.test.ts` — guards against: weekly generation regression
- `generateOccurrences respects from parameter` — `src/lib/events.test.ts` — guards against: from-date boundary regression
- `generateOccurrences biweekly alternation` — `src/lib/events.test.ts` — guards against: biweekly week-alternation logic regression
- `generateOccurrences monthly day-of-month` — `src/lib/events.test.ts` — guards against: monthly date drift
- `generateOccurrences respects recurrenceEndDate` — `src/lib/events.test.ts` — guards against: series overrunning its end date
- `isValidOccurrence exact match` — `src/lib/events.test.ts` — guards against: isValidOccurrence regression
- `isValidOccurrence no match` — `src/lib/events.test.ts` — guards against: false positives
- `isValidOccurrence 30-second drift tolerance` — `src/lib/events.test.ts` — guards against: clock-drift tolerance regression
- `isValidOccurrence more than 30 seconds returns false` — `src/lib/events.test.ts` — guards against: over-tolerance (accepts times too far from the occurrence)

### Coverage on Critical Modules
- `src/lib/events.ts`: 92.92% statements / 79.82% branches — above the 90% target
- `src/lib/permissions.ts`: 100% branches (constants-only; no function bodies to invoke)
- `src/lib/members.ts`: 0% — DB-bound; covered by e2e per spec

### Verdict: FAIL

One bug must be fixed before Phase 5 can pass. Returning to Phase 4 (full-stack-developer).

### Open questions / handoff notes

- **Bug fix for Phase 4:** Change `occurrenceDateKey` in `src/components/admin/occurrence-rsvp-section.tsx` lines 86–92 from local-time getters to `new Date(group.date).toISOString().slice(0, 10)`. This is a one-line change.
- **After fix:** re-run `pnpm exec tsc --noEmit` and `pnpm build:only`, then hand back to Phase 5 for re-verification.
- **Manual click-through still required:** all nine flows in the table above must be confirmed by the user in a real browser after the fix. Phase 5 cannot issue PASS without that confirmation.
- **No open product questions.** All Phase 1 gaps remain closed.
- **Email follow-up** (deferred by user Q2 decision): analyst should call this out in Phase 6 as a known open item — members who RSVP'd to a cancelled occurrence receive no notification in v1.

---

## Re-verification — 2026-05-18

**Owner:** qa
**Status:** complete — machine gates PASS; manual click-through pending user verification

### Summary

PASS (machine-verifiable gates). The one-line fix was applied exactly as prescribed: `occurrenceDateKey` in `src/components/admin/occurrence-rsvp-section.tsx` (line 85) is now `new Date(group.date).toISOString().slice(0, 10)` — UTC extraction, replacing the local-time IIFE. Both the cancel handler (line 91) and the restore handler (line 118) consume this corrected key. No local-time `getFullYear`/`getMonth`/`getDate` calls remain in the file for date-key derivation. All three machine gates are green and the target route is confirmed in the build manifest.

### What I verified

- **Diff review:** `occurrence-rsvp-section.tsx` lines 81–85 — UTC comment accurate; `occurrenceDateKey = new Date(group.date).toISOString().slice(0, 10)`; both handlers reference `occurrenceDateKey`. Fix matches prescription exactly.
- **Type check** — `pnpm exec tsc --noEmit`: PASS (no output — clean).
- **Unit tests** — `pnpm test`: PASS — 26/26 tests, 244ms. The 17 regression tests added during the original Phase 5 pass all continue to pass.
- **Production build** — `pnpm build:only`: PASS — 110 routes compiled; `/api/admin/events/[id]/occurrences/[date]/cancel` confirmed in manifest; no warnings, no boundary errors.

### Type Check
`pnpm exec tsc --noEmit`: PASS

### Unit Tests
`pnpm test`: PASS
Total: 26 | Passed: 26 | Failed: 0
Duration: 244ms

### Production Build
`pnpm build:only`: PASS
Notes: 110 routes; `/api/admin/events/[id]/occurrences/[date]/cancel` present in manifest; no unused-export warnings.

### Verdict: PASS (machine gates)

All machine-verifiable gates are clean and the bug is fixed. Phase 6 is unblocked pending user confirmation of the nine manual flows below.

### Manual Click-Through — Still Pending User Verification

These nine flows require a logged-in browser session. They must be confirmed by the user before analyst's Phase 6 sign-off:

1. Admin cancels an occurrence with reason (`/admin/events/[id]` → "Cancel" → enter reason → confirm; expect amber badge + reason; button becomes "Restore").
2. Admin cancels without reason (same flow, leave reason blank; expect amber badge, no reason text).
3. Admin restores a cancelled occurrence ("Restore" → confirm; row returns to normal; button becomes "Cancel").
4. Public `/events/[id]` shows cancelled badge (amber "Cancelled" badge + reason; no "Sign Up" button on that row; other rows unaffected).
5. Public `/events` list skips cancelled next occurrence (cancel first upcoming occurrence; reload `/events`; series card shows second upcoming date).
6. Member portal "You were signed up" note (sign up for occurrence X as member A; admin cancels it; member A sees "You were signed up for this date" beneath the badge).
7. Signup blocked on cancelled occurrence (`POST /api/events/[id]/signup` with the cancelled occurrence ISO timestamp; expect `400 { "error": "This occurrence has been cancelled" }`).
8. Orphan occurrence row (cancel occurrence; edit recurrence rule to exclude that date; reload admin page; expect accordion row labelled "— Cancelled (outside current recurrence rule)").
9. Permission gate: non-admin calls cancel endpoint (`POST /api/admin/events/[id]/occurrences/[date]/cancel` with a valid session lacking `events.edit`; expect `403 { "error": "Forbidden" }`).

### Open questions / handoff notes

- Phase 6 (analyst) is unblocked for machine-gate purposes. Analyst should wait for user to confirm the nine manual flows before issuing final SHIP IT.
- **Email follow-up** (deferred by user Q2 decision): analyst should call this out in Phase 6 as a known open item.

---

# Phase 6 — Shipped vs Intent (analyst)

## Phase 6 — Shipped vs Intent — 2026-05-18

**Owner:** analyst
**Status:** complete

### Summary

SHIP WITH NOTES. The shipped feature matches Phase 1 intent across every flow that can be verified statically. The data model, API contract, permission gate, date-key convention, and UI rendering all align with what was specified. The one Phase 4 defect (local-time date-key derivation in the cancel route call) was caught by QA and fixed before re-verification — and the fix is confirmed present in the code. Nine manual click-through flows remain unverified because they require a live browser session; this is the sole reason for SHIP WITH NOTES rather than SHIP IT. No regressions were found; no static checks failed.

### What I did

- Re-read the full work-log (Phases 1–5 plus the loop-back fix note and re-verification).
- Read `docs/decisions.md` — confirmed DECISION-001 through DECISION-004 are all reflected in the shipped code.
- Read and spot-checked all key shipped files: `drizzle/migrations/0036_event_occurrence_overrides.sql`, `src/lib/db/schema.ts` (eventOccurrenceOverrides table), `src/types/events.ts` (OccurrenceRow), `src/lib/events.ts` (getNextOccurrence + findNextDayOfWeek), `src/app/api/admin/events/[id]/occurrences/[date]/cancel/route.ts`, `src/app/api/events/[id]/signup/route.ts`, `src/components/admin/occurrence-rsvp-section.tsx`, `src/components/events/occurrence-signup-list.tsx`, `src/app/(dashboard)/admin/events/[id]/page.tsx`, and `src/app/events/page.tsx`.
- Ran five static spot-checks (empty state, permission gate, migration idempotency, native browser dialogs, naive-timestamp post-fix).
- Walked every Phase 1 user verb and flow against the code.

### Outputs

- `docs/work-log/2026-05-18-cancel-event-occurrence.md` — Phase 6 section filled in; per-phase-status updated.

### Intent-vs-Shipped Diff

**User Verbs — Admin surface:**

- Phase 1 said: admin clicks "Cancel" on a specific occurrence row in the "Signups by Occurrence" accordion. Shipped: `occurrence-rsvp-section.tsx` renders a "Cancel" button per accordion header row; button is suppressed for orphan rows (which have no valid ISO date to send). Verdict: matches. The orphan suppression is a sound implementation detail not in Phase 1 but consistent with the spirit.
- Phase 1 said: admin types an optional cancellation reason. Shipped: Radix Dialog (not ConfirmDialog) hosts a `<textarea maxLength={500}>` inside the modal. Tech-lead's handoff notes pre-authorized this deviation because ConfirmDialog has no `children` prop. Verdict: acceptable drift — reason captured in Phase 3 handoff note.
- Phase 1 said: admin confirms via `<ConfirmDialog>` (must not use `window.confirm()`). Shipped: cancel uses Radix Dialog (with "Cancel Occurrence" / "Dismiss" buttons), restore uses `<ConfirmDialog>`. No `window.confirm` anywhere in the modified files (statically verified). Verdict: acceptable drift — the Phase 3 note explicitly anticipated this split.
- Phase 1 said: occurrence row immediately shows "Cancelled" badge and reason after confirmation. Shipped: `isCancelled` and `cancellationReason` state updated from the API response in `handleCancel()`; no optimistic update (correct — destructive action). Toast "Occurrence cancelled." confirmed in code. Verdict: matches.
- Phase 1 said: "Cancel" button replaced by "Restore." Shipped: button renders conditionally on `isCancelled` state — `Restore` when true, `Cancel` when false. Verdict: matches.
- Phase 1 said: admin clicks "Restore" on a cancelled occurrence. Shipped: Restore button opens `<ConfirmDialog>` (correct). On confirm, `handleRestore()` calls the endpoint with `{ cancelled: false }`, deletes the DB row, and sets `isCancelled: false` in local state. Toast "Occurrence restored." Verdict: matches.

**User Verbs — Member/visitor passive surfaces:**

- Phase 1 said: signed-in member sees cancelled occurrence with "Cancelled" badge in upcoming list, with reason if provided. Shipped: `occurrence-signup-list.tsx` renders amber "Cancelled" badge when `row.isCancelled`; reason shown in italic when non-null; signup count suppressed (DECISION-004). Verdict: unverified-manual (flow #4 / #6).
- Phase 1 said: anonymous public visitor sees cancelled occurrence with "Cancelled" badge on `/events/[id]`. Shipped: same `OccurrenceSignupList` component serves both public and member views; `isCancelled` check replaces the action button with the badge regardless of `isLoggedIn`. Verdict: unverified-manual (flow #4).
- Phase 1 said: public events list `/events` — a cancelled occurrence does NOT shift the listed next occurrence. Shipped: `getNextOccurrence` gains `cancelledDates: Set<string>` param; `events/page.tsx` batch-fetches all overrides, builds per-event set, filters with `.filter((event) => event.nextOccurrence !== null)`. Verdict: unverified-manual (flow #5).

**Flow 1 — Admin cancels an occurrence (with and without reason):**
Phase 1 said: entry at `/admin/events/[id]`, cancel → dialog with optional reason → confirm → badge appears, toast shown. Shipped: all steps wired in `occurrence-rsvp-section.tsx`; failure path shows toast from API error JSON. Verdict: unverified-manual (flows #1, #2).

**Flow 2 — Admin restores:**
Phase 1 said: Restore dialog → confirm → row returns to normal. Shipped: `ConfirmDialog` for restore; state reset on success. Verdict: unverified-manual (flow #3).

**Flow 3 — Member views cancelled occurrence (portal events list):**
Phase 1 said: cancelled occurrence shows badge; no action button; reason in subdued text. Shipped: `occurrence-signup-list.tsx` handles this with `isCancelled` check; member portal pages pass `isCancelled`/`cancellationReason` via `OccurrenceRow`. Verdict: unverified-manual (flow #6).

**Flow 4 — Member or visitor views cancelled occurrence on event detail page:**
Phase 1 said: cancelled occurrence shows badge instead of action button; reason beneath date. Shipped: `occurrence-signup-list.tsx` renders badge when `row.isCancelled`; reason in italic below. Verdict: unverified-manual (flow #4).

**Flow 5 — Member who had already RSVP'd views now-cancelled occurrence:**
Phase 1 said (Q1 resolution): RSVPs preserved; member sees "You were signed up for this date" note. Shipped: `occurrence-signup-list.tsx` lines 214–217 render the amber note when `row.isCancelled && row.isSignedUp`; RSVPs not deleted (signup route has no deletion on cancel). Verdict: unverified-manual (flow #6).

**API design:**
Phase 1 said: single toggle endpoint at `POST /api/admin/events/[id]/occurrences/[date]/cancel`, body `{ cancelled: boolean, reason?: string }`, 401/403/404/400 error paths. Shipped: all four error cases present; upsert on cancel, delete on restore; response shape matches spec. Verdict: matches.

**Permissions:**
Phase 1 said: `FEATURES.EVENTS_EDIT` gates the cancel endpoint; no new key. Shipped: line 34 of cancel route — `session.user.features?.includes(FEATURES.EVENTS_EDIT)`, 403 on false. No new key in `permissions.ts`. Verdict: matches (statically verified). Verdict for click-through: unverified-manual (flow #9).

**Gap 3 (next-occurrence skip):**
Phase 1 said: skip cancelled dates in `getNextOccurrence`. Shipped: DECISION-002 — exclusion in `getNextOccurrence` only; `generateOccurrences` signature unchanged; all 5 call-sites updated. Verdict: matches.

**Gap 5 (orphaned cancellation records):**
Phase 1 said: cancellation records must remain visible even if recurrence rule is later edited. Shipped: DECISION-003 — admin detail page detects orphans by comparing `cancelledMap` keys against `generatedDateKeys`, appends orphan rows with "outside current recurrence rule" label. Verdict: matches code-path statically. Unverified-manual (flow #8).

**Gap 6 (OccurrenceRow type):**
Phase 1 said: `OccurrenceRow` needs `isCancelled: boolean` and `cancellationReason: string | null`. Shipped: both fields present in `src/types/events.ts`. Verdict: matches.

**Email (Q2 — out of scope):**
Phase 1 said: out of scope for v1; document as follow-up. No `sendEmail()` call in any Phase 4 file (grep confirmed). Verdict: matches.

**No indicator on `/admin/events` list (Q4):**
Phase 1 said: no indicator on the flat admin events table. Shipped: `/admin/events/page.tsx` unchanged — no cancellation indicator. Verdict: matches.

### Edge Cases

- **Empty state (all future occurrences cancelled):** `getNextOccurrence` returns null when the full `cancelledDates` set covers every candidate within the walk window (confirmed by regression test "getNextOccurrence returns null when all remaining occurrences are cancelled"). `events/page.tsx` filters out `nextOccurrence === null`. The event simply disappears from the public list — no "No upcoming dates" message at the list level, which is correct (the series is legitimately done for members' purposes). On the detail page, `OccurrenceSignupList` renders the cancelled rows with badges, not a blank page. Pass.
- **Failure microcopy (API error):** cancel handler reads `data.error ?? "Failed to cancel occurrence. Please try again."` and restores reads `data.error ?? "Failed to restore occurrence. Please try again."` — both graceful. No stack traces exposed. Pass.
- **Permission gate (static):** `auth()` check at line 28–31 returns 401; `hasFeature` check at line 34–36 returns 403. Both present before any DB access. Pattern matches existing `PATCH /api/admin/events/[id]/route.ts`. Pass (static). Unverified-manual (flow #9).
- **Migration idempotency:** `CREATE TABLE IF NOT EXISTS` guards table creation; `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint ...) END $$` guards the unique constraint. Fully idempotent. Pass.
- **Native browser dialogs:** grepped all modified files — zero occurrences of `window.confirm`, `window.alert`, `window.prompt`. Pass.
- **Naive-timestamp post-fix:** `occurrence-rsvp-section.tsx` line 85 — `new Date(group.date).toISOString().slice(0, 10)`. No `getFullYear`/`getMonth`/`getDate` usage for date-key derivation anywhere in the file. Fix confirmed. Pass.
- **Mobile (360px):** Not statically verifiable — unverified-manual. The component uses `flex-col sm:flex-row` in `occurrence-signup-list.tsx` (line 194) and the accordion header uses `flex items-center justify-between gap-3` which stacks gracefully. No hard pixel widths. Likely passes but unverified.

### Follow-Ups

The nine manual click-through flows from Phase 5 that still require user verification in a real browser session:

1. Flow #1 — Admin cancels with reason: `/admin/events/[id]` → "Cancel" on upcoming row → enter reason → confirm; expect amber badge + reason text and "Cancel" button becomes "Restore"; toast "Occurrence cancelled."
2. Flow #2 — Admin cancels without reason: same flow, leave reason blank; expect amber badge with no reason text beneath.
3. Flow #3 — Admin restores: click "Restore" on cancelled row → confirm; expect row returns to normal, button becomes "Cancel", toast "Occurrence restored."
4. Flow #4 — Public detail page badge: visit `/events/[id]` after cancelling an occurrence; expect amber "Cancelled" badge on that row, no "Sign Up" button, other rows unaffected.
5. Flow #5 — Public list skips cancelled next occurrence: cancel the first upcoming occurrence of a recurring series; reload `/events`; expect the series card shows the next non-cancelled date.
6. Flow #6 — "You were signed up" note: as member A sign up for occurrence X; as admin cancel occurrence X; as member A visit `/events/[id]`; expect "You were signed up for this date." beneath the "Cancelled" badge.
7. Flow #7 — Signup blocked on cancelled occurrence: `POST /api/events/[id]/signup` with the ISO timestamp of a cancelled occurrence; expect `400 { "error": "This occurrence has been cancelled" }`.
8. Flow #8 — Orphan row: cancel an occurrence; edit the event's recurrence rule to exclude that date; reload admin page; expect an accordion row labelled "— Cancelled (outside current recurrence rule)."
9. Flow #9 — Permission gate: call `POST /api/admin/events/[id]/occurrences/[date]/cancel` with a valid session lacking `events.edit`; expect `403 { "error": "Forbidden" }`.

Additional deferred follow-up (not a blocker, carries forward from user Q2 decision):
- **Cancellation email notification** — Members who RSVP'd to a cancelled occurrence receive no automated email in v1. This was explicitly deferred. A future work-log entry (`docs/work-log/YYYY-MM-DD-cancellation-email.md`) should pick this up when the club decides the notification story is worth implementing.

### Open questions / handoff notes

- All nine manual flows should be verified by the user in a browser session before pushing this branch to `main`. The machine gates are green; only the click-through is missing.
- Run `/pre-push` before pushing — the skill will re-confirm typecheck, build, tests, and release notes.
- Cancellation email is the only known unresolved product question and it is explicitly deferred by user decision.
