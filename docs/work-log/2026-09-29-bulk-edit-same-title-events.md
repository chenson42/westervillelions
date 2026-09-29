# Bulk-edit same-titled upcoming events — Work Log

> **Slug:** `2026-09-29-bulk-edit-same-title-events`
> **Surface:** (dashboard) admin
> **Permission(s):** existing `events.edit` (`FEATURES.EVENTS_EDIT`) covers this — no new key
> **Estimated complexity:** small-to-medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-09-29 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-09-29 |
| 3 — Technical design | tech-lead | Complete | Design complete | 2026-09-29 |
| 4 — Implementation (server) | api-developer | Complete | — | 2026-09-29 |
| 4 — Implementation (client) | ux-developer | Complete | — | 2026-09-29 |
| 5 — Verification | qa | Complete | PASS | 2026-09-29 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-09-29 |

---

# Phase 1 — Functional Refinement (analyst)

## Context: today's data was already fixed by script, not by this feature

`scripts/add-2026-27-meeting-schedule.ts` seeded the 2026-27 meeting schedule (General/Activities/Board
meetings, Sept 2026–June 2027) as ~26 independent `events` rows, each `is_recurring = false`. On
2026-09-25 the admin (chenson42) opened one General Meeting and one Activities Meeting at
`/admin/events/[id]` and unchecked "Requires RSVP," expecting it to apply across the schedule. It
applied to those two rows only, because there is no series linking them. Today (2026-09-29),
`scripts/disable-rsvp-on-meetings.ts` was run to finish that change on every remaining upcoming
"General Meeting" / "Activities Meeting" / "Board Meeting" row (exact-title, `start_date >= now()`,
deliberately excluding "Activities Meeting — Christmas Party"). Existing `event_rsvps` rows on those
meetings were left in place; only collection stopped.

**This Phase 1 is about preventing the recurrence of this defect, not about repairing the current
data — the data is already correct.** The next time the admin needs to change location, time,
description, visibility, RSVP requirement, or attendee/guest settings across the meeting schedule,
there should be a UI path that doesn't require an engineer to write and run a one-off script.

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> Let an admin editing one event optionally fan a small, explicitly-safe set of field changes out to
> every other exact-title-matching event that hasn't happened yet — without ever touching each row's
> own date, and without silently overwriting a sibling's independent differences.

## Recommended shape

Of the three candidate shapes in the brief, I recommend **Shape 1 — "Apply to other upcoming events
with this title," offered inline on `/admin/events/[id]`** — with the v1 field list narrowed further
than the brief's candidate list (see Gaps, "Split the safe-field list by risk" below). Rationale:

- **Shape 2** (multi-select bulk edit on `/admin/events`) is more general but is solving a problem the
  club doesn't have yet — nobody has asked to bulk-edit an arbitrary *selection* of unrelated events,
  only to fix the meeting schedule as a group. It's real UI surface (list checkboxes, a bulk dialog
  with per-field toggles) for a need Shape 1 already covers. I'd park it in the backlog rather than
  build it now; if a second bulk-edit need shows up that isn't "same title," that's the trigger to
  revisit.
- **Shape 3** (true recurring series with per-occurrence overrides) is the architecturally "correct"
  answer, but it's a bigger project than this ticket, for a concrete reason I confirmed in
  `src/lib/db/schema.ts`: `eventOccurrenceOverrides` (line ~455) only stores a cancellation
  (`cancelledAt`, `cancelledByUserId`, `cancellationReason`) — there is **no field-override mechanism**
  for location, time, or RSVP settings per occurrence today. Modeling "Board moved from the 4th
  Tuesday to the 4th Thursday mid-year, no December meeting, November is 11/12 not 11/26" as a single
  recurrence rule plus overrides is a real schema/tech-lead-scale design problem, not a same-ticket
  add-on. Worth a backlog item for later; not this ticket.

