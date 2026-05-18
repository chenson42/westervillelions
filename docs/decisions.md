# Decisions Log

Architectural and implementation decisions for the Westerville Lions Club website. Newest first. Each decision is numbered; the number does not change once assigned.

## Format

Each decision uses this shape:

```markdown
## DECISION-NNN: [One-line title]

**Status:** Resolved | Superseded by DECISION-MMM | Under review
**Date:** YYYY-MM-DD

**Decision:** [What we decided.]

**Rationale:** [Why we decided it — the tradeoff named out loud.]

**Impact:** [What changes in the codebase as a result; any follow-ups.]

---
```

- **Architectural decisions** (new top-level directories, new npm dependencies, structural changes) are owned by the architect agent.
- **Implementation decisions** (data shape, API surface, where logic lives, library choice within already-approved deps) are owned by the tech-lead agent.

Both kinds live in this single file, newest first. Numbers are assigned in order and never reused.

---

## DECISION-007: `OccurrenceGroupData.date` stays typed as `Date`; `rsvpByDate` key uses `format(d, "yyyy-MM-dd HH:mm:ss")`

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
`OccurrenceGroupData.date` remains typed as `Date` (not changed to `string`). After `eventRsvps.occurrenceDate` switches to `mode: "string"`, the `rsvpByDate` map key in `src/app/(dashboard)/admin/events/[id]/page.tsx` changes from `row.occurrenceDate?.toISOString() ?? "null"` to `row.occurrenceDate ?? "null"` (plain string from DB). The lookup key at line 119 changes from `d.toISOString()` to `format(d, "yyyy-MM-dd HH:mm:ss")` (date-fns, local components) so both sides of the map use the same string format that Postgres returns.

**Rationale:** `generateOccurrences` returns `Date[]`; changing `OccurrenceGroupData.date` to `string` would cascade type changes through the entire admin page, the orphan-detection loop, and the sort comparator — more churn than benefit. The Date type is correct and coherent as long as dates are locally parsed on the way in (via `parseWallClock`). The map key format change is a surgical two-line edit that makes both sides consistent without touching the type.

**Impact:** Two lines in `src/app/(dashboard)/admin/events/[id]/page.tsx` — lines 99 and 119. No type change to `OccurrenceGroupData`.

---

## DECISION-006: Helper placement and `formatEventWhen` centralization for wall-clock refactor

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
New time helpers (`parseWallClock`, `formatEasternOffset`, `formatEventWhen`) live in the existing `src/lib/events.ts`, not in a new file or subdirectory. A single `formatEventWhen(event): string` helper is required and must be the only place that branches on `event.isAllDay` for display purposes — callers must not re-implement the branch inline.

**Rationale:** `events.ts` is 245 lines and handles a single domain. Adding three small helpers (~30 lines each) reaches ~330 lines — still cohesive. A new `src/lib/event-times.ts` file would require updating ~12 import sites and adds indirection without justification at this size. The centralized `formatEventWhen` helper is required because 10+ display sites need the all-day branch; a missing branch at any one site produces a silent wrong display (time shown when it should be omitted, or vice versa). Making the branch optional-inline creates an untestable invariant.

**Impact:** `src/lib/events.ts` gains three new exported functions. All display sites import and call `formatEventWhen` rather than branching directly on `isAllDay`.

---

## DECISION-005: Migration shape and `mode: "string"` annotation for wall-clock columns

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
One migration file (`drizzle/migrations/0037_events_wall_clock_and_all_day.sql`) adds the single new DDL change: `ALTER TABLE events ADD COLUMN IF NOT EXISTS is_all_day boolean NOT NULL DEFAULT false`. The `mode: "string"` annotation on `events.startDate`, `events.endDate`, `events.recurrenceEndDate`, and `eventRsvps.occurrenceDate` is a Drizzle TypeScript-only annotation — it instructs Drizzle to return the raw Postgres string rather than constructing a `Date` object. It emits no DDL and will not alter or drop the column on `db:push`. No second migration file is needed for the mode changes.

**Rationale:** Splitting into two migrations (one for `is_all_day`, one as a documentation note) adds file noise with no operational benefit — the mode annotation requires zero SQL. A single migration with only the `ADD COLUMN IF NOT EXISTS` statement satisfies the idempotency invariant (CLAUDE.md: "Every statement must be idempotent"). Confirming mode is DDL-safe is critical: Drizzle's `mode` option on `timestamp()` affects only the JS return type, not the Postgres column definition. The column remains `timestamp without time zone` in the database regardless of the `mode` value in `schema.ts`.

**Impact:** New file `drizzle/migrations/0037_events_wall_clock_and_all_day.sql` with one statement. `src/lib/db/schema.ts` updated to add `mode: "string"` to four columns and a new `isAllDay` boolean column on the `events` table.

---

## DECISION-004: RSVP count display on cancelled occurrence rows

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
On public and member-portal cancelled occurrence rows (`OccurrenceSignupList`), suppress the "X attendees" count and the action button entirely — render only the "Cancelled" badge and optional reason text. In the admin accordion, always show the count; admins need to know how many people were signed up before the cancellation.

**Rationale:** Showing a signup count on a row where signups are impossible is confusing to members. Admins have a legitimate need for the number (historical data; they may want to notify those members manually in v2). The difference in behavior is appropriate to the audience.

**Impact:** `OccurrenceSignupList` checks `row.isCancelled` before rendering the count `<p>` and the action button. Admin accordion header always renders its count span regardless of `isCancelled`.

---

