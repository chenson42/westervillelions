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

## DECISION-011: Write-in Signups implementation details — `kind` discriminator, shared `AdminRsvpRow` type, no `force` flag, no server capacity check

**Status:** Resolved
**Date:** 2026-05-20

**Decision:**
Four implementation-level rulings for the Write-in Signups feature, downstream of DECISION-010:

1. **Explicit `kind` discriminator in POST body.** `POST /api/admin/events/[id]/signup` uses `{ kind: "member" | "guest", ... }` as the discriminator rather than inferring intent from the presence/absence of `userId`. If `kind` is absent but `userId` is present, the server treats it as `kind: "member"` for backward compatibility during the transition (existing call sites in `occurrence-rsvp-section.tsx` and `admin-event-rsvp-table.tsx` do not yet send `kind`; they are updated in step 8 of the implementation order).

2. **`AdminRsvpRow` hoisted to `src/types/admin-rsvp.ts`.** The local `RsvpRowData` interface in `occurrence-rsvp-section.tsx` and the local `RsvpRow` interface in `admin-event-rsvp-table.tsx` are equivalent types with different names. `WriteInForm`'s `onAdded` callback would require a mapped adapter at each call site if the types stayed local and diverged. Hoisting to `src/types/admin-rsvp.ts` resolves the naming conflict, removes the adapter risk, and gives TypeScript a single source of truth for the admin attendee row shape. The raw DB query result type (`RsvpRow` in `page.tsx` lines 12–20) stays local — it represents the pre-consolidation Drizzle query shape and is not the same thing.

3. **No `force: true` flag in the POST body.** The server never enforces a capacity cap on the admin signup path (existing behavior). The inline client warning (yellow advisory above the submit button) is the only capacity signal. The `created_by_user_id` audit column implicitly records admin-initiated override inserts. Adding a `force` flag would introduce a code path with no observable server-side effect.

4. **No server-side capacity check on admin POST.** Consistent with existing behavior — the admin path bypasses capacity enforcement. The client advisory warning satisfies the soft-warn policy from Phase 1.

**Rationale:** Explicit discriminators eliminate a class of client bugs (sending both `userId` and `guestName`). Hoisting the shared type captures the real duplication between the two components at the type level without merging their structurally different parents. Omitting `force` and the server cap check keeps the admin path consistent with its pre-existing behavior and avoids dead code.

**Impact:**
- `src/types/admin-rsvp.ts` — new file.
- `src/components/admin/occurrence-rsvp-section.tsx` — local `RsvpRowData` removed; imports `AdminRsvpRow`.
- `src/components/admin/admin-event-rsvp-table.tsx` — local `RsvpRow` removed; imports `AdminRsvpRow`.
- `src/app/(dashboard)/admin/events/[id]/page.tsx` — row-mapping output typed as `AdminRsvpRow`; `isGuest: !r.userId` added to non-recurring rows.
- `src/app/api/admin/events/[id]/signup/route.ts` — POST branches on `kind`; backward-compat fallback for absent `kind`.

---

## DECISION-010: API shape, lookup endpoint, component placement, and schema addition for Write-in Signups

**Status:** Resolved
**Date:** 2026-05-20

**Decision:**
Four structural rulings for the Write-in Signups feature (work-log: `docs/work-log/2026-05-20-write-in-signups.md`):

1. **Extend the existing admin signup route; no separate `/guest-signup` route.** `POST /api/admin/events/[id]/signup` accepts a discriminated body: either `{ userId, occurrenceDate? }` (existing member path) or `{ guestName, guestEmail?, occurrenceDate?, force? }` (new guest path). `DELETE` accepts either `{ userId, occurrenceDate? }` or `{ rsvpId }` (new guest path; requires eventId ownership check). A new `PATCH /api/admin/events/[id]/signup/[rsvpId]` route handles in-place guest edits at `src/app/api/admin/events/[id]/signup/[rsvpId]/route.ts`.

2. **Email-match lookup lives at `GET /api/admin/members/lookup?email=...`** (`src/app/api/admin/members/lookup/route.ts`). Gated by `FEATURES.EVENTS_EDIT` (not `MEMBERS_VIEW`). Returns only `{ id, name, email }` to limit PII exposure. No existing endpoint does a point-lookup by email; the full-list `GET /api/admin/members` over-fetches for this purpose.

3. **One shared `WriteInForm` component in `src/components/admin/write-in-form.tsx`.** Reused by both `occurrence-rsvp-section.tsx` (recurring path) and `admin-event-rsvp-table.tsx` (non-recurring path). The two call sites differ only in whether `occurrenceDate` is passed. No unification of the parent components is required.

4. **`created_by_user_id` added to `event_rsvps`.** Nullable `uuid` referencing `users.id` with `ON DELETE SET NULL`. Member self-signups leave it null; admin write-ins populate it with the session user's id. Idempotent migration: `ALTER TABLE event_rsvps ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;`. No index needed.

**Rationale:** Extending the existing route avoids duplicating auth preamble and response shape. The narrow lookup endpoint limits data exposure to exactly what the email-match CTA requires. A single shared `WriteInForm` captures the real duplication between the two admin RSVP components without merging their structurally different parent state. The audit column is low-risk (nullable, idempotent migration) and provides an accountable record for capacity-override inserts.