Shape 1 directly targets the actual failure (an admin's single-row edit not propagating) with the
smallest surface area, reuses the existing single-event edit page and its existing permission check,
and requires no new schema.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| admin | Opens `/admin/events/[id]` for one occurrence of a same-titled schedule (existing) | on demand |
| admin | Edits one or more fields on that event (existing) | on demand |
| admin | **Sees** a secondary control — "Also apply to N other upcoming '&lt;title&gt;' events" — appear when N&gt;0 exact-title future siblings exist | on demand, conditional |
| admin | **Opts in** by checking that control before saving | on demand |
| admin | **Confirms** via `<ConfirmDialog>` that names the affected dates/count and the exact fields/values being applied | on demand |
| admin | **Reads** the save result — a toast naming how many sibling rows were updated, and naming any that failed | on demand |

Everything here is admin-surface only; there is no member- or public-facing verb in this feature. The
brief already names the surface correctly — flagging that Pass 1's usual "which surface" question is
already answered, not a gap.

## Flows

**Flow 1 — Edit a field and fan it out:**
`/admin/events/[id]` (existing meeting row) → admin loads page, baseline field values captured on
load → page has queried, on load, for other rows sharing this event's *exact, as-loaded* title with
`start_date >= now()` and `id <> this id` → admin changes a safe-listed field (e.g. unchecks "Requires
RSVP") → if N&gt;0 siblings exist, a checkbox appears: "Also apply to N other upcoming '&lt;title&gt;'
events" (unchecked by default) → admin checks it → admin clicks Save → client computes which
safe-listed fields actually changed from the load-time baseline → `<ConfirmDialog>` shows, naming the
field(s)/new value(s) and **listing the affected event dates** (not just a bare count — see Adversarial
pass) and stating "Existing RSVPs on these events are kept" when `requiresRsvp` is one of the changed
fields → admin confirms → server re-checks `events.edit`, reloads the source event, **recomputes** the
sibling set itself (never trusts a client-supplied id list), applies only the server's own fixed
allowlist of fields with the server's own diff (never a raw client payload) → outcome: toast "Saved.
Also updated N other '&lt;title&gt;' events."
- Failure: a sibling row was deleted or renamed between page-load and save → server updates whichever
  matching rows still exist and still match, and the toast says so plainly: "Saved. Updated 6 of 7
  other events — 1 no longer matched and was skipped." Never a silent under-count, never a raw error
  string.

**Flow 2 — Ordinary single-row save (must keep working exactly as today):**
`/admin/events/[id]` → admin edits fields → does not check the (possibly absent) fan-out box → Save →
outcome: only this row updates, identical to current behavior. This is the default path and must add
zero friction when there's nothing to fan out to (N=0) or the admin doesn't want to.
- Failure: existing single-row save failure handling, unchanged by this feature.

**Flow 3 — Exact-title match protects the exception row:**
Admin edits "Activities Meeting — Christmas Party" → sibling query for that literal title returns
zero rows (assuming one party) → no fan-out control appears. Separately, admin edits plain "Activities
Meeting" → sibling query never matches "Activities Meeting — Christmas Party" because the strings
differ → the Christmas Party is never swept into a plain-"Activities Meeting" bulk change. This is the
exact-match recommendation working as intended, not a failure path — confirming it explicitly because
it's the scenario the brief called out by name.

**Flow 4 — Concurrent edit race:**
Admin A opens Board Meeting #3, changes location, checks fan-out, saves → concurrently Admin B opens
Board Meeting #5 and independently changes its location, saving first → A's fan-out request, evaluated
server-side at submit time, still matches #5 (title/date unchanged) and overwrites B's just-made
location with A's → B's edit doesn't survive, and B is not notified. This is the same last-write-wins
behavior any two admins already get editing one row moments apart — the fan-out doesn't make the race
worse, it just multiplies how many rows one save can silently clobber. Flagged as a gap below, not a
blocker: no optimistic locking is being requested, but the save result should name every row it
touched so the *admin who is currently fanning out* can notice something unexpected (e.g. a date
they didn't expect in the list), even though it can't protect Admin B.

## Permissions

- **Permission:** existing `FEATURES.EVENTS_EDIT` (`"events.edit"`) — no new key. The fan-out is a
  convenience over actions the admin could already perform one row at a time; it must not become a
  new grantable capability.
- **Default roles:** confirmed in `drizzle/migrations/0002_roles_permissions_groups_campaigns.sql` —
  `admin` (all features) and `board_member` (explicit `events.edit` grant) already hold this key
  today. No widening.
- **Server-side requirement:** the bulk-apply route/action must independently call
  `hasFeature(session.user.features, FEATURES.EVENTS_EDIT)` itself (matching the existing pattern in
  `src/app/api/admin/events/[id]/route.ts`), not rely on the page-level gate or trust anything the
  client asserts about permission.

## Gaps the Request Didn't Address

- **Time-of-day and duration are not flat column copies — they're a decompose/recompose problem, and
  this codebase has a documented history of naive-timestamp bugs.** The brief lists "time-of-day,
  duration" as fan-out candidates alongside flat fields like `location`/`description`. But
  `events.startDate`/`endDate` are single naive wall-clock timestamp strings (DECISION-005) — there is
  no separate time-of-day column. Fanning out "the new start time" means, per sibling row: keep that
  row's own calendar date, replace only its time component, and reapply the edited event's new
  duration (or new end time-of-day) to get the new end. That's real per-row logic, not `SET col =
  value`, and this exact class of bug (naive timestamp read as UTC, meetings shifting hours) is
  already a recorded incident in this project. **Recommendation: ship v1 without time-of-day/duration
  in the fan-out allowlist.** Restrict v1 to genuinely flat fields: `location`, `description`,
  `isPublic`, `requiresRsvp`, `maxAttendees`, `allowGuestCount`, `extraQuestion`,
  `extraQuestionType`, `extraQuestionOptions`, `extraQuestionRequired`. That list alone would have
  covered today's actual incident (`requiresRsvp`). Time-of-day fan-out can be a fast-follow once
  someone actually needs to retime the whole schedule at once, designed with the wall-clock handling
  explicitly in mind.
- **`title`, `startDate`, `endDate`, `image`, `isFeatured`, and every `isRecurring`/`recurrence*`
  field must never be fanned out, and the server must enforce this itself, not just omit them from
  the UI.** A same-permission admin hitting the bulk endpoint directly with an arbitrary JSON body
  must not be able to smuggle `startDate` (or anything else off-allowlist) into the sibling update —
  the server needs a hardcoded field allowlist it filters the request against, independent of what
  the client sends. This is the brief's own instruction ("server must recompute or receive an
  explicit field list — never trust the client's diff blindly"); I'm calling it out as a concrete
  gap because the existing single-event `PATCH /api/admin/events/[id]` route is a **full-body
  replace**, not a diff (I read it — it writes every field from the request body unconditionally).
  The bulk path cannot reuse that pattern as-is; it needs its own narrower, allowlisted write path.
- **Renaming the title and fanning out in the same save is ambiguous — freeze the sibling set at
  page-load.** If the admin edits both the title and a safe field in one save and checks fan-out,
  which title selects the siblings — the pre-edit (loaded) title, or the just-typed new one? The
  sibling *set* must be the one computed from the title as loaded (before this edit), not
  recalculated against a title the admin is mid-typing. This falls naturally out of "title is never a
  fanned-out field," but the *selection query* needs the same freeze, or a mid-edit title change could
  silently change which rows the checkbox even offers between page-load and click.
- **No audit trail exists for event edits today, bulk or single** — `updated_at` moving is the only
  trace. For a bulk save specifically (one click changing N rows), I recommend the save response name
  every affected row (id, title, date) so the client can render a specific result, not just a count —
  "Updated Board Meeting on Oct 22, Nov 12, Jan 28, ..." This is achievable without a new audit-log
  table (out of proportion for this feature) and gives the admin who just clicked something concrete
  to sanity-check against what they expected. A durable per-row audit log for events generally is a
  reasonable backlog idea but is out of scope here.
- **Existing RSVPs surviving a `requiresRsvp` flip must be stated in the confirm copy, not just true
  in the database.** Today's script already validated the underlying behavior (existing
  `event_rsvps` rows are untouched when `requires_rsvp` is turned off) — the gap is only that the new
  UI must say so explicitly in the `<ConfirmDialog>` body whenever `requiresRsvp` is one of the fields
  being changed, so the admin isn't left guessing whether flipping the flag deletes anyone's RSVP.
- **Empty state:** N=0 (no other upcoming exact-title events) should produce *no visible control at
  all* — not a disabled checkbox, not a "0 other events" message. This is the correct empty state for
  this feature (it should be invisible), but I'm naming it so ux-developer doesn't build a redundant
  zero-state message.
- **Failure microcopy:** if the bulk save 500s or the DB is unreachable mid-batch, the toast must be
  human ("Couldn't save the other events. Try again.") not a raw error/stack trace — same bar as any
  other admin save, called out because this is new endpoint surface.
- **Mobile at 360px:** the new checkbox label ("Also apply to N other upcoming '&lt;title&gt;'
  events") and the `<ConfirmDialog>` body (which will list several dates) need to wrap cleanly and not
  overflow at 360px. Low risk, but the dialog is denser than a typical confirm and worth a specific
  mobile check in Phase 5.

## Out of Scope (confirm with user)

- **True recurring series with per-occurrence field overrides (Shape 3).** Confirmed via schema read
  that `eventOccurrenceOverrides` only supports cancellation today, not field overrides — building
  this properly is its own schema project. Recommend a backlog item, not folding it into this ticket.
- **General multi-select bulk edit across arbitrary events (Shape 2).** No stated need beyond the
  meeting schedule; defer unless a second, non-same-title bulk-edit need appears.
- **Time-of-day / duration fan-out.** Named above as a real but harder problem; recommend deferring to
  a fast-follow once actually needed, rather than shipping it alongside the flat-field v1.
- **A general events audit log.** `updated_at` plus a per-row result list in the save response is
  proposed as sufficient for this feature; a durable audit trail for all event edits is a separate,
  larger idea.

## Open Questions

1. **Confirm the v1 field allowlist.** I'm recommending: `location`, `description`, `isPublic`,
   `requiresRsvp`, `maxAttendees`, `allowGuestCount`, `extraQuestion`, `extraQuestionType`,
   `extraQuestionOptions`, `extraQuestionRequired` — and explicitly deferring time-of-day/duration.
   Does that match what you'd actually reach for next (e.g., is retiming the whole schedule at once a
   near-term need that should pull time-of-day into v1 despite the added complexity)?
2. **Confirm "upcoming" = `start_date >= now()` evaluated server-side at save time**, not relative to
   the edited event's own date — this is what keeps the invariant simple ("never write to a past
   event") and matches what `scripts/disable-rsvp-on-meetings.ts` already did today. Any objection?
3. **Should the `<ConfirmDialog>` list every affected event's date, or is a bare count acceptable?**
   I'm recommending the explicit list specifically so an admin can catch an accidental title collision
   (e.g., two unrelated events that happen to share an exact title) before confirming — this is the
   adversarial-pass finding I'd weight highest. Agree, or is a count enough given how rare title
   collisions are in practice?

---

# Phase 2 — Architectural Review (architect) — 2026-09-29

## Decisions (resolving Phase 1's three open questions — recorded as decisions, not open questions)

1. **v1 field allowlist is exactly:** `location`, `description`, `isPublic`, `requiresRsvp`,
   `maxAttendees`, `allowGuestCount`, `extraQuestion`, `extraQuestionType`, `extraQuestionOptions`,
   `extraQuestionRequired`. Time-of-day/duration fan-out is deferred to the backlog (naive
   wall-clock decompose/recompose risk, DECISION-005). `title`, `startDate`, `endDate`, `image`,
   `isFeatured`, and every `isRecurring`/`recurrence*` field are never fanned out, in the UI or at
   the server allowlist.
2. **"Upcoming" = `start_date >= now()`, evaluated server-side at save time** — but see the ruling
   below on *how* that comparison must be implemented. This is not a redefinition of Phase 1's
   decision, it's a correction to the naive implementation the decision's own wording (and the
   precedent script) would otherwise invite.
3. **The `<ConfirmDialog>` lists the actual affected dates, not a bare count.** This requires a small,
   backward-compatible widening of the shared `ConfirmDialog` primitive — see ruling below.

## Review findings

### 1. Server/client split — sibling lookup and the field allowlist

Read `src/app/(dashboard)/admin/events/[id]/page.tsx` (server component; loads the event, checks
`hasFeature(session.user.id, FEATURES.EVENTS_EDIT)`, passes data to a client `EventForm`) and
`src/components/admin/event-form.tsx` (`"use client"`, owns `formData` state seeded from the
server-fetched `event` baseline prop, already does its own delete `ConfirmDialog` inline).

**Ruling:**
- **Sibling lookup for display** (the "N other upcoming events" count/list shown on page load) is
  computed server-side in `page.tsx`, from the event's title **as loaded from the DB** — not from
  anything the client could mutate — and passed down as a prop, the same way `event` already is.
- **Sibling lookup for the actual write** is recomputed *again*, independently, inside the PATCH
  handler at save time, from the server's own re-fetch of the pre-edit row's title (`existing.title`,
  already loaded in the handler today) — never from a client-supplied id list, and never from the
  request body's (possibly just-edited) title. This satisfies Phase 1's Gap ("freeze the sibling set
  at page-load") on the server side, where it actually matters for correctness, not just on the
  client.
- **The field allowlist is a single server-side constant**, checked independently of anything the
  client sends. The client's own "which fields changed" set (diffed against the `event` baseline
  prop already in `formData` state — no new tracking needed) is only ever a UI hint for the
  confirm-dialog copy; the server **intersects** the client's requested field list against its own
  allowlist and only ever writes the intersection. A same-permission admin hitting the route directly
  with an arbitrary body must not be able to smuggle `startDate` or any other off-allowlist field into
  the sibling write — this matches Phase 1's own instruction and CLAUDE.md's "permission is the only
  gating mechanism" framing (the allowlist is a data-shape boundary, not a second permission system).

### 2. The "upcoming" comparison must not be raw SQL `now()` — this changes the Phase 1 shape

This is the one ruling in this review that materially changes what Phase 1 described, so flagging it
clearly: **Phase 1's Open Question 2 and today's `scripts/disable-rsvp-on-meetings.ts` both frame
"upcoming" as a literal `WHERE start_date >= now()` SQL predicate. That pattern must not be used in
the shipped feature.**

`events.startDate` is `timestamp("start_date", { mode: "string" })` — a naive wall-clock string with
no time zone, per DECISION-005. Comparing it directly against Postgres `now()` (a `timestamptz`)
forces an implicit cast, and that cast is governed by the *connection's* session time zone, not
Eastern. If that session is UTC (Neon commonly is), the comparison effectively treats the club's
wall-clock time as if it were already UTC — exactly the "naive-timestamp-as-UTC" bug already logged
in this project's memory (events/RSVP timestamps displaying ~4-5 hours off) and exactly why
`src/lib/events.ts` exports `nowEastern()` in the first place. A 7pm Eastern meeting would read as
"already started" a full 4 hours early under this comparison. `scripts/disable-rsvp-on-meetings.ts`
got away with the raw-SQL version because it was run once, by hand, at a specific moment, and
eyeballed — that tolerance does not exist for an automated save path that runs unattended on every
admin edit.

The established, already-repeated pattern in this codebase (`src/app/page.tsx`, `src/app/events/
page.tsx`, `src/app/events/past/page.tsx`, `src/app/members/events/page.tsx`,
`src/app/(dashboard)/admin/events/page.tsx`, `src/app/(dashboard)/admin/events/[id]/page.tsx`,
`src/lib/event-announcements-queries.ts#getFutureOccurrenceOptions`) is: fetch the small candidate
set with a cheap SQL predicate (here, exact title match — cardinality is a handful of rows), then
filter "is this upcoming" **in application code** with `parseWallClock(row.startDate)` compared
against `nowEastern()` (or date-fns `isAfter`/`isBefore` against it). **The sibling query must follow
this same pattern**: `WHERE title = :title AND id <> :id` in SQL, then filter the results by
`isAfter(parseWallClock(row.startDate), nowEastern())` (or `!isBefore(...)`) in JS before either
displaying the count or writing to the matched rows. Both `parseWallClock` and `nowEastern` are
already exported from `src/lib/events.ts` for exactly this purpose — no new date-handling logic is
needed, only correct reuse of what's there.

### 3. API contract: extend PATCH, not a separate route

Read `src/app/api/admin/events/[id]/route.ts` in full. Confirmed Phase 1's read: PATCH is a full-body
replace (every field written unconditionally from the request body, with `?? existing.field`
fallbacks), not a diff.

**Recommendation: extend `PATCH /api/admin/events/[id]` with an optional `applyToSiblings: { fields:
string[] }` body member. Do not add a separate route.**

Rationale:
- The prompt's own transactionality requirement — the edited row and its matched siblings must
  commit as one transaction — is the deciding factor. A separate route (e.g. `POST .../apply-to-
  siblings`) would either (a) run as a second HTTP request after the PATCH, meaning two separate
  transactions and a window where the main row saved but siblings didn't (or vice versa if ordered the
  other way), or (b) have to duplicate the main row's full-body-replace logic (image handling via
  `upsertEventImage`/`deleteEventImage`, the recurrence-field clearing, the `?? existing.field`
  fallbacks) inside a second handler so it could own the single transaction itself — which is exactly
  the kind of copy-pasted logic this project's review process is charged with catching.
- One request, one handler, one `db.transaction()` wrapping (1) the existing full-body update of the
  target row unchanged, and (2) a clearly separated `if (body.applyToSiblings) { ... }` block that
  does the sibling recompute + allowlist intersection + per-row update. This keeps the full-replace
  and allowlisted-diff code paths textually distinct inside one file without needing two commits to
  stay in sync.
- Precedent: `db.transaction()` is already an established pattern in this codebase (multiple Ledger
  routes, e.g. `src/app/api/admin/ledger/transactions/[id]/route.ts`,
  `.../reconciliation/sessions/[sessionId]/close/route.ts`) — nothing new is being introduced here,
  just applied to a new call site.
- The response should report the actual count/rows touched (id, title, date, and whether it was
  updated or skipped-as-no-longer-matching), never the client's stale page-load count — this is what
  lets the toast in Flow 1's failure case ("Updated 6 of 7...") be accurate.

### 4. Directory placement

- **The field allowlist constant and the "is this row upcoming" predicate belong in `src/lib/
  events.ts`**, not a new file. That module is deliberately pure (no `db` import — confirmed by
  reading it; date-fns math only) and is **already imported by client components**
  (`src/components/home/featured-content.tsx`, `src/components/admin/event-table-row.tsx`,
  `src/components/admin/club-files/event-attach-picker.tsx` all do this today), so it's the correct
  single source of truth for a constant that both the server route and the client form need to agree
  on by name.
- **The DB-touching sibling-lookup query belongs in a new file, `src/lib/event-siblings-queries.ts`**,
  following the existing `*-queries.ts` convention that already separates DB-touching helpers
  (`event-announcements-queries.ts`, `event-images-queries.ts`) from the pure `events.ts`. Do not add
  `db` imports to `events.ts` to make this feature work — that would blur an existing, deliberate
  separation.
- **No new API route file** — extends the existing `src/app/api/admin/events/[id]/route.ts` (see
  above).
- **Client UI** — extends the existing `src/components/admin/event-form.tsx` (already the right home
  per the Component Rules: admin-specific composition, already owns its own delete
  `<ConfirmDialog>` inline). A new checkbox + confirm-dialog block is small enough to stay inline
  following the existing delete-confirm pattern; if tech-lead/ux-developer finds it makes the file
  unwieldy, splitting it into a small sibling component (e.g. `src/components/admin/
  apply-to-siblings-control.tsx`) is a reasonable implementation call, not one I'm blocking on.
- **Shared UI primitive change**: `src/components/ui/confirm-dialog.tsx`'s `description` prop is
  typed `description: string` and rendered as `{description}` — it cannot currently render a list of
  dates. **Ruling: widen `description` to `React.ReactNode`.** This is backward-compatible (every
  existing call site — `dues-payment-actions.tsx`, `event-form.tsx`'s own delete dialog,
  `event-announce-sender.tsx`, `group-form.tsx`, `dues-reminder-sender.tsx`,
  `reset-password-button.tsx`, `occurrence-rsvp-section.tsx`, `suspend-user-button.tsx` — already pass
  a plain string, which is a valid `ReactNode`) and is the correct place to make this change once,
  rather than each future caller inventing its own workaround. Flagging this explicitly since it's a
  change to a shared primitive under `src/components/ui/`, which is squarely this review's territory.

### 5. Duplication check — no existing helper for "same-title upcoming events"

Searched for anything close: `getFutureOccurrenceOptions()` in `event-announcements-queries.ts` is a
different concept (occurrences of *one* recurring event's own recurrence rule, via
`generateOccurrences`), not independent same-titled rows. `scripts/disable-rsvp-on-meetings.ts` is a
one-off script, not a reusable helper, and uses the raw-SQL-`now()` pattern this review just ruled
out. No consolidation opportunity is being missed by adding `src/lib/event-siblings-queries.ts`; this
is new, justified surface, not a third copy of an existing decision.

### 6. Transactionality and stale counts

Confirmed as a hard requirement per the API contract ruling above: one `db.transaction()` per save,
covering the main row and every matched-and-still-eligible sibling. The dialog's displayed count is
allowed to be stale (computed at page load); the **server response** must report what it actually
touched, and the toast must be built from that response, not from the pre-save count — this is
already Phase 1's own Flow 1 failure case, just confirmed here as an architectural requirement rather
than a nice-to-have.

### 7. Invariants

- **Permission:** confirmed `events.edit` (`FEATURES.EVENTS_EDIT`) is the only gate, re-checked inside
  the PATCH handler exactly as it is today (`session?.user?.features?.includes(FEATURES.EVENTS_EDIT)`
  in `src/app/api/admin/events/[id]/route.ts`). No new `FEATURES.*` key, no role-binding migration.
  The allowlist is a data-shape boundary inside an already-permitted write, not a second permission
  system — consistent with "permissions are the only gating mechanism."
- **No native dialogs:** confirmed the plan uses `<ConfirmDialog>` (with the widening above), no
  `window.confirm()`.
- **No new npm dependency:** confirmed. Everything needed (`date-fns` comparisons, Radix-backed
  `ConfirmDialog`, Drizzle `db.transaction()`) already exists in the dependency set.
- **No schema change:** confirmed. `events` table is untouched; no new column, no new table.
- **Audit trail:** agree with Phase 1's recommendation to skip a persisted audit table for v1. Checked
  `src/lib/db/schema.ts` for an existing generic mechanism first, per this review's instructions:
  `permissionAuditLog` (line ~107) and `ledgerAuditLog` (line ~810) both exist, but both are narrowly
  shaped with typed nullable FK columns to their own domain (roles/features/users;
  categories/transactions) — neither has an event-shaped target column, and repurposing either would
  itself be a schema change (a new nullable `target_event_id` FK plus a generic jsonb diff column),
  which is out of proportion for this feature and outside what Phase 1 asked for. `updated_at` moving
  plus the per-row result list in the API response (id, title, date, updated/skipped) is sufficient
  for v1's need (the admin sanity-checking what a single click just touched). A general, schema-backed
  events audit log remains a legitimate backlog idea, not this ticket.
- **Migrations:** none required.

## Verdict

**Approved with suggestions.**

Phase 1's recommended shape (inline fan-out control on `/admin/events/[id]`, reusing `events.edit`,
no new schema) is architecturally sound and requires no loop-back. The suggestions tech-lead should
build into the Phase 3 design:

1. **Implement "upcoming" via `parseWallClock()`/`nowEastern()` in application code, never a raw SQL
   `start_date >= now()` predicate** — this is the one ruling that changes the naive reading of Phase
   1's Open Question 2 / the precedent script; see finding 2 above. This is the most important ruling
   in this review.
2. Extend `PATCH /api/admin/events/[id]` with `applyToSiblings: { fields: string[] }`, wrapped in one
   `db.transaction()`; do not add a separate route (finding 3).
3. Put the field allowlist + upcoming-predicate helper in `src/lib/events.ts` (pure); put the
   DB-touching sibling query in a new `src/lib/event-siblings-queries.ts` (finding 4).
4. Widen `src/components/ui/confirm-dialog.tsx`'s `description` prop from `string` to `React.ReactNode`
   (finding 4) so the dialog can list affected dates.
5. Server response must report actual rows touched (id, title, date, updated/skipped); client toast
   and confirm-dialog count must both be built from live data, not a stale page-load count for the
   toast (finding 6).