## DECISION-003: Orphaned cancellation records surfaced in admin accordion as extra rows

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
When an admin edits the recurrence rule so that a previously cancelled date falls outside the new generated window, the cancellation record is NOT silently hidden and NOT accompanied by a warning at edit time. Instead, the admin detail page (`src/app/(dashboard)/admin/events/[id]/page.tsx`) detects orphans by comparing the `eventOccurrenceOverrides` set against the generated occurrence list and appends them to `occurrenceGroups` with a display label that includes "outside current recurrence rule." The admin can Restore (delete the record) to clean up. Sort order is chronological across generated and orphaned rows.

**Rationale:** Option (b) — warn at recurrence-rule edit time — requires changes to the event-edit form and introduces a two-step flow (edit, then decide what to do about orphans). Option (c) — leave invisible — is a data integrity risk. Option (a) is purely additive (no form changes) and keeps orphan management explicit in the same accordion where cancellations live.

**Impact:** `src/app/(dashboard)/admin/events/[id]/page.tsx` gains post-generation orphan detection logic. No new API surface required.

---

## DECISION-002: `generateOccurrences` signature unchanged; only `getNextOccurrence` gains cancellation exclusion

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
The architect's suggestion specified `generateOccurrences` should gain a `cancelledDates: Set<string>` parameter to skip cancelled dates. After reading all call-sites, this is the correct place for the exclusion on the `/events` list (next-occurrence computation) but the WRONG place for the detail-page occurrence list, where cancelled dates must APPEAR (with a badge) rather than be skipped. To avoid a confusing dual-mode parameter ("sometimes skip, sometimes don't"), the exclusion is placed only on `getNextOccurrence`, which is responsible for "what is the next bookable date." `generateOccurrences` remains a pure date generator. Callers that need the `isCancelled` flag annotate their `OccurrenceRow[]` after generation using the cancellation map fetched separately.

**Rationale:** Filtering inside `generateOccurrences` would produce inconsistent behavior depending on caller intent. The function's contract is "give me all dates in the window" — callers decide what to do with each date. `getNextOccurrence`'s contract is "give me the next actionable date" — skipping cancelled dates is correct there.

**Impact:** `src/lib/events.ts` — `getNextOccurrence` and its `findNextDayOfWeek` helper gain `cancelledDates: Set<string> = new Set()`. `generateOccurrences` is unchanged. Five `getNextOccurrence` call-sites each gain a batch cancellation fetch.

---

## DECISION-001: Cancel-occurrence table name, occurrence_date column type, and cancel API shape

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
Three rulings for the "Cancel a Single Event Occurrence" feature (work-log: `docs/work-log/2026-05-18-cancel-event-occurrence.md`):

1. **Table name:** `event_occurrence_overrides`. This is the right name: it is additive (does not touch `events` or `eventRsvps`), is self-describing, and leaves room for future override types (e.g., time-change overrides) without a rename. Columns: `id uuid PK`, `event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE`, `occurrence_date date NOT NULL`, `cancelled_at timestamp WITH TIME ZONE NOT NULL`, `cancelled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL`, `cancellation_reason text`. Composite unique on `(event_id, occurrence_date)`.

2. **`occurrence_date` is a `date` column (no time component).** The existing `eventRsvps.occurrenceDate` is a `timestamp` (naive, no timezone — the known project bug). We do NOT use that column type for the new table. Occurrence cancellation is keyed on the calendar date of the occurrence (`YYYY-MM-DD`), not its wall-clock time. A `date` column avoids timezone ambiguity entirely: the API route segment carries `YYYY-MM-DD`, the DB stores `YYYY-MM-DD`, and the UI badge lookup is a string equality check. This is safe because every occurrence of a given event on a given calendar date is the same occurrence — there is no scenario where two occurrences of the same event share the same calendar date.

3. **Single toggle endpoint:** `POST /api/admin/events/[id]/occurrences/[date]/cancel` with body `{ cancelled: boolean, reason?: string }`. Rationale: a single endpoint is easier to guard (one auth check, one hasFeature check, one rate-limit surface), easier to test (one contract), and the body makes the intent explicit. Two separate endpoints (cancel + restore) would duplicate boilerplate and create an ambiguous "which one do I call?" question for the client. The `[date]` segment carries a `YYYY-MM-DD` string. When `cancelled: true`, the handler upserts a row into `event_occurrence_overrides`; when `cancelled: false`, it deletes it. The handler returns the updated occurrence state.

**Rationale:** All three choices minimize ambiguity at the data-model and API boundaries. The `date` column type is the most load-bearing decision: using `timestamp` here (matching the existing `eventRsvps.occurrenceDate`) would re-introduce the naive-timestamp bug and create a join surface where two `timestamp` values with different TZ assumptions must be compared for equality — a known failure mode in this codebase. The `date` column sidesteps that entirely.

**Impact:**
- New file: `drizzle/migrations/0036_event_occurrence_overrides.sql` (idempotent: `CREATE TABLE IF NOT EXISTS`, unique constraint guarded with `IF NOT EXISTS`).
- New table in `src/lib/db/schema.ts`: `eventOccurrenceOverrides`.
- New route: `src/app/api/admin/events/[id]/occurrences/[date]/cancel/route.ts`.
- `src/lib/events.ts` — `generateOccurrences()` gains an optional `cancelledDates: Set<string>` parameter.
- `src/types/events.ts` — `OccurrenceRow` gains `isCancelled: boolean` and `cancellationReason: string | null`.
- No new npm dependency. No new `FEATURES` key. No new role binding.

---

<!-- Decisions are appended above this line, newest first. -->
