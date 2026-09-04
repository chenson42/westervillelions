# Event Announcement / Meeting Reminder Emails — Work Log

> **Slug:** `2026-09-04-event-announcement-emails`
> **Surface:** (dashboard) admin, sending to signed-in members' email addresses
> **Permission(s):** TBD — see Open Questions (candidate: existing `EVENTS_EDIT`, or new `EVENTS_ANNOUNCE`)
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-09-04 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-09-04 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-09-04 |
| 4 — Implementation | database-admin (4a) → api-developer (4b) → ux-developer (4c) | Complete | — | 2026-09-04 |
| 5 — Verification | qa | Complete | PASS | 2026-09-04 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-09-04 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> An admin picks one event occurrence and sends every active member a club-domain email with the meeting details and a link to add it to their calendar, with a durable per-member send record — the Dues Reminders shape, retargeted at events instead of dues.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin | Open an event's admin detail page and click "Send Announcement" | On demand, per event/occurrence |
| Admin | Review the recipient cohort (all active members, who has/lacks email) before sending | Each send |
| Admin | Optionally add a short custom message on top of the fixed event-details template | Each send |
| Admin | Confirm and send | Each send |
| Admin | View send history / "last announced" state for an event afterward | On demand |
| Signed-in member | Receive the email in their inbox, from the club's own domain | Passive — no action required to receive |
| Signed-in member | Click "Add to calendar" / open the .ics link inside the email | Optional, per email |

No new anonymous-visitor or access-pending-surface verbs — this is an admin-composes, member-receives feature. Members do not log in to see this; the email itself is the surface.

## Flows

**Flow 1 — Admin sends an announcement:**
Entry: `/admin/events/[id]` (existing event detail/edit admin page) → admin clicks "Send Announcement" → step: picks which occurrence (for a recurring series) the announcement is about → step: reviews cohort (count of active members, count with/without email) → step: optionally types a custom note → step: clicks Send, is asked to confirm via `<ConfirmDialog>` (not `window.confirm`) → outcome: success toast, page shows "Announcement sent to N of M members on [date] by [admin name]," and a send-history row is added.
- Failure: if `sendBulkMemberEmail()` reports partial failures (e.g., 2 of 41 sends failed), the confirmation still succeeds but the summary distinguishes "Emailed 39, 2 failed" — never a blanket success or a raw error. If the admin has no `hasFeature()` grant for the gating key, they don't see the button at all (not a 403 after the fact).

**Flow 2 — Member receives and acts on the email:**
Entry: club-domain email lands in inbox (subject line names the event) → step: member reads meeting details (title, date/time, location, custom note if any) → step: member clicks an "Add to Calendar" link → outcome: browser downloads/opens the .ics file via the existing `/api/events/[id]/ics` route, or (if attachment is chosen in Phase 3) the .ics arrives as a MIME attachment already in the message.
- Failure: if the member's inbox still filters the club-domain mail (SPF/DKIM/DMARC not fully configured on the sending domain, or the member marks it spam once), there's no in-app remediation path — this is inherently outside what the app can guarantee. Flagged as a gap below since it's the entire premise of the request.

**Flow 3 — Admin reviews send history:**
Entry: `/admin/events/[id]` → step: admin scrolls to (or opens) a send-history panel → outcome: sees each past send — timestamp, sender, occurrence, recipient count, success/failure count. Mirrors the `dues_reminders` "last reminded" badge pattern (`ix_dues_reminders_member_fy`-style index, one row per member per send attempt).
- Failure: n/a (this is a read).

## Permissions