6. No audit-log table; per-row response detail is sufficient for v1 (finding 7).

No new `DECISION-NNN` entry is warranted — this feature adds no new dependency, no new top-level
module, and no permission-catalog change; it extends an existing route, adds one new `-queries.ts`
file following an existing convention, and makes one backward-compatible prop-type widening to an
existing shared primitive. All of that is implementation-shape guidance for tech-lead, not a
structural precedent rising to the decisions log.

## Implementer recommendation

**api-developer → ux-developer (specialist split), not full-stack-developer.** Estimated size:
the server half alone (sibling query helper, allowlist constant, PATCH extension with a transaction,
recompute-and-intersect logic, response shape) is realistically 80-120 lines once you include the
transaction wrapping and the "skipped" bookkeeping; the client half (baseline diff, conditional
checkbox, confirm-dialog date list, submit payload, toast copy for the partial-success case) is
another 80-120 lines. That's past the ~150-line full-stack threshold in total, and — unlike a truly
small/coupled feature — the two halves have a clean, easily-specified handoff (the `applyToSiblings`
request shape and the per-row result response shape), so splitting doesn't cost the overhead
full-stack-developer exists to avoid. api-developer should also write the allowlist/upcoming-predicate
helper and the transaction-wrapped route; ux-developer builds on top of that finished contract.

## What I did

- Read `CLAUDE.md` in full and the entire Phase 1 entry above.
- Read `src/app/api/admin/events/[id]/route.ts` (PATCH/DELETE handlers) in full.
- Read `src/lib/events.ts` header/exports and confirmed it has no `db` import (pure).
- Read `src/lib/event-announcements-queries.ts#getFutureOccurrenceOptions` and
  `scripts/disable-rsvp-on-meetings.ts` to compare "upcoming" implementations.
- Grepped every `nowEastern()` call site across `src/app` and `src/lib` to confirm the established
  app-wide pattern for comparing against the current wall-clock time.
- Read `src/lib/db/schema.ts` for `events.startDate`'s column type and for every existing
  `*_log`/`*_audit`/`*_history` table (`permissionAuditLog`, `ledgerAuditLog`,
  `googleGroupSyncLog`, `failedLoginAttempts`) to check for a reusable audit mechanism.
- Read `src/app/(dashboard)/admin/events/[id]/page.tsx` (server) and
  `src/components/admin/event-form.tsx` (client) to confirm the existing server/client split and the
  `formData`/baseline-`event` state shape already available for a client-side diff.
- Read `src/components/ui/confirm-dialog.tsx` in full and grepped every call site of `<ConfirmDialog`
  to confirm the `description` prop is always passed a plain string today (safe to widen).
- Confirmed `db.transaction()` precedent across several Ledger route handlers.

## Outputs

- `docs/work-log/2026-09-29-bulk-edit-same-title-events.md` — this Phase 2 section appended; status
  table row updated to Complete / Approved with suggestions.
- No `docs/decisions.md` entry added — not warranted (see Verdict).
- No application code touched, per this phase's scope.

## Open questions / handoff notes

- Tech-lead (Phase 3) should name the exact request/response JSON shapes for the extended PATCH
  (`applyToSiblings.fields`, and the per-row result array) and specify the confirm-dialog copy for the
  `requiresRsvp`-survives-as-is note Phase 1 already called for.
- Tech-lead should also specify exactly where the client-side "which fields changed" diff is computed
  (comparing live `formData` against the `event` baseline prop already in `event-form.tsx` — no new
  state needed) and how it's intersected with the server allowlist in the request payload vs. purely
  as display copy.
- If `ConfirmDialog`'s prop widening ends up touched by a different, unrelated feature before this one
  reaches Phase 4, that's fine — the widening is additive and idempotent in effect (a second no-op
  type change), just don't let two features fight over the same line in a merge.
- Migration-number guidance is not applicable here (no migration in this feature), but noting it's
  absent is itself confirmation there's no schema surface to worry about.

---

# Phase 3 — Technical Design (tech-lead) — 2026-09-29

## Summary

This builds Phase 2's approved shape: an inline "Also apply to N other upcoming '<title>' events"
control on `/admin/events/[id]`, extending the existing `PATCH /api/admin/events/[id]` with an
optional `applyToSiblings` request member, one `db.transaction()` covering the edited row and its
siblings, and a server-owned field allowlist that is never trusted from the client. No schema
change, no new permission, no new dependency. Below is the exact contract, data flow, component
plan, implementation order with the api-developer → ux-developer handoff seam, edge cases, and the
unit tests each implementer must deliver.

## Permissions

- **Permission:** existing `FEATURES.EVENTS_EDIT` (`"events.edit"`) only. No new key, no role
  binding, no `add-permission` skill run.
- **Server-side check:** unchanged — `session?.user?.features?.includes(FEATURES.EVENTS_EDIT)` at
  the top of `PATCH`, before the request body is even parsed. This single check gates both the
  ordinary single-row save and the sibling fan-out; the allowlist below is a data-shape boundary
  inside an already-permitted write, never a second permission system.
- **Page-level check:** unchanged — `hasFeature(session.user.id, FEATURES.EVENTS_EDIT)` in
  `src/app/(dashboard)/admin/events/[id]/page.tsx`. The new sibling-summary query added to that page
  (below) runs only after that check passes, same as every other query already on the page.

## API Contract

**`PATCH /api/admin/events/[id]`** — extended, not replaced. Same URL, same method, same existing
top-level fields. One new optional request member and one changed response shape.

### Request body (additive)

```ts
{
  // ...all existing fields unchanged (title, description, startDate, endDate, location, image,
  // isPublic, isFeatured, requiresRsvp, allowGuestCount, maxAttendees, isAllDay, isRecurring,
  // recurrenceType, recurrenceDays, recurrenceEndDate, extraQuestion, extraQuestionType,
  // extraQuestionOptions, extraQuestionRequired)...

  applyToSiblings?: {
    fields: string[];   // client's "which allowlisted fields did I change" hint — a display/intent
                         // signal only. The server independently recomputes the sibling SET.
  };
}
```

`applyToSiblings` is omitted entirely for the ordinary single-row save (today's behavior, byte-for-
byte unchanged: only the target row updates, `siblings` comes back `null`, no sibling query is even
issued).

### Response body (changed shape — see "Why the response shape can change" below)

```ts
{
  event: Event;                 // the fully updated target row, same shape PATCH always returned
  siblings: {
    matched: number;            // eligible upcoming same-title siblings, computed fresh at save time
    updated: { id: string; title: string; startDate: string }[];
    skipped: { id: string; title: string; startDate: string }[]; // matched but not written (e.g.
                                                                    // deleted between the SELECT and
                                                                    // the UPDATE inside the same tx)
  } | null;                      // null when applyToSiblings was not requested
}
```

**Why the response shape can change safely:** `src/components/admin/event-form.tsx`'s
`handleSubmit` today does `const response = await fetch(...); if (!response.ok) { const error =
await response.json(); throw ... }` — on success it never reads the body at all, only
`response.ok`. This route has exactly one caller. Wrapping the previously-bare `updated` row in
`{ event, siblings }` is a safe, single-commit change with no dual-write/back-compat period needed.

### Validation & error cases

| Case | Behavior |
|---|---|
| `applyToSiblings` omitted | Identical to today's PATCH. No sibling query, no transaction change beyond wrapping the existing update in `db.transaction()` (see Data Flow). `siblings: null`. |
| `applyToSiblings.fields` present but not a non-empty array of strings (`[]`, `undefined`, a non-array) | `400 { error: "applyToSiblings.fields must be a non-empty array of field names." }`. **Nothing is written** — not the siblings, not the main row either. Fail fast before entering the transaction. A correct client never produces this (see Component Plan); it only fires on direct/adversarial API use. |
| `applyToSiblings.fields` contains only names outside `EVENT_SIBLING_FAN_OUT_FIELDS` (e.g. `["startDate"]`), so the server-side intersection is empty | `400 { error: "No recognized fields to apply to other events." }`. Nothing written. This is the "smuggle `startDate`" defense Phase 1/2 both called out — the response is a clean rejection, not a silent 200 that quietly did nothing. |
| `applyToSiblings.fields` mixes allowlisted and non-allowlisted names (e.g. `["location", "startDate"]`) | **Silent intersection, not an error.** Only `location` is written to any sibling row; `startDate` is dropped with no error surfaced. This is deliberate (Phase 2: "the server intersects the client's field hint with a hardcoded allowlist") — a real UI-driven request should never contain an off-allowlist name, so silently dropping it (rather than 400ing the whole save) keeps a client-side bug from blocking an otherwise-valid edit, while still making the smuggle-only-illegal-fields case above a hard failure. |
| `applyToSiblings` present, valid, but zero eligible upcoming same-title siblings exist at save time (title collision resolved itself, all became past, or all were deleted) | `200`. Main row still saves. `siblings: { matched: 0, updated: [], skipped: [] }`. Not an error — see Edge Cases. |
| A sibling matched eligibility inside the transaction's own SELECT but the batched UPDATE's `RETURNING` doesn't include it (row deleted by a concurrent, already-committed transaction between the two statements) | That row's `{id, title, startDate}` (captured from the SELECT, before it vanished) is placed in `skipped`, not `updated`, and not surfaced as an error. The whole PATCH still returns `200`. |
| Caller lacks `FEATURES.EVENTS_EDIT` | `403`, unchanged, before the body is even parsed — `applyToSiblings` or not. |
| Target event not found | `404`, unchanged. |

## Data Flow

### Display (page load) — `src/app/(dashboard)/admin/events/[id]/page.tsx`

1. Load `event` as today (`db.query.events.findFirst(...)`).
2. **New:** call `getSiblingCandidatesByTitle(db, event.title, id)` (new file, see Component Plan) —
   one cheap SQL query: `WHERE title = :title AND id <> :id`. Cardinality is a handful of rows for
   this club's data; no index work is warranted (matches the precedent in
   `ledger-search-queries.ts`/`minutes-queries.ts` of sequential scans being fine at this volume).
3. **New:** filter the candidates in JS with `isUpcomingWallClock(c.startDate)` (new pure helper in
   `src/lib/events.ts`) — never a raw SQL `now()` predicate, per Phase 2 finding 2. Sort the survivors
   ascending by `startDate`.
4. Pass the result as a new prop, `siblingSummary: { id: string; startDate: string; isAllDay: boolean }[]`,
   to `<EventForm>`. `event.title` is already a prop; the summary doesn't repeat it per-row.
5. This computed-at-page-load list is allowed to go stale between load and save — that staleness is
   exactly what the save-time recompute (below) and the `skipped` array exist to catch and report
   honestly, never to silently paper over.

### Write (save) — `PATCH /api/admin/events/[id]`

1. `auth()` + `FEATURES.EVENTS_EDIT` check (unchanged, first line of the handler).
2. Load `existing = await db.query.events.findFirst({ where: eq(events.id, id) })` (unchanged — this
   is already the pre-edit row, and **`existing.title` is the ONLY title ever used to select
   siblings** — never `body.title`, even if the admin is renaming the event in this same save; see
   Edge Cases).
3. Parse `body`. Validate `applyToSiblings` per the table above; compute `allowedFields =
   (body.applyToSiblings?.fields ?? []).filter(f => EVENT_SIBLING_FAN_OUT_FIELDS.includes(f))` and
   400 per the rules above before opening a transaction.
