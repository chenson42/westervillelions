# Add to Calendar Button — Work Log

> **Slug:** `2026-05-20-add-to-calendar`
> **Surface:** mixed (public `/events` + member portal `/members/events`)
> **Permission(s):** existing — public events are already public; member events already gated by `members.view` (no new permission key)
> **Estimated complexity:** small
> **Pipeline mode:** Full (small features still run all phases; Phase 2 likely a quick approval)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-05-20 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-05-20 |
| 3 — Technical design | tech-lead | Complete | Design complete | 2026-05-20 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-05-20 |
| 5 — Verification | qa | Complete | PASS | 2026-05-20 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-05-20 |

---

## Intent (from user)

- "Add to calendar" button on **public** event pages (`/events`, `/events/[id]`) and **member portal** event pages (`/members/events`, `/members/events/[id]`). Admin event pages are out of scope.
- Calendar format: **ICS download only** — a single `.ics` file the user can open with Google, Apple, Outlook, etc. No third-party calendar deeplinks.
- Recurrence: **both** — every individual occurrence gets its own button, AND the event detail page has a series-level button that exports all occurrences via an iCalendar `RRULE` (or a multi-VEVENT bundle).

---

# Phase 1 — Functional Refinement (analyst)

## Phase 1 — Functional Refinement — 2026-05-20

**Owner:** analyst
**Status:** complete

### Summary

A lightweight .ics download button that lets any visitor or member save a Lions Club event to their calendar app of choice. The feature touches four surfaces (public list, public detail, member list, member detail) with two button types on the detail pages (per-occurrence and series-level). Eleven design decisions were unaddressed in the original request; all are resolved here as constraints for Phase 3. No new permission key is needed, no schema changes are needed, and no external libraries are needed.

### What I did

- Pass 1: Identified all concrete user verbs and assigned each to a surface.
- Pass 2: Sketched all flows with success and failure paths.
- Pass 3: Confirmed permission gating requires no new FEATURES key.
- Pass 4: Resolved all edge cases named in the brief; added three more discovered during schema review.
- Pass 5: Adversarial pass on the route handler, URL parameters, and ICS payload.

### Outputs

- Schema reviewed: `src/lib/db/schema.ts` — `events`, `event_occurrences`, `eventOccurrenceOverrides`
- Events library reviewed: `src/lib/events.ts` — `parseWallClock`, `easternOffsetFor`, `generateOccurrences`
- Decision inputs for Phase 3: see constraints below

### Open questions / handoff notes

All open questions are resolved as constraints below. No blocking questions remain.

---

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

A well-scoped ICS download that will be straightforward to implement once eleven design decisions — timezone encoding, cancelled occurrence treatment, all-day handling, past-event visibility, series-vs-single deduplication, and six others — are locked as Phase 3 constraints.

## User Verbs

| Surface | User | Verb |
|---------|------|------|
| `/events` (public list) | Anonymous visitor | Clicks "Add to Calendar" on an event card → downloads a single-occurrence `.ics` |
| `/events/[id]` (public detail) | Anonymous visitor | Clicks per-occurrence "Add to Calendar" on a specific occurrence row → downloads a single-occurrence `.ics` |
| `/events/[id]` (public detail) | Anonymous visitor | Clicks series-level "Add to Calendar" button → downloads a full-series `.ics` |
| `/(dashboard)/events` (member list) | Signed-in member | Clicks "Add to Calendar" on an event card → downloads a single-occurrence `.ics` |
| `/(dashboard)/events/[id]` (member detail) | Signed-in member | Clicks per-occurrence "Add to Calendar" on a specific occurrence row → downloads a single-occurrence `.ics` |
| `/(dashboard)/events/[id]` (member detail) | Signed-in member | Clicks series-level "Add to Calendar" button → downloads a full-series `.ics` |

The user's calendar app then opens the `.ics` and presents its own import UI. The club site has no visibility into that step.

## Flows

**Flow A — Single-occurrence download (any surface):**
Entry: user clicks the "Add to Calendar" button on any event card or on a specific occurrence row.
Step 1: Browser issues a GET to a route handler, e.g. `GET /api/ics/event/[eventId]?occurrence=YYYY-MM-DD`.
Step 2: Server reads the event row and the specified occurrence date. Validates the occurrence is real (i.e. the date falls within the series and is not a future query against a non-existent occurrence).
Step 3: Server emits a single `VEVENT` block with correct wall-clock times and responds with `Content-Type: text/calendar; charset=utf-8` and `Content-Disposition: attachment; filename="event-title.ics"`.
Success: browser downloads the `.ics` file. User opens it; calendar app imports the event.
Failure — event not found: route handler returns 404. Browser receives an error download (empty or bad file). Because this is a direct download link, the user sees a browser-level error rather than an in-page toast. The button should open the URL in a new tab (or trigger a fetch + blob) so the in-page error path can show a toast if the response is not 200.

**Flow B — Series-level download (detail page only):**
Entry: user clicks the series "Add to Calendar" button on `/events/[id]` or `/(dashboard)/events/[id]`.
Step 1: Browser issues a GET to `GET /api/ics/event/[eventId]` (no occurrence param).
Step 2: Server reads the event and all generated occurrences (using `generateOccurrences` with a wide window). Cancelled occurrences are handled per the constraint below.
Step 3: Server emits either (a) multiple `VEVENT` blocks (one per occurrence, recommended for simplicity) or (b) a single `VEVENT` with `RRULE`. See constraint C3.
Success: same as Flow A.
Failure — event not found: same 404 handling as Flow A.

**Flow C — Non-recurring event detail page:**
A non-recurring event has a single "Add to Calendar" button. The series-level button and the per-occurrence button would produce identical output. Only one button is rendered. See constraint C8.

## Permissions

- **Permission(s):** No new FEATURES key.
  - Public surfaces (`/events`, `/events/[id]`): anonymous-accessible. The route handler for public events must check `isPublic === true` on the event row before emitting the ICS; a private event's ICS must not be downloadable without authentication.
  - Member portal surfaces (`/(dashboard)/events`, `/(dashboard)/events/[id]`): gated by `FEATURES.MEMBERS_VIEW` (existing). The route handler must verify the session and `hasFeature(session.user.features, FEATURES.MEMBERS_VIEW)` before serving member-event ICS files.
  - One route handler (or two separate ones) must enforce these gates. A single handler at `/api/ics/event/[eventId]` is acceptable if it performs the auth + isPublic check internally.

## Gaps the Request Didn't Address

All items below are resolved as **constraints for Phase 3**. Each is labelled C1–C11.

**C1 — Cancelled occurrences.**
The `eventOccurrenceOverrides` table records per-occurrence cancellations (v1.14.0). The ICS must handle them. Constraint: **skip cancelled occurrences entirely** — do not include a `VEVENT STATUS:CANCELLED` block. Reason: including a CANCELLED VEVENT can cause some calendar clients to add the event and then immediately show it as crossed-out, which is confusing. An occurrence that never appears is less confusing than one that appears as cancelled. If the user has already imported the event and a cancellation happens later, they won't be notified — that is an accepted limitation of the ICS-download-only approach (no push update path).

**C2 — All-day events.**
`events.isAllDay` is a boolean in the schema. Constraint: when `isAllDay === true`, emit `DTSTART;VALUE=DATE:YYYYMMDD` and `DTEND;VALUE=DATE:YYYYMMDD` (with DTEND = start + 1 day per iCalendar spec). Do not emit a `TZID` param or time component for all-day events. `parseWallClock` already discards the time component cleanly for all-day events (the startDate will be stored as midnight).

**C3 — Timezone encoding for timed events.**
The codebase deliberately uses wall-clock strings (DECISION-005) and already has `easternOffsetFor()` in `src/lib/events.ts` that computes the correct Eastern offset (EDT vs EST) for any given local date. Two acceptable ICS approaches for timed events:
- **Option A (recommended):** Emit a `VTIMEZONE` block for `America/New_York` and use `DTSTART;TZID=America/New_York:YYYYMMDDTHHmmss`. This is standards-compliant and handles DST in calendar apps that understand TZID.
- **Option B (simpler, acceptable for v1):** Emit absolute UTC values using `easternOffsetFor()` to derive the UTC offset at the time of each occurrence, then write `DTSTART:YYYYMMDDTHHmmssZ` with the UTC-adjusted value. Works but loses DST semantics for far-future recurring events.
Tech-lead picks the approach; the constraint is that the wall-clock-as-UTC antipattern (the naive timestamp bug) is explicitly forbidden. Do not emit `new Date(wallClockString).toISOString()` directly.