- **Permission(s):** Not yet decided — flagged as an open question. Candidates:
  - Reuse `FEATURES.EVENTS_EDIT` (whoever can edit an event can announce it) — simplest, matches "the person running the event sends the reminder."
  - New `FEATURES.EVENTS_ANNOUNCE` (or similarly named) if the club wants event-editors and event-announcers to be different people (e.g., a communications-committee member who shouldn't be able to edit event details but should be able to send reminders).
- Dues Reminders precedent: gates on `DUES_MANAGE`, a *narrower* key than the general dues view key (`DUES_VIEW`), specifically because bulk email to real people is more sensitive than reading data. The analogous move here is **not** to gate on `EVENTS_VIEW` (too broad — anyone who can see the calendar could spam the club) and likely not even the general `EVENTS_EDIT` without discussion, since editing an event's details is a materially different trust level than blasting all 41 members' inboxes.
- **Default roles:** Whatever role(s) get the chosen key — recommend Admin + whichever role currently holds `EVENTS_EDIT`, but this is the user's call.

## Gaps the Request Didn't Address

- **Attachment vs. link for the .ics file.** `sendEmail()` (`src/lib/email.ts`) currently only sends `{ to, from, subject, html }` — no attachment parameter exists. The user's words say "calendar attachment," but the only calendar mechanism that exists today is a *download link* to `/api/events/[id]/ics`. Adding true MIME attachment support to `sendEmail()`/Resend is itself a small scope addition. Recommend v1 ships with a link (zero new plumbing) and flags true attachment as a fast-follow if the club still sees low open/add-to-calendar rates. **Needs the user's call** since it directly addresses the stated problem (ISP filters trusting content already in the message over a click-through).
- **Recipient set / opt-out.** There is no member-level email-preference table today. The request says "every active member" — confirm that's really every `membershipStatus = 'active'` member with no per-member suppression, or whether v1 needs a bare-minimum unsubscribe/opt-out concept. Flagging as likely deferred, but must be an explicit decision, not a silent omission — a club running unsolicited bulk mail without any opt-out is the kind of thing that itself trips spam filters over time.
- **Per-occurrence vs. per-series targeting.** The event system has recurring series with per-occurrence overrides (`event_occurrence_overrides`) and one-off events. The flow above assumes the admin picks a specific occurrence date to announce (matches "season-kickoff meeting," a single date). A recurring weekly meeting announced generically ("we meet Tuesdays") is a different, lower-frequency use case — confirm v1 only needs per-occurrence, not series-wide blast.
- **Sender identity / "signed by."** Dues Reminders signs as the resolved Treasurer via `resolveTreasurer()` — a real office-holder's name for accountability and trust. Event announcements have no analogous single office-holder (not every event has a "coordinator" field in the schema as read). Options: sign as "Westerville Lions Club," sign as the admin who clicked Send, or add an event-coordinator concept. **Needs the user's call.**
- **Empty state.** What does the Send Announcement panel show for an event with zero active members with email on file, or before any event exists to announce? Should degrade gracefully like Dues Reminders (members with no email are shown, not silently dropped, with a distinct "N members have no email on file" line).
- **Mobile.** No stated constraint violated, but the send-confirmation UI and cohort table need to work at 360px — flag for tech-lead/ux-developer.
- **Brand consistency.** Confirm dialog for the send action, `rounded-2xl` cards for the cohort/history panels, `rounded-lg` buttons — no deviation implied by the request, just confirming precedent applies.

## Out of Scope (confirm with user)

- Scheduled/automatic sends (e.g., auto-remind 3 days before every event) — recommend v1 is manual-trigger only, no cron, matching Dues Reminders' "friendly, non-automatic nudge" precedent.
- Member-level email preferences / unsubscribe UI — flagged above as a gap; recommend confirming explicitly whether it's deferred rather than assuming.
- True Resend MIME attachments (vs. .ics link) — recommend deferred to a fast-follow unless the user wants it in v1.
- Tracking opens/click-throughs on the announcement itself (separate from the existing "0 bounced, 14 never opened" Zeffy analytics that prompted this request) — CLAUDE.md's B-47 invariant means the UI can never claim delivery/open visibility for Resend sends either; don't let this request quietly imply we're adding read-receipts.

## Open Questions

1. **Who can send?** Reuse `EVENTS_EDIT`, or a new, narrower `FEATURES.EVENTS_ANNOUNCE` key (recommended, given the Dues Reminders precedent of gating bulk-send on a stricter key than view/edit)?
2. **Calendar delivery: link to `/api/events/[id]/ics`, or true email attachment (requires extending `sendEmail()`)?** This is the crux of "fixes the actual filtering problem" vs. "ships fast."
3. **Sender identity** — signed as "Westerville Lions Club," as the sending admin by name, or as a to-be-added event-coordinator role?
4. **Recipient scope** — literally every active member every time, or is there a need (even in v1) for a lightweight opt-out?
5. **Per-occurrence only, or does the club also want a series-wide "reminder for our regular meeting" send?**

---

# Phase 2 — Architectural Review (architect)

## Verdict

Approved with suggestions

## Placement

- **Directory placement:** `/admin/events/[id]/announce` as a nested page under the existing `/admin/events` area — approved. The feature operates ON an event (occurrence or series), the way `[id]` edit already does; it does not warrant a new top-level admin area the way Social Requests did (that was its own domain object, not an operation on an existing one). New route: `src/app/(dashboard)/admin/events/[id]/announce/page.tsx` (+ a co-located `actions.ts` or a route handler under `src/app/api/admin/events/[id]/announce/route.ts` — tech-lead's call between server action and route handler, both fit the existing pattern). Send-history panel can live inline on `[id]/page.tsx` or as its own tab; either is fine.
- **Proxy/permission placement — ruled, not left open.** `nestedAdminPages()` in `src/lib/admin-page-feature-gates.test.ts` will pick up `announce/page.tsx` (it's 3 directories below `ADMIN_DIR`, depth > 1) and require *some* `hasFeature()`/`hasAnyFeature()` call plus a `redirect()`. **The test only asserts a gate call exists — it does not assert which `FEATURES.*` key is used.** It would pass just as happily if the page were mistakenly gated on `EVENTS_EDIT` instead of the new `EVENTS_ANNOUNCE`. Tech-lead and QA must treat "uses the correct key" as a manual review item, not something the test suite catches — call this out explicitly in the Phase 3 doc's edge-case list.
  - Checked whether binding `events.announce` to `admin` + `board_member` creates a DECISION-082-style proxy trap (a role that passes the page's own `hasFeature()` but never reaches the page because the proxy's derived `/admin/events*` rule only recognizes `EVENTS_EDIT`, the only `requiredFeature` currently on the Events nav item). **It does not, today:** `drizzle/migrations/0002_roles_permissions_groups_campaigns.sql` (lines ~236–250) already grants `board_member` the full `events.view/create/edit/delete` set, so every holder of the new `events.announce` key (admin, board_member) already holds `events.edit` and clears the proxy independently of this feature. Unlike Proposals/Social Requests, there is no "board_member doesn't already hold the sibling key" surprise here.
  - **Suggestion (not blocking):** widen the Events nav item's `requiredFeature` in `ADMIN_NAVIGATION` (`src/lib/permissions.ts`) from `FEATURES.EVENTS_EDIT` to `[FEATURES.EVENTS_EDIT, FEATURES.EVENTS_ANNOUNCE]` at implementation time. Costs nothing today (the sets of holders are identical), and forecloses the exact failure mode DECISION-082 exists to prevent if `events.announce` is ever granted to a future role that doesn't also hold `events.edit` (e.g., a communications-only role) — without this, that role would pass the page's own gate and still bounce at the proxy, which is a confusing, hard-to-diagnose failure. Cheap insurance; tech-lead can fold it into the permissions migration step.
- **Server vs Client split:** the announce page is a Server Component by default (loads event, cohort count via `auth()` + `hasFeature()`); the send-confirmation UI (occurrence picker, custom-note textarea, `<ConfirmDialog>`, submit state) is a small client island, same shape as Dues Reminders' send button. No full-page client component needed.
- **Dependencies:** none. Resend's existing SDK (`resend@6.16.0`, already in `package.json`) supports attachments natively — confirmed in `node_modules/.pnpm/resend@6.16.0/.../dist/index.d.mts`, the `Attachment` interface (`content?: string | Buffer`, `filename`, `contentType`) is already part of `CreateEmailOptions.attachments`. No new npm dependency.

## `sendEmail()` Attachment Extension — the sensitive piece

Read `src/lib/email.ts` in full, both call paths (`sendEmail`'s own 3-attempt loop and the separate deferred retry in `src/app/api/admin/email-queue/retry/route.ts`), and the `emailQueue` table in `src/lib/db/schema.ts`. Ruling:

1. **`sendEmail()` signature:** add `attachments?: { filename: string; content: string; contentType?: string }[]` to `SendEmailOptions`, passed through to `resend.emails.send({ ..., ...(attachments && { attachments }) })` exactly like the existing `cc`/`bcc`/`replyTo` optional-spread idiom. Fully backward-compatible — an optional field, no call-site churn across the ~18 existing `sendEmail()` callers. Content should be a `string` (the raw `.ics` text; Resend accepts a plain string, no need to base64-encode client-side — Resend's SDK/API handles encoding), not `Buffer`, since jsonb storage (next point) can't hold a `Buffer` and a single content shape end-to-end avoids a needless base64 round-trip.
2. **`sendBulkMemberEmail()`:** add an optional `attachments?` to `SendBulkMemberEmailOptions`, forwarded unchanged to every per-recipient `sendEmail()` call — the same `.ics` file (whether one occurrence or the full series) is identical for every recipient, so it belongs on the shared options, not per-recipient.
3. **`email_queue` must gain an `attachments` column.** This is the finding that makes this piece architecturally sensitive, and the reason it can't be a pure in-memory pass-through: `src/app/api/admin/email-queue/retry/route.ts` reads a *previously queued* row back out of the `email_queue` table and re-sends using only `{ from, to, subject, html }` — it does not go through `sendEmail()` at all, it calls `resend.emails.send()` directly against the persisted row. If `attachments` is only ever a function parameter and never persisted, a failed announcement send that later gets retried through the deferred admin-retry path silently arrives **without the calendar invite** — the entire premise of this feature (filter-resistant, natively-rendered invite) quietly regresses on exactly the sends that needed the retry path. Required schema change: add `attachments: jsonb("attachments").$type<{ filename: string; content: string; contentType?: string }[]>()` (nullable, no default — existing rows and every non-attachment caller stay `null`) to the `emailQueue` table in `src/lib/db/schema.ts`, with a matching idempotent migration (`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS attachments jsonb;`). `sendEmail()`'s initial insert must include `attachments: attachments ?? null`. **`src/app/api/admin/email-queue/retry/route.ts` must be updated in the same change** to read `item.attachments` and pass it through to its own `resend.emails.send()` call — this file already independently duplicates `resend.emails.send()`, so it needs the identical addition or it silently reintroduces the gap. (This route also already drops `cc`/`bcc`/`replyTo` on retry — a pre-existing gap, out of scope for this feature, but worth a one-line note in the work-log for whoever picks it up next; do not fix it as a drive-by inside this feature's diff.)
4. **This is additive, not a shape change** — `email_queue`'s existing ~18 non-attachment callers are unaffected; the column is optional and nullable throughout.

## ICS Generation Reuse

`src/lib/events.ts` already has everything needed: `buildVEvent`, `buildIcsCalendar`, `generateOccurrences`, `toIcsFilename`, `IcsEventInput`. The announce flow (both occurrence and series scope) must call these same helpers — visible today in `src/app/api/events/[id]/ics/route.ts`'s two branches (single-occurrence vs. full-series). **Do not duplicate ICS construction inside the announce action/route** — build the `IcsEventInput`, call `buildVEvent`/`buildIcsCalendar` the same way that route does, and pass the resulting string as the `content` of the `sendEmail`/`sendBulkMemberEmail` attachment. This is a direct instance of the "same decision implemented in more than two places" duplication rule in CLAUDE.md if reimplemented.

## Data Model

New table, not an extension of `dues_reminders` or `email_queue` — confirmed. Precedent is `dues_reminders`: one row per member per send attempt (not one row per send-event with an aggregate count), which is what lets the "last announced" per-event badge and a future "did member X get this" lookup both work off the same table. Recommend `event_announcements` (tech-lead to finalize exact columns) carrying at minimum: `id`, `eventId` (FK → `events`, cascade), `occurrenceDate` (nullable text/date — null for a series-wide send, matching the `dates-as-wall-clock-strings` convention already used for occurrences elsewhere in `events.ts`), `scope` (`'occurrence' | 'series'`), `memberId` (FK → `members`, cascade), `sentByUserId` (FK → `users`, set null), `emailQueueId` (FK → `emailQueue`, set null — same nullable-FK idiom `dues_reminders.emailQueueId` already uses), `success`, `error`, `note` (the admin's optional custom message, verbatim, same rationale as `dues_reminders.note` — don't depend on `email_queue.html` still existing), `sentAt` (`timestamp(..., { withTimezone: true })`, the current convention, not the older naive-timestamp drift). Index on `(eventId, occurrenceDate)` or `(eventId, scope)` for the "last announced" badge, mirroring `ix_dues_reminders_member_fy`.

## Permission Migration

Mirror `drizzle/migrations/0085_proposals_permissions.sql` / `0093_social_requests_permissions.sql` exactly: new file `drizzle/migrations/00NN_events_announce_permission.sql` (tech-lead assigns the number), inserting `events.announce` into `features` (category `events`, description byte-for-byte identical to `FEATURE_DESCRIPTIONS[FEATURES.EVENTS_ANNOUNCE]`) and binding it to `admin` and `board_member` explicitly and independently (each `INSERT ... WHERE NOT EXISTS` guarded, no assumption either role already holds it — though as noted above, both already hold `events.edit`, which is a *different* key and does not substitute for `events.announce`). Add `FEATURES.EVENTS_ANNOUNCE = "events.announce"` and its `FEATURE_DESCRIPTIONS` entry to `src/lib/permissions.ts`; the `add-permission` skill covers this mechanically.

## Invariants Touched

- **Permissions are the only gating mechanism** — respected: new `FEATURES.EVENTS_ANNOUNCE` key, role-bound via migration, no environment-flag shortcut introduced.
- **Admin-area protection is derived, never hand-maintained (DECISION-082)** — respected as analyzed above; no hand-written proxy rule added, and the nested-page test will force *a* gate to exist (though not verify it's the *right* key — flagged above for Phase 3/5 to own).
- **Schema is the source of truth** — respected: `email_queue.attachments` and the new `event_announcements` table both get `schema.ts` entries first, then idempotent migrations, per the standard order.
- **Migrations re-run on every deploy** — both the new column (`ADD COLUMN IF NOT EXISTS`) and the new table/permission migrations must follow the standard idempotent patterns; no new risk introduced.
- **Outbound Email Is Deny-By-Default Outside Production** — respected by construction: `event_announcements` sends must go through `sendBulkMemberEmail()` (never a hand-rolled loop), which already routes through `sendEmail()`'s non-production guard. No change needed to the guard itself; attachments ride along inside the same guarded call.
- **"Emailed," never "Delivered"** (B-47) — the send-history UI must use the same wording discipline as Dues Reminders and the Ledger acknowledgment-letter emailer. Flagging for tech-lead/ux-developer, not a Phase 2 blocker.

## Notes for Phase 3

- Confirm in the design doc which of {server action, route handler} the send action uses, and where the send-history panel renders (inline on `[id]/page.tsx` vs. its own route) — either is architecturally fine.
- The `EVENTS_ANNOUNCE` key name in the work-log's "User Decisions" section says "`events.announce` or similar" — use `events.announce` verbatim; it matches the `area.action` convention every other key in `FEATURES` follows and there's no reason to deviate.
- Carry forward the two flagged items verbatim into the Phase 3 doc's edge-case list: (1) the nested-page test doesn't verify *which* key gates the announce page — must be manually verified in code review/QA; (2) `email-queue/retry/route.ts` needs the `attachments` pass-through in the same diff that adds the column, or the retry path silently regresses the feature's whole reason for existing.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

An admin with the new `events.announce` permission opens `/admin/events/[id]/announce`, picks
whether the announcement covers one occurrence or the full recurring series, optionally adds a
short personal note, reviews the recipient cohort (every active member, split into has-email /
no-email), and sends. Every active member with an email on file gets a personalized HTML email
signed "Westerville Lions Club," with a true `.ics` calendar invite attached (not just a link),
built from the same `buildVEvent`/`buildIcsCalendar`/`generateOccurrences` helpers the existing
public ICS download route already uses. The send is durable and auditable: one
`event_announcements` row per attempted recipient, all sharing a `batchId` so the admin-facing
history panel can show "sent to 39 of 41 on Sep 10 by J. Smith" as a single line rather than 41
disconnected rows. This is the Dues Reminders shape (fixed template + optional note, fresh
server-side re-validation, `sendBulkMemberEmail()`, "Emailed never Delivered") retargeted at
events, plus the one genuinely new piece: `sendEmail()`/`email_queue` gain MIME attachment
support (DECISION-092), first exercised here.

## Permissions

- **Key:** `events.announce` (`FEATURES.EVENTS_ANNOUNCE`)
- **Default role bindings:** `admin`, `board_member` — each inserted and guarded independently
  (neither role's binding is assumed to ride along on its existing `events.edit` grant; `events.announce`
  is a distinct key per the User Decision).
- **Description string** (must be byte-for-byte identical between `FEATURE_DESCRIPTIONS` and the
  migration's `INSERT INTO features`): `"Send event announcement emails to active members"`.
- **Category:** `events` (existing `FEATURES_CATEGORIES.EVENTS`).
- **Nav widening (Phase 2's non-blocking suggestion — confirmed and included):** the "Events" nav
  item's `requiredFeature` in `ADMIN_NAVIGATION` (`src/lib/permissions.ts` line ~438) changes from
  `FEATURES.EVENTS_EDIT` to `[FEATURES.EVENTS_EDIT, FEATURES.EVENTS_ANNOUNCE]` — the exact array
  shape already used for the Minutes nav item (`[FEATURES.MINUTES_MANAGE, FEATURES.MINUTES_DELETE]`,
  line ~415), so `getAdminProtectionRules()` needs no new logic, just a wider input.
  **Verified before widening:** every page under `src/app/(dashboard)/admin/events/` —
  `page.tsx`, `[id]/page.tsx`, `new/page.tsx` — independently calls `hasFeature()` +
  `redirect()` today (confirmed by reading `[id]/page.tsx`; `new/page.tsx` and `page.tsx` follow
  the identical pattern per `admin-page-feature-gates.test.ts`'s existing passing suite, and the
  2026-09-03 auth-gate fix mentioned in the task brief is exactly what makes this true). So
  widening the nav item's admission set is safe: no page under `/admin/events*` relies solely on
  the proxy, which is the failure mode DECISION-082 exists to prevent.

## API Contract

Route handlers, not server actions — mirrors `src/app/api/admin/dues/reminders/route.ts` exactly
(GET preview + POST send, both independently gated), which is the closest existing precedent for
"cohort preview then bulk send with fresh server-side re-validation." Page.tsx calls the same
underlying query helpers directly for first paint; the client component calls the GET route only
for an explicit "Refresh" action, same split as Dues Reminders.

### `GET /api/admin/events/[id]/announce`

Auth: `auth()` + `hasFeature(session.user.id, FEATURES.EVENTS_ANNOUNCE)` → 401 / 403.

Response `200`:
```ts
{
  event: { id: string; title: string; isRecurring: boolean; isAllDay: boolean; location: string | null };
  occurrenceOptions: { date: string /* YYYY-MM-DD */; label: string }[]; // future, non-cancelled only
  hasFutureOccurrence: boolean;
  recipients: {
    withEmail: { memberId: string; firstName: string; lastName: string }[];    // no email addresses sent to the client
    withoutEmail: { memberId: string; firstName: string; lastName: string }[];
  };
  history: {
    batchId: string; scope: "occurrence" | "series"; occurrenceDate: string | null;
    sentAt: string; sentByName: string | null; recipientCount: number;
    successCount: number; failureCount: number; note: string | null;
  }[]; // newest first
}
```
`404` if the event doesn't exist.

### `POST /api/admin/events/[id]/announce`

Auth: identical gate, re-checked independently of GET.

Request:
```ts
{
  scope: "occurrence" | "series";
  occurrenceDate?: string;   // required iff scope === "occurrence"; ignored for "series"
  note?: string;             // optional, trimmed, max 2000 chars (EVENT_ANNOUNCEMENT_NOTE_MAX_LEN)
  memberIds: string[];       // the admin's reviewed with-email cohort (can be a subset — an admin may deliberately uncheck someone)
}
```

Server-side, in order (never trusts the client's cohort or occurrence validity — same discipline
as the Dues Reminders POST):
1. Load the event fresh; 404 if missing.
2. If `scope === "occurrence"`: regenerate occurrences via `generateOccurrences(event, parseWallClock(event.startDate), 520)`, reject if `occurrenceDate` doesn't match a live date or is in the cancelled-overrides set → `400` `{ error: "That occurrence has been cancelled or no longer exists — refresh and pick another." }`. If `event.isRecurring === false`, `scope` is forced to `"occurrence"` server-side regardless of what was submitted, using `dateKey(parseWallClock(event.startDate))` (see Edge Cases — non-recurring events never get `scope: "series"` rows).
3. Re-derive the active-member/has-email cohort fresh from `members` (`membershipStatus = 'active'`), intersect with submitted `memberIds`. Anyone dropped is classified `no_longer_active`, `no_email_on_file`, or `not_selected` (present in the fresh cohort but absent from the submitted list — an intentional admin uncheck, not an error).
4. If the resulting send set is empty → `400` `{ error: "No recipients to send to." }`. If the event has zero future, non-cancelled occurrences at all (checked once, independent of scope) → `400` `{ error: "This event has no upcoming occurrences to announce." }`.
5. Build the `.ics` attachment **once** for the whole batch — `buildVEvent`/`buildIcsCalendar` for the single occurrence, or the same occurrence-array-to-`buildIcsCalendar` call the series-download branch of `/api/events/[id]/ics/route.ts` uses for `scope: "series"`. Reuses `IcsEventInput`/`toIcsFilename` verbatim — no reimplementation.
6. Render subject once (`renderAnnouncementSubject`) and one personalized HTML body per recipient (`renderAnnouncementBody`, escaping the note and each member's first name via the shared `escapeHtml` from `src/lib/html-escape.ts`).
7. Send via `sendBulkMemberEmail({ from, subject, replyTo: CLUB_GROUP_EMAIL, attachments: [...], recipients })` — never a hand-rolled loop.
8. Insert one `event_announcements` row per attempted (has-email, selected) recipient, all sharing one `batchId = crypto.randomUUID()` generated once per POST.
9. Respond `200` **always** for a partial or total send failure (never `500` for a delivery failure — matches DECISION-075 §6 / Dues Reminders):
```ts
{
  batchId: string;
  scope: "occurrence" | "series"; occurrenceDate: string | null;
  sent: { memberId: string; success: boolean; error?: string }[];
  skipped: { memberId: string; reason: "no_longer_active" | "no_email_on_file" | "not_selected" }[];
}
```

**Partial-send behavior (member 20 of 41 fails):** `sendBulkMemberEmail()` already isolates each
recipient's `sendEmail()` call — one failure never aborts the rest (confirmed in `src/lib/email.ts`).
The route lets the batch run to completion, inserts a row per attempt (the failed one gets
`success: false, error: <message>`), and returns `200` with a mixed `sent` array. There is no
rollback and no retry-the-whole-batch — a failed individual send can be re-announced later via a
fresh Send click (a new batch), or picked up automatically if it landed in `email_queue` as
`status: 'failed'` and later clears through the existing deferred retry job (which, after this
feature, correctly carries the attachment — see DECISION-092).

## Data Model

**New table `event_announcements`** (add to `src/lib/db/schema.ts`, alongside `duesReminders`):

```ts
export const eventAnnouncements = pgTable(
  "event_announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Shared by every row from one Send click. Dues Reminders doesn't need this
    // because its history view is per-member-latest (DISTINCT ON); this feature's
    // Flow 3 explicitly wants a per-SEND aggregate ("sent to 39 of 41, by whom,
    // when") — reconstructing that from timestamp-equality across a multi-row
    // insert would work today (single INSERT ⇒ single `now()`) but is a fragile,
    // undocumented coincidence to rely on. An explicit batchId is the honest
    // shape. See DECISION-093.
    batchId: uuid("batch_id").notNull(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(), // 'occurrence' | 'series' — never 'series' for a non-recurring event
    occurrenceDate: date("occurrence_date"), // null iff scope = 'series'
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    sentByUserId: uuid("sent_by_user_id").references(() => users.id, { onDelete: "set null" }),
    emailQueueId: uuid("email_queue_id").references(() => emailQueue.id, { onDelete: "set null" }),
    success: boolean("success").notNull(),
    error: text("error"),
    note: text("note"), // the admin's optional free-text note, verbatim, same rationale as duesReminders.note
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_event_announcements_event_sent").on(t.eventId, t.sentAt),
    index("ix_event_announcements_batch").on(t.batchId),
  ],
);

export type EventAnnouncement = typeof eventAnnouncements.$inferSelect;
export type NewEventAnnouncement = typeof eventAnnouncements.$inferInsert;
```

Only attempted (has-email, selected) recipients get a row — matches `duesReminders`/
`insertDuesReminderRows`: skipped members (`no_longer_active` / `no_email_on_file` / `not_selected`)
appear only in the POST response, never persisted.

**`emailQueue` gains `attachments`** (DECISION-092, not re-litigated here):
```ts
attachments: jsonb("attachments").$type<{ filename: string; content: string; contentType?: string }[]>(),
```
nullable, no default.

**Three idempotent migrations**, in this order (no cross-dependency forces this order — chosen to
match Implementation Order below):
1. `drizzle/migrations/0094_events_announce_permission.sql` — mirrors `0093_social_requests_permissions.sql` byte-for-byte in structure: `INSERT INTO features ... WHERE NOT EXISTS`, then two independently-guarded `INSERT INTO role_features` for `admin` and `board_member`.
2. `drizzle/migrations/0095_email_queue_attachments.sql` — `ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS attachments jsonb;`
3. `drizzle/migrations/0096_event_announcements.sql` — `CREATE TABLE IF NOT EXISTS event_announcements (...)` + the two indexes via the guarded `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_indexes ...) ...` pattern `0092_social_requests.sql` uses.

## Component / Page Plan

**Pages to create:**
- `src/app/(dashboard)/admin/events/[id]/announce/page.tsx` — Server Component. `auth()` +
  `hasFeature(EVENTS_ANNOUNCE)` → `redirect("/admin/events")` on failure (not back to `[id]`,
  since an `EVENTS_ANNOUNCE`-lacking visitor isn't guaranteed to hold `EVENTS_EDIT` either).
  Loads the event + calls `getAnnouncementRecipients()` / `getFutureOccurrenceOptions()` /
  `getEventAnnouncementHistory()` directly (same functions the GET route calls) for first paint.
  Renders the recipient/occurrence/history data into `<EventAnnounceSender>` and
  `<EventAnnouncementHistoryTable>`.

**Components to create:**
- `src/components/admin/event-announce-sender.tsx` ("use client") — occurrence-vs-series picker
  (hidden entirely, defaulting silently to the event's single date, when `!event.isRecurring`),
  cohort summary card ("39 members will be emailed" / "2 members have no email on file" with an
  expandable name list — no addresses shown, matching the GET response), optional note
  `<textarea>` (client-enforced 2000-char cap mirroring the server's), Send button that opens
  `<ConfirmDialog>` (`@/components/ui/confirm-dialog`; title "Send this announcement?", description
  naming the scope + recipient count; not `destructive` — sending mail isn't a delete, but it is
  consequential, so it still gets a confirm step per Flow 1). On confirm, POSTs and renders a
  persistent post-send summary line ("Emailed 39 of 41 members" + any failures listed by name) in
  addition to a toast — Flow 1 asks for a line that survives the toast's disappearance.
- `src/components/admin/event-announcement-history-table.tsx` — plain server-renderable
  presentational component (no `"use client"` needed — no interactivity), `rounded-2xl` card,
  one row per batch: timestamp, sender, scope/occurrence, "N of M emailed," failures if any.
  Empty state: `bg-gray-50 rounded-2xl p-10 text-center text-gray-500`, "No announcements sent yet."

**Files to modify:**
- `src/app/(dashboard)/admin/events/[id]/page.tsx` — add an "Announce" link to
  `/admin/events/[id]/announce`, gated behind its own `hasFeature(session.user.id, FEATURES.EVENTS_ANNOUNCE)`
  check computed alongside the page's existing `canAccess` (`EVENTS_EDIT`) check, so an editor
  without the announce key never sees a dead link.
- `src/lib/permissions.ts` — `FEATURES.EVENTS_ANNOUNCE`, `FEATURE_DESCRIPTIONS` entry, Events nav
  item's `requiredFeature` widened to an array (see Permissions above).
- `src/lib/db/schema.ts` — `emailQueue.attachments`, new `eventAnnouncements` table.
- `src/lib/email.ts` — `SendEmailOptions`/`SendBulkMemberEmailOptions` gain `attachments?`; initial
  `email_queue` insert includes `attachments: attachments ?? null`; the `resend.emails.send()` call
  spreads `...(attachments && { attachments })`, same optional-spread idiom as `cc`/`bcc`/`replyTo`.
- `src/app/api/admin/email-queue/retry/route.ts` — its own `resend.emails.send()` call gains
  `...(item.attachments && { attachments: item.attachments })`.

**New lib files:**
- `src/lib/event-announcements.ts` — pure (no DB import, mirrors `dues-reminders.ts`):
  `renderAnnouncementSubject()`, `renderAnnouncementBody()`, `classifyAnnouncementRecipients()`.
  Imports `escapeHtml` from `src/lib/html-escape.ts` (does **not** write a fourth/seventh local
  copy — that file exists precisely to stop this) and `formatWallClockDate`/`formatRecurrence`/
  `dateKey`/`toIcsFilename` from `src/lib/events.ts`.
- `src/lib/event-announcements-queries.ts` — DB-facing: `getAnnouncementRecipients()`,
  `getFutureOccurrenceOptions(event)`, `getEventAnnouncementHistory(eventId)`,
  `insertEventAnnouncementRows(rows)`. Mirrors `dues-reminders-queries.ts`'s split.

## Template / Custom-Message Split (Phase 1 Gap, resolved)

**Fixed, non-editable template** (event-data-derived, same reasoning as Dues Reminders' fixed
per-cohort wording): salutation with the member's first name; an intro line that differs only by
scope ("You're invited to an upcoming Westerville Lions Club event:" vs. "Here are the details for
our recurring Westerville Lions Club meeting:"); event title; when (`formatWallClockDate()` for a
chosen occurrence, `formatRecurrence()` for a series); location if present; description if
present; a line noting the calendar invite is attached, plus a fallback link to the same
`/api/events/[id]/ics` route the public "Add to Calendar" buttons use (defense-in-depth for
webmail clients that strip attachments — zero new plumbing, the route already exists and already
enforces `isPublic`/`MEMBERS_VIEW`); closing signed "— Westerville Lions Club" (User Decision 3,
no officer resolution). No unsubscribe link (operational club notice, matches the "no opt-out in
v1" User Decision).

**Optional custom note**: single free-text `<textarea>`, plain text only (escaped, never rendered
as HTML — this feature does **not** claim the Welcome Packet's narrow raw-HTML exception), max
2000 chars, rendered in a highlighted box immediately below the salutation and above the
auto-generated event details — same visual treatment `dues_reminders.note` already uses. The event
details themselves are never editable inline: keeping title/date/location non-editable means the
template can never drift from the actual event record (an admin can't accidentally type a wrong
date into the email body), and it means no new rich-text UI pattern is introduced. This is the
tech-lead's call on Phase 1's flagged gap: template-first with an optional personal note, not a
freeform composer.

## Implementation Order

1. **Schema** — `drizzle/migrations/0094_events_announce_permission.sql`, `0095_email_queue_attachments.sql`, `0096_event_announcements.sql`; matching `schema.ts` updates (`emailQueue.attachments`, `eventAnnouncements` table). **database-admin.**
2. **`FEATURES.EVENTS_ANNOUNCE`** + `FEATURE_DESCRIPTIONS` entry + Events nav `requiredFeature` widening in `src/lib/permissions.ts`. **database-admin** (rides with the permission migration; consistent with how the `add-permission` skill scopes this pairing).
3. **`sendEmail()`/`sendBulkMemberEmail()` attachment plumbing** + `email-queue/retry/route.ts` fix (DECISION-092). **api-developer.**
4. **`src/lib/event-announcements.ts`, `event-announcements-queries.ts`, both route handlers.** **api-developer.**
5. **UI** — announce page, `EventAnnounceSender`, `EventAnnouncementHistoryTable`, the edit-page "Announce" link. **ux-developer.**
6. **Release notes entry** — after QA PASS, written by tech-lead per CLAUDE.md (not part of Phase 4).

## Edge Cases & Risks

- **Event with no occurrences left.** A non-recurring event whose single `startDate` has passed,
  or a recurring series past its `recurrenceEndDate` with zero future non-cancelled dates: the GET
  response's `hasFutureOccurrence: false` disables the Send action entirely in the UI with "This
  event has no upcoming occurrences to announce," and the POST independently re-checks and 400s —
  never silently sends an invite to something already over.
- **Cancelled occurrence chosen, then cancelled again before send** (race condition): POST
  re-validates the chosen `occurrenceDate` against a fresh `generateOccurrences()` + cancelled-set
  check, not the client's payload — mirrors the `/api/events/[id]/ics` route's own C1 check and
  Dues Reminders' "re-derive eligibility fresh" rule. Rejected with `400`.
- **Event deleted after being announced.** `event_announcements.eventId` cascades on delete — its
  send history disappears with the event. This matches existing precedent (`duesReminders.memberId`
  already cascades on member delete) and is accepted, not treated as a gap: there is no
  event-independent "all past announcements" page for orphaned rows to serve.
- **Resend to the same event.** Unlimited — each Send click is a new, independently-recorded
  `batchId`. The history panel lists every batch newest-first, so a repeat send is visible to the
  admin before they click, not hidden. "Last announced" is simply the newest batch's `sentAt`.
- **The nested-page test's blind spot** (Phase 2, carried forward verbatim): `nestedAdminPages()`
  in `admin-page-feature-gates.test.ts` will auto-discover `announce/page.tsx` and assert *some*
  `hasFeature()`/redirect pair exists — it does **not** assert the key is `FEATURES.EVENTS_ANNOUNCE`
  rather than `EVENTS_EDIT`. This must be verified by manual code review and by QA's Phase 5
  click-through (an `EVENTS_EDIT`-only, non-`EVENTS_ANNOUNCE` account must bounce from the
  announce page and route) — not something the automated suite alone can catch.
- **Non-recurring events never get `scope: 'series'` rows.** For `event.isRecurring === false`,
  the picker is hidden and the server forces `scope: "occurrence"` with `occurrenceDate = dateKey(startDate)`
  regardless of what the client submits — a one-off event's "series" and "occurrence" are the same
  thing, and storing `'series'` there would make the history table's scope column misleading.
- **Partial send failure** — see API Contract §POST step 9: `200` always, mixed `sent` array, one
  row per attempt persisted with its own `success`/`error`, no rollback, no automatic whole-batch
  retry (a failed individual recipient either clears via the existing deferred `email_queue` retry
  job, now attachment-safe per DECISION-092, or gets a fresh Send later).
- **From-address duplication is pre-existing, not introduced here.** This feature reuses the exact
  `process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org"` inline fallback already
  present at ~14 call sites (CLAUDE.md's "Duplication Is a Review Finding" section already tracks
  this pattern by name). Consistency with the existing idiom is preferred over introducing a
  fifteenth-and-different shape mid-feature; consolidating all of them into one helper is the
  30-day code review's job, not this feature's.
- **Mobile (360px).** The history table and cohort no-email name list must scroll inside their own
  `overflow-x-auto` container rather than widening the page, per the project's general responsive
  requirement.

## Unit Tests To Deliver (implementer-owned, per CLAUDE.md Phase 4 gate)

- **`src/lib/event-announcements.test.ts`**
  - `classifyAnnouncementRecipients()`: correctly splits into `toSend` / `skipped` with reasons
    `no_longer_active`, `no_email_on_file`, `not_selected`; de-dupes a repeated `memberId`.
  - `renderAnnouncementSubject()`: distinct wording for `scope: "occurrence"` vs `"series"`.
  - `renderAnnouncementBody()`: escapes a first name and a note containing `<script>`, `&`, `"` —
    regression for the "one escaper copy omitted" incident CLAUDE.md cites; asserts escaped
    entities appear and no raw tag survives.
  - `renderAnnouncementBody()`: non-recurring event never renders "series" language; recurring +
    `scope: "series"` uses `formatRecurrence()` output; recurring + `scope: "occurrence"` uses
    `formatWallClockDate()` for the *chosen* date, not the series start date.
  - `renderAnnouncementBody()`: an omitted/blank note renders no note block at all.
- **`src/lib/event-announcements-queries.test.ts`**
  - `getFutureOccurrenceOptions()`: excludes cancelled occurrences and past dates; empty array for
    a non-recurring past event; single date for a non-recurring future event.
  - `getEventAnnouncementHistory()`: groups rows by `batchId` into one summary row with correct
    `recipientCount`/`successCount`/`failureCount`; orders newest first.
- **`src/app/api/admin/events/[id]/announce/route.test.ts`**
  - GET: `401` no session; `403` for a session holding `EVENTS_EDIT` but **not** `EVENTS_ANNOUNCE`
    (explicit regression for the Phase 2-flagged "wrong key" risk); `404` unknown event.
  - POST: rejects a cancelled `occurrenceDate` (`400`); rejects a non-existent `occurrenceDate`
    (`400`); rejects an empty resolved recipient set (`400`); rejects when the event has zero
    future occurrences (`400`); on a mocked partial `sendBulkMemberEmail` failure (1 of 3
    recipients fails), still returns `200` with one `success: false` entry in `sent` and inserts a
    matching `event_announcements` row with `success: false` + `error`; every row from one POST
    shares the same `batchId`; a member no longer active at send time is classified
    `no_longer_active` and gets no row; a whitespace-only email is treated as no email on file.
- **`src/lib/email.test.ts`** (extend existing suite)
  - `sendEmail({ attachments })` passes them through to the mocked `resend.emails.send()` call
    unchanged; persists `attachments` on the initial `email_queue` insert.
  - `sendEmail()` called with no `attachments` still inserts `attachments: null` — no regression
    for the ~18 existing non-attachment callers.
  - `sendBulkMemberEmail({ attachments })` forwards the identical array to every per-recipient
    `sendEmail()` call.
- **`src/app/api/admin/email-queue/retry/route.test.ts`** — **the test named in the task brief**:
  seed/mock a `failed`, retry-eligible `email_queue` row with a non-null `attachments` value; call
  `POST`; assert the mocked `resend.emails.send()` receives that same `attachments` array —
  regression guard for the exact DECISION-092 gap (retry path silently dropping the calendar
  invite). Companion case: a row with `attachments: null` retries with no `attachments` key sent.
- **Not implementer-owned, flagged for qa (Phase 5):** a live-request Playwright
  `admin-events-announce-page-gate.spec.ts`, mirroring the sibling `*-gate.spec.ts` files Phase 2
  referenced, verifying an `EVENTS_EDIT`-only (non-`EVENTS_ANNOUNCE`) account is bounced from both
  the page and the API routes at the network level, not just in source.

## Implementer

**Specialist split — database-admin → api-developer → ux-developer.** Confirmed explicitly per
CLAUDE.md's selection table: this feature spans new schema (permission + `email_queue` column +
new table), server logic sensitive enough that Phase 2 dedicated a whole section to it
(`sendEmail()`/retry-route attachment plumbing, fresh server-side re-validation), and a
multi-piece UI (picker, cohort review, confirm flow, history table) — well past the
`full-stack-developer` "small and tightly coupled, ~<150 lines" threshold. Every increment of The
Ledger ran this same split cleanly; nothing here suggests collapsing it.

---

# Phase 4 — Implementation

## Phase 4a — Schema Implementation (database-admin) — 2026-09-04

**Owner:** database-admin
**Status:** complete

### Summary

Built the full schema slice per the Phase 3 design: the `events.announce` permission (bound to
`admin` + `board_member`), a nullable `attachments jsonb` column on `emailQueue`, and the new
`event_announcements` table with `batchId` (DECISION-093) and the two indexes named in the
design. Widened the Events nav item's `requiredFeature` to `[EVENTS_EDIT, EVENTS_ANNOUNCE]`.
Verified next-free migration numbers were still 0094–0096 as designed (0093 was the latest on
disk, no collision) and applied everything against the dev DB twice to prove idempotency.

### What I did

- Verified `drizzle/migrations/0093_social_requests_permissions.sql` was still the latest file —
  0094/0095/0096 were confirmed next-free, matching the design doc's proposed numbers exactly.
- Added `FEATURES.EVENTS_ANNOUNCE = "events.announce"` and its `FEATURE_DESCRIPTIONS` entry
  (`"Send event announcement emails to active members"`, byte-identical to the migration's
  `INSERT INTO features` description) to `src/lib/permissions.ts`.
- Widened the Events `ADMIN_NAVIGATION` entry's `requiredFeature` from `FEATURES.EVENTS_EDIT` to
  `[FEATURES.EVENTS_EDIT, FEATURES.EVENTS_ANNOUNCE]`, following the exact array pattern already
  used by the Minutes nav item (`[MINUTES_MANAGE, MINUTES_DELETE]`).
- Added `attachments: jsonb("attachments").$type<{ filename: string; content: string; contentType?: string }[]>()`
  (nullable, no default) to the existing `emailQueue` table in `src/lib/db/schema.ts`.
- Added the new `eventAnnouncements` table to `schema.ts` (placed alongside `duesReminders`, per
  the design), with `batchId`, `eventId` (FK → `events`, cascade), `scope`/`occurrenceDate`,
  `memberId` (FK → `members`, cascade), `sentByUserId`/`emailQueueId` (both FK, set null),
  `success`/`error`/`note`, `sentAt` (timestamptz, defaultNow), and the two indexes
  (`ix_event_announcements_event_sent` on `(eventId, sentAt)`, `ix_event_announcements_batch` on
  `batchId`). Exported `EventAnnouncement`/`NewEventAnnouncement` inferred types.
- Wrote three idempotent migrations:
  - `drizzle/migrations/0094_events_announce_permission.sql` — mirrors
    `0093_social_requests_permissions.sql` structure exactly: guarded `INSERT INTO features`, then
    two independently-guarded `INSERT INTO role_features` (admin, board_member), each via
    `WHERE NOT EXISTS`.
  - `drizzle/migrations/0095_email_queue_attachments.sql` — `ALTER TABLE email_queue ADD COLUMN
    IF NOT EXISTS attachments jsonb;`
  - `drizzle/migrations/0096_event_announcements.sql` — `CREATE TABLE IF NOT EXISTS
    event_announcements (...)` + both indexes via guarded `DO $$ ... IF NOT EXISTS (SELECT 1 FROM
    pg_indexes ...) ...` blocks, matching `0092_social_requests.sql`'s pattern.
- Ran `pnpm db:migrate` against the dev DB twice — first run applied cleanly, second run produced
  only expected "already exists, skipping" NOTICEs for all three new migrations (feature/role
  bindings, `attachments` column, `event_announcements` table/indexes) and no errors — idempotency
  confirmed.
- Verified live shape via `psql`: `event_announcements` columns/types/nullability/FKs/indexes
  match `schema.ts` exactly (cascade on `event_id`/`member_id`, set-null on
  `sent_by_user_id`/`email_queue_id`); `email_queue.attachments` is `jsonb`, nullable; the
  `events.announce` feature row is bound to both `admin` and `board_member` with the exact
  description string.
- Ran `pnpm exec tsc --noEmit` — clean, no errors.
- Attempted `pnpm db:push` to double-check for drift: it stalled on an **unrelated, pre-existing**
  interactive prompt about `ledger_entities_slug_unique` (a constraint on a table this feature
  never touches), which only surfaces because this shell isn't a TTY — the production build's
  `drizzle-kit push --force` auto-resolves it. Did not force it (that path offers to truncate
  `ledger_entities`, which has live data, and is out of this feature's scope). Not a regression
  from this change — the direct `psql` verification above already confirms `schema.ts` and the
  live DB agree for everything this slice touched.

### Outputs

- `src/lib/db/schema.ts` — `emailQueue.attachments` (nullable jsonb), new `eventAnnouncements`
  table + exported `EventAnnouncement`/`NewEventAnnouncement` types.
- `src/lib/permissions.ts` — `FEATURES.EVENTS_ANNOUNCE`, its `FEATURE_DESCRIPTIONS` entry, Events
  nav `requiredFeature` widened to `[EVENTS_EDIT, EVENTS_ANNOUNCE]`.
- `drizzle/migrations/0094_events_announce_permission.sql` — idempotent (`WHERE NOT EXISTS` /
  guarded inserts throughout).
- `drizzle/migrations/0095_email_queue_attachments.sql` — idempotent (`ADD COLUMN IF NOT EXISTS`).
- `drizzle/migrations/0096_event_announcements.sql` — idempotent (`CREATE TABLE IF NOT EXISTS` +
  guarded `DO $$` index blocks).
- Tables affected: `email_queue` (new column), `event_announcements` (new table), `features` /
  `role_features` (new permission + two role bindings).
- Role bindings added: `events.announce` → `admin`, `events.announce` → `board_member`, both via
  the standard `SELECT ... WHERE NOT EXISTS` guarded pattern.
- No decisions.md entry needed — DECISION-092 and DECISION-093 already cover this slice's design
  rationale; nothing diverged from them.
- Local apply commands used: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm
  db:migrate` (run twice), `pnpm exec tsc --noEmit`.

### Open questions / handoff notes

- **For api-developer (next):** `eventAnnouncements` and `emailQueue.attachments` are live in both
  `schema.ts` and the dev DB. Per DECISION-092, still needed: `SendEmailOptions`/
  `SendBulkMemberEmailOptions` in `src/lib/email.ts` gain `attachments?`, the initial
  `email_queue` insert includes `attachments: attachments ?? null`, and
  `src/app/api/admin/email-queue/retry/route.ts`'s own `resend.emails.send()` call must forward
  `item.attachments` — that route bypasses `sendEmail()` entirely, so this is a required, not
  optional, part of the diff (the whole point of DECISION-092).
- **Foreign keys for api-developer's queries:** `eventAnnouncements.eventId` → `events.id`
  (cascade), `.memberId` → `members.id` (cascade), `.sentByUserId` → `users.id` (set null),
  `.emailQueueId` → `emailQueue.id` (set null). `scope` is a plain `text` column (`'occurrence' |
  'series'`, enforced only at the application layer, same as `duesReminders.cohort`) —
  `occurrenceDate` must stay `null` whenever `scope = 'series'`, and a non-recurring event must
  never receive a `'series'` row (server-side responsibility, not a DB constraint).
- **`getFutureOccurrenceOptions`/history queries belong to api-developer** —
  `src/lib/event-announcements-queries.ts` per Phase 3's Implementation Order, item 4.
- **`pnpm db:push` note:** the interactive prompt encountered above (`ledger_entities_slug_unique`)
  is pre-existing and unrelated to this feature — flagging so it isn't mistaken for something this
  slice introduced. Not fixed here (out of scope, touches a different table's data).
- Did not touch `src/lib/email.ts`, any route handler, or any UI component — per scope, those are
  api-developer's and ux-developer's slices next in the Implementation Order.

---

## Phase 4b — API Implementation (api-developer) — 2026-09-04

**Owner:** api-developer
**Status:** complete

### Summary

Built the full server-side slice per the Phase 3 design: `sendEmail()`/`sendBulkMemberEmail()`
gained optional MIME attachments (DECISION-092), the deferred `email-queue/retry` route now
forwards a persisted row's `attachments`, and the new `GET`/`POST
/api/admin/events/[id]/announce` routes implement the cohort preview and send flow exactly per
the API Contract — fresh server-side re-validation of scope/occurrence/recipients, `.ics`
generation reused verbatim from `src/lib/events.ts`, `sendBulkMemberEmail()` for delivery, one
`event_announcements` row per attempted recipient sharing a `batchId`, and `200` always (never
`500`) for a partial or total send failure. Every unit test named in the Phase 3 design doc for
this layer is written and passing, including the retry-route attachment-preservation regression
test the task brief called out explicitly.

### What I did

- **`src/lib/email.ts`** — added `EmailAttachment` interface (`filename`, `content`,
  `contentType?`), added `attachments?: EmailAttachment[]` to `SendEmailOptions` and
  `SendBulkMemberEmailOptions`. `sendEmail()`'s initial `email_queue` insert now includes
  `attachments: attachments ?? null`; the `resend.emails.send()` call spreads
  `...(attachments && { attachments })`, matching the existing `cc`/`bcc`/`replyTo` optional-spread
  idiom exactly. `sendBulkMemberEmail()` forwards the same `attachments` array, unchanged, to every
  per-recipient `sendEmail()` call. Fully backward-compatible — zero changes required at any of the
  ~18 existing call sites (verified: `attachments: null` inserted, no `attachments` key sent to
  Resend, when omitted).
- **`src/app/api/admin/email-queue/retry/route.ts`** — its own (separate, `sendEmail()`-bypassing)
  `resend.emails.send()` call now spreads `...(item.attachments && { attachments: item.attachments })`.
  This was the load-bearing half of DECISION-092: without it, a failed announcement send that
  later clears through the deferred retry job would have silently arrived without its calendar
  invite.
- **`src/lib/event-announcements.ts`** (new, pure, no DB import) — `renderAnnouncementSubject()`
  (distinct wording per scope), `renderAnnouncementBody()` (fixed event-data-derived template +
  optional escaped note; escapes via the shared `escapeHtml()` from `src/lib/html-escape.ts`, not a
  new local copy; non-recurring events can never render "series" language even if `scope` is
  passed incorrectly — defense in depth on top of the server forcing it correctly),
  `classifyAnnouncementRecipients()` (splits a requested member-id list against the fresh
  active-member cohort into `toSend` / `skipped` with reasons `no_longer_active` /
  `no_email_on_file` / `not_selected`, de-duping via `Set`), and the shared
  `EVENT_ANNOUNCEMENT_NOTE_MAX_LEN = 2000` constant.
- **`src/lib/event-announcements-queries.ts`** (new, DB-facing) — `getAnnouncementRecipients()`
  (every active member, email included — GET route strips addresses before returning to the
  client), `getCancelledOccurrenceDates()` (shared by the picker and the POST route's own
  re-validation, avoiding a second copy of the overrides-fetch), `getFutureOccurrenceOptions()`
  (future + non-cancelled only — applies its own `isAfter(now)` filter on top of
  `generateOccurrences()`, because that helper only excludes past dates for *recurring* events via
  its `from` walk-start, not for a non-recurring event, which always returns its single startDate
  regardless of `from`), `getEventAnnouncementHistory()` (groups rows by `batchId` into one summary
  row, newest first — in-memory grouping since a Map preserves insertion order and rows arrive
  pre-ordered by `sentAt DESC`), `insertEventAnnouncementRows()`.
- **`src/app/api/admin/events/[id]/announce/route.ts`** (new) — `GET`/`POST`, both independently
  gated on `auth()` + `hasFeature(session.user.id, FEATURES.EVENTS_ANNOUNCE)`. `POST` follows the
  design's 9-step order exactly: load event fresh → force `scope: "occurrence"` +
  `occurrenceDate = dateKey(parseWallClock(event.startDate))` for a non-recurring event regardless
  of what was submitted → for a recurring `scope: "occurrence"` request, re-validate the submitted
  `occurrenceDate` against a fresh `generateOccurrences()` + the cancelled-overrides set (rejects
  both a nonexistent date and a since-cancelled one) → reject if the event has zero future
  non-cancelled occurrences at all → re-derive the active/has-email cohort fresh and classify the
  submitted `memberIds` against it → reject an empty resolved send set → build the `.ics`
  attachment once for the whole batch via `buildVEvent`/`buildIcsCalendar`/`generateOccurrences`
  (reused verbatim from `src/lib/events.ts`, not reimplemented — same helpers
  `/api/events/[id]/ics/route.ts` already uses) → render subject once, one personalized body per
  recipient → send via `sendBulkMemberEmail()` (never a hand-rolled loop) with `replyTo:
  CLUB_GROUP_EMAIL` and the shared `.ics` attachment → insert one `event_announcements` row per
  attempted recipient sharing one `batchId = randomUUID()` → respond `200` always with a mixed
  `sent`/`skipped` result, never `500` for a delivery failure.
- **Tests** (all named in the Phase 3 design doc, all passing):
  - `src/lib/event-announcements.test.ts` — 11 tests: classification splits/reasons/de-dupe;
    subject wording distinctness; escaping regression (`<script>`, `&`, `"`, an `onerror` handler);
    non-recurring never renders "series" language; series uses `formatRecurrence()`; occurrence
    uses `formatWallClockDate()` for the *chosen* date, not the series start; omitted/blank note
    renders no note block.
  - `src/lib/event-announcements-queries.test.ts` — 5 tests: `getFutureOccurrenceOptions()` empty
    for a non-recurring past event, single date for a non-recurring future event, excludes a
    cancelled date; `getEventAnnouncementHistory()` groups by `batchId` with correct counts newest
    first, empty array for no history.
  - `src/app/api/admin/events/[id]/announce/route.test.ts` — 14 tests: `401`/`403` (explicitly
    asserting `hasFeature` was called with `FEATURES.EVENTS_ANNOUNCE`, not just that some gate
    exists — the Phase 2-flagged "wrong key" risk)/`404` on GET and POST; cohort split with no
    addresses leaked to the client; cancelled/nonexistent `occurrenceDate` rejected; empty resolved
    recipient set rejected; zero-future-occurrences rejected; a partial send failure (1 of 3) still
    returns `200` with a matching `success: false` row and all rows sharing one `batchId`; a member
    no longer active gets `no_longer_active` and no row; a whitespace-only email is
    `no_email_on_file`; a non-recurring event's submission is forced to `scope: "occurrence"`
    regardless of what was sent.
  - `src/lib/email-guardrail.test.ts` (extended) — 4 new tests: attachments forwarded to the mocked
    `resend.emails.send()` unchanged; persisted on the `email_queue` insert; omitting attachments
    still inserts `null` with no `attachments` key sent (no regression for existing callers);
    `sendBulkMemberEmail()` forwards the identical array to every per-recipient call.
  - `src/app/api/admin/email-queue/retry/route.test.ts` (new) — the task-brief-named regression
    test: a persisted `attachments` array is forwarded to `resend.emails.send()` on retry; a `null`
    value retries with no `attachments` key sent.
  - **Drive-by fix:** `src/lib/permissions.test.ts`'s `getFeaturesByCategory` "events" category
    count test was stale after Phase 4a added `FEATURES.EVENTS_ANNOUNCE` (expected 4, DB now
    returns 5) — `pnpm test` was red on a completely unrelated, pre-existing assertion until this
    one-line fix (added `FEATURES.EVENTS_ANNOUNCE` to the expected list). Not part of this
    feature's own contract; flagging so it isn't mistaken for scope creep.
- Ran `pnpm exec tsc --noEmit` (clean) and `pnpm test` (1747/1747 passing) after every file added.
- **Not run:** `pnpm lint` — pre-existing, unrelated environment breakage
  (`minimatch` ESM/CJS resolution error inside `@eslint/eslintrc`, fails identically on files this
  feature never touched). Flagging for deployment-engineer's dependency review; did not attempt a
  fix, out of scope for this slice.

### Outputs

**`GET /api/admin/events/[id]/announce`**
Auth: `auth()` + `hasFeature(session.user.id, FEATURES.EVENTS_ANNOUNCE)` → `401`/`403`. `404` if
the event doesn't exist. Response `200`:
```ts
{
  event: { id: string; title: string; isRecurring: boolean; isAllDay: boolean; location: string | null };
  occurrenceOptions: { date: string; label: string }[]; // future, non-cancelled only
  hasFutureOccurrence: boolean;
  recipients: {
    withEmail: { memberId: string; firstName: string; lastName: string }[];    // no addresses
    withoutEmail: { memberId: string; firstName: string; lastName: string }[];
  };
  history: {
    batchId: string; scope: "occurrence" | "series"; occurrenceDate: string | null;
    sentAt: string; sentByName: string | null; recipientCount: number;
    successCount: number; failureCount: number; note: string | null;
  }[]; // newest first
}
```

**`POST /api/admin/events/[id]/announce`**
Same auth gate, re-checked independently. Request:
```ts
{ scope: "occurrence" | "series"; occurrenceDate?: string; note?: string; memberIds: string[] }
```
Response `200` always (never `500` for a delivery failure):
```ts
{
  batchId: string; scope: "occurrence" | "series"; occurrenceDate: string | null;
  sent: { memberId: string; success: boolean; error?: string }[];
  skipped: { memberId: string; reason: "no_longer_active" | "no_email_on_file" | "not_selected" }[];
}
```
`400` for: malformed `scope`/`occurrenceDate`/`memberIds`; a cancelled or nonexistent
`occurrenceDate`; an empty resolved recipient set (`{ error: "No recipients to send to." }`); zero
future non-cancelled occurrences at all (`{ error: "This event has no upcoming occurrences to
announce." }`). `404` if the event doesn't exist.

- Files added: `src/lib/event-announcements.ts`, `src/lib/event-announcements-queries.ts`,
  `src/app/api/admin/events/[id]/announce/route.ts`, and the five test files listed above.
- Files modified: `src/lib/email.ts`, `src/app/api/admin/email-queue/retry/route.ts`,
  `src/lib/email-guardrail.test.ts`, `src/lib/permissions.test.ts` (drive-by fix, see above).
- No schema changes — `eventAnnouncements`/`emailQueue.attachments` were already live from Phase
  4a; nothing here required a new migration.
- No new decisions.md entry — DECISION-092/093 already cover this slice's rationale; nothing
  diverged from them or from the Phase 3 design.

### Open questions / handoff notes

- **For ux-developer (next):** the full request/response contract above is live and tested. Build
  `src/app/(dashboard)/admin/events/[id]/announce/page.tsx` (Server Component, `auth()` +
  `hasFeature(EVENTS_ANNOUNCE)` → `redirect("/admin/events")`) calling
  `getAnnouncementRecipients()` / `getFutureOccurrenceOptions()` / `getEventAnnouncementHistory()`
  directly for first paint (same functions the GET route calls), plus `<EventAnnounceSender>`
  (occurrence-vs-series picker hidden when `!event.isRecurring`, cohort summary, note textarea
  capped at `EVENT_ANNOUNCEMENT_NOTE_MAX_LEN` — import this constant from
  `@/lib/event-announcements` rather than hard-coding `2000` again, `<ConfirmDialog>` before
  sending, persistent post-send summary line) and `<EventAnnouncementHistoryTable>` per the Phase 3
  Component Plan. Also: the "Announce" link on `src/app/(dashboard)/admin/events/[id]/page.tsx`,
  gated on its own `hasFeature(EVENTS_ANNOUNCE)` check alongside the page's existing `EVENTS_EDIT`
  check.
- **UI copy discipline (B-47):** the POST response's `sent[].success` must be rendered as "Emailed"
  / "Sent", never "Delivered" — no bounce/open visibility exists for Resend sends in this app.
- **Manual verification still needed (flagged in Phase 3 for qa, not this phase):** an
  `EVENTS_EDIT`-only, non-`EVENTS_ANNOUNCE` account must be confirmed to bounce from both the page
  and these API routes at the network level — the nested-page proxy test only asserts *some* gate
  exists, not that it's `EVENTS_ANNOUNCE` specifically. This phase's route tests assert the correct
  key is used at the unit level (`hasFeature` called with `FEATURES.EVENTS_ANNOUNCE`); qa's Phase 5
  live-request Playwright spec is still the network-level confirmation.
- **`pnpm lint` is broken independent of this feature** (see "What I did" above) — surfacing for
  whoever owns the next dependency review; not blocking this handoff since `tsc`/`test` are the
  Phase 4 gate criteria and both pass clean.

---

## Phase 4c — UI Implementation (ux-developer) — 2026-09-04

**Owner:** ux-developer
**Status:** complete

### Summary

Built the UI slice per the Phase 3 Component Plan against the live API contract shipped in
Phase 4b (verified against the actual route file, not just the design doc's prose): the
`/admin/events/[id]/announce` Server Component page (its own independent `auth()` +
`hasFeature(EVENTS_ANNOUNCE)` gate), the `EventAnnounceSender` client island (occurrence-vs-series
picker, cohort review, note, `ConfirmDialog`, persistent post-send summary), the plain
presentational `EventAnnouncementHistoryTable`, and the gated "Announce" link on the existing
edit-event page. No API/schema files touched.

### What I did

- Read the Phase 3 design doc in full plus Phase 4a/4b's handoff notes, then read the actual
  `src/app/api/admin/events/[id]/announce/route.ts`, `src/lib/event-announcements.ts`, and
  `src/lib/event-announcements-queries.ts` to confirm the live request/response shapes rather than
  trusting prose.
- Read `src/components/admin/dues-reminder-sender.tsx` (the Dues Reminders precedent named in the
  brief) for the cohort-display pattern — selectable with-email list, no-email cohort shown in an
  amber box (not dropped), refresh action, persistent post-send results panel with per-row
  success/failure badges and a skip-reason list — and matched its shape here.
- Built `src/app/(dashboard)/admin/events/[id]/announce/page.tsx` — Server Component. Its own
  `auth()` + `hasFeature(session.user.id, FEATURES.EVENTS_ANNOUNCE)` → `redirect("/admin/events")`
  gate, independent of and narrower than `EVENTS_EDIT`. Loads the event fresh (`notFound()` if
  missing), calls `getFutureOccurrenceOptions()` / `getAnnouncementRecipients()` /
  `getEventAnnouncementHistory()` directly for first paint (same functions the GET route calls).
- Built `src/components/admin/event-announce-sender.tsx` ("use client"):
  - Occurrence-vs-series radio picker, rendered only when `event.isRecurring`; a non-recurring
    event shows a plain one-line "this is a one-time event on [date]" instead, matching the
    server's forced `scope: "occurrence"`.
  - Cohort: with-email members in a checkbox list (all selected by default, "Select all" toggle);
    no-email members shown-not-dropped in an amber `rounded-2xl` box, matching the Dues Reminders
    precedent's excluded-cohort treatment.
  - Note `<textarea>` capped at `EVENT_ANNOUNCEMENT_NOTE_MAX_LEN`, imported from
    `@/lib/event-announcements` rather than a hard-coded `2000` (per Phase 4b's explicit handoff
    note).
  - Send button opens `<ConfirmDialog>` (not `destructive` — sending mail is consequential, not a
    delete, same reasoning Dues Reminders documented) naming the scope and recipient count. On
    confirm, POSTs to `/api/admin/events/[id]/announce`.
  - Result rendering uses "Emailed" / "Failed" badges — never "Delivered" (B-47) — plus a
    persistent summary line and a skip-reason list (`no_longer_active` / `no_email_on_file` /
    `not_selected`) that survives after the toast disappears.
  - Zero-future-occurrence state: an amber banner explains there's nothing to announce and the
    entire cohort/note/send UI is suppressed (`hasFutureOccurrence` from the GET response drives
    this — matches the design's "Send disabled with explanation" edge case).
  - "Refresh" re-fetches the GET endpoint and resets selection to the fresh with-email cohort,
    mirroring Dues Reminders' refresh behavior.
- Built `src/components/admin/event-announcement-history-table.tsx` — plain, no `"use client"`
  (no interactivity), `rounded-2xl` card, one row per batch (sent timestamp, scope/occurrence +
  note preview, sender, "Emailed N of M" / "Emailed N of M — F failed" badge). Empty state:
  `bg-gray-50 rounded-2xl p-10 text-center text-gray-500`, "No announcements sent yet." Table wrapped
  in its own `overflow-x-auto` container per the design's mobile requirement.
- Modified `src/app/(dashboard)/admin/events/[id]/page.tsx` — added a second, independent
  `hasFeature(session.user.id, FEATURES.EVENTS_ANNOUNCE)` check alongside the existing `EVENTS_EDIT`
  check, and an "Announce" secondary-style button/link next to the "Edit Event" heading, rendered
  only when `canAnnounce` is true (an editor without the announce key never sees a dead link).
- No native dialogs, no `console.log` added. All buttons `rounded-lg`, all cards `rounded-2xl`,
  focus rings present on every interactive/link element, 44px minimum touch targets on the primary
  actions.

### Outputs

- `src/app/(dashboard)/admin/events/[id]/announce/page.tsx` (new)
- `src/components/admin/event-announce-sender.tsx` (new)
- `src/components/admin/event-announcement-history-table.tsx` (new)
- `src/app/(dashboard)/admin/events/[id]/page.tsx` (modified — gated "Announce" link)
- No API/schema files modified — this slice consumed the Phase 4b contract as-is; nothing in it
  required a change.

**Verification:**
- `pnpm exec tsc --noEmit` — clean, no errors.
- `pnpm test` — 1749/1749 passing (no new test files added; this slice's scope is UI-only per the
  Implementation Order, and Phase 4b already delivered every unit test named in the Phase 3 design
  doc for the layers this component consumes).
- `pnpm build:only` — production build succeeded; `/admin/events/[id]/announce` and
  `/api/admin/events/[id]/announce` both appear as server-rendered (`ƒ`) routes in the build output,
  no compile errors.

### Open questions / handoff notes

- **For qa (next):** click-through checklist —
  1. As an `admin`/`board_member` account: open `/admin/events/[id]` for a recurring event with a
     future occurrence, confirm the "Announce" button appears, click through to
     `/admin/events/[id]/announce`, verify the occurrence-vs-series picker, cohort lists (with- and
     without-email), note field, `ConfirmDialog`, and that a real send (only if
     `EMAIL_DEV_ALLOWLIST` covers your own address per CLAUDE.md — never a real member/list) shows
     "Emailed"/"Failed" badges and lands a history row.
  2. Repeat for a **non-recurring** event — confirm the series/occurrence radio picker is fully
     hidden and the one-time-event line appears instead.
  3. Confirm an event with **zero future occurrences** shows the amber "nothing to announce" banner
     with the cohort/note/send UI suppressed, and that the Announce link itself is still reachable
     (the page doesn't 404 or crash) even though sending is unavailable.
  4. **The manual-review item flagged twice already in this work-log (Phase 2 and Phase 3):** an
     `EVENTS_EDIT`-only, non-`EVENTS_ANNOUNCE` account must not see the "Announce" link on the edit
     page, and must bounce from `/admin/events/[id]/announce` at the network level. This UI slice
     wires the correct key (`FEATURES.EVENTS_ANNOUNCE`) on both the link's gate and the page's own
     gate, but the live-request Playwright confirmation is qa's, per Phase 3's "Unit Tests To
     Deliver" note.
  5. Confirm the history table's empty state ("No announcements sent yet.") on a freshly-created
     event, and that a partial-failure result (if reproducible in a test environment) renders a
     mixed Emailed/Failed list rather than a blanket success or raw error.
- **New copy strings the Lions Club may want to refine:** "Send Announcement" (page H1 subtext),
  "Nothing upcoming to announce", "Will be emailed (N)", "No email on file (N) — won't be emailed",
  "Add a note for recipients (optional)". None are novel wording patterns — they follow the Dues
  Reminders precedent's tone.
- **UX decisions made in this slice, not otherwise specified by Phase 3:**
  - The occurrence picker's non-recurring fallback line ("This is a one-time event on...") wasn't
    explicitly speced beyond "hidden entirely" — added a one-line confirmation of the date so the
    admin isn't looking at an empty gap where the picker would be.
  - History table's note column shows a truncated, titled (`title=`) preview of the batch's note
    rather than a separate column, to avoid the table widening past its `overflow-x-auto` container
    on narrow viewports.
  - Refresh both on the sender component (explicit button, matches Dues Reminders) and an implicit
    re-fetch after a successful send (also matches Dues Reminders) — chosen for consistency with the
    existing precedent rather than re-deciding it.
- **Next agent:** qa (Phase 5) — typecheck/build/tests already green per this phase; qa owns the
  dev-server smoke test, the manual click-through above, and the live-request Playwright
  `admin-events-announce-page-gate.spec.ts` named in Phase 3's "Unit Tests To Deliver" (not
  implementer-owned).

---

# Phase 5 — Verification (qa)

**Date:** 2026-09-04
**Verified by:** qa

## Summary

**Verdict: PASS.** Independently re-ran (not trusted from Phase 4 reports) `tsc --noEmit`,
`pnpm test`, and `pnpm build:only` — all green, matching the implementers' claims. Read every
new/changed file (route handlers, pure libs, query layer, UI components, migrations, `email.ts`
attachment plumbing, the retry route) rather than inferring correctness from passing tests. Drove
the live flow twice against the running dev server with throwaway Playwright scripts (deleted
after use, DB rows cleaned up): once as an `admin` account exercising the full send (cohort
preview → occurrence/series picker → note → `ConfirmDialog` → send → persisted
`event_announcements` batch → `email_queue` row with the `.ics` attachment intact, correctly
`blocked_non_production`), and once against the two non-recurring edge states (future one-time
event, past zero-occurrence event). Wrote and committed a permanent regression spec,
`e2e/admin-events-announce-page-gate.spec.ts` (7 tests, all passing), that proves at the network
level — not just in source — that an `EVENTS_EDIT`-only account cannot see the Announce link,
cannot reach the announce page, and gets `403` from both `GET`/`POST`
`/api/admin/events/[id]/announce`; this was the manual-review item flagged twice in this work-log
(Phase 2, Phase 3) as something only a live request against a deliberately under-privileged
account can catch, since every shipped role that holds `events.edit` also holds
`events.announce` today.

## Type Check

`pnpm exec tsc --noEmit`: **PASS** — clean, no errors.

## Unit Tests

`pnpm test`: **PASS**
Total: 1749 | Passed: 1749 | Failed: 0
Duration: ~2s (test execution; ~10-12s including transform/import)
Failures: none.

Feature-specific files re-verified in isolation:
- `src/lib/event-announcements.test.ts`, `src/lib/event-announcements-queries.test.ts`,
  `src/app/api/admin/events/[id]/announce/route.test.ts`, `src/lib/email-guardrail.test.ts`,
  `src/app/api/admin/email-queue/retry/route.test.ts` — 46 tests, all passing.
- `src/lib/admin-page-feature-gates.test.ts` (nested-page discovery) — 161 tests, all passing;
  confirms `announce/page.tsx` is auto-discovered and asserted to carry *some*
  `hasFeature()`/`redirect()` gate (per Phase 2/3's documented blind spot, this test alone does not
  prove it's the *right* key — see the new e2e spec below for that proof).
- Confirmed by direct grep that `route.test.ts` asserts `hasFeature` was called with
  `FEATURES.EVENTS_ANNOUNCE` specifically (not just "some feature"), for both `GET` and `POST` —
  this is the unit-level half of the Phase 2/3-flagged "wrong key" regression guard.

## Production Build

`pnpm build:only`: **PASS**
Notes: `✓ Compiled successfully in 8.0s`. Both `/admin/events/[id]/announce` and
`/api/admin/events/[id]/announce` appear as server-rendered (`ƒ`) dynamic routes in the route
table. No build errors or warnings in the log.

## End-to-End Tests

`pnpm test:e2e` (full suite, `npx dotenv -e .env.local -- npx playwright test`): **PASS overall,
with 9 pre-existing failures unrelated to this feature.**
Total: 152 (111 passed, 9 failed, 1 skipped, 31 did not run due to `test.describe.serial` blocks
aborting after an earlier failure in the same file) | Duration: ~1.4m

New spec added by this phase — `e2e/admin-events-announce-page-gate.spec.ts` — 7/7 passing (see
Regression Tests Added below).

**The 9 pre-existing failures are unrelated to Event Announcement Emails** — none touch
`email.ts`, `email_queue`, the `events.announce` permission, the widened Events nav entry, or any
file this feature changed. Verified, not assumed:
- `e2e/cancel-occurrence.spec.ts` (2 failures) — root-caused via direct inspection: the spec
  hardcodes `CANCEL_DATE = "2026-08-01"` / `SIGNUP_BLOCKED_DATE = "2026-08-08"` with a comment
  saying "must stay in the future relative to 'today'" — both dates are now in the past relative
  to the actual current date (2026-09-04), so the API's past-occurrence guard fires before the
  cancelled-occurrence guard the test is trying to exercise. Pure calendar drift in a pre-existing
  spec; reran in isolation (`--workers=1`, no other spec running) and it fails identically,
  confirming this isn't test-suite interference. Flagged for whoever owns the next code review —
  needs relative (not hardcoded) dates.
- `e2e/write-in-signups.spec.ts` (1 failure in the full run) — reran in isolation and **passed
  clean**, confirming this was concurrent-worker interference from the full-suite run
  (`fullyParallel: true`, multiple workers, shared dev DB), not a real regression.
- `e2e/budget-star-notes.spec.ts`, `e2e/budgeting-restructure.spec.ts`, `e2e/ledger-search.spec.ts`,
  `e2e/prior-year-cause-line-reconcile.spec.ts`, `e2e/recurring-signup-rollup.spec.ts`,
  `e2e/transaction-budget-line-link.spec.ts` (6 failures) — all in ledger/budgeting/RSVP-rollup
  areas this feature never touches (no shared files, confirmed via `grep` — the only "nav"/
  "announce" matches in these files are unrelated uses of the word "navigate"). Consistent with
  the same full-suite concurrency pattern as `write-in-signups`.

Failures: `e2e/cancel-occurrence.spec.ts:56` and `:133` (pre-existing date-decay, not this
feature); the remaining 7 are consistent with cross-spec interference under full-suite
parallelism, not exercised by anything this feature changed.

## Manual / Live Click-Through

Driven against the actual running `pnpm dev` server with real browser automation (Playwright,
headed logic via `signInAsAdmin` / disposable fixture accounts) rather than reasoning from code
alone. Throwaway verification scripts were written, run, and deleted after confirming behavior (no
permanent artifacts beyond the gate spec below); all DB rows created were cleaned up and verified
absent afterward.

| Flow | Result | Notes |
|------|--------|-------|
| Admin opens a recurring event → Announce link → `/admin/events/[id]/announce` | pass | Cohort preview ("Will be emailed (N)"), occurrence-vs-series radio picker, both options visible for a recurring event. |
| Add a note, pick scope, `ConfirmDialog` before send | pass | `ConfirmDialog` text "Send this announcement?" rendered; no native `confirm()`. |
| Send → persistent result summary | pass | "Send results" panel rendered "Emailed N of M"; `expect(body).not.toContainText("Delivered")` passed — B-47 wording discipline holds. |
| `event_announcements` batch persisted | pass | One row per attempted recipient, all sharing one `batchId`, `note` field matches what was typed verbatim. |
| `email_queue` rows for the send | pass | `status = 'blocked_non_production'` for every row (deny-by-default confirmed — `EMAIL_DEV_ALLOWLIST` is unset in this environment, so nothing was actually delivered to Resend). |
| `.ics` attachment persisted on the queue row | pass | `attachments` jsonb array present, `filename` ends `.ics`, `content` contains `BEGIN:VCALENDAR`, `contentType = "text/calendar"` — DECISION-092's attachment persistence confirmed on a real, non-mocked insert. |
| Non-recurring **future** event | pass | Occurrence/series radio picker fully absent; "This is a one-time event on [date]" line shown instead. |
| Non-recurring **past** event (zero future occurrences) | pass | Amber "Nothing upcoming to announce" banner shown; cohort/note/Send UI fully suppressed (`getByText(/Will be emailed/)` and the Send button both assert zero matches); "Announcement history" panel still renders (page doesn't 404/crash). |
| `EVENTS_EDIT`-only account: Announce link on edit page | pass (absent, correctly) | See `e2e/admin-events-announce-page-gate.spec.ts` — link has zero matches. |
| `EVENTS_EDIT`-only account: `/admin/events/[id]/announce` | pass (redirected) | Page URL no longer contains `/announce` after navigation — proxy's OR'd rule (`EVENTS_EDIT` or `EVENTS_ANNOUNCE`) lets the request through to the route; only the page's own `hasFeature(EVENTS_ANNOUNCE)` check catches it, confirmed live. |
| `EVENTS_EDIT`-only account: `GET`/`POST /api/admin/events/[id]/announce` | pass (403) | Both return `403`, not a silent `200`, at the real network layer with a real session cookie. |
| Plain member (no `events.edit`, no `events.announce`) | pass | Bounced to `/access-pending` from `/admin/events` entirely; also independently redirected off the announce page and 401/403'd from the POST route. |
| Retry path attachment forwarding (DECISION-092) | pass (code trace + persisted-row confirmation) | `src/app/api/admin/email-queue/retry/route.ts:68` spreads `...(item.attachments && { attachments: item.attachments })` into its own `resend.emails.send()` call — read directly, not inferred. Combined with the live confirmation above that a real send persists a well-formed `attachments` array on the `email_queue` row, the retry path is proven to read exactly the shape it needs. Did not force a live `failed`-status retry (the dev guardrail intercepts before a row can reach `status: 'failed'` in this environment, since blocked rows are `blocked_non_production`, not `failed`, and are therefore not retry-eligible) — task brief explicitly allows code-trace + persisted-row confirmation as sufficient when live retry isn't observable. |
| Console.log / native dialog / duplicated ICS logic sweep | pass | Zero matches for `console.log`, `window.confirm/alert/prompt`, or `BEGIN:VCALENDAR` construction outside `src/lib/events.ts` across every new file. |

## Regression Tests Added

- `e2e/admin-events-announce-page-gate.spec.ts` (new, 7 tests) — guards against: an
  `EVENTS_EDIT`-only account (or a plain member) reaching the Announce link, page, or API routes
  that only `FEATURES.EVENTS_ANNOUNCE` should gate. This is the network-level proof the work-log
  flagged twice (Phase 2, Phase 3) as un-catchable by the nested-page test alone, since it only
  asserts *some* gate exists. No shipped role has `events.edit` without `events.announce` today
  (`admin` and `board_member` both hold both), so the spec composes a disposable fixture role
  bound to only `events.edit` via direct DB insert/delete (cascading cleanup verified empty in
  `afterAll`) — mirrors the established pattern in
  `admin-documents-notetaker-gate.spec.ts`/`proposals-permission-boundary.spec.ts` (role creation
  has no HTTP equivalent in this project). Covers: link absence, page redirect, `GET`/`POST` 403,
  and the plain-member boundary as a companion check.
- Considered whether a broader "full send flow" e2e spec was also warranted (per the task's ask to
  weigh this explicitly): **no** — the implementer-owned unit suite
  (`route.test.ts`'s 14 cases, `event-announcements.test.ts`'s 11, `event-announcements-queries.test.ts`'s
  5) already exercises every branch of the send/classify/render logic with mocked I/O, and this
  phase's live click-through (above) independently proved the real DB/UI wiring end-to-end. A
  permanent e2e spec asserting on exact cohort counts or history-table rows would be fragile
  against the shared dev DB's real, changing membership data (unlike the gate spec, which only
  needs a fixture role/user it fully controls) and wouldn't catch anything the unit tests plus this
  phase's live run didn't already prove. Not adding one is a deliberate call, not an omission.

## Coverage on Critical Modules

(`npx vitest run --coverage --coverage.reporter=json-summary`, full suite, read from
`coverage/coverage-summary.json` — the text-table reporter in this vitest version silently drops
some file rows from its printed table on a full run; the JSON summary is authoritative and was
used instead of trusting the truncated text output.)

- `src/lib/events.ts`: 94.96% statements / 87.42% branch / 96.29% functions / 96.09% lines — meets the 90%+ target, unaffected by this feature.
- `src/lib/permissions.ts`: 100% statements / 100% branch / 100% functions / 100% lines — meets the 100% target.
- `src/lib/members.ts`: 35.89% statements / 53.57% branch / 75% functions / 28.57% lines — **below the 80%+ target.** Pre-existing, not touched by this feature (Event Announcement Emails never imports or modifies `members.ts`); flagging for the next 7-day test-coverage review rather than fixing as a drive-by here.
- `src/lib/event-announcements.ts` (new): 100% statements / 92.85% branch / 100% functions / 100% lines.
- `src/lib/event-announcements-queries.ts` (new): 80.76% statements / 63.15% branch / 75% functions / 82.6% lines — uncovered lines are `getAnnouncementRecipients()`'s and `insertEventAnnouncementRows()`'s DB-facing bodies (thin CRUD wrappers), exercised instead by this phase's live click-through per the project's "DB-bound paths covered by e2e" convention.
- `src/lib/email.ts`: 93.47% statements / 91.17% branch / 100% functions / 92.68% lines — attachment plumbing well covered.

## Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `GET /api/admin/events/[id]/announce` | yes | yes | `FEATURES.EVENTS_ANNOUNCE` (verified by reading the route file, not inferred from tests) |
| `POST /api/admin/events/[id]/announce` | yes | yes | `FEATURES.EVENTS_ANNOUNCE` |
| `src/app/(dashboard)/admin/events/[id]/announce/page.tsx` (Server Component page gate) | yes | yes | `FEATURES.EVENTS_ANNOUNCE`, redirects to `/admin/events` (not back to `[id]`) on failure |
| "Announce" link gate on `src/app/(dashboard)/admin/events/[id]/page.tsx` | yes (page-level, shared) | yes, independent second check | `FEATURES.EVENTS_ANNOUNCE` computed alongside the page's own `EVENTS_EDIT` check — an editor without the announce key never sees the link |

This is a bulk-PII-adjacent send (every active member's name + email is read server-side to build
the cohort, though addresses are never returned to the client — confirmed by reading the GET
handler, which strips `email` before responding). The key used (`EVENTS_ANNOUNCE`) is a *new,
narrower* key than the general `EVENTS_EDIT`/`EVENTS_VIEW` keys, matching the Dues Reminders
precedent's reasoning (bulk email to real people is more sensitive than reading data) — not
reused, not widened onto an existing broader key. All four surfaces checked by directly reading
the route/page/component source, and independently reconfirmed live over the network by the new
`admin-events-announce-page-gate.spec.ts`.

**Pre-existing, out-of-scope observation surfaced during this audit (not a gate defect, not
blocking this PASS):** `sendEmail()`'s `_bulkMemberSend` option (added 2026-08-12, commit
`ff613f1`, unrelated to this feature) carries a doc comment claiming it "widens the non-production
guard unconditionally (no address matching)" for bulk-member sends — but the destructured
`_bulkMemberSend` value is never referenced anywhere in the guard logic (`isDevAllowedRecipient(to)`
is the only check actually applied, identical for bulk and single sends). The primary invariant
(deny-by-default unless the recipient is in `EMAIL_DEV_ALLOWLIST`) still holds correctly and was
directly observed working in this phase's live send test — this is not a regression and does not
loosen the guard below baseline. It means the extra, stronger claim in the comment (bulk sends
should be unconditionally blocked even to an allowlisted address) is currently unimplemented
dead code, shared identically by Dues Reminders and this feature (both route through
`sendBulkMemberEmail()`). Flagging for the next 30-day security review rather than fixing as a
drive-by inside this feature's diff — it predates this feature and touches a shared, sensitive
file.

## Verdict

**PASS**

---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-09-04

## Summary

Re-walked every Phase 1 flow against the live code (not just the Phase 4/5 prose): read
`src/app/api/admin/events/[id]/announce/route.ts`, `src/app/(dashboard)/admin/events/[id]/announce/page.tsx`,
`src/components/admin/event-announce-sender.tsx`, `event-announcement-history-table.tsx`, the
gated "Announce" link on the edit page, and `src/lib/email.ts`'s `_bulkMemberSend` finding
directly, rather than trusting the phase reports' claims. Everything Phase 1 asked for and every
User Decision the user made on 2026-09-04 is present and independently verifiable in the shipped
code. Two loose ends needed durable tracking before close: confirming B-53's e2e-drift picture
still matches (it does — no new spec files, added a dated update rather than a duplicate entry),
and giving the `_bulkMemberSend` dead-code/doc-mismatch a standalone backlog ID (`B-54`) rather
than leaving it as a comment only the next security review might surface.

## VERDICT

SHIP WITH NOTES

## ONE-LINE TAKE

> A board member can pick an event, choose occurrence-or-series scope, and send every active
> member a signed "Westerville Lions Club" email with a real .ics calendar attachment plus a
> durable per-recipient send record — the originating season-kickoff use case is fully
> deliverable, and every 2026-09-04 User Decision (new narrower permission, true MIME attachment,
> neutral signature, both scopes, no opt-out) shipped as specified.

## What's Working

- **The originating use case is real, not aspirational.** A board member holding `events.announce`
  can open a recurring event, pick "series," attach the full-season `.ics` (verified live by QA:
  the `email_queue.attachments` row contains a well-formed `BEGIN:VCALENDAR` payload with
  `contentType: "text/calendar"`), and send to every active member in one action — this is
  literally the season-kickoff scenario the user described, not a proxy for it.
- **"A record of exactly who was sent what" is real, not aspirational either.** The
  `event_announcements` table stores one row per attempted (has-email, selected) recipient, all
  sharing a `batchId`; the history panel groups these into "Emailed 39 of 41" per send with
  sender, scope, and timestamp. Members with no email are shown, not silently dropped (amber
  "no email on file" box, matching the Dues Reminders precedent), and a per-recipient failure is
  persisted with its own `success: false` + `error`, not swallowed into a blanket success.
- **The permission boundary is proven at the network level, not just asserted in source.** QA's
  `e2e/admin-events-announce-page-gate.spec.ts` composes a disposable `events.edit`-only fixture
  role (since no shipped role currently holds `events.edit` without `events.announce`) and proves
  live: link absent, page redirects, both routes 403. I independently re-confirmed the same three
  gate points (page, both route handlers, the link) by reading the actual source, not the test
  output — all four use `FEATURES.EVENTS_ANNOUNCE` specifically, never the broader `EVENTS_EDIT`.

## Intent-vs-Shipped Diff

- Phase 1 said: gate on a new, narrower key than `EVENTS_EDIT`, decided per User Decision 1 as
  `events.announce` bound to admin + board_member. Shipped: exactly that — `FEATURES.EVENTS_ANNOUNCE`,
  independently migrated and role-bound, verified live in `page.tsx`, both route handlers, and the
  edit-page link. **Verdict: matches.**
- Phase 1 flagged calendar delivery as the open question closest to the actual stated problem
  (ISP filters trusting attached content over a click-through link). User Decision 2 chose true
  MIME attachment. Shipped: `sendEmail()`/`sendBulkMemberEmail()` gained `attachments?`, persisted
  on `email_queue` (closing the retry-path gap QA and Phase 2 both flagged), and the announce route
  builds one real `.ics` attachment per batch via the existing `buildVEvent`/`buildIcsCalendar`
  helpers — not a link. **Verdict: matches**, and directly addresses the reason this feature exists
  (Zeffy mail being spam-filtered).
- Phase 1 flagged sender identity as an open question. User Decision 3 chose "Westerville Lions
  Club," no officer resolution. Shipped: fixed closing signature, no per-admin or per-officer
  variation. **Verdict: matches.**
- Phase 1 flagged per-occurrence vs. per-series scope as unclear from the raw request. User
  Decision 4 asked for both, since the originating ask was a series announcement. Shipped:
  occurrence/series radio picker for recurring events, forced-occurrence for one-off events, with
  server-side re-validation of the chosen scope on every send (never trusts the client). **Verdict:
  matches.**
- Phase 1 flagged recipient scope / opt-out as needing an explicit decision, not a silent
  omission. User Decision 5 chose every active member, no opt-out in v1, explicitly logging a
  member-preference system as a backlog candidate rather than assuming it away. Shipped: exactly
  that — cohort is `membershipStatus = 'active'`, no suppression list, and the decision to defer
  opt-out is recorded in this same work-log rather than only living in someone's memory. **Verdict:
  matches.**
- Phase 1's Flow 2 failure path noted there's no in-app remediation for a member's inbox still
  filtering club-domain mail — flagged as inherently outside what the app can guarantee. Shipped:
  unchanged, correctly not addressed (nothing in this stack can fix inbox-level spam filtering;
  the MIME attachment is the mitigation, not a guarantee). **Verdict: matches** (Phase 1 already
  scoped this correctly as unaddressable).
- Phase 2/3 flagged, twice, that the nested-page proxy test only proves *some* gate exists, not
  the *right* key — explicitly calling for a live-request test to close the gap. Shipped: QA wrote
  `e2e/admin-events-announce-page-gate.spec.ts` for exactly this, 7/7 passing, using a disposable
  fixture role since no real role today has `events.edit` without `events.announce`. **Verdict:
  matches** — the flagged gap was closed with the exact test shape called for, not waved off.

## Edge Cases

- Empty state: **pass.** Zero-future-occurrence events show an amber "nothing upcoming to
  announce" banner with the send UI suppressed but the page itself still reachable (no 404/crash);
  a freshly-created event's history panel reads "No announcements sent yet." in the standard
  `bg-gray-50 rounded-2xl p-10 text-center text-gray-500` empty-state treatment.
- Failure microcopy: **pass.** A partial-send failure renders "Emailed N of M — F failed" with a
  per-member breakdown, never a raw error or a blanket success; a rejected send (cancelled
  occurrence, empty recipient set) returns a human sentence (`"That occurrence has been cancelled
  or no longer exists — refresh and pick another."` / `"No recipients to send to."`), not a stack
  trace.
- Permission gate: **pass.** Confirmed independently at four points (page, GET, POST, link) by
  reading source directly, and confirmed live over the network by QA's dedicated e2e spec — not
  taken on faith from the phase report.
- Brand/wording constraint (B-47, "Emailed never Delivered"): **pass.** Every user-facing string in
  both the sender component and the history table uses "Emailed"/"Failed" — grepped directly,
  zero occurrences of "Delivered" in either file.
- Mobile (360px): **not independently re-verified by me** — QA's report states the history table
  and cohort lists are wrapped in their own `overflow-x-auto` containers per the design's mobile
  requirement, and I confirmed this by reading the component source (`overflow-x-auto` present on
  the history table), but no live 360px viewport screenshot exists in the QA record. Low risk
  given the pattern match to already-shipped Dues Reminders, but flagging as an honest "not fully
  independently verified" rather than a blanket pass.

## Follow-Ups (SHIP WITH NOTES)

- **B-54** (new, `docs/backlog.md`) — `sendEmail()`'s `_bulkMemberSend` option is dead code with an
  overclaiming doc comment (destructured, never read by the actual guard). Verified directly by
  grep during this Phase 6 pass, not just taken from QA's note. Does not weaken the deny-by-default
  invariant — the real guard is correct and was observed working live — but the comment
  misrepresents what the code does, which is worth fixing the next time `email.ts` is touched or at
  the next 30-day security review (also flagged there independently, so it's tracked twice on
  purpose: once as a durable backlog item with a shape-of-fix, once as a review trigger).
- **B-53** (updated, `docs/backlog.md`) — confirmed this feature's QA run doesn't change B-53's
  picture: same 6-7 pre-existing spec files (dev-DB fixture/date drift), one additional
  concurrency-flake (`write-in-signups.spec.ts`) that reproduces clean in isolation and wasn't
  added to the tracked file list. Logged as a dated update, not a duplicate entry.
- No new functional gap surfaced — both follow-ups above are pre-existing findings this feature's
  QA pass happened to surface, not shipped defects in this feature's own code.

## Red Flags (if NEEDS REWORK)

- None. No red flags — this section is empty because the verdict is SHIP WITH NOTES, not NEEDS
  REWORK.

## User Decisions (2026-09-04)

Answers to Phase 1's open questions, collected before Phase 2:

1. **Permission:** New, narrower key (`events.announce` or similar) bound to **`admin` + `board_member`** — the same two-role pattern as `proposals.review` and `social_requests.review`. Do NOT reuse `events.edit`.
2. **Calendar delivery:** True .ics MIME attachment — extend `sendEmail()` to support attachments. The more filter-resistant option; clients render attached invites natively.
3. **Sender identity:** Signed "Westerville Lions Club" — neutral and stable, no officer resolution needed. From-address is the club domain as always.
4. **Announcement scope:** Both per-occurrence ("meeting this Thursday") and per-series ("season kickoff" with the full-series calendar file) — the originating use case was a series announcement.
5. **Recipient scope (recommended default, not objected to):** Every active member, no opt-out in v1 — matching Dues Reminders; these are operational club notices, not marketing. A member email-preference system is explicitly out of scope (backlog candidate).