4. **Extract the ten fan-out-eligible fields' normalized values ONCE, shared by both the main-row
   update and the sibling update** — this is the DRY requirement, not an optional nicety: today's
   main-row `.set()` already computes `description: description || null`, `extraQuestionOptions:
   Array.isArray(...) ? ... .filter(...) : []`, the `extraQuestion`-gated `extraQuestionType`/
   `extraQuestionRequired` logic, etc. Pull exactly those ten computed values (matching
   `EVENT_SIBLING_FAN_OUT_FIELDS`: `location`, `description`, `isPublic`, `requiresRsvp`,
   `maxAttendees`, `allowGuestCount`, `extraQuestion`, `extraQuestionType`, `extraQuestionOptions`,
   `extraQuestionRequired`) into local consts used by BOTH `.set()` calls. **Do not write a second,
   independently-derived copy of this normalization for the sibling path** — that is exactly the
   copy-pasted-decision pattern CLAUDE.md's duplication review exists to catch, and it's avoidable
   here for free since the values are identical by construction (a sibling receives the *edited
   event's own newly-saved value* for each allowed field, not a value re-derived some other way).
5. `db.transaction(async (tx) => { ... })`:
   a. Run the existing full-body update of the target row, unchanged in every particular, using `tx`
      instead of `db`.
   b. If `allowedFields.length > 0` (i.e. `applyToSiblings` was valid and non-empty):
      - `const candidates = await getSiblingCandidatesByTitle(tx, existing.title, id)`.
      - `const eligible = candidates.filter(c => isUpcomingWallClock(c.startDate))`.
      - If `eligible.length > 0`: build `fieldsToSet` = the subset of step 4's normalized values
        whose keys are in `allowedFields`, plus `updatedAt: new Date()`; run **one** batched
        `tx.update(events).set(fieldsToSet).where(inArray(events.id, eligible.map(c => c.id))).returning({ id: events.id, title: events.title, startDate: events.startDate })` —
        a single statement, not N per-row updates (no N+1).
      - Diff `eligible` against the `RETURNING` set by `id` to build `skipped` (matched-but-not-
        written) — this is how a concurrently-deleted sibling is caught without any extra query.
      - `siblings = { matched: eligible.length, updated: <returning rows>, skipped }`.
   c. If `allowedFields.length === 0` (no `applyToSiblings` requested at all), `siblings = null` and
      no sibling query runs — same no-op-cost guarantee the ordinary save has today.
6. Return `NextResponse.json({ event: updated, siblings })`.

## Component Plan

### Files to create

- **`src/lib/event-siblings-queries.ts`** — one DB-touching function:
  ```ts
  export type EventSiblingCandidate = { id: string; title: string; startDate: string; isAllDay: boolean };
  export async function getSiblingCandidatesByTitle(
    dbOrTx: { select: typeof db.select },
    title: string,
    excludeId: string
  ): Promise<EventSiblingCandidate[]>
  ```
  Callable with either `db` (page-load display) or the `tx` handed to `db.transaction()`'s callback
  (save-time write) — both expose the same Drizzle query-builder shape, so one function serves both
  call sites with zero duplication of the `WHERE title = ... AND id <> ...` SQL. No `FEATURES` check
  inside this file, matching every other `*-queries.ts` module's convention (permission gating is the
  caller's job).
- **`src/components/admin/apply-to-siblings-control.tsx`** (recommended, not mandatory — Phase 2 left
  this to implementation judgment). Given `event-form.tsx` is already ~700 lines, pull the new
  checkbox + confirm-dialog-body composition into this small sibling component, taking
  `siblingSummary`, `title`, `changedFields`, and an `onConfirm` callback as props. If ux-developer
  finds the split adds more friction than it saves for this specific control, inlining next to the
  existing delete-confirm block in `event-form.tsx` is an acceptable alternative — not a blocker
  either way.

### Files to modify

- **`src/lib/events.ts`** (pure — no `db` import added, preserving the existing separation):
  ```ts
  export const EVENT_SIBLING_FAN_OUT_FIELDS = [
    "location", "description", "isPublic", "requiresRsvp", "maxAttendees",
    "allowGuestCount", "extraQuestion", "extraQuestionType",
    "extraQuestionOptions", "extraQuestionRequired",
  ] as const;
  export type EventSiblingFanOutField = typeof EVENT_SIBLING_FAN_OUT_FIELDS[number];

  // "Upcoming" = start_date >= now, evaluated in application code against
  // nowEastern()-produced wall-clock components — never a raw SQL now() compare. DECISION-005.
  export function isUpcomingWallClock(startDate: string, now: Date = nowEastern()): boolean {
    return !isBefore(parseWallClock(startDate), now);
  }

  export type EventFanOutFieldValues = {
    location?: string | null;
    description?: string | null;
    isPublic?: boolean;
    requiresRsvp?: boolean;
    maxAttendees?: number | null;
    allowGuestCount?: boolean;
    extraQuestion?: string | null;
    extraQuestionType?: string | null;
    extraQuestionOptions?: string[] | null;
    extraQuestionRequired?: boolean;
  };
  // Pure diff over ONLY the fan-out allowlist keys — ignores every other field
  // (title, startDate, image, isFeatured, isRecurring, recurrence*) even if they
  // differ, because those can never be fanned out regardless of what changed.
  export function diffFanOutFields(
    baseline: EventFanOutFieldValues,
    current: EventFanOutFieldValues
  ): EventSiblingFanOutField[]
  ```
  `EventFormData` (declared in `event-form.tsx`) structurally satisfies `EventFanOutFieldValues`, so
  the client passes its existing `event` baseline prop and live `formData` state straight into
  `diffFanOutFields()` with no mapping step.
- **`src/components/ui/confirm-dialog.tsx`** — widen `description: string` to `description:
  React.ReactNode` in the props interface and nowhere else; every existing call site already passes
  a plain string, which remains valid.
- **`src/app/api/admin/events/[id]/route.ts`** — PATCH extended per the Data Flow section above.
  DELETE is untouched.
- **`src/app/(dashboard)/admin/events/[id]/page.tsx`** — add the `getSiblingCandidatesByTitle` +
  `isUpcomingWallClock` call and the new `siblingSummary` prop, per Data Flow's "Display" section.
- **`src/components/admin/event-form.tsx`** — new prop `siblingSummary?: { id: string; startDate: string; isAllDay: boolean }[]`;
  new local state `applyToSiblings: boolean` (default `false`); render the new control (inline or via
  `apply-to-siblings-control.tsx`) only when `siblingSummary && siblingSummary.length > 0`; on submit,
  compute `changedFields = diffFanOutFields(event ?? <empty defaults>, formData)` when the checkbox is
  checked; branch per "UI before/after save" below.

### UI before save

- **Control visibility:** the "Also apply to N other upcoming '&lt;title&gt;' events" checkbox
  renders **only** when `siblingSummary.length > 0`. Zero siblings ⇒ the control does not exist in
  the DOM at all — no disabled checkbox, no "0 other events" text (Phase 1's named empty-state
  requirement).
- **Checking the box** does not immediately show anything else — it's a plain opt-in, unchecked by
  default, exactly as Phase 1's Flow 1 specifies.
- **On Save click**, `handleSubmit` branches:
  - Checkbox unchecked, or `siblingSummary` empty/absent → submit exactly as today: plain PATCH body,
    no `applyToSiblings`, no new confirm dialog. The existing delete-confirm dialog is untouched and
    unrelated.
  - Checkbox checked, but `diffFanOutFields(event, formData).length === 0` (admin checked the box but
    didn't actually change any of the ten allowlisted fields) → **also submit as a plain PATCH**, no
    `applyToSiblings` member, no confirm dialog. There's genuinely nothing to fan out; showing a
    confirm dialog for zero fields would be a false alarm. (This is exactly why the 400
    "must-be-non-empty" case in the API contract only fires from direct API misuse, never from normal
    UI use — the client never sends an empty list.)
  - Checkbox checked and `changedFields.length > 0` → **intercept the submit** and open a new
    `<ConfirmDialog>` (via the widened `description: React.ReactNode`) instead of saving immediately.
    Its body:
    - Lists each entry in `changedFields` by label and new value (e.g. "Location: Fellowship Hall",
      "Requires RSVP: No").
    - States "Also applies to N other upcoming '&lt;title&gt;' events:" followed by the dates from
      `siblingSummary`, each formatted with `formatWallClockDate(parseWallClock(s.startDate),
      s.isAllDay)` (already client-safe, already imported elsewhere) — the actual dates, not a bare
      count, per Phase 1/2's explicit ruling.
    - **When `"requiresRsvp"` is in `changedFields`**, an explicit additional line: "Existing RSVPs on
      these events are kept." (Phase 1's named requirement — this is copy only; nothing in the write
      path touches `event_rsvps`, so the statement is simply true and must be said, not just be true.)
    - Confirm label: "Save and Apply". Not `destructive` — this isn't a delete.
  - Confirming submits the PATCH with `applyToSiblings: { fields: changedFields }` added to the
    existing payload.

### UI after save (response handling / toast copy)

Built from the response's `siblings` field, never from the pre-save `siblingSummary` count:

| `siblings` value | Toast |
|---|---|
| `null` (no fan-out requested) | `"Event updated successfully"` — unchanged from today. |
| `{ matched: 0, updated: [], skipped: [] }` | `` `Saved. No other upcoming "${event.title}" events still matched.` `` |
| `{ matched: N, updated: <N rows>, skipped: [] }` | `` `Saved. Also updated ${N} other "${event.title}" event${N===1?'':'s'}.` `` |
| `{ matched: N, updated: <M rows>, skipped: <N-M rows> }` (partial) | `` `Saved. Updated ${M} of ${N} other "${event.title}" events — ${N-M} no longer matched and were skipped.` `` |

Any fetch/500 failure keeps today's human-readable catch: `"Couldn't save the other events. Try
again."` is folded into the existing generic `catch` block's message rather than a raw error string,
per Phase 1's named failure-microcopy requirement — no stack trace, no raw JSON ever reaches the toast.

## Implementation Order (with the api-developer → ux-developer handoff seam)

1. **api-developer** — `src/lib/events.ts`: add `EVENT_SIBLING_FAN_OUT_FIELDS`,
   `EventSiblingFanOutField`, `EventFanOutFieldValues`, `isUpcomingWallClock()`,
   `diffFanOutFields()`. Write the Vitest tests named below directly in the existing
   `src/lib/events.test.ts`.
2. **api-developer** — widen `src/components/ui/confirm-dialog.tsx`'s `description` prop to
   `React.ReactNode` (one-line type change; confirm every existing call site still compiles, since
   they all pass plain strings today).
3. **api-developer** — new `src/lib/event-siblings-queries.ts`: `getSiblingCandidatesByTitle()`. New
   test file `src/lib/event-siblings-queries.test.ts`, following the mock-`db` chain convention
   already established in `src/lib/event-announcements-queries.test.ts`.
4. **api-developer** — extend `PATCH` in `src/app/api/admin/events/[id]/route.ts` exactly per the API
   Contract and Data Flow sections above. New test file
   `src/app/api/admin/events/[id]/route.test.ts` (no route test exists here today — follow the
   mock-`auth()` + mock-`db` chain convention documented in
   `src/app/api/events/[id]/viewer-context/route.test.ts`, adapted for `db.update`/`db.transaction`
   rather than `db.select`).
5. **Handoff seam:** api-developer confirms `pnpm exec tsc --noEmit` and `pnpm build:only` pass and
   hands ux-developer: (a) this doc's Request/Response contract as a fixed target, (b)
   `getSiblingCandidatesByTitle()` and `isUpcomingWallClock()` ready to call from the Server Component
   page, and (c) `diffFanOutFields()` ready to call from the client form. ux-developer builds nothing
   the API doesn't already support.
6. **ux-developer** — `src/app/(dashboard)/admin/events/[id]/page.tsx`: add the sibling-summary query
   and `siblingSummary` prop.
7. **ux-developer** — `src/components/admin/event-form.tsx` (+ optional new
   `src/components/admin/apply-to-siblings-control.tsx`): the checkbox, the confirm dialog, the
   submit-branching logic, and the response-driven toast copy, per "UI before/after save" above.
8. **ux-developer** — manual click-through at 360px (Phase 1's named mobile risk: the checkbox label
   and the denser confirm-dialog body must wrap cleanly), then hand to **qa**.

## Edge Cases & Risks

- **The edited event is itself in the past.** Eligibility is checked ONLY on siblings, never on the
  row being edited — an admin fixing a typo on a past "Board Meeting" instance may still fan that
  correction out to future "Board Meeting" rows. This is intentional: nothing in Phase 1/2 conditions
  fan-out on the edited row's own date, and restricting it would block a legitimate correction
  workflow (fix the template once you notice the mistake, wherever you noticed it).
- **Title changed in the same save.** Siblings are matched on `existing.title` — the row's title **as
  loaded**, before this edit — both for the save-time recompute (Data Flow step 2) and for what the
  confirm dialog displays (`siblingSummary` is a page-load prop, frozen the moment the page rendered).
  A same-save title edit is invisible to sibling selection in both directions: it can't expand the
  sibling set to match a brand-new title, and it can't be smuggled into the sibling write either
  (`title` is not in `EVENT_SIBLING_FAN_OUT_FIELDS`). This is Phase 2's explicit ruling, restated here
  because it's the one place a naive implementation would most plausibly drift (recomputing against
  `body.title` "for freshness" would be the bug).
- **`extraQuestionOptions` is a `jsonb` array (`text[]`-shaped, `NOT NULL DEFAULT '[]'`).**
  `diffFanOutFields()` must compare it by value (length + per-index equality), never by reference —
  a fresh array literal with identical contents must NOT register as "changed." The value written to
  siblings is the SAME filtered array already computed for the main row
  (`Array.isArray(extraQuestionOptions) ? extraQuestionOptions.filter(s => typeof s === "string" &&
  s.length > 0) : []`) — never a second, independently-filtered copy.
- **Exact-title collision.** Two unrelated events that happen to share the identical title string
  (e.g. two different years both literally titled "Pancake Day") are indistinguishable from true
  siblings by this feature — there is no separate "series identity" (that's Shape 3, explicitly out
  of scope per Phase 1). This is an accepted risk, not a defect: the ConfirmDialog's real-dates list
  (never a bare count) is the intended mitigation, letting the admin visually catch an unexpected
  date before confirming. No code-level de-duplication is being added for this.
- **Concurrent edit race (Phase 1 Flow 4, restated for this design).** Two admins editing different
  siblings of the same title moments apart still resolve last-write-wins at the row level — the
  fan-out doesn't introduce a new failure mode, it just means one save can touch more rows than a
  single-row save could. The `matched`/`updated`/`skipped` response gives the admin who fanned out
  something concrete to notice if a result looks off; it cannot protect the other, unaware admin, and
  Phase 1/2 both accept that as out of scope for v1 (no optimistic locking requested).
- **`maxAttendees || null` on a legitimate value of `0`.** Pre-existing behavior on the main row
  (a `0` max-attendees value already gets coerced to `null` by this falsy check today) — carried
  through unchanged to the sibling write via the shared normalized value. Not a regression introduced
  by this feature and not a fix target here.

## Out of Scope

- Time-of-day / duration fan-out (naive wall-clock decompose/recompose risk, DECISION-005) —
  confirmed deferred by Phase 2. **Flagging explicitly for Phase 6: this should become a
  `docs/backlog.md` entry once the feature ships; tech-lead is not adding it during Phase 3 per the
  task's own instruction, but it must not be silently dropped.**
- `title`, `startDate`, `endDate`, `image`, `isFeatured`, every `isRecurring`/`recurrence*` field —
  never fanned out, enforced by the hardcoded server allowlist regardless of client input.
- General multi-select bulk edit across arbitrary (non-same-title) events — Phase 1 Shape 2, deferred.
- True recurring series with per-occurrence field overrides — Phase 1 Shape 3, deferred (schema gap:
  `eventOccurrenceOverrides` has no field-override columns today).
- A persisted events audit log — Phase 2 confirmed the per-row response detail (`updated`/`skipped`
  with id/title/date) is sufficient for v1; `updated_at` remains the only durable trace.

## What I did

- Read `CLAUDE.md` in full and the complete Phase 1 and Phase 2 entries above; did not re-litigate
  either verdict.
- Read `src/app/api/admin/events/[id]/route.ts` in full (both PATCH and DELETE) to confirm the exact
  current normalization logic for every field, in particular the `extraQuestion`-gated
  `extraQuestionType`/`extraQuestionRequired` interdependency and the `extraQuestionOptions` array
  filter, which the fan-out write path must reuse rather than re-derive.
- Read `src/lib/events.ts`'s exports in full, confirmed it remains free of any `db` import, and
  confirmed `parseWallClock()`/`nowEastern()`/`isAfter`/`isBefore` are already imported from
  `date-fns` there, so `isUpcomingWallClock()` needs no new dependency.