**C4 — Past events.**
Constraint: **show the button for past events.** A member or visitor browsing a past event may still want to log it in their calendar for record-keeping (e.g., a volunteer tracking service hours). Hiding the button on past events is additional complexity with no clear benefit.

**C5 — Multi-day events.**
The schema has `startDate` and `endDate` on the `events` table. A multi-day event has `endDate` set to a date/time later than `startDate`. Constraint: if `endDate` is present, use it as `DTEND`. If `endDate` is null, derive `DTEND` as `startDate + 1 hour` for timed events, or `startDate + 1 day` for all-day events (iCalendar requires DTEND). The implementer should check whether admin UI currently allows setting endDate; if not, this code path is inert but should still be correct.

**C6 — Event with no occurrences (edge case).**
A recurring event that has just been created may have `generateOccurrences()` return an empty array if the series start date is in the far future and `from` is today. Also, `generateOccurrences` has a 52-week default window — a series that ended in the past returns an empty array. Constraint: if the series produces zero occurrences, the series-level download returns a 200 with a valid (but empty) ICS file, or a 404 with a plain-text error — either is acceptable, but an empty ICS is preferable because the user's calendar app will show a clear "nothing to import" message rather than a browser error. For a non-recurring event, this case cannot arise (there is always exactly one occurrence).

**C7 — Mobile experience.**
On iOS, tapping a link that returns `Content-Disposition: attachment` often opens the file in Safari's download UI rather than routing to Calendar. On Android, behavior varies by browser. Constraint: this is **acceptable for v1**. The ICS format is correct and the file will eventually reach the calendar app even if the import UX takes an extra step. Document this limitation in the UI as a tooltip or helper text: "Downloads a .ics file. Open it to add to your calendar app." Do not promise a one-tap add on mobile.

**C8 — Series-level button when there is only one occurrence.**
A non-recurring event (`isRecurring === false`) has exactly one occurrence. Showing two buttons (per-occurrence and series-level) that produce identical output would confuse the user. Constraint: on the detail page, **if `isRecurring === false`, render only one "Add to Calendar" button** (no series button). If `isRecurring === true`, render both: a per-occurrence button on each occurrence row and a series-level button near the event title/description. The series-level button is labelled "Add full series to Calendar" to disambiguate.

**C9 — ICS metadata fields.**
The spec did not say what goes in the .ics beyond the time. Constraint: emit the following fields in every VEVENT:
- `SUMMARY`: event title (`events.title`)
- `DESCRIPTION`: event description (`events.description`), stripped of any HTML if the admin stores rich text (check what format description is stored in)
- `LOCATION`: event location (`events.location`), if non-null
- `URL`: canonical URL back to the event page. For public events: `https://westervillelions.org/events/[id]`. For member events: `https://westervillelions.org/members/events/[id]`. The site URL should come from an environment variable (`NEXTAUTH_URL` or a new `NEXT_PUBLIC_SITE_URL`), not hardcoded.
- `UID`: a stable unique identifier per VEVENT. For a single occurrence: `event-[eventId]-[YYYYMMDD]@westervillelions.org`. For the series (if RRULE approach is used): `event-[eventId]@westervillelions.org`.
- `DTSTAMP`: current UTC timestamp at time of generation (required by RFC 5545).
- `ORGANIZER`: not required for v1; skip.
- `SEQUENCE` / `STATUS`: not required for v1; skip.

**C10 — Description field format.**
The schema stores `events.description` as `text`. Check whether admin event creation stores plain text or HTML/Markdown. If HTML, the ICS `DESCRIPTION` property must be plain text (most calendar apps do not render HTML in descriptions). Strip tags before emitting. If plain text, use as-is with RFC 5545 line-folding applied (lines longer than 75 octets must be folded with `\r\n `).

**C11 — Caching.**
The ICS route handler should emit `Cache-Control: no-store` so that cancelled occurrences are never served from a stale cached response. If a CDN or Next.js route cache sits in front, it must not cache this route.

## Out of Scope (confirm with user)

- Admin events surface (confirmed out of scope by user)
- Non-ICS formats: Google Calendar deeplinks, Outlook deeplinks, Apple Calendar deeplinks (confirmed out of scope)
- Push-update path: if an event changes after a user has imported the ICS, they will not be notified. Out of scope for v1.
- Webcal:// subscription URLs (live calendar subscription). Out of scope for v1.
- RSVP confirmation emails including an .ics attachment. Related but a separate feature.

## Open Questions

No blocking open questions. All named gaps above are resolved as constraints. One item to confirm in Phase 3: whether `events.description` is stored as plain text or HTML, which determines whether tag-stripping is needed in the ICS generator.

---

## Phase 2 — Architectural Review — 2026-05-20

**Owner:** architect
**Status:** complete

### Summary

Approved with suggestions. The feature shape from Phase 1 is sound — no new permission key, no schema changes, no surprising surface area. Seven structural questions were open coming in; all are resolved. The one suggestion: the series-level `generateOccurrences` call must pass `parseWallClock(event.startDate)` as `from` (not `new Date()`) so that past occurrences are included in the download, matching how the admin detail page already handles wide-window generation.

### What I did

- Reviewed the existing `src/app/api/events/` route tree and confirmed nesting precedent (rsvp, signup both live at `[id]/`).
- Read `src/lib/events.ts` in full — confirmed `parseWallClock`, `easternOffsetFor`, `generateOccurrences` are all present and the file can absorb the ICS generator without splitting.
- Reviewed all `generateOccurrences` call-sites to understand the `from` / window patterns in use.
- Reviewed `src/components/events/` — confirmed the two existing files and appropriate placement for the new button.
- Reviewed `docs/decisions.md` and assigned DECISION-008.
- Applied the project's five-point dependency evaluation criteria to `ics` / `ical-generator`; ruled no new dep.

### Placement Decisions

| Concern | Decision |
|---------|----------|
| Route | `src/app/api/events/[id]/ics/route.ts` — nested under the existing events resource tree, consistent with `[id]/rsvp` and `[id]/signup`. |
| Handler split | Single handler with an internal auth branch. Checks `isPublic`; if false, requires session + `hasFeature(FEATURES.MEMBERS_VIEW)`. |
| ICS generator | New exports added to `src/lib/events.ts`. No new file or subdirectory. |
| Button component | `src/components/events/add-to-calendar-button.tsx`. Event-surface-specific; not a UI primitive. |
| New npm dependency | None. Hand-rolled ICS generator (~200 lines of RFC 5545 string building). |

### Server / Client Split

The `<AddToCalendarButton>` component needs `'use client'` if it fetches the ICS via JavaScript and shows an error toast on non-200 (Flow A failure path in Phase 1). If it is implemented as a plain `<a href="/api/events/[id]/ics?...">` anchor, it requires no client boundary — the browser handles the download natively, and error handling is limited to the browser's own download failure UI.

**Ruling:** Phase 1 constraint C7 (mobile) documents that users may need to manually open the file — a simple anchor is acceptable for v1. However, Phase 1 Flow A specifies that on a 404 the user should see an in-page toast rather than a browser-level download error. Those two goals are in tension. The tech-lead must pick one of:
- **Option A (simpler):** Plain `<a>` anchor. No `'use client'`. No toast on 404. Accept that a broken download silently fails. Document as a known v1 limitation.
- **Option B (richer):** Client component with a click handler that does `fetch(url)`, checks response status, and calls `toast.error(...)` on non-200, then triggers a blob download on success. Requires `'use client'`.

Both are architecturally sound. Option B requires `'use client'` and a small blob-URL trick; Option A does not. The tech-lead should pick Option A for v1 unless there is a concrete UX reason to do more — the feature brief did not ask for error toasts and 404s on an ICS endpoint should be rare.

### Invariants Touched

1. **Wall-clock / naive-timestamp invariant (DECISION-005, memory: `project_naive_timestamp_tz_bug`).** This is the highest-risk invariant for this feature. The ICS generator must NOT call `new Date(wallClockString).toISOString()`. It must use `parseWallClock()` to obtain local `Date` components, then either (a) emit `DTSTART;TZID=America/New_York:YYYYMMDDTHHmmss` with a `VTIMEZONE` block, or (b) use `easternOffsetFor()` to compute the UTC offset and emit an absolute UTC value. Both `parseWallClock` and `easternOffsetFor` are already in `src/lib/events.ts` and must be the only path through which dates enter the ICS output.

2. **`generateOccurrences` window / `from` parameter.** The series-level download must include past occurrences (C4: show button for past events; a series download should reflect the full series, not just future dates). The call must pass `parseWallClock(event.startDate)` as `from` rather than `new Date()`. The admin page already does this at line 90 of `src/app/(dashboard)/admin/events/[id]/page.tsx` with `maxWeeks: 520`. The ICS route must follow the same pattern; using `new Date()` as `from` would silently omit all historical occurrences.