**Impact:**
- `src/app/api/admin/events/[id]/signup/route.ts` — extended (POST + DELETE branches).
- `src/app/api/admin/events/[id]/signup/[rsvpId]/route.ts` — new file (PATCH).
- `src/app/api/admin/members/lookup/route.ts` — new file (GET).
- `src/components/admin/write-in-form.tsx` — new file.
- `src/lib/db/schema.ts` — `createdByUserId` column added to `eventRsvps`.
- `drizzle/migrations/` — new idempotent migration for `created_by_user_id` column.
- Three latent bug fixes in `occurrence-rsvp-section.tsx`, `admin-event-rsvp-table.tsx`, and `admin/events/[id]/page.tsx` are included in the same implementation pass.

---

## DECISION-009: Component rename strategy and shadcn scaffold classification for Add-to-Calendar dropdown

**Status:** Resolved
**Date:** 2026-05-20

**Decision:**
Two structural rulings for the "Add to Calendar — Provider Dropdown" feature (work-log: `docs/work-log/2026-05-20-add-to-calendar-dropdown.md`):

1. **Rename in place, not alongside.** `src/components/events/add-to-calendar-button.tsx` is renamed to `add-to-calendar-dropdown.tsx` and its body is replaced entirely. A parallel file is not created. The old component (`AddToCalendarButton`) will have no callers after this feature ships; keeping both files creates an ambiguity that must be managed forever. Four call sites are updated as part of the same change. The new export is `AddToCalendarDropdown`.

2. **`npx shadcn@latest add dropdown-menu` is not a new npm dependency.** `@radix-ui/react-dropdown-menu` is already in `package.json`. The scaffold command generates `src/components/ui/dropdown-menu.tsx` — a TypeScript/TSX wrapper file — and adds no new entry to `pnpm-lock.yaml`. This is the same structural pattern as `src/components/ui/confirm-dialog.tsx` (a hand-written Radix wrapper). DECISION-008's "no new npm dep" ruling is preserved.

**Rationale:** Rename-in-place eliminates dead artifacts in a single commit. The shadcn scaffold ruling keeps the wrapper consistent with the rest of `src/components/ui/` without widening the dependency graph.

**Impact:**
- `src/components/events/add-to-calendar-button.tsx` → `src/components/events/add-to-calendar-dropdown.tsx` (renamed, body replaced).
- `src/components/ui/dropdown-menu.tsx` created via shadcn scaffold.
- Four call sites updated to import `AddToCalendarDropdown` from the new path.
- Dead `eventTitle` prop removed from the component and all call sites (v1.15.0 follow-up, closed here).

---

## DECISION-008: ICS generator, route, and button placement for Add-to-Calendar feature

**Status:** Resolved
**Date:** 2026-05-20

**Decision:**
Three structural rulings for the Add-to-Calendar feature (work-log: `docs/work-log/2026-05-20-add-to-calendar.md`):

1. **ICS generator lives in `src/lib/events.ts`.** The generator functions (`generateIcsEvent`, `generateIcsSeries`, `buildVcalendar`) are added as new exports to the existing file rather than a new `src/lib/ics.ts` or `src/lib/events/ics.ts`. `events.ts` already owns `generateOccurrences`, `parseWallClock`, and `easternOffsetFor` — all three are required by the ICS generator. Keeping them co-located avoids a cross-file import of a module that owns every piece of data the generator needs. File will reach ~500 lines; that is still well within a single-concern boundary.

2. **Route lives at `src/app/api/events/[id]/ics/route.ts`, not under a new `/api/ics/` namespace.** The existing public event API lives at `src/app/api/events/[id]/rsvp` and `src/app/api/events/[id]/signup`. An ICS download is another operation on the same event resource and belongs in the same resource tree. A top-level `/api/ics/` namespace adds a second resource tree that mirrors `/api/events/` without justification. A single handler at this path uses an internal branch (see ruling 3) to enforce `isPublic` vs. `FEATURES.MEMBERS_VIEW`.

3. **Single handler with an internal auth branch.** One `GET` handler checks: if the event is public (`isPublic === true`), serve the ICS to any caller; if private, require a session and `hasFeature(session.user.features, FEATURES.MEMBERS_VIEW)`. Two separate handlers (one public, one member) would share identical ICS generation logic and differ only in the five-line auth preamble — not enough divergence to justify duplication.

4. **No new npm dependency.** A hand-rolled ICS generator (~200 lines) is correct. The `ics` and `ical-generator` npm packages are actively maintained but neither is already in `package.json`. The ICS format needed here is a small, well-specified subset of RFC 5545 (VCALENDAR + VEVENT + optional VTIMEZONE). The project dependency evaluation criteria require that an existing dependency solve the problem before a new one is added. None does. Adding a new dep for ~200 lines of string building (where correctness is fully verifiable against the RFC) is not warranted. No bundle-size impact on the server-only route.

5. **`<AddToCalendarButton>` lives in `src/components/events/`.** It is an event-surface-specific component, not a general UI primitive, so `src/components/ui/` is wrong. Its only peer event components are `occurrence-signup-list.tsx` and `single-event-signup.tsx`, both already in `src/components/events/`.

**Rationale:** Nesting under the existing events resource tree and co-locating the generator with its dependencies are the two choices that minimize new indirection. The single-handler-with-branch pattern matches the existing RSVP handler, which also branches on session state internally.

**Impact:**
- `src/lib/events.ts` gains ICS generator exports (~200 lines).
- New route: `src/app/api/events/[id]/ics/route.ts`.
- New component: `src/components/events/add-to-calendar-button.tsx`.
- No new npm dependency. No new migration. No new FEATURES key.

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