- Read `src/components/admin/event-form.tsx` in full — the `EventFormData` type, the `formData` state
  seeded from the `event` baseline prop, `handleSubmit`'s existing fetch/toast/error handling, and the
  existing inline delete `<ConfirmDialog>` (confirmed the pattern this feature's control should
  follow) — to confirm the baseline-diff and submit-branching design is buildable against the file as
  it exists today, with no restructuring beyond what's described above.
- Read `src/components/ui/confirm-dialog.tsx` in full and confirmed the `description` prop is
  rendered as a single `{description}` interpolation inside `AlertDialog.Description`, so widening
  its type to `React.ReactNode` requires no change to the render logic itself.
- Read `src/app/(dashboard)/admin/events/[id]/page.tsx` in full to confirm where the new sibling-
  summary query and prop insert cleanly alongside the existing `Promise.all` data load.
- Read `src/app/api/events/[id]/viewer-context/route.test.ts` in full as the named convention
  reference for a new route test file (mock `@/lib/auth`, mock `@/lib/db` with a queued-response
  chain, no real database).
- Confirmed `extraQuestionOptions`'s schema type (`jsonb("extra_question_options").$type<string[]>().notNull().default([])`)
  in `src/lib/db/schema.ts`.
- Surveyed the existing `*-queries.ts` modules (`event-announcements-queries.ts`,
  `event-images-queries.ts`, `dues-reminders-queries.ts`, etc.) to confirm the convention that
  permission gating stays out of query modules and lives at the route/page layer — followed for
  `event-siblings-queries.ts`.

## Outputs

- `docs/work-log/2026-09-29-bulk-edit-same-title-events.md` — this Phase 3 section appended; status
  table row updated to Complete.
- No `docs/decisions.md` entry added — Phase 2 already ruled none is warranted, and nothing in this
  design introduces a new structural pattern beyond what Phase 2 already characterized.
- No application code touched, per this phase's scope.

## Open questions / handoff notes

- **Implementer: api-developer, then ux-developer** (specialist split, per Phase 2's recommendation
  and the size estimate there — comfortably past the ~150-line full-stack threshold once the
  transaction, allowlist-intersection, and response-shape work is counted). api-developer owns
  Implementation Order steps 1–5 (through the handoff); ux-developer owns steps 6–8.
- **Unit tests api-developer must deliver** (Phase 4 gate — implementer delivers these, not qa):
  1. `isUpcomingWallClock()` — true for a `startDate` after `now`, false for one strictly before
     `now`, and the boundary case (`startDate === now`) resolves to "upcoming" (`>=`, matching the
     precedent script's semantics, not strict `>`).
  2. `diffFanOutFields()` — returns `[]` when nothing in `EVENT_SIBLING_FAN_OUT_FIELDS` differs
     between baseline and current, even when non-allowlisted fields (title, startDate, isFeatured,
     recurrence*) differ; returns exactly the changed allowlisted keys (no more, no fewer) when one
     or more of the ten differ; treats `extraQuestionOptions` by value, not reference, including a
     case where both are functionally-equal-but-distinct arrays (must NOT report changed) and a case
     where contents actually differ (must report changed); does not false-positive on
     `null`-vs-`undefined` equivalents for the nullable string/number fields.
  3. `getSiblingCandidatesByTitle()` (`src/lib/event-siblings-queries.test.ts`, mock-`db` chain
     convention) — confirms the query filters by exact title match and excludes the given id.
  4. PATCH without `applyToSiblings` — only the target row updates; response is
     `{ event, siblings: null }`; no sibling query is issued at all.
  5. PATCH with a valid, fully-allowlisted `applyToSiblings.fields` and N eligible upcoming same-title
     siblings — all N update inside one transaction; response reports `matched: N`, `updated` naming
     each row, `skipped: []`.
  6. PATCH with `applyToSiblings.fields` mixing one off-allowlist name (e.g. `"startDate"`) with one
     valid name (e.g. `"location"`) — the off-allowlist field is silently dropped and never written to
     any sibling row; the valid field is still applied. This is the smuggling-defense test named
     explicitly by both Phase 1 and Phase 2.
  7. PATCH with `applyToSiblings.fields: []` — `400`, and **nothing is written, including the main
     row** (the whole request fails fast, before the transaction opens).
  8. PATCH with `applyToSiblings.fields` containing only unrecognized names (empty after allowlist
     intersection) — `400`, nothing written.
  9. PATCH where zero eligible upcoming same-title siblings exist at save time — `200`; main row still
     saves; `siblings: { matched: 0, updated: [], skipped: [] }`.
  10. PATCH simulating a sibling that matched eligibility in the SELECT but is absent from the
      batched UPDATE's `RETURNING` (concurrent delete) — that row appears in `skipped`, the request
      still returns `200`, and no other sibling's update is affected.
  11. A session lacking `FEATURES.EVENTS_EDIT` still gets `403` before any DB access, with or without
      `applyToSiblings` in the body — a regression guard now that the handler has a second branch.
- **For Phase 6 (analyst), not added here per this task's instruction:** log a backlog note that
  time-of-day/duration fan-out was deferred (naive wall-clock decompose/recompose risk, DECISION-005)
  and should become a `docs/backlog.md` entry (next available `B-nn`) once this feature ships.
- **For Phase 5 (qa):** the mobile-360px check Phase 1 named — the checkbox label and the
  confirm-dialog's date list are denser than the existing delete-confirm dialog and need an explicit
  look at that width, not just a default desktop click-through.

---

## Phase 4 — Implementation (API) — 2026-09-29

**Owner:** api-developer
**Status:** complete

### Summary

Built the server half of the sibling fan-out feature exactly per the Phase 3 design: the pure
allowlist/upcoming-predicate/diff helpers in `src/lib/events.ts`, a new `src/lib/event-siblings-queries.ts`
following the existing `*-queries.ts` convention, the widened `ConfirmDialog.description` prop, and the
extended `PATCH /api/admin/events/[id]` with `applyToSiblings`. No deviations from the design doc's
contract, data flow, or field allowlist. UI files (`event-form.tsx`, the admin page,
`confirm-dialog.tsx`'s render logic) were left untouched beyond the one-line type widening the design
explicitly called for.

### What I did

- Read `CLAUDE.md` and the full Phase 1–3 history in this work-log before writing any code.
- Read `src/lib/events.ts`, `src/app/api/admin/events/[id]/route.ts`, `src/lib/event-announcements-queries.ts`,
  `src/components/ui/confirm-dialog.tsx`, and the ledger transaction route + its test file to confirm the
  exact normalization logic to reuse and the `db.transaction()` mocking convention to follow.
- Added `EVENT_SIBLING_FAN_OUT_FIELDS`, `EventSiblingFanOutField`, `isUpcomingWallClock()`,
  `EventFanOutFieldValues`, and `diffFanOutFields()` to `src/lib/events.ts` — no `db` import added; module
  stays pure.
- Widened `src/components/ui/confirm-dialog.tsx`'s `description` prop from `string` to `ReactNode`
  (one-line type change; render logic (`{description}`) untouched).
- Created `src/lib/event-siblings-queries.ts` with `getSiblingCandidatesByTitle()` — one SQL query
  (`WHERE title = :title AND id <> :excludeId`), callable with either `db` or a `tx`.
- Extended `PATCH /api/admin/events/[id]` in `src/app/api/admin/events/[id]/route.ts`: validates
  `applyToSiblings` before any write, computes the ten fan-out field values once and shares them between
  the main-row `.set()` and the sibling `.set()`, wraps both updates in one `db.transaction()`, selects
  siblings by `existing.title` (never `body.title`), filters eligibility with `isUpcomingWallClock()`,
  issues one batched `UPDATE ... WHERE id = ANY(...)`, and diffs the `RETURNING` set against the eligible
  candidates to build `skipped`.
- Wrote and ran every unit test named in Phase 3's "Unit tests api-developer must deliver" list (see
  Outputs below) — all delivered by this phase, none deferred to qa.
- Ran `pnpm exec tsc --noEmit` (clean), `pnpm test` (full suite, all green), and `pnpm exec eslint` on every
  touched file (clean). Did not run `pnpm build:only` per this task's explicit instruction — qa owns that.
- Confirmed `event-form.tsx`'s `handleSubmit` never reads the PATCH response body on success (only
  `response.ok`), matching the design doc's stated justification for changing the response shape — did not
  touch that file.

### Outputs

**Files changed:**
- `src/lib/events.ts` — added `EVENT_SIBLING_FAN_OUT_FIELDS`, `EventSiblingFanOutField`,
  `isUpcomingWallClock()`, `EventFanOutFieldValues`, `diffFanOutFields()` (pure; no `db` import).
- `src/lib/events.test.ts` — added `isUpcomingWallClock` (4 tests) and `diffFanOutFields` (8 tests) suites.
- `src/lib/event-siblings-queries.ts` — new file, `getSiblingCandidatesByTitle()`.
- `src/lib/event-siblings-queries.test.ts` — new file, 3 tests.
- `src/components/ui/confirm-dialog.tsx` — `description: string` → `description: ReactNode`.
- `src/app/api/admin/events/[id]/route.ts` — `PATCH` extended per the contract below. `DELETE` untouched.
- `src/app/api/admin/events/[id]/route.test.ts` — new file, 12 tests (8 route-behavior cases per the
  design's numbered list, split into 12 `it()` blocks where a design item warranted more than one
  assertion — e.g. the 403 case is tested both with and without `applyToSiblings` in the body).

**API contract as implemented (matches the Phase 3 design doc exactly):**

`PATCH /api/admin/events/[id]`
- Auth: `auth()` + `session.user.features.includes(FEATURES.EVENTS_EDIT)`, checked first, unchanged.
- Request body: all existing fields, plus optional `applyToSiblings?: { fields: string[] }`.
- Response body: `{ event: Event; siblings: { matched: number; updated: {id,title,startDate}[]; skipped: {id,title,startDate}[] } | null }`.
- `applyToSiblings` omitted → `siblings: null`, no sibling query, byte-for-byte identical to the prior
  PATCH behavior otherwise.
- `applyToSiblings.fields` empty/non-array → `400 { error: "applyToSiblings.fields must be a non-empty array of field names." }`, nothing written (main row included).
- `applyToSiblings.fields` entirely off-allowlist → `400 { error: "No recognized fields to apply to other events." }`, nothing written.
- `applyToSiblings.fields` mixing allowlisted + off-allowlist → off-allowlist names silently dropped; allowlisted subset still applied; `200`.
- Siblings always selected by `existing.title` (pre-edit, server-loaded), never `body.title` or any
  client-supplied id list; "upcoming" is `isUpcomingWallClock()` (app-code `date-fns` comparison against
  `nowEastern()`), never a raw SQL `now()` predicate.
- One `db.transaction()` covers the main-row update and the batched sibling `UPDATE ... WHERE id = ANY(...)`.
- A sibling matched at SELECT time but absent from the batched UPDATE's `RETURNING` (e.g. concurrently
  deleted) lands in `skipped`, not `updated`; the request still returns `200`.

**No schema change, no migration.** No new `FEATURES.*` key.

**Test counts:** before this phase, `pnpm test` reported 133 test files / 2293 tests, all passing. After:
135 files / 2319 tests, all passing (+2 new files, +26 new tests: 4 `isUpcomingWallClock`, 8
`diffFanOutFields`, 3 `getSiblingCandidatesByTitle`, 12 route). `pnpm exec tsc --noEmit` clean.
`pnpm exec eslint` clean on every touched file. No `console.log` in any touched file. No native dialogs
introduced (the `confirm-dialog.tsx` change is a type-only widening).

### Open questions / handoff notes

- **Next: ux-developer** (Phase 4, client half — Implementation Order steps 6–8 in the Phase 3 design):
  add the `siblingSummary` query + prop to `src/app/(dashboard)/admin/events/[id]/page.tsx`, then build the
  checkbox + confirm-dialog + submit-branching + response-driven toast in `src/components/admin/event-form.tsx`
  (optionally split into `src/components/admin/apply-to-siblings-control.tsx` — implementation judgment, not
  mandatory). `diffFanOutFields()`, `isUpcomingWallClock()`, and `getSiblingCandidatesByTitle()` are all
  ready to import; the API contract above is a fixed target — nothing on the server side should need to
  change to support the client build.
- **`event-form.tsx`'s `EventFormData` type** should structurally satisfy `EventFanOutFieldValues` already
  (same field names/types) — worth a quick confirmation at the start of the client phase, but no mapping
  step is expected to be needed per the design.
- **No deviations from the Phase 3 design.** The contract, data flow, allowlist, and validation table were
  all buildable exactly as specified; nothing required improvisation or a loop-back.
- **Backlog note for Phase 6 (analyst):** the design doc flags that "time-of-day/duration fan-out" should
  become a `docs/backlog.md` entry once this feature ships — not added yet, per the design's own
  instruction to defer that to Phase 6, but noting it here again so it isn't lost in the handoff.

## Phase 4 — Implementation (UI) — 2026-09-29

**Owner:** ux-developer
**Status:** complete

### Summary

Built the client half exactly on top of api-developer's finished contract: the `/admin/events/[id]`
Server Component now computes and freezes a `siblingSummary` at page load; `EventForm` shows an
"Also apply to N other upcoming '<title>' events" checkbox only when that summary is non-empty,
intercepts submit with a `<ConfirmDialog>` (never `window.confirm()`) listing the actual sibling
dates and the changed fields when the box is checked and something fan-out-eligible actually
changed, and reads the real `siblings.matched/updated/skipped` counts from the PATCH response to
build the toast. The no-checkbox path sends byte-for-byte the same request body as before. Found
and fixed one real bug along the way: the shared `ConfirmDialog` renders its description inside a
Radix `<p>`, which cannot legally contain the `<div>`/`<ul>` structure this dialog's date list
needs — confirmed via a hydration console error during manual click-through, fixed at the shared
primitive (see Deviations below).

### What I did

- Read `CLAUDE.md` (UX Guidelines, no-native-dialogs rule) and the full Phase 1–4(API) history in
  this work-log before writing any code.
- Read `src/lib/events.ts` (`EVENT_SIBLING_FAN_OUT_FIELDS`, `isUpcomingWallClock()`,
  `diffFanOutFields()`, `formatWallClockDate()`, `parseWallClock()`), `src/lib/event-siblings-queries.ts`
  (`getSiblingCandidatesByTitle()`), `src/app/api/admin/events/[id]/route.ts` (the shipped
  `applyToSiblings` contract and response shape), `src/components/ui/confirm-dialog.tsx`, and
  `src/app/(dashboard)/admin/events/[id]/page.tsx` / `src/components/admin/event-form.tsx` in full
  before making any change, per the design doc's implementer handoff.