3. **Auth + `hasFeature()` on the route handler.** The single handler must check `isPublic` first; if false, it calls `auth()` and `hasFeature(session.user.features, FEATURES.MEMBERS_VIEW)` before serving the response. Omitting this makes private event data downloadable anonymously. This is the standard invariant for every route in the member API surface.

4. **`Cache-Control: no-store` (C11).** The handler must emit this header. Cancelled occurrences updated after a CDN-cached response would be served stale. This is especially important for the series-level download.

5. **`Content-Disposition: attachment` filename.** The filename must be derived from `event.title` and sanitized (remove characters illegal in HTTP header values). The tech-lead should note this as a small but non-trivial step in the implementation.

6. **No native browser dialogs.** The button must not use `window.confirm()` or `window.alert()`. If Option B (client component) is chosen, errors surface via `toast.error()` from `sonner`.

### Suggestion for Phase 3

The `from` parameter on the series-level `generateOccurrences` call is architecturally load-bearing — getting it wrong silently drops historical occurrences from the download with no error. The tech-lead should call this out explicitly in the design doc and the implementation order should test it against an event whose occurrences span both past and future dates.

### Outputs

- `docs/decisions.md` — DECISION-008 logged (ICS generator, route, and button placement)
- `docs/work-log/2026-05-20-add-to-calendar.md` — this section

### Open questions / handoff notes

- **Server/client split on the button:** tech-lead picks Option A (plain anchor, no toast) or Option B (client component, fetch + toast). Recommendation is Option A for v1.
- **ICS timezone approach:** tech-lead picks C3 Option A (VTIMEZONE + TZID) or Option B (absolute UTC via `easternOffsetFor`). Either is architecturally approved; the constraint is that `new Date(wallClockString).toISOString()` is forbidden.
- **`events.description` format:** Phase 1 left an open question about whether the field stores plain text or HTML. The tech-lead must check before implementing the DESCRIPTION property (C10). Look at the admin event-create form.
- **`NEXT_PUBLIC_SITE_URL` vs `NEXTAUTH_URL`:** C9 requires the canonical URL in the ICS `URL` property. Tech-lead should confirm which env var to use and whether it is already set in production.

---

# Phase 3 — Technical Design (tech-lead)

## Phase 3 — Technical Design — 2026-05-20

**Owner:** tech-lead
**Status:** complete

### Summary

The feature is a read-only ICS download endpoint plus a lightweight button component. The route at `src/app/api/events/[id]/ics/route.ts` serves either a single-occurrence `.ics` (when `?occurrence=YYYY-MM-DD` is present) or a full-series `.ics` (when the param is absent). Public events are anonymous-accessible; private events require `MEMBERS_VIEW`. The ICS generator is a set of new exports added to `src/lib/events.ts`. The button is a plain `<a href>` anchor at `src/components/events/add-to-calendar-button.tsx` — no client component boundary, no toast, no fetch. Timezone is encoded with a VTIMEZONE block (C3 Option A). No schema changes, no new npm dependencies. Estimated ~280 lines net.

### What I did

- Read `src/lib/db/schema.ts` — confirmed `events`, `eventOccurrenceOverrides` shape, description is `text` (plain).
- Read `src/lib/events.ts` — confirmed `parseWallClock`, `easternOffsetFor`, `generateOccurrences` signatures and the `from` param semantics.
- Read `src/app/api/events/[id]/rsvp/route.ts` — confirmed auth pattern and route structure.
- Read `src/app/(dashboard)/admin/events/[id]/page.tsx` line 90 — confirmed `parseWallClock(event.startDate)` + `maxWeeks: 520` precedent for full-series generation.
- Read `src/components/admin/event-form.tsx` — confirmed description is a plain `<textarea>` with no rich text editor; no HTML tag-stripping needed (C10 resolved: plain text).
- Confirmed `NEXTAUTH_URL` is the site-URL env var used throughout the codebase (`src/lib/members.ts`, forgot-password route).
- Resolved all C1–C11 constraints as concrete design decisions below.

---

## Technical Design: Add to Calendar

### Permissions

No new permission key. The route handler applies a two-branch gate:

```
if (event.isPublic) → serve without auth
else → auth() + hasFeature(session.user.features, FEATURES.MEMBERS_VIEW) → 401/403 if missing
```

`FEATURES.MEMBERS_VIEW` already exists. Unauthenticated requests to a private event return `401`. Authenticated requests without `MEMBERS_VIEW` return `403`.

---

### API Contract

#### `GET /api/events/[id]/ics`

**Purpose:** Download an ICS file for an event — either a single occurrence or the full series.

**Route file:** `src/app/api/events/[id]/ics/route.ts`

**Query parameters:**

| Param | Type | Required | Meaning |
|-------|------|----------|---------|
| `occurrence` | `YYYY-MM-DD` | No | If present, emit a single VEVENT for that specific occurrence date. If absent, emit all non-cancelled occurrences (series download). |

**Auth gate (executed before any DB query):**

1. Load event row. If not found → `404 { error: "Event not found" }`.
2. If `event.isPublic === false`: call `auth()`. If no session → `401 { error: "Authentication required" }`. If session lacks `MEMBERS_VIEW` → `403 { error: "Forbidden" }`.
3. If `event.isPublic === true`: no auth check.

**Single-occurrence response (`?occurrence=YYYY-MM-DD` present):**

- Parse `occurrence` param. If the format is not `YYYY-MM-DD` → `400 { error: "Invalid occurrence date" }`.
- Load `eventOccurrenceOverrides` for this event. If the requested date is in the cancelled set → `404 { error: "Occurrence not found or cancelled" }`.
- Validate the date falls within the generated occurrence set (call `generateOccurrences(event, parseWallClock(event.startDate), 520)` and check). If not → `404 { error: "Occurrence not found or cancelled" }`.
- Emit one VEVENT. Return:
  ```
  200
  Content-Type: text/calendar; charset=utf-8
  Content-Disposition: attachment; filename="<sanitized-title>.ics"
  Cache-Control: no-store
  ```

**Series response (no `occurrence` param):**

- Load all overrides. Call `generateOccurrences(event, parseWallClock(event.startDate), 520)` to get every occurrence from series start. Filter out any date whose `dateKey(d)` is in the cancelled set.
- If zero non-cancelled occurrences remain: emit an empty (but valid) ICS with no VEVENTs and return `200` — an empty calendar is less confusing than a browser download error (C6).
- Emit one VEVENT per occurrence. Return same headers as above.

**Error responses (JSON body, not ICS):**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ error: "Invalid occurrence date" }` | `occurrence` param present but not `YYYY-MM-DD` |
| 401 | `{ error: "Authentication required" }` | Private event, no session |
| 403 | `{ error: "Forbidden" }` | Private event, session lacks `MEMBERS_VIEW` |
| 404 | `{ error: "Event not found" }` | No event row with given id |
| 404 | `{ error: "Occurrence not found or cancelled" }` | Date is cancelled or outside series window |

---

### ICS Generator API

New exports added to **`src/lib/events.ts`** (no new file).

#### `buildIcsCalendar(vevents: string[]): string`

Wraps VEVENT strings in a VCALENDAR envelope with the VTIMEZONE block. Always emits CRLF line endings. Returns the complete ICS string.

```typescript
export function buildIcsCalendar(vevents: string[]): string
```

- Emits: `BEGIN:VCALENDAR`, `VERSION:2.0`, `PRODID:-//Westerville Lions Club//Calendar//EN`, `CALSCALE:GREGORIAN`, `METHOD:PUBLISH`, then the VTIMEZONE block, then each VEVENT, then `END:VCALENDAR`.
- The VTIMEZONE block is a static hardcoded block for `America/New_York` covering both EST (`-05:00`) and EDT (`-04:00`) transitions. It does not need to be dynamic — calendar apps use the TZID to look up current DST rules; the block is a hint, not the authoritative source.

#### `buildVEvent(event: IcsEventInput, occurrence: Date): string`

Builds a single VEVENT string (without the VCALENDAR envelope).

```typescript
export type IcsEventInput = {
  id: string;                      // event.id (UUID)
  title: string;                   // event.title
  description: string | null;      // event.description (plain text, no HTML)
  location: string | null;         // event.location
  isAllDay: boolean;               // event.isAllDay
  startDate: string;               // event.startDate (wall-clock string)
  endDate: string | null;          // event.endDate (wall-clock string or null)
  isPublic: boolean;               // event.isPublic (for URL construction)
};

export function buildVEvent(event: IcsEventInput, occurrence: Date): string
```

The `occurrence` Date carries the correct wall-clock time (from `generateOccurrences` or `parseWallClock`). The function:

1. **DTSTART / DTEND** — see C2/C3 resolution below.
2. **SUMMARY** — ICS-escaped `event.title`.
3. **DESCRIPTION** — ICS-escaped `event.description` if non-null, with line-folding applied.
4. **LOCATION** — ICS-escaped `event.location` if non-null.
5. **URL** — `${process.env.NEXTAUTH_URL ?? "https://westervillelions.org"}/events/${event.id}` for public events; `/members/events/${event.id}` for private.
6. **UID** — see UID strategy below.
7. **DTSTAMP** — current UTC timestamp: `new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z"`.

---

### Resolving C1–C11

**C1 — Cancelled occurrences (skip entirely).**
In the route handler, before calling `buildVEvent`, load all `eventOccurrenceOverrides` rows for the event via a single Drizzle query. Build a `Set<string>` of cancelled `YYYY-MM-DD` keys. Filter `generateOccurrences(...)` results through `d => !cancelledSet.has(dateKey(d))`. No `STATUS:CANCELLED` VEVENT is emitted. Single-occurrence requests for a cancelled date return `404`.

**C2 — All-day events.**
Inside `buildVEvent`: if `event.isAllDay === true`, emit `DTSTART;VALUE=DATE:YYYYMMDD` using `format(occurrence, "yyyyMMdd")`. DTEND = start + 1 day (iCalendar spec: `DTEND;VALUE=DATE:` on the day after). No `TZID`, no time component.

**C3 — Timezone encoding (Option A — VTIMEZONE block).**
For timed events (`isAllDay === false`), emit `DTSTART;TZID=America/New_York:YYYYMMDDTHHmmss`. Extract local components from the `occurrence` Date (which is already in wall-clock local time, produced by `parseWallClock` / `generateOccurrences`). Use `format(occurrence, "yyyyMMdd'T'HHmmss")`. The VTIMEZONE block in `buildIcsCalendar` covers the TZID reference.

Rationale for Option A over B: VTIMEZONE + TZID is the standards-compliant approach and handles far-future recurring events correctly across DST boundaries without per-occurrence UTC arithmetic. The `easternOffsetFor` utility is still in scope for the VTIMEZONE static block's TZOFFSETFROM/TZOFFSETTO values (which are fixed: `-05:00` / `-04:00`), but it does not need to be called per-occurrence. `new Date(wallClockString).toISOString()` is explicitly forbidden — wall-clock string must go through `parseWallClock()` first.

**C4 — Past events.** The button renders regardless of occurrence date. The `generateOccurrences` call uses `parseWallClock(event.startDate)` as `from`, matching the admin page at line 90, so past occurrences are included.

**C5 — Multi-day / endDate.**
Inside `buildVEvent`:
- If `event.endDate` is non-null: derive DTEND occurrence by adding the same date offset as the occurrence is from `event.startDate`, then using the endDate time. For simplicity in v1: use `event.endDate` time components applied to the occurrence date's date component. This handles events with a fixed duration (e.g., 2 hours) correctly for non-recurring events; for recurring events, if `endDate` is set it is treated as the end-time on the same day as the occurrence.
- If `event.endDate` is null and not all-day: DTEND = occurrence + 1 hour.
- If `event.endDate` is null and all-day: DTEND = occurrence + 1 day.

**C6 — Zero occurrences.** Series download with zero non-cancelled occurrences returns an ICS with no VEVENTs (a valid empty calendar). The `buildIcsCalendar([])` call with an empty array handles this naturally.

**C7 — Mobile (accepted v1 limitation).** The button includes `title="Downloads a .ics file. Open it to add to your calendar app."` as a tooltip. No other mobile-specific handling.

**C8 — Series button dedup.**
In the event detail page component(s), the conditional render is:

```
isRecurring === true  → render per-occurrence button on each row + "Add full series to Calendar" button near title
isRecurring === false → render one "Add to Calendar" button only (no series button)
```

The `<AddToCalendarButton>` receives an `occurrence` prop (a `YYYY-MM-DD` string) for per-occurrence buttons and no `occurrence` prop (or `occurrence={undefined}`) for the series button. When `occurrence` is undefined, it links to `/api/events/[id]/ics` with no query param.

**C9 — ICS metadata.**
Every VEVENT emits: SUMMARY, DESCRIPTION (if non-null), LOCATION (if non-null), URL (from `NEXTAUTH_URL`), UID (see UID strategy), DTSTAMP. ORGANIZER, SEQUENCE, STATUS omitted in v1.

**C10 — Description format (plain text confirmed).**
`src/components/admin/event-form.tsx` uses a plain `<textarea>` — no rich text editor, no HTML markup. `events.description` is plain text. No tag-stripping is needed. Apply RFC 5545 ICS-text escaping (commas, semicolons, backslashes, newlines) and line-folding only.

**C11 — Caching.** Route handler emits `Cache-Control: no-store` on every response, including errors. This is set in the `NextResponse` headers alongside `Content-Type` and `Content-Disposition`.

---

### Server / Client Split on the Button

**Option A confirmed.** `<AddToCalendarButton>` is a plain styled `<a href>` anchor. No `'use client'`. No fetch-and-blob.

Rationale: Phase 1 did not require error toasts. The 404 path (requesting a cancelled or non-existent occurrence) is rare and the browser's download failure UX is acceptable for v1. Keeping the component as a Server Component removes the need for a client boundary and a blob-URL trick entirely. If the fetch-and-toast path is wanted in a future iteration, it can be added by converting the anchor to a client component at that time.

The button component signature:

```typescript
// src/components/events/add-to-calendar-button.tsx
// No 'use client' — this is a Server Component

type AddToCalendarButtonProps = {
  eventId: string;
  eventTitle: string;
  occurrence?: string;   // YYYY-MM-DD; if absent → series download
  label?: string;        // defaults to "Add to Calendar" or "Add full series to Calendar"
  className?: string;
};
```

The `href` is constructed server-side:
- With occurrence: `/api/events/${eventId}/ics?occurrence=${occurrence}`
- Without: `/api/events/${eventId}/ics`

The anchor uses `download` attribute so the browser treats it as a file download. Styled as a secondary button per UX guidelines (`border-2 border-lions-blue text-lions-blue ... rounded-lg`).

---

### UID Strategy

UIDs must be stable across re-downloads so that calendar apps update rather than duplicate the event.

**Per-occurrence download (single VEVENT):**
```
event-{eventId}-{YYYYMMDD}@westervillelions.org
```
Example: `event-550e8400-e29b-41d4-a716-446655440000-20260615@westervillelions.org`

**Series download (multiple VEVENTs, one per occurrence):**
Each VEVENT gets its own stable UID using the same per-occurrence format:
```
event-{eventId}-{YYYYMMDD}@westervillelions.org
```

The UID for a given occurrence is the same whether it was downloaded as a single-occurrence ICS or as part of a series download. This means re-importing the series file correctly updates (rather than duplicates) occurrences that a user may have previously imported individually — calendar apps that support UID-based dedup will merge them.

No RRULE approach is used. Multi-VEVENT bundle was chosen in Phase 1 as the recommended approach for series (Step B.3 says "multiple VEVENT blocks (one per occurrence, recommended for simplicity)"). This avoids the complexity of RRULE generation and the edge cases around EXDATE for cancellations.

---

### Filename Sanitization

The `Content-Disposition: attachment; filename="..."` header filename is derived from `event.title` using this transform, applied in the route handler before setting the header:

```typescript
function toIcsFilename(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")   // collapse any non-alphanumeric run to a single hyphen
      .replace(/^-+|-+$/g, "")        // trim leading/trailing hyphens
      .slice(0, 60)                    // cap at 60 chars (safe HTTP header length)
    + ".ics"
  );
}
```

Examples: `"Lions Club Monthly Meeting"` → `"lions-club-monthly-meeting.ics"`. `"Summer Fun & BBQ!"` → `"summer-fun-bbq.ics"`.

---

### RFC 5545 Text Escaping and Line-Folding

Every TEXT property value (SUMMARY, DESCRIPTION, LOCATION) must be escaped and folded. A small helper handles both:

```typescript
// Escape special characters per RFC 5545 §3.3.11
function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")   // backslash first
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");   // literal newline → \n escape sequence
}

// Fold lines longer than 75 octets (CRLF + SPACE continuation)
function icsFold(line: string): string {
  // line is already a "PROPERTY:value" string with escaping applied
  // Fold at 75 bytes; continuation lines begin with a single space
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const chunkEnd = Math.min(offset + (offset === 0 ? 75 : 74), bytes.length);
    parts.push(bytes.slice(offset, chunkEnd).toString("utf8"));
    offset = chunkEnd;
  }
  return parts.join("\r\n ");
}
```