- `src/app/(dashboard)/admin/events/[id]/page.tsx`: added a `getSiblingCandidatesByTitle(db,
  event.title, id)` call right after the `!event` guard, filtered with `isUpcomingWallClock()`
  (never a raw SQL `now()` predicate), sorted ascending by `startDate`, and passed the result as a
  new `siblingSummary` prop to `<EventForm>`.
- `src/components/admin/event-form.tsx`: added the `siblingSummary` prop, `applyToSiblings` and
  `applyConfirmOpen` state, and a `save(fanOutFields)` helper that only adds `applyToSiblings` to
  the request body when `fanOutFields` is a non-empty array (so the unchecked path's payload is
  identical to today's). `handleSubmit` intercepts and opens the confirm dialog only when the box is
  checked AND `diffFanOutFields(event ?? {}, formData)` is non-empty; otherwise it saves immediately
  exactly as before (this covers the "checkbox checked but nothing fan-out-eligible changed" edge
  case with no dialog and no `applyToSiblings` in the request, per the design). Toast copy branches
  on the actual `siblings` response (`null` / `matched: 0` / full match / partial match), matching
  the design's table exactly. Failure while `fanOutFields` was requested shows "Couldn't save the
  other events. Try again." (design's named failure microcopy); the ordinary path keeps today's
  `error.message` fallback.
- Created `src/components/admin/apply-to-siblings-control.tsx` (the design's recommended, non-
  mandatory split) — the checkbox and the `<ConfirmDialog>` body: a changed-fields list with human
  field labels and formatted values, the sibling dates via `formatWallClockDate(parseWallClock(...),
  isAllDay)` (the existing shared formatter — no new date logic), the "Existing RSVPs on these
  events are kept" line when `requiresRsvp` is among the changed fields, and — for the "title
  changed in the same save" edge case — a note when the live title differs from the frozen
  `loadedTitle`, stating that siblings are matched by the original title and the rename in this save
  does not change which events are included.
- **Bug found and fixed during manual click-through**: Radix `AlertDialog.Description` renders a
  `<p>` by default; passing a `<div>`/`<ul>` structure into it (needed for the date list) produced a
  real React hydration error ("`<div>` cannot be a descendant of `<p>`") visible in the browser
  console. Fixed in `src/components/ui/confirm-dialog.tsx` by rendering the description with
  `<AlertDialog.Description asChild><div className="mt-2 text-sm text-gray-600">{description}</div></AlertDialog.Description>`
  instead of `<AlertDialog.Description className="...">{description}</AlertDialog.Description>`.
  Backward-compatible: every existing caller passes a plain string, which renders identically inside
  a `<div>` as it did inside a `<p>` (same classes, same text). Re-ran the full test suite and a
  fresh click-through after this fix — the console error is gone and no test regressed.
- Ran `pnpm exec tsc --noEmit` (clean), `pnpm test` (135 files / 2319 tests, unchanged from
  api-developer's count — no new client-side unit tests were named for this phase; see "Tests" below),
  and `pnpm exec eslint` on every touched/created file (clean). Grepped touched files for
  `console.log` — none.
- Started `pnpm dev` against `.env.local`'s local Neon DB and drove the real flow end-to-end with a
  disposable Playwright script (not committed) signed in as the project's `E2E_ADMIN_*` test user:
  opened the Oct 1, 2026 "General Meeting" at `/admin/events/[id]`, confirmed the checkbox read
  "Also apply to 7 other upcoming 'General Meeting' events" (matching a direct DB count), changed
  Location, checked the box, saved, confirmed the `<ConfirmDialog>` listed "Location: Fellowship
  Hall TEST" plus all 7 sibling dates formatted like "Thursday, November 5, 2026 at 7:00 PM", clicked
  "Save and Apply", and got the toast "Saved. Also updated 7 other 'General Meeting' events." A
  direct `psql` check confirmed all 8 rows (the edited row + 7 siblings) now shared the new location.
  Repeated the same flow to set the location back to "The Landings of Westerville — 1st Floor
  Training Room" on all 8 rows, and `psql` confirmed the table matches its original state — dev data
  ends where it started. Also checked the 360px viewport per Phase 1's named mobile risk: the
  checkbox label and the confirm dialog's changed-field list + date list both wrap cleanly with no
  horizontal overflow.

### Outputs

**Files changed:**
- `src/app/(dashboard)/admin/events/[id]/page.tsx` — added the sibling-summary query and
  `siblingSummary` prop.
- `src/components/admin/event-form.tsx` — `siblingSummary` prop, fan-out state, submit branching,
  response-driven toast copy.
- `src/components/admin/apply-to-siblings-control.tsx` — new file: checkbox + confirm dialog body.
- `src/components/ui/confirm-dialog.tsx` — description now renders via `asChild` into a `<div>`
  instead of a bare `<p>`, so block-level ReactNode content (lists, nested divs) is valid HTML. This
  is in addition to api-developer's earlier `string` → `ReactNode` type widening; both changes are to
  the same shared primitive and are complementary, not conflicting.

**No new test file.** The Phase 3 design's "Unit tests api-developer must deliver" list (11 items) is
entirely server-side (`isUpcomingWallClock`, `diffFanOutFields`, `getSiblingCandidatesByTitle`, and
the PATCH route) and was fully delivered in the Phase 4 (API) entry above. The design does not name
any client-side unit test for this phase — stating that here rather than inventing coverage, per
this task's instruction. The manual click-through above (including the 360px pass) is the intended
verification for the client half; qa should still consider whether a Playwright e2e spec for this
flow is warranted, since none exists yet for `/admin/events/[id]`'s edit flow at all (pre-existing
gap, not introduced by this feature).

**Test counts:** unchanged from Phase 4 (API) — 135 test files / 2319 tests, all passing.
`pnpm exec tsc --noEmit` clean. `pnpm exec eslint` clean on every touched/created file. No
`console.log` in any touched file. No native dialogs (`<ConfirmDialog>` only).

### Deviations from the Phase 3 design

- **One addition beyond the design's explicit scope**: the `confirm-dialog.tsx` `asChild`/`<div>`
  fix above. The Phase 3 design and Phase 4 (API) both anticipated the `string` → `ReactNode` type
  widening but neither actually exercised the dialog with block-level content, so the `<p>`-cannot-
  contain-`<div>` hydration error wasn't caught until this phase's manual click-through. Fixing it
  here (rather than shipping a console error) is the smallest correct fix and keeps the primitive's
  visual output and every other caller's behavior unchanged.
- No other deviation. The request/response contract, the field allowlist, the "upcoming" predicate,
  the frozen-original-title behavior, the zero-changed-fields silent-plain-save behavior, and the
  toast copy table were all buildable exactly as specified.

### Open questions / handoff notes

- **Next: qa (Phase 5).** Suggested click-through for qa to repeat/extend: open an upcoming
  "General Meeting" or "Board Meeting" at `/admin/events/[id]`, confirm the checkbox count matches a
  direct DB count of exact-title upcoming siblings, verify the unchecked-box save path still sends
  no `applyToSiblings` (e.g. via a network tab check) and behaves identically to pre-feature PATCH,
  and specifically exercise the partial-skip toast ("Updated M of N... — the rest no longer matched
  and were skipped") by deleting or retitling a sibling between page load and save.
- **New copy strings introduced** (all reviewed against Phase 1/2/3's exact required wording, no
  wording was invented beyond formatting/pluralization): the checkbox label, the confirm dialog
  title/body ("Changing:", "Also applies to N other upcoming '<title>' events:", the RSVP-survives
  note, the title-changed note), the "Save and Apply" confirm button label, and the four toast
  variants. Worth a quick Lions Club read-through before shipping, though none of it is deviation
  from the design's specified copy — only the title-changed note's exact phrasing was left to this
  phase's judgment (Phase 3 said "surface that in the dialog copy," didn't specify exact wording).
- **UX decisions/tradeoffs**: (1) `apply-to-siblings-control.tsx` owns both the checkbox and the
  confirm dialog rather than splitting those further, since they share the sibling-count/title copy
  and the dialog's `onConfirm` has no other reasonable home. (2) The checkbox and dialog always
  reference the *original, as-loaded* title (`event.title`) rather than the live `formData.title`,
  even when the title hasn't changed — this keeps the copy stable while typing and only surfaces the
  distinction explicitly when the two actually diverge. (3) `fieldValues` is cast to
  `Record<string, unknown>` at the `ApplyToSiblingsControl` call site (a structural-typing limitation
  of TS `Record<string, unknown>` vs. a concrete interface without an index signature) — purely a
  type-level cast, no runtime behavior implication.
- **Backlog note carried forward again** (per Phase 3's own instruction not to lose it in handoff):
  time-of-day/duration fan-out was deferred (naive wall-clock decompose/recompose risk,
  DECISION-005) and should become a `docs/backlog.md` entry once this feature ships — still pending
  Phase 6 (analyst) to actually file it.

---

## Phase 5 — Verification (qa) — 2026-09-29

**Owner:** qa
**Status:** complete

### Summary

**PASS.** Read CLAUDE.md and the full Phase 1–4 history in this work-log before verifying. Every
automated check is clean (`tsc`, `lint`, 135/135 test files, `build:only` — the build's first run on
this change), all 11 unit tests named in the Phase 3 design exist and pass (mapped 1:1 below), the 4
Playwright specs that already touch `/admin/events/[id]` still pass unmodified, and a live
dev-server + `psql` click-through against `.env.local`'s local Neon DB confirmed every named flow
(a)–(g), the mobile-375px render, and the `confirm-dialog.tsx` visual-regression check. A disposable,
uncommitted Playwright script drove the real browser and captured the real network payloads (not
just the work-log's self-report); direct `curl` calls with a real session cookie confirmed the
smuggling defense, the two 400 validation cases, and the 403/no-write case against a freshly created,
then deleted, no-`events.edit` test account. Dev data (the 8 "General Meeting" rows touched) verified
back at its exact starting values by the end of the run. One documentation-only discrepancy found in
the Phase 4 (API) entry (claims "8 `diffFanOutFields` tests," actually 7) — the total test count and
every test's content are correct; this is a miscount in the write-up, not a missing test.

### What I did

**1. Automated checks**
- `pnpm exec tsc --noEmit` → **PASS**, 0 errors.
- `pnpm lint` → **PASS**, 0 errors, 1 pre-existing warning in an unrelated file
  (`src/components/admin/ledger/budget-context-panel.tsx:114`, an unused eslint-disable directive) —
  not touched by this feature, not introduced by it.
- `pnpm test` (full suite) → **PASS**, **135 test files / 2319 tests, all passing**, 3.99s. Matches
  the count api-developer/ux-developer both reported.
- `pnpm build:only` → **PASS** (first run on this change). Clean Turbopack compile (809ms), clean
  TypeScript pass (4.3s), 125 static pages generated, full route manifest printed with no errors or
  warnings. `/admin/events/[id]` listed as `ƒ` (dynamic) as expected.

**2. Unit-test mapping — Phase 3's 11-item list against what api-developer actually delivered**

| # | Design item | Delivered as | Result |
|---|---|---|---|
| 1 | `isUpcomingWallClock()` true/false/boundary | `src/lib/events.test.ts:1555-1585`, 4 `it()` blocks (after, before, boundary-inclusive `>=`, default-`now`) | present, passing |
| 2 | `diffFanOutFields()` — empty on non-allowlist diffs, exact changed keys, `extraQuestionOptions` by value not reference (equal-but-distinct AND differing), null/undefined equivalence | `src/lib/events.test.ts:1601-1655`, **7** `it()` blocks | present, passing |
| 3 | `getSiblingCandidatesByTitle()` — exact title, excludes id | `src/lib/event-siblings-queries.test.ts`, 3 `it()` blocks (incl. tx-shaped callable, bonus) | present, passing |
| 4 | PATCH without `applyToSiblings` — only target row, `siblings: null` | `route.test.ts:169` | present, passing |
| 5 | PATCH valid + N eligible — all N update in one tx | `route.test.ts:244` | present, passing |
| 6 | PATCH mixed allowlisted/off-allowlist — off-allowlist silently dropped | `route.test.ts:215` | present, passing |
| 7 | PATCH `fields: []` → 400, nothing written | `route.test.ts:186` | present, passing |
| 8 | PATCH all-unrecognized → 400 | `route.test.ts:198` | present, passing |
| 9 | PATCH zero eligible siblings → 200, `matched: 0` | `route.test.ts:269` | present, passing |
| 10 | PATCH concurrent-delete sibling → `skipped` | `route.test.ts:303` | present, passing |
| 11 | No `events.edit` → 403 before DB access, with/without `applyToSiblings` | `route.test.ts:146` + `:155` (2 tests) | present, passing |

All 11 design items are covered, with 3 extra route tests beyond the list (past-dated-candidate
filtering, title-freeze-on-rename, 404) — more coverage than required, not less.

**Discrepancy found (documentation only, not a test gap):** the Phase 4 (API) entry's Outputs section
claims "+26 new tests: 4 `isUpcomingWallClock`, 8 `diffFanOutFields`, 3 `getSiblingCandidatesByTitle`,
12 route." Counted directly in the file: `diffFanOutFields` has **7** `it()` blocks, not 8
(`awk`-counted and hand-verified by reading `events.test.ts:1587-1655`). 4+7+3+12 = 26, which matches
the actual test-count delta (2293→2319). The "26 total" is correct; the "8" sub-count is a
transcription error in the work-log write-up. No test is missing — this is a documentation nit, not a
coverage gap, and does not affect the verdict.

**3. Dev-server + `psql` click-through** (against `.env.local`'s local Neon DB; signed in as the
`E2E_ADMIN_*` credentials user via the real `/signin` form, both through a disposable Playwright
script and via direct `curl` with the resulting session cookie — never committed, deleted at the end
of this phase)

Target event used: `12aa2a3f-ac9a-45e1-b986-6b9e4838fbf5`, "General Meeting," 2026-10-01. Confirmed
via `psql` up front that this title has exactly 7 other rows with `start_date` in the future relative
to `now()` (Sept 3, 2026 excluded as past; Nov 5 – May 6, 2027 included) — 27 total `events` rows
across General/Board/Activities Meeting titles inspected to build this baseline.

- **(a) No siblings → no control at all.** `Activities Meeting — Christmas Party`
  (`db247df1-8074-4ce7-9596-ddbf38ee21e7`) is the only row with that exact title among upcoming
  events (confirmed via a `GROUP BY title HAVING COUNT(*)=1` query — this is exactly the Phase 1 Flow
  3 exception row). Fetched `/admin/events/db247df1-...` with `curl` as the admin session: the
  server-rendered payload's `siblingSummary` is `[]` and the string `applyToSiblings` appears **zero**
  times anywhere in the page HTML — the control is genuinely absent from the DOM, not hidden. This
  also independently re-confirms Flow 3: a plain "Activities Meeting" edit can never sweep in the
  Christmas Party (exact string match, confirmed by the same query showing them as distinct rows).
- **(b) Correct N.** Fetched `/admin/events/12aa2a3f-...` as the admin: the embedded `siblingSummary`
  lists exactly the 7 ids/dates independently computed via `psql` above (Nov 5, Dec 3, Jan 7, Feb 4,
  Mar 4, Apr 1, May 6 — all 2026/2027), and the rendered checkbox text read "Also apply to 7 other
  upcoming "General Meeting" events" — byte-for-byte match between the SQL-derived set and the
  server-rendered prop.
- **(c) Change location + tick box → dialog lists field + every sibling date → confirm → toast count
  matches → `psql` shows siblings changed, past/other-title untouched.** Via the disposable Playwright
  script: filled Location to `Fellowship Hall QA-TEST`, checked `#applyToSiblings`, clicked "Update
  Event." The `<ConfirmDialog>` rendered:
  ```
  Apply changes to other events?
  Changing:
  Location: Fellowship Hall QA-TEST
  Also applies to 7 other upcoming "General Meeting" events:
  Thursday, November 5, 2026 at 7:00 PM
  Thursday, December 3, 2026 at 7:00 PM
  Thursday, January 7, 2027 at 7:00 PM
  Thursday, February 4, 2027 at 7:00 PM
  Thursday, March 4, 2027 at 7:00 PM
  Thursday, April 1, 2027 at 7:00 PM
  Thursday, May 6, 2027 at 7:00 PM
  ```
  — real dates, not a count, exactly as Phase 1/2/3 require. Captured the actual network PATCH body on
  confirm: `"applyToSiblings":{"fields":["location"]}` — the client only ever sends the changed
  allowlisted field name(s), matching the contract exactly. Toast read "Saved. Also updated 7 other
  "General Meeting" events." `psql` after: all 7 siblings' `location` updated to the test value; the
  Sept 3 (past) "General Meeting" row's `updated_at` was untouched (still its original 2026-08-09
  timestamp); zero Board Meeting / Activities Meeting rows had a recent `updated_at`.
- **(d) Revert the same way → dev data ends where it started.** Repeated (c) with the original
  location string; toast again read "Saved. Also updated 7 other..."; final `psql` check: all 8 rows
  (target + 7 siblings) show `title = "General Meeting"`, `location` = the original address string,
  `start_date` unchanged — byte-for-byte the pre-QA baseline.
- **(e) Tick the box but change ONLY a non-fan-out field.** Checked the box, changed only the minute
  select next to the `startDate` date input (a `<select>`, not `startDate` itself as text — the field
  is composed of a date input plus hour/minute/AM-PM selects) from `:00` to `:15`, clicked Save.
  **No `<ConfirmDialog>` appeared**, and the captured PATCH body had no `applyToSiblings` key at all —
  matches the design's specified behavior exactly ("nothing to fan out; showing a confirm dialog for
  zero fields would be a false alarm"). Reverted the minute back to `:00` immediately after,
  confirmed via `psql` the row's `start_date` time component is back to `19:00:00`.
- **(f) Change the title AND tick the box → siblings matched on the ORIGINAL title.** Changed the
  title field to `General Meeting RENAMED-QA-TEST` and Location to the test value, checked the box,
  clicked Save. The dialog appeared (because `location`, an allowlisted field, changed — `title`
  itself is correctly ignored by `diffFanOutFields`), still listing all 7 correct sibling dates, and
  added the exact note Phase 3/ux-developer specified: *"These are matched by the original title
  "General Meeting" — renaming this event to "General Meeting RENAMED-QA-TEST" in this save does not
  change which events are included."* Clicked **Cancel** rather than confirming, so no title change
  was ever committed to real data — `psql` confirms the row's title is still exactly "General
  Meeting."
- **(g) No fan-out at all → request body unchanged from before this feature.** Loaded the page,
  clicked Save with the checkbox never touched. Captured PATCH body has **no `applyToSiblings` key at
  all** (`parsed.applyToSiblings === undefined`) — confirms the additive-only claim in the Phase 3 API
  contract precisely; a plain save's wire payload is identical in shape to what the route accepted
  before this feature shipped.
- **Mobile 375px.** Reloaded the target event at a 375×812 viewport: the checkbox label and the full
  confirm-dialog (field list + all 7 dates) rendered with `document.documentElement.scrollWidth ===
  375` — no horizontal overflow anywhere on the page at this width.

**4. Adversarial checks via `curl` with a real session cookie** (obtained through the actual
`/api/auth/callback/credentials` flow, not a forged cookie)

- **Smuggling defense, live.** PATCH'd the target event directly with
  `"applyToSiblings":{"fields":["location","startDate","title"]}` and off-allowlist `title`/`startDate`
  values in the top-level body. Response: `200`, `siblings.matched: 7`, all 7 listed as `updated`.
  `psql` on a sibling row immediately after: **`title` and `startDate` unchanged** on the sibling —
  only `location` (set to the same value, a no-op) was in the allowlisted intersection. The target row
  itself *did* get the smuggled title/startDate (expected — full-body replace applies to the row being
  directly edited, same as today; the defense is specifically that it never reaches a *sibling*).
  Immediately restored the target row to its exact baseline title/startDate/location with a follow-up
  PATCH (no `applyToSiblings`) and confirmed via `psql`.
- **`fields: []` → 400, nothing written, not even the main row.** Sent a full body with a
  `title`/`location` change and `applyToSiblings.fields: []`. Response: `400 {"error":
  "applyToSiblings.fields must be a non-empty array of field names."}`. `psql` immediately after:
  title/location on the target row **unchanged** — confirms the "fail fast before entering the
  transaction" requirement for the main row too, not just the siblings.
- **All-unrecognized fields → 400, nothing written.** Sent `applyToSiblings.fields:
  ["startDate","title","image","isFeatured"]` (all off-allowlist) with a body also trying to change
  title/location. Response: `400 {"error": "No recognized fields to apply to other events."}`. `psql`:
  unchanged.
- **No `events.edit` → 403, no writes, with and without `applyToSiblings`.** Created a temporary,
  club-domain-only test account (`qa-scratch-member-noedit@westervillelions.org`, `member` role only —
  confirmed via `psql` that `member` grants exactly `{members.view, events.view}`, no `events.edit`),
  signed in through the real credentials form, and confirmed the session's `features` array excludes
  `events.edit`. PATCH'd the target event **without** `applyToSiblings`: `403 {"error":"Forbidden"}`.
  PATCH'd again **with** a well-formed `applyToSiblings.fields:["location"]` and a `location` change:
  also `403 {"error":"Forbidden"}`. `psql`: target row's title/location unchanged after both attempts.
  Deleted the temporary test account and its `user_roles` row immediately after (confirmed 0 rows
  remain for that email) — no residue left in the dev DB.

**5. `confirm-dialog.tsx` visual-regression check (item 6).** Opened the existing "Delete event?"
confirm on the same event page (a plain-string `description` caller, unrelated to this feature) via
the same disposable Playwright script. Rendered HTML: `<div class="mt-2 text-sm text-gray-600"
id="...">This will permanently delete the event and all associated RSVPs. This action cannot be
undone.</div>` — the plain string renders correctly inside the new `<div>` wrapper (via `asChild`)
with identical classes to what it had inside the old bare `<p>`; Cancel/"Delete Event" buttons present
and styled correctly (red destructive style). No visual or functional regression on this existing
caller. Did not click Delete (destructive; cancelled out instead).

**6. Playwright e2e regression.** Identified the e2e specs that actually exercise `/admin/events/[id]`
or its API surface (grepped for the `admin/events` path across `e2e/*.spec.ts` rather than a bare
"event" keyword match, which pulled in an unrelated hit — `admin-security.spec.ts` only *mentions*
`cancel-occurrence.spec.ts` in a comment, it doesn't touch `/admin/events` itself, and was correctly
excluded): `e2e/admin-events-announce-page-gate.spec.ts`, `e2e/cancel-occurrence.spec.ts`,
`e2e/write-in-signups.spec.ts`, `e2e/recurring-signup-rollup.spec.ts`. Ran just these four,
`--workers=1` (matching the project's mandatory-serial convention): **21 passed, 1 skipped, 1.6m.** No
regression from either `event-form.tsx`'s or `confirm-dialog.tsx`'s changes.

**7. Cleanup.** Deleted the disposable Playwright spec file and its screenshots (never committed —
`git status` after cleanup shows only the six implementer-touched/created files, nothing added by
this QA pass), removed `test-results/`, killed the local `pnpm dev` process, and dropped the temporary
QA test user from the dev DB. Final `psql` sweep: all 8 touched "General Meeting" rows (target + 7
siblings) match their exact pre-QA values; zero Board Meeting / Activities Meeting / Christmas Party
rows show any `updated_at` change from this session.

### Outputs

- `docs/work-log/2026-09-29-bulk-edit-same-title-events.md` — this Phase 5 section appended; status
  table row updated to Complete / PASS.
- No application code touched. No test files added (the design named no additional qa-owned tests;
  all 11 were delivered in Phase 4 per the mapping above).
- No `docs/decisions.md` entry — nothing in this phase changes prior architectural rulings.
- Dev database (`.env.local`'s local Neon instance) — temporarily mutated during verification
  (location/title/startDate on the target row and its 7 "General Meeting" siblings; one temporary
  `member`-role user), fully reverted/deleted by the end of this phase and independently confirmed via
  `psql`.

### Type Check
`pnpm exec tsc --noEmit`: **PASS** (0 errors)

### Unit Tests
`pnpm test`: **PASS**
Total: 2319 | Passed: 2319 | Failed: 0
Files: 135 | Duration: 3.99s

### Production Build
`pnpm build:only`: **PASS** (first run on this change)
Notes: 125 static pages, full route manifest with no errors/warnings; `/admin/events/[id]` correctly
listed as dynamic (`ƒ`).

### End-to-End Tests
`pnpm test:e2e` (scoped to the 4 specs touching `/admin/events`, `--workers=1`, per this task's
instruction not to run the full ~12-minute suite without reason): **PASS**
Total: 22 | Passed: 21 | Skipped: 1 | Failed: 0
Duration: 1.6m
Specs: `e2e/admin-events-announce-page-gate.spec.ts`, `e2e/cancel-occurrence.spec.ts`,
`e2e/write-in-signups.spec.ts`, `e2e/recurring-signup-rollup.spec.ts`

### Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| (a) No siblings → no control in DOM | pass | `siblingSummary: []`, zero `applyToSiblings` occurrences in page HTML |
| (b) Correct N shown | pass | 7, byte-for-byte match against independent `psql` count |
| (c) Change + tick + confirm + save | pass | Dialog lists field + 7 real dates; toast matches; `psql` confirms siblings changed, others untouched |
| (d) Revert | pass | `psql` confirms exact baseline restored |
| (e) Tick box, non-fan-out-only change | pass | No dialog, no `applyToSiblings` in payload — matches design |
| (f) Title change + tick box | pass | Dialog correctly matched on original title; cancelled, no data committed |
| (g) No fan-out at all | pass | PATCH body has no `applyToSiblings` key — additive-only confirmed on the wire |
| Mobile 375px | pass | No horizontal overflow on form or dialog |
| Smuggling defense (curl) | pass | Off-allowlist fields never reach a sibling row |
| Empty `fields: []` (curl) | pass | 400, nothing written including main row |
| All-unrecognized fields (curl) | pass | 400, nothing written |
| No `events.edit` (curl, real low-priv session) | pass | 403 both with and without `applyToSiblings`, no writes |
| `confirm-dialog.tsx` visual regression (Delete dialog) | pass | Plain-string caller renders identically inside new `<div>` wrapper |

### Regression Tests Added
None added by qa — all 11 unit tests named in the Phase 3 design were delivered by api-developer in
Phase 4 (verified present and passing above). No new defect was found during this verification that
would warrant a new regression test.

### Coverage on Critical Modules
- `src/lib/events.ts`: fan-out additions (`isUpcomingWallClock`, `diffFanOutFields`) fully covered by
  11 new test cases across the two functions; pre-existing coverage on the rest of the module
  unaffected.
- `src/lib/event-siblings-queries.ts`: 100% of its one exported function covered (3 tests: exact-match
  filter, empty result, tx-shaped callable).
- `src/app/api/admin/events/[id]/route.ts`: every branch named in the Phase 3 validation table
  (omitted / empty / all-off-allowlist / mixed / zero-eligible / concurrent-delete / 403 / 404) has a
  corresponding test, plus live curl confirmation of the four adversarial branches in this phase.

### Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `PATCH /api/admin/events/[id]` (extended with `applyToSiblings`) | yes | yes | `FEATURES.EVENTS_EDIT` — read `src/app/api/admin/events/[id]/route.ts:31-34`: `session.user.features.includes(FEATURES.EVENTS_EDIT)`, checked first, before the body is parsed, before either the target-row update or the sibling fan-out. Confirmed live via curl with a real no-`events.edit` session: 403, no writes, with and without `applyToSiblings` in the body. |
| `src/app/(dashboard)/admin/events/[id]/page.tsx` (new sibling-summary query for display) | yes | yes | `FEATURES.EVENTS_EDIT` — the new `getSiblingCandidatesByTitle()` call sits after the page's existing `auth()` + `hasFeature(session.user.id, FEATURES.EVENTS_EDIT)` guard (unchanged gate, confirmed by reading the file); the query itself carries no permission check (correct — matches every other `*-queries.ts` convention, gating is the caller's job). |

This feature adds no new route and no new permission key — it extends one existing, already-gated
route and one existing, already-gated page. Both gates read directly from source, not inferred from
passing tests, per this section's mandate. No gap found.

### Verdict: PASS

### Verified Fact vs. Root-Cause Theory

**Established (reproduced, more than one method each):**
- The smuggling defense, both 400 validation cases, and the 403/no-write case are each confirmed both
  by the passing unit test AND by an independent live `curl` call against the running dev server with
  a real session — two different methods agreeing, not just the implementer's self-report.
- The exact-title isolation (no cross-title leakage) is confirmed by both the design's unit tests and
  by direct `psql` inspection before/after every mutating action in this phase — zero Board
  Meeting/Activities Meeting rows ever showed a changed `updated_at` across the entire QA session.
- The `diffFanOutFields` test-count discrepancy (7 actual vs. "8" claimed) is a direct count from the
  file (`awk`/grep-verified) cross-checked against the total-delta arithmetic (4+7+3+12=26, matching
  2293→2319) — this is a confirmed fact about the work-log's own text, not a theory.

**Not claimed as established:** no root-cause investigation was needed this phase — no defect was
found in the shipped code. The one write-up discrepancy above is presented as exactly what it is (a
miscount in Phase 4's Outputs section), not generalized into a claim about api-developer's test-writing
process elsewhere; nothing in this session's evidence supports that broader claim, so it isn't made.

### Open questions / handoff notes

- **Next: analyst (Phase 6), shipped-vs-intent.** PASS — every named unit test, both required
  automated gates (`tsc`, `build:only`, first run), the scoped e2e regression, and every manual
  click-through in the QA brief (a)–(g) plus mobile and the two adversarial/visual-regression checks
  are green, confirmed by more than self-report where it mattered (live curl, live `psql`, a real
  disposable browser session — not just reading the implementers' claims).
- **Carry the backlog note forward once more:** time-of-day/duration fan-out was deferred at Phase
  1/2/3 (naive wall-clock decompose/recompose risk, DECISION-005) and every phase since has said "this
  should become a `docs/backlog.md` entry once this feature ships" without actually filing it. Phase 6
  is the last named place for that filing — please don't let it drop a fourth time.
- **Minor housekeeping note for whoever next touches this work-log:** the Phase 4 (API) Outputs
  section's test-count line says "8 `diffFanOutFields`" where the file has 7 (see mapping table
  above). Not worth a loop-back — the verdict is unaffected — but worth a one-line fix if this doc is
  edited again.
- **Not touched by this feature, so out of scope for this verdict, but noted for awareness:** the two
  scratch scripts sitting untracked in the repo root's git status (`scripts/add-tracks-2026-09-events.ts`,
  `scripts/disable-rsvp-on-meetings.ts`) predate this work-log's Phase 4 and are the Phase 1 context
  script plus an apparently unrelated script; neither was reviewed as part of this Phase 5 pass since
  neither is part of this feature's diff (confirmed via `git diff --stat`, which shows only the 6 files
  every implementer phase already named).

---

# Phase 6 — Shipped vs Intent (analyst) — 2026-09-29

**Owner:** analyst
**Status:** complete

## Summary

Walked the shipped code (`src/lib/events.ts`, `src/lib/event-siblings-queries.ts`,
`src/app/api/admin/events/[id]/route.ts`, `src/app/(dashboard)/admin/events/[id]/page.tsx`,
`src/components/admin/event-form.tsx`, `src/components/admin/apply-to-siblings-control.tsx`,
`src/components/ui/confirm-dialog.tsx`) against my own Phase 1 verbs, flows, permissions, and gaps —
not against the intervening phases' self-reports. Every user verb works exactly as described, every
flow's success and failure paths are present and match the specified copy, the permission gate is the
same `FEATURES.EVENTS_EDIT` check enforced independently at both the page and the route, and every gap
Phase 1 named has a corresponding, findable line of code (not just a phase's claim that it was
handled). One housekeeping item — the deferred time-of-day/duration fan-out — had been correctly
carried forward as a note through four phases without ever being filed; it is filed now as **B-78**.

## VERDICT

**SHIP IT**

## ONE-LINE TAKE

An admin editing one "General Meeting"/"Board Meeting"/"Activities Meeting" row now sees, only when
real upcoming same-title siblings exist, an opt-in checkbox that fans a fixed, narrow set of flat
fields out to all of them in one transaction, with a confirm dialog that lists the actual dates (not a
bare count) and a toast that reports what was actually written — this directly closes the defect that
motivated the feature (an admin's single-row RSVP-setting change not propagating across the meeting
schedule) and does so without ever touching the fields (title, dates, recurrence) that made the
original one-off fix script risky to generalize.

## What's Working

- **The exact defect that started this ticket is now self-service.** Phase 1's context section
  describes the admin unchecking "Requires RSVP" on one meeting row and having it silently apply to
  only that row. `requiresRsvp` is field #4 in `EVENT_SIBLING_FAN_OUT_FIELDS`
  (`src/lib/events.ts:436`), the confirm dialog adds the explicit "Existing RSVPs on these events are
  kept" line whenever it's among the changed fields
  (`src/components/admin/apply-to-siblings-control.tsx:100-102`), and qa's live click-through (c)
  exercised this exact field end-to-end with a real toast and a real `psql` confirmation. The admin who
  hit today's problem would see this control the next time they open a sibling row.
- **The checkbox copy answers "is this one of N, and can I change all of them" without extra
  clicks.** `ApplyToSiblingsControl` renders "Also apply to {n} other upcoming "{title}" event{s}"
  directly under the fields the admin just edited (`apply-to-siblings-control.tsx:69-71`) — the count
  is live, sourced from a real query, and the exact title is quoted, so an admin scanning the form sees
  both "there are N others" and "here's the literal string they're matched on" in one line. This is
  exactly the discoverability Phase 1's gap analysis was implicitly asking for, even though Phase 1
  didn't use those words.
- **The confirm dialog is the single best piece of UX in this feature.** It lists real formatted dates
  (`formatWallClockDate(parseWallClock(s.startDate), s.isAllDay)`), not a bare count — per Phase 1
  Open Question 3 and Phase 2's ruling — which is the concrete mitigation against the accepted "exact
  title collision" risk (Flow 3 / Edge Cases): an admin who sees an unexpected date in that list before
  confirming can catch a title collision the system itself cannot detect. Verified live by qa with 7
  real dates rendered correctly.
- **The server-side allowlist intersection is real, not just documented.** Read
  `src/app/api/admin/events/[id]/route.ts:71-89`: `allowedFields` is computed by filtering the
  request's `fields` against `EVENT_SIBLING_FAN_OUT_FIELDS`, and the 400 paths fire before the
  transaction opens. QA's live `curl` smuggling test (sending `title`/`startDate` inside
  `applyToSiblings.fields`) confirms this isn't just a code-reading exercise — the sibling rows
  genuinely never received the off-allowlist values.
- **Title-freeze is correct in both directions, confirmed by reading, not just trusting the design
  doc.** `existing.title` (the server's own pre-edit re-fetch, `route.ts:37`) is the only title ever
  passed to `getSiblingCandidatesByTitle()` (`route.ts:178`), never `body.title`. The page-load summary
  is likewise built from `event.title` as loaded (`page.tsx:95`). qa's flow (f) — renaming the title and
  ticking the box in the same save, then cancelling — is exactly the adversarial case Phase 1/3 worried
  about, and it resolved correctly live.

## Intent-vs-Shipped Diff

| Phase 1 said | Shipped | Verdict |
|---|---|---|
| A secondary control appears only when N>0 exact-title future siblings exist; N=0 → no visible control at all | `ApplyToSiblingsControl` returns `null` when `siblingSummary.length === 0` (`apply-to-siblings-control.tsx:54`); `event-form.tsx:719` also gates rendering on `hasSiblings`. qa confirmed live: zero `applyToSiblings` occurrences in the page HTML for the Christmas Party row. | matches |
| Admin confirms via `<ConfirmDialog>` naming the affected dates/count and the exact fields/values | Dialog body lists `changedFields` with human labels + formatted values, then every sibling date (`apply-to-siblings-control.tsx:80-99`) | matches |
| Toast names how many sibling rows were updated, and names any that failed | Four-way toast branch in `event-form.tsx:211-225` reads the real `siblings.matched/updated/skipped` from the response, not the stale page-load count | matches |
| Server re-checks `events.edit`, reloads the source event, recomputes the sibling set itself, applies only its own fixed allowlist | `route.ts:31-34` (check first, before body parse), `:37` (reload), `:178-179` (recompute), `:71-89` + `:186-189` (allowlist intersection, never the raw client fields) | matches |
| A sibling deleted/renamed between load and save → toast says "Updated M of N... — skipped" | `route.ts:197-202` diffs `RETURNING` against `eligible` to build `skipped`; `event-form.tsx:221-224` renders the exact partial-match toast copy | matches |
| Ordinary single-row save (no fan-out) must add zero friction and stay byte-for-byte identical | `save()` only adds `applyToSiblings` to the payload `if (fanOutFields && fanOutFields.length > 0)` (`event-form.tsx:196-198`); qa's flow (g) confirmed the wire payload has no `applyToSiblings` key at all when the box is untouched | matches |
| Exact-title match protects "Activities Meeting — Christmas Party" from a plain "Activities Meeting" edit | `getSiblingCandidatesByTitle` uses `eq(events.title, title)` (`event-siblings-queries.ts:53`) — exact string equality, no fuzzy/prefix match; qa confirmed live via `psql` that the two titles are distinct rows | matches |
| Time-of-day/duration explicitly deferred, not silently dropped | Deferred correctly in code (excluded from the allowlist with a comment citing DECISION-005, `events.ts:420-425`) but **not filed to `docs/backlog.md` until this Phase 6** despite every phase since Phase 3 flagging it | acceptable drift — closed in this phase as B-78 |
| No new `FEATURES.*` key; existing `events.edit` covers this | No permission migration, no new key anywhere in the diff; both gates read `FEATURES.EVENTS_EDIT` | matches |
| `<ConfirmDialog>` used, never `window.confirm()` | Confirmed — `apply-to-siblings-control.tsx` imports and uses `ConfirmDialog`; grepped the full diff for `window.confirm`/`alert`/`prompt` — none | matches |
| Mobile: checkbox label and denser confirm-dialog body must wrap cleanly at 360px | qa tested at **375px**, not the 360px Phase 1 named — `scrollWidth === 375`, no overflow, but this is a wider viewport than what was specified | acceptable drift (see Edge Cases) |

## Edge Cases

| Case | Result |
|---|---|
| Empty state (N=0, no siblings) | **pass** — control absent from the DOM entirely, confirmed via curl on the page HTML, not just a client-side `display:none` |
| Failure microcopy | **pass** — `"Couldn't save the other events. Try again."` (`event-form.tsx:233`) for the fan-out path; the 400 bodies (`"applyToSiblings.fields must be a non-empty array..."`, `"No recognized fields to apply to other events."`) are plain English, not raw stack traces, and confirmed live via curl |
| Permission gate | **pass** — verified live (not just read) with a real no-`events.edit` session: 403 with and without `applyToSiblings`, no writes on either attempt |
| Mobile (360px named) | **pass, with a caveat** — qa's click-through used 375px, not the 360px Phase 1 explicitly named. The changed surface is plain text-flow (a checkbox label, a `<ul>` of dates) with no fixed-width elements, so the risk of a real regression specifically between 360–375px is low, but the stated requirement wasn't tested at the width it named. Not blocking; noting for whoever next touches this page to re-check at 360px if it's opened again. |
| Brand consistency (`rounded-2xl` cards, `rounded-lg` buttons, `ConfirmDialog`) | **pass** — the new checkbox wrapper (`rounded-lg bg-gray-50 p-4`) matches every *other* section container already in this same file (`event-form.tsx`'s "Event Information"/"Date & Time"/"Settings" sections are all `rounded-lg border border-gray-200 bg-white p-6`, pre-existing, not introduced by this feature) rather than the general card guideline's `rounded-2xl`. This is consistent with the file's established (if not CLAUDE.md-canonical) local convention and is not a regression this feature introduced — not flagging as a new defect. `ConfirmDialog` itself is unchanged at `rounded-2xl` (`confirm-dialog.tsx:29`). |
| Concurrent-edit race (Phase 1 Flow 4) | **pass, as scoped** — Phase 1/2/3 all explicitly accepted last-write-wins with no optimistic locking; the response's `matched/updated/skipped` gives the fanning-out admin something concrete to notice, which is exactly what was promised, not more |
| Adversarial: field smuggling | **pass** — live curl with `title`/`startDate` in `applyToSiblings.fields` confirmed neither ever reached a sibling row |
| Adversarial: enumeration / self-targeting | **not applicable** — no new enumerable resource, no new self-service permission surface; the feature is a data-shape boundary inside an already-permitted write, as designed |

## Follow-ups

None required for SHIP IT beyond the housekeeping already completed in this phase:

- **B-78 filed** in `docs/backlog.md` ("Later" tier) — time-of-day/duration fan-out, deferred per
  DECISION-005's naive-wall-clock risk, to be picked up only once an admin actually needs to retime a
  whole schedule at once.
- **Not filed as a tracked follow-up, noted only for awareness:** the 360px-vs-375px mobile-viewport
  gap above. Given the low risk (plain text flow, no fixed-width elements) and that this feature adds
  no new fixed-width UI, I'm not opening a backlog item for it — but if `event-form.tsx` or
  `apply-to-siblings-control.tsx` is opened again for unrelated work, a quick 360px recheck is free.
- The Phase 4 (API) Outputs section's "8 `diffFanOutFields` tests" (actual: 7) documentation nit that
  qa already flagged does not need a tracked follow-up — it's a miscount in a prior phase's own
  write-up in this same file, already corrected by qa's mapping table, and does not affect any shipped
  behavior.

## Open questions / handoff notes

- Pipeline closed. No loop-back. Next time this page is touched for an unrelated feature, a 360px
  mobile recheck of this control (see Edge Cases) is cheap to fold in.
- B-78 is filed under "Later," not "Now"/"Soon" — there is no near-term admin need to retime the whole
  meeting schedule at once today; move it up if one appears.