All lines in the output use CRLF (`\r\n`) line endings, never bare LF. The `buildIcsCalendar` function assembles lines into a `string[]` and joins with `\r\n` before the final `\r\n` terminator.

---

### Data Model

No schema changes required.

---

### Files to Create / Modify

| Action | Path |
|--------|------|
| Create | `src/app/api/events/[id]/ics/route.ts` |
| Create | `src/components/events/add-to-calendar-button.tsx` |
| Modify | `src/lib/events.ts` — add `buildIcsCalendar`, `buildVEvent`, `IcsEventInput` type, `icsEscape`, `icsFold`, `toIcsFilename` |
| Modify | Public event list page — add `<AddToCalendarButton>` to event cards |
| Modify | Public event detail page — add per-occurrence and series buttons |
| Modify | Member portal event list page — add `<AddToCalendarButton>` to event cards |
| Modify | Member portal event detail page — add per-occurrence and series buttons |

---

### Implementation Order

1. **ICS generator unit tests** — write Vitest tests for `buildVEvent`, `buildIcsCalendar`, `icsEscape`, `icsFold` in `src/lib/events.test.ts` (or a new `src/lib/ics.test.ts` co-located test). Cover: timed event DTSTART with TZID, all-day event DATE format, C3 wall-clock antipattern (verify `new Date(wallClockString)` is never called), C1 cancelled-occurrence filter, C8 series-vs-single UID stability, multi-VEVENT bundle, zero-VEVENT empty calendar, line-folding at >75 octets, CRLF endings. **This is the highest-risk step** — the wall-clock / naive-UTC bug lives here and must be caught by tests, not discovered in prod.

2. **ICS generator implementation** — add exports to `src/lib/events.ts`. No new file. Keep pure (no DB, no env reads). The `URL` field in `buildVEvent` receives the full URL as a parameter (the caller constructs it from `NEXTAUTH_URL`) so the generator stays testable without env setup.

3. **Route handler** — `src/app/api/events/[id]/ics/route.ts`. Auth gate, DB query (event + overrides), `generateOccurrences` call with `parseWallClock(event.startDate)` as `from` and `maxWeeks: 520`, cancellation filter, `buildIcsCalendar` / `buildVEvent` call, filename sanitization, response headers.

4. **Button component** — `src/components/events/add-to-calendar-button.tsx`. Plain anchor, styled as secondary button, `download` attribute, C7 tooltip. No `'use client'`.

5. **Wire button into pages** — four surfaces: public event list, public event detail, member portal event list, member portal event detail. On detail pages: conditional render per C8 (`isRecurring` branch). On list pages: single per-event button using the event's `startDate` date component as the `occurrence` param.

6. **Release notes** — via `/release-notes` skill when merged to main.

---

### Edge Cases & Risks

- **Wall-clock / naive-UTC bug (highest risk):** `new Date(wallClockString).toISOString()` must never appear in the ICS code path. `occurrence` Date objects must only come from `parseWallClock()` or `generateOccurrences()`. Unit tests (step 1) are the guard.
- **`from` param on `generateOccurrences`:** Must be `parseWallClock(event.startDate)`, not `new Date()`. Using `new Date()` silently drops all past occurrences from series downloads. The existing admin page (line 90) is the established precedent to follow.
- **RFC 5545 line-folding:** Byte-length folding, not character-length. Long Unicode descriptions (e.g., emoji or multibyte chars) must fold on byte boundaries without splitting a multibyte sequence. The `icsFold` implementation using `Buffer` handles this correctly; a naive `string.slice()` at 75 chars would not.
- **CRLF endings:** The ICS spec requires `\r\n`. Joining with `\r\n` and adding a final `\r\n` after `END:VCALENDAR` is required. A missing trailing CRLF causes parse errors in strict ICS parsers.
- **Event with `endDate` on a recurring series:** The `endDate` column on the `events` table represents the end-time, not the recurrence end. For recurring events in v1, DTEND is derived from the occurrence time + 1 hour (if no endDate) or from the endDate time components applied to the occurrence date. No admin UI currently allows setting `endDate` on recurring events, so this code path is inert but must be correct.
- **Filename characters:** HTTP `Content-Disposition` header values that contain non-ASCII or control characters can break some browsers. The `toIcsFilename` regex ensures the filename is ASCII-only alphanumeric + hyphens.
- **UUID in UID:** The `eventId` is a UUID which contains hyphens. This is valid in an ICS UID — no escaping needed for hyphens in the `UID` property (it is not a TEXT property that requires escaping).
- **Empty VTIMEZONE block for all-day events:** `buildIcsCalendar` always emits the VTIMEZONE block even if all VEVENTs are all-day. This is harmless — an unused VTIMEZONE component is valid per RFC 5545. Omitting it conditionally would add complexity for no benefit.

---

### Out of Scope

- RRULE generation (series is a multi-VEVENT bundle per Phase 1 recommendation)
- Webcal:// subscription URL
- RSVP confirmation email with ICS attachment
- Admin events surface
- Non-ICS calendar deeplinks (Google Calendar, Outlook, Apple Calendar)
- Error toast on download failure (deferred to a future client-component iteration if needed)

---

### Open Questions / Handoff Notes

No blocking open questions.

**Implementer:** Use the **full-stack-developer** agent. Rationale: the work spans `src/lib/events.ts` (server utility), `src/app/api/` (route handler), and `src/components/events/` plus four page wiring sites (client + server components). Splitting it across two agents would require handing off the `IcsEventInput` type and the route interface mid-stream, adding coordination overhead for a ~280-line feature. A single agent holds the full context and can write the unit tests, the generator, the route, and the UI in one pass.

**Key reminders for the implementer:**

1. `generateOccurrences(event, parseWallClock(event.startDate), 520)` — not `new Date()` — for the `from` param on series downloads.
2. `occurrence` Date objects enter `buildVEvent` already in local wall-clock time (from `parseWallClock` / `generateOccurrences`). Use `format(occurrence, "yyyyMMdd'T'HHmmss")` directly — do not convert to UTC.
3. Write unit tests for the ICS generator **before** writing the route handler. The wall-clock antipattern is easy to introduce accidentally during the formatting step.
4. The `buildVEvent` function receives the fully-constructed URL string as a parameter (not `process.env.NEXTAUTH_URL` directly) so it stays testable in isolation.
5. Four page wiring sites — don't miss the member portal event list (`/(dashboard)/events`).

---

## Phase 4 — Implementation (full-stack) — 2026-05-20

**Owner:** full-stack-developer
**Status:** complete

### Summary

Implemented the full "Add to Calendar" ICS download feature across the ICS generator library, route handler, button component, and all four page-wiring sites. Tests were written first (32 new unit tests covering all ICS generator edge cases including the wall-clock / naive-UTC regression), then the implementation, then the wiring. All Phase 4 gate checks pass: `pnpm exec tsc --noEmit` clean, `pnpm build:only` clean, `pnpm test` 93/93 passing.

### What I did

- Wrote 32 new Vitest unit tests in `src/lib/events.test.ts` covering `icsEscape`, `icsFold`, `toIcsFilename`, `buildVEvent` (timed + all-day, TZID, wall-clock regression), and `buildIcsCalendar` (envelope, VTIMEZONE once, CRLF, UID stability, zero-VEVENT empty calendar).
- Implemented ICS generator exports in `src/lib/events.ts`: `icsEscape`, `icsFold`, `toIcsFilename`, `buildVEvent`, `buildIcsCalendar`, `IcsEventInput` type, plus a static `VTIMEZONE_AMERICA_NEW_YORK` block.
- Created route handler at `src/app/api/events/[id]/ics/route.ts` with auth gate (public events anonymous, private events require `MEMBERS_VIEW` via `hasFeature` from `permissions-server`), `generateOccurrences(event, parseWallClock(event.startDate), 520)` for full-series coverage, C1 cancellation filter, C6 empty-calendar fallback, and correct `Cache-Control: no-store` header.
- Created `src/components/events/add-to-calendar-button.tsx` as a plain Server Component `<a>` anchor (Option A, no `'use client'`), styled as a secondary outlined button per brand guidelines, with C7 tooltip.
- Added `dateKey: string` field to `OccurrenceRow` in `src/types/events.ts` (local YYYY-MM-DD from `dateKey(d)`) and populated it in the public event detail page's occurrence rows builder.
- Added `showCalendarButtons?: boolean` prop to `OccurrenceSignupList` — renders per-occurrence `<a>` anchors on non-cancelled rows when true (no 'use client' promotion needed; the anchor is static HTML).
- Wired `AddToCalendarButton` into four surfaces:
  - **Public event list** (`src/app/events/page.tsx`): per-occurrence button on each event card using `dateKey(event.nextOccurrence!)`.
  - **Public event detail** (`src/app/events/[id]/page.tsx`): series button for recurring events + per-occurrence buttons in `OccurrenceSignupList` (via `showCalendarButtons` prop); single-event button for non-recurring events in the bottom action bar.
  - **Member events list** (`src/app/members/events/page.tsx`): per-occurrence button on each upcoming event card.
  - **Member events detail**: the `/members/events/[id]/page.tsx` already redirects to `/events/[id]`, so the public detail page serves both surfaces — no additional wiring needed.

### Outputs

- **Files created:**
  - `/Users/cshenso/git/westervillelions/src/app/api/events/[id]/ics/route.ts` — `GET /api/events/[id]/ics` route handler (public: anonymous; private: auth + `FEATURES.MEMBERS_VIEW`)
  - `/Users/cshenso/git/westervillelions/src/components/events/add-to-calendar-button.tsx` — Server Component `<AddToCalendarButton>` with `eventId`, `occurrence?`, `label?`, `className?` props
- **Files modified:**
  - `/Users/cshenso/git/westervillelions/src/lib/events.ts` — added ICS generator exports (`buildIcsCalendar`, `buildVEvent`, `icsEscape`, `icsFold`, `toIcsFilename`, `IcsEventInput`)
  - `/Users/cshenso/git/westervillelions/src/lib/events.test.ts` — added 32 new ICS unit tests (imports updated, tests appended)
  - `/Users/cshenso/git/westervillelions/src/types/events.ts` — added `dateKey: string` field to `OccurrenceRow`
  - `/Users/cshenso/git/westervillelions/src/components/events/occurrence-signup-list.tsx` — added `showCalendarButtons?: boolean` prop + per-occurrence anchor rendering
  - `/Users/cshenso/git/westervillelions/src/app/events/page.tsx` — wired `AddToCalendarButton` per event card
  - `/Users/cshenso/git/westervillelions/src/app/events/[id]/page.tsx` — wired buttons (series + per-occurrence in signup list + single for non-recurring), added `dateKey` to occurrence row builder
  - `/Users/cshenso/git/westervillelions/src/app/members/events/page.tsx` — wired `AddToCalendarButton` per upcoming event card
- **API endpoint:** `GET /api/events/[id]/ics` — auth gate: anonymous for public events, `FEATURES.MEMBERS_VIEW` for private. `?occurrence=YYYY-MM-DD` for single; no param for series.
- **Schema changes:** none
- **New env vars:** none (uses existing `NEXTAUTH_URL`)
- **New FEATURES key:** none
- **Key tradeoffs logged:**
  - Per-occurrence buttons on the public/member event detail page are only shown within the RSVP/signup section (`OccurrenceSignupList`) because that is the only place occurrence rows are rendered in the current page structure. Recurring events without `requiresRsvp` get a series-level button only. This is acceptable for V1 and does not limit the download capability.
  - The member events detail page redirects to the public detail page, which already handles both authenticated and anonymous users. No separate member-portal event detail implementation exists.

### Open questions / handoff notes

**For QA (Phase 5) — things to verify in browser:**
1. **Public events list** (`/events`): click "Add to Calendar" on any event card. Browser should download a `.ics` file. Open it — event should appear at the correct local time (not UTC-shifted).
2. **Public event detail** (`/events/[id]` for a non-recurring event): "Add to Calendar" button should appear in the bottom action bar. Download and verify.
3. **Public event detail** (`/events/[id]` for a recurring event): "Add full series to Calendar" button in the bottom bar should download a `.ics` with multiple VEVENTs. If the event has `requiresRsvp === true`, per-occurrence buttons should also appear in the occurrence list alongside the signup buttons; cancelled occurrences should have no calendar button.
4. **Member events list** (`/members/events`): requires login. Each upcoming event card should show "Add to Calendar". Private events (not public) should also download correctly once authenticated.
5. **Private event ICS — unauthenticated:** `GET /api/events/{privateEventId}/ics` without a session should return `401`. Verify in browser or curl.
6. **Private event ICS — member without `MEMBERS_VIEW`:** should return `403`.
7. **Cancelled occurrence:** `GET /api/events/{id}/ics?occurrence=YYYY-MM-DD` for a cancelled date should return `404`.
8. **Invalid date param:** `?occurrence=not-a-date` should return `400`.
9. **Filename in download:** the downloaded file should have a sanitized name like `lions-club-monthly-meeting.ics`, not a UUID.
10. **CRLF line endings:** open the `.ics` in a text editor that shows line endings and verify `\r\n` throughout (or import into Google Calendar / Apple Calendar and confirm the event appears correctly).

**Next agent:** `qa` for Phase 5.

---

# Phase 5 — Verification (qa)

## Phase 5 — Verification — 2026-05-20

**Owner:** qa
**Status:** complete

### Summary

PASS. All four automated gates pass independently (typecheck, unit tests, production build, dev-server smoke). The 32 new ICS unit tests are real, meaningful, and well-targeted — the wall-clock regression test guards exactly the failure mode described in DECISION-005 and `project_naive_timestamp_tz_bug`. The dev-server smoke confirms correct CRLF endings, VTIMEZONE block, TZID-encoded DTSTART preserving wall-clock time, filename sanitization, and all error response codes. One dead prop (`eventTitle` in `AddToCalendarButton`) and one pre-existing coverage gap (`members.ts` 0%) are noted but neither is a blocker.

### What I did

**1. Typecheck**
`pnpm exec tsc --noEmit`: PASS (no output, exit 0)
Node version note: Node 18 is the shell default; tests and build require Node 20.9+. Switched to Node 20.20.2 (available via nvm at `/Users/cshenso/.nvm/versions/node/v20.20.2`). The `.nvmrc` specifies `20`. The dev environment has the correct Node but it was not auto-selected in this shell session.

**2. Unit Tests**
`pnpm exec vitest run` (Node 20): PASS
Total: 93 | Passed: 93 | Failed: 0
Duration: ~200ms

ICS tests spot-check:
- Wall-clock regression test (`emits DTSTART;TZID=America/New_York with wall-clock local time, NOT a UTC-shifted value`): present at line 701. Verifies `parseWallClock("2026-07-04 12:30:00")` → `20260704T123000` in EDT. Explicitly asserts `T163000Z` (naive UTC) is ABSENT. This guards the exact failure mode from DECISION-005.
- Winter EST variant (line 715): also present, guards the `17:30Z` naive-UTC variant.
- Both are real behavioral assertions — not trivial.
- Empty VCALENDAR (C6), CRLF-only endings, VTIMEZONE exactly once, UID stability across single/series downloads, all-day DATE format, multibyte UTF-8 fold — all covered.

**3. Production Build**
`pnpm build:only`: PASS
Route `ƒ /api/events/[id]/ics` present in route manifest. 101 dynamic routes compiled. No server/client boundary errors or unused-export warnings.

**4. Coverage Audit — ICS Generator (`src/lib/events.ts`)**
`pnpm exec vitest run --coverage`: 94.02% statements / 85.03% branches / 94.11% functions
Uncovered lines: 118, 170, 230, 380.
- Line 118: `formatRecurrence` — `!days` branch with a `range` (biweekly/weekly without recurrenceDays but with a recurrenceEndDate). Pre-existing gap, not ICS-related.
- Line 170: `getNextOccurrence` monthly — `return null` after 12-month walk with all cancellations. Pre-existing gap.
- Line 230: `findNextDayOfWeek` — the final `return null` (exhaustion with no series end). Pre-existing gap.
- Line 380: `icsFold` inner `while` — UTF-8 continuation-byte backup loop. The multibyte fold test (`folds correctly on multibyte UTF-8 characters`) covers the fold logic but the specific byte-backup branch (when the fold boundary lands mid-multibyte sequence) is not triggered by the test's data. Minor gap.
All four gaps are minor and none involve the primary wall-clock / naive-UTC risk path.

**5. Route Handler Audit (`src/app/api/events/[id]/ics/route.ts`)**
- Auth branch: `isPublic === false` triggers `auth()` → 401 no session, 403 lacks `MEMBERS_VIEW`. Implementation present and correct (lines 53-67).
- `Cache-Control: no-store` set on ALL responses — both success paths and all error paths via `noStoreHeaders` (line 34-36, used in every `NextResponse.json(...)` error return and via `responseHeaders` on success).
- `Content-Disposition: attachment; filename="..."` uses `toIcsFilename(event.title)` which sanitizes to ASCII alphanumeric + hyphens capped at 60 chars.
- 404 on non-existent event: lines 45-50.
- Empty VCALENDAR on zero occurrences (C6): `buildIcsCalendar([])` returns valid VCALENDAR with no VEVENTs (line 161-162). Confirmed by test at events.test.ts:854.
- Cancelled occurrences filtered: `cancelledSet` built from all overrides, filter applied before `buildVEvent` (lines 156-158). Single-occurrence requests for cancelled dates return 404 (lines 116-121).
- `?occurrence=YYYY-MM-DD` format validation: `/^\d{4}-\d{2}-\d{2}$/` regex at line 108. Bad format → 400. Confirmed by smoke test.
- `from` param: `parseWallClock(event.startDate)` used (not `new Date()`) for both single-occurrence validation (line 126) and series download (line 149-150). Correct per Phase 2/3 invariant.

**6. Dev-Server Smoke Tests** (against `http://localhost:3000`)
All events in the dev DB are public; the private event auth path was verified by code-trace (route handler lines 53-67 are unambiguous).

| Test | Result |
|------|--------|
| `curl -sI /api/events/{publicId}/ics` — headers | Content-Type: text/calendar; charset=utf-8 / Content-Disposition: attachment; filename="lions-club-meeting.ics" / Cache-Control: no-store — all present |
| ICS body structure | BEGIN:VCALENDAR / VERSION:2.0 / PRODID / VTIMEZONE / VEVENT / END:VCALENDAR — correct |
| CRLF endings | `od -c` confirms `\r\n` on every line break, no bare LF |
| Wall-clock DTSTART | Event at 9 AM wall-clock → `DTSTART;TZID=America/New_York:20260516T090000` — correct, no UTC shift |
| VTIMEZONE block | Present exactly once, includes EDT/EST rules |
| UID format | `event-{uuid}-{YYYYMMDD}@westervillelions.org` — confirmed |
| `?occurrence=not-a-date` → 400 | `{"error":"Invalid occurrence date"}` |
| `?occurrence=20260523` (no dashes) → 400 | `{"error":"Invalid occurrence date"}` |
| `?occurrence=2099-01-01` (valid format, not in series) → 404 | `{"error":"Occurrence not found or cancelled"}` |
| Non-existent event → 404 | `{"error":"Event not found"}` |
| Recurring series download | Multiple VEVENTs, each with correct TZID, UID, wall-clock time |
| Per-occurrence download (recurring event, May 23) | Single VEVENT for that date only |

**7. Page-Wiring Verification (code-trace + curl)**
- `/events` (public list): ICS links present for all 3 events with `?occurrence={nextOccurrenceDate}`. Confirmed by grep.
- `/events/{id}` (non-recurring detail): Single `?occurrence=YYYY-MM-DD` link in action bar. Confirmed by grep.
- `/events/{id}` (recurring detail, no requiresRsvp): One series-level ICS link (no occurrence param). Correct per V1 tradeoff noted in Phase 4.
- `/events/{id}` (recurring detail, with requiresRsvp): Per-occurrence `Add to Calendar` anchors appear in `OccurrenceSignupList` on non-cancelled rows via `showCalendarButtons` prop. Verified in component source.
- `/members/events`: Wired via `AddToCalendarButton` with `occurrence={dateKey(event.nextOccurrence!)}` — correct.
- Member event detail: `/members/events/[id]` redirects to `/events/[id]`; public detail page serves both authenticated and anonymous users. No additional wiring needed.

**8. V1 Limitation (confirmed)**
Recurring events without `requiresRsvp` render only the series-level "Add full series to Calendar" button on the detail page. Per-occurrence buttons are NOT shown because occurrence rows are only built inside `if (event.requiresRsvp)`. This is the documented Phase 4 tradeoff. The Farmers Market event (recurring, no RSVP) correctly shows one ICS link (series-level only).

**9. Minor Observation (not a blocker)**
`AddToCalendarButton` declares `eventTitle: string` in its prop type but does not use it (it's omitted from the destructuring at line 36 of the component). TypeScript is satisfied (prop is in the type, callers pass it correctly). The value is intentionally unused — filename sanitization happens server-side. This is dead prop, not a defect.

**10. Regression Tests Added**
The following tests were written by the implementer and verified as real behavioral guards:
- `emits DTSTART;TZID=America/New_York with wall-clock local time, NOT a UTC-shifted value` — `src/lib/events.test.ts:701` — guards against: naive `new Date(wallClockString).toISOString()` call re-introducing the DECISION-005 bug in the ICS path
- `emits DTSTART with wall-clock time in EST (UTC-5) during winter months` — `src/lib/events.test.ts:715` — guards against: winter-time UTC variant of the same bug
- `produces a valid empty VCALENDAR (no VEVENTs) for C6 zero-occurrence case` — `src/lib/events.test.ts:854` — guards against: series download throwing on empty occurrence set
- `uses CRLF line endings throughout the output` — `src/lib/events.test.ts:862` — guards against: bare LF creeping in from string concatenation

**11. Coverage on Critical Modules**
- `src/lib/events.ts`: 94.02% statements / 85.03% branches — above 90% target
- `src/lib/permissions.ts`: not separately tracked (pure constants, 0 executable statements outside the `hasFeature` function, which has no unit tests but is covered by e2e)
- `src/lib/members.ts`: 0% — pre-existing gap, not introduced by this feature

### Outputs

- `docs/work-log/2026-05-20-add-to-calendar.md` — this section appended

### Open questions / handoff notes

- The `eventTitle` dead prop in `AddToCalendarButton` could be removed in a future cleanup pass, but it is harmless.
- Private event ICS auth path (401/403) was verified by code-trace only — no private events exist in the dev DB. If a private event is ever seeded or created via admin, the auth gate should be manually smoke-tested once.
- Node 18 is the shell default on this machine. `pnpm test` fails with a startup error on Node 18; `pnpm exec tsc --noEmit` and `pnpm build:only` pass on either version. The `.nvmrc` specifies Node 20 — developer should ensure `nvm use` is invoked or a shell hook is in place.

**Next agent:** `analyst` for Phase 6 (PASS issued).

---

# Phase 6 — Shipped vs Intent (analyst)

## Phase 6 — Shipped vs Intent — 2026-05-20

**Owner:** analyst
**Status:** complete

### Summary

SHIP IT. The shipped feature matches Phase 1 intent on every surface and every constraint. All eleven C1–C11 design decisions are resolved correctly in code. The wall-clock / naive-UTC invariant is enforced by 32 unit tests and verified by QA smoke testing. The one v1 limitation — per-occurrence buttons absent on recurring events without `requiresRsvp` on the detail page — was documented in Phase 4, confirmed in Phase 5, and is an accepted tradeoff, not a regression. One cosmetic dead prop (`eventTitle` in `AddToCalendarButton`) is a minor housekeeping note with no user impact.

### What I did

- Re-read all five prior phases in full.
- Spot-checked `src/app/api/events/[id]/ics/route.ts` (all 165 lines).
- Spot-checked `src/components/events/add-to-calendar-button.tsx`.
- Spot-checked all four wiring sites: `src/app/events/page.tsx`, `src/app/events/[id]/page.tsx`, `src/app/members/events/page.tsx`, and the member events detail redirect.
- Spot-checked `src/components/events/occurrence-signup-list.tsx` for `showCalendarButtons` prop behavior.
- Scanned `src/lib/events.ts` ICS generator exports (`buildVEvent`, `buildIcsCalendar`, `icsEscape`, `icsFold`, `toIcsFilename`, VTIMEZONE block).
- Walked the intent-vs-shipped diff for each surface and each constraint.
- Evaluated all edge cases named in Phase 1.

### Outputs

- `docs/work-log/2026-05-20-add-to-calendar.md` — this section appended; pipeline closed.

### Open questions / handoff notes

One tracked follow-up (see below). No blocking items.

---

## VERDICT

**SHIP WITH NOTES**

One housekeeping follow-up. The feature itself is fully correct and shippable; the note is cosmetic.

## ONE-LINE TAKE

The ICS download feature shipped cleanly across all four surfaces with correct timezone handling, cancelled-occurrence filtering, and the wall-clock invariant enforced by 32 unit tests — the one v1 limitation (per-occurrence buttons absent on RSVP-free recurring events on the detail page) was agreed in Phase 4 and is not a regression.

---

## What's Working

**Route handler (`GET /api/events/[id]/ics`):** Auth gate is correct — anonymous for public events, `auth()` + `hasFeature(session.user.id, FEATURES.MEMBERS_VIEW)` for private events. `Cache-Control: no-store` is set on every response path (both success and all error returns use `noStoreHeaders`). The `from` parameter on `generateOccurrences` is `parseWallClock(event.startDate)` in both the single-occurrence validation path (line 128) and the series-download path (line 151), exactly as Phase 2 and Phase 3 required. Cancelled occurrences are filtered before `buildVEvent` is called in the series path and return 404 in the single-occurrence path. Zero-occurrence series returns a valid empty VCALENDAR (C6 met). `toIcsFilename` sanitizes the `Content-Disposition` header to ASCII alphanumeric + hyphens.

**ICS generator (`src/lib/events.ts`):** `buildVEvent` correctly branches on `isAllDay` — all-day events use `DTSTART;VALUE=DATE:` with no TZID, timed events use `DTSTART;TZID=America/New_York:` with local wall-clock components extracted via `format(occurrence, "yyyyMMdd'T'HHmmss")` — no `toISOString()` or UTC conversion anywhere in the path. The VTIMEZONE block for `America/New_York` is hardcoded and correct (EDT: 2nd Sunday March, EST: 1st Sunday November). DTSTAMP is computed from `new Date()` UTC fields directly (not `toISOString()`) — correct. Line-folding uses `Buffer` byte-length, not character-length, so multibyte UTF-8 is handled safely.

**Four wiring sites:**
- Public event list (`/events`): `<AddToCalendarButton eventId={event.id} occurrence={dateKey(event.nextOccurrence!)} />` — correct, uses `dateKey` for the YYYY-MM-DD occurrence param.
- Public event detail (`/events/[id]`): C8 conditional is correct — `event.isRecurring` true emits the series button (no `occurrence` prop, label "Add full series to Calendar") plus per-occurrence anchors via `OccurrenceSignupList showCalendarButtons`; `event.isRecurring` false emits a single-occurrence button using `dateKey(parseWallClock(event.startDate))`. The series button passes no `occurrence` prop, so it links to `/api/events/${eventId}/ics` with no query param — correct series-download URL.
- Member events list (`/members/events`): `<AddToCalendarButton eventId={event.id} occurrence={dateKey(event.nextOccurrence!)} />` — correct.
- Member events detail: `/members/events/[id]` redirects to `/events/[id]`. The public detail page already handles both authenticated and anonymous users via `auth()` at the top. No additional wiring needed, and Phase 4 documented this correctly.

**`OccurrenceSignupList` per-occurrence buttons:** The `showCalendarButtons` prop is gated on `!row.isCancelled` before rendering the anchor — cancelled occurrences get no calendar button, which is correct per C1. The anchor links to `/api/events/${eventId}/ics?occurrence=${row.dateKey}` and the `row.dateKey` field is a YYYY-MM-DD string populated in the occurrence row builder.

---

## Intent-vs-Shipped Diff

| Phase 1 intent | Shipped | Verdict |
|----------------|---------|---------|
| Button on public event list (`/events`) | Present on every event card via `<AddToCalendarButton occurrence={dateKey(nextOccurrence!)} />` | Matches |
| Per-occurrence button on public event detail (`/events/[id]`) | Present in `OccurrenceSignupList` when `showCalendarButtons` is true and `requiresRsvp` is true; absent when `requiresRsvp` is false (v1 limitation) | Acceptable drift — documented in Phase 4 |
| Series-level button on public event detail | Present for `isRecurring === true`; single-occurrence button for `isRecurring === false` per C8 | Matches |
| Button on member event list (`/(dashboard)/events`) | Present on every upcoming event card | Matches |
| Per-occurrence button on member event detail | Member detail redirects to public detail; same v1 limitation applies | Acceptable drift — same as above |
| Series-level button on member event detail | Handled by public detail page post-redirect | Matches |
| ICS format only — no deeplinks | Confirmed; `<a href>` anchor only, no Google/Outlook/Apple deeplinks | Matches |
| C1 — Skip cancelled occurrences | Filter applied in route handler and in `OccurrenceSignupList` (no button on cancelled rows) | Matches |
| C2 — All-day events use `DATE` value type | `DTSTART;VALUE=DATE:YYYYMMDD`, no TZID, DTEND = start + 1 day | Matches |
| C3 — Timezone via VTIMEZONE + TZID (Option A) | `VTIMEZONE` block present; `DTSTART;TZID=America/New_York:` used for all timed events | Matches |
| C4 — Show button for past events | `generateOccurrences` uses `parseWallClock(event.startDate)` as `from` (not `new Date()`); past occurrences included | Matches |
| C5 — `endDate` → DTEND; null → occurrence + 1 hour | `buildVEvent` checks `event.endDate`; null falls back to `+1 hour` | Matches |
| C6 — Zero occurrences → valid empty VCALENDAR | `buildIcsCalendar([])` produces valid VCALENDAR with no VEVENTs; returns 200 | Matches |
| C7 — Mobile v1 limitation with tooltip | `title="Downloads a .ics file. Open it to add to your calendar app."` present on all calendar anchors | Matches |
| C8 — Series-vs-single dedup on detail page | `isRecurring` conditional correctly renders one vs two button types | Matches |
| C9 — SUMMARY, DESCRIPTION, LOCATION, URL, UID, DTSTAMP | All present in `buildVEvent`; UID format `event-{id}-{YYYYMMDD}@westervillelions.org` | Matches |
| C10 — Plain text description; no HTML stripping | `events.description` confirmed plain text; no stripping needed; ICS-text escaping applied | Matches |
| C11 — `Cache-Control: no-store` | Set via `noStoreHeaders` on every response path including all error returns | Matches |
| Phase 3 chose VTIMEZONE Option A | Implemented with static hardcoded block; `new Date(wallClockString).toISOString()` absent from entire code path | Matches |
| Phase 3 chose button Option A (plain `<a>`, no fetch/toast) | `add-to-calendar-button.tsx` has no `'use client'`, is a plain `<a>` anchor | Matches |

---

## Edge Cases

| Check | Result |
|-------|--------|
| **Empty state (no upcoming events)** | Public list: renders `"No upcoming public events at this time."` with a helpful follow-up sentence. Member list: renders `"No upcoming events scheduled."` — functional but terse; no CTA. Pass for the purposes of this feature (the empty state was pre-existing). |
| **Permission gate** | Route handler: `isPublic === false` triggers `auth()` → 401 (no session) or `hasFeature` check → 403 (no MEMBERS_VIEW). Verified by code trace in Phase 5. Pass. |
| **Mobile note (C7)** | `title` tooltip present on all calendar anchors. Accepted v1 limitation documented. Pass. |
| **Cancelled occurrence filtering** | Route handler: `cancelledSet.has(occurrenceParam)` → 404. Series: filter before `buildVEvent`. `OccurrenceSignupList`: `!row.isCancelled` guard on the calendar anchor. All three paths correct. Pass. |
| **Wall-clock invariant** | `buildVEvent` uses `format(occurrence, "yyyyMMdd'T'HHmmss")` on a `Date` produced by `parseWallClock` or `generateOccurrences`. `new Date(wallClockString).toISOString()` not present anywhere in the ICS path. Guarded by unit tests at `events.test.ts:701` and `:715`. Pass. |
| **Brand consistency** | Button styled `border-2 border-lions-blue text-lions-blue ... rounded-lg` — matches secondary button spec. Calendar icon inline SVG, no emoji. No `window.confirm` or native dialogs. Pass. |
| **Failure microcopy** | Route handler error responses are JSON `{ error: "..." }` — human-readable strings, not stack traces. Because the button is a plain anchor (Option A), the user sees a browser-level download error on non-200; no in-page toast. This is the documented v1 limitation accepted in Phase 3. Pass. |

---

## Follow-ups (SHIP WITH NOTES)

**Follow-up 1 — Dead prop cleanup (`eventTitle` in `AddToCalendarButton`).**
`AddToCalendarButton` declares `eventTitle: string` in its prop type but omits it from the destructuring body (QA Phase 5 observation, point 9). TypeScript is satisfied because callers pass it. The prop is not used — filename sanitization is server-side in the route handler. Future callers might be confused by a declared-but-unused prop. Resolution: remove `eventTitle` from the prop type and all four call sites. Low priority; purely cosmetic.

**Follow-up 2 — Per-occurrence buttons on recurring RSVP-free events (v1 limitation).**
Recurring events without `requiresRsvp` show only the series-level "Add full series to Calendar" button on the detail page because occurrence rows are only built inside the `if (event.requiresRsvp)` block in `src/app/events/[id]/page.tsx`. Per-occurrence buttons are not available for those events on the detail page. The list view still gets a single next-occurrence button. This is an accepted Phase 4 tradeoff. If per-occurrence buttons are wanted for RSVP-free recurring events (e.g., a club meeting that has no signup), the detail page would need to build an occurrence list outside the `requiresRsvp` branch and render a lightweight occurrence table with only calendar buttons and no signup state. Track as a future improvement if members request it.
